/* ============================================================
   resilience.js — When transmission goes wrong

   RMC VII.4, VII.8, VII.9, VII.16 to VII.18 and IX.3 ask the same thing from
   different sides: when the link to the BIR (or EPI itself) fails, prove that
   nothing was lost, nothing was sent twice, the taxpayer did what it could,
   and the cause was not the taxpayer's.

     - Interruptions are the system-wide record of an outage. A document that
       fails during one carries the attempt and the interruption reference, so
       the delay cause is traced, not asserted.
     - Reconciliation and duplicate checks answer "is everything accounted for,
       and is anything there twice".
     - The evidence report is the verifiable account of the delayed documents.
       It carries a SHA-256 digest of the data it was built from, and the data
       is embedded in the file, so anyone can recompute it.
     - A problem report is the taxpayer's timely notice. When the delay traces
       to a verified interruption and the report was prompt, EPI issues a
       certificate saying so. Whether any penalty follows is the BIR's call.
     - Manual invoices are the contingency while EPI's own service is down.
       They are recorded, kept out of every sales report until an e-invoice
       exists, and then linked to it.

   The BIR has not said what "timely" means or what contingency procedures it
   prescribes. TIMELY_HOURS and the contingency check are placeholders.
   ============================================================ */

const ResReg = {

  /* Placeholder: the BIR has not prescribed a reporting window. */
  TIMELY_HOURS: 24,

  KINDS: {
    NOT_REACHING: 'Invoices are not reaching the BIR',
    ACK_MISSING:  'An acknowledgment is missing or looks wrong',
    CANNOT_ISSUE: 'Unable to issue: system unavailable',
    OTHER:        'Something else'
  },

  rows(){ return TransReg.rows(); },

  /** One account's documents, for EPI's console, which sits in no account. */
  rowsFor(tenantId){ return Store.db.invoices.filter(i => i.tenantId === tenantId && i.docStatus !== 'DRAFT'); },

  hours(a, b){ return Math.abs(new Date(b) - new Date(a)) / 3600000; },

  hLabel(h){
    if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
    if (h < 48) return `${Math.round(h * 10) / 10} h`;
    return `${Math.round(h / 24)} days`;
  },

  /* ---------- Interruptions ---------- */

  start(source, note){
    const db = Store.db;
    if (activeInterruption()) return { success:false, message:'An interruption is already open.' };
    if (!INTERRUPTION_SOURCES[source]) return { success:false, message:'Select what is down.' };
    db.interruptions = db.interruptions || [];
    const n = db.interruptions.length + 1;
    const int = { id: uid('int'), ref:`INT-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
      source, startedAt:new Date().toISOString(), endedAt:null, note:String(note || '').trim().slice(0, 300),
      /* Declared at once, verified once EPI has checked its monitoring. Only a
         verified interruption can be the cause on a certificate. */
      verified:false, declaredBy:CU ? CU.name : 'EPI network operations' };
    db.interruptions.push(int);
    const inc = IncReg.fromInterruption(int);
    logActivity(db, { actorType:'EPI', action:`Service interruption ${int.ref} opened: ${INTERRUPTION_SOURCES[source].label}` });
    Store.save(db);
    return { success:true, message:`${int.ref} opened, and ${inc.ref} with it. The written report to the BIR is due within ${IncReg.WRITTEN_HOURS} hours. ${INTERRUPTION_SOURCES[source].blocksIssuing
      ? 'Client sales are queued until it is closed.' : 'Issuing still works. Sending to the BIR is held.'}` };
  },

  /** Ending an interruption retries everything that was held, on every account. */
  end(){
    const db = Store.db;
    const int = activeInterruption();
    if (!int) return { success:false, message:'There is no open interruption.' };
    const live = db.interruptions.find(x => x.id === int.id);
    live.endedAt = new Date().toISOString();
    IncReg.restored(live);
    /* Receipts queued during EPI downtime are issued, linked and sent before the retry below. */
    const q = INTERRUPTION_SOURCES[live.source].blocksIssuing ? OutageQueue.flush(live) : null;
    let ok = 0, bad = 0;
    db.invoices.filter(i => i.transmissionStatus === 'QUEUED').forEach(i => {
      if (attemptTransmission(i).ok) ok++; else bad++;
    });
    logActivity(db, { actorType:'EPI', action:`Service interruption ${int.ref} closed after ${this.hLabel(this.hours(live.startedAt, live.endedAt))}` +
      `: ${ok} held invoice(s) acknowledged on retry` + (bad ? `, ${bad} rejected` : '') +
      (q ? `; ${OutageQueue.summary(q)}` : '') });
    Store.save(db);
    return { success:true, message:`${int.ref} closed. ${ok} held invoice(s) went through on retry.` +
      (q ? ` ${OutageQueue.summary(q).replace(/^./, c => c.toUpperCase())}.` : '') };
  },

  /* ---------- Reconciliation ---------- */

  KNOWN: ['QUEUED', 'FAILED', 'REJECTED', 'TRANSMITTED', 'NOT_READY'],

  amount(i){ return (i.totals || {}).totalDue || 0; },

  /** Issued against acknowledged, in documents and in pesos. A document in
      none of the known states is a defect and is counted so it cannot hide. */
  reconcile(rows){
    const all = rows || this.rows();
    const sum = f => round2(all.filter(f).reduce((a, i) => a + this.amount(i), 0));
    return {
      issued: all.length,
      issuedAmt: sum(() => true),
      ackAmt: sum(i => i.transmissionStatus === 'TRANSMITTED'),
      waitingAmt: sum(i => ['QUEUED', 'FAILED', 'REJECTED'].indexOf(i.transmissionStatus) > -1),
      notGoingAmt: sum(i => i.transmissionStatus === 'NOT_READY'),
            unaccounted: all.filter(i => this.KNOWN.indexOf(i.transmissionStatus) === -1).length,
      overdue: all.filter(i => limitInfo(i).state === 'OVERDUE').length,
      late: all.filter(i => limitInfo(i).state === 'LATE').length
    };
  },

  ties(r){ return r.unaccounted === 0 && round2(r.ackAmt + r.waitingAmt + r.notGoingAmt) === r.issuedAmt; },

  /* ---------- Duplicates ---------- */

  group(list, key){
    const m = {};
    list.forEach(i => { const k = key(i); if (k) (m[k] = m[k] || []).push(i); });
    return Object.keys(m).filter(k => m[k].length > 1).map(k => ({ key:k, docs:m[k] }));
  },

  /** Four ways a document can appear twice: the same number, the same
      acknowledgment on two documents, one document acknowledged twice, and
      (as a warning, not a fault) the same buyer and amount minutes apart. */
  duplicates(rows){
    const all = rows || this.rows();
    const out = [];
    this.group(all, i => i.number).forEach(g =>
      out.push({ kind:'NUMBER', label:`Number ${g.key} is on ${g.docs.length} documents`, docs:g.docs }));
    this.group(all, i => i.transmissionRef).forEach(g =>
      out.push({ kind:'ACK', label:`Acknowledgment ${g.key} is on ${g.docs.length} documents`, docs:g.docs }));
    all.forEach(i => {
      const acks = transmissionAttempts(i).filter(a => a.result === 'ACKNOWLEDGED');
      if (acks.length > 1)
        out.push({ kind:'SENT_TWICE', label:`${i.number} was acknowledged ${acks.length} times`, docs:[i] });
    });
    const sales = all.filter(i => i.docType === 'INVOICE' && i.docStatus === 'ISSUED' && i.buyer)
      .sort((a, b) => new Date(a.issuedAt) - new Date(b.issuedAt));
    const seen = {};
    sales.forEach(i => {
      const k = `${String(i.buyer.name).toLowerCase()}|${i.totals.totalDue}`;
      const prev = (seen[k] || []).find(p => this.hours(p.issuedAt, i.issuedAt) <= 10 / 60);
      if (prev) out.push({ kind:'LIKELY', label:`${i.number} and ${prev.number}: same buyer, same amount, within 10 minutes`,
                           docs:[prev, i], warn:true });
      (seen[k] = seen[k] || []).push(i);
    });
    return out;
  },

  /* ---------- Manual invoices ---------- */

  manuals(tenantId){
    const id = tenantId || CT.id;
    return (Store.db.manualInvoices || []).filter(m => m.tenantId === id)
      .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  },

  /** Numbers with the same letters in front and a number behind, in one run:
      anything missing from the run is a booklet page nobody has accounted for. */
  manualGaps(){
    const runs = {};
    this.manuals().forEach(m => {
      const x = /^(.*?)(\d+)$/.exec(m.manualNo);
      if (x) (runs[x[1]] = runs[x[1]] || []).push({ n:parseInt(x[2], 10), w:x[2].length });
    });
    const out = [];
    Object.keys(runs).forEach(pre => {
      const ns = runs[pre].map(r => r.n).sort((a, b) => a - b), w = runs[pre][0].w;
      const have = new Set(ns), gone = [];
      for (let n = ns[0]; n <= ns[ns.length - 1]; n++) if (!have.has(n)) gone.push(pre + String(n).padStart(w, '0'));
      if (gone.length) out.push({ prefix:pre, missing:gone });
    });
    return out;
  },

  /** Store one validated manual invoice. `v` is IssueReg.validate()'s result. */
  record(p, v){
    const db = Store.db;
    const m = { id: uid('man'), tenantId: CT.id, branchId: v.branch.id, manualNo: String(p.manualNo).trim(),
      issuedAt: v.at.toISOString(), recordedAt: new Date().toISOString(), recordedBy: CU.name, recordedById: CU.id,
      buyer: v.buyer, totals: v.totals,
      interruptionId: p.interruptionId || null, reasonNote: String(p.reasonNote || '').trim().slice(0, 200) || null,
      scanName: String(p.scanName || '').trim() || null,
      status:'RECORDED', linkedInvoiceId:null, linkedAt:null,
      params: { branchId:p.branchId, at:p.at, buyer:p.buyer, scpwd:p.scpwd, lines:p.lines, discount:p.discount,
                ewtRate:p.ewtRate, paymentStatus:p.paymentStatus, paymentMethod:p.paymentMethod, terms:p.terms } };
    db.manualInvoices = db.manualInvoices || [];
    db.manualInvoices.push(m);
    return m;
  },

  /* ---------- Upload: a file of manual invoices ---------- */

  COLUMNS: ['manual_no', 'issued_at', 'branch_code', 'buyer_name', 'buyer_tin', 'buyer_address',
            'interruption_ref', 'reason', 'payment_status', 'payment_method', 'terms', 'sku', 'qty', 'unit_price'],

  /** All or nothing, as Bulk Import is: one fault anywhere and nothing is recorded,
      so the file can be fixed and sent again whole. */
  parseUpload(raw){
    const rows = ImportReg.parseCsv(raw || '');
    if (!rows.length) return { fatal:'The file is empty.' };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const missing = this.COLUMNS.filter(c => header.indexOf(c) === -1);
    if (missing.length) return { fatal:`Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.` };
    const ix = {}; this.COLUMNS.forEach(c => ix[c] = header.indexOf(c));
    const items = IssueReg.items(), branches = Auth.visibleBranches();
    const cell = (r, c) => String(r[ix[c]] || '').trim();
    const groups = {};

    rows.slice(1).forEach((r, n) => {
      const no = cell(r, 'manual_no');
      const key = no ? no.toLowerCase() : `__blank_${n}`;
      (groups[key] = groups[key] || { no, rows:[], errors:[], first:n + 2 }).rows.push({ r, line:n + 2 });
    });

    const list = Object.keys(groups).map(k => {
      const g = groups[k], first = g.rows[0].r;
      const fail = e => g.errors.push(e);
      if (!g.no) fail(`Row ${g.first}: manual_no is blank, so rows cannot be grouped into an invoice`);
      const at = ImportReg.parseStamp(cell(first, 'issued_at'));
      if (!at) fail(`issued_at "${cell(first, 'issued_at')}" is not YYYY-MM-DD HH:MM`);
      const branch = branches.find(b => b.code === cell(first, 'branch_code'));
      if (!branch) fail(`branch_code "${cell(first, 'branch_code')}" is not a branch you can issue from`);

      let int = null;
      const ref = cell(first, 'interruption_ref');
      if (ref){ int = interruptions().find(x => x.ref.toLowerCase() === ref.toLowerCase()); if (!int) fail(`interruption_ref "${ref}" is not a recorded interruption`); }

      const lines = [];
      g.rows.forEach(({ r, line }) => {
        const sku = cell(r, 'sku'), it = items.find(x => x.sku === sku);
        if (!it){ fail(`Row ${line}: sku "${sku}" is not an item on this account`); return; }
        const price = cell(r, 'unit_price');
        lines.push({ itemId:it.id, qty:cell(r, 'qty'), unitPrice: price === '' ? it.price : price, scEligible:false });
      });
      ['buyer_name', 'buyer_tin', 'branch_code', 'issued_at'].forEach(c => {
        if (g.rows.some(x => cell(x.r, c) !== cell(first, c))) fail(`Rows under "${g.no}" disagree on ${c}`);
      });

      const params = { manualNo:g.no, branchId: branch ? branch.id : '',
        at: at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}T${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '',
        buyer:{ name:cell(first, 'buyer_name'), tin:cell(first, 'buyer_tin'), address:cell(first, 'buyer_address') },
        lines, discount:0, ewtRate:0, interruptionId: int ? int.id : '', reasonNote:cell(first, 'reason'),
        paymentStatus:cell(first, 'payment_status').toUpperCase() || 'PAID', paymentMethod:cell(first, 'payment_method'),
        terms:cell(first, 'terms') };
      let v = null;
      if (!g.errors.length){
        v = IssueReg.validate(params);
        v.errors.forEach(fail);
        if (g.no) this.validateManual(params).forEach(fail);
      }
      return { no:g.no, errors:g.errors, params, v, ok:!g.errors.length };
    });

    const bad = list.filter(g => !g.ok);
    return { groups:list, rejected:bad, importable: !bad.length && list.length > 0, rowCount:rows.length - 1,
             total: list.filter(g => g.v).reduce((a, g) => a + g.v.totals.totalDue, 0) };
  },

  sample(){
    const items = IssueReg.items(), br = Auth.visibleBranches()[0];
    const int = interruptions().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
    const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v;
    const d = new Date(); d.setHours(d.getHours() - 2, 0, 0, 0);
    const at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`;
    const it = n => items[Math.min(n, items.length - 1)] || { sku:'SKU', price:100 };
    const rows = [this.COLUMNS,
      ['MI-0501', at, br ? br.code : '000', 'Northgate Facilities Management Inc.', '221-556-903', '8F Northgate Tower, Alabang', int ? int.ref : '', int ? '' : 'System down', 'PAID', 'Cash', '', it(0).sku, 2, ''],
      ['MI-0501', at, br ? br.code : '000', 'Northgate Facilities Management Inc.', '221-556-903', '8F Northgate Tower, Alabang', int ? int.ref : '', int ? '' : 'System down', 'PAID', 'Cash', '', it(1).sku, 1, ''],
      ['MI-0502', at, br ? br.code : '000', 'Walk-in Customer', '', '', int ? int.ref : '', int ? '' : 'System down', 'PAID', 'Cash', '', it(0).sku, 1, '']];
    return rows.map(r => r.map(q).join(',')).join('\n');
  },

  /** An e-invoice that could be the e-copy of this manual invoice: same total, not already spoken for. */
  candidates(m){
    const taken = new Set((Store.db.manualInvoices || []).map(x => x.linkedInvoiceId).filter(Boolean));
    return Store.db.invoices.filter(i => i.tenantId === CT.id && i.docType === 'INVOICE' && i.docStatus === 'ISSUED' &&
      !i.manualRef && !taken.has(i.id) && Math.abs(i.totals.totalDue - m.totals.totalDue) < 0.005)
      .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  },

  validateManual(p){
    const errors = [];
    const no = String(p.manualNo || '').trim();
    if (!no) errors.push('The number printed on the manual invoice is required.');
    else if ((Store.db.manualInvoices || []).some(m => m.tenantId === CT.id && m.manualNo.toLowerCase() === no.toLowerCase()))
      errors.push(`Manual invoice ${no} is already recorded.`);
    if (p.interruptionId && !interruptionById(p.interruptionId)) errors.push('Select the interruption from the list.');
    if (!p.interruptionId && !String(p.reasonNote || '').trim())
      errors.push('Enter the reason this was issued by hand, or select the interruption.');
    return errors;
  },

  /* ---------- Problem reports ---------- */

  reports(){
    return (Store.db.problemReports || []).filter(r => r.tenantId === CT.id)
      .sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt));
  },

  docsFor(ids){
    const set = new Set(ids);
    return Store.db.invoices.filter(i => set.has(i.id));
  },

  /** Does the evidence support a certificate? Three tests, each stated with
      what it found, so a refusal says what to do differently. */
  assess(r){
    const docs = this.docsFor(r.docIds);
    const infos = docs.map(d => ({ d, x:delayInfo(d) }));
    const delayed = infos.filter(z => z.x.delayed);
    const int = r.interruptionId ? interruptionById(r.interruptionId) : (delayed[0] && delayed[0].x.interruption) || null;
    const checks = [];

    let causeOk, causeNote;
    if (docs.length){
      const bad = delayed.filter(z => z.x.cause !== 'PROVIDER');
      causeOk = delayed.length > 0 && !bad.length;
      causeNote = !delayed.length ? 'None of these invoices was delayed beyond ' + TRANSMIT_DELAY_HOURS + ' hour. There is nothing to certify.'
        : bad.length ? `${bad.map(z => z.d.number).join(', ')} ${bad.length === 1 ? 'was' : 'were'} held up for a reason on the taxpayer\'s side (${bad[0].x.label.toLowerCase()}).`
        : `${delayed.length} delayed invoice(s), all traced to a verified interruption (${[...new Set(delayed.map(z => z.x.interruption.ref))].join(', ')}).`;
    } else {
      causeOk = !!(int && int.verified);
      causeNote = causeOk ? `Traced to ${int.ref}, ${INTERRUPTION_SOURCES[int.source].label.toLowerCase()}, verified by EPI.`
                          : 'No verified interruption covers the time you noticed the problem.';
    }
    checks.push({ key:'CAUSE', label:'The cause was not the taxpayer\'s', ok:causeOk, detail:causeNote });

    const firstFail = delayed.length
      ? Math.min.apply(null, delayed.map(z => new Date((transmissionAttempts(z.d).find(a => a.result === 'FAILED') || { at:z.d.recordedAt || z.d.issuedAt }).at)))
      : (int ? new Date(int.startedAt).getTime() : null);
    const gap = firstFail ? this.hours(firstFail, r.reportedAt) : null;
    const timely = gap !== null && gap <= this.TIMELY_HOURS;
    checks.push({ key:'TIMELY', label:'The incident was reported in time', ok:timely,
      detail: gap === null ? 'There is no failure to measure from.'
        : `Reported ${this.hLabel(gap)} after the first failure. Placeholder window: ${this.TIMELY_HOURS} hours (the BIR has not set one).` });

    const manualN = this.manuals(r.tenantId).filter(m => m.interruptionId && int && m.interruptionId === int.id).length;
    const esp = int && int.source === 'ESP';
    checks.push({ key:'CONTINGENCY', label:'Contingency steps were followed', ok:true,
      detail: esp ? (manualN ? `${manualN} manual invoice(s) recorded for ${int.ref}.`
                              : 'No manual invoices are recorded for this interruption. If you issued any by hand, record them.')
                  : 'Invoices were held and sent again automatically. No manual action was needed.' });

    return { eligible: checks.every(c => c.ok), checks, interruptionId: int ? int.id : null };
  },

  file(p){
    const db = Store.db;
    const kind = this.KINDS[p.kind] ? p.kind : 'OTHER';
    const reportedAt = new Date().toISOString();
    const noticed = p.noticedAt ? new Date(p.noticedAt) : new Date();
    if (isNaN(noticed.getTime())) return { success:false, message:'The time you noticed it is not valid.' };
    if (noticed.getTime() > Date.now() + 60000) return { success:false, message:'The date and time cannot be in the future.' };
    if (!String(p.description || '').trim()) return { success:false, message:'Describe the problem.' };

    let ids = [];
    const rows = this.rows();
    if (p.scope === 'WAITING') ids = rows.filter(i => ['QUEUED', 'FAILED', 'REJECTED'].indexOf(i.transmissionStatus) > -1).map(i => i.id);
    else if (p.scope === 'DELAYED') ids = rows.filter(i => delayInfo(i).delayed).map(i => i.id);
    else if (p.scope === 'LISTED'){
      const wanted = String(p.numbers || '').split(/[,\s]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      const hit = rows.filter(i => wanted.indexOf(String(i.number).toLowerCase()) > -1);
      const miss = wanted.filter(w => !hit.some(i => i.number.toLowerCase() === w));
      if (!wanted.length) return { success:false, message:'List at least one invoice number.' };
      if (miss.length) return { success:false, message:`No invoice numbered ${miss.join(', ')} on this account.` };
      ids = hit.map(i => i.id);
    }
    if (kind !== 'CANNOT_ISSUE' && p.scope !== 'NONE' && !ids.length)
      return { success:false, message:'No invoices match the selection. Select another set.' };

    const covering = (db.interruptions || []).filter(x => new Date(x.startedAt) <= noticed && (!x.endedAt || new Date(x.endedAt) >= noticed))
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
    const n = (db.problemReports || []).length + 1;
    const r = { id: uid('pr'), ref:`PR-${new Date().getFullYear()}-${String(n).padStart(4, '0')}`,
      tenantId: CT.id, reportedAt, reportedBy: CU.name, noticedAt: noticed.toISOString(),
      kind, docIds: kind === 'CANNOT_ISSUE' && p.scope === 'NONE' ? [] : ids,
      description: String(p.description).trim().slice(0, 1000), interruptionId: covering ? covering.id : null };
    /* The first reading is kept for the reviewer. EPI decides on the
       certificate once it has confirmed the facts; timeliness is still
       measured to the moment the report was filed, not reviewed. */
    r.assessment = this.assess(r);
    r.interruptionId = r.assessment.interruptionId || r.interruptionId;
    r.status = 'UNDER_REVIEW';
    db.problemReports = db.problemReports || [];
    db.problemReports.push(r);
    logActivity(db, { action:`Problem ${r.ref} reported: ${this.KINDS[kind]}, ${r.docIds.length} invoice(s). EPI is reviewing it` });
    Store.save(db);
    return { success:true, id:r.id, message:`${r.ref} filed. EPI reviews it and issues a certificate if the facts support one.` };
  },

  /** EPI's review: the checks are run again on what is known now (an
      interruption may have been verified since), and the certificate is
      issued only if all three pass. */
  confirm(id, note){
    const db = Store.db;
    const r = (db.problemReports || []).find(x => x.id === id);
    if (!r || r.status === 'CONFIRMED') return { success:false, message:'That report has already been reviewed.' };
    const now = new Date().toISOString();
    r.assessment = this.assess(r);
    r.interruptionId = r.assessment.interruptionId || r.interruptionId;
    r.status = 'CONFIRMED';
    r.review = { by:CU.name, at:now, note:String(note || '').trim().slice(0, 300) };
    if (r.assessment.eligible){
      const issued = db.problemReports.filter(x => x.certificate).length + 1;
      r.certificate = { ref:`EPI-CERT-${new Date().getFullYear()}-${String(issued).padStart(4, '0')}`, issuedAt:now };
    }
    logActivity(db, { tenantId:r.tenantId, actorType:'EPI', action:`EPI reviewed problem ${r.ref}` +
      (r.certificate ? `; certificate ${r.certificate.ref} issued` : '; no certificate, the checks did not all pass') });
    Store.save(db);
    return { success:true, message: r.certificate ? `${r.ref} confirmed. Certificate ${r.certificate.ref} issued.`
                                                  : `${r.ref} reviewed. No certificate: ${r.assessment.checks.filter(c => !c.ok).map(c => c.label.toLowerCase()).join('; ')}.` };
  },

  /** EPI confirms from its monitoring that the interruption really happened. */
  verify(id, note){
    const db = Store.db;
    const int = (db.interruptions || []).find(x => x.id === id);
    if (!int || int.verified) return { success:false, message:'That interruption is already verified.' };
    if (!String(note || '').trim()) return { success:false, message:'Enter what confirms it (for example, the monitoring alert).' };
    Object.assign(int, { verified:true, verifiedBy:CU.name, verifiedAt:new Date().toISOString(), verifyNote:String(note).trim().slice(0, 300) });
    logActivity(db, { actorType:'EPI', action:`Interruption ${int.ref} verified: ${int.verifyNote}` });
    Store.save(db);
    return { success:true, message:`${int.ref} verified. Delays it caused now count as provider-caused.` };
  },

  /* ---------- Evidence and certificate documents ---------- */

  async sha256(text){
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) { return 'unavailable'; }
  },

  /** Everything the evidence report states, as plain data. The digest is taken
      over this, so the file can be checked against its own numbers. */
  evidenceData(){
    const docs = this.rows().map(i => ({ i, x:delayInfo(i) })).filter(z => z.x.delayed)
      .sort((a, b) => new Date(a.i.issuedAt) - new Date(b.i.issuedAt));
    const ints = [...new Set(docs.map(z => z.x.interruption && z.x.interruption.id).filter(Boolean))].map(id => interruptionById(id));
    return {
      taxpayer: { name:CT.name, tin:CT.tin },
      documents: docs.map(z => ({
        number: z.i.number, issuedAt: z.i.issuedAt, recordedAt: z.i.recordedAt || z.i.issuedAt,
                sendBy: transmitBy(z.i), limit: limitInfo(z.i).state, status: z.i.transmissionStatus, acknowledgment: z.i.transmissionRef || null,
        acknowledgedAt: z.i.transmittedAt || null,
        delayHours: Math.round(z.x.hours * 10) / 10, cause: z.x.cause, causeLabel: z.x.label,
        attempts: transmissionAttempts(z.i).map(a => ({ at:a.at, result:a.result, cause:a.cause, interruption:a.interruptionId ? (interruptionById(a.interruptionId) || {}).ref : null, detail:a.detail }))
      })),
      interruptions: ints.map(n => ({ ref:n.ref, source:n.source, startedAt:n.startedAt, endedAt:n.endedAt, verified:n.verified, note:n.note }))
    };
  },

  pageShell(title, body, dataJson, digest){
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;color:#1a1d21;max-width:860px;margin:32px auto;padding:0 20px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#555;margin:26px 0 8px}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{font-size:11.5px;color:#555}.mono{font-family:ui-monospace,Menlo,monospace}.muted{color:#666}.ok{color:#17803d}.no{color:#b3261e}
.note{border:1px solid #d9b34a;background:#fdf6df;padding:8px 12px;border-radius:6px;font-size:12.5px;margin:14px 0}
footer{margin-top:28px;padding-top:12px;border-top:1px solid #bbb;font-size:12px;color:#555;word-break:break-all}</style></head><body>
${body}
<footer>Digest (SHA-256 of the data below): <span class="mono">${esc(digest)}</span><br>
Generated ${esc(fmtDateTime(new Date().toISOString()))} by ${esc(SYSTEM.product)} v${esc(SYSTEM.version)}. Clock: ${esc(SYSTEM.timeSync.source)}.
${SYSTEM.status === 'DEMONSTRATION' ? '<br><strong>Demonstration system. Not yet accredited by the BIR. Nothing here is a BIR document.</strong>' : ''}</footer>
<script type="application/json" id="evidence-data">${dataJson.replace(/</g, '\\u003c')}</script></body></html>`;
  },

  async evidenceHtml(){
    const d = this.evidenceData();
    const json = JSON.stringify(d);
    const digest = await this.sha256(json);
    const prov = d.documents.filter(x => x.cause === 'PROVIDER').length;
    const body = `<h1>Evidence of attempted transmission</h1>
<div class="muted">${esc(d.taxpayer.name)} · TIN ${esc(d.taxpayer.tin)}</div>
<div class="note">${d.documents.length ? `${d.documents.length} invoice(s) waited more than ${TRANSMIT_DELAY_HOURS} hour to be acknowledged, EPI's own target.
<strong>${prov}</strong> traced to a verified interruption; <strong>${d.documents.length - prov}</strong> did not.
<strong>${d.documents.filter(x => x.limit === 'LATE' || x.limit === 'OVERDUE').length}</strong> went past the BIR limit of ${TRANSMIT_LIMIT_DAYS} calendar days from the sale.` : 'No invoice on this account was delayed beyond the target.'}
 The BIR limit is ${TRANSMIT_LIMIT_DAYS} calendar days from the sale.</div>
<h2>Interruptions</h2>
${d.interruptions.length ? `<table><tr><th>Ref</th><th>What was down</th><th>From</th><th>To</th><th>Verified by EPI</th></tr>
${d.interruptions.map(n => `<tr><td class="mono">${esc(n.ref)}</td><td>${esc(INTERRUPTION_SOURCES[n.source].label)}</td><td>${esc(fmtDateTime(n.startedAt))}</td><td>${n.endedAt ? esc(fmtDateTime(n.endedAt)) : 'still open'}</td><td>${n.verified ? 'Yes' : 'No'}</td></tr>`).join('')}</table>` : '<div class="muted">None are linked to a delayed invoice.</div>'}
<h2>Delayed documents</h2>
${d.documents.length ? `<table><tr><th>Invoice</th><th>Recorded</th><th>Send by</th><th>Acknowledged</th><th>Delay</th><th>Attempts</th><th>Cause</th></tr>
${d.documents.map(x => `<tr><td class="mono">${esc(x.number)}</td><td>${esc(fmtDateTime(x.recordedAt))}</td><td>${esc(fmtDate(x.sendBy + 'T12:00:00+08:00'))}${x.limit === 'LATE' || x.limit === 'OVERDUE' ? ' <span class="no">past the limit</span>' : ''}</td>
<td>${x.acknowledgedAt ? esc(fmtDateTime(x.acknowledgedAt)) + `<br><span class="mono muted">${esc(x.acknowledgment || '')}</span>` : '<span class="no">not yet</span>'}</td>
<td>${esc(this.hLabel(x.delayHours))}</td><td>${x.attempts.length}</td><td>${esc(x.causeLabel)}</td></tr>`).join('')}</table>
<h2>Every attempt</h2>
<table><tr><th>Document</th><th>Time</th><th>Result</th><th>Cause</th><th>Detail</th></tr>
${d.documents.map(x => x.attempts.map(a => `<tr><td class="mono">${esc(x.number)}</td><td>${esc(fmtDateTime(a.at))}</td><td>${esc(a.result.toLowerCase())}</td><td>${esc(a.interruption || (a.cause === 'NONE' ? '—' : a.cause))}</td><td>${esc(a.detail || '')}</td></tr>`).join('')).join('')}</table>` : ''}`;
    return { html:this.pageShell('Evidence of attempted transmission', body, json, digest), digest, data:d };
  },

  evidenceCsv(d){
    const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const head = ['Document', 'Recorded', 'Delay (hours)', 'Cause', 'Attempt time', 'Result', 'Interruption', 'Detail'];
    const rows = [];
    d.documents.forEach(x => x.attempts.forEach(a => rows.push([x.number, x.recordedAt, x.delayHours, x.causeLabel, a.at, a.result, a.interruption || '', a.detail || ''])));
    return [head].concat(rows).map(r => r.map(q).join(',')).join('\n');
  },

  async certificateHtml(r){
    const docs = this.docsFor(r.docIds);
    const a = r.assessment || this.assess(r);
    const int = a.interruptionId ? interruptionById(a.interruptionId) : null;
    const data = { certificate:r.certificate, report:r.ref, taxpayer:{ name:CT.name, tin:CT.tin },
      reportedAt:r.reportedAt, noticedAt:r.noticedAt,
      interruption: int ? { ref:int.ref, source:int.source, startedAt:int.startedAt, endedAt:int.endedAt } : null,
      documents: docs.map(d => ({ number:d.number, status:d.transmissionStatus, acknowledgment:d.transmissionRef || null,
                                  delayHours:Math.round(delayInfo(d).hours * 10) / 10 })) };
    const json = JSON.stringify(data);
    const digest = await this.sha256(json);
    const body = `<h1>Certificate of provider-caused delay</h1>
<div class="muted">${esc(r.certificate.ref)} · issued ${esc(fmtDateTime(r.certificate.issuedAt))}</div>
<p>${esc(SYSTEM.vendor)} certifies from its own records that the transmission delay reported by
<strong>${esc(CT.name)}</strong> (TIN ${esc(CT.tin)}) in report <span class="mono">${esc(r.ref)}</span> traces to
${int ? `<strong>${esc(INTERRUPTION_SOURCES[int.source].label)}</strong>, interruption <span class="mono">${esc(int.ref)}</span>,
from ${esc(fmtDateTime(int.startedAt))} to ${int.endedAt ? esc(fmtDateTime(int.endedAt)) : 'a time not yet closed'}` : 'a verified interruption'}.</p>
<h2>What the records show</h2>
<table>${a.checks.map(c => `<tr><td class="${c.ok ? 'ok' : 'no'}">${c.ok ? 'Yes' : 'No'}</td><td><strong>${esc(c.label)}</strong><br><span class="muted">${esc(c.detail)}</span></td></tr>`).join('')}</table>
${docs.length ? `<h2>Documents</h2><table><tr><th>Document</th><th>State</th><th>Acknowledgment</th></tr>
${docs.map(d => `<tr><td class="mono">${esc(d.number)}</td><td>${esc((STATUS.transmission[d.transmissionStatus] || {}).label || d.transmissionStatus)}</td><td class="mono">${esc(d.transmissionRef || '—')}</td></tr>`).join('')}</table>` : ''}
<div class="note">This certificate states facts from EPI's records. It does not decide whether any penalty applies, and it does not affect the assessment or collection of the correct tax. That decision belongs to the BIR.</div>`;
    return { html:this.pageShell('Certificate of provider-caused delay', body, json, digest), digest };
  },

  save(name, mime, text){
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: mime }));
    link.download = name;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  }
};

/* ============================================================
   Handlers
   ============================================================ */

LocalAPI.on("Dashboard/InterruptionStart", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can declare an interruption.' };
  return ResReg.start(p.source, p.note);
});
LocalAPI.on("Dashboard/InterruptionEnd", function () {
  if (!can('operate')) return { success:false, message:'Only EPI operations can close an interruption.' };
  return ResReg.end();
});
LocalAPI.on("Dashboard/InterruptionVerify", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can verify an interruption.' };
  return ResReg.verify(p.id, p.note);
});
LocalAPI.on("Dashboard/ProblemConfirm", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can review a report.' };
  return ResReg.confirm(p.id, p.note);
});
LocalAPI.on("Dashboard/ProblemReport", function (p) {
  if (!can('issue') && !can('users')) return { success:false, message:'Your role cannot report a problem.' };
  return ResReg.file(p);
});

LocalAPI.on("Dashboard/ManualRecord", function (p) {
  if (!can('issue')) return { success:false, message:'Your role cannot record invoices.' };
  if (issuesOnOwnSystem())
    return { success:false, message:'This account only sends the sales data from your own system to the BIR. It does not issue invoices itself.' };
  const v = IssueReg.validate(p);
  const errors = ResReg.validateManual(p).concat(v.errors);
  if (errors.length) return { success:false, message:errors[0], errors };

  const db = Store.db;
  const m = ResReg.record(p, v);
  logActivity(db, { action:`Recorded manual invoice ${m.manualNo} for ${v.buyer.name}, ${peso(v.totals.totalDue)}` +
    (m.interruptionId ? ` (${interruptionById(m.interruptionId).ref})` : '') });
  Store.save(db);
  return { success:true, id:m.id, message: m.interruptionId && outageQueueing()
    ? `Manual invoice ${m.manualNo} recorded. Its e-invoice is issued, linked and sent to the buyer when service returns.`
    : `Manual invoice ${m.manualNo} recorded. Issue its e-invoice from the Manual invoices tab.` };
});

LocalAPI.on("Dashboard/ManualLink", function (p) {
  const db = Store.db;
  const m = (db.manualInvoices || []).find(x => x.id === p.id && x.tenantId === CT.id);
  if (!m) return { success:false, message:'That manual invoice is not on this account.' };
  if (m.status === 'LINKED') return { success:false, message:'It is already linked to an e-invoice.' };
  if (!can('issue')) return { success:false, message:'Your role cannot issue invoices.' };
  const res = IssueReg.issue(m.params, {
    issuedVia: `Manual invoice ${m.manualNo}`,
    manualRef: { id:m.id, no:m.manualNo, issuedAt:m.issuedAt, interruptionId:m.interruptionId }
  });
  if (!res.success) return res;
  const live = db.manualInvoices.find(x => x.id === m.id);
  live.status = 'LINKED'; live.linkedInvoiceId = res.id; live.linkedAt = new Date().toISOString();
  logActivity(db, { action:`Linked manual invoice ${m.manualNo} to e-invoice ${res.number}` });
  Store.save(db);
  return { success:true, id:res.id, message:`${m.manualNo} is now linked to ${res.number}.` };
});

LocalAPI.on("Dashboard/ManualUpload", function (p) {
  if (!can('issue')) return { success:false, message:'Your role cannot record invoices.' };
  if (issuesOnOwnSystem())
    return { success:false, message:'This account only sends the sales data from your own system to the BIR. It does not issue invoices itself.' };
  const r = ResReg.parseUpload(p.csv);
  if (r.fatal) return { success:false, message:r.fatal };
  if (!r.importable) return { success:false, message:`${r.rejected.length} invoice(s) in the file have faults. Nothing was recorded.` };
  const db = Store.db;
  r.groups.forEach(g => ResReg.record(g.params, g.v));
  logActivity(db, { action:`Uploaded ${r.groups.length} manual invoice(s) from a file, ${peso(r.total)}` });
  Store.save(db);
  return { success:true, message:`${r.groups.length} manual invoice(s) recorded.` };
});

LocalAPI.on("Dashboard/ManualLinkExisting", function (p) {
  const db = Store.db;
  const m = (db.manualInvoices || []).find(x => x.id === p.id && x.tenantId === CT.id);
  if (!m) return { success:false, message:'That manual invoice is not on this account.' };
  if (m.status === 'LINKED') return { success:false, message:'It is already linked to an e-invoice.' };
  if (!can('issue')) return { success:false, message:'Your role cannot link invoices.' };
  const inv = ResReg.candidates(m).find(i => i.id === p.invoiceId);
  if (!inv) return { success:false, message:'That e-invoice cannot be linked: it must be an issued invoice of the same total that no manual invoice is linked to.' };
  const live = db.manualInvoices.find(x => x.id === m.id);
  live.status = 'LINKED'; live.linkedInvoiceId = inv.id; live.linkedAt = new Date().toISOString();
  logActivity(db, { action:`Linked manual invoice ${m.manualNo} to existing e-invoice ${inv.number}` });
  Store.save(db);
  return { success:true, message:`${m.manualNo} is now linked to ${inv.number}.` };
});

/** The manual invoice an e-invoice stands in for, if any. An invoice that was issued
    from the record carries it; one linked afterwards is found from the record. */
function manualFor(inv){
  if (inv.manualRef) return inv.manualRef;
  const m = (Store.db.manualInvoices || []).find(x => x.linkedInvoiceId === inv.id);
  return m ? { id:m.id, no:m.manualNo, issuedAt:m.issuedAt, interruptionId:m.interruptionId } : null;
}

/* ============================================================
   Screen pieces, painted into the Transmission tab and the Manual tab
   ============================================================ */

const ResUI = {

  text(s){ return $('<div>').text(s).html(); },

  /** A modal that is a document: it has its own buttons, so the confirm
      button the library draws is off. */
  show(html, buttonsHtml){
    Swal.fire({
      html: `<div class="text-start">${html}</div><div class="d-flex justify-content-end gap-2 mt-3">${buttonsHtml}
             <button class="lbtn lbtn-ghost res_close">Close</button></div>`,
      showConfirmButton:false, width:'46rem', customClass:{ popup:'rounded-4' },
      didOpen: () => { $(".res_close").off("click").on("click", () => Swal.close()); }
    });
  },

  upload(){
    let raw = '';
    this.show(`<h5 class="fw-bold mb-2">Upload manual invoices</h5>
      <div class="fs_13 text-muted mb-2">One row per line item. Rows with the same manual number make one invoice. Prices left blank take the item's price.
        Nothing is recorded unless every invoice in the file is valid.</div>
      <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
        <input type="file" accept=".csv,text/csv" class="form-control form-control-sm w-auto input_manual_file">
        <button class="lbtn lbtn-sm lbtn-ghost button_manual_sample">Download a template</button>
      </div>
      <div class="div_manual_result"></div>`,
      '<button class="lbtn lbtn-accent button_manual_commit" disabled>Record them</button>');
    const check = () => {
      const r = ResReg.parseUpload(raw), $r = $(".div_manual_result");
      $(".button_manual_commit").prop("disabled", !r.importable);
      if (r.fatal){ $r.html(Callout('danger', esc(r.fatal))); return; }
      $r.html(r.importable
        ? Callout('success', `<strong>${r.groups.length} manual invoice(s), ${peso(r.total)}.</strong> Ready to record.`)
        : Callout('danger', `<strong>${r.rejected.length} of ${r.groups.length} invoice(s) have faults. Nothing will be recorded.</strong>
            <ul class="mb-0 ps-3 fs_12">${r.rejected.slice(0, 6).map(g => g.errors.slice(0, 2).map(e => `<li>${esc(g.no || 'blank')}: ${esc(e)}</li>`).join('')).join('')}</ul>`));
    };
    $(".input_manual_file").on("change", function () {
      const f = this.files && this.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = e => { raw = String(e.target.result || ''); check(); };
      rd.readAsText(f);
    });
    $(".button_manual_sample").on("click", () => ResReg.save('manual-invoices-template.csv', 'text/csv', ResReg.sample()));
    $(".button_manual_commit").on("click", function () {
      $.ajax({ url:"/Portal/SPIStradcom/Dashboard/ManualUpload", method:"POST", dataType:"json", data:{ csv:raw } }).done(function (res) {
        Swal.close();
        DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
        if (res.success) ManualScreen();
      });
    });
  },

  linkExisting(id){
    const m = ResReg.manuals().find(x => x.id === id);
    if (!m) return;
    const c = ResReg.candidates(m);
    this.show(`<h5 class="fw-bold mb-2">Link ${esc(m.manualNo)} to an e-invoice</h5>
      <div class="fs_13 text-muted mb-2">${peso(m.totals.totalDue)} to ${esc(m.buyer.name)}. Only issued invoices of the same total that are not already linked are listed.</div>
      ${c.length ? `<select class="form-select form-select-sm select_manual_target">${c.map(i =>
          `<option value="${esc(i.id)}">${esc(i.number)} · ${esc(i.buyer ? i.buyer.name : '')} · ${esc(fmtDate(i.issuedAt))}</option>`).join('')}</select>`
        : Callout('warn', 'No issued invoice has this total. Use "Issue e-invoice" to create one from the record.')}`,
      c.length ? '<button class="lbtn lbtn-accent button_manual_dolink">Link them</button>' : '');
    $(".button_manual_dolink").on("click", function () {
      $.ajax({ url:"/Portal/SPIStradcom/Dashboard/ManualLinkExisting", method:"POST", dataType:"json",
               data:{ id, invoiceId:$(".select_manual_target").val() } }).done(function (res) {
        Swal.close();
        DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
        if (res.success) ManualScreen();
      });
    });
  },

  paintTransmission(){
    if (!$(".div_trans_reconcile").length) return;
    const can_ = can('issue') || can('users');

    /* Reconciliation */
    const r = ResReg.reconcile(), t = TransReg.reconcile();
    const tie = ResReg.ties(r);
    $(".div_trans_reconcile").html(`
      <div class="fs_12 ${tie ? 'text-muted' : 'text-danger'}">
        <strong class="text-dark mono">${num(r.issuedAmt)}</strong> issued
        = <strong class="text-dark mono">${num(r.ackAmt)}</strong> acknowledged
        + <strong class="text-dark mono">${num(r.waitingAmt)}</strong> waiting
        + <strong class="text-dark mono">${num(r.notGoingAmt)}</strong> cancelled before sending
        <span class="ms-2">(${t.issued} documents = ${t.acknowledged} + ${t.waiting} + ${t.notGoing})</span>
        ${tie ? '<i class="bi bi-check-circle text-success ms-1"></i>'
              : `<span class="fw-semibold ms-1">Does not tie${r.unaccounted ? `: ${r.unaccounted} invoice(s) in no known state` : ''}.</span>`}
      </div>`);

    /* Duplicate and manual checks */
    const dups = ResReg.duplicates();
        const manualOpen = ResReg.manuals().filter(m => m.status !== 'LINKED').length;
    $(".div_trans_limit").html(r.overdue ? Callout('danger', `<strong>${r.overdue} invoice${r.overdue === 1 ? ' is' : 's are'} past the ${TRANSMIT_LIMIT_DAYS}-day limit.</strong> Every invoice must reach the BIR within ${TRANSMIT_LIMIT_DAYS} calendar days of the sale. Send ${r.overdue === 1 ? 'it' : 'them'} now.`) : '');
    $(".div_trans_checks").html(`
      <strong class="fs_13 text-secondary fw-bold d-block mb-2">CHECKS</strong>
      ${dups.length ? dups.map(x => `<div class="fs_13 mb-1"><i class="bi ${x.warn ? 'bi-exclamation-triangle text-warning' : 'bi-x-circle text-danger'} me-1"></i>${esc(x.label)}</div>`).join('')
        : '<div class="fs_13 text-success"><i class="bi bi-check-circle me-1"></i>No duplicate numbers, acknowledgments or double sends.</div>'}
            ${r.overdue ? '' : `<div class="fs_13 text-success mt-1"><i class="bi bi-check-circle me-1"></i>No invoice is past the ${TRANSMIT_LIMIT_DAYS}-day limit.${r.late ? ` ${r.late} went after the limit and were acknowledged late.` : ''}</div>`}
      ${manualOpen ? `<div class="fs_13 mt-1"><i class="bi bi-exclamation-triangle text-warning me-1"></i>${manualOpen} manual invoice(s) recorded with no e-invoice yet. Their sales are in no report until one is issued.</div>` : ''}`);

    /* Reports */
    const reps = ResReg.reports();
    $(".div_trans_problems").html(`
      <div class="d-flex justify-content-between align-items-center mb-2">
        <strong class="fs_13 text-secondary fw-bold">PROBLEMS REPORTED</strong>
        ${can_ ? '<button class="lbtn lbtn-sm lbtn-ghost button_res_report">Report a problem</button>' : ''}
      </div>
      <div class="div_res_form d-none"></div>
      ${reps.length ? `<div class="table-responsive"><table class="table table-sm fs_13 mb-0">
        <thead><tr><th>REPORT</th><th>FILED</th><th>WHAT</th><th>DOCUMENTS</th><th>CERTIFICATE</th></tr></thead><tbody>
        ${reps.map(x => `<tr><td class="mono">${esc(x.ref)}</td><td>${esc(fmtDateTime(x.reportedAt))}</td>
          <td>${esc(ResReg.KINDS[x.kind])}</td><td>${x.docIds.length}</td>
          <td>${x.certificate
            ? `<button class="lbtn lbtn-sm lbtn-ghost button_res_cert" data-id="${x.id}">${esc(x.certificate.ref)}</button>`
            : x.status === 'UNDER_REVIEW' ? '<span class="lbadge lbadge-amber">EPI reviewing</span>'
            : `<button class="lbtn lbtn-sm lbtn-ghost button_res_why" data-id="${x.id}">Why not</button>`}</td></tr>`).join('')}
        </tbody></table></div>`
        : '<div class="fs_13 text-muted">No problems reported. Report here if invoices are not reaching the BIR.</div>'}`);

    /* Tools */
    $(".div_trans_tools").html(`
      <div class="d-flex flex-wrap gap-2 align-items-end">
        <button class="lbtn lbtn-sm lbtn-ghost button_res_evidence"><i class="bi bi-file-earmark-text me-1"></i>Evidence report</button>
      </div>`);

    this.bind();
  },

  bind(){
    $(".button_res_evidence").off("click").on("click", async function () {
      const ev = await ResReg.evidenceHtml();
      const db = Store.db;
      logActivity(db, { action:`Evidence report generated: ${ev.data.documents.length} invoice(s), digest ${ev.digest.slice(0, 12)}` });
      Store.save(db);
      const stamp = new Date().toISOString().slice(0, 10);
      ResUI.show(`<h5 class="fw-bold mb-2">Evidence report</h5>
        <div class="fs_13 mb-2">${ev.data.documents.length
          ? `${ev.data.documents.length} delayed invoice(s), ${ev.data.documents.filter(x => x.cause === 'PROVIDER').length} traced to a verified interruption.`
          : 'No invoice was delayed beyond the threshold.'}</div>
        <div class="fs_12 text-muted mb-1">Digest of the data, so the file can be checked later:</div>
        <div class="mono fs_12" style="word-break:break-all">${esc(ev.digest)}</div>`,
        `<button class="lbtn lbtn-accent res_dl_html">Download report</button>
         <button class="lbtn lbtn-ghost res_dl_csv">Download attempts (CSV)</button>`);
      $(".res_dl_html").on("click", () => ResReg.save(`evidence-${CT.seriesPrefix}-${stamp}.html`, 'text/html', ev.html));
      $(".res_dl_csv").on("click", () => ResReg.save(`evidence-attempts-${CT.seriesPrefix}-${stamp}.csv`, 'text/csv', ResReg.evidenceCsv(ev.data)));
    });

    $(".button_res_report").off("click").on("click", function () {
      const $f = $(".div_res_form");
      if (!$f.hasClass("d-none")){ $f.addClass("d-none"); return; }
      const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      const waiting = ResReg.rows().filter(i => ['QUEUED', 'FAILED', 'REJECTED'].indexOf(i.transmissionStatus) > -1).length;
      const delayed = ResReg.rows().filter(i => delayInfo(i).delayed).length;
      $f.removeClass("d-none").html(`
        <div class="border rounded-3 p-3 mb-3"><div class="row g-3">
          <div class="col-12 col-md-6"><span class="d-block fw-semibold fs_13 mb-1">What is wrong</span>
            <select class="form-select form-select-sm select_res_kind">
              ${Object.keys(ResReg.KINDS).map(k => `<option value="${k}">${esc(ResReg.KINDS[k])}</option>`).join('')}</select></div>
          <div class="col-12 col-md-6"><span class="d-block fw-semibold fs_13 mb-1">When you noticed</span>
            <input type="datetime-local" class="form-control form-control-sm input_res_noticed" value="${local}" max="${local}"></div>
          <div class="col-12 col-md-6"><span class="d-block fw-semibold fs_13 mb-1">Documents affected</span>
            <select class="form-select form-select-sm select_res_scope">
              <option value="WAITING"${waiting ? '' : ' disabled'}>All waiting or failed (${waiting})</option>
              <option value="DELAYED"${delayed ? '' : ' disabled'}>All delayed, even if sent since (${delayed})</option>
              <option value="LISTED">Only the ones I list</option>
              <option value="NONE">None, nothing was issued</option></select></div>
          <div class="col-12 col-md-6 d-none div_res_numbers"><span class="d-block fw-semibold fs_13 mb-1">Invoice numbers</span>
            <input type="text" class="form-control form-control-sm mono input_res_numbers" placeholder="BMC0000142, ..."></div>
          <div class="col-12"><span class="d-block fw-semibold fs_13 mb-1">What you saw</span>
            <textarea class="form-control form-control-sm input_res_desc" rows="2" maxlength="1000"></textarea></div>
          <div class="col-12 d-flex gap-2"><button class="lbtn lbtn-sm lbtn-accent button_res_file">File the report</button>
            <button class="lbtn lbtn-sm lbtn-ghost button_res_cancel">Cancel</button></div>
          <div class="col-12 div_res_msg"></div>
        </div></div>`);
      const first = $f.find(".select_res_scope option:not(:disabled)").first().val();
      $f.find(".select_res_scope").val(first);
      $f.find(".select_res_scope").on("change", function () { $f.find(".div_res_numbers").toggleClass("d-none", this.value !== 'LISTED'); });
      $f.find(".select_res_kind").on("change", function () { if (this.value === 'CANNOT_ISSUE') $f.find(".select_res_scope").val('NONE'); });
      $f.find(".button_res_cancel").on("click", () => $f.addClass("d-none"));
      $f.find(".button_res_file").on("click", function () {
        $.ajax({ url:"/Portal/SPIStradcom/Dashboard/ProblemReport", method:"POST", dataType:"json", data:{
          kind:$f.find(".select_res_kind").val(), noticedAt:$f.find(".input_res_noticed").val(),
          scope:$f.find(".select_res_scope").val(), numbers:$f.find(".input_res_numbers").val(),
          description:$f.find(".input_res_desc").val() } }).done(function (res) {
            if (!res.success){ $f.find(".div_res_msg").html(Callout('danger', esc(res.message))); return; }
            DisplayDelaySwal("success", "", res.message);
            TransmissionSearch();
          });
      });
    });

    $(".button_res_cert").off("click").on("click", async function () {
      const r = ResReg.reports().find(x => x.id === $(this).data("id"));
      const c = await ResReg.certificateHtml(r);
      ResUI.show(`<h5 class="fw-bold mb-2">${esc(r.certificate.ref)}</h5>
        <div class="fs_13 mb-2">Certificate of provider-caused delay for report <span class="mono">${esc(r.ref)}</span>.</div>
        ${r.assessment.checks.map(k => `<div class="fs_13 mb-1"><i class="bi ${k.ok ? 'bi-check-circle text-success' : 'bi-x-circle text-danger'} me-1"></i>${esc(k.label)}<div class="fs_12 text-muted ms-4">${esc(k.detail)}</div></div>`).join('')}
        <div class="fs_12 text-muted mt-2">It states facts from EPI's records. Whether any penalty applies is for the BIR to decide.</div>`,
        '<button class="lbtn lbtn-accent res_dl_cert">Download certificate</button>');
      $(".res_dl_cert").on("click", () => ResReg.save(`${r.certificate.ref}.html`, 'text/html', c.html));
    });

    $(".button_res_why").off("click").on("click", function () {
      const r = ResReg.reports().find(x => x.id === $(this).data("id"));
      ResUI.show(`<h5 class="fw-bold mb-2">No certificate for ${esc(r.ref)}</h5>
        ${r.assessment.checks.map(k => `<div class="fs_13 mb-1"><i class="bi ${k.ok ? 'bi-check-circle text-success' : 'bi-x-circle text-danger'} me-1"></i>${esc(k.label)}<div class="fs_12 text-muted ms-4">${esc(k.detail)}</div></div>`).join('')}`, '');
    });
  }
};

/* ============================================================
   Manual invoices tab (Invoices)
   ============================================================ */

function ManualTabBody(){
  return `
    ${Callout('info', `<strong>For when EPI's service is down.</strong> Issue the invoice from your manual booklet,
      then record it here with the number printed on it. When service returns, its e-invoice is issued, linked to
      it and sent to the buyer. The sale is counted once, on the e-invoice. A manual invoice with
      no e-invoice is in no sales report.`, {cls:'mb-3'})}
    <div class="d-flex justify-content-end gap-2 mb-2">
      <button class="lbtn lbtn-sm lbtn-ghost d-none button_manual_upload"><i class="bi bi-upload me-1"></i> Upload a file</button>
      <button class="lbtn lbtn-sm lbtn-primary d-none button_manual_new"><i class="bi bi-journal-plus me-1"></i> Record a manual invoice</button>
    </div>
    <div class="div_manual_gaps"></div>
    <div class="lcard"><div class="lcard-body div_manual_list"></div></div>`;
}

function ManualScreen(){
  const rows = ResReg.manuals();
  const blocked = issuanceBlock();
  $(".button_manual_upload").toggleClass("d-none", !can('issue')).off("click").on("click", () => ResUI.upload());
  $(".button_manual_new").toggleClass("d-none", !can('issue')).off("click")
    .on("click", () => Nav.go('issue', { manual:true }));

  const gaps = ResReg.manualGaps();
  $(".div_manual_gaps").html(gaps.length ? Callout('warn', `<strong>Numbers missing from the manual booklet.</strong> ${gaps.map(g =>
    `${esc(g.missing.join(', '))}`).join('; ')} sit between numbers you recorded and are not recorded themselves. Record them, or note why they were spoiled.`, {cls:'mb-3'}) : '');

  $(".div_manual_list").html(rows.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
    <thead><tr><th>MANUAL NO.</th><th>ISSUED</th><th>BUYER</th><th class="text-end">TOTAL</th><th>REASON</th><th>E-INVOICE</th><th></th></tr></thead><tbody>
    ${rows.map(m => {
      const inv = m.linkedInvoiceId ? Store.db.invoices.find(i => i.id === m.linkedInvoiceId) : null;
      const int = m.interruptionId ? interruptionById(m.interruptionId) : null;
      return `<tr><td class="mono fw-semibold">${esc(m.manualNo)}${m.scanName ? `<div class="fs_11 text-muted"><i class="bi bi-paperclip"></i> ${esc(m.scanName)}</div>` : ''}</td>
        <td>${esc(fmtDateTime(m.issuedAt))}</td><td>${esc(m.buyer.name)}</td>
        <td class="text-end mono">${num(m.totals.totalDue)}</td>
        <td>${int ? `<span class="mono">${esc(int.ref)}</span>` : esc(m.reasonNote || '—')}</td>
        <td>${inv ? `<span class="hyperlink span_manual_open" data-id="${inv.id}">${esc(inv.number)}</span>` : '<span class="lbadge lbadge-amber lbadge-dot">Not issued yet</span>'}</td>
        <td class="text-end text-nowrap">${!inv && can('issue') ? `<button class="lbtn lbtn-sm lbtn-ghost button_manual_existing" data-id="${m.id}">Link existing</button>
          <button class="lbtn lbtn-sm lbtn-ghost button_manual_link" data-id="${m.id}"${blocked ? ' disabled title="' + esc(blocked) + '"' : ''}>Issue e-invoice</button>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>` :
    '<div class="fs_13 text-muted">No manual invoices recorded on this account.</div>');

  $(".button_manual_existing").off("click").on("click", function () { ResUI.linkExisting($(this).data("id")); });
  $(".span_manual_open").off("click").on("click", function () { Nav.go('invoices', { docId:$(this).data("id") }); });
  $(".button_manual_link").off("click").on("click", function () {
    const id = $(this).data("id");
    DisplayConfirmSwal(`<span class="fw-bold fs_18 text-dark">Issue the e-invoice?</span>
      <span class="fs_14 text-muted">It takes the next number in the series, keeps the date of the sale, and is linked to this manual invoice.
      The delay is recorded on it.</span>`, function () {
        DisplayLoadingSwal();
        $.ajax({ url:"/Portal/SPIStradcom/Dashboard/ManualLink", method:"POST", dataType:"json", data:{ id } }).done(function (res) {
          Swal.close();
          DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
          if (res.success) ManualScreen();
        });
      }, null, 'Issue');
  });
}
