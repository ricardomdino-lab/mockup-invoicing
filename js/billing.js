/* ============================================================
   billing.js — Invoices from EPI

   EPI is a taxpayer too. RMC VII.2 has an ESP invoice its own clients for
   subscription fees and other service charges, and report that billing to the
   BIR EIS, limited to its own billing: never the sales its clients make to
   their customers.

   So these invoices live in the EPI account's own register (db.invoices, tenant t_epi, providerBilling, clientId = the client), with
   EPI as the seller and the client as the buyer. They are not in the client's
   Invoices, SLS, series check or sales reports, because they are EPI's
   sales, not the client's. The client sees them here, as purchases.

   The invoice engine is the same one everything else uses. The fee schedule is
   FEES in core.js, so what is billed and what the fee tables promise cannot
   drift apart. The billing run and payments are recorded by EPI's staff in
   the operator console (ops.js).
   ============================================================ */

const BillingReg = {

  PAYMENT_DAYS: 15,

  MONTHS: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
           'September', 'October', 'November', 'December'],

  key(d){ d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; },
  label(k){ const [y, m] = k.split('-'); return `${this.MONTHS[+m - 1]} ${y}`; },
  next(k){ const [y, m] = k.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; },
  prev(k){ const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; },

  /** Billable Documents the client issued in a month: what the fee and the audit count. */
  usage(db, tenantId, period){
    return db.invoices.filter(i => i.tenantId === tenantId && i.docStatus !== 'DRAFT' &&
      this.key(i.issuedAt) === period).length;
  },

  billed(db, tenantId){
    return BillingReg.all(db).filter(i => i.clientId === tenantId).map(i => i.period);
  },

  /** The first month this client has not been billed for, if it has finished by `asOf`. */
  shift(k, n){ for (let i = 0; i < n; i++) k = this.next(k); return k; },

  nextPeriod(db, t, asOf){
    const done = new Set(this.billed(db, t.id).concat(t.coveredPeriods || []));
    let k = this.key(t.goLiveAt);
    const now = this.key(asOf || new Date()), last = this.prev(now);
    while (done.has(k)) k = this.next(k);
    return k <= last ? k : null;
  },

  /** The next month with something to bill. A month with no documents is skipped. */
  nextBillable(db, t, asOf){
    for (let i = 0; i < 24; i++){
      const period = this.nextPeriod(db, t, asOf);
      if (!period) return null;
      const parts = this.parts(db, t, period, asOf);
      if (parts.realtime.length || parts.balance.length) return { period, lines:parts.balance, parts };
      t.coveredPeriods = (t.coveredPeriods || []).concat([period]);
    }
    return null;
  },

  /** What a month costs this client, before VAT, as invoice lines at VAT-inclusive prices, in two parts:
      the fees the payment provider already deducted in real time (their own invoice, already paid), and
      the balance to bill: documents not paid through the System, the part of a fee a small payment
      could not cover, the monthly audit difference and late charges (CSA 4.6, 4.4).
      The tier is the one in force on the last day of the month: a move up starts on the first
      day of a month (CSA 4.5), so a month never splits between two tiers. */
  parts(db, t, period, asOf){
    const [py, pm] = period.split('-').map(Number), endOfMonth = new Date(py, pm, 0, 23, 59);
    const plan = planAt(t, endOfMonth), P = PLANS[plan], label = this.label(period);
    const m = monthFees(plan, this.usage(db, t.id, period)), inc = 1 + VAT_RATE, n0 = v => v.toLocaleString('en-PH');
    const sp = FeeReg.split(db, t.id, period), fi = r => round2(r * inc);
    const partial = k => sp.partial.filter(s => s.kind === k);
    const rt = [], out = [];

    /* Deducted in real time. */
    if (sp.full.BASE)
      rt.push({ desc:`${P.label}: fee deducted in real time from ${n0(sp.full.BASE)} buyer payments at ${peso(P.fee)}, ${label}`,
                sku:'EPI-FEE-RT', qty:sp.full.BASE, unit:'document', unitPrice:fi(P.fee), treatment:'VATABLE' });
    if (sp.full.EXCESS)
      rt.push({ desc:`Excess fee deducted in real time from ${n0(sp.full.EXCESS)} buyer payments at ${peso(P.excessFee)}, ${label}`,
                sku:'EPI-EXCESS-RT', qty:sp.full.EXCESS, unit:'document', unitPrice:fi(P.excessFee), treatment:'VATABLE' });
    if (sp.partial.length)
      rt.push({ desc:`Fee deducted in part from ${n0(sp.partial.length)} payments smaller than the fee, ${label}`,
                sku:'EPI-FEE-RT-PART', qty:1, unit:'charge', unitPrice:round2(sp.partial.reduce((a, s) => a + s.feeDeducted, 0)), treatment:'VATABLE' });

    /* Billed in the statement. */
    const baseQty = Math.max(0, m.baseQty - sp.full.BASE - partial('BASE').length);
    const excessQty = Math.max(0, m.excessQty - sp.full.EXCESS - partial('EXCESS').length);
    if (baseQty)
      out.push({ desc: sp.docs ? `${P.label}: fee for ${n0(baseQty)} invoices not paid through the System at ${peso(P.fee)}, ${label}`
                               : `${P.label}: ${n0(m.count)} Billable Documents${m.excessQty ? `, first ${n0(m.baseQty)} at ${peso(P.fee)}` : ` at ${peso(P.fee)}`}, ${label}`,
                 sku:'EPI-FEE', qty:baseQty, unit:'document', unitPrice:fi(P.fee), treatment:'VATABLE' });
    if (excessQty)
      out.push({ desc:`Excess fee: ${n0(excessQty)} invoices above ${n0(P.limit)}${sp.docs ? ' not paid through the System' : ''}, ${label}`,
                 sku:'EPI-EXCESS', qty:excessQty, unit:'document', unitPrice:fi(P.excessFee), treatment:'VATABLE' });
    if (sp.remainder > 0)
      out.push({ desc:`Part of the fee not covered by ${n0(sp.partial.length)} payments smaller than the fee, ${label}`,
                 sku:'EPI-FEE-REST', qty:1, unit:'charge', unitPrice:round2(sp.remainder), treatment:'VATABLE' });
    if (m.adjQty)
      out.push({ desc:`Monthly audit adjustment: ${n0(m.count)} invoices fall in the ${PLANS[m.fit].label} range (${planRange(m.fit)}), ${label}`,
                 sku:'EPI-AUDIT', qty:m.adjQty, unit:'document', unitPrice:fi(m.adjUnit), treatment:'VATABLE' });
    /* Late payment: 1% interest plus a 1% penalty on the unpaid amount for each month past the due date, added to the next invoice. */
    const at = asOf ? new Date(asOf) : new Date();
    out.lateEntries = [];
    BillingReg.all(db).filter(i => i.clientId === t.id && i.paymentStatus !== 'PAID' && !i.paymentSubmitted && new Date(i.dueAt) < at)
      .forEach(i => {
        const months = Math.ceil(Math.floor((at - new Date(i.dueAt)) / 86400000) / 30) - (i.lateMonthsBilled || 0);
        if (months < 1) return;
        out.push({ desc:`Late payment charge on ${i.number}: ${months} month${months === 1 ? '' : 's'} at 2% (1% interest and 1% penalty) of ${peso(i.totals.totalDue)}`,
                   sku:'EPI-LATE', qty:1, unit:'charge', unitPrice:round2(i.totals.totalDue * LATE_RATE * months), treatment:'VATABLE' });
        out.lateEntries.push({ inv:i, months });
      });
    return { realtime:rt, balance:out,
             statement:{ plan, count:m.count, fit:m.fit, below:m.below, excessQty:m.excessQty, adjQty:m.adjQty, rtDocs:sp.docs, rtAmount:sp.deducted } };
  },

  /** The balance to bill for a month. */
  lines(db, t, period, asOf){ return this.parts(db, t, period, asOf).balance; },

  /** EPI's own invoices to its clients are documents of the EPI account (t_epi), issued by its billing specialist. */
  all(db){ return (db.invoices || []).filter(i => i.providerBilling); },
  billerName(db){ const u = (db.users || []).find(x => x.id === 'u_epi_bil'); return u ? u.name : SYSTEM.vendor; },

  /** One plain running number, never restarted: 0000001, 0000002 ... within the approved series. */
  numberFor(db){
    const n = BillingReg.all(db).reduce((m, i) => Math.max(m, parseInt(String(i.number).split('-').pop(), 10) || 0), 0) + 1;
    return String(n).padStart(SYSTEM.taxpayer.series.digits, '0');
  },

  /** One invoice from EPI to one client for one month. Pushed to the database, not saved. */
  /** The invoices EPI issues one client for one month: one for the fees already deducted in real time
      (paid), and one for the balance, either of which may not be needed. Returns the balance invoice,
      or the real-time one when there is no balance. Pushed to the database, not saved. */
  build(db, t, period, opts){
    opts = opts || {};
    const issuedAt = opts.issuedAt || new Date().toISOString();
    const parts = this.parts(db, t, period, issuedAt);
    (parts.balance.lateEntries || []).forEach(e => { e.inv.lateMonthsBilled = (e.inv.lateMonthsBilled || 0) + e.months; });
    const rtInv = parts.realtime.length ? this.make(db, t, period, parts.realtime, issuedAt, Object.assign({}, opts, { realtime:true })) : null;
    const balInv = parts.balance.length ? this.make(db, t, period, parts.balance, issuedAt, opts) : null;
    [rtInv, balInv].forEach(i => { if (i) i.statement = Object.assign({}, parts.statement, { billed: balInv ? balInv.totals.totalDue : 0 }); });
    return balInv || rtInv;
  },

  make(db, t, period, lines, issuedAt, opts){
    const due = new Date(new Date(issuedAt).getTime() + this.PAYMENT_DAYS * 86400000).toISOString();
    const rt = !!opts.realtime, paid = rt || !!opts.paid;
    const inv = {
      id: uid('pinv'), providerBilling:true, tenantId:'t_epi', branchId:'b_epi_000', clientId:t.id,
      docType:'INVOICE', docStatus:'ISSUED', number:this.numberFor(db, issuedAt),
      period, issuedAt, recordedAt:issuedAt, dueAt:due,
      buyer:{ name:t.name, tin:t.tin, address:t.address },
      lines, discount:0, totals:computeTotals(lines, 0, {}),
      currency:'PHP', keycode:keycode(8),
      paymentStatus: paid ? 'PAID' : 'UNPAID', paymentMethod: rt ? 'Deducted in real time from buyer payments' : (paid ? 'Bank Transfer' : null),
      terms: rt ? 'Paid by real-time deduction' : `Due in ${this.PAYMENT_DAYS} days`,
      deliveryStatus:'DELIVERED', deliveryAttempts:1,
      issuedBy:this.billerName(db), issuedVia: rt ? 'EPI monthly billing: fees deducted in real time' : 'EPI monthly billing'
    };
    if (rt){ inv.paymentRef = 'RT-' + period; inv.paidAt = issuedAt; inv.paidRecordedBy = 'Payment provider'; }
    db.invoices.push(inv);
    if (opts.acked){
      const at = new Date(new Date(issuedAt).getTime() + 3 * 60000).toISOString();
      inv.transmissionStatus = 'TRANSMITTED';
      inv.transmittedAt = at;
      inv.transmissionRef = `ESRS-${at.slice(0, 10).replace(/-/g, '')}-${Math.floor(10000 + Math.random() * 89999)}`;
    } else settleTransmission(inv);
    if (t.autoPay && !paid && !opts.acked){
      Object.assign(inv, { paymentStatus:'PAID', paymentMethod:'Auto-debit: ' + t.autoPay.label,
        paymentRef:'AD-' + Math.floor(100000 + Math.random() * 899999), paidAt:issuedAt, paidRecordedBy:'Auto-debit' });
    }
    return inv;
  },

  /** History from each client's go-live month up to the last month finished at seed time. */
  seed(db){
    const asOf = new Date(SEED_TODAY + 'T12:00:00+08:00');
    const jobs = [];
    db.tenants.forEach(t => {
      if (!t.goLiveAt || t.isProvider) return;
      const stop = this.prev(this.key(asOf));
      for (let k = this.key(t.goLiveAt); k <= stop; k = this.next(k)){
        const [y, m] = this.next(k).split('-').map(Number);
        jobs.push({ t, k, at:new Date(`${y}-${String(m).padStart(2, '0')}-01T09:00:00+08:00`).toISOString() });
      }
    });
    jobs.sort((a, b) => new Date(a.at) - new Date(b.at) || a.t.id.localeCompare(b.t.id));
    const latest = {};
    jobs.forEach(j => { latest[j.t.id] = j.k; });
    /* A client's most recent invoice is still open. Two of the four are overdue, which is
       what the screen has to be able to show. */
    const open = new Set(['t_jof', 't_swt']);
    /* Juana's Online Finds also left the month before unpaid, so a bill is past its due date and the
       safety deposit (deposit.js) has something to be used for. */
    const isOpen = j => open.has(j.t.id) && (latest[j.t.id] === j.k || (j.t.id === 't_jof' && this.prev(latest[j.t.id]) === j.k));
    jobs.forEach(j => this.build(db, j.t, j.k, {
      issuedAt:j.at, acked:true, paid: !isOpen(j) }));
    /* A month with no documents has nothing to bill. Mark it covered now so the run button does not offer it. */
    db.tenants.forEach(t => { if (t.goLiveAt && !t.isProvider) this.nextBillable(db, t); });
  },

  mine(){
    return this.all(Store.db).filter(i => i.clientId === CT.id)
      .sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  },

  payState(i){
    if (i.paymentStatus === 'PAID') return { key:'PAID', label:'Paid', cls:'lbadge-green' };
    if (i.paymentSubmitted) return { key:'SUBMITTED', label:'Payment sent, EPI confirming', cls:'lbadge-blue' };
    return new Date(i.dueAt) < new Date() ? { key:'OVERDUE', label:'Overdue', cls:'lbadge-red' }
                                         : { key:'DUE', label:`Due ${fmtDate(i.dueAt)}`, cls:'lbadge-amber' };
  }
};

/* ============================================================
   Handler: the demo billing run
   ============================================================ */

/* One run bills every client for its earliest finished month not yet billed,
   so a client that fell behind catches up one month per run. */
LocalAPI.on("Dashboard/BillingRun", function () {
  if (!can('operate')) return { success:false, message:'Only EPI operations runs the billing.' };
  const db = Store.db;
  const made = [];
  db.tenants.forEach(t => {
    if (t.isProvider) return;
    const next = BillingReg.nextBillable(db, t);
    if (!next) return;
    const period = next.period;
    const inv = BillingReg.build(db, t, period);
    logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI billed this account for ${BillingReg.label(period)}: ${inv.number}, ${peso(inv.totals.totalDue)}` });
    made.push(inv);
  });
  if (!made.length) return { success:false, message:'Every client has been billed for every finished month.' };
  logActivity(db, { actorType:'EPI', action:`Billing run: ${made.length} invoice(s), ${made[0].number} to ${made[made.length - 1].number}` });
  Store.save(db);
  const held = made.filter(i => i.transmissionStatus !== 'TRANSMITTED').length;
  return { success:true, message:`${made.length} invoice(s) issued, ${peso(round2(made.reduce((a, i) => a + i.totals.totalDue, 0)))} in all.` +
    (held ? ` ${held} held for the BIR until the link returns.` : '') };
});

LocalAPI.on("Dashboard/BillingPaid", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations records payments.' };
  const db = Store.db;
  const inv = BillingReg.all(db).find(i => i.id === p.id);
  if (!inv || inv.paymentStatus === 'PAID') return { success:false, message:'That invoice is already paid.' };
  const ref = String(p.reference || '').trim();
  if (!ref) return { success:false, message:'Enter the payment reference (for example, the bank transfer number).' };
  delete inv.paymentSubmitted;
  Object.assign(inv, { paymentStatus:'PAID', paymentMethod:p.method || 'Bank Transfer', paymentRef:ref.slice(0, 60),
                       paidAt:new Date().toISOString(), paidRecordedBy:CU.name });
  logActivity(db, { tenantId:inv.clientId, actorType:'EPI', action:`EPI recorded payment of ${inv.number}, ${peso(inv.totals.totalDue)} (${inv.paymentMethod} ${inv.paymentRef})` });
  Store.save(db);
  return { success:true, message:`${inv.number} marked paid.` };
});

/* ============================================================
   Screen
   ============================================================ */

Object.assign(Views, {

  billing(opts){
    if (opts && opts.docId) return Views.billingDetail(opts.docId);
    const rows = BillingReg.mine();
    const db = Store.db, f = feesFor(CT);
    const now = BillingReg.key(new Date());
    const used = BillingReg.usage(db, CT.id, now);
    const open = rows.filter(i => i.paymentStatus !== 'PAID');
    const owing = round2(open.reduce((a, i) => a + i.totals.totalDue, 0));
    const overdue = open.some(i => BillingReg.payState(i).key === 'OVERDUE');

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">EPI Billing</h1>
          <div class="screen_sub">EPI's charges to ${esc(CT.name)} for this service. These are EPI's invoices to your business. They do not appear in Invoices, sales lists or reports.</div>
        </div>
      </div>

      <div class="row g-2 mb-3">
        <div class="col-12 col-md-6"><div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">Amount due to EPI</span>
          <span class="stat-value mono ${overdue ? 'text-danger' : ''}">${peso(owing)}</span>
          <span class="stat-note">${open.length ? `${open.length} invoice${open.length === 1 ? '' : 's'} unpaid${overdue ? ', some overdue' : ''}` : 'No unpaid invoices'}</span>
        </div></div></div>
        <div class="col-12 col-md-6"><div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">${esc(BillingReg.label(now))} so far</span>
          <span class="stat-value mono">${used.toLocaleString('en-PH')} <span class="fs_13 text-muted fw-normal">documents</span></span>
          <span class="stat-note">${esc(f.short)}: ${peso(f.fee)} per invoice plus VAT. ${f.limit ? `Above ${f.limit.toLocaleString('en-PH')} a month each invoice costs ${peso(f.excessFee)}.` : 'No allowance and no excess fee.'}</span>
        </div></div></div>
      </div>

      ${PayViews.howToPay()}
      ${PayViews.autoPayCard()}
      ${FeeViews.clientCard()}
      ${DepositViews.clientCard()}

      ${overdue ? Callout('warn', `A late payment adds 2% a month (1% interest and a 1% penalty) to your next invoice. An unpaid invoice never limits your access. EPI may not withhold, disable or restrict your data over a fee dispute.`, {cls:'mb-3'}) : ''}

      <div class="lcard"><div class="lcard-body">
        ${rows.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>INVOICE</th><th>FOR</th><th>ISSUED</th><th class="text-end">TOTAL (VAT INCL.)</th><th>PAYMENT</th><th>REPORTED TO BIR</th><th></th></tr></thead>
          <tbody>${rows.map(i => { const ps = BillingReg.payState(i); return `
            <tr><td><span class="hyperlink fw-semibold mono span_billing_open" data-id="${esc(i.id)}">${esc(i.number)}</span></td>
              <td>${esc(BillingReg.label(i.period))}</td><td>${esc(fmtDate(i.issuedAt))}</td>
              <td class="text-end mono">${num(i.totals.totalDue)}</td>
              <td><span class="lbadge ${ps.cls} lbadge-dot">${esc(ps.label)}</span></td>
              <td>${badge('transmission', i.transmissionStatus)}${i.transmissionRef ? `<div class="mono fs_11 text-muted mt-1">${esc(i.transmissionRef)}</div>` : ''}</td>
              <td class="text-end">${i.paymentStatus !== 'PAID' && can('billing') ? `<button class="lbtn lbtn-sm lbtn-primary button_pay_open" data-id="${esc(i.id)}">Pay now</button>` : ''}</td></tr>`; }).join('')}
          </tbody></table></div>`
          : '<div class="fs_13 text-muted">EPI has not invoiced this account yet. The first invoice is issued after the first full month.</div>'}
      </div></div>`;
  },

  billingDetail(id){
    const inv = BillingReg.all(Store.db).find(i => i.id === id && i.clientId === CT.id);
    if (!inv) return '<div class="p-4">That invoice is not on this account.</div>';
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title mono">${esc(inv.number)}</h1>
          <div class="screen_sub">EPI's invoice to ${esc(CT.name)} for ${esc(BillingReg.label(inv.period))}.</div>
        </div>
        <div class="d-flex gap-2">
          ${inv.paymentStatus !== 'PAID' && can('billing') ? `<button class="lbtn lbtn-sm lbtn-primary button_pay_open" data-id="${esc(inv.id)}">Pay now</button>` : ''}
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('billing')">Back</button>
          <button class="lbtn lbtn-sm lbtn-accent" onclick="InvoiceDoc.print('${esc(inv.id)}')"><i class="bi bi-printer me-1"></i>Print</button>
        </div>
      </div>
      ${FeeViews.statement(inv)}
      <div class="lcard"><div class="lcard-body">${InvoiceDoc.render(inv)}</div></div>`;
  }
});

Screens.billing = function (opts) {
  PayUI.bindBilling();
  DepositUI.bindClient();
  FeeUI.bindClient();
  if (opts && opts.docId) return;
  $(".span_billing_open").off("click").on("click", function () { Nav.go('billing', { docId:$(this).data("id") }); });
};
