/* ============================================================
   lists.js — Sales lists and the series check

   Two tabs of Reports that turn the documents into things a
   return or an examiner asks for:

     - Sales list (SLS). The sales side of the summary list of sales and
       purchases: one row per customer for a quarter, with the tax split
       across the columns. It is built from the same documents as the summary
       report and says whether the two agree.

       The BIR has not published the electronic layout, so the CSV and DAT
       files carry the columns a sales list needs and nothing the BIR might
       later contradict. Both are labelled "layout pending BIR format".

     - Special discount sales: every sale carrying a statutory discount, by
       category: senior citizen, PWD, national athletes and coaches, and solo
       parents. Shown at the price before the discount, as the sales record
       requires, with the discount beside it.

     - Series check: for each numbering series, the numbers in the range that
       have no document, numbers held by more than one, and numbers that run
       against the clock. A gap in a series reads to an examiner as a deleted
       document, so this is where it is found first.
   ============================================================ */

const ListsReg = {

  QUARTERS: {
    Q1: { label:'Q1 · Jan to Mar', m:[0, 2] },
    Q2: { label:'Q2 · Apr to Jun', m:[3, 5] },
    Q3: { label:'Q3 · Jul to Sep', m:[6, 8] },
    Q4: { label:'Q4 · Oct to Dec', m:[9, 11] },
    FY: { label:'Full year',        m:[0, 11] }
  },

  /* The four statutory-discount buyers, in the order the BIR names them. */
  SPECIAL: ['Senior Citizen', 'Person with Disability', 'Athlete or Coach', 'Solo Parent'].map(k =>
    ({ key:k, label:{ 'Senior Citizen':'Senior citizen', 'Person with Disability':'Person with disability',
                      'Athlete or Coach':'National athletes and coaches', 'Solo Parent':'Solo parents' }[k],
       ref:SPECIAL_BUYERS[k].law })),

  years(){
    const ys = new Set([new Date().getFullYear()]);
    Auth.visibleInvoices().forEach(i => ys.add(new Date(i.issuedAt).getFullYear()));
    return Array.from(ys).sort((a, b) => b - a);
  },

  currentQuarter(){ return 'Q' + (Math.floor(new Date().getMonth() / 3) + 1); },

  period(year, q){
    const def = this.QUARTERS[q] || this.QUARTERS.FY;
    const pad = n => String(n).padStart(2, '0');
    const last = new Date(year, def.m[1] + 1, 0).getDate();
    const from = `${year}-${pad(def.m[0] + 1)}-01`, to = `${year}-${pad(def.m[1] + 1)}-${pad(last)}`;
    /* The sales list goes in with the quarterly VAT return, due on the 25th
       day after the quarter ends. A full year has no single due date. */
    const due = q === 'FY' ? null : new Date(new Date(to + 'T00:00:00+08:00').getTime() + 25 * 864e5);
    return { year, q, from, to, due, label:`${def.label} ${year}` };
  },

  docs(p){
    return Reporting.within(Auth.visibleInvoices().filter(i => i.docStatus !== 'DRAFT'), p.from, p.to);
  },

  /* ---------- Sales list ---------- */

  sls(p){
    const docs = this.docs(p).filter(i => i.docStatus !== 'CANCELLED');
    const groups = {};
    docs.forEach(i => {
      const b = displayBuyer(i);
      const tin = (b.tin || '').trim();
      const key = tin || '~' + String(b.name || '').toLowerCase();
      (groups[key] = groups[key] || { tin, name:b.name || '—', address:b.address || '', docs:[] }).docs.push(i);
    });
    const rows = Object.keys(groups).map(k => {
      const g = groups[k], s = Reporting.summarize(g.docs);
      return { tin:g.tin, name:g.name, address:g.address, count:g.docs.length,
               exempt:s.exempt, zero:s.zero, vatable:s.vatableSales, vat:s.vat,
               gross:round2(s.vatableSales + s.vat) };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const sum = f => round2(rows.reduce((a, r) => a + r[f], 0));
    const total = { exempt:sum('exempt'), zero:sum('zero'), vatable:sum('vatable'), vat:sum('vat'), gross:sum('gross') };
    const ref = Reporting.summarize(this.docs(p));
    return { rows, total, noTin: rows.filter(r => !r.tin).length,
             agrees: Math.abs(total.vatable - ref.vatableSales) < 0.01 && Math.abs(total.vat - ref.vat) < 0.01 &&
                     Math.abs(total.exempt - ref.exempt) < 0.01 && Math.abs(total.zero - ref.zero) < 0.01 };
  },

  slsFile(p, kind){
    const s = this.sls(p);
    const q = v => '"' + String(v === null || v === undefined ? '' : v).replace(/"/g, '""') + '"';
    const line = r => [q(r.tin), q(r.name), q(r.address), r.exempt.toFixed(2), r.zero.toFixed(2),
                       r.vatable.toFixed(2), r.vat.toFixed(2), r.gross.toFixed(2)].join(',');
    const head = ['Customer TIN','Registered name','Address','Exempt sales','Zero-rated sales','Taxable sales (net of VAT)','Output VAT','Gross taxable sales'].map(q).join(',');
    const body = s.rows.map(line);
    const text = (kind === 'dat' ? body : [head].concat(body)).join('\r\n');
    const name = `SLS-${CT.tin.replace(/\D/g, '')}-${p.year}${p.q === 'FY' ? '' : p.q}-layout-pending.${kind}`;
    RecordsReg.save(name, kind === 'dat' ? 'text/plain' : 'text/csv', text);
    logActivity(Store.db, { action:`Exported the sales list for ${p.label} as ${kind.toUpperCase()}` });
    Store.save(Store.db);
  },

  /* ---------- Special discount sales ---------- */

  /** The discount a document gave, by the rule for its buyer. */
  given(i){
    const t = i.totals || {};
    return round2(i.scpwd && SPECIAL_BUYERS[i.scpwd.type] && !SPECIAL_BUYERS[i.scpwd.type].vatExempt
      ? (t.athleteDiscount || 0) : (t.scDiscount || 0));
  },

  /** Gross selling price of the lines that carried the discount, before it. */
  grossOf(i){
    return round2((i.lines || []).filter(l => l.scEligible)
      .reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0));
  },

  special(p){
    const docs = this.docs(p).filter(i => i.docStatus !== 'CANCELLED' && i.docType === 'INVOICE' &&
      i.scpwd && this.given(i) > 0);
    return this.SPECIAL.map(c => {
      const mine = docs.filter(i => i.scpwd.type === c.key);
      return Object.assign({}, c, {
        docs: mine,
        discount: round2(mine.reduce((a, i) => a + this.given(i), 0)),
        gross: round2(mine.reduce((a, i) => a + this.grossOf(i), 0))
      });
    });
  },

  /* ---------- Series check ---------- */

  series(){
    const db = Store.db;
    const groups = {};
    Auth.visibleInvoices().filter(i => i.docStatus !== 'DRAFT').forEach(i => {
      const m = /^(\D*)(\d{7})$/.exec(i.number || '');
      if (!m) return;
      (groups[m[1]] = groups[m[1]] || []).push({ seq:Number(m[2]), inv:i });
    });
    return Object.keys(groups).sort().map(prefix => {
      const list = groups[prefix].sort((a, b) => a.seq - b.seq || new Date(a.inv.issuedAt) - new Date(b.inv.issuedAt));
      const seqs = list.map(x => x.seq);
      const present = new Set(seqs);
      const gaps = [];
      for (let n = seqs[0]; n <= seqs[seqs.length - 1]; n++) if (!present.has(n)) gaps.push(n);
      const dupes = Array.from(new Set(seqs.filter((n, i) => seqs.indexOf(n) !== i)));
      /* A number must not be recorded before the one under it. The sale date can
         be earlier (a late entry) so the test is on when each was recorded. */
      const stamp = x => new Date(x.inv.recordedAt || x.inv.issuedAt).getTime();
      const disorder = [];
      list.forEach((x, i) => { if (i && x.seq !== list[i - 1].seq && stamp(x) < stamp(list[i - 1]) - 60000) disorder.push(x.seq); });

      /* Numbers the series says it handed out that no document carries. */
      const allocated = [].concat(...Object.keys(db.series || {}).map(k => db.series[k].issued))
        .filter(n => n.slice(0, -7) === prefix && !present.has(seqOf(n)));

      const cancelled = list.filter(x => x.inv.docStatus === 'CANCELLED').length;
      return { prefix, count:list.length, from:seqs[0], to:seqs[seqs.length - 1], gaps, dupes, disorder, allocated, cancelled,
               ok: !gaps.length && !dupes.length && !disorder.length && !allocated.length };
    });
  },

  /* ---------- Markup ---------- */

  salesTab(){
    const yrs = this.years();
    return `
      ${Callout('info', `<strong>The BIR has not published the sales list format.</strong> These files have the columns a sales list needs and will follow the official format once it exists.`, {cls:'mb-3'})}
      <div class="lcard mb-3"><div class="lcard-body">
        <div class="d-flex flex-wrap gap-2 align-items-end">
          <div><span class="d-block fs_12 text-muted mb-1">Year</span>
            <select class="form-select form-select-sm select_lists_year">
              ${yrs.map(y => `<option>${y}</option>`).join('')}</select></div>
          <div><span class="d-block fs_12 text-muted mb-1">Period</span>
            <select class="form-select form-select-sm select_lists_quarter">
              ${Object.keys(this.QUARTERS).map(k => `<option value="${k}"${k === this.currentQuarter() ? ' selected' : ''}>${esc(this.QUARTERS[k].label)}</option>`).join('')}</select></div>
          <div class="flex-grow-1"></div>
          <button class="lbtn lbtn-sm lbtn-primary button_lists_csv">Export CSV</button>
          <button class="lbtn lbtn-sm lbtn-ghost button_lists_dat">Export DAT</button>
        </div>
      </div></div>
      <div class="div_lists_sls"></div>
      <div class="div_lists_special mt-3"></div>`;
  },

  renderSales(){
    const p = this.period(Number($(".select_lists_year").val()), $(".select_lists_quarter").val());
    const s = this.sls(p);
    const money = v => num(v);
    $(".div_lists_sls").html(`
      <div class="lcard"><div class="lcard-body">
        <div class="d-flex justify-content-between align-items-baseline flex-wrap gap-2 mb-1">
          <strong class="fs_13 text-secondary fw-bold">SALES LIST · ${esc(p.label.toUpperCase())}</strong>
          <span class="fs_12 text-muted">${p.due ? `Goes in with the quarterly VAT return, due ${fmtDate(p.due.toISOString())}` : 'Full year, no single due date'}</span>
        </div>
        <div class="fs_12 text-muted mb-3">One row per customer. Cancelled documents are left out.</div>
        ${s.noTin ? Callout('warn', `${s.noTin} customer${s.noTin === 1 ? ' has' : 's have'} no TIN on the invoices. The list needs one for each, so ask these buyers for it.`, {cls:'mb-3'}) : ''}
        ${s.rows.length ? `
        <div class="table-responsive">
          <table class="table tbl fs_12">
            <thead><tr><th>TIN</th><th>REGISTERED NAME</th><th class="text-center">DOCS</th><th class="text-end">EXEMPT</th><th class="text-end">ZERO-RATED</th><th class="text-end">TAXABLE (NET)</th><th class="text-end">OUTPUT VAT</th><th class="text-end">GROSS TAXABLE</th></tr></thead>
            <tbody>
              ${s.rows.map(r => `<tr><td class="mono">${esc(r.tin || '—')}</td><td>${esc(r.name)}</td><td class="text-center">${r.count}</td>
                <td class="text-end mono">${money(r.exempt)}</td><td class="text-end mono">${money(r.zero)}</td><td class="text-end mono">${money(r.vatable)}</td>
                <td class="text-end mono">${money(r.vat)}</td><td class="text-end mono">${money(r.gross)}</td></tr>`).join('')}
              <tr class="fw-bold"><td colspan="3">TOTAL</td><td class="text-end mono">${money(s.total.exempt)}</td><td class="text-end mono">${money(s.total.zero)}</td>
                <td class="text-end mono">${money(s.total.vatable)}</td><td class="text-end mono">${money(s.total.vat)}</td><td class="text-end mono">${money(s.total.gross)}</td></tr>
            </tbody>
          </table>
        </div>
        <div class="fs_12 mt-2 ${s.agrees ? 'text-success' : 'text-danger'}">
          ${s.agrees ? 'The totals agree with the summary report for the same period.' : 'The totals do not agree with the summary report. Do not file this list until they do.'}
        </div>` : '<div class="fs_13 text-muted">No sales in this period.</div>'}
      </div></div>`);

    const sp = this.special(p);
    $(".div_lists_special").html(`
      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">SALES WITH A STATUTORY DISCOUNT · ${esc(p.label.toUpperCase())}</strong>
        <div class="fs_12 text-muted mb-3">By category. Sales are shown at the selling price before the discount, with the discount beside it, as the sales record requires.</div>
        <div class="table-responsive">
          <table class="table tbl fs_12">
            <thead><tr><th>CATEGORY</th><th>LAW</th><th class="text-center">DOCS</th><th class="text-end">GROSS SELLING PRICE</th><th class="text-end">DISCOUNT GIVEN</th></tr></thead>
            <tbody>
              ${sp.map(c => `<tr><td>${esc(c.label)}</td><td>${esc(c.ref)}</td>
                <td class="text-center">${c.docs.length}</td>
                <td class="text-end mono">${money(c.gross)}</td>
                <td class="text-end mono">${money(c.discount)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${sp.some(c => c.docs.length) ? `
        <div class="table-responsive mt-3">
          <table class="table tbl fs_12">
            <thead><tr><th>INVOICE</th><th>DATE</th><th>CATEGORY</th><th>ID NO.</th><th>NAME ON THE ID</th><th class="text-end">GROSS SELLING PRICE</th><th class="text-end">DISCOUNT</th></tr></thead>
            <tbody>
              ${sp.reduce((a, c) => a.concat(c.docs), []).map(i => `<tr><td class="mono">${esc(i.number)}</td><td>${fmtDate(i.issuedAt)}</td>
                <td>${esc(i.scpwd.type)}</td><td class="mono">${esc(i.scpwd.id)}</td>
                <td>${esc(i.scpwd.name)}${i.scpwd.children ? `<div class="text-muted">Child: ${esc(i.scpwd.children)}</div>` : ''}</td>
                <td class="text-end mono">${money(this.grossOf(i))}</td>
                <td class="text-end mono">${money(this.given(i))}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : ''}
      </div></div>`);
  },

  seriesTab(){
    return `
      <div class="lcard"><div class="lcard-body div_lists_series"></div></div>`;
  },

  renderSeries(){
    const rows = this.series();
    const list = (a, empty) => a.length ? a.map(n => `<span class="mono">${String(n).padStart(7, '0')}</span>`).join(', ') : `<span class="text-muted">${empty}</span>`;
    $(".div_lists_series").html(`
      <strong class="fs_13 text-secondary fw-bold d-block mb-1">INVOICE NUMBERS</strong>
      <div class="fs_12 text-muted mb-3">
        A missing, repeated or out-of-order number looks like a deleted or changed invoice to the BIR. A cancelled invoice keeps its number, so it is not missing.
      </div>
      ${rows.length ? `
      <div class="table-responsive">
        <table class="table tbl fs_12">
          <thead><tr><th>PREFIX</th><th class="text-center">INVOICES</th><th>RANGE</th><th>MISSING</th><th>REPEATED</th><th>OUT OF ORDER</th><th>RESULT</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td class="mono">${esc(r.prefix) || 'System fees'}</td><td class="text-center">${r.count}${r.cancelled ? ` <span class="text-muted">(${r.cancelled} cancelled)</span>` : ''}</td>
              <td class="mono">${String(r.from).padStart(7, '0')} to ${String(r.to).padStart(7, '0')}</td>
              <td>${list(Array.from(new Set(r.gaps.concat(r.allocated.map(n => seqOf(n))))).sort((a, b) => a - b), 'None')}</td>
              <td>${list(r.dupes, 'None')}</td><td>${list(r.disorder, 'None')}</td>
              <td>${r.ok ? '<span class="lbadge lbadge-green">Clear</span>' : '<span class="lbadge lbadge-red">Needs review</span>'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>` : '<div class="fs_13 text-muted">No documents to check.</div>'}`);
  },

  bind(){
    $(".select_lists_year, .select_lists_quarter").off("change").on("change", () => ListsReg.renderSales());
    const period = () => ListsReg.period(Number($(".select_lists_year").val()), $(".select_lists_quarter").val());
    $(".button_lists_csv").off("click").on("click", () => ListsReg.slsFile(period(), 'csv'));
    $(".button_lists_dat").off("click").on("click", () => ListsReg.slsFile(period(), 'dat'));
  }
};
