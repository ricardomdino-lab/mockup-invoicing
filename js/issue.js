/* ============================================================
   issue.js — Issue Invoice

   One invoice, entered in the portal. Everything else here arrives as a
   file, a platform order or an API post; this is the path for the sale that
   has none of those — a counter sale, a one-off bill, a document raised by
   hand. It writes the same document the other paths write, into the same
   numbered series, so nothing downstream can tell where it came from except
   the "issued via" line.

   Validation lives in one function that the screen and the handler share:
   the screen shows the faults before anything is sent, and the handler
   checks again, because the handler is the one that consumes a number.
   ============================================================ */

const IssueReg = {
  PAYMENT_METHODS: ['Cash', 'Bank Transfer', 'Credit / Debit Card', 'Online Payment', 'Check'],
  /** Special buyers this account can invoice. Senior citizens and PWD follow
      the tax profile; athletes and solo parents follow the items it sells. */
  specialTypes(){
    const items = this.items(), out = [];
    if (CT.servesSCPWD) out.push('Senior Citizen', 'Person with Disability');
    ['Athlete or Coach', 'Solo Parent'].forEach(t => {
      if (items.some(i => i[SPECIAL_BUYERS[t].flag])) out.push(t);
    });
    return out;
  },
  EWT_RATES: [0.01, 0.02, 0.05, 0.10],

  /* Lines being built on screen. The rest of the form is read from the page. */
  lines: [],

  items(){
    return Store.db.items.filter(i => i.tenantId === CT.id);
  },

  /** The number the next document would take, without taking it. */
  peekNumber(branchId){
    const db = Store.db;
    const b = db.branches.find(x => x.id === branchId);
    if (!b) return '—';
    const year = new Date().getFullYear();
    const s = db.series[`INVOICE:${CT.id}`];
    return formatSeriesNumber(CT.seriesPrefix, b.code, year, s ? s.next : 1);
  },

  /**
   * Check a posted form and compute what it would issue.
   * Returns { errors, warnings, lines, totals, at }.
   */
  validate(p){
    const errors = [], warnings = [];
    const db = Store.db;
    p = p || {};

    const branch = Auth.visibleBranches().find(b => b.id === p.branchId);
    if (!branch) errors.push('Select a branch you can issue from.');

    const buyer = p.buyer || {};
    const name = String(buyer.name || '').trim();
    const tin = String(buyer.tin || '').trim();
    if (!name) errors.push('The buyer\'s name is required.');
    if (tin && !/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/.test(tin))
      errors.push(`TIN "${tin}" is not valid. Use 000-000-000, with a branch code if there is one.`);

    let at = null;
    if (!p.at) errors.push('The date and time of the sale are required.');
    else {
      at = new Date(p.at);
      if (isNaN(at.getTime())) errors.push('The date of the sale is not valid.');
      else if (at.getTime() > Date.now() + 5 * 60000)
        errors.push('The sale is dated in the future. A sale cannot be invoiced before it happens.');
      else if (CT.goLiveAt && at < new Date(CT.goLiveAt))
        errors.push(`The sale is dated before this account was activated on ${fmtDate(CT.goLiveAt)}.`);
    }

    const lines = [];
    const items = this.items();
    const sc = p.scpwd && p.scpwd.on ? p.scpwd : null;
    const kind = sc ? SPECIAL_BUYERS[sc.type] : null;
    (p.lines || []).forEach((l, n) => {
      const it = items.find(x => x.id === l.itemId);
      const qty = Number(l.qty), price = Number(l.unitPrice);
      const row = `Line ${n + 1}`;
      if (!it){ errors.push(`${row}: select an item.`); return; }
      if (!Number.isFinite(qty) || qty <= 0) errors.push(`${row}: the quantity must be more than zero.`);
      if (!Number.isFinite(price) || price <= 0) errors.push(`${row}: the price must be more than zero.`);
      if (it.treatment === 'EXEMPT' && !CT.hasExempt)
        errors.push(`${row}: the tax profile does not declare VAT-exempt sales. Confirm the tax profile in Settings first.`);
      if (it.treatment === 'ZERO' && !CT.hasZero)
        errors.push(`${row}: the tax profile does not declare zero-rated sales. Confirm the tax profile in Settings first.`);
      lines.push({
        itemId: it.id, desc: it.desc, sku: it.sku, qty, unit: it.unit, unitPrice: price,
        treatment: it.treatment, rx: !!it.rx,
        /* `scEligible` marks the lines that carry the buyer's discount, whichever the category. */
        scEligible: !!(kind && l.scEligible && it[kind.flag])
      });
    });
    if (!lines.length && !errors.some(e => /^Line/.test(e))) errors.push('Add at least one line.');

    if (sc){
      if (!kind) errors.push('Select the kind of discount buyer.');
      else {
        if (this.specialTypes().indexOf(sc.type) === -1)
          errors.push(`This account does not declare sales to this kind of buyer (${kind.law}).`);
        if (!String(sc.id || '').trim()) errors.push(`The ${kind.idLabel.toLowerCase()} is required.`);
        if (!String(sc.name || '').trim()) errors.push('The name on the ID is required.');
        if (kind.children && !String(sc.children || '').trim()) errors.push('The name of the child, aged 6 or under, is required.');
        if (!lines.some(l => l.scEligible)) errors.push('Tick at least one line that qualifies for the discount.');
        if (kind.children && lines.some(l => l.scEligible && l.rx) && !sc.rx)
          errors.push('Medicines for a solo parent need a prescription in the child\'s name. Confirm it was shown.');
      }
    }

    /* A trade discount comes off the VATable sales before VAT is derived, so
       it can only be as large as they are. */
    const discount = round2(Number(p.discount) || 0);
    const vatableBase = round2(lines.filter(l => l.treatment === 'VATABLE' && !(l.scEligible && kind))
      .reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0));
    if (discount < 0) errors.push('The discount cannot be negative.');
    else if (discount > vatableBase)
      errors.push(`The discount applies to VATable lines that carry no buyer discount, which total ${peso(vatableBase)}.`);

    const ewtRate = Number(p.ewtRate) || 0;
    if (ewtRate && this.EWT_RATES.indexOf(ewtRate) === -1) errors.push('Select a withholding rate from the list.');

    const totals = computeTotals(lines, discount > 0 ? discount : 0, Object.assign({ ewtRate }, sc && kind ? specialOpts(sc.type) : {}));
    if (!errors.length && totals.totalDue <= 0) errors.push('The invoice total is zero.');

    if (at && !errors.length){
      const lag = ImportReg.lagHours(at);
      if (lag > ImportReg.LATE_HOURS)
        warnings.push(`Issued ${ImportReg.lagLabel(lag)}. An invoice is due at the time of the transaction. The delay goes on the record.`);
    }

    return { errors, warnings, lines, totals, at, branch, discount, ewtRate, buyer: { name, tin: tin || null,
             address: String(buyer.address || '').trim() || null, alt: String(buyer.alt || '').trim() || null }, sc };
  }
};

/** Issue one invoice from a posted form. `extra` is merged into the document: the
    manual-invoice link uses it to say where the document came from. */
IssueReg.issue = function (p, extra) {
  if (!can('issue')) return { success:false, message:'Your role cannot issue invoices.' };
  if (issuesOnOwnSystem())
    return { success:false, message:'This account only sends the sales data from your own system to the BIR. It does not issue invoices itself.' };
  if (outageQueueing()) return OutageQueue.accept(p, extra);
  if (issuanceBlock()) return { success:false, message:issuanceBlock() };

  const v = IssueReg.validate(p);
  if (v.errors.length) return { success:false, message:v.errors[0], errors:v.errors };

  const db = Store.db;
  const now = new Date().toISOString();
  const lag = Math.round(ImportReg.lagHours(v.at) * 10) / 10;
  const number = allocateNumber(db, CT.id, v.branch.id, 'INVOICE');

  const inv = {
    id: uid('inv'), tenantId: CT.id, branchId: v.branch.id,
    docType:'INVOICE', docStatus:'ISSUED', number,
    issuedAt: v.at.toISOString(), recordedAt: now, issueLagHours: lag,
    buyer: v.buyer,
    scpwd: v.sc ? Object.assign(
      { type:v.sc.type, id:String(v.sc.id).trim(), name:String(v.sc.name).trim() },
      SPECIAL_BUYERS[v.sc.type].children ? { children:String(v.sc.children).trim(), rxShown:!!v.sc.rx } : {}) : null,
    lines: v.lines, discount: v.discount, ewtRate: v.ewtRate, totals: v.totals,
    currency:'PHP', keycode: keycode(8),
    paymentStatus: ['PAID','PARTIAL','UNPAID'].indexOf(p.paymentStatus) > -1 ? p.paymentStatus : 'PAID',
    paymentMethod: String(p.paymentMethod || '').trim() || null,
    terms: String(p.terms || '').trim() || null,
    deliveryStatus: v.buyer.address ? 'DELIVERED' : 'PENDING',
    deliveryAttempts: v.buyer.address ? 1 : 0,
    deliverTo: v.buyer.address || null,
    deliverBy: CT.deliveryMethod || 'EMAIL_PDF',
    deliverToAlt: v.buyer.alt || null,
    issuedBy: CU.name,
    issuedVia: 'Issue Invoice form'
  };
  delete inv.buyer.alt;
  if (extra) Object.assign(inv, extra);
  db.invoices.push(inv);
  /* The buyer pays through the System: the provider deducts the fee as the payment is made (realtime.js). */
  if (inv.paymentMethod === FeeReg.METHOD){
    if (!FeeReg.active(CT)) inv.paymentMethod = null;
    else if (inv.paymentStatus === 'PAID') FeeReg.pay(db, inv, inv.issuedAt);
    else { inv.paymentStatus = 'UNPAID'; inv.paymentLink = true; }
  }
  settleTransmission(inv);
  logActivity(db, {
    action:`Issued invoice ${number} to ${v.buyer.name} for ${peso(v.totals.totalDue)} (${extra && extra.queuedRef ? 'waiting sale ' + extra.queuedRef.ref : 'entered in the portal'})` +
           (lag > ImportReg.LATE_HOURS ? `, ${ImportReg.lagLabel(lag)}` : '')
  });
  Store.save(db);

  return { success:true, id:inv.id, number, message:`${number} issued for ${peso(v.totals.totalDue)}.` };
};
LocalAPI.on("Dashboard/InvoiceIssue", p => IssueReg.issue(p));

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  issue(opts){
    const manual = !!(opts && opts.manual);
    IssueReg.manual = manual;
    const branches = Auth.visibleBranches();
    const ints = interruptions().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    IssueReg.lines = [{ itemId:'', qty:1, unitPrice:'', scEligible:false }];

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">${manual ? 'Record a manual invoice' : 'Issue Invoice'}</h1>
          <div class="screen_sub">${manual
            ? 'For an invoice written by hand from the manual booklet while the system was down. It is kept as written. Its e-invoice is issued and sent to the buyer when service returns, and linked to this record.'
            : `One invoice for one sale. The number comes from this branch's numbers and is given when you issue it.`}
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2 align-items-center" role="group" aria-label="Invoice type">
          <span class="fs_12 text-muted">Invoice type</span>
          <button class="lbtn lbtn-sm ${manual ? 'lbtn-ghost' : 'lbtn-accent'}" aria-pressed="${manual ? 'false' : 'true'}" onclick="Nav.go('issue')">Electronic invoice</button>
          <button class="lbtn lbtn-sm ${manual ? 'lbtn-accent' : 'lbtn-ghost'}" aria-pressed="${manual ? 'true' : 'false'}" onclick="Nav.go('issue', { manual:true })">Manual invoice (issued during an outage)</button>
        </div>
      </div>
      ${!manual && outageQueueing() ? Callout('warn', `<strong>EPI service is down.</strong> A sale entered now waits and is numbered when service returns. If the buyer needs a paper invoice now, record a manual invoice.`, {cls:'mb-3'})
        : (!manual && issuanceBlock() ? Callout('danger', `<strong>Issuing is on hold.</strong> ${esc(issuanceBlock())}`, {cls:'mb-3'}) : '')}

      <div class="row g-3">
        <div class="col-12 col-lg-8">

          ${manual ? `<div class="lcard mb-3"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">MANUAL INVOICE</strong>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Number printed on it <span class="text-danger">*</span></span>
                <input type="text" class="form-control height_40 fs_14 shadow-none mono input_issue_manualno" maxlength="30">
              </div>
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Why it was written by hand <span class="text-danger">*</span></span>
                <select class="form-select height_40 fs_14 shadow-none select_issue_interruption">
                  ${ints.map(n => `<option value="${esc(n.id)}">${esc(n.ref)} · ${esc(INTERRUPTION_SOURCES[n.source].label)} · ${esc(fmtDate(n.startedAt))}</option>`).join('')}
                  <option value="">Another reason</option>
                </select>
              </div>
              <div class="col-12 col-md-6 div_issue_reasonnote d-none">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Reason</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_reasonnote" maxlength="200">
              </div>
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Scan or photo of the original</span>
                <input type="file" accept="image/*,application/pdf" class="form-control form-control-sm input_issue_scan">
                <div class="fs_11 text-muted mt-1">Only the file name is kept in this demo.</div>
              </div>
            </div>
          </div></div>` : ''}
          <div class="lcard"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">SALE</strong>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Branch <span class="text-danger">*</span></span>
                <select class="form-select height_40 fs_14 shadow-none select_issue_branch">
                  ${branches.map(b => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.code)})</option>`).join('')}
                </select>
              </div>
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">${manual ? 'Date and time on the manual invoice' : 'Date and time of the sale'} <span class="text-danger">*</span></span>
                <input type="datetime-local" class="form-control height_40 fs_14 shadow-none input_issue_at"
                       value="${local}" max="${local}">
              </div>
            </div>
          </div></div>

          <div class="lcard mt-3"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">BUYER</strong>
            <div class="row g-3">
              <div class="col-12 col-md-8">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Name <span class="text-danger">*</span></span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_buyer" maxlength="120">
              </div>
              <div class="col-12 col-md-4">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">TIN</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none mono input_issue_tin"
                       placeholder="000-000-000" maxlength="19">
              </div>
              <div class="col-12">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Address</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_address" maxlength="200">
                <div class="fs_11 text-muted mt-1">With an address, the buyer's copy is sent. Without one, delivery stays pending.</div>
              </div>
              ${CT.deliveryFallback ? `<div class="col-12">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">${CT.deliveryFallback === 'SMS' ? 'Mobile number' : 'Second contact'} (optional)</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_alt" maxlength="60">
                <div class="fs_11 text-muted mt-1">Used for the fallback method (${esc((DelivReg.CHANNELS[CT.deliveryFallback] || {}).label || '')}) if the main copy is not delivered.</div>
              </div>` : ''}
            </div>

            ${IssueReg.specialTypes().length ? `
            <div class="hr_gray_200 my-3"></div>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Discount buyer</span>
                <select class="form-select height_40 fs_14 shadow-none select_issue_special">
                  <option value="">None</option>
                  ${IssueReg.specialTypes().map(t => `<option value="${esc(t)}">${esc(t)} (${esc(SPECIAL_BUYERS[t].law)})</option>`).join('')}
                </select>
                <div class="fs_11 text-muted mt-1 div_issue_special_note"></div>
              </div>
            </div>
            <div class="row g-3 mt-0 div_issue_scpwd d-none">
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2 span_issue_idlabel">ID number</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none mono input_issue_scid" maxlength="40">
              </div>
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Name on the ID</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_scname" maxlength="120">
              </div>
              <div class="col-12 div_issue_children d-none">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Child aged 6 or under</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_children" maxlength="120">
                <label class="d-flex gap-2 align-items-start fs_12 text-secondary mt-2">
                  <input type="checkbox" class="mt-1 check_issue_rx">
                  <span>A prescription in the child's name was shown (needed for medicines and vaccines)</span>
                </label>
              </div>
            </div>` : ''}
          </div></div>

          <div class="lcard mt-3"><div class="lcard-body">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <strong class="fs_13 text-secondary fw-bold">LINES</strong>
              <button class="lbtn lbtn-sm lbtn-ghost button_issue_addline">Add a line</button>
            </div>
            <div class="div_issue_lines"></div>
            <div class="fs_11 text-muted mt-2">Prices are VAT-inclusive, as on the invoice.</div>
          </div></div>

          <div class="lcard mt-3"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">ADJUSTMENTS</strong>
            <div class="row g-3">
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Trade discount</span>
                <input type="number" min="0" step="0.01" class="form-control height_40 fs_13 shadow-none mono input_issue_discount" placeholder="0.00">
                <div class="fs_11 text-muted mt-1">Off the VATable sales, VAT-inclusive. VAT is worked out after it.</div>
              </div>
              <div class="col-12 col-md-6">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Buyer withholds tax</span>
                <select class="form-select height_40 fs_13 shadow-none select_issue_ewt">
                  <option value="0">No</option>
                  ${IssueReg.EWT_RATES.map(r => `<option value="${r}">${(r * 100).toFixed(0)}%</option>`).join('')}
                </select>
                <div class="fs_11 text-muted mt-1">Deducted at source. It lowers what you collect, not the invoice total.</div>
              </div>
            </div>
          </div></div>

          <div class="lcard mt-3"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold d-block mb-3">PAYMENT</strong>
            <div class="row g-3">
              <div class="col-12 col-md-4">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Status</span>
                <select class="form-select height_40 fs_14 shadow-none select_issue_paystatus">
                  <option value="PAID">Paid</option>
                  <option value="PARTIAL">Partly paid</option>
                  <option value="UNPAID">Unpaid</option>
                </select>
              </div>
              <div class="col-12 col-md-4">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Method</span>
                <select class="form-select height_40 fs_14 shadow-none select_issue_paymethod">
                  ${IssueReg.PAYMENT_METHODS.concat(FeeReg.canTake(CT) ? [FeeReg.METHOD] : []).map(m => `<option>${esc(m)}</option>`).join('')}
                </select>
              </div>
              <div class="col-12 col-md-4 div_issue_terms d-none">
                <span class="d-block fw-semibold fs_13 text-dark mb-2">Terms</span>
                <input type="text" class="form-control height_40 fs_14 shadow-none input_issue_terms"
                       placeholder="30 days" maxlength="40">
              </div>
            </div>
          </div></div>
        </div>

        <div class="col-12 col-lg-4">
          <div class="lcard"><div class="lcard-body div_issue_summary"></div></div>
          <div class="div_issue_messages mt-3"></div>
          <button class="lbtn lbtn-primary w-100 mt-3 button_issue_submit">${manual ? 'Record manual invoice' : (outageQueueing() ? 'Queue receipt' : 'Issue invoice')}</button>
        </div>
      </div>`;
  }
});

/* ============================================================
   Screen wiring
   ============================================================ */
Screens.issue = function () {
  const $lines = $(".div_issue_lines");

  function read(){
    return Object.assign(IssueReg.manual ? {
      manualNo: $(".input_issue_manualno").val(),
      interruptionId: $(".select_issue_interruption").val() || '',
      reasonNote: $(".input_issue_reasonnote").val(),
      scanName: ($(".input_issue_scan")[0] && $(".input_issue_scan")[0].files[0] || {}).name || ''
    } : {}, {
      branchId: $(".select_issue_branch").val(),
      at: $(".input_issue_at").val(),
      buyer: { name: $(".input_issue_buyer").val(), tin: $(".input_issue_tin").val(),
               address: $(".input_issue_address").val(), alt: $(".input_issue_alt").val() },
      scpwd: $(".select_issue_special").val()
        ? { on:true, type: $(".select_issue_special").val(), id: $(".input_issue_scid").val(),
            name: $(".input_issue_scname").val(), children: $(".input_issue_children").val(),
            rx: $(".check_issue_rx").is(":checked") }
        : null,
      lines: IssueReg.lines,
      discount: $(".input_issue_discount").val(),
      ewtRate: $(".select_issue_ewt").val(),
      paymentStatus: $(".select_issue_paystatus").val(),
      paymentMethod: $(".select_issue_paymethod").val(),
      terms: $(".input_issue_terms").val()
    });
  }

  function renderLines(){
    const items = IssueReg.items();
    const type = $(".select_issue_special").val() || '';
    const kind = SPECIAL_BUYERS[type];
    $lines.html(IssueReg.lines.map((l, i) => {
      const it = items.find(x => x.id === l.itemId);
      return `
      <div class="row g-2 align-items-end mb-2" data-line="${i}">
        <div class="col-12 col-md-5">
          ${i === 0 ? '<span class="d-block fs_11 text-muted mb-1">Item</span>' : ''}
          <select class="form-select height_40 fs_13 shadow-none select_issue_item">
            <option value="">Select an item</option>
            ${items.map(x => `<option value="${esc(x.id)}"${x.id === l.itemId ? ' selected' : ''}>${esc(x.desc)}</option>`).join('')}
          </select>
        </div>
        <div class="col-4 col-md-2">
          ${i === 0 ? '<span class="d-block fs_11 text-muted mb-1">Qty</span>' : ''}
          <input type="number" min="0" step="any" class="form-control height_40 fs_13 shadow-none input_issue_qty" value="${esc(l.qty)}">
        </div>
        <div class="col-5 col-md-3">
          ${i === 0 ? '<span class="d-block fs_11 text-muted mb-1">Unit price</span>' : ''}
          <input type="number" min="0" step="0.01" class="form-control height_40 fs_13 shadow-none mono input_issue_price" value="${esc(l.unitPrice)}">
        </div>
        <div class="col-3 col-md-2 d-flex align-items-center gap-2">
          ${kind ? `<label class="fs_11 text-muted d-flex gap-1 align-items-center mb-0" title="Qualifies for the ${esc(type.toLowerCase())} discount">
            <input type="checkbox" class="check_issue_lineSc"${l.scEligible ? ' checked' : ''}${it && it[kind.flag] ? '' : ' disabled'}> ${esc(kind.short)}</label>` : ''}
          ${IssueReg.lines.length > 1 ? '<button class="lbtn lbtn-sm lbtn-ghost button_issue_removeline" title="Remove this line"><i class="bi bi-x-lg"></i></button>' : ''}
        </div>
      </div>`;
    }).join(''));
  }

  function summary(){
    $(".div_issue_messages").empty();
    const v = IssueReg.validate(read());
    const t = v.totals;
    const row = (k, val, strong) => `
      <div class="d-flex justify-content-between py-1 fs_13">
        <span class="text-muted">${k}</span><span class="${strong ? 'fw-bold' : ''} mono">${val}</span>
      </div>`;
    $(".div_issue_summary").html(`
      <strong class="fs_13 text-secondary fw-bold d-block mb-3">THIS INVOICE</strong>
      <div class="fs_12 text-muted">${IssueReg.manual ? 'Manual number' : 'Next number'}</div>
      <div class="mono fw-bold mb-3">${IssueReg.manual ? esc($(".input_issue_manualno").val() || '—') : (outageQueueing() ? 'Assigned when service returns' : esc(IssueReg.peekNumber($(".select_issue_branch").val())))}</div>
      ${row('Gross sales (VAT-inclusive)', num(t.gross))}
      ${t.discount - (t.athleteDiscount || 0) > 0 ? row('Less: trade discount', num(t.discount - (t.athleteDiscount || 0))) : ''}
      ${t.athleteDiscount ? row('Less: athlete / coach discount (20%)', num(t.athleteDiscount)) : ''}
      ${row('VATable sales', num(t.vatableSales))}
      ${row('VAT (12%)', num(t.vat))}
      ${t.hasExempt ? row('VAT-exempt sales', num(t.exempt)) : ''}
      ${t.hasZero ? row('Zero-rated sales', num(t.zero)) : ''}
      ${t.scDiscount ? row(`Less: ${esc(($('.select_issue_special').val() || 'special buyer').toLowerCase())} discount (${Math.round((SPECIAL_BUYERS[$('.select_issue_special').val()] || {rate:0}).rate * 100)}%)`, num(t.scDiscount)) : ''}
      <div class="border-top border-dark mt-2 pt-2 d-flex justify-content-between">
        <strong class="fs_13">TOTAL AMOUNT DUE</strong><strong class="fs_15 mono">${peso(t.totalDue)}</strong>
      </div>
      ${t.totalDue > 0 ? `<div class="fs_11 text-muted mt-2">${esc(amountInWords(t.totalDue))}</div>` : ''}
      ${t.hasEwt ? `<div class="hr_gray_200 my-2"></div>
        ${row(`Less: creditable withholding tax (${(t.ewtRate * 100).toFixed(0)}%)`, num(t.ewtAmount))}
        ${row('Net amount collectible', num(t.netCollectible), true)}` : ''}`);
    return v;
  }

  function sync(){
    $(".div_issue_terms").toggleClass("d-none", $(".select_issue_paystatus").val() === 'PAID');
    const type = $(".select_issue_special").val() || '', kind = SPECIAL_BUYERS[type];
    $(".div_issue_scpwd").toggleClass("d-none", !kind);
    $(".div_issue_children").toggleClass("d-none", !(kind && kind.children));
    if (kind){
      $(".span_issue_idlabel").text(kind.idLabel);
      $(".div_issue_special_note").text(kind.vatExempt
        ? `VAT comes off a qualifying line first, then ${Math.round(kind.rate * 100)}% off what remains.`
        : `${Math.round(kind.rate * 100)}% off the VAT-exclusive price. VAT is still charged on what remains. Not combined with any other discount buyer.`);
    } else $(".div_issue_special_note").text('');
    summary();
  }

  /* A line's price follows the item chosen, and the SC/PWD box follows what
     the item is allowed to carry. Both can still be changed by hand. */
  $lines.on("change", ".select_issue_item", function () {
    const i = $(this).closest("[data-line]").data("line");
    const it = IssueReg.items().find(x => x.id === this.value);
    IssueReg.lines[i].itemId = this.value;
    IssueReg.lines[i].unitPrice = it ? it.price : '';
    const kind = SPECIAL_BUYERS[$(".select_issue_special").val()];
    IssueReg.lines[i].scEligible = !!(it && kind && it[kind.flag]);
    renderLines(); sync();
  });
  $lines.on("input", ".input_issue_qty, .input_issue_price", function () {
    const row = $(this).closest("[data-line]");
    const l = IssueReg.lines[row.data("line")];
    l.qty = row.find(".input_issue_qty").val();
    l.unitPrice = row.find(".input_issue_price").val();
    summary();
  });
  $lines.on("change", ".check_issue_lineSc", function () {
    IssueReg.lines[$(this).closest("[data-line]").data("line")].scEligible = this.checked;
    summary();
  });
  $lines.on("click", ".button_issue_removeline", function () {
    IssueReg.lines.splice($(this).closest("[data-line]").data("line"), 1);
    renderLines(); sync();
  });
  $(".button_issue_addline").off("click").on("click", function () {
    IssueReg.lines.push({ itemId:'', qty:1, unitPrice:'', scEligible:false });
    renderLines();
  });

  $(".select_issue_special").off("change").on("change", function () {
    const kind = SPECIAL_BUYERS[this.value];
    IssueReg.lines.forEach(l => {
      const it = IssueReg.items().find(x => x.id === l.itemId);
      l.scEligible = !!(kind && it && it[kind.flag]);
    });
    renderLines(); sync();
  });
  $(".select_issue_interruption").off("change").on("change", function () {
    $(".div_issue_reasonnote").toggleClass("d-none", !!this.value);
  }).trigger("change");
  $(".input_issue_manualno").off("input").on("input", summary);
  $(".select_issue_branch, .input_issue_at, .input_issue_buyer, .input_issue_tin, .input_issue_scid, .input_issue_scname, .input_issue_children, .check_issue_rx")
    .off("input change").on("input change", summary);
  $(".input_issue_discount, .select_issue_ewt").off("input change").on("input change", summary);
  $(".select_issue_paystatus").off("change").on("change", sync);

  /* Put each message against its field, outline the field and bring the first into view. */
  function markIssueErrors(errs){
    const rules = [
      [/branch/i, '.select_issue_branch'], [/name on the id/i, '.input_issue_scname'],
      [/buyer.s name/i, '.input_issue_buyer'], [/\bTIN\b/, '.input_issue_tin'],
      [/date|time of the sale|sale is dated/i, '.input_issue_at'], [/kind of discount/i, '.select_issue_special'],
      [/child/i, '.input_issue_children'], [/withholding rate/i, '.select_issue_ewt'],
      [/discount cannot/i, '.input_issue_discount'], [/number printed|manual invoice .* already/i, '.input_issue_manualno'],
      [/interruption|by hand/i, '.select_issue_interruption']
    ];
    const seen = new Set();
    errs.forEach(e => {
      let $f = $();
      const ln = /^Line (\d+)/i.exec(e);
      if (ln){
        $f = /item/i.test(e) ? $(".select_issue_item").eq(Number(ln[1]) - 1)
           : /quantity/i.test(e) ? $(".input_issue_qty").eq(Number(ln[1]) - 1)
           : /price/i.test(e) ? $(".input_issue_price").eq(Number(ln[1]) - 1) : $(".select_issue_item").eq(Number(ln[1]) - 1);
      } else {
        const r = rules.find(x => x[0].test(e));
        if (r) $f = $(r[1]).first();
      }
      if (!$f.length || seen.has($f[0])) return;
      seen.add($f[0]);
      $f.addClass("is-invalid");
      $f.after(`<div class="issue_field_error fs_11 text-danger mt-1">${esc(e)}</div>`);
    });
    const first = $(".is-invalid").first();
    const el = first.length ? first[0] : $(".div_issue_messages")[0];
    if (el && el.scrollIntoView) el.scrollIntoView({ block:'center', behavior:'smooth' });
  }

  $(".button_issue_submit").off("click").on("click", function () {
    const body = read();
    const v = IssueReg.validate(body);
    const manual = IssueReg.manual;
    const errs = (manual ? ResReg.validateManual(body) : []).concat(v.errors);
    const $m = $(".div_issue_messages");
    $(".is-invalid").removeClass("is-invalid"); $(".issue_field_error").remove();
    if (errs.length){
      $m.html(Callout('danger', `<strong>Not ${manual ? 'recorded' : 'issued'}.</strong><ul class="mb-0 ps-3">${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`));
      markIssueErrors(errs);
      return;
    }
    $m.html(v.warnings.map(w => Callout('warn', esc(w), {cls:'mb-2'})).join(''));

    DisplayConfirmSwal(
      manual
        ? `<span class="fw-bold fs_18 text-dark">Record this manual invoice?</span>
           <span class="fs_14 text-muted">${esc(v.buyer.name)} · ${peso(v.totals.totalDue)} · <span class="mono">${esc(body.manualNo)}</span>.
           It has no e-invoice number yet. The sale is not in any report until you issue the e-invoice.</span>`
        : outageQueueing()
        ? `<span class="fw-bold fs_18 text-dark">Queue this receipt?</span>
           <span class="fs_14 text-muted">${esc(v.buyer.name)} · ${peso(v.totals.totalDue)}. It has no number yet.
           It is issued with the time of this sale and sent to the buyer when service returns.</span>`
        : `<span class="fw-bold fs_18 text-dark">Issue this invoice?</span>
       <span class="fs_14 text-muted">${esc(v.buyer.name)} · ${peso(v.totals.totalDue)}. It will be numbered
       <span class="mono">${esc(IssueReg.peekNumber(v.branch.id))}</span> and cannot be edited.
       An error is corrected by cancelling it and issuing a new invoice.</span>`,
      function () {
        DisplayLoadingSwal();
        $.ajax({
          url: manual ? "/Portal/SPIStradcom/Dashboard/ManualRecord" : "/Portal/SPIStradcom/Dashboard/InvoiceIssue",
          method: "POST",
          dataType: "json",
          contentType: "application/json; charset=utf-8",
          data: JSON.stringify(body)
        }).done(function (res) {
          Swal.close();
          if (res.success) DisplayDelaySwal("success", "", res.message, function () { manual ? Nav.go('invoices', { tab:'manual' }) : (res.queued ? Nav.go('invoices', { tab:'queue' }) : Nav.go('invoices', { docId: res.id })); });
          else $m.html(Callout('danger', esc(res.message)));
        }).fail(function () {
          Swal.close();
          DisplaySwal("error", "", "The request could not be completed. Try again.");
        });
      }, null, manual ? 'Record' : (outageQueueing() ? 'Queue' : 'Issue'));
  });

  renderLines();
  sync();
};
