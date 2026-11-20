/* ============================================================
   realtime.js — the fee, deducted in real time (Client Service Agreement 4.6 and 4.7)

   The fee for each invoice is due when the invoice is issued. When the buyer pays through the
   System, the client's payment service provider deducts the fee plus VAT from the amount of that
   transaction, pays it to EPI, and settles the balance to the client's own bank or e-wallet account,
   in real time or the next banking day (T+1). EPI never holds the client's money. The provider is
   either the client's own, which the client instructs in writing to make the deduction, or a partner
   of EPI. The provider's processing charge is between the provider and whoever pays it.

   A document that is not paid through the System, or whose amount is less than the fee, is billed
   in the monthly statement instead (billing.js). A failed deduction never stops issuing. Once an
   invoice is issued the fee is not refunded, whatever happens to the buyer's payment (4.7). If the
   client cancels its instruction to the provider, fees are billed monthly, and the cancellation is a
   breach unless a working replacement is given within 15 days.

   Here the provider is simulated: nothing is charged and nothing is paid out. A deduction is
   recorded on the document (inv.systemPayment). The provider on record is t.provider.
   ============================================================ */

const FeeReg = {

  METHOD: 'Pay through the System',      /* what the issuer picks: the buyer pays through the provider */
  PAID_VIA: 'Paid through the System',   /* what the document shows once the buyer has paid */
  REPLACE_DAYS: 15,

  PROVIDERS: {
    OWN:         { label:'My own payment service provider' },
    EPI_PARTNER: { label:'EPI\'s payment partner' }
  },
  EPI_PARTNER_NAME: 'Sentral Pay Services, Inc. (EPI partner, illustrative)',

  provider(t){ return (t && t.provider) || null; },
  active(t){ const p = this.provider(t); return !!(p && p.instruction && p.instruction.status === 'ACTIVE'); },
  /** Whether the issuer may offer "Pay through the System" on a new invoice. */
  canTake(t){ return this.active(t); },
  replaceLate(t){
    const p = this.provider(t);
    return !!(p && p.instruction && p.instruction.status === 'CANCELLED' && new Date(p.instruction.replaceBy) < new Date());
  },

  /** The next banking day after a date (Monday to Friday), at the start of the day. */
  nextBankingDay(iso){
    const d = new Date(iso); d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString();
  },

  /** A document's place in its month: the nth document the client issued that month. */
  rankOf(db, inv){
    const period = BillingReg.key(inv.issuedAt), at = new Date(inv.issuedAt).getTime();
    return db.invoices.filter(i => i.tenantId === inv.tenantId && i.docStatus !== 'DRAFT' && BillingReg.key(i.issuedAt) === period &&
      (new Date(i.issuedAt).getTime() < at || (new Date(i.issuedAt).getTime() === at && String(i.number || i.id) <= String(inv.number || inv.id)))).length;
  },

  /** The buyer pays through the System: the provider deducts the fee and settles the rest. */
  pay(db, inv, at){
    const t = db.tenants.find(x => x.id === inv.tenantId), prov = this.provider(t);
    if (!prov) return null;
    at = at || new Date().toISOString();
    const P = PLANS[planAt(t, at)], rank = this.rankOf(db, inv);
    const excess = P.limit != null && rank > P.limit, rate = excess ? P.excessFee : P.fee;
    const feeDue = round2(rate * (1 + VAT_RATE)), buyer = round2(inv.totals.totalDue), taken = Math.min(buyer, feeDue);
    const ref = 'PSP-' + at.slice(0, 10).replace(/-/g, '') + '-' + Math.floor(100000 + Math.random() * 899999);
    inv.paymentStatus = 'PAID'; inv.paymentRef = ref; inv.paidAt = at;
    if (!inv.paymentMethod || inv.paymentMethod === this.METHOD) inv.paymentMethod = this.PAID_VIA;   /* a seeded card or wallet sale keeps its label */
    delete inv.paymentLink;
    inv.systemPayment = { at, ref, provider:prov.name, mode:prov.mode, buyerPaid:buyer, kind:excess ? 'EXCESS' : 'BASE', rate,
      feeDue, feeDeducted:taken, settled:round2(buyer - taken), schedule:prov.settlement,
      settleOn: prov.settlement === 'T+1' ? this.nextBankingDay(at) : at, account:prov.account && prov.account.label };
    return inv.systemPayment;
  },

  /** Documents the provider took a fee from in a month, and what was left to bill. */
  split(db, tenantId, period){
    const r = { full:{ BASE:0, EXCESS:0 }, rate:{ BASE:0, EXCESS:0 }, partial:[], deducted:0, remainder:0, docs:0 };
    db.invoices.filter(i => i.tenantId === tenantId && i.systemPayment && BillingReg.key(i.issuedAt) === period).forEach(i => {
      const s = i.systemPayment;
      if (s.remitFailed) return;   /* the provider never paid this fee to EPI: it is billed in the statement instead */
      r.docs++; r.deducted = round2(r.deducted + s.feeDeducted);
      if (s.feeDeducted >= s.feeDue){ r.full[s.kind]++; r.rate[s.kind] = round2(s.feeDue); }
      else { r.partial.push(s); r.remainder = round2(r.remainder + (s.feeDue - s.feeDeducted)); }
    });
    return r;
  },

  /** What the client sees in its ledger: documents paid through the System, newest first. */
  ledger(db, tenantId){
    return db.invoices.filter(i => i.tenantId === tenantId && i.systemPayment)
      .sort((a, b) => new Date(b.systemPayment.at) - new Date(a.systemPayment.at));
  }
};

/* ============================================================
   Handlers
   ============================================================ */

LocalAPI.on("Dashboard/ProviderSave", function (p) {
  if (!can('taxProfile')) return { success:false, message:'Only an owner can set up the payment provider.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId);
  if (!t) return { success:false, message:'Account not found.' };
  if (!FeeReg.PROVIDERS[p.mode]) return { success:false, message:'Choose whose payment provider collects the fee.' };
  const name = p.mode === 'OWN' ? String(p.name || '').trim() : FeeReg.EPI_PARTNER_NAME;
  if (!name) return { success:false, message:'Enter the name of your payment service provider.' };
  const account = String(p.account || '').trim();
  if (!account) return { success:false, message:'Enter the bank or e-wallet account the balance is settled to.' };
  if (['REALTIME', 'T+1'].indexOf(p.settlement) === -1) return { success:false, message:'Choose when the balance is paid to you.' };
  if (p.mode === 'OWN' && !(p.instructed === true || p.instructed === 'true'))
    return { success:false, message:'Confirm that you have instructed your provider in writing to deduct EPI\'s fee from each payment.' };
  t.provider = { mode:p.mode, name, account:{ kind:p.accountKind === 'EWALLET' ? 'E-wallet' : 'Bank', label:account },
    settlement:p.settlement, instruction:{ status:'ACTIVE', signedAt:new Date().toISOString(), by:CU.name } };
  logActivity(db, { action:`Set up real-time fee deduction through ${name}, settled to ${account} (${p.settlement === 'T+1' ? 'next banking day' : 'real time'})` });
  Store.save(db);
  return { success:true, message:`Real-time deduction is on through ${name}. Invoices can now be paid through the System.` };
});

LocalAPI.on("Dashboard/ProviderInstruction", function (p) {
  if (!can('taxProfile')) return { success:false, message:'Only an owner can change the instruction to the payment provider.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId), prov = FeeReg.provider(t);
  if (!prov) return { success:false, message:'No payment provider is set up.' };
  if (p.action === 'cancel'){
    if (prov.instruction.status !== 'ACTIVE') return { success:false, message:'The instruction is already cancelled.' };
    prov.instruction = Object.assign({}, prov.instruction, { status:'CANCELLED', cancelledAt:new Date().toISOString(),
      replaceBy:new Date(Date.now() + FeeReg.REPLACE_DAYS * 86400000).toISOString(), cancelledBy:CU.name });
    logActivity(db, { action:'Cancelled the instruction to the payment provider. Fees are billed monthly until a replacement is given' });
    Store.save(db);
    return { success:true, message:`Cancelled. Invoices can no longer be paid through the System, and fees are billed monthly. A working replacement is due by ${fmtDate(prov.instruction.replaceBy)}.` };
  }
  if (prov.instruction.status === 'ACTIVE') return { success:false, message:'The instruction is already in force.' };
  prov.instruction = { status:'ACTIVE', signedAt:new Date().toISOString(), by:CU.name };
  logActivity(db, { action:'Gave a replacement instruction to the payment provider' });
  Store.save(db);
  return { success:true, message:'The instruction is back in force. Invoices can be paid through the System again.' };
});

/* Demo: the buyer pays an invoice through the System's payment link. */
LocalAPI.on("Dashboard/BuyerPays", function (p) {
  if (!can('issue')) return { success:false, message:'Your role cannot record a buyer payment.' };
  const db = Store.db, inv = Auth.visibleInvoices().find(i => i.id === p.id);
  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  if (!inv.paymentLink || inv.paymentStatus === 'PAID') return { success:false, message:'That document is not waiting for a payment through the System.' };
  const t = db.tenants.find(x => x.id === inv.tenantId);
  if (!FeeReg.active(t)) return { success:false, message:'The instruction to the payment provider is cancelled, so the buyer cannot pay through the System. The fee is billed in the monthly statement.' };
  const s = FeeReg.pay(db, inv);
  logActivity(db, { action:`Buyer paid ${inv.number} through the System: ${peso(s.buyerPaid)}, fee ${peso(s.feeDeducted)} deducted, ${peso(s.settled)} settled to the client (${s.schedule === 'T+1' ? 'next banking day' : 'real time'})` });
  Store.save(db);
  return { success:true, message:`Paid. ${peso(s.feeDeducted)} was deducted for EPI and ${peso(s.settled)} is settled to ${esc(s.account || 'your account')}${s.schedule === 'T+1' ? ' on ' + fmtDate(s.settleOn) : ' now'}.` };
});

/* ============================================================
   Markup
   ============================================================ */

const FeeViews = {

  when(s){ return s.schedule === 'T+1' ? fmtDate(s.settleOn) : 'Real time'; },

  /** What the client sees on the EPI Billing screen. */
  clientCard(){
    const t = CT, prov = FeeReg.provider(t), db = Store.db, canSet = can('taxProfile');
    const period = BillingReg.key(new Date()), sp = FeeReg.split(db, t.id, period);
    const used = BillingReg.usage(db, t.id, period);
    const rows = FeeReg.ledger(db, t.id).slice(0, 6);
    let status = '';
    if (prov && prov.instruction.status === 'CANCELLED')
      status = Callout(FeeReg.replaceLate(t) ? 'danger' : 'warn',
        `<strong>The instruction to ${esc(prov.name)} is cancelled.</strong> Invoices cannot be paid through the System, and EPI bills the fees monthly.
         Give a working replacement by ${esc(fmtDate(prov.instruction.replaceBy))}. After that, the cancellation is a breach of the agreement.`, {cls:'mb-3'});
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <div class="d-flex flex-wrap align-items-start gap-3 mb-2">
          <div class="flex-grow-1">
            <strong class="fs_13 text-secondary fw-bold d-block mb-1">FEES TAKEN FROM PAYMENTS</strong>
            <div class="fs_12 text-muted">When a buyer pays an invoice through the System, the payment provider takes EPI's fee and VAT from that payment and pays the rest to your account. EPI never holds your money. An invoice not paid through the System is billed in the monthly statement. Issuing never stops if the fee cannot be taken.</div>
          </div>
          ${canSet ? (prov
            ? `<button class="lbtn lbtn-sm lbtn-ghost button_provider_setup">Change</button>
               ${prov.instruction.status === 'ACTIVE'
                 ? '<button class="lbtn lbtn-sm lbtn-ghost button_provider_cancel">Cancel the instruction</button>'
                 : '<button class="lbtn lbtn-sm lbtn-primary button_provider_restore">Give a replacement instruction</button>'}`
            : '<button class="lbtn lbtn-sm lbtn-primary button_provider_setup">Set up</button>') : ''}
        </div>
        ${prov ? `
        <dl class="dl mb-3">
          <dt>Payment provider</dt><dd>${esc(prov.name)} <span class="text-muted">· ${prov.mode === 'OWN' ? 'your own provider' : "EPI's partner"}</span></dd>
          <dt>Balance paid to</dt><dd>${esc(prov.account.kind)}: ${esc(prov.account.label)} · ${prov.settlement === 'T+1' ? 'next banking day' : 'real time'}</dd>
          <dt>Instruction</dt><dd>${prov.instruction.status === 'ACTIVE' ? '<span class="lbadge lbadge-green">In force</span>' : '<span class="lbadge lbadge-red">Cancelled</span>'}</dd>
          <dt>${esc(BillingReg.label(period))} so far</dt><dd>${sp.docs} of ${used} invoices paid through the System · ${peso(sp.deducted)} taken</dd>
        </dl>` : Callout('info', 'Real-time deduction is not set up. Fees are billed in the monthly statement, and invoices cannot be paid through the System.', {cls:'mb-3'})}
        ${status}
        ${rows.length ? `<div class="table-responsive"><table class="table fs_12 mb-0">
          <thead><tr><th>INVOICE</th><th>PAID</th><th class="text-end">BUYER PAID</th><th class="text-end">FEE + VAT TAKEN</th><th class="text-end">PAID TO YOU</th><th>PAID ON</th></tr></thead>
          <tbody>${rows.map(i => { const s = i.systemPayment; return `<tr>
            <td><span class="hyperlink mono" onclick="Nav.go('invoices',{docId:'${esc(i.id)}'})">${esc(i.number)}</span></td>
            <td>${esc(fmtDate(s.at))}</td><td class="text-end mono">${num(s.buyerPaid)}</td>
            <td class="text-end mono">${num(s.feeDeducted)}${s.feeDeducted < s.feeDue ? '<div class="fs_11 text-muted">part, rest billed</div>' : s.kind === 'EXCESS' ? '<div class="fs_11 text-muted">excess fee</div>' : ''}</td>
            <td class="text-end mono">${num(s.settled)}</td><td>${esc(this.when(s))}</td></tr>`; }).join('')}</tbody></table></div>` : ''}
      </div></div>`;
  },

  /** On a document in the register: how it was paid, and what the provider deducted. */
  docPanel(inv){
    const s = inv.systemPayment;
    if (!s && !inv.paymentLink) return '';
    if (s) return `
      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">PAID THROUGH THE SYSTEM</strong>
        <dl class="dl mb-0">
          <dt>Provider</dt><dd>${esc(s.provider)} <span class="text-muted mono">${esc(s.ref)}</span></dd>
          <dt>Buyer paid</dt><dd class="mono">${peso(s.buyerPaid)} on ${esc(fmtDateTime(s.at))}</dd>
          <dt>Fee deducted</dt><dd class="mono">${peso(s.feeDeducted)} <span class="text-muted">(${s.kind === 'EXCESS' ? 'excess fee' : 'fee'} ${peso(s.rate)} plus VAT)</span>${s.feeDeducted < s.feeDue ? `<div class="fs_11 text-muted">The payment was smaller than the fee. The other ${peso(round2(s.feeDue - s.feeDeducted))} is billed in the monthly statement.</div>` : ''}</dd>
          <dt>Settled to you</dt><dd class="mono">${peso(s.settled)} · ${esc(s.account || '')} · ${esc(this.when(s))}</dd>
        </dl>
      </div></div>`;
    return `
      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">WAITING FOR THE BUYER'S PAYMENT</strong>
        <div class="fs_12 text-muted mb-2">The buyer pays through the System's payment link. The provider then takes EPI's fee from the payment and pays the rest to you. If it is not paid through the System, the fee is billed in the monthly statement.</div>
        ${can('issue') ? `<button class="lbtn lbtn-sm lbtn-primary button_buyer_pays" data-id="${esc(inv.id)}">Simulate the buyer paying</button>` : ''}
      </div></div>`;
  },

  /** Operator: each client's provider and how much of this month's fees were deducted. */
  opsPanel(){
    const db = Store.db, period = BillingReg.key(new Date());
    const rows = OpsReg.tenants().map(t => {
      const prov = FeeReg.provider(t), sp = FeeReg.split(db, t.id, period), used = BillingReg.usage(db, t.id, period);
      const m = monthFees(planOf(t), used), inc = 1 + VAT_RATE;
      const billAtEnd = round2(Math.max(0, m.total * inc - sp.deducted));
      return `<tr><td>${esc(t.name)}</td>
        <td>${prov ? esc(prov.name) + `<div class="fs_11 text-muted">${prov.mode === 'OWN' ? 'client\'s own provider' : 'EPI partner'} · ${prov.settlement === 'T+1' ? 'next banking day' : 'real time'}</div>` : '<span class="text-muted">Not set up</span>'}</td>
        <td>${!prov ? '—' : prov.instruction.status === 'ACTIVE' ? '<span class="lbadge lbadge-green">In force</span>'
           : `<span class="lbadge ${FeeReg.replaceLate(t) ? 'lbadge-red' : 'lbadge-amber'}">Cancelled</span><div class="fs_11 text-muted">replace by ${esc(fmtDate(prov.instruction.replaceBy))}${FeeReg.replaceLate(t) ? ', in breach' : ''}</div>`}</td>
        <td class="text-end mono">${sp.docs} / ${used}</td><td class="text-end mono">${num(sp.deducted)}</td><td class="text-end mono">${num(billAtEnd)}</td></tr>`;
    }).join('');
    return `
      <div class="lcard"><div class="lcard-body">
        <div class="fs_12 text-muted mb-2">The payment provider takes EPI's fee and VAT from each payment a buyer makes through the System and pays the rest to the client. EPI holds none of the client's money. What the provider cannot deduct is billed in the monthly statement, with the audit difference. ${esc(BillingReg.label(period))} so far, VAT inclusive; the amount still to bill is an estimate.</div>
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>CLIENT</th><th>PROVIDER</th><th>INSTRUCTION</th><th class="text-end">PAID THROUGH SYSTEM / ALL</th><th class="text-end">DEDUCTED</th><th class="text-end">STILL TO BILL (EST.)</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div></div>`;
  },

  /** The monthly statement, shown on EPI's invoices. */
  statement(inv){
    const s = inv.statement;
    if (!s) return '';
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">MONTHLY STATEMENT · ${esc(BillingReg.label(inv.period).toUpperCase())}</strong>
        <dl class="dl mb-2">
          <dt>Tier</dt><dd>${esc(PLANS[s.plan].label)}</dd>
          <dt>Billable Documents</dt><dd class="mono">${s.count.toLocaleString('en-PH')}${s.excessQty ? ` <span class="text-muted">(${s.excessQty.toLocaleString('en-PH')} above the allowance and margin)</span>` : ''}</dd>
          <dt>Paid through the System</dt><dd>${s.rtDocs.toLocaleString('en-PH')} documents · fees deducted in real time ${peso(s.rtAmount)}</dd>
          <dt>Monthly audit</dt><dd>${s.below ? `Use is below the range of ${esc(PLANS[s.plan].short)}. The month is charged at ${esc(PLANS[s.fit].label)}, and the difference is billed below.` : 'Use is within the range of the tier. No adjustment.'}</dd>
          <dt>Billed in this statement</dt><dd class="mono">${peso(s.billed)} <span class="text-muted">(VAT inclusive; documents not paid through the System, the part of a fee not covered, the audit difference and late charges)</span></dd>
        </dl>
        <div class="fs_11 text-muted">Fees deducted in real time are invoiced separately and are already paid. Fees are not refunded once an invoice is issued.</div>
      </div></div>`;
  }
};

/* ============================================================
   Modals and bindings
   ============================================================ */

const FeeUI = {

  bindClient(){
    $(".button_provider_setup").off("click").on("click", () => FeeUI.setupModal());
    $(".button_provider_cancel").off("click").on("click", () => {
      DisplayConfirmSwal(
        `<span class="fw-bold fs_18 text-dark">Cancel the instruction?</span>
         <span class="fs_14 text-muted">Invoices can no longer be paid through the System, and EPI bills your fees monthly. You must give a working replacement within ${FeeReg.REPLACE_DAYS} days, or it is a breach of the agreement.</span>`,
        () => PayUI.act('ProviderInstruction', { action:'cancel' }, 'billing'), null, 'Cancel it');
    });
    $(".button_provider_restore").off("click").on("click", () => PayUI.act('ProviderInstruction', { action:'restore' }, 'billing'));
  },

  setupModal(){
    const p = FeeReg.provider(CT) || {};
    UI.openModal('Real-time fee deduction', `
      <div class="fs_12 text-muted mb-2">Choose who collects. The provider takes EPI's fee and VAT from each payment a buyer makes through the System, pays it to EPI and pays the rest to you. EPI does not hold your money. The provider's own charge is between you (or the buyer) and the provider.</div>
      <span class="d-block fs_12 fw-semibold mb-1">Payment provider</span>
      <select class="form-select form-select-sm mb-2 select_prov_mode">
        ${Object.keys(FeeReg.PROVIDERS).map(k => `<option value="${k}" ${p.mode === k ? 'selected' : ''}>${esc(FeeReg.PROVIDERS[k].label)}</option>`).join('')}
      </select>
      <div class="div_prov_own">
        <span class="d-block fs_12 fw-semibold mb-1">Provider name</span>
        <input type="text" class="form-control form-control-sm mb-2 input_prov_name" maxlength="80" value="${esc(p.mode === 'OWN' ? p.name : '')}" placeholder="Name of your payment service provider">
      </div>
      <div class="fs_12 mb-2 div_prov_partner d-none">Partner: <strong>${esc(FeeReg.EPI_PARTNER_NAME)}</strong></div>
      <span class="d-block fs_12 fw-semibold mb-1">Settle the balance to</span>
      <div class="d-flex gap-2 mb-2">
        <select class="form-select form-select-sm select_prov_acckind" style="max-width:130px"><option value="BANK">Bank</option><option value="EWALLET" ${p.account && p.account.kind === 'E-wallet' ? 'selected' : ''}>E-wallet</option></select>
        <input type="text" class="form-control form-control-sm input_prov_account" maxlength="80" value="${esc(p.account ? p.account.label : '')}" placeholder="Account name and number">
      </div>
      <span class="d-block fs_12 fw-semibold mb-1">When you are paid</span>
      <select class="form-select form-select-sm mb-2 select_prov_settle">
        <option value="REALTIME" ${p.settlement === 'REALTIME' ? 'selected' : ''}>In real time</option>
        <option value="T+1" ${p.settlement === 'T+1' ? 'selected' : ''}>Next banking day</option>
      </select>
      <label class="d-flex gap-2 fs_12 div_prov_instr"><input type="checkbox" class="check_prov_instr"> I have instructed my provider in writing to deduct EPI's fee from each payment, and I will keep that instruction in force.</label>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_prov_go">Save</button>`, 'sm');
    const sync = () => {
      const own = $(".select_prov_mode").val() === 'OWN';
      $(".div_prov_own, .div_prov_instr").toggleClass("d-none", !own);
      $(".div_prov_partner").toggleClass("d-none", own);
    };
    $(".select_prov_mode").on("change", sync); sync();
    $(".button_prov_go").on("click", () => PayUI.act('ProviderSave', {
      mode:$(".select_prov_mode").val(), name:$(".input_prov_name").val(), accountKind:$(".select_prov_acckind").val(),
      account:$(".input_prov_account").val(), settlement:$(".select_prov_settle").val(), instructed:$(".check_prov_instr").is(":checked") }, 'billing'));
  },

  bindDoc(){
    $(".button_buyer_pays").off("click").on("click", function () { PayUI.act('BuyerPays', { id:$(this).data("id") }, 'invoices', { docId:$(this).data("id") }); });
  }
};
