/* ============================================================
   ops.js — EPI's operator console

   What EPI's own staff use to run the service for every client (RMC VII.9:
   visibility into transmission status, exception handling, acknowledgments
   and integration health for authorized administrative users).

   The operator sits in no client's account. The console shows each account's
   operating figures — counts, states and totals — and never a buyer, a line
   item or a document face (RMC VIII.8, permitted use). Anything EPI does to a
   client's account is written to that account's own activity log as well, so
   the client sees it.

   Everything is worked out when a screen opens. In production the same
   reconciliation runs nightly and is stored; see
   Documentation/07-nightly-reconciliation-spec.md.
   ============================================================ */

const OpsReg = {

  /* Unpaid fees are deliberately not here (RMC VIII.6). */
  SUSPEND_REASONS: {
    BIR_DIRECTIVE: 'Suspended on a BIR directive',
    PTI_SUSPENDED: 'Permit to Issue suspended or revoked by the BIR',
    SECURITY:      'Suspended after a security incident',
    OWNER_REQUEST: 'Suspended at the taxpayer\'s request'
  },

  /* RMC VII.14 names five kinds of personnel. */
  STAFF_FUNCTIONS: {
    TECHNICAL:  'Technical',
    SECURITY:   'Security',
    COMPLIANCE: 'Compliance',
    PRIVACY:    'Privacy',
    SUPPORT:    'Taxpayer support'
  },

  OUTCOMES: { NOW:'Required now', LATER:'Required later', VOLUNTARY:'Voluntary', NONE:'Not covered' },

  tenants(){ return Store.db.tenants.filter(t => !t.isProvider).sort((a, b) => a.name.localeCompare(b.name)); },
  tenant(id){ return Store.db.tenants.find(t => t.id === id) || null; },
  tenantName(id){ const t = this.tenant(id); return t ? t.name : '—'; },
  epiDocs(){ return BillingReg.all(Store.db); },
  /** Everything EPI issues as a taxpayer: printing sales and System invoices to clients. */
  epiAllDocs(){ return Store.db.invoices.filter(i => i.tenantId === 't_epi'); },

  statusBadge(t){
    const st = accountStatus(t);
    const cls = { ACTIVE:'lbadge-green', SUSPENDED:'lbadge-red', CLOSED:'lbadge-gray' }[st] || 'lbadge-gray';
    return `<span class="lbadge ${cls} lbadge-dot">${st.charAt(0) + st.slice(1).toLowerCase()}</span>`;
  },

  /** Logs on the client's account (so the client sees it) and leaves the
      operator's name on it. */
  log(tenantId, action){ logActivity(Store.db, { tenantId, actorType:'EPI', action }); },

  /* ---------- Periods (calendar quarters) ---------- */

  periods(){
    const now = new Date();
    let y = now.getFullYear(), q = Math.floor(now.getMonth() / 3) + 1;
    const mk = (y, q, to) => ({ key:`${y}-Q${q}`, label:`Q${q} ${y}`,
      from:new Date(y, (q - 1) * 3, 1).toISOString(), to:(to || new Date(y, q * 3, 1)).toISOString() });
    const list = [Object.assign(mk(y, q, now), { label:`Q${q} ${y} to date` })];
    for (let i = 0; i < 4; i++){ q--; if (!q){ q = 4; y--; } list.push(mk(y, q)); }
    list.push({ key:'ALL', label:'All records', from:new Date(2000, 0, 1).toISOString(), to:now.toISOString() });
    return list;
  },
  /** Defaults to the last finished quarter: the one a periodic report covers. */
  period(key){ const l = this.periods(); return l.find(p => p.key === key) || l[1]; },
  inRange(iso, p){ const d = new Date(iso); return d >= new Date(p.from) && d < new Date(p.to); },
  overlapMs(a, b, p){
    const s = Math.max(new Date(a).getTime(), new Date(p.from).getTime());
    const e = Math.min(b ? new Date(b).getTime() : Date.now(), new Date(p.to).getTime(), Date.now());
    return Math.max(0, e - s);
  },

  /* ---------- Health and alerts ---------- */

  /** One account's operating figures. Counts, states and totals only. */
  health(t){
    const rows = ResReg.rowsFor(t.id);
    const r = ResReg.reconcile(rows);
    const by = k => rows.filter(i => i.transmissionStatus === k).length;
    const last = rows.filter(i => i.transmittedAt).sort((a, b) => new Date(b.transmittedAt) - new Date(a.transmittedAt))[0];
    return {
      t, docs:rows.length, r, ties:ResReg.ties(r),
            queued:by('QUEUED'), failed:by('FAILED'), rejected:by('REJECTED'), overdue:r.overdue,
      dups:ResReg.duplicates(rows).filter(x => !x.warn).length,
      manualOpen:ResReg.manuals(t.id).filter(m => m.status !== 'LINKED').length,
      lastAck: last ? last.transmittedAt : null
    };
  },

  epiHealth(){
    const rows = this.epiAllDocs();
    const r = ResReg.reconcile(rows);
    const by = k => rows.filter(i => i.transmissionStatus === k).length;
    return { docs:rows.length, r, ties:ResReg.ties(r), queued:by('QUEUED'), failed:by('FAILED'), rejected:by('REJECTED') };
  },

  /** What needs someone's attention, most urgent first. */
  alerts(){
    const db = Store.db, out = [];
    const add = (level, text, go) => out.push({ level, text, go });

    const int = activeInterruption();
    if (int) add('danger', `${INTERRUPTION_SOURCES[int.source].label} (${int.ref}) has been open since ${fmtDateTime(int.startedAt)}.`, 'opsService');

    const cert = espCertState();
    if (!cert.valid) add('danger', 'EPI\'s ESP accreditation certificate has lapsed. Every client\'s Permit to Issue lapses with it.', 'opsReports');
    else if (cert.renewalOpen) add('warn', `EPI's ESP accreditation certificate expires in ${cert.days} days. Renew at least 60 days before.`, 'opsReports');

    this.tenants().forEach(t => {
      const h = this.health(t);
      if (!h.ties) add('danger', `${t.name}: the account does not tie. ${h.r.unaccounted
        ? `${h.r.unaccounted} invoice(s) are in no known state.`
        : `Issued ${peso(h.r.issuedAmt)}, but acknowledged, waiting and cancelled add up to ${peso(round2(h.r.ackAmt + h.r.waitingAmt + h.r.notGoingAmt))}.`}`, 'ops');
      if (h.dups) add('danger', `${t.name}: ${h.dups} duplicate check(s) failed (number, acknowledgment or double send).`, 'ops');
      if (h.failed || h.rejected) add('warn', `${t.name}: ${[h.failed ? `${h.failed} failed` : '', h.rejected ? `${h.rejected} rejected` : ''].filter(Boolean).join(' and ')} invoice(s) need sending again.`, 'ops');
            if (h.overdue) add('danger', `${t.name}: ${h.overdue} invoice(s) are past the ${TRANSMIT_LIMIT_DAYS}-day limit to reach the BIR.`, 'ops');
      if (h.manualOpen) add('warn', `${t.name}: ${h.manualOpen} manual invoice(s) with no e-invoice yet.`, 'ops');
    });


    const e = this.epiHealth();
    if (!e.ties) add('danger', 'EPI\'s own billing does not tie with what the BIR acknowledged.', 'opsBilling');
    if (e.failed || e.rejected) add('warn', `${e.failed + e.rejected} of EPI's own invoices need sending again.`, 'opsBilling');

    (db.dataRequests || []).filter(r => !r.fulfilledAt).forEach(r => {
      const hrs = (new Date(r.dueAt) - Date.now()) / 36e5;
      if (hrs < 0) add('danger', `BIR ${RecordsReg.TYPES[r.type].label.toLowerCase()} for ${this.tenantName(r.tenantId)} is overdue (due ${fmtDateTime(r.dueAt)}).`, 'opsRequests');
      else if (hrs < 24) add('warn', `BIR ${RecordsReg.TYPES[r.type].label.toLowerCase()} for ${this.tenantName(r.tenantId)} is due ${fmtDateTime(r.dueAt)}.`, 'opsRequests');
      else add('info', `BIR ${RecordsReg.TYPES[r.type].label.toLowerCase()} for ${this.tenantName(r.tenantId)} is open, due ${fmtDateTime(r.dueAt)}.`, 'opsRequests');
    });

    IncReg.alerts(add);

    interruptions().filter(x => !x.verified).forEach(x =>
      add('warn', `${x.ref} (${INTERRUPTION_SOURCES[x.source].short}) is not verified. Delays it caused cannot be certified until it is.`, 'opsService'));
    (db.problemReports || []).filter(r => r.status === 'UNDER_REVIEW').forEach(r =>
      add('warn', `Problem ${r.ref} from ${this.tenantName(r.tenantId)} is waiting for review. Filed ${fmtDateTime(r.reportedAt)}.`, 'opsService'));

    (db.onboardingApps || []).forEach(a => {
      if (a.status === 'PENDING_VERIFICATION') add(AppReg.overdue(a) ? 'warn' : 'info', AppReg.overdue(a)
        ? `${a.tenantName} (${a.ref}) is past EPI's ${AppReg.TURNAROUND_DAYS}-working-day answer, which was due ${fmtDate(a.dueAt)}.`
        : `${a.tenantName} (${a.ref}) needs validating before it can be accepted. Answer by ${fmtDate(a.dueAt)}.`, 'opsOnboarding');
      if (a.stage === 'GOLIVE_REVIEW' && !a.activatedAt)
        add('info', `${a.tenantName} finished setup and is waiting for the activation review, due ${fmtDate(a.goLiveDueAt)}.`, 'opsOnboarding');
    });
    (db.repRequests || []).filter(r => r.status === 'PENDING').forEach(r =>
      add('info', `${this.tenantName(r.tenantId)} asked to replace its representative with ${r.name}. Check the new authority document.`, 'opsClients'));
    this.tenants().forEach(t => {
      const st = AppReg.authorityState(t);
      if (st) add('warn', `${t.name}: the representative's authority ${st === 'EXPIRED' ? 'expired' : 'expires'} on ${fmtDate(t.authority.expiresAt)}. Ask for a new authority document or replace the representative.`, 'opsClients');
    });
    this.tenants().filter(t => !t.isProvider && ['OVERDUE', 'DUE_SOON'].indexOf(eisInfo(t).key) > -1).forEach(t => {
      const e = eisInfo(t);
      add(e.key === 'OVERDUE' ? 'danger' : 'warn', `${t.name}: EIS Certification ${e.label.toLowerCase()} (due ${fmtDate(e.due + 'T12:00:00+08:00')}). The BIR can revoke the PTI if it is missed.`, 'opsClients');
    });
    this.tenants().filter(t => ptiStatus(t) !== 'ISSUED').forEach(t =>
      add('info', `${t.name}: Permit to Issue ${PTI_STATES[ptiStatus(t)].label.toLowerCase()}.`, 'opsOnboarding'));

    this.epiDocs().filter(i => i.paymentSubmitted).forEach(i =>
      add('info', `${this.tenantName(i.clientId)} sent payment details for ${i.number}. Confirm or decline it.`, 'opsBilling'));
    (db.planChanges || []).filter(r => r.status === 'PENDING').forEach(r =>
      add('info', `${this.tenantName(r.tenantId)} asked to move from ${PLANS[r.from].label} to ${PLANS[r.to].label} at renewal.`, 'opsOnboarding'));

    const overdue = this.epiDocs().filter(i => BillingReg.payState(i).key === 'OVERDUE');
    if (overdue.length) add('info', `${overdue.length} of EPI's invoices to clients are overdue. Access is not affected.`, 'opsBilling');

    const rank = { danger:0, warn:1, info:2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  },

  /* ---------- Service levels ---------- */

  metrics(p){
    const db = Store.db;
    const span = this.overlapMs(p.from, p.to, p);
    const down = srcs => interruptions().filter(x => srcs.indexOf(x.source) > -1)
      .reduce((a, x) => a + this.overlapMs(x.startedAt, x.endedAt, p), 0);
    const avail = srcs => span > 0 ? Math.round(10000 * (1 - down(srcs) / span)) / 100 : null;

    const docs = db.invoices
      .filter(i => i.docStatus !== 'DRAFT' && this.inRange(i.recordedAt || i.issuedAt, p));
    const sendable = docs.filter(i => i.transmissionStatus !== 'NOT_READY');
    const lat = sendable.filter(i => i.transmissionStatus === 'TRANSMITTED' && i.transmittedAt)
      .map(i => Math.max(0, (new Date(i.transmittedAt) - new Date(i.recordedAt || i.issuedAt)) / 1000)).sort((a, b) => a - b);
    const pct = q => lat.length ? lat[Math.min(lat.length - 1, Math.ceil(q * lat.length) - 1)] : null;
        const infos = sendable.map(delayInfo);
    const delayed = infos.filter(x => x.delayed);
    const lim = sendable.map(limitInfo);

    const reqs = (db.dataRequests || []).filter(r => this.inRange(r.requestedAt, p));
    const met = reqs.filter(r => r.fulfilledAt && new Date(r.fulfilledAt) <= new Date(r.dueAt));
    const reps = (db.problemReports || []).filter(r => this.inRange(r.reportedAt, p));

    return {
      period:{ label:p.label, from:p.from, to:p.to },
      availability:{ epi:avail(['ESP']), birEis:avail(['EIS']), api:avail(['API']) },
      documents:sendable.length,
      ackSeconds:{ median:pct(0.5), p95:pct(0.95) },
            ackedInTime:{ count:sendable.length - delayed.length, of:sendable.length, thresholdHours:TRANSMIT_DELAY_HOURS },
      sentWithinLimit:{ count:lim.filter(x => !x.over).length, of:sendable.length, limitDays:TRANSMIT_LIMIT_DAYS, late:lim.filter(x => x.state === 'LATE').length, overdueOpen:lim.filter(x => x.state === 'OVERDUE').length },
      delayedByCause:{ provider:delayed.filter(x => x.cause === 'PROVIDER').length,
                       taxpayerData:delayed.filter(x => x.cause === 'DATA').length,
                       notSent:delayed.filter(x => x.cause === 'NOT_SENT').length },
      birRequests:{ count:reqs.length, metOnTime:met.length, open:reqs.filter(r => !r.fulfilledAt).length },
      incidents:(() => { const l = IncReg.list().filter(i => this.inRange(i.discoveredAt, p) && i.critical);
        const ok = l.filter(i => IncReg.clock(i).state === 'MET').length;
        return { critical:l.length, writtenOnTime:ok }; })(),
      problemReports:{ count:reps.length, reviewed:reps.filter(r => r.status === 'CONFIRMED').length,
                       certificates:reps.filter(r => r.certificate).length },
      targets:'The BIR limit is 3 calendar days from the sale. EPI\'s own target is 1 hour.'
    };
  },

  secs(s){
    if (s === null) return '—';
    if (s < 90) return `${Math.round(s)} s`;
    if (s < 5400) return `${Math.round(s / 60)} min`;
    return `${Math.round(s / 360) / 10} h`;
  },

  /* ---------- Reports to the BIR (RMC VII.12) ---------- */

  REPORTS: {
    TRANSACTION: { label:'Transaction',              holds:'Invoices issued and acknowledged, per client account and for EPI\'s own billing' },
    PERFORMANCE: { label:'Performance',              holds:'Availability, acknowledgment times, delays by cause, BIR requests met on time' },
    INCIDENT:    { label:'Incident',                 holds:'Interruptions and problem reports, with verification and certificates' },
    SECURITY:    { label:'Security',                 holds:'EPI staff and BIR access to client accounts, suspensions and legal holds' },
    CAPACITY:    { label:'Capacity',                 holds:'Accounts, users, invoices and the busiest day' },
    FINANCIAL:   { label:'Financial sustainability', holds:'EPI\'s billing, collections and amounts outstanding' },
    ONBOARDING:  { label:'Client onboarding',        holds:'Accounts activated, applications and their checks, permit status' }
  },

  report(kind, p){
    const db = Store.db, self = this;
    const docsIn = list => list.filter(i => i.docStatus !== 'DRAFT' && self.inRange(i.issuedAt, p));
    const acts = (db.activity || []).filter(a => self.inRange(a.at, p));
    const build = {
      TRANSACTION(){
        const accounts = self.tenants().map(t => {
          const d = docsIn(db.invoices.filter(i => i.tenantId === t.id)), r = ResReg.reconcile(d);
          const n = k => d.filter(i => i.docType === k).length;
          return { account:t.name, tin:t.tin, documents:d.length, invoices:n('INVOICE'),
                   cancelled:d.filter(i => i.docStatus === 'CANCELLED').length,
                   acknowledged:d.filter(i => i.transmissionStatus === 'TRANSMITTED').length,
                   waiting:d.filter(i => TransReg.ACTIONABLE.indexOf(i.transmissionStatus) > -1).length,
                   amountIssued:r.issuedAmt, amountAcknowledged:r.ackAmt };
        });
        const e = docsIn(self.epiDocs());
        return { accounts, epiOwnBilling:{ documents:e.length, acknowledged:e.filter(i => i.transmissionStatus === 'TRANSMITTED').length,
                 amount:round2(e.reduce((a, i) => a + i.totals.totalDue, 0)) },
                 headline:`${accounts.reduce((a, x) => a + x.documents, 0)} client invoices, ${e.length} EPI invoices` };
      },
      PERFORMANCE(){
        const m = self.metrics(p);
        return Object.assign(m, { headline:`EPI available ${m.availability.epi === null ? '—' : m.availability.epi + '%'}, ${m.ackedInTime.count} of ${m.ackedInTime.of} acknowledged in time` });
      },
      INCIDENT(){
        const ints = interruptions().filter(x => self.overlapMs(x.startedAt, x.endedAt, p) > 0).map(x => ({
          ref:x.ref, source:INTERRUPTION_SOURCES[x.source].label, startedAt:x.startedAt, endedAt:x.endedAt,
          minutes:Math.round((new Date(x.endedAt || Date.now()) - new Date(x.startedAt)) / 60000),
          verified:!!x.verified, declaredBy:x.declaredBy, note:x.note }));
        const reps = (db.problemReports || []).filter(r => self.inRange(r.reportedAt, p)).map(r => ({
          ref:r.ref, account:self.tenantName(r.tenantId), reportedAt:r.reportedAt, kind:ResReg.KINDS[r.kind],
          documents:r.docIds.length, status:r.status, certificate:r.certificate ? r.certificate.ref : null }));
        const incs = IncReg.list().filter(i => self.inRange(i.discoveredAt, p)).map(i => {
          const b = IncReg.clock(i);
          return { ref:i.ref, kind:IncReg.KINDS[i.kind], title:i.title, discoveredAt:i.discoveredAt, critical:i.critical,
                   notCriticalReason:i.notCritical ? i.notCritical.reason : null, status:i.status,
                   writtenReport:{ state:b.state, at:i.writtenReport ? i.writtenReport.at : null, reference:i.writtenReport ? i.writtenReport.reference : null },
                   clientNotices:IncReg.noticesFor(i.id).length };
        });
        return { incidents:incs, interruptions:ints, problemReports:reps,
                 headline:`${incs.length} incident(s), ${ints.length} interruption(s), ${reps.length} problem report(s)` };
      },
      SECURITY(){
        const pick = f => acts.filter(f).map(a => ({ at:a.at, account:a.tenantId ? self.tenantName(a.tenantId) : 'EPI', by:a.actorName, action:a.action }));
        const epiAccess = pick(a => a.actorType === 'EPI' && a.tenantId);
        const birAccess = pick(a => a.role === 'BIR_EXAMINER');
        const changes = pick(a => /suspend|reopen|legal hold|closed the account/i.test(a.action));
        return { controls:{ signIn:'Password and a second step at every sign-in (email code, authenticator or passkey)',
                            auditLog:`Written once, time-synchronised (${SYSTEM.timeSync.source})` },
                 signIns:acts.filter(a => /^Signed in/.test(a.action)).length,
                 epiStaffActionsOnClientAccounts:epiAccess, birExaminerAccess:birAccess, accountStatusAndHolds:changes,
                 headline:`${epiAccess.length} EPI action(s) on client accounts, ${birAccess.length} BIR access event(s)` };
      },
      CAPACITY(){
        const d = docsIn(db.invoices);
        const byDay = {};
        d.forEach(i => { const k = i.issuedAt.slice(0, 10); byDay[k] = (byDay[k] || 0) + 1; });
        const top = Object.keys(byDay).sort((a, b) => byDay[b] - byDay[a])[0];
        const days = Object.keys(byDay).length;
        return { clientAccounts:db.tenants.filter(t => !t.isProvider).length,
                 activeClientUsers:db.users.filter(u => u.tenantId && u.active).length,
                 epiStaff:db.users.filter(u => u.roleKey === 'EPI_OPERATOR' && u.active).length,
                 documents:d.length, daysWithDocuments:days, averagePerActiveDay:days ? Math.round(d.length / days * 10) / 10 : 0,
                 busiestDay: top ? { date:top, documents:byDay[top] } : null,
                 note:'Infrastructure figures (servers, storage, throughput tests) come from hosting monitoring and are attached separately.',
                 headline:`${d.length} documents, busiest day ${top ? `${byDay[top]} (${top})` : '—'}` };
      },
      FINANCIAL(){
        const billed = docsIn(self.epiDocs());
        const sum = l => round2(l.reduce((a, i) => a + i.totals.totalDue, 0));
        const paid = billed.filter(i => i.paymentStatus === 'PAID');
        const overdue = billed.filter(i => BillingReg.payState(i).key === 'OVERDUE');
        return { invoices:billed.length, billed:sum(billed), collected:sum(paid), outstanding:round2(sum(billed) - sum(paid)),
                 overdue:sum(overdue), payingClients:new Set(billed.map(i => i.clientId)).size,
                 note:'Audited financial statements are submitted separately.',
                 headline:`${peso(sum(billed))} billed, ${peso(sum(paid))} collected` };
      },
      ONBOARDING(){
        const live = self.tenants().filter(t => t.goLiveAt && self.inRange(t.goLiveAt, p)).map(t => ({
          account:t.name, tin:t.tin, lane:t.lane, coverage:coverage(t).basis.label, liveSince:t.goLiveAt, pti:PTI_STATES[ptiStatus(t)].label }));
        const inP = (db.onboardingApps || []).filter(a => self.inRange(a.submittedAt, p) || (a.reviewedAt && self.inRange(a.reviewedAt, p)));
        const apps = inP.map(a => ({
          reference:a.ref, applicant:a.tenantName, tin:a.tin, entity:(ENTITY_TYPES[a.entity] || {}).label || a.entity,
          appliedAs:a.authority ? 'Authorized representative' : 'Signatory', submittedAt:a.submittedAt, status:a.status,
          decidedAt:a.reviewedAt || null, daysTaken:AppReg.daysTaken(a),
          withinTurnaround:a.reviewedAt ? new Date(a.reviewedAt) <= new Date(a.dueAt) : null,
          declineReason:a.declineReason || null, checks:a.checks || null }));
        const count = st => inP.filter(a => a.status === st).length;
        const taken = apps.map(a => a.daysTaken).filter(d => d !== null);
        const summary = { received:inP.filter(a => self.inRange(a.submittedAt, p)).length, accepted:count('ACCEPTED'), declined:count('DECLINED'),
          pending:count('PENDING_VERIFICATION'), needsInformation:count('NEEDS_INFO'),
          averageDaysToDecide:taken.length ? round2(taken.reduce((x, y) => x + y, 0) / taken.length) : null,
          turnaroundWorkingDays:AppReg.TURNAROUND_DAYS };
        const pti = {};
        db.tenants.filter(t => !t.isProvider).forEach(t => { const k = PTI_STATES[ptiStatus(t)].label; pti[k] = (pti[k] || 0) + 1; });
        return { applicationSummary:summary, applications:apps, wentLive:live, permitToInvoiceAllAccounts:pti,
                 headline:`${summary.received} received, ${summary.accepted} accepted, ${summary.declined} declined, ${live.length} activated` };
      }
    };
    const data = build[kind]();
    const headline = data.headline; delete data.headline;
    return { headline, doc:{
      report:`${this.REPORTS[kind].label} report`, period:{ label:p.label, from:p.from, to:p.to },
      provider:{ name:SYSTEM.vendor, tin:SYSTEM.taxpayer.tin, accreditationCertificate:SYSTEM.certificates.esp.no, system:`${SYSTEM.product} v${SYSTEM.version}` },
      generatedAt:new Date().toISOString(), generatedBy:CU ? CU.name : 'System',
      format:'JSON, UTF-8. Layout pending the BIR\'s prescribed format. Figures only; no buyer details or line items.',
      data } };
  },

  /* ---------- EPI's own sales (for its VAT returns) ---------- */

  salesByMonth(){
    const m = {};
    this.epiAllDocs().filter(i => i.docStatus !== 'CANCELLED').forEach(i => {
      const k = BillingReg.key(i.issuedAt);
      const x = m[k] = m[k] || { key:k, count:0, sys:0, vatable:0, exempt:0, zero:0, vat:0, total:0 };
      x.count++; if (i.providerBilling) x.sys++;
      x.vatable += i.totals.vatableSales || 0; x.exempt += i.totals.exempt || 0; x.zero += i.totals.zero || 0;
      x.vat += i.totals.vat || 0; x.total += i.totals.totalDue || 0;
    });
    return Object.keys(m).sort().map(k => Object.assign(m[k], { vatable:round2(m[k].vatable), exempt:round2(m[k].exempt), zero:round2(m[k].zero), vat:round2(m[k].vat), total:round2(m[k].total) }));
  },

  save(name, text, mime){ RecordsReg.save(name, mime || 'application/json', text); }
};

/* ============================================================
   Handlers. Every one is EPI-only.
   ============================================================ */

const opsOnly = fn => p => can('operate') ? fn(p || {}) : { success:false, message:'Only EPI operations can do this.' };

LocalAPI.on("Dashboard/OpsSuspend", opsOnly(p => {
  const db = Store.db, t = OpsReg.tenant(p.id);
  if (!t || accountStatus(t) !== 'ACTIVE') return { success:false, message:'Only an active account can be suspended.' };
  if (!OpsReg.SUSPEND_REASONS[p.reason]) return { success:false, message:'Select a reason.' };
  const ref = String(p.reference || '').trim();
  if (!ref) return { success:false, message:'Enter the reference (for example, the BIR letter or ticket number).' };
  t.accountStatus = 'SUSPENDED';
  t.suspension = { reason:p.reason, reference:ref.slice(0, 80), by:CU.name, at:new Date().toISOString() };
  OpsReg.log(t.id, `Account suspended: ${OpsReg.SUSPEND_REASONS[p.reason]}, ${t.suspension.reference}. Read-only. All records stay viewable and exportable`);
  Store.save(db);
  return { success:true, message:`${t.name} suspended. It is read-only until reopened.` };
}));

LocalAPI.on("Dashboard/OpsReopen", opsOnly(p => {
  const db = Store.db, t = OpsReg.tenant(p.id);
  if (!t || accountStatus(t) === 'ACTIVE') return { success:false, message:'That account is already active.' };
  const was = accountStatus(t).toLowerCase();
  t.accountStatus = 'ACTIVE';
  if (t.suspension) t.suspension = Object.assign({}, t.suspension, { endedAt:new Date().toISOString(), endedBy:CU.name, active:false });
  OpsReg.log(t.id, `Account reopened by EPI (was ${was})`);
  Store.save(db);
  return { success:true, message:`${t.name} reopened.` };
}));

LocalAPI.on("Dashboard/OpsRequestReady", opsOnly(p => {
  const db = Store.db, r = (db.dataRequests || []).find(x => x.id === p.id);
  if (!r || r.fulfilledAt) return { success:false, message:'That request is already answered.' };
  r.fulfilledAt = new Date().toISOString();
  r.fulfilledBy = CU.name;
  OpsReg.log(r.tenantId, `Data extract ready for the BIR: ${r.scope}`);
  Store.save(db);
  const late = new Date(r.fulfilledAt) > new Date(r.dueAt);
  return { success:true, message:`Extract ready for ${OpsReg.tenantName(r.tenantId)}${late ? ', after its due time' : ', on time'}. The examiner downloads it from the taxpayer's Records.` };
}));

LocalAPI.on("Dashboard/OpsAppReview", opsOnly(p => {
  const db = Store.db, a = AppReg.get(p.id);
  if (!a || a.status !== 'PENDING_VERIFICATION') return { success:false, message:'That application is not waiting for review.' };
  const now = new Date().toISOString(), txt = k => String(p[k] || '').trim();

  if (p.decision === 'DECLINE'){
    if (!AppReg.DECLINE_REASONS[p.code]) return { success:false, message:'Select the reason for declining.' };
    Object.assign(a, { status:'DECLINED', declineCode:p.code, declineReason:AppReg.DECLINE_REASONS[p.code],
      declineNote:txt('note').slice(0, 200), reviewedBy:CU.name, reviewedAt:now,
      purgeAt:new Date(Date.now() + AppReg.RETENTION_DAYS * 864e5).toISOString() });
    AppReg.note(a, 'Declined: ' + a.declineReason, CU.name);
    logActivity(db, { actorType:'EPI', action:`Application ${a.ref} from ${a.tenantName} declined: ${a.declineReason}` });
    Store.save(db);
    return { success:true, message:`${a.tenantName} declined. The reason is emailed to ${a.email}.` };
  }

  if (p.decision === 'INFO'){
    if (!txt('request')) return { success:false, message:'Enter what the applicant needs to send.' };
    a.status = 'NEEDS_INFO';
    a.info = { request:txt('request').slice(0, 300), at:now, by:CU.name };
    AppReg.note(a, 'More information requested', CU.name);
    logActivity(db, { actorType:'EPI', action:`More information requested on application ${a.ref} from ${a.tenantName}` });
    Store.save(db);
    return { success:true, message:`Request emailed to ${a.email}. The application waits for the reply.` };
  }

  const basis = COVERAGE_BASES[p.basis] ? p.basis : null;
  if (!txt('legal')) return { success:false, message:'Record how legal existence was checked.' };
  if (!basis || (COMPLIANCE.acceptOnlyRequired && COVERAGE_BASES[basis].when !== 'NOW'))
    return { success:false, message:`Only a taxpayer required to issue e-invoices by ${complianceDeadline()} can be accepted.` };
  if (p.authOk !== true && p.authOk !== 'true')
    return { success:false, message:a.authority ? "Confirm the representative's authority document." : 'Confirm that the applicant can sign for the business.' };
  if (a.authority && p.expiresAt && new Date(p.expiresAt + 'T23:59:59+08:00') < new Date())
    return { success:false, message:'The authority document has expired. Request a current one.' };
  if (['VAT', 'NONVAT'].indexOf(p.taxType) === -1) return { success:false, message:'Record the tax type from Form 2303.' };
  if (!txt('rdo') || !txt('address') || !txt('lob'))
    return { success:false, message:'Record the RDO, registered address and registered activities from Form 2303.' };

  const token = AppReg.accept(db, a, {
    legal:txt('legal').slice(0, 200), basis,
    authority:a.authority ? `${AUTHORITY_DOCS[a.authority.kind]} names ${a.applicant.person}; signed by ${a.authority.signatory}`
                          : `${a.applicant.person} confirmed as ${a.applicant.position}`,
    expiresAt:p.expiresAt || null, taxType:p.taxType,
    rdo:txt('rdo').slice(0, 80), address:txt('address').slice(0, 200), lob:txt('lob').slice(0, 200)
  }, CU.name);
  Store.save(db);
  return { success:true, message:`${a.tenantName} accepted. Set-password link sent to ${a.email}${DEMO_MODE ? ` (demo code ${token})` : ''}.` };
}));

LocalAPI.on("Dashboard/OpsGoLive", opsOnly(p => {
  const db = Store.db, a = AppReg.get(p.id);
  if (!a || a.stage !== 'GOLIVE_REVIEW' || a.activatedAt) return { success:false, message:'That account is not waiting for a activation review.' };
  if (p.decision === 'RETURN'){
    const why = String(p.note || '').trim();
    if (!why) return { success:false, message:'Enter what the client needs to change.' };
    a.stage = 'SETUP';
    a.goLiveReturn = { note:why.slice(0, 300), at:new Date().toISOString(), by:CU.name };
    AppReg.note(a, 'Activation review returned: ' + a.goLiveReturn.note, CU.name);
    Store.save(db);
    return { success:true, message:`Returned to ${a.tenantName} with your note.` };
  }
  const s = a.setup || {};
  if (!(s.docs && s.docs.signedAgreement)) return { success:false, message:'The signed and notarized agreement has not been uploaded.' };
  if (!(p.agreementOk === true || p.agreementOk === 'true')) return { success:false, message:'Check the signed agreement against every point before approving.' };
  if (s.provider && !(p.providerOk === true || p.providerOk === 'true')) return { success:false, message:'Confirm the payment provider and its settlement account before approving.' };
  a.agreementCheck = { by:CU.name, at:new Date().toISOString() };
  if (s.provider) a.providerCheck = { by:CU.name, at:a.agreementCheck.at };
  AppReg.build(db, a, CU.name);
  Store.save(db);
  return { success:true, message:`${a.tenantName} is active. The agreement is checked and EPI has countersigned. Fees run from its first invoice.` };
}));

LocalAPI.on("Dashboard/OpsReplaceRep", opsOnly(p => {
  const db = Store.db, t = OpsReg.tenant(p.id);
  if (!t) return { success:false, message:'Account not found.' };
  const bad = AppReg.repProblem(db, p);
  if (bad) return { success:false, message:bad };
  const token = AppReg.replaceRep(db, t, p, CU.name);
  Store.save(db);
  return { success:true, message:`${p.name.trim()} is invited as owner of ${t.name}${DEMO_MODE ? ` (demo code ${token})` : ''}.` };
}));

LocalAPI.on("Dashboard/OpsRepDecide", opsOnly(p => {
  const db = Store.db, r = (db.repRequests || []).find(x => x.id === p.id), t = r && OpsReg.tenant(r.tenantId);
  if (!r || r.status !== 'PENDING' || !t) return { success:false, message:'That request has already been decided.' };
  const now = new Date().toISOString();
  if (p.decision === 'DECLINE'){
    const why = String(p.note || '').trim();
    if (!why) return { success:false, message:'Enter the reason for declining.' };
    Object.assign(r, { status:'DECLINED', note:why.slice(0, 200), decidedBy:CU.name, decidedAt:now });
    OpsReg.log(t.id, `Request to replace the representative with ${r.name} declined: ${r.note}`);
    Store.save(db);
    return { success:true, message:`Request from ${t.name} declined. The current representative stays.` };
  }
  if (p.docOk !== true && p.docOk !== 'true') return { success:false, message:'Confirm that the authority document names the new representative and covers onboarding, agreements, authorizations and the tax profile.' };
  const bad = AppReg.repProblem(db, r);
  if (bad) return { success:false, message:bad };
  const token = AppReg.replaceRep(db, t, r, CU.name);
  Object.assign(r, { status:'APPROVED', decidedBy:CU.name, decidedAt:now });
  Store.save(db);
  return { success:true, message:`${r.name} is invited as owner of ${t.name}${DEMO_MODE ? ` (demo code ${token})` : ''}. The previous representative's access has ended.` };
}));

LocalAPI.on("Dashboard/OpsPtiIssued", opsOnly(p => {
  const db = Store.db, t = OpsReg.tenant(p.id);
  if (!t || ptiStatus(t) !== 'APPLIED') return { success:false, message:'There is no filed application waiting on that account.' };
  t.pti = 'BIR-PTI-2026-' + String(Math.floor(10000 + Math.random() * 89999));
  OpsReg.log(t.id, `Permit to Issue ${t.pti} issued by the BIR (simulated), recorded by EPI`);
  Store.save(db);
  return { success:true, message:`${t.name} now holds ${t.pti}. Issuing invoices is now open.` };
}));

LocalAPI.on("Dashboard/OpsEpiSend", opsOnly(p => {
  const db = Store.db, inv = OpsReg.epiAllDocs().find(i => i.id === p.id);
  if (!inv || inv.transmissionStatus === 'TRANSMITTED') return { success:false, message:'That invoice is already acknowledged.' };
  const res = attemptTransmission(inv);
  Store.save(db);
  return { success:res.ok, message: res.ok ? `${inv.number} acknowledged, ${res.ref}.` : `${inv.number} not sent: ${res.why}` };
}));

/* ============================================================
   Shared UI bits
   ============================================================ */

const OpsUI = {
  call(route, data, back){
    $.ajax({ url:`/Portal/SPIStradcom/Dashboard/${route}`, method:"POST", dataType:"json", data:data || {} }).done(function (res) {
      /* A refusal leaves the form open, so nothing typed into it is lost. */
      if (!res.success && !$('#modal-root').hasClass('hidden')){ DisplayDelaySwal("info", "", res.message); return; }
      UI.closeModal();
      DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
      refreshSession();
      Auth.paintChrome();
      if (back) Nav.go(back, Nav.opts);
    });
  },

  head(title, sub, right){
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">${title}</h1>
          ${sub ? `<div class="screen_sub">${sub}</div>` : ''}
        </div>
        ${right || ''}
      </div>`;
  },

  periodSelect(cls, key){
    const cur = OpsReg.period(key).key;
    return `<select class="form-select form-select-sm ${cls}" style="width:auto">
      ${OpsReg.periods().map(p => `<option value="${p.key}"${p.key === cur ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`;
  },

  checkRow(ok, label, detail){
    return `<div class="fs_13 mb-1"><i class="bi ${ok ? 'bi-check-circle text-success' : 'bi-x-circle text-danger'} me-1"></i>${esc(label)}
      ${detail ? `<div class="fs_12 text-muted ms-4">${esc(detail)}</div>` : ''}</div>`;
  },

  tie(ok){ return ok ? '<i class="bi bi-check-circle text-success"></i> Figures match' : '<span class="text-danger fw-semibold"><i class="bi bi-x-circle"></i> Figures do not match</span>'; }
};

/* ============================================================
   Screens
   ============================================================ */

Object.assign(Views, {

  /* ---------- Operations ---------- */
  ops(){
    const alerts = OpsReg.alerts();
    const rows = OpsReg.tenants().map(t => OpsReg.health(t));
    const e = OpsReg.epiHealth();
    const ico = { danger:'bi-x-circle text-danger', warn:'bi-exclamation-triangle text-warning', info:'bi-info-circle text-primary' };
    const nav = { ops:'', opsIncidents:'Incidents', opsService:'Service Status', opsClients:'Client Accounts', opsRequests:'BIR Requests', opsBilling:'EPI Billing', opsReports:'Reports to the BIR' };

    return `
      ${OpsUI.head('Operations', 'Every client account at a glance: what needs attention and whether each account\'s figures tie. Counts and totals only; no client\'s buyers or line items are shown in this console.')}

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">ALERTS</strong>
        ${alerts.length ? alerts.map(a => `
          <div class="d-flex gap-2 align-items-start fs_13 py-1 border-bottom">
            <i class="bi ${ico[a.level]} mt-1"></i>
            <div class="flex-grow-1${a.level === 'danger' ? ' fw-semibold' : ''}">${esc(a.text)}</div>
            ${nav[a.go] ? `<span class="hyperlink fs_12 text-nowrap" onclick="Nav.go('${a.go}')">${esc(nav[a.go])}</span>` : ''}
          </div>`).join('')
          : '<div class="fs_13 text-success"><i class="bi bi-check-circle me-1"></i>No alerts.</div>'}
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">ACCOUNTS</strong>
        <div class="fs_12 text-muted mb-2">"Figures match" means issued = acknowledged + waiting + cancelled before sending, in pesos and in invoices. Each client sees the same check on Invoices, on the Sent to BIR tab. Computed when this page was opened.</div>
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>ACCOUNT</th><th>STATUS</th><th class="text-end">DOCUMENTS</th><th class="text-end">WAITING</th><th class="text-end">FAILED / REJECTED</th><th>RECONCILES</th><th>CHECKS</th><th>LAST ACKNOWLEDGED</th></tr></thead>
          <tbody>
            ${rows.map(h => `
            <tr>
              <td><div class="fw-semibold">${esc(h.t.name)}</div><div class="fs_11 text-muted mono">${esc(h.t.tin)}</div></td>
              <td>${OpsReg.statusBadge(h.t)}</td>
              <td class="text-end mono">${h.docs}</td>
              <td class="text-end mono">${h.queued || '—'}</td>
              <td class="text-end mono ${h.failed + h.rejected ? 'text-danger' : ''}">${h.failed + h.rejected || '—'}</td>
              <td class="text-nowrap">${OpsUI.tie(h.ties)}</td>
              <td class="fs_12">${h.dups ? `<span class="text-danger">${h.dups} duplicate</span>` : 'No duplicates'}${h.manualOpen ? `<div class="text-warning">${h.manualOpen} manual, not issued</div>` : ''}</td>
              <td class="fs_12">${h.lastAck ? esc(fmtDateTime(h.lastAck)) : '—'}</td>
            </tr>`).join('')}
            <tr class="text-muted">
              <td><div class="fw-semibold">EPI's own invoices</div><div class="fs_11 mono">${esc(SYSTEM.taxpayer.tin)}</div></td>
              <td></td>
              <td class="text-end mono">${e.docs}</td>
              <td class="text-end mono">${e.queued || '—'}</td>
              <td class="text-end mono ${e.failed + e.rejected ? 'text-danger' : ''}">${e.failed + e.rejected || '—'}</td>
              <td class="text-nowrap">${OpsUI.tie(e.ties)}</td>
              <td></td><td></td>
            </tr>
          </tbody>
        </table></div>
      </div></div>`;
  },

  /* ---------- Service status ---------- */
  opsService(opts){
    const p = OpsReg.period(opts && opts.period);
    const int = activeInterruption();
    const ints = interruptions().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const reps = (Store.db.problemReports || []).slice().sort((a, b) =>
      (a.status === 'UNDER_REVIEW' ? 0 : 1) - (b.status === 'UNDER_REVIEW' ? 0 : 1) || new Date(b.reportedAt) - new Date(a.reportedAt));
    const m = OpsReg.metrics(p);
    const pctTxt = v => v === null ? '—' : `${v}%`;
    const tile = (label, value, note) => `
      <div class="col-6 col-lg-3"><div class="border rounded-3 p-3 h-100">
        <span class="stat-label">${label}</span>
        <div class="fs_18 fw-bold mono mt-1">${value}</div>
        <div class="fs_11 text-muted">${note}</div>
      </div></div>`;

    return `
      ${OpsUI.head('Service Status', 'Interruptions, problem reports from clients, and how the service performed.')}

      <div class="lcard mb-3"><div class="lcard-body">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <strong class="fs_13 text-secondary fw-bold d-block">INTERRUPTIONS</strong>
            <div class="fs_12 text-muted">Declaring a BIR EIS or API interruption holds every send to the BIR on all accounts. Declaring EPI downtime also holds clients' new sales as waiting sales. Closing it issues the waiting sales, sends the buyer copies and resends the held invoices. Only a verified interruption can be the cause on a certificate.</div>
          </div>
          ${int ? `<button class="lbtn lbtn-sm lbtn-accent button_ops_int_end">Close ${esc(int.ref)}</button>` : `
          <div class="d-flex flex-wrap gap-2 align-items-center">
            <select class="form-select form-select-sm select_ops_int_source" style="width:auto">
              ${Object.keys(INTERRUPTION_SOURCES).map(k => `<option value="${k}">${esc(INTERRUPTION_SOURCES[k].label)}</option>`).join('')}
            </select>
            <input type="text" class="form-control form-control-sm input_ops_int_note" style="width:220px" maxlength="300" placeholder="What is happening">
            <button class="lbtn lbtn-sm lbtn-ghost button_ops_int_start">Declare</button>
          </div>`}
        </div>
        ${ints.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>REFERENCE</th><th>WHAT</th><th>FROM</th><th>TO</th><th>LENGTH</th><th>DECLARED BY</th><th>VERIFIED</th></tr></thead>
          <tbody>${ints.map(x => `
            <tr><td class="mono text-nowrap">${esc(x.ref)}${(() => { const i = IncReg.forInterruption(x.id); return i ? `<div class="fs_11"><span class="hyperlink" onclick="Nav.go('opsIncidents', { id:'${i.id}' })">${esc(i.ref)}</span></div>` : ''; })()}</td>
              <td>${esc(INTERRUPTION_SOURCES[x.source].label)}${x.note ? `<div class="fs_11 text-muted">${esc(x.note)}</div>` : ''}</td>
              <td>${esc(fmtDateTime(x.startedAt))}</td>
              <td>${x.endedAt ? esc(fmtDateTime(x.endedAt)) : '<span class="lbadge lbadge-red lbadge-dot">Open</span>'}</td>
              <td>${esc(ResReg.hLabel(ResReg.hours(x.startedAt, x.endedAt || new Date().toISOString())))}</td>
              <td>${esc(x.declaredBy || '—')}</td>
              <td>${x.verified ? `<span class="lbadge lbadge-green">Verified</span>${x.verifyNote ? `<div class="fs_11 text-muted">${esc(x.verifyNote)}</div>` : ''}`
                : `<button class="lbtn lbtn-sm lbtn-ghost button_ops_verify" data-id="${x.id}">Verify</button>`}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="fs_13 text-muted">None.</div>'}
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">PROBLEM REPORTS</strong>
        <div class="fs_12 text-muted mb-2">Filed by clients from Invoices, on the Sent to BIR tab. Review re-runs the three checks on current records. The certificate is issued only if all three pass.</div>
        ${reps.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>REPORT</th><th>ACCOUNT</th><th>FILED</th><th>WHAT</th><th class="text-end">DOCUMENTS</th><th>OUTCOME</th></tr></thead>
          <tbody>${reps.map(r => `
            <tr><td class="mono text-nowrap">${esc(r.ref)}</td><td>${esc(OpsReg.tenantName(r.tenantId))}</td>
              <td>${esc(fmtDateTime(r.reportedAt))}</td><td>${esc(ResReg.KINDS[r.kind])}</td>
              <td class="text-end mono">${r.docIds.length}</td>
              <td>${r.status === 'UNDER_REVIEW' ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_review" data-id="${r.id}">Review</button>`
                : r.certificate ? `<span class="mono">${esc(r.certificate.ref)}</span><div class="fs_11 text-muted">by ${esc((r.review || {}).by || '—')}</div>`
                : `No certificate<div class="fs_11 text-muted">by ${esc((r.review || {}).by || '—')}</div>`}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="fs_13 text-muted">No problems reported.</div>'}
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <strong class="fs_13 text-secondary fw-bold d-block">SERVICE LEVELS</strong>
            <div class="fs_12 text-muted">Client invoices and EPI's own. ${esc(m.targets)}</div>
          </div>
          ${OpsUI.periodSelect('select_ops_sla_period', p.key)}
        </div>
        <div class="row g-2">
          ${tile('EPI available', pctTxt(m.availability.epi), 'EPI downtime only')}
          ${tile('BIR EIS reachable', pctTxt(m.availability.birEis), `API ${pctTxt(m.availability.api)}`)}
          ${tile('Acknowledgment time', OpsReg.secs(m.ackSeconds.median), `Median. 95th percentile ${OpsReg.secs(m.ackSeconds.p95)}`)}
          ${tile('Sent within the BIR limit', `${m.sentWithinLimit.count} / ${m.sentWithinLimit.of}`, `${m.sentWithinLimit.limitDays} calendar days from the sale. ${m.sentWithinLimit.overdueOpen} still waiting past it, ${m.sentWithinLimit.late} sent late`)}
          ${tile('Acknowledged within 1 hour', `${m.ackedInTime.count} / ${m.ackedInTime.of}`, `EPI's own target of ${m.ackedInTime.thresholdHours} h`)}
          ${tile('Delayed, provider', m.delayedByCause.provider, 'Traced to a verified interruption')}
          ${tile('Delayed, other', m.delayedByCause.taxpayerData + m.delayedByCause.notSent, `${m.delayedByCause.taxpayerData} data fault, ${m.delayedByCause.notSent} not sent`)}
          ${tile('BIR requests on time', `${m.birRequests.metOnTime} / ${m.birRequests.count}`, `${m.birRequests.open} still open`)}
          ${tile('Incident reports on time', `${m.incidents.writtenOnTime} / ${m.incidents.critical}`, 'Written report to the BIR within 24 h')}
          ${tile('Problem reports', `${m.problemReports.reviewed} / ${m.problemReports.count}`, `Reviewed. ${m.problemReports.certificates} certificate(s)`)}
        </div>
      </div></div>`;
  },

  /* ---------- Client accounts ---------- */
  opsClients(){
    const db = Store.db;
    const ts = OpsReg.tenants();
    const apps = (db.onboardingApps || []).slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    return `
      ${OpsUI.head('Client Accounts', 'Every taxpayer EPI serves. Applications and activation reviews are on the Onboarding screen.')}

        <div class="lcard"><div class="lcard-body">
          <div class="fs_12 text-muted mb-2">A suspended account is read-only. All records stay viewable and exportable. Unpaid fees are not a ground for suspension.</div>
          <div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>ACCOUNT</th><th>REGISTRATION</th><th>COVERAGE</th><th>ACTIVE SINCE</th><th>PERMIT TO ISSUE</th><th class="text-end">USERS</th><th>STATUS</th><th></th></tr></thead>
            <tbody>${ts.map(t => {
              const c = coverage(t), ps = PTI_STATES[ptiStatus(t)], st = accountStatus(t);
              return `
              <tr>
                <td><div class="fw-semibold">${esc(t.name)}</div><div class="fs_11 text-muted mono">${esc(t.tin)}</div>
                  ${AppReg.authorityState(t) ? `<div class="fs_11 text-danger">Authority ${AppReg.authorityState(t) === 'EXPIRED' ? 'expired' : 'expires'} ${esc(fmtDate(t.authority.expiresAt))}</div>` : ''}</td>
                <td>${t.lane === 'ENTERPRISE' ? 'Enterprise' : 'Express'}</td>
                <td>${esc(OpsReg.OUTCOMES[c.outcome] || c.outcome)}<div class="fs_11 text-muted">${esc(c.basis.label)}</div></td>
                <td>${t.goLiveAt ? esc(fmtDate(t.goLiveAt)) : '—'}</td>
                <td><span class="lbadge lbadge-${ps.tone}">${esc(ps.label)}</span>${t.pti ? `<div class="fs_11 text-muted mono">${esc(t.pti)}</div>` : ''}
                  ${t.pti && !t.isProvider ? `<div class="fs_11 mt-1">EIS: <span class="lbadge lbadge-${eisInfo(t).tone}">${esc(eisInfo(t).label)}</span></div>` : ''}</td>
                <td class="text-end mono">${db.users.filter(u => u.tenantId === t.id && u.active).length}</td>
                <td>${OpsReg.statusBadge(t)}${st === 'SUSPENDED' && t.suspension ? `<div class="fs_11 text-muted">${esc(OpsReg.SUSPEND_REASONS[t.suspension.reason])}</div>` : ''}</td>
                <td class="text-end text-nowrap">${t.representative ? `<button class="lbtn lbtn-sm lbtn-ghost button_ops_swaprep me-1" data-id="${t.id}">Replace representative</button>` : ''}${st === 'ACTIVE'
                  ? `<button class="lbtn lbtn-sm lbtn-ghost button_ops_suspend" data-id="${t.id}">Suspend</button>`
                  : `<button class="lbtn lbtn-sm lbtn-ghost button_ops_reopen" data-id="${t.id}">Reopen</button>`}</td>
              </tr>`; }).join('')}
            </tbody></table></div>
        </div></div>
`;
  },

  /* ---------- Onboarding ---------- */
  opsOnboarding(){
    const db = Store.db;
    const ts = OpsReg.tenants();
    const apps = (db.onboardingApps || []).slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const ptiQ = ts.filter(t => ptiStatus(t) !== 'ISSUED');
    const toReview = apps.filter(a => a.status === 'PENDING_VERIFICATION' || (a.stage === 'GOLIVE_REVIEW' && !a.activatedAt)).length + (db.repRequests || []).filter(r => r.status === 'PENDING').length;
    const appBadge = a => {
      const st = AppReg.STATUS[a.status] || { label:a.status, tone:'gray' };
      const sub = a.status === 'ACCEPTED'
        ? (a.activatedAt ? 'Active' : a.stage === 'GOLIVE_REVIEW' ? 'Activation review' : a.ownerToken && Store.db.users.some(u => u.inviteToken === a.ownerToken && u.status === 'INVITED') ? 'Password not set' : 'Setting up')
        : a.status === 'DECLINED' ? a.declineReason : a.status === 'NEEDS_INFO' ? 'Waiting for the reply' : '';
      return `<span class="lbadge lbadge-${st.tone}">${esc(st.label)}</span>${sub ? `<div class="fs_11 text-muted">${esc(sub)}</div>` : ''}`;
    };
    const ckIcons = a => ['legal', 'coverage', 'authority'].map(k => {
      const c = (a.checks || {})[k], lbl = { legal:'Legal existence', coverage:'Coverage', authority:'Authority' }[k];
      return `<i class="bi ${c && c.ok ? 'bi-check-circle-fill text-success' : 'bi-circle text-muted'} me-1" title="${lbl}${c && c.ok ? ': ' + esc(c.note) : ': not checked'}" aria-label="${lbl}"></i>`;
    }).join('');

    return `
      ${OpsUI.head('Onboarding', 'Every application from the first form to activation: where each client is, who it is waiting on, and what EPI has to do next.')}

      ${OnboardViews.board()}


        <div class="lcard mb-3"><div class="lcard-body">
          <strong class="fs_13 text-secondary fw-bold d-block mb-1">APPLICATIONS</strong>
          <div class="fs_12 text-muted mb-2">Before accepting a client, EPI checks that it legally exists, that it is required to issue e-invoices by ${esc(complianceDeadline())}, and that the applicant can act for it. Every application is answered within ${AppReg.TURNAROUND_DAYS} working days.</div>
          ${apps.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>APPLICANT</th><th>APPLIED AS</th><th>SUBMITTED</th><th>ANSWER DUE</th><th>CHECKS</th><th>STATUS</th><th></th></tr></thead>
            <tbody>${apps.map(a => `
              <tr>
                <td style="min-width:160px"><div class="fw-semibold">${esc(a.tenantName)}</div><div class="fs_11 text-muted mono text-nowrap">${esc(a.tin)}</div><div class="fs_11 text-muted mono text-nowrap">${esc(a.ref)}</div></td>
                <td>${esc((ENTITY_TYPES[a.entity] || {}).label || '—')}<div class="fs_11 text-muted">${a.authority ? 'Authorized representative' : 'Signatory'}</div></td>
                <td>${esc(fmtDate(a.submittedAt))}</td>
                <td>${a.status === 'PENDING_VERIFICATION'
                  ? `${esc(fmtDate(a.dueAt))}${AppReg.overdue(a) ? ' <span class="lbadge lbadge-red">Overdue</span>' : ''}`
                  : a.status === 'NEEDS_INFO' ? `<span class="text-muted">Paused. Reply by ${esc(fmtDate(AppReg.replyBy(a)))}</span>`
                  : `<span class="text-muted">Decided ${esc(fmtDate(a.reviewedAt))}</span>`}</td>
                <td class="text-nowrap">${ckIcons(a)}</td>
                <td>${appBadge(a)}</td>
                <td class="text-end text-nowrap">${a.status === 'PENDING_VERIFICATION'
                  ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_app" data-id="${a.id}">Review</button>`
                  : a.stage === 'GOLIVE_REVIEW' && !a.activatedAt
                  ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_golive" data-id="${a.id}">Review activation</button>` : ''}</td>
              </tr>`).join('')}
            </tbody></table></div>` : '<div class="fs_13 text-muted">No applications.</div>'}
        </div></div>

        ${(() => {
          const reqs = (db.repRequests || []).filter(r => r.status !== 'CANCELLED').sort((x, y) => new Date(y.at) - new Date(x.at));
          if (!reqs.length) return '';
          const tone = { PENDING:'amber', APPROVED:'green', DECLINED:'gray' }, lbl = { PENDING:'To review', APPROVED:'Approved', DECLINED:'Declined' };
          return `<div class="lcard mb-3"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-1">REPRESENTATIVE CHANGES</strong>
            <div class="fs_12 text-muted mb-2">A client asks to replace its authorized representative. The change takes effect only after EPI validates the new authority document.</div>
            <div class="table-responsive"><table class="table fs_13 mb-0">
              <thead><tr><th>ACCOUNT</th><th>NEW REPRESENTATIVE</th><th>CURRENT</th><th>REQUESTED</th><th>STATUS</th><th></th></tr></thead>
              <tbody>${reqs.map(r => { const t = OpsReg.tenant(r.tenantId) || {}; return `
                <tr><td>${esc(t.name || '—')}</td>
                  <td><div class="fw-semibold">${esc(r.name)}</div><div class="fs_11 text-muted">${esc(r.position)} · ${esc(r.email)}</div></td>
                  <td>${t.representative ? esc(t.representative.name) : '<span class="text-muted">None</span>'}</td>
                  <td>${esc(fmtDate(r.at))}<div class="fs_11 text-muted">by ${esc(r.by)}</div></td>
                  <td><span class="lbadge lbadge-${tone[r.status]}">${lbl[r.status]}</span>${r.note ? `<div class="fs_11 text-muted">${esc(r.note)}</div>` : ''}</td>
                  <td class="text-end">${r.status === 'PENDING' ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_repreq" data-id="${r.id}">Review</button>` : ''}</td></tr>`; }).join('')}
              </tbody></table></div>
          </div></div>`;
        })()}

        ${PayViews.opsPlanQueue()}

        <div class="lcard"><div class="lcard-body">
          <strong class="fs_13 text-secondary fw-bold d-block mb-1">PERMITS TO ISSUE PENDING</strong>
          <div class="fs_12 text-muted mb-2">A client can issue invoices once the BIR issues its own permit. EPI files it only on the taxpayer's written authorization.</div>
          ${ptiQ.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>ACCOUNT</th><th>STATUS</th><th>FILED</th><th></th></tr></thead>
            <tbody>${ptiQ.map(t => { const s = ptiStatus(t); return `
              <tr><td>${esc(t.name)}</td>
                <td><span class="lbadge lbadge-${PTI_STATES[s].tone}">${esc(PTI_STATES[s].label)}</span></td>
                <td>${t.ptiAppliedAt ? esc(fmtDate(t.ptiAppliedAt)) : 'Waiting for the taxpayer\'s authorization'}</td>
                <td class="text-end">${s === 'APPLIED' ? `<button class="lbtn lbtn-sm lbtn-ghost button_ops_pti" data-id="${t.id}">Demo: BIR issued it</button>` : ''}</td></tr>`; }).join('')}
            </tbody></table></div>` : '<div class="fs_13 text-muted">Every account holds its permit.</div>'}
        </div></div>
      `;
  },

  /* ---------- BIR requests ---------- */
  opsRequests(opts){
    const all = (Store.db.dataRequests || []).slice();
    const showAll = opts && opts.all;
    const list = all.filter(r => showAll || !r.fulfilledAt)
      .sort((a, b) => (a.fulfilledAt ? 1 : 0) - (b.fulfilledAt ? 1 : 0) || new Date(a.dueAt) - new Date(b.dueAt));
    const state = r => {
      if (r.fulfilledAt) return new Date(r.fulfilledAt) <= new Date(r.dueAt)
        ? '<span class="lbadge lbadge-green">Met on time</span>' : '<span class="lbadge lbadge-amber">Met late</span>';
      return new Date(r.dueAt) < new Date() ? '<span class="lbadge lbadge-red">Overdue</span>' : '<span class="lbadge lbadge-amber">In progress</span>';
    };
    return `
      ${OpsUI.head('BIR Requests', 'What BIR examiners have asked for, across every account. A summary is due in 1 working day and is ready at once; a data extract is due in 3 and is prepared here. Weekends are skipped; holidays are not modelled.')}
      <div class="lcard"><div class="lcard-body">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong class="fs_13 text-secondary fw-bold">${showAll ? 'ALL REQUESTS' : 'OPEN REQUESTS'}</strong>
          <span class="hyperlink fs_12" onclick="Nav.go('opsRequests', { all:${showAll ? 'false' : 'true'} })">${showAll ? 'Show open only' : `Show all (${all.length})`}</span>
        </div>
        ${list.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>REQUESTED</th><th>ACCOUNT</th><th>TYPE</th><th>SCOPE</th><th>BY</th><th>DUE</th><th>STATUS</th><th></th></tr></thead>
          <tbody>${list.map(r => `
            <tr><td>${esc(fmtDateTime(r.requestedAt))}</td><td>${esc(OpsReg.tenantName(r.tenantId))}</td>
              <td>${esc(RecordsReg.TYPES[r.type].label)}</td><td>${esc(r.scope)}</td><td>${esc(r.requestedBy)}</td>
              <td>${r.fulfilledAt ? `Ready ${esc(fmtDateTime(r.fulfilledAt))}` : esc(fmtDateTime(r.dueAt))}</td>
              <td>${state(r)}</td>
              <td class="text-end">${r.fulfilledAt ? '' : `<button class="lbtn lbtn-sm lbtn-primary button_ops_ready" data-id="${r.id}">Mark ready</button>`}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="fs_13 text-muted">No open requests.</div>'}
      </div></div>`;
  },

  /* ---------- Reports to the BIR ---------- */
  opsReports(opts){
    const p = OpsReg.period(opts && opts.period);
    const cert = espCertState(), c = SYSTEM.certificates;
    return `
      ${OpsUI.head('Reports to the BIR', 'The periodic reports an accredited ESP submits. Built from the system\'s own records for the period chosen. The BIR has not prescribed a layout, so each is plain JSON with clearly named fields.',
        OpsUI.periodSelect('select_ops_rep_period', p.key))}

      <div class="lcard mb-3"><div class="lcard-body">
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>REPORT</th><th>WHAT IT HOLDS</th><th>${esc(p.label.toUpperCase())}</th><th></th></tr></thead>
          <tbody>${Object.keys(OpsReg.REPORTS).map(k => `
            <tr><td class="fw-semibold text-nowrap">${esc(OpsReg.REPORTS[k].label)}</td>
              <td class="fs_12 text-muted">${esc(OpsReg.REPORTS[k].holds)}</td>
              <td class="fs_12">${esc(OpsReg.report(k, p).headline)}</td>
              <td class="text-end"><button class="lbtn lbtn-sm lbtn-ghost button_ops_rep" data-kind="${k}">Download</button></td></tr>`).join('')}
          </tbody></table></div>
        <button class="lbtn lbtn-sm lbtn-primary mt-3 button_ops_rep_all">Download all seven</button>
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">ACCREDITATION</strong>
        <dl class="dl mb-0">
          <dt>ESP certificate</dt><dd class="mono">${esc(c.esp.no)} <span class="text-muted fs_12">valid to ${esc(fmtDate(c.esp.validUntil))}${cert.renewalOpen ? ', renewal window open' : `, renew by ${esc(fmtDate(new Date(new Date(c.esp.validUntil).getTime() - 60 * 864e5).toISOString()))}`}</span></dd>
          <dt>System certificate</dt><dd class="mono">${esc(c.system.no)}</dd>
          <dt>Permit to Transmit</dt><dd class="mono">${esc(c.ptt.no)}</dd>
        </dl>
        <div class="fs_11 text-muted mt-2">Illustrative numbers. Demonstration system, not yet accredited.</div>
      </div></div>`;
  },

  /* ---------- EPI billing ---------- */
  opsBilling(opts){
    if (opts && opts.docId) return Views.opsBillingDoc(opts.docId);
    const db = Store.db;
    const docs = OpsReg.epiDocs().sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
    const due = OpsReg.tenants().map(t => ({ t, k:BillingReg.nextPeriod(db, t) })).filter(x => x.k);
    const open = docs.filter(i => i.paymentStatus !== 'PAID');
    const sum = l => round2(l.reduce((a, i) => a + i.totals.totalDue, 0));
    const overdue = open.filter(i => BillingReg.payState(i).key === 'OVERDUE');
    const months = OpsReg.salesByMonth();
    const e = OpsReg.epiHealth();
    const allDocs = OpsReg.epiAllDocs();
    const waiting = docs.filter(i => i.transmissionStatus !== 'TRANSMITTED');
    const waitingAll = allDocs.filter(i => ['QUEUED', 'FAILED', 'REJECTED'].indexOf(i.transmissionStatus) > -1);
    const sendable = allDocs.filter(i => i.transmissionStatus !== 'NOT_READY');
    const runLabel = due.length ? `Run billing (${[...new Set(due.map(x => BillingReg.label(x.k)))].join(', ')})` : 'Run billing';

    /* Quarter subtotals for the VAT return. */
    const qRows = [];
    months.forEach((m, i) => {
      qRows.push(`<tr><td>${esc(BillingReg.label(m.key))}</td><td class="text-end mono">${m.count}</td><td class="text-end mono">${m.sys}</td>
        <td class="text-end mono">${num(m.vatable)}</td><td class="text-end mono">${num(m.exempt)}</td><td class="text-end mono">${num(m.zero)}</td><td class="text-end mono">${num(m.vat)}</td><td class="text-end mono">${num(m.total)}</td></tr>`);
      const [y, mo] = m.key.split('-').map(Number), q = Math.ceil(mo / 3);
      const nextSameQ = months[i + 1] && Math.ceil(Number(months[i + 1].key.split('-')[1]) / 3) === q && months[i + 1].key.startsWith(String(y));
      if (!nextSameQ){
        const inQ = months.filter(x => x.key.startsWith(String(y)) && Math.ceil(Number(x.key.split('-')[1]) / 3) === q);
        const t = f => round2(inQ.reduce((a, x) => a + x[f], 0));
        qRows.push(`<tr class="fw-semibold"><td>Q${q} ${y}</td><td class="text-end mono">${inQ.reduce((a, x) => a + x.count, 0)}</td><td class="text-end mono">${inQ.reduce((a, x) => a + x.sys, 0)}</td>
          <td class="text-end mono">${num(t('vatable'))}</td><td class="text-end mono">${num(t('exempt'))}</td><td class="text-end mono">${num(t('zero'))}</td><td class="text-end mono">${num(t('vat'))}</td><td class="text-end mono">${num(t('total'))}</td></tr>`);
      }
    });

    return `
      ${OpsUI.head('EPI Billing', 'EPI\'s own invoices to its clients. These are EPI\'s sales: they are reported to the BIR as EPI\'s, and never include what clients sell to their customers.',
        `<button class="lbtn lbtn-sm lbtn-primary button_ops_bill_run"${due.length ? '' : ' disabled'}>${esc(runLabel)}</button>`)}

      <div class="row g-2 mb-3">
        <div class="col-12 col-md-4"><div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">Unpaid</span><span class="stat-value mono d-block">${peso(sum(open))}</span>
          <span class="stat-note">${open.length} invoice(s)</span></div></div></div>
        <div class="col-12 col-md-4"><div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">Overdue</span><span class="stat-value mono d-block ${overdue.length ? 'text-danger' : ''}">${peso(sum(overdue))}</span>
          <span class="stat-note">Never a reason to limit a client's access</span></div></div></div>
        <div class="col-12 col-md-4"><div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">Reported to the BIR</span><span class="stat-value mono d-block">${sendable.length - waitingAll.length} / ${sendable.length}</span>
          <span class="stat-note">${OpsUI.tie(e.ties)}</span></div></div></div>
      </div>

      <div class="d-flex gap-2 mb-3 overflow_x_scroll">
        <div class="tab_button tab_button_ops_bill_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">INVOICES</div>
        <div class="tab_button tab_button_ops_bill_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SALES SUMMARY</div>
        <div class="tab_button tab_button_ops_bill_3 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">TRANSMISSION${waitingAll.length ? ` (${waitingAll.length})` : ''}</div>
        <div class="tab_button tab_button_ops_bill_4 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SAFETY DEPOSITS</div>
        <div class="tab_button tab_button_ops_bill_5 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">REAL-TIME FEES</div>
        <div class="tab_button tab_button_ops_bill_6 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">PROVIDER SETTLEMENT</div>
      </div>

      <div class="tab_content tab_content_ops_bill_1">
        <div class="lcard"><div class="lcard-body">
          <div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>INVOICE</th><th>CLIENT</th><th>FOR</th><th>ISSUED</th><th class="text-end">TOTAL (VAT INCL.)</th><th>PAYMENT</th><th></th></tr></thead>
            <tbody>${docs.map(i => { const ps = BillingReg.payState(i); return `
              <tr><td><span class="hyperlink fw-semibold mono" onclick="Nav.go('opsBilling', { docId:'${esc(i.id)}' })">${esc(i.number)}</span></td>
                <td>${esc(OpsReg.tenantName(i.clientId))}</td><td>${esc(BillingReg.label(i.period))}</td>
                <td>${esc(fmtDate(i.issuedAt))}</td><td class="text-end mono">${num(i.totals.totalDue)}</td>
                <td><span class="lbadge ${ps.cls} lbadge-dot">${esc(ps.label)}</span>${i.paymentRef ? `<div class="fs_11 text-muted mono">${esc(i.paymentRef)}</div>` : ''}</td>
                <td class="text-end">${i.paymentStatus === 'PAID' ? '' : i.paymentSubmitted
                  ? `<button class="lbtn lbtn-sm lbtn-primary button_ops_review_pay" data-id="${i.id}">Review payment</button>`
                  : `<button class="lbtn lbtn-sm lbtn-ghost button_ops_paid" data-id="${i.id}">Record payment</button>`}</td></tr>`; }).join('')}
            </tbody></table></div>
        </div></div>
      </div>

      <div class="tab_content tab_content_ops_bill_2 d-none">
        <div class="lcard"><div class="lcard-body">
          <div class="fs_12 text-muted mb-2">EPI's output VAT for its own returns, by month and quarter. It counts every invoice EPI issues: printing sales and the System invoices listed under Invoices.</div>
          <div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>MONTH</th><th class="text-end">INVOICES</th><th class="text-end">OF WHICH SYSTEM</th><th class="text-end">VATABLE SALES</th><th class="text-end">VAT-EXEMPT</th><th class="text-end">ZERO-RATED</th><th class="text-end">OUTPUT VAT</th><th class="text-end">TOTAL</th></tr></thead>
            <tbody>${qRows.join('')}</tbody></table></div>
        </div></div>
      </div>

      <div class="tab_content tab_content_ops_bill_5 d-none">
        ${FeeViews.opsPanel()}
      </div>

      <div class="tab_content tab_content_ops_bill_6 d-none">
        ${SettleViews.opsPanel()}
      </div>

      <div class="tab_content tab_content_ops_bill_4 d-none">
        ${DepositViews.opsPanel()}
      </div>

      <div class="tab_content tab_content_ops_bill_3 d-none">
        <div class="lcard"><div class="lcard-body">
          <div class="fs_12 ${e.ties ? 'text-muted' : 'text-danger'} mb-2">
            <strong class="text-dark mono">${num(e.r.issuedAmt)}</strong> issued = <strong class="text-dark mono">${num(e.r.ackAmt)}</strong> acknowledged
            + <strong class="text-dark mono">${num(e.r.waitingAmt)}</strong> waiting + <strong class="text-dark mono">${num(e.r.notGoingAmt)}</strong> cancelled before sending
          </div>
          ${waitingAll.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
            <thead><tr><th>INVOICE</th><th>CUSTOMER</th><th>STATUS</th><th>ATTEMPTS</th><th></th></tr></thead>
            <tbody>${waitingAll.map(i => `
              <tr><td class="mono">${esc(i.number)}</td><td>${esc(i.clientId ? OpsReg.tenantName(i.clientId) : (i.buyer && i.buyer.name) || '—')}</td>
                <td>${badge('transmission', i.transmissionStatus)}${i.transmissionError ? `<div class="fs_11 text-muted">${esc(i.transmissionError)}</div>` : ''}</td>
                <td class="mono">${transmissionAttempts(i).length}</td>
                <td class="text-end">${i.transmissionStatus === 'QUEUED' ? '<span class="fs_12 text-muted">Retries by itself</span>'
                  : `<button class="lbtn lbtn-sm lbtn-ghost button_ops_epi_send" data-id="${i.id}">Send again</button>`}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="fs_13 text-success"><i class="bi bi-check-circle me-1"></i>Every EPI invoice has been acknowledged by the BIR.</div>'}
        </div></div>
      </div>`;
  },

  opsBillingDoc(id){
    const inv = OpsReg.epiDocs().find(i => i.id === id);
    if (!inv) return '<div class="p-4">That invoice was not found.</div>';
    return `
      ${OpsUI.head(`<span class="mono">${esc(inv.number)}</span>`, `EPI's invoice to ${esc(OpsReg.tenantName(inv.clientId))} for ${esc(BillingReg.label(inv.period))}.`, `
        <div class="d-flex gap-2">
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('opsBilling')">Back</button>
          <button class="lbtn lbtn-sm lbtn-accent" onclick="InvoiceDoc.print('${esc(inv.id)}')"><i class="bi bi-printer me-1"></i>Print</button>
        </div>`)}
      ${FeeViews.statement(inv)}
      <div class="lcard"><div class="lcard-body">${InvoiceDoc.render(inv)}</div></div>`;
  },

  /* ---------- EPI staff ---------- */
  opsStaff(){
    const db = Store.db;
    const staff = db.users.filter(u => u.roleKey === 'EPI_OPERATOR');
    const lastIn = u => { const a = (db.activity || []).find(x => x.actorName === u.name && /^Signed in/.test(x.action)); return a ? a.at : null; };
    return `
      ${OpsUI.head('EPI Staff', 'The people who run the service and can sign in to this console. EPI keeps qualified technical, security, compliance, privacy and taxpayer-support staff.')}

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">FUNCTIONS COVERED</strong>
        ${Object.keys(OpsReg.STAFF_FUNCTIONS).map(k => {
          const who = staff.filter(u => u.active && u.staffFunction === k);
          return OpsUI.checkRow(who.length > 0, OpsReg.STAFF_FUNCTIONS[k], who.length ? who.map(u => u.name).join(', ') : 'Nobody is assigned');
        }).join('')}
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>NAME</th><th>POSITION</th><th>FUNCTION</th><th>EMAIL</th><th>LAST SIGNED IN</th></tr></thead>
          <tbody>${staff.map(u => { const at = lastIn(u); return `
            <tr><td class="fw-semibold">${esc(u.name)}</td><td>${esc(u.position)}</td>
              <td>${esc(OpsReg.STAFF_FUNCTIONS[u.staffFunction] || '—')}</td><td class="fs_12">${esc(u.email)}</td>
              <td class="fs_12">${at ? esc(fmtDateTime(at)) : '—'}</td></tr>`; }).join('')}
          </tbody></table></div>
      </div></div>`;
  },

  /* ---------- Audit log ---------- */
  opsAudit(opts){
    opts = opts || {};
    const acc = opts.account || 'ALL', who = opts.who || 'ALL';
    const WHO = { ALL:'Everyone', EPI:'EPI staff', BIR:'BIR examiners', USER:'Client users', SYSTEM:'Integrations' };
    const rows = Views._auditRows(acc, who);
    return `
      ${OpsUI.head('Audit Log', `Every recorded action, on every account and in this console. Entries are written once and never edited. Time source: ${esc(SYSTEM.timeSync.source)}, offset ${SYSTEM.timeSync.offsetMs} ms.`,
        '<button class="lbtn lbtn-sm lbtn-ghost button_ops_audit_csv">Download (CSV)</button>')}
      <div class="lcard"><div class="lcard-body">
        <div class="d-flex flex-wrap gap-2 mb-3">
          <select class="form-select form-select-sm select_ops_audit_account" style="width:auto">
            <option value="ALL"${acc === 'ALL' ? ' selected' : ''}>All accounts</option>
            <option value="EPI"${acc === 'EPI' ? ' selected' : ''}>EPI (this console)</option>
            ${OpsReg.tenants().map(t => `<option value="${t.id}"${acc === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <select class="form-select form-select-sm select_ops_audit_who" style="width:auto">
            ${Object.keys(WHO).map(k => `<option value="${k}"${who === k ? ' selected' : ''}>${esc(WHO[k])}</option>`).join('')}
          </select>
          <span class="fs_12 text-muted align-self-center">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}${rows.length > 300 ? ', newest 300 shown' : ''}</span>
        </div>
        ${rows.length ? `<div class="table-responsive"><table class="table fs_12 mb-0">
          <thead><tr><th>TIME</th><th>ACCOUNT</th><th>WHO</th><th>ROLE</th><th>ACTION</th></tr></thead>
          <tbody>${rows.slice(0, 300).map(a => `
            <tr><td class="text-nowrap">${esc(fmtDateTime(a.at))}</td>
              <td>${a.tenantId ? esc(OpsReg.tenantName(a.tenantId)) : '<span class="text-muted">EPI</span>'}</td>
              <td>${esc(a.actorName)}</td><td>${esc((ROLES[a.role] && ROLES[a.role].short) || a.role || '—')}</td>
              <td>${esc(a.action)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="fs_13 text-muted">Nothing matches.</div>'}
      </div></div>`;
  },

  _auditRows(acc, who){
    return (Store.db.activity || []).filter(a => {
      if (acc === 'EPI' && a.tenantId) return false;
      if (acc !== 'ALL' && acc !== 'EPI' && a.tenantId !== acc) return false;
      if (who === 'EPI' && a.actorType !== 'EPI') return false;
      if (who === 'BIR' && a.role !== 'BIR_EXAMINER') return false;
      if (who === 'SYSTEM' && a.actorType !== 'SYSTEM') return false;
      if (who === 'USER' && (a.actorType !== 'USER' || a.role === 'BIR_EXAMINER' || !a.tenantId)) return false;
      return true;
    }).sort((a, b) => new Date(b.at) - new Date(a.at));
  }
});

/* ============================================================
   Wiring
   ============================================================ */

Screens.opsService = function () {
  $(".button_ops_int_start").off("click").on("click", function () {
    OpsUI.call('InterruptionStart', { source:$(".select_ops_int_source").val(), note:$(".input_ops_int_note").val() }, 'opsService');
  });
  $(".button_ops_int_end").off("click").on("click", function () { OpsUI.call('InterruptionEnd', {}, 'opsService'); });
  $(".select_ops_sla_period").off("change").on("change", function () { Nav.go('opsService', { period:this.value }); });

  $(".button_ops_verify").off("click").on("click", function () {
    const x = interruptionById($(this).data("id"));
    UI.openModal(`Verify ${x.ref}`, `
      <div class="fs_13 mb-2">${esc(INTERRUPTION_SOURCES[x.source].label)}, ${esc(fmtDateTime(x.startedAt))} to ${x.endedAt ? esc(fmtDateTime(x.endedAt)) : 'now'}.</div>
      <div class="fs_12 text-muted mb-2">Verification confirms from EPI's records that the interruption occurred as declared. Delays it caused are treated as not attributable to the taxpayer.</div>
      <span class="d-block fs_12 fw-semibold mb-1">What confirms it</span>
      <input type="text" class="form-control form-control-sm input_ops_verify_note" maxlength="300" placeholder="Monitoring alert, BIR advisory or ticket number">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_ops_verify_go">Verify</button>`, 'sm');
    $(".button_ops_verify_go").on("click", () => OpsUI.call('InterruptionVerify', { id:x.id, note:$(".input_ops_verify_note").val() }, 'opsService'));
  });

  $(".button_ops_review").off("click").on("click", function () {
    const r = (Store.db.problemReports || []).find(x => x.id === $(this).data("id"));
    const a = ResReg.assess(r);
    UI.openModal(`Review ${r.ref}`, `
      <dl class="dl mb-2">
        <dt>Account</dt><dd>${esc(OpsReg.tenantName(r.tenantId))}</dd>
        <dt>Filed</dt><dd>${esc(fmtDateTime(r.reportedAt))} by ${esc(r.reportedBy)}</dd>
        <dt>Noticed</dt><dd>${esc(fmtDateTime(r.noticedAt))}</dd>
        <dt>What</dt><dd>${esc(ResReg.KINDS[r.kind])}, ${r.docIds.length} invoice(s)</dd>
        <dt>Said</dt><dd>${esc(r.description)}</dd>
      </dl>
      <strong class="fs_12 text-secondary fw-bold d-block mb-1">CHECKS, AS THINGS STAND NOW</strong>
      ${a.checks.map(k => OpsUI.checkRow(k.ok, k.label, k.detail)).join('')}
      <div class="fs_13 fw-semibold mt-2">${a.eligible ? 'Confirming issues a certificate of provider-caused delay.' : 'Confirming closes it without a certificate. The client sees why.'}</div>
      <span class="d-block fs_12 fw-semibold mb-1 mt-2">Reviewer's note</span>
      <input type="text" class="form-control form-control-sm input_ops_review_note" maxlength="300">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_ops_review_go">Confirm review</button>`);
    $(".button_ops_review_go").on("click", () => OpsUI.call('ProblemConfirm', { id:r.id, note:$(".input_ops_review_note").val() }, 'opsService'));
  });
};

Screens.opsClients = function () {
  $(".button_ops_suspend").off("click").on("click", function () {
    const t = OpsReg.tenant($(this).data("id"));
    UI.openModal(`Suspend ${t.name}`, `
      ${Callout('warn', 'The account becomes read-only. Its records stay readable and exportable, and its duties to the BIR continue. Unpaid fees are never a reason to suspend.', {cls:'mb-3'})}
      <span class="d-block fs_12 fw-semibold mb-1">Reason</span>
      <select class="form-select form-select-sm mb-2 select_ops_susp_reason">
        ${Object.keys(OpsReg.SUSPEND_REASONS).map(k => `<option value="${k}">${esc(OpsReg.SUSPEND_REASONS[k])}</option>`).join('')}
      </select>
      <span class="d-block fs_12 fw-semibold mb-1">Reference</span>
      <input type="text" class="form-control form-control-sm input_ops_susp_ref" maxlength="80" placeholder="BIR letter, ticket or request number">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-danger button_ops_susp_go">Suspend</button>`, 'sm');
    $(".button_ops_susp_go").on("click", () => OpsUI.call('OpsSuspend', { id:t.id, reason:$(".select_ops_susp_reason").val(), reference:$(".input_ops_susp_ref").val() }, 'opsClients'));
  });

  $(".button_ops_reopen").off("click").on("click", function () {
    const t = OpsReg.tenant($(this).data("id"));
    DisplayConfirmSwal(`<span class="fw-bold fs_18 text-dark">Reopen ${esc(t.name)}?</span>
      <span class="fs_14 text-muted">The account becomes active again. This is written to its activity log.</span>`,
      () => OpsUI.call('OpsReopen', { id:t.id }, 'opsClients'), null, 'Reopen');
  });

  $(".button_ops_swaprep").off("click").on("click", function () {
    const t = OpsReg.tenant($(this).data("id"));
    let file = '';
    UI.openModal(`Replace representative: ${t.name}`, `
      <div class="fs_12 text-muted mb-3">Current: ${esc(t.representative.name)}, ${esc(t.representative.position)}${t.authority && t.authority.expiresAt ? ` · authority valid until ${esc(fmtDate(t.authority.expiresAt))}` : ''}.
        The new representative is invited as owner, and the current one's access ends.</div>
      <div class="row g-2 mb-2">
        <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm input_ops_rep_name" maxlength="80" placeholder="Full name" aria-label="Full name"></div>
        <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm input_ops_rep_pos" maxlength="80" placeholder="Position" aria-label="Position"></div>
        <div class="col-12"><input type="email" class="form-control form-control-sm input_ops_rep_email" maxlength="120" placeholder="Email" aria-label="Email"></div>
      </div>
      <div class="d-flex align-items-center gap-2 py-2 border-top border-bottom mb-2">
        <i class="bi bi-file-earmark-arrow-up fs_18 icon_ops_rep_file"></i>
        <div class="flex-grow-1 fs_12"><div class="fw-semibold">New authority document <span class="text-danger">*</span></div><div class="text-muted div_ops_rep_file">Not uploaded</div></div>
        <button class="lbtn lbtn-sm lbtn-ghost button_ops_rep_upload">Upload</button>
      </div>
      <div class="d-flex align-items-center gap-2"><span class="fs_12">Valid until</span>
        <input type="date" class="form-control form-control-sm input_ops_rep_exp" style="max-width:170px"></div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_ops_rep_ok">Replace and invite</button>`);
    $(".button_ops_rep_upload").on("click", () => {
      file = 'Authority-' + AppReg.normTin(t.tin) + '-' + new Date().getFullYear() + '.pdf';
      $(".div_ops_rep_file").text(file);
      $(".icon_ops_rep_file").removeClass('bi-file-earmark-arrow-up').addClass('bi-file-earmark-check text-success');
    });
    $(".button_ops_rep_ok").on("click", () => OpsUI.call('OpsReplaceRep', { id:t.id, name:$(".input_ops_rep_name").val(),
      position:$(".input_ops_rep_pos").val(), email:$(".input_ops_rep_email").val(), file, expiresAt:$(".input_ops_rep_exp").val() }, 'opsClients'));
  });
};

/** The review buttons of the Onboarding screen: applications, activation reviews, representative changes, permits, tier changes. */
Screens.opsOnboarding = function () {
  PayUI.bindOps();
  $(".button_ops_pti").off("click").on("click", function () {
    OpsUI.call('OpsPtiIssued', { id:$(this).data("id") }, 'opsOnboarding');
  });

  $(".button_ops_app").off("click").on("click", function () {
    const a = AppReg.get($(this).data("id")), ent = ENTITY_TYPES[a.entity] || { legal:[] }, c = a.coverage || {};
    const docs = Object.keys(a.documents || {}).filter(k => a.documents[k]);
    const opt = (v, l, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
    UI.openModal(`Review ${a.tenantName}`, `
      <div class="fs_13 mb-1"><span class="mono">${esc(a.ref)}</span> · TIN <span class="mono">${esc(a.tin)}</span> · ${esc(ent.label || '')}</div>
      <div class="fs_12 text-muted mb-2">Submitted ${esc(fmtDateTime(a.submittedAt))} · answer due ${esc(fmtDate(a.dueAt))}${AppReg.overdue(a) ? ' <span class="lbadge lbadge-red">Overdue</span>' : ''}</div>
      <div class="fs_12 mb-2"><strong>${esc(a.applicant.person)}</strong>, ${esc(a.applicant.position)} · ${a.authority
        ? `authorized representative under a ${esc(AUTHORITY_DOCS[a.authority.kind].toLowerCase())} signed by ${esc(a.authority.signatory)}, ${esc(a.authority.signatoryPosition)}`
        : 'applying as signatory'} · ${esc(a.email)}</div>
      <div class="fs_12 mb-3"><strong>Documents:</strong> ${docs.length ? docs.map(k => `<span class="d-inline-block me-2"><i class="bi bi-file-earmark-text me-1"></i>${esc(DOC_LABELS[k] || k)}</span>`).join('') : 'None'}</div>
      ${a.info && a.info.repliedAt ? `<div class="fs_12 mb-3 p-2 rounded-3 bg_blue_100"><strong>Applicant's reply, ${esc(fmtDate(a.info.repliedAt))}:</strong> ${esc(a.info.reply || '(document only)')}<div class="text-muted">To: ${esc(a.info.request)}</div></div>` : ''}

      <span class="d-block fs_12 fw-semibold mb-1">1. Legal existence</span>
      <input type="text" class="form-control form-control-sm mb-3 input_ops_app_legal" maxlength="200" placeholder="What was checked, e.g. ${esc(ent.legal.map(x => x[1]).join(' and '))} against Form 2303">

      <span class="d-block fs_12 fw-semibold mb-1">2. Required to issue e-invoices by ${esc(complianceDeadline())}</span>
      <select class="form-select form-select-sm select_ops_app_basis">
        <option value="">Select the category that applies</option>
        ${Object.keys(COVERAGE_BASES).map(k => opt(k, COVERAGE_BASES[k].label + (COVERAGE_BASES[k].ref ? ' — ' + COVERAGE_BASES[k].ref : ''), k === c.basis)).join('')}
      </select>
      <div class="fs_12 mt-1 mb-3 div_ops_app_basis_msg"></div>

      <span class="d-block fs_12 fw-semibold mb-1">3. ${a.authority ? "Representative's authority" : 'Authority to sign'}</span>
      <label class="d-flex gap-2 align-items-start fs_12 mb-2"><input type="checkbox" class="mt-1 check_ops_app_auth">
        <span>${a.authority
          ? `The authority document names ${esc(a.applicant.person)} and covers onboarding, signing agreements, giving authorizations and confirming the tax profile. The signatory's ID matches.`
          : `${esc(a.applicant.person)} is named in the business documents as someone who can sign for it, and the ID matches.`}</span></label>
      ${a.authority ? `<div class="d-flex align-items-center gap-2 mb-3"><span class="fs_12">Valid until</span>
        <input type="date" class="form-control form-control-sm input_ops_app_exp" style="max-width:170px" value="${esc(a.authority.expiresAt || '')}"></div>` : '<div class="mb-3"></div>'}

      <span class="d-block fs_12 fw-semibold mb-1">4. From Form 2303</span>
      <div class="row g-2 mb-1">
        <div class="col-12 col-md-4"><select class="form-select form-select-sm select_ops_app_tax" aria-label="Tax type">
          <option value="">Tax type</option>${opt('VAT', 'VAT')}${opt('NONVAT', 'Non-VAT (Percentage Tax)')}</select></div>
        <div class="col-12 col-md-8"><input type="text" class="form-control form-control-sm input_ops_app_rdo" maxlength="80" placeholder="RDO" aria-label="RDO"></div>
        <div class="col-12"><input type="text" class="form-control form-control-sm input_ops_app_addr" maxlength="200" placeholder="Registered address" aria-label="Registered address"></div>
        <div class="col-12"><input type="text" class="form-control form-control-sm input_ops_app_lob" maxlength="200" placeholder="Registered activities" aria-label="Registered activities"></div>
      </div>
      <div class="fs_11 text-muted">The client's declared VAT status must match this tax type.</div>

      <div class="border-top mt-3 pt-3">
        <span class="d-block fs_12 fw-semibold mb-1">Or request more information</span>
        <textarea class="form-control form-control-sm mb-3 input_ops_app_info" rows="2" maxlength="300" placeholder="What the applicant needs to send"></textarea>
        <span class="d-block fs_12 fw-semibold mb-1">Or decline</span>
        <select class="form-select form-select-sm mb-2 select_ops_app_why">
          <option value="">Select the reason</option>
          ${Object.keys(AppReg.DECLINE_REASONS).map(k => opt(k, AppReg.DECLINE_REASONS[k])).join('')}
        </select>
        <input type="text" class="form-control form-control-sm input_ops_app_note" maxlength="200" placeholder="Note for the applicant (optional)">
      </div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-ghost button_ops_app_info">Request information</button>
       <button class="lbtn lbtn-ghost button_ops_app_decline">Decline</button>
       <button class="lbtn lbtn-primary button_ops_app_accept">Accept</button>`);
    const basisMsg = v => {
      const b = COVERAGE_BASES[v];
      $(".div_ops_app_basis_msg").html(!b ? '' : b.when === 'NOW'
        ? '<span class="text-success"><i class="bi bi-check-circle me-1"></i>Required by the deadline. Can be accepted.</span>'
        : '<span class="text-danger"><i class="bi bi-x-circle me-1"></i>Not required by the deadline. EPI does not accept it now.</span>');
    };
    basisMsg(c.basis);
    $(".select_ops_app_basis").on("change", function () { basisMsg(this.value); });
    $(".button_ops_app_accept").on("click", () => OpsUI.call('OpsAppReview', { id:a.id, decision:'ACCEPT',
      legal:$(".input_ops_app_legal").val(), basis:$(".select_ops_app_basis").val(), authOk:$(".check_ops_app_auth").is(":checked"),
      expiresAt:$(".input_ops_app_exp").val() || '', taxType:$(".select_ops_app_tax").val(),
      rdo:$(".input_ops_app_rdo").val(), address:$(".input_ops_app_addr").val(), lob:$(".input_ops_app_lob").val() }, 'opsOnboarding'));
    $(".button_ops_app_info").on("click", () => OpsUI.call('OpsAppReview', { id:a.id, decision:'INFO', request:$(".input_ops_app_info").val() }, 'opsOnboarding'));
    $(".button_ops_app_decline").on("click", () => OpsUI.call('OpsAppReview', { id:a.id, decision:'DECLINE',
      code:$(".select_ops_app_why").val(), note:$(".input_ops_app_note").val() }, 'opsOnboarding'));
  });

  $(".button_ops_golive").off("click").on("click", function () {
    const a = AppReg.get($(this).data("id")), s = a.setup;
    UI.openModal(`Activation review: ${a.tenantName}`, `
      <div class="fs_12 text-muted mb-3">Setup finished ${esc(fmtDateTime(a.goLiveRequestedAt))} · review due ${esc(fmtDate(a.goLiveDueAt))}</div>
      <dl class="dl mb-3">
        <dt>Tier</dt><dd>${esc((PLANS[planKey(s.plan)] || PLANS.TIER1).label)}</dd>
        <dt>Branches</dt><dd>${s.lane === 'EXPRESS' ? '1 (single location)' : s.branches.length}</dd>
        <dt>Connection</dt><dd>${esc((CONNECTIONS[s.connection] || {}).label || '—')}</dd>
        <dt>Permit to Issue</dt><dd>${s.pti.mode === 'HAVE' ? esc(s.pti.number) : s.pti.mode === 'EPI' ? 'EPI to file it' : 'Client to file it'}</dd>
        <dt>Tax profile</dt><dd>${s.profile.vatStatus === 'VAT' ? 'VAT Registered' : 'Non-VAT'}, attested by ${esc(s.attestedBy)}</dd>
        <dt>Sandbox</dt><dd>${s.sandbox.passed ? 'Passed' : 'Not run'}</dd>
      </dl>
      <div class="mb-3 p-3 border rounded-3">
        <strong class="fs_12 text-secondary d-block mb-1">SIGNED AGREEMENT</strong>
        <div class="fs_12 mb-1">${(s.docs || {}).signedAgreement ? `<span class="mono">${esc(s.docs.signedAgreement)}</span>` : '<span class="text-danger">Not uploaded</span>'}
          ${(s.docs || {}).usageHistory ? ` · usage history <span class="mono">${esc(s.docs.usageHistory)}</span>` : ''}</div>
        <div class="fs_11 text-muted mb-2">Notary: ${s.notary && s.notary.arrange ? 'EPI arranges it' + (s.notary.date ? ', preferred date ' + esc(s.notary.date) : '') : 'the client arranges it'}.${s.provider ? '' : ' No payment provider.'}</div>
        ${['Signed in ink by the authorized signatory', 'Notarized, with the notary\'s details complete', 'The signatory matches the authority document', 'Initials on every page and no page missing', 'The version is the current one (' + esc(CSA.version) + ')']
          .map(t => `<label class="d-flex gap-2 fs_12"><input type="checkbox" class="check_ops_agr"> ${t}</label>`).join('')}
      </div>
      ${s.provider ? `<div class="mb-3 p-3 border rounded-3">
        <strong class="fs_12 text-secondary d-block mb-1">PAYMENT PROVIDER</strong>
        <dl class="dl mb-2">
          <dt>Provider</dt><dd>${esc(s.provider.name)} <span class="text-muted">(${s.provider.mode === 'OWN' ? 'the client\'s own' : 'EPI\'s partner'})</span></dd>
          <dt>Settled to</dt><dd>${esc(s.provider.account.kind)}: ${esc(s.provider.account.label)}</dd>
          <dt>Settlement</dt><dd>${esc(({ REALTIME:'Real time', 'T+1':'Next banking day' })[s.provider.settlement] || s.provider.settlement || '—')}</dd>
        </dl>
        ${(s.provider.mode === 'OWN'
            ? ['The provider is a BSP-registered payment service provider', 'The settlement account is in the client\'s own name', 'The client has confirmed its written instruction to deduct EPI\'s fee from each payment']
            : ['The settlement account is in the client\'s own name', 'EPI\'s partner terms are accepted by the client'])
          .map(t => `<label class="d-flex gap-2 fs_12"><input type="checkbox" class="check_ops_prov"> ${t}</label>`).join('')}
        <div class="fs_11 text-muted mt-1">Once the account is live, this provider appears on Provider settlement under EPI Billing.</div>
      </div>` : ''}
      <span class="d-block fs_12 fw-semibold mb-1">Return for changes (optional)</span>
      <textarea class="form-control form-control-sm input_ops_golive_note" rows="2" maxlength="300" placeholder="What the client needs to change"></textarea>
      <div class="fs_11 text-muted mt-2">Approving activates the account. Fees run from its first invoice.</div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-ghost button_ops_golive_return">Return for changes</button>
       <button class="lbtn lbtn-primary button_ops_golive_ok">Activate account</button>`);
    $(".button_ops_golive_ok").on("click", () => OpsUI.call('OpsGoLive', { id:a.id, agreementOk:$(".check_ops_agr:checked").length === $(".check_ops_agr").length,
      providerOk:$(".check_ops_prov:checked").length === $(".check_ops_prov").length }, 'opsOnboarding'));
    $(".button_ops_golive_return").on("click", () => OpsUI.call('OpsGoLive', { id:a.id, decision:'RETURN', note:$(".input_ops_golive_note").val() }, 'opsOnboarding'));
  });

  $(".button_ops_repreq").off("click").on("click", function () {
    const r = (Store.db.repRequests || []).find(x => x.id === $(this).data("id")), t = OpsReg.tenant(r.tenantId);
    UI.openModal(`Representative change: ${t.name}`, `
      <div class="fs_12 mb-2">Requested by ${esc(r.by)} on ${esc(fmtDate(r.at))}. Current: ${t.representative ? esc(t.representative.name) + ', ' + esc(t.representative.position) : 'none'}.</div>
      <dl class="dl mb-3">
        <dt>New representative</dt><dd>${esc(r.name)}, ${esc(r.position)}</dd>
        <dt>Email</dt><dd>${esc(r.email)}</dd>
        <dt>Authority document</dt><dd><i class="bi bi-file-earmark-text me-1"></i>${esc(r.file)}</dd>
        <dt>Valid until</dt><dd>${r.expiresAt ? esc(fmtDate(r.expiresAt)) : 'No end date'}</dd>
        ${r.reason ? `<dt>Reason</dt><dd>${esc(r.reason)}</dd>` : ''}
      </dl>
      <label class="d-flex gap-2 align-items-start fs_12 mb-3"><input type="checkbox" class="mt-1 check_ops_repreq_doc">
        <span>The authority document names ${esc(r.name)} and covers onboarding, signing agreements, giving authorizations and confirming the tax profile.</span></label>
      <div class="fs_11 text-muted mb-3">Approving invites ${esc(r.name)} as owner and ends ${t.representative ? esc(t.representative.name) + "'s" : 'the current'} access.</div>
      <div class="border-top pt-3"><span class="d-block fs_12 fw-semibold mb-1">Or decline, with the reason</span>
        <input type="text" class="form-control form-control-sm input_ops_repreq_note" maxlength="200"></div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-ghost button_ops_repreq_no">Decline</button>
       <button class="lbtn lbtn-primary button_ops_repreq_ok">Approve</button>`);
    $(".button_ops_repreq_ok").on("click", () => OpsUI.call('OpsRepDecide', { id:r.id, decision:'APPROVE', docOk:$(".check_ops_repreq_doc").is(":checked") }, 'opsOnboarding'));
    $(".button_ops_repreq_no").on("click", () => OpsUI.call('OpsRepDecide', { id:r.id, decision:'DECLINE', note:$(".input_ops_repreq_note").val() }, 'opsOnboarding'));
  });
};

Screens.opsRequests = function () {
  $(".button_ops_ready").off("click").on("click", function () {
    const id = $(this).data("id");
    DisplayConfirmSwal(`<span class="fw-bold fs_18 text-dark">Mark the extract ready?</span>
      <span class="fs_14 text-muted">The examiner can then download it from the taxpayer's Records. The taxpayer sees this in their activity log.</span>`,
      () => OpsUI.call('OpsRequestReady', { id }, 'opsRequests'), null, 'Mark ready');
  });
};

Screens.opsReports = function (opts) {
  const p = OpsReg.period(opts && opts.period);
  const stamp = new Date().toISOString().slice(0, 10);
  const note = what => { logActivity(Store.db, { actorType:'EPI', action:`Generated ${what} for ${p.label}` }); Store.save(Store.db); };
  $(".select_ops_rep_period").off("change").on("change", function () { Nav.go('opsReports', { period:this.value }); });
  $(".button_ops_rep").off("click").on("click", function () {
    const k = $(this).data("kind"), r = OpsReg.report(k, p);
    OpsReg.save(`epi-${k.toLowerCase()}-report-${p.key}-${stamp}.json`, JSON.stringify(r.doc, null, 2));
    note(`the ${OpsReg.REPORTS[k].label.toLowerCase()} report`);
  });
  $(".button_ops_rep_all").off("click").on("click", function () {
    const pack = { pack:'Periodic reports of an accredited ESP', period:{ label:p.label, from:p.from, to:p.to },
      generatedAt:new Date().toISOString(), generatedBy:CU.name, reports:{} };
    Object.keys(OpsReg.REPORTS).forEach(k => { pack.reports[k.toLowerCase()] = OpsReg.report(k, p).doc; });
    OpsReg.save(`epi-bir-report-pack-${p.key}-${stamp}.json`, JSON.stringify(pack, null, 2));
    note('the full BIR report pack');
  });
};

Screens.opsBilling = function (opts) {
  if (opts && opts.docId) return;
  TabToggling(".tab_button_ops_bill_1", ".tab_content_ops_bill_1");
  DepositUI.bindOps();
  SettleUI.bindOps();
  [1, 2, 3, 4, 5, 6].forEach(n => $(`.tab_button_ops_bill_${n}`).off("click").on("click", () => TabToggling(`.tab_button_ops_bill_${n}`, `.tab_content_ops_bill_${n}`)));

  Screens.opsBillingReview();
  $(".button_ops_bill_run").off("click").on("click", () => OpsUI.call('BillingRun', {}, 'opsBilling'));
  $(".button_ops_epi_send").off("click").on("click", function () { OpsUI.call('OpsEpiSend', { id:$(this).data("id") }, 'opsBilling'); });
  $(".button_ops_paid").off("click").on("click", function () {
    const i = OpsReg.epiDocs().find(x => x.id === $(this).data("id"));
    UI.openModal(`Record payment of ${i.number}`, `
      <div class="fs_13 mb-3">${esc(OpsReg.tenantName(i.clientId))}, ${esc(BillingReg.label(i.period))}: <strong class="mono">${peso(i.totals.totalDue)}</strong></div>
      <span class="d-block fs_12 fw-semibold mb-1">How it was paid</span>
      <select class="form-select form-select-sm mb-2 select_ops_paid_method">
        ${Object.keys(PAY_METHODS).map(k => `<option>${esc(PAY_METHODS[k].label)}</option>`).join('')}<option>Auto-debit</option>
      </select>
      <span class="d-block fs_12 fw-semibold mb-1">Reference</span>
      <input type="text" class="form-control form-control-sm input_ops_paid_ref" maxlength="60" placeholder="Transfer or check number">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_ops_paid_go">Mark paid</button>`, 'sm');
    $(".button_ops_paid_go").on("click", () => OpsUI.call('BillingPaid', { id:i.id, method:$(".select_ops_paid_method").val(), reference:$(".input_ops_paid_ref").val() }, 'opsBilling'));
  });
};

Screens.opsBillingReview = function () {
  $(".button_ops_review_pay").off("click").on("click", function () {
    const i = OpsReg.epiDocs().find(x => x.id === $(this).data("id")), s = i.paymentSubmitted;
    UI.openModal(`Review payment of ${i.number}`, `
      <div class="fs_13 mb-2">${esc(OpsReg.tenantName(i.clientId))}, ${esc(BillingReg.label(i.period))}: <strong class="mono">${peso(i.totals.totalDue)}</strong></div>
      <dl class="dl fs_13">
        <dt>Method</dt><dd>${esc(s.label)}</dd><dt>Reference</dt><dd class="mono">${esc(s.reference)}</dd>
        <dt>Proof</dt><dd>${esc(s.proof || 'None attached')}</dd><dt>Sent</dt><dd>${esc(fmtDateTime(s.submittedAt))} by ${esc(s.by)}</dd>
      </dl>
      <span class="d-block fs_12 fw-semibold mb-1">Reason (required to decline)</span>
      <input class="form-control form-control-sm input_ops_pay_reason" maxlength="200">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-ghost button_ops_pay_decline">Decline</button>
       <button class="lbtn lbtn-primary button_ops_pay_confirm">Confirm payment</button>`, 'sm');
    $(".button_ops_pay_confirm").on("click", () => OpsUI.call('BillingPaid', { id:i.id, method:s.label, reference:s.reference }, 'opsBilling'));
    $(".button_ops_pay_decline").on("click", () => OpsUI.call('BillingPayDecline', { id:i.id, reason:$(".input_ops_pay_reason").val() }, 'opsBilling'));
  });
};

Screens.opsAudit = function (opts) {
  opts = opts || {};
  const go = () => Nav.go('opsAudit', { account:$(".select_ops_audit_account").val(), who:$(".select_ops_audit_who").val() });
  $(".select_ops_audit_account, .select_ops_audit_who").off("change").on("change", go);
  $(".button_ops_audit_csv").off("click").on("click", function () {
    const cell = v => { const s = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const rows = Views._auditRows(opts.account || 'ALL', opts.who || 'ALL');
    const csv = ['time,account,who,actor_type,role,action,ip'].concat(rows.map(a =>
      [a.at, a.tenantId ? OpsReg.tenantName(a.tenantId) : 'EPI', a.actorName, a.actorType, a.role, a.action, a.ip].map(cell).join(','))).join('\n');
    OpsReg.save(`epi-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv, 'text/csv');
    logActivity(Store.db, { actorType:'EPI', action:`Downloaded the audit log (${rows.length} entries)` });
    Store.save(Store.db);
  });
};
