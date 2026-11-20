/* ============================================================
   incidents.js — incident log, the BIR report clock, and notices to clients

   RMC VII.10: report a critical security, integrity, availability or
   transmission incident to the BIR by submitting a written incident report
   to the concerned RDO and LTS office within twenty-four hours.
   RMC VII.16: notify affected client-taxpayers of material service
   interruptions and put the approved contingency arrangements in place.

   The clock starts at discovery, not at the report. An interruption declared
   in the console opens its incident at once, with discovery at the moment it
   began, so the clock never starts later than the outage did. Whether an
   incident is critical is a decision that is recorded, with a reason, never an
   assumption: only critical ones carry the clock.

   The BIR has not named a channel for these reports. Submitting the written
   report happens outside this system; here EPI records when, how and under
   what reference, and the clock is read from that.
   ============================================================ */

const IncReg = {

  WRITTEN_HOURS: 24,   /* RMC VII.10, fixed by the circular */

  KINDS: {
    SECURITY:     'Security',
    INTEGRITY:    'Data integrity',
    AVAILABILITY: 'Availability',
    TRANSMISSION: 'Transmission'
  },
  /* Placeholder: the BIR has not said where these reports go. */
  CHANNELS: { PHONE:'Telephone', EMAIL:'Email', PORTAL:'BIR portal' },
  NOTICE_KINDS: { OPENED:'Service interruption', UPDATE:'Update', RESTORED:'Service restored' },

  list(){ return (Store.db.incidents || []).slice().sort((a, b) => new Date(b.discoveredAt) - new Date(a.discoveredAt)); },
  get(id){ return (Store.db.incidents || []).find(i => i.id === id) || null; },
  forInterruption(id){ return (Store.db.incidents || []).find(i => i.interruptionId === id) || null; },
  notices(){ return (Store.db.notices || []).slice().sort((a, b) => new Date(b.at) - new Date(a.at)); },
  noticesFor(incId){ return this.notices().filter(n => n.incidentId === incId); },

  nextRef(){
    const y = new Date().getFullYear();
    const n = (Store.db.incidents || []).filter(i => i.ref.indexOf(`INC-${y}-`) === 0).length + 1;
    return `INC-${y}-${String(n).padStart(4, '0')}`;
  },

  /* ---------- The clocks ---------- */

  /** The written-report clock: when it is due, whether it was met, and how late or how long is left. */
  clock(inc){
    const hours = this.WRITTEN_HOURS;
    const done = inc.writtenReport;
    if (!inc.critical) return { state:'NA', due:null, doneAt:null, hours };
    const due = new Date(new Date(inc.discoveredAt).getTime() + hours * 36e5);
    if (done){
      const at = new Date(done.at);
      return { state: at <= due ? 'MET' : 'MET_LATE', due, doneAt:at, hours,
               byMs: at - due };
    }
    const ms = due - Date.now();
    return { state: ms < 0 ? 'OVERDUE' : 'DUE', due, doneAt:null, hours, ms };
  },

  span(ms){
    const m = Math.round(Math.abs(ms) / 60000);
    if (m < 60) return `${Math.max(1, m)} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  },

  clockBadge(c){
    return ({
      NA:       '<span class="text-muted fs_12">Not critical</span>',
      MET:      '<span class="lbadge lbadge-green">Met on time</span>',
      MET_LATE: '<span class="lbadge lbadge-amber">Met late</span>',
      DUE:      '<span class="lbadge lbadge-amber lbadge-dot">Due</span>',
      OVERDUE:  '<span class="lbadge lbadge-red lbadge-dot">Overdue</span>'
    })[c.state];
  },

  clockNote(c){
    if (c.state === 'DUE')      return `${this.span(c.ms)} left, by ${fmtDateTime(c.due)}`;
    if (c.state === 'OVERDUE')  return `${this.span(c.ms)} overdue, was due ${fmtDateTime(c.due)}`;
    if (c.state === 'MET')      return `Sent ${fmtDateTime(c.doneAt)}`;
    if (c.state === 'MET_LATE') return `Sent ${fmtDateTime(c.doneAt)}, ${this.span(c.byMs)} late`;
    return '';
  },

  /** Closing is refused until the written report exists, for a critical incident. */
  closeBlock(inc){
    if (!inc.critical) return '';
    if (!inc.writtenReport) return 'The initial written report has not been submitted yet.';
    return '';
  },

  clientsToldOf(inc){
    return this.noticesFor(inc.id).some(n => n.kind === 'OPENED');
  },

  /* ---------- Opening ---------- */

  push(inc, text, by){
    inc.timeline = inc.timeline || [];
    inc.timeline.push({ at:new Date().toISOString(), by:by || (CU ? CU.name : 'System'), text });
  },

  /** An interruption always opens an incident. Discovery is when it began. */
  fromInterruption(int){
    const db = Store.db;
    db.incidents = db.incidents || [];
    const src = INTERRUPTION_SOURCES[int.source];
    const inc = { id:uid('inc'), ref:this.nextRef(), kind: int.source === 'ESP' ? 'AVAILABILITY' : 'TRANSMISSION',
      critical:true, title:`${src.label} (${int.ref})`, summary:int.note || '',
      discoveredAt:int.startedAt, discoveredBy:int.declaredBy || (CU ? CU.name : 'EPI'),
      interruptionId:int.id, tenantIds:db.tenants.map(t => t.id), status:'OPEN', timeline:[] };
    this.push(inc, `Opened when ${int.ref} was declared. The BIR deadlines count from ${fmtDateTime(inc.discoveredAt)}.`, inc.discoveredBy);
    db.incidents.push(inc);
    return inc;
  },

  /** Service coming back is a fact worth keeping on the incident. */
  restored(int){
    const inc = this.forInterruption(int.id);
    if (!inc) return;
    inc.serviceRestoredAt = int.endedAt;
    this.push(inc, `Service restored after ${ResReg.hLabel(ResReg.hours(int.startedAt, int.endedAt))}. Held invoices were sent again.`);
  },

  /* ---------- Alerts for the operations screen ---------- */

  alerts(add){
    this.list().filter(i => i.status === 'OPEN').forEach(inc => {
      if (inc.critical){
        const c = this.clock(inc);
        if (c.state === 'OVERDUE') add('danger', `${inc.ref}: The written incident report is not submitted. ${this.span(c.ms)} past the 24-hour limit.`, 'opsIncidents');
        else if (c.state === 'DUE') add('warn', `${inc.ref}: The written incident report is not submitted. ${this.span(c.ms)} left of 24 hours.`, 'opsIncidents');
      }
      if (inc.interruptionId && !this.clientsToldOf(inc))
        add('warn', `${inc.ref}: affected clients have not been notified.`, 'opsIncidents');
      else if (inc.serviceRestoredAt && !this.noticesFor(inc.id).some(n => n.kind === 'RESTORED'))
        add('info', `${inc.ref}: service is back, but clients have not been told.`, 'opsIncidents');
    });
  },

  /* ---------- Notices ---------- */

  /** What clients are told to do, by cause. The BIR has not prescribed contingency
      arrangements, so this is EPI's own guidance and says so. */
  contingency(inc){
    const int = inc.interruptionId ? interruptionById(inc.interruptionId) : null;
    if (!int) return 'No action is needed from you.';
    return INTERRUPTION_SOURCES[int.source].blocksIssuing
      ? 'Keep entering sales. They wait, then are issued and sent to your buyers when service returns. If a buyer needs a paper invoice now, write a manual invoice and record it under Invoices, Manual invoices.'
      : 'Keep issuing invoices as usual. They are held and sent to the BIR automatically when the connection returns.';
  },

  draft(inc, kind){
    const int = inc.interruptionId ? interruptionById(inc.interruptionId) : null;
    const when = fmtDateTime(inc.discoveredAt);
    const titles = {
      OPENED:   int ? `${INTERRUPTION_SOURCES[int.source].label}` : inc.title,
      UPDATE:   `Update: ${inc.title}`,
      RESTORED: `Service restored: ${inc.title}`
    };
    const bodies = {
      OPENED:   `${int ? INTERRUPTION_SOURCES[int.source].label : inc.title} since ${when}. ${inc.summary || ''}`.trim(),
      UPDATE:   '',
      RESTORED: `Service is back${inc.serviceRestoredAt ? ' as of ' + fmtDateTime(inc.serviceRestoredAt) : ''}. Waiting sales have been issued and sent to your buyers. Held invoices have been sent to the BIR. Check Invoices for any still waiting.`
    };
    return { title:titles[kind], body:bodies[kind], contingency: kind === 'RESTORED' ? '' : this.contingency(inc) };
  },

  /** The written report as a standalone page, with the digest of what it states. */
  async reportHtml(inc){
    const wr = inc.writtenReport;
    const int = inc.interruptionId ? interruptionById(inc.interruptionId) : null;
    const data = {
      incident:inc.ref, kind:this.KINDS[inc.kind], title:inc.title, discoveredAt:inc.discoveredAt,
      provider:{ name:SYSTEM.vendor, tin:SYSTEM.taxpayer.tin, accreditationCertificate:SYSTEM.certificates.esp.no },
      interruption: int ? { ref:int.ref, source:INTERRUPTION_SOURCES[int.source].label, startedAt:int.startedAt, endedAt:int.endedAt, verified:int.verified } : null,
      affectedAccounts: (inc.tenantIds || []).length,
      writtenReport: wr ? { at:wr.at, channel:this.CHANNELS[wr.channel], reference:wr.reference, summary:wr.summary, cause:wr.cause,
                            impact:wr.impact, actions:wr.actions, status:wr.status, next:wr.next } : null,
      clock:this.clock(inc).state,
      timeline:(inc.timeline || []).map(t => ({ at:t.at, by:t.by, text:t.text }))
    };
    const json = JSON.stringify(data), digest = await ResReg.sha256(json);
    const row = (k, v) => `<tr><th style="width:150px">${esc(k)}</th><td>${esc(v || '—')}</td></tr>`;
    const body = `<h1>Initial incident report</h1>
<div class="muted">${esc(inc.ref)} · ${esc(this.KINDS[inc.kind])}</div>
<div class="note">Discovered ${esc(fmtDateTime(inc.discoveredAt))}. Due ${esc(fmtDateTime(this.clock(inc).due))}.
This report: ${wr ? esc(fmtDateTime(wr.at)) : 'not yet submitted'}.</div>
<h2>What happened</h2><table>${row('Incident', inc.title)}${row('Summary', wr && wr.summary)}${row('Cause so far', wr && wr.cause)}
${data.interruption ? row('Interruption', `${data.interruption.ref}, ${fmtDateTime(data.interruption.startedAt)} to ${data.interruption.endedAt ? fmtDateTime(data.interruption.endedAt) : 'still open'}`) : ''}</table>
<h2>Effect</h2><table>${row('Affected', wr && wr.impact)}${row('Accounts', String(data.affectedAccounts))}</table>
<h2>What EPI did and will do</h2><table>${row('Done', wr && wr.actions)}${row('Status', wr && wr.status)}${row('Next', wr && wr.next)}</table>
<h2>Timeline</h2><table><tr><th>Time</th><th>By</th><th>What</th></tr>
${data.timeline.map(t => `<tr><td>${esc(fmtDateTime(t.at))}</td><td>${esc(t.by)}</td><td>${esc(t.text)}</td></tr>`).join('')}</table>`;
    return ResReg.pageShell('Initial incident report', body, json, digest);
  }
};

/* ============================================================
   Handlers
   ============================================================ */

const incOnly = fn => p => can('operate') ? fn(p || {}) : { success:false, message:'Only EPI operations can do this.' };
const parseAt = (v, inc) => {
  const d = v ? new Date(v) : new Date();
  if (isNaN(d.getTime())) return { err:'That time is not valid.' };
  if (d.getTime() > Date.now() + 60000) return { err:'That time is in the future.' };
  if (inc && d < new Date(inc.discoveredAt)) return { err:`That is before the incident was discovered (${fmtDateTime(inc.discoveredAt)}).` };
  return { at:d.toISOString() };
};

LocalAPI.on("Dashboard/IncOpen", incOnly(p => {
  const db = Store.db;
  if (!IncReg.KINDS[p.kind]) return { success:false, message:'Select the kind of incident.' };
  const title = String(p.title || '').trim(), summary = String(p.summary || '').trim();
  if (!title) return { success:false, message:'Enter a short title for the incident.' };
  if (!summary) return { success:false, message:'Enter what was discovered.' };
  const t = parseAt(p.discoveredAt);
  if (t.err) return { success:false, message:t.err };
  const ids = [].concat(p.tenantIds || []).filter(id => OpsReg.tenant(id));
  db.incidents = db.incidents || [];
  const inc = { id:uid('inc'), ref:IncReg.nextRef(), kind:p.kind, critical:true, title:title.slice(0, 100), summary:summary.slice(0, 600),
    discoveredAt:t.at, discoveredBy:CU.name, interruptionId:null, tenantIds:ids, status:'OPEN', timeline:[] };
  IncReg.push(inc, `Opened. The 24-hour deadline for the written report counts from ${fmtDateTime(inc.discoveredAt)}.`);
  db.incidents.push(inc);
  logActivity(db, { actorType:'EPI', action:`Incident ${inc.ref} opened: ${IncReg.KINDS[inc.kind]}, ${inc.title}` });
  Store.save(db);
  return { success:true, id:inc.id, message:`${inc.ref} opened. Submit the written report to the BIR within ${IncReg.WRITTEN_HOURS} hours.` };
}));

/* The same form records either submission: when it went, how, and under what reference. */
function incSubmission(p, inc, label){
  const t = parseAt(p.at, inc);
  if (t.err) return { err:t.err };
  if (!IncReg.CHANNELS[p.channel]) return { err:'Select how the notice was sent.' };
  const ref = String(p.reference || '').trim();
  if (!ref) return { err:`Enter the reference number the BIR gave for the ${label}, or your own if none was given.` };
  return { at:t.at, channel:p.channel, reference:ref.slice(0, 80), by:CU.name };
}

LocalAPI.on("Dashboard/IncWritten", incOnly(p => {
  const inc = IncReg.get(p.id);
  if (!inc || !inc.critical) return { success:false, message:'That incident does not need a written report.' };
  if (inc.writtenReport) return { success:false, message:'The written report has already been submitted.' };
  const f = k => String(p[k] || '').trim();
  const missing = [['summary', 'what happened'], ['cause', 'the cause so far (state if it is not yet known)'], ['impact', 'who and what was affected'], ['actions', 'what EPI has done']]
    .filter(([k]) => !f(k)).map(x => x[1]);
  if (missing.length) return { success:false, message:`Enter ${missing[0]}.` };
  if (['CONTAINED', 'ONGOING', 'RESOLVED'].indexOf(p.status) === -1) return { success:false, message:'Enter the current status of the incident.' };
  const s = incSubmission(p, inc, 'report');
  if (s.err) return { success:false, message:s.err };
  inc.writtenReport = Object.assign(s, { summary:f('summary').slice(0, 800), cause:f('cause').slice(0, 600), impact:f('impact').slice(0, 600),
    actions:f('actions').slice(0, 800), status:{ CONTAINED:'Contained', ONGOING:'Ongoing', RESOLVED:'Resolved' }[p.status], next:f('next').slice(0, 600) });
  const c = IncReg.clock(inc);
  IncReg.push(inc, `Initial written report submitted by ${IncReg.CHANNELS[s.channel].toLowerCase()}, reference ${s.reference}${c.state === 'MET_LATE' ? `. ${IncReg.span(c.byMs)} after the 24-hour limit` : ''}.`);
  logActivity(Store.db, { actorType:'EPI', action:`Incident ${inc.ref}: initial written report submitted (${c.state === 'MET' ? 'on time' : 'late'})` });
  Store.save(Store.db);
  return { success:true, message: c.state === 'MET' ? 'Written report recorded, on time.' : `Written report recorded. It was ${IncReg.span(c.byMs)} late and is marked so.` };
}));

LocalAPI.on("Dashboard/IncUpdate", incOnly(p => {
  const inc = IncReg.get(p.id), text = String(p.text || '').trim();
  if (!inc) return { success:false, message:'That incident was not found.' };
  if (!text) return { success:false, message:'Write the update.' };
  IncReg.push(inc, text.slice(0, 400));
  Store.save(Store.db);
  return { success:true, message:'Added to the timeline.' };
}));

LocalAPI.on("Dashboard/IncNotCritical", incOnly(p => {
  const inc = IncReg.get(p.id), why = String(p.reason || '').trim();
  if (!inc || !inc.critical || inc.status !== 'OPEN') return { success:false, message:'Only an open critical incident can be reclassified.' };
  if (inc.writtenReport) return { success:false, message:'It has already been reported to the BIR, so it stays critical.' };
  if (!why) return { success:false, message:'Enter the reason it is not critical. The reason is kept with the incident.' };
  inc.critical = false;
  inc.notCritical = { reason:why.slice(0, 300), by:CU.name, at:new Date().toISOString() };
  IncReg.push(inc, `Judged not critical: ${inc.notCritical.reason}`);
  logActivity(Store.db, { actorType:'EPI', action:`Incident ${inc.ref} judged not critical: ${inc.notCritical.reason}` });
  Store.save(Store.db);
  return { success:true, message:`${inc.ref} no longer has BIR deadlines. The reason is on record.` };
}));

LocalAPI.on("Dashboard/IncResolve", incOnly(p => {
  const inc = IncReg.get(p.id);
  if (!inc || inc.status !== 'OPEN') return { success:false, message:'That incident is already closed.' };
  const block = IncReg.closeBlock(inc);
  if (block) return { success:false, message:block };
  const int = inc.interruptionId ? interruptionById(inc.interruptionId) : null;
  if (int && !int.endedAt) return { success:false, message:`${int.ref} is still open. Close the interruption first.` };
  inc.status = 'CLOSED'; inc.closedAt = new Date().toISOString(); inc.closedBy = CU.name;
  IncReg.push(inc, 'Closed.');
  logActivity(Store.db, { actorType:'EPI', action:`Incident ${inc.ref} closed` });
  Store.save(Store.db);
  return { success:true, message:`${inc.ref} closed.` };
}));

LocalAPI.on("Dashboard/IncNotice", incOnly(p => {
  const db = Store.db, inc = IncReg.get(p.id);
  if (!inc) return { success:false, message:'That incident was not found.' };
  if (!IncReg.NOTICE_KINDS[p.kind]) return { success:false, message:'Select the kind of notice.' };
  const title = String(p.title || '').trim(), body = String(p.body || '').trim();
  if (!title || !body) return { success:false, message:'A notice needs a title and a message.' };
  const ids = [].concat(p.tenantIds || []).filter(id => OpsReg.tenant(id));
  if (!ids.length) return { success:false, message:'Select at least one account to notify.' };
  const y = new Date().getFullYear();
  const n = { id:uid('ntc'), ref:`NTC-${y}-${String((db.notices || []).length + 1).padStart(4, '0')}`, incidentId:inc.id,
    interruptionId:inc.interruptionId, kind:p.kind, title:title.slice(0, 100), body:body.slice(0, 800),
    contingency:String(p.contingency || '').trim().slice(0, 600), tenantIds:ids, at:new Date().toISOString(), by:CU.name };
  db.notices = db.notices || [];
  db.notices.push(n);
  ids.forEach(id => logActivity(db, { tenantId:id, actorType:'EPI', action:`EPI sent a service notice: ${n.title} (${n.ref})` }));
  IncReg.push(inc, `Notice ${n.ref} sent to ${ids.length} account(s): ${n.title}.`);
  Store.save(db);
  return { success:true, message:`${n.ref} sent to ${ids.length} account(s). They see it on every screen and under Service Notices.` };
}));

/* ============================================================
   Screens
   ============================================================ */

Object.assign(Views, {

  /* ---------- Operator: the log ---------- */
  opsIncidents(opts){
    if (opts && opts.id) return Views.opsIncident(opts.id);
    const rows = IncReg.list();
    const open = rows.filter(i => i.status === 'OPEN');
    return `
      ${OpsUI.head('Incidents', `Critical security, integrity, availability and transmission incidents. The BIR is given a written incident report within ${IncReg.WRITTEN_HOURS} hours of discovery. An interruption opens its own incident.`,
        '<button class="lbtn lbtn-sm lbtn-primary button_inc_open">Open an incident</button>')}
      <div class="lcard"><div class="lcard-body">
        <div class="fs_12 text-muted mb-2">${open.length} open of ${rows.length}. Deadlines count from the time of discovery.</div>
        ${rows.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>INCIDENT</th><th>KIND</th><th>DISCOVERED</th><th>WRITTEN REPORT (24 H)</th><th>CLIENTS TOLD</th><th>STATUS</th></tr></thead>
          <tbody>${rows.map(i => {
            const b = IncReg.clock(i), told = IncReg.noticesFor(i.id).length;
            return `<tr>
              <td><span class="hyperlink fw-semibold mono text-nowrap" onclick="Nav.go('opsIncidents', { id:'${i.id}' })">${esc(i.ref)}</span>
                <div class="fs_12">${esc(i.title)}</div></td>
              <td>${esc(IncReg.KINDS[i.kind])}</td>
              <td class="fs_12">${esc(fmtDateTime(i.discoveredAt))}</td>
              <td>${IncReg.clockBadge(b)}<div class="fs_11 text-muted">${esc(IncReg.clockNote(b))}</div></td>
              <td class="mono">${told ? told + ' notice' + (told === 1 ? '' : 's') : '—'}</td>
              <td>${i.status === 'OPEN' ? '<span class="lbadge lbadge-amber lbadge-dot">Open</span>' : '<span class="lbadge lbadge-gray">Closed</span>'}</td></tr>`; }).join('')}
          </tbody></table></div>` : '<div class="fs_13 text-muted">No incidents recorded.</div>'}
      </div></div>`;
  },

  /* ---------- Operator: one incident ---------- */
  opsIncident(id){
    const inc = IncReg.get(id);
    if (!inc) return '<div class="p-4">That incident was not found.</div>';
    const int = inc.interruptionId ? interruptionById(inc.interruptionId) : null;
    const open = inc.status === 'OPEN';
    const wr = inc.writtenReport;
    const card = (title, which, done, act) => {
      const c = IncReg.clock(inc);
      return `<div class="col-12 col-lg-6"><div class="lcard h-100"><div class="lcard-body">
        <div class="d-flex justify-content-between align-items-start">
          <strong class="fs_13 text-secondary fw-bold">${title}</strong>${IncReg.clockBadge(c)}
        </div>
        <div class="fs_13 mt-2">${c.state === 'NA' ? 'No BIR deadline applies. This incident was judged not critical.' : esc(IncReg.clockNote(c))}</div>
        ${done ? `<div class="fs_12 text-muted mt-1">${esc(IncReg.CHANNELS[done.channel])}, reference <span class="mono">${esc(done.reference)}</span>, by ${esc(done.by)}</div>` : ''}
        ${!done && c.state !== 'NA' && open ? `<button class="lbtn lbtn-sm lbtn-primary mt-3 ${act}">Submit the written report</button>` : ''}
        ${done && which === 'written' ? '<button class="lbtn lbtn-sm lbtn-ghost mt-3 button_inc_download">Download the report</button>' : ''}
      </div></div></div>`;
    };
    const told = IncReg.noticesFor(inc.id);
    const names = (inc.tenantIds || []).map(id => OpsReg.tenantName(id));

    return `
      ${OpsUI.head(`<span class="mono">${esc(inc.ref)}</span> ${esc(inc.title)}`,
        `${esc(IncReg.KINDS[inc.kind])} incident, discovered ${esc(fmtDateTime(inc.discoveredAt))} by ${esc(inc.discoveredBy)}.`, `
        <div class="d-flex gap-2">
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('opsIncidents')">Back</button>
          ${open ? '<button class="lbtn lbtn-sm lbtn-accent button_inc_close">Close the incident</button>' : ''}
        </div>`)}

      <div class="row g-3 mb-3">
        ${card(`INITIAL WRITTEN REPORT, WITHIN ${IncReg.WRITTEN_HOURS} HOURS`, 'written', wr, 'button_inc_written')}
      </div>

      <div class="row g-3 mb-3">
        <div class="col-12 col-lg-6"><div class="lcard h-100"><div class="lcard-body">
          <strong class="fs_13 text-secondary fw-bold d-block mb-2">WHAT IT IS</strong>
          <dl class="dl mb-2">
            <dt>Summary</dt><dd>${esc(inc.summary || '—')}</dd>
            <dt>Interruption</dt><dd>${int ? `<span class="mono">${esc(int.ref)}</span>, ${int.endedAt ? 'ended ' + esc(fmtDateTime(int.endedAt)) : 'still open'}${int.verified ? ', verified' : ', not verified'}` : 'None linked'}</dd>
            <dt>Accounts</dt><dd>${names.length ? esc(names.join(', ')) : 'No client account affected'}</dd>
            ${inc.notCritical ? `<dt>Not critical</dt><dd>${esc(inc.notCritical.reason)} <span class="text-muted">(${esc(inc.notCritical.by)})</span></dd>` : ''}
          </dl>
          ${open && inc.critical && !nt && !wr ? '<button class="lbtn lbtn-sm lbtn-ghost button_inc_notcrit">Judge it not critical</button>' : ''}
        </div></div></div>

        <div class="col-12 col-lg-6"><div class="lcard h-100"><div class="lcard-body">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <strong class="fs_13 text-secondary fw-bold">CLIENT NOTICES</strong>
            ${(inc.tenantIds || []).length ? '<button class="lbtn lbtn-sm lbtn-primary button_inc_notice">Notify clients</button>' : ''}
          </div>
          ${told.length ? told.map(n => `<div class="fs_13 py-1 border-bottom"><span class="lbadge lbadge-blue">${esc(IncReg.NOTICE_KINDS[n.kind])}</span>
            <strong>${esc(n.title)}</strong><div class="fs_11 text-muted">${esc(n.ref)}, ${esc(fmtDateTime(n.at))}, ${n.tenantIds.length} account(s), by ${esc(n.by)}</div></div>`).join('')
            : `<div class="fs_13 text-muted">${(inc.tenantIds || []).length ? 'No notice sent yet.' : 'No client account is affected, so there is no one to notify.'}</div>`}
        </div></div></div>
      </div>

      <div class="lcard"><div class="lcard-body">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <strong class="fs_13 text-secondary fw-bold">TIMELINE</strong>
          <button class="lbtn lbtn-sm lbtn-ghost button_inc_update">Add an update</button>
        </div>
        <div class="table-responsive"><table class="table fs_13 mb-0"><tbody>
          ${(inc.timeline || []).slice().reverse().map(t => `<tr><td class="text-nowrap fs_12" style="width:170px">${esc(fmtDateTime(t.at))}</td><td class="fs_12" style="width:150px">${esc(t.by)}</td><td>${esc(t.text)}</td></tr>`).join('')}
        </tbody></table></div>
      </div></div>`;
  },

  /* ---------- Client: notices from EPI ---------- */
  notices(){
    const mine = IncReg.notices().filter(n => n.tenantIds.indexOf(CT.id) > -1);
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Service Notices</h1>
          <div class="screen_sub">What EPI has told ${esc(CT.name)} about interruptions to the service, and what to do while they last.</div>
        </div>
      </div>
      ${mine.length ? mine.map(n => `
        <div class="lcard mb-3"><div class="lcard-body">
          <div class="d-flex flex-wrap justify-content-between gap-2">
            <div><span class="lbadge ${n.kind === 'RESTORED' ? 'lbadge-green' : n.kind === 'OPENED' ? 'lbadge-red' : 'lbadge-blue'}">${esc(IncReg.NOTICE_KINDS[n.kind])}</span>
              <strong class="ms-1">${esc(n.title)}</strong></div>
            <span class="fs_12 text-muted">${esc(fmtDateTime(n.at))}</span>
          </div>
          <div class="fs_13 mt-2">${esc(n.body)}</div>
          ${n.contingency ? `<div class="fs_13 mt-2"><strong>What to do.</strong> ${esc(n.contingency)}
            <div class="fs_11 text-muted mt-1">EPI's own guidance. The BIR has not set rules for service interruptions yet.</div></div>` : ''}
        </div></div>`).join('')
        : '<div class="lcard"><div class="lcard-body fs_13 text-muted">EPI has sent no notices. If the service is interrupted, they appear here and on every screen.</div></div>'}`;
  }
});

/* ============================================================
   Wiring
   ============================================================ */

const IncUI = {
  local(){ const n = new Date(); return new Date(n.getTime() - n.getTimezoneOffset() * 60000).toISOString().slice(0, 16); },
  iso(v){ return v ? new Date(v).toISOString() : ''; },
  field(label, input){ return `<span class="d-block fs_12 fw-semibold mb-1">${label}</span>${input}`; },
  text(cls, ph, rows){ return rows ? `<textarea class="form-control form-control-sm mb-2 ${cls}" rows="${rows}" maxlength="800" placeholder="${esc(ph || '')}"></textarea>`
                                   : `<input type="text" class="form-control form-control-sm mb-2 ${cls}" maxlength="200" placeholder="${esc(ph || '')}">`; },
  /* Recorded submissions share when, how and reference. */
  submission(cls){
    const now = this.local();
    return `<div class="row g-2 mb-2">
      <div class="col-6">${this.field('Sent at', `<input type="datetime-local" class="form-control form-control-sm ${cls}_at" value="${now}" max="${now}">`)}</div>
      <div class="col-6">${this.field('How', `<select class="form-select form-select-sm ${cls}_channel">${Object.keys(IncReg.CHANNELS).map(k => `<option value="${k}">${esc(IncReg.CHANNELS[k])}</option>`).join('')}</select>`)}</div>
    </div>${this.field("Reference", this.text(`${cls}_ref`, "The BIR's reference, or your own"))}
    <div class="fs_11 text-muted">The BIR has not named a channel for these reports. Select how it was sent.</div>`;
  },
  go(route, data, done){
    $.ajax({ url:`/Portal/SPIStradcom/Dashboard/${route}`, method:"POST", dataType:"json", data }).done(function (res) {
      if (!res.success){ DisplayDelaySwal("info", "", res.message); return; }
      UI.closeModal();
      DisplayDelaySwal("success", "", res.message);
      refreshSession(); Auth.paintChrome();
      Nav.go('opsIncidents', done);
    });
  },
  foot(label, cls, kind){
    return `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
            <button class="lbtn ${kind || 'lbtn-primary'} ${cls}">${label}</button>`;
  }
};

Screens.opsIncidents = function (opts) {
  const id = opts && opts.id, inc = id ? IncReg.get(id) : null;

  $(".button_inc_open").off("click").on("click", function () {
    const ts = OpsReg.tenants(), now = IncUI.local();
    UI.openModal('Open an incident', `
      <div class="fs_12 text-muted mb-2">Open the incident as soon as it is discovered. The ${IncReg.WRITTEN_HOURS}-hour deadline for the written report counts from the discovery time below.</div>
      <div class="row g-2">
        <div class="col-6">${IncUI.field('Kind', `<select class="form-select form-select-sm mb-2 select_inc_kind">${Object.keys(IncReg.KINDS).map(k => `<option value="${k}">${esc(IncReg.KINDS[k])}</option>`).join('')}</select>`)}</div>
        <div class="col-6">${IncUI.field('Discovered', `<input type="datetime-local" class="form-control form-control-sm mb-2 input_inc_found" value="${now}" max="${now}">`)}</div>
      </div>
      ${IncUI.field('Title', IncUI.text('input_inc_title', 'A few words'))}
      ${IncUI.field('What was discovered', IncUI.text('input_inc_summary', 'What was seen, and how', 3))}
      ${IncUI.field('Client accounts affected', `<div class="fs_13">${ts.map(t => `<label class="d-block"><input type="checkbox" class="me-2 check_inc_tenant" value="${t.id}">${esc(t.name)}</label>`).join('')}
        <div class="fs_11 text-muted mt-1">Leave all unticked if no client's account or data is involved.</div></div>`)}`,
      IncUI.foot('Open the incident', 'button_inc_open_go'));
    $(".button_inc_open_go").on("click", () => IncUI.go('IncOpen', {
      kind:$(".select_inc_kind").val(), discoveredAt:IncUI.iso($(".input_inc_found").val()), title:$(".input_inc_title").val(),
      summary:$(".input_inc_summary").val(), tenantIds:$(".check_inc_tenant:checked").map((i, e) => e.value).get() }));
  });

  if (!inc) return;
  const back = { id:inc.id };

  $(".button_inc_written").off("click").on("click", function () {
    UI.openModal(`Initial written report for ${inc.ref}`, `
      <div class="fs_12 text-muted mb-2">Due by ${esc(fmtDateTime(IncReg.clock(inc).due))}. This is an initial report. State any information not yet known.</div>
      ${IncUI.field('What happened', IncUI.text('input_inc_w_summary', '', 3))}
      ${IncUI.field('Cause so far', IncUI.text('input_inc_w_cause', 'Or "not yet known"'))}
      ${IncUI.field('Who and what was affected', IncUI.text('input_inc_w_impact', 'Accounts, documents, data'))}
      ${IncUI.field('What EPI has done', IncUI.text('input_inc_w_actions', '', 2))}
      <div class="row g-2"><div class="col-5">${IncUI.field('Where it stands', `<select class="form-select form-select-sm mb-2 select_inc_w_status"><option value="CONTAINED">Contained</option><option value="ONGOING">Ongoing</option><option value="RESOLVED">Resolved</option></select>`)}</div>
        <div class="col-7">${IncUI.field('Next steps', IncUI.text('input_inc_w_next'))}</div></div>
      <div class="border-top pt-2 mt-1">${IncUI.submission('input_inc_w')}</div>`, IncUI.foot('Submit and record', 'button_inc_w_go'));
    $(".button_inc_w_go").on("click", () => IncUI.go('IncWritten', { id:inc.id, summary:$(".input_inc_w_summary").val(), cause:$(".input_inc_w_cause").val(),
      impact:$(".input_inc_w_impact").val(), actions:$(".input_inc_w_actions").val(), status:$(".select_inc_w_status").val(), next:$(".input_inc_w_next").val(),
      at:IncUI.iso($(".input_inc_w_at").val()), channel:$(".input_inc_w_channel").val(), reference:$(".input_inc_w_ref").val() }, back));
  });

  $(".button_inc_download").off("click").on("click", async function () {
    const html = await IncReg.reportHtml(inc);
    OpsReg.save(`${inc.ref}-initial-report.html`, html, 'text/html');
    logActivity(Store.db, { actorType:'EPI', action:`Downloaded the initial report for ${inc.ref}` });
    Store.save(Store.db);
  });

  $(".button_inc_update").off("click").on("click", function () {
    UI.openModal(`Update ${inc.ref}`, IncUI.field('What changed', IncUI.text('input_inc_u', '', 3)), IncUI.foot('Add to the timeline', 'button_inc_u_go'), 'sm');
    $(".button_inc_u_go").on("click", () => IncUI.go('IncUpdate', { id:inc.id, text:$(".input_inc_u").val() }, back));
  });

  $(".button_inc_notcrit").off("click").on("click", function () {
    UI.openModal(`Judge ${inc.ref} not critical`, `${Callout('warn', 'It then has no BIR deadlines. The reason stays on the incident, where the BIR can see it. Once the BIR has been told, this is no longer possible.', {cls:'mb-3'})}
      ${IncUI.field('Why it is not critical', IncUI.text('input_inc_nc', '', 2))}`, IncUI.foot('Confirm', 'button_inc_nc_go'), 'sm');
    $(".button_inc_nc_go").on("click", () => IncUI.go('IncNotCritical', { id:inc.id, reason:$(".input_inc_nc").val() }, back));
  });

  $(".button_inc_close").off("click").on("click", function () {
    DisplayConfirmSwal(`<span class="fw-bold fs_18 text-dark">Close ${esc(inc.ref)}?</span>
      <span class="fs_14 text-muted">A critical incident closes only when the BIR has been notified and the written report is in.</span>`,
      () => IncUI.go('IncResolve', { id:inc.id }, back), null, 'Close incident');
  });

  $(".button_inc_notice").off("click").on("click", function () {
    const ts = OpsReg.tenants(), told = IncReg.noticesFor(inc.id);
    const first = told.some(n => n.kind === 'OPENED') ? (inc.serviceRestoredAt && !told.some(n => n.kind === 'RESTORED') ? 'RESTORED' : 'UPDATE') : 'OPENED';
    const fill = k => { const d = IncReg.draft(inc, k); $(".input_inc_nt").val(d.title); $(".input_inc_nb").val(d.body); $(".input_inc_nc2").val(d.contingency); };
    UI.openModal(`Notify clients of ${inc.ref}`, `
      ${IncUI.field('Kind', `<select class="form-select form-select-sm mb-2 select_inc_nk">${Object.keys(IncReg.NOTICE_KINDS).map(k => `<option value="${k}"${k === first ? ' selected' : ''}>${esc(IncReg.NOTICE_KINDS[k])}</option>`).join('')}</select>`)}
      ${IncUI.field('Title', IncUI.text('input_inc_nt'))}
      ${IncUI.field('What happened', IncUI.text('input_inc_nb', '', 3))}
      ${IncUI.field('What to do', IncUI.text('input_inc_nc2', '', 3))}
      ${IncUI.field('Send to', `<div class="fs_13">${ts.map(t => `<label class="d-block"><input type="checkbox" class="me-2 check_inc_nt" value="${t.id}"${(inc.tenantIds || []).indexOf(t.id) > -1 ? ' checked' : ''}>${esc(t.name)}</label>`).join('')}</div>`)}
      <div class="fs_11 text-muted mt-2">The suggested wording is EPI's own guidance. The BIR has not set rules for service interruptions yet. You can edit it.</div>`,
      IncUI.foot('Send the notice', 'button_inc_nt_go'));
    fill(first);
    $(".select_inc_nk").on("change", function () { fill(this.value); });
    $(".button_inc_nt_go").on("click", () => IncUI.go('IncNotice', { id:inc.id, kind:$(".select_inc_nk").val(), title:$(".input_inc_nt").val(),
      body:$(".input_inc_nb").val(), contingency:$(".input_inc_nc2").val(), tenantIds:$(".check_inc_nt:checked").map((i, e) => e.value).get() }, back));
  });
};
