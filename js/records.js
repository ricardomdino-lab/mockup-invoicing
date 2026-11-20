/* ============================================================
   records.js — Records & Data

   What the taxpayer owns and what the BIR may ask for (RMC VIII): export the
   whole account at any time, see the requests the BIR has made and when they
   fall due, see whether a legal hold is in force, and close the account while
   keeping every record readable.

   The BIR examiner is the one role that can raise a request or place a hold.
   They have no taxpayer of their own, so they see the same screen for
   whichever taxpayer the sidebar has selected, with two extra cards.

   A summary report is due in one working day and an extract in three. The
   summary is built the moment it is asked for. The extract is the slower job:
   EPI's staff prepare it from the operator console (ops.js).
   ============================================================ */

const RecordsReg = {

  TYPES: {
    SUMMARY: { label:'Summary report', days:1, note:'Figures for a period, due in 1 working day' },
    EXTRACT: { label:'Data extract',   days:3, note:'The documents themselves, due in 3 working days' }
  },

  PERIODS: {
    D30: { label:'Last 30 days' },
    YTD: { label:'Year to date' },
    ALL: { label:'All records' }
  },

  range(key){
    const to = new Date(), from = new Date();
    if (key === 'D30') from.setDate(from.getDate() - 30);
    else if (key === 'YTD') from.setMonth(0, 1);
    else return { from:null, to:null };
    from.setHours(0, 0, 0, 0);
    return { from:from.toISOString(), to:to.toISOString() };
  },

  requests(){
    return (Store.db.dataRequests || []).filter(r => r.tenantId === CT.id)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  },

  state(r){
    if (r.fulfilledAt) return 'DONE';
    return new Date(r.dueAt) < new Date() ? 'OVERDUE' : 'OPEN';
  },

  /* ---------- What an export holds ---------- */

  docs(tenantId, from, to){
    return Store.db.invoices.filter(i => i.tenantId === tenantId &&
      (!from || new Date(i.issuedAt) >= new Date(from)) &&
      (!to   || new Date(i.issuedAt) <= new Date(to)));
  },

  /** Everything the account holds, in plain JSON. Passwords never leave. */
  build(tenantId, opts){
    opts = opts || {};
    const db = Store.db;
    const t = db.tenants.find(x => x.id === tenantId);
    const invoices = this.docs(tenantId, opts.from, opts.to).map(i => {
            return i;
    });
    const ids = invoices.map(i => i.id);
    const series = {};
    Object.keys(db.series || {}).forEach(k => {
      if (k.slice(-(tenantId.length + 1)) === ':' + tenantId) series[k] = db.series[k];
    });
    return {
      export: {
        generatedAt: new Date().toISOString(),
        generatedBy: CU ? `${CU.name} (${ROLES[CR].label})` : 'System',
        product: `${SYSTEM.product} v${SYSTEM.version}`,
        format: 'JSON, UTF-8. Field names are illustrative until the BIR publishes its schema.',
        period: { from: opts.from || null, to: opts.to || null },
        counts: { documents: invoices.length }
      },
      taxpayer: Object.assign({}, t, { consents: t.consents || null }),
      branches: db.branches.filter(b => b.tenantId === tenantId),
      accounts: db.users.filter(u => u.tenantId === tenantId).map(u => ({
        name:u.name, email:u.email, role:u.roleKey, position:u.position, active:!!u.active })),
      items: db.items.filter(i => i.tenantId === tenantId),
      documents: invoices,
      invoicesFromProvider: BillingReg.all(db).filter(i => i.clientId === tenantId),
      corrections: (db.corrections || []).filter(c => c.tenantId === tenantId &&
        ((!opts.from && !opts.to) || ids.indexOf(c.invoiceId) > -1)),
      auditTrail: (db.activity || []).filter(a => a.tenantId === tenantId),
      numberingSeries: series,
      connections: (db.platforms || []).filter(p => p.tenantId === tenantId)
        .map(p => ({ id:p.id, name:p.name, method:p.method, status:p.status })),
            legalHold: t.legalHold || null
    };
  },

  summary(tenantId, from, to){
    const live = this.docs(tenantId, from, to);
    const count = key => live.reduce((m, i) => { m[i[key]] = (m[i[key]] || 0) + 1; return m; }, {});
    const sum = f => round2(live.filter(i => i.docStatus !== 'CANCELLED' && i.docType === 'INVOICE')
      .reduce((a, i) => a + ((i.totals && i.totals[f]) || 0), 0));
    return {
      generatedAt: new Date().toISOString(),
      period: { from: from || null, to: to || null },
      documents: live.length,
      byType: count('docType'),
      byStatus: count('docStatus'),
      byTransmission: count('transmissionStatus'),
      sales: { gross:sum('gross'), vatableSales:sum('vatableSales'), vat:sum('vat'),
               exempt:sum('exempt'), zeroRated:sum('zero'), totalDue:sum('totalDue') },
      note:'Cancelled invoices are counted above and left out of the sales figures.'
    };
  },

  csv(tenantId){
    const db = Store.db;
    const cell = v => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = ['number','type','status','issued_at','branch','buyer_name','buyer_tin','gross','vatable_sales','vat',
                  'vat_exempt','zero_rated','discount','total_due','payment_status','transmission_status',
                  'acknowledgment','delivery_status','issued_by','issued_via'];
    const t = db.tenants.find(x => x.id === tenantId);
    const rows = this.docs(tenantId).sort((a, b) => new Date(a.issuedAt) - new Date(b.issuedAt)).map(i => {
      const b = db.branches.find(x => x.id === i.branchId);
      const buyer = i.buyer || {};
      const tt = i.totals || {};
      return [i.number, i.docType, i.docStatus, i.issuedAt, b ? b.code : '', buyer.name, buyer.tin, tt.gross,
              tt.vatableSales, tt.vat, tt.exempt, tt.zero, tt.discount, tt.totalDue, i.paymentStatus,
              i.transmissionStatus, i.transmissionRef, i.deliveryStatus, i.issuedBy, i.issuedVia].map(cell).join(',');
    });
    return [head.join(',')].concat(rows).join('\n');
  },

  save(name, mime, text){
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: mime }));
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  stamp(){ return new Date().toISOString().slice(0, 10); },

  exportFull(){
    if (!can('export')) return UI.toast('Your role cannot export the account', 'warn');
    const data = this.build(CT.id);
    this.save(`${CT.seriesPrefix}-account-export-${this.stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
    logActivity(Store.db, { action:`Exported the whole account (${data.export.counts.documents} documents, audit trail included)` });
    Store.save(Store.db);
  },

  exportDocs(){
    if (!can('export')) return UI.toast('Your role cannot export the account', 'warn');
    this.save(`${CT.seriesPrefix}-documents-${this.stamp()}.csv`, 'text/csv', this.csv(CT.id));
    logActivity(Store.db, { action:'Exported all invoices as CSV' });
    Store.save(Store.db);
  },

  /* ---------- Requests ---------- */

  raise(){
    if (!can('examine')) return;
    const type = $('.select_records_type').val(), period = $('.select_records_period').val();
    const note = String($('.input_records_note').val() || '').trim();
    const def = this.TYPES[type];
    if (!def) return;
    const db = Store.db, now = new Date();
    const r = this.range(period);
    const req = {
      id: uid('req'), tenantId: CT.id, type,
      scope: `${def.label}, ${this.PERIODS[period].label.toLowerCase()}${note ? '. ' + note : ''}`,
      from: r.from, to: r.to, requestedBy: CU.name, requestedAt: now.toISOString(),
      dueAt: addWorkingDays(now, def.days).toISOString(), fulfilledAt: null
    };
    /* A summary is only figures, so it is ready at once. An extract is the
       slower job and waits for EPI. */
    if (type === 'SUMMARY') req.fulfilledAt = now.toISOString();
    db.dataRequests.push(req);
    logActivity(db, { action:`BIR requested a ${def.label.toLowerCase()}: ${req.scope}. Due ${fmtDateTime(req.dueAt)}` });
    Store.save(db);
    Nav.go('records');
    UI.toast(type === 'SUMMARY' ? 'Summary report ready' : `Extract requested. Due ${fmtDate(req.dueAt)}`, 'ok');
  },

  download(id){
    const r = (Store.db.dataRequests || []).find(x => x.id === id);
    if (!r || !r.fulfilledAt) return;
    const data = r.type === 'SUMMARY' ? this.summary(r.tenantId, r.from, r.to)
                                      : this.build(r.tenantId, { from:r.from, to:r.to });
    this.save(`${CT.seriesPrefix}-${r.type.toLowerCase()}-${this.stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
  },

  /* ---------- Legal hold ---------- */

  hold(){
    if (!can('examine')) return;
    const ref = String($('.input_records_holdref').val() || '').trim();
    const why = String($('.input_records_holdwhy').val() || '').trim();
    if (!ref || !why){ UI.toast('Enter a reference and a reason for the hold', 'err'); return; }
    const db = Store.db, t = db.tenants.find(x => x.id === CT.id);
    t.legalHold = { active:true, reference:ref, reason:why, placedBy:CU.name, placedAt:new Date().toISOString() };
    logActivity(db, { action:`Legal hold placed: ${ref}. Archiving out and removal are paused for all records` });
    Store.save(db);
    Nav.go('records');
  },

  release(){
    if (!can('examine')) return;
    const db = Store.db, t = db.tenants.find(x => x.id === CT.id);
    if (!t.legalHold) return;
    logActivity(db, { action:`Legal hold ${t.legalHold.reference} released` });
    t.legalHold = Object.assign({}, t.legalHold, { active:false, releasedAt:new Date().toISOString(), releasedBy:CU.name });
    Store.save(db);
    Nav.go('records');
  },

  /* ---------- Closing an account ---------- */

  close(){
    if (CR !== 'OWNER') return;
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Close this account?</span>
       <span class="fs_14 text-muted">No new invoices, corrections or changes after this. Every record stays
       readable and exportable, and your duties to the BIR continue. Only EPI can reopen it.</span>`,
      function () {
        const db = Store.db, t = db.tenants.find(x => x.id === CT.id);
        t.accountStatus = 'CLOSED';
        t.closedAt = new Date().toISOString();
        t.closedBy = CU.name;
        logActivity(db, { action:'Closed the account. It is now read-only' });
        Store.save(db);
        refreshSession();
        Nav.go('records');
      }, null, 'Close account', true);
  }
};

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  records(){
    const exam = can('examine');
    const hold = CT.legalHold && CT.legalHold.active ? CT.legalHold : null;
    const reqs = RecordsReg.requests();
    const stateBadge = r => {
      const s = RecordsReg.state(r);
      return s === 'DONE' ? '<span class="lbadge lbadge-green">Ready</span>'
           : s === 'OVERDUE' ? '<span class="lbadge lbadge-red">Overdue</span>'
           : '<span class="lbadge lbadge-amber">In progress</span>';
    };

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Records</h1>
          <div class="screen_sub">
            The records in this account belong to the taxpayer. You can export all records at any time, and view BIR requests.
          </div>
        </div>
      </div>

      <div class="row g-3">
        ${can('export') ? `
        <div class="col-12 col-lg-6">
          <div class="lcard h-100"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-2">EXPORT EVERYTHING</strong>
            <div class="fs_13 text-secondary mb-3">
              Every invoice, buyer, cancellation, acknowledgment and rejection, the full audit trail,
              branches, numbering and accounts. Open formats, no proprietary software, and no charge.
              Passwords are never included.
            </div>
            <div class="d-flex gap-2 flex-wrap">
              <button class="lbtn lbtn-sm lbtn-primary" onclick="RecordsReg.exportFull()">Whole account (JSON)</button>
              <button class="lbtn lbtn-sm lbtn-ghost" onclick="RecordsReg.exportDocs()">Invoices (CSV)</button>
            </div>
          </div></div>
        </div>` : ''}
      </div>

      <div class="lcard mt-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">BIR REQUESTS</strong>
        <div class="fs_12 text-muted mb-3">A summary report is due in 1 working day and a data extract in 3.
          Weekends are skipped; holidays are not modelled.</div>
        ${reqs.length ? `
        <div class="table-responsive">
          <table class="table tbl fs_12">
            <thead><tr><th>REQUESTED</th><th>TYPE</th><th>SCOPE</th><th>REQUESTED BY</th><th>DUE</th><th>STATUS</th><th></th></tr></thead>
            <tbody>
              ${reqs.map(r => `
              <tr>
                <td>${fmtDateTime(r.requestedAt)}</td>
                <td>${esc(RecordsReg.TYPES[r.type].label)}</td>
                <td>${esc(r.scope)}</td>
                <td>${esc(r.requestedBy)}</td>
                <td>${r.fulfilledAt ? 'Met ' + fmtDateTime(r.fulfilledAt) : fmtDateTime(r.dueAt)}</td>
                <td>${stateBadge(r)}</td>
                <td class="text-end">
                  ${r.fulfilledAt ? `<button class="lbtn lbtn-sm lbtn-ghost" onclick="RecordsReg.download('${r.id}')">Download</button>` : ''}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<div class="fs_13 text-muted">The BIR has made no requests on this account.</div>'}
      </div></div>

      ${exam ? `
      <div class="row g-3 mt-0">
        <div class="col-12 col-lg-6">
          <div class="lcard h-100"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">RAISE A REQUEST</strong>
            <div class="row g-2">
              <div class="col-6">
                <span class="d-block fs_12 fw-semibold mb-1">Type</span>
                <select class="form-select height_40 fs_13 shadow-none select_records_type">
                  ${Object.keys(RecordsReg.TYPES).map(k => `<option value="${k}">${esc(RecordsReg.TYPES[k].label)}</option>`).join('')}
                </select>
              </div>
              <div class="col-6">
                <span class="d-block fs_12 fw-semibold mb-1">Period</span>
                <select class="form-select height_40 fs_13 shadow-none select_records_period">
                  ${Object.keys(RecordsReg.PERIODS).map(k => `<option value="${k}">${esc(RecordsReg.PERIODS[k].label)}</option>`).join('')}
                </select>
              </div>
              <div class="col-12">
                <span class="d-block fs_12 fw-semibold mb-1">Note</span>
                <input type="text" class="form-control height_40 fs_13 shadow-none input_records_note" maxlength="120">
              </div>
            </div>
            <button class="lbtn lbtn-sm lbtn-primary mt-3" onclick="RecordsReg.raise()">Raise request</button>
          </div></div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="lcard h-100"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">LEGAL HOLD</strong>
            ${hold ? `
            <dl class="dl">
              <dt>Reference</dt><dd>${esc(hold.reference)}</dd>
              <dt>Reason</dt><dd>${esc(hold.reason)}</dd>
              <dt>Placed</dt><dd>${fmtDateTime(hold.placedAt)} by ${esc(hold.placedBy)}</dd>
            </dl>
            <button class="lbtn lbtn-sm lbtn-ghost" onclick="RecordsReg.release()">Release the hold</button>` : `
            <div class="row g-2">
              <div class="col-12">
                <span class="d-block fs_12 fw-semibold mb-1">Reference</span>
                <input type="text" class="form-control height_40 fs_13 shadow-none input_records_holdref" maxlength="60">
              </div>
              <div class="col-12">
                <span class="d-block fs_12 fw-semibold mb-1">Reason</span>
                <input type="text" class="form-control height_40 fs_13 shadow-none input_records_holdwhy" maxlength="160">
              </div>
            </div>
            <div class="fs_11 text-muted mt-2">While a hold is in force, nothing on the account is archived out or removed.</div>
            <button class="lbtn lbtn-sm lbtn-primary mt-2" onclick="RecordsReg.hold()">Place legal hold</button>`}
          </div></div>
        </div>
      </div>` : `
      <div class="lcard mt-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">LEGAL HOLD</strong>
        <div class="fs_13 text-secondary">${hold
          ? `A legal hold is in force (${esc(hold.reference)}). Records are kept as they are, and nothing is archived out or removed until it is released.`
          : 'No legal hold.'}</div>
      </div></div>`}

      <div class="fs_12 text-muted mt-3">How your data is used and how long records are kept are in the <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a>. Nothing is deleted or hidden.</div>

      ${CR === 'OWNER' && accountStatus() === 'ACTIVE' ? `
      <div class="lcard mt-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">CLOSE THIS ACCOUNT</strong>
        <div class="fs_13 text-secondary mb-3">
          Closing stops new invoices and changes. Every record stays readable and exportable, and your duties to
          the BIR continue. Export first if you want your own copy.
        </div>
        <button class="lbtn lbtn-sm lbtn-danger" onclick="RecordsReg.close()">Close account</button>
      </div></div>` : ''}`;
  }
});
