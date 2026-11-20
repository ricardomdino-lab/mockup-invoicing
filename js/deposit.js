/* ============================================================
   deposit.js — the safety deposit (Client Service Agreement 4.8)

   Each client pays a refundable safety deposit before activation, sized to its tier
   (PLANS[tier].deposit in core.js). It is not a fee, a prepayment or a minimum charge, and the
   client cannot use it in place of paying a bill. It secures what the client owes after the
   monthly audit or a failed deduction. If a bill stays unpaid after its due date and EPI has
   sent a written notice, EPI may deduct the unpaid amount, with the interest and penalty, from
   the deposit, and the client restores it within 15 days. The deposit is held without interest,
   moves with the tier (up before the larger tier starts, down with the next statement) and is
   refunded when the agreement ends, after setting off anything owed.

   The ledger lives on the tenant: t.deposit = { entries:[...], restoreBy }. An entry carries a
   signed amount, so the held amount is their sum. Payments here are simulated; nothing is charged.
   ============================================================ */

const DepositReg = {

  RESTORE_DAYS: 15,

  LABEL: {
    PAID:     'Safety deposit paid',
    TOPUP:    'Added to the deposit',
    RESTORED: 'Deposit restored',
    DEDUCTED: 'Deducted for an unpaid bill',
    REFUND:   'Refunded'
  },

  entries(t){ return (t && t.deposit && t.deposit.entries) || []; },
  held(t){ return round2(this.entries(t).reduce((s, e) => s + e.amount, 0)); },
  required(t){ return PLANS[planOf(t)].deposit; },
  shortfall(t){ return Math.max(0, round2(this.required(t) - this.held(t))); },

  /** The larger tier a client has chosen but that has not started yet, and what it needs. */
  next(t){
    const sch = PayReg.scheduled(t);
    if (!sch || !planKey(sch.plan)) return null;
    const amount = PLANS[planKey(sch.plan)].deposit;
    return { plan:planKey(sch.plan), from:sch.from, amount, due:Math.max(0, round2(amount - this.held(t))) };
  },
  /** What the client should pay now: the shortfall, or the rise needed for a larger tier. */
  due(t){ const n = this.next(t); return Math.max(this.shortfall(t), n ? n.due : 0); },
  restoreLate(t){
    return !!(t.deposit && t.deposit.restoreBy && new Date(t.deposit.restoreBy) < new Date() && this.shortfall(t) > 0);
  },

  /** The opening entry written when an account is activated. */
  opening(plan, method, by, at){
    return { entries:[{ id:uid('dep'), at, kind:'PAID', amount:PLANS[planKey(plan)].deposit,
                        note:'Paid before activation', method:method || '', by:by || '' }], restoreBy:null };
  },

  add(t, kind, amount, extra){
    t.deposit = t.deposit || { entries:[], restoreBy:null };
    const e = Object.assign({ id:uid('dep'), at:new Date().toISOString(), kind, amount:round2(amount), by:CU.name }, extra || {});
    t.deposit.entries.push(e);
    return e;
  },

  /** Unpaid invoices from EPI that are past their due date and not waiting on a payment check. */
  overdue(t){
    return BillingReg.all(Store.db).filter(i => i.clientId === t.id && i.paymentStatus !== 'PAID' &&
      !i.paymentSubmitted && BillingReg.payState(i).key === 'OVERDUE');
  },
  /** Interest and penalty (2% a month) not yet put on an invoice. */
  late(inv){
    const days = Math.floor((Date.now() - new Date(inv.dueAt)) / 86400000);
    const months = Math.max(0, Math.ceil(days / 30) - (inv.lateMonthsBilled || 0));
    return { months, amount: round2(inv.totals.totalDue * LATE_RATE * months) };
  }
};

/* ============================================================
   Handlers
   ============================================================ */

/* The client pays into its own deposit: to restore it after a deduction, or to cover a larger tier. */
LocalAPI.on("Dashboard/DepositPay", function (p) {
  if (!can('billing')) return { success:false, message:'Only a user with billing access can pay the deposit.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId);
  if (!t) return { success:false, message:'Account not found.' };
  const m = PAY_METHODS[p.method];
  if (!m) return { success:false, message:'Select how you are paying.' };
  const amount = round2(Number(p.amount));
  if (!(amount > 0)) return { success:false, message:'Enter the amount to pay.' };
  const restoring = DepositReg.shortfall(t) > 0;
  DepositReg.add(t, restoring ? 'RESTORED' : 'TOPUP', amount, {
    note: restoring ? 'Restored to the amount for ' + PLANS[planOf(t)].label : 'For a larger tier', method:m.label });
  if (DepositReg.shortfall(t) === 0 && t.deposit.restoreBy) t.deposit.restoreBy = null;
  logActivity(db, { action:`Paid ${peso(amount)} into the safety deposit (${m.label})` });
  Store.save(db);
  return { success:true, message:`${peso(amount)} added to the safety deposit. It now holds ${peso(DepositReg.held(t))}. Demo only: nothing was charged.` };
});

/* EPI takes an unpaid bill from the deposit, after the written notice. */
LocalAPI.on("Dashboard/OpsDepositDeduct", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can deduct from a deposit.' };
  const db = Store.db, t = db.tenants.find(x => x.id === p.tenant);
  if (!t) return { success:false, message:'Account not found.' };
  const inv = DepositReg.overdue(t).find(i => i.id === p.invoice);
  if (!inv) return { success:false, message:'Choose an unpaid invoice that is past its due date.' };
  if (!(p.notice === true || p.notice === 'true')) return { success:false, message:'Confirm that a written notice was sent to the client first.' };
  const late = DepositReg.late(inv), held = DepositReg.held(t);
  const withLate = round2(inv.totals.totalDue + late.amount);
  let take = 0, lateTaken = 0;
  if (held >= withLate){ take = withLate; lateTaken = late.months; }
  else if (held >= inv.totals.totalDue){ take = round2(inv.totals.totalDue); }
  else return { success:false, message:`The deposit holds ${peso(held)}, which does not cover ${inv.number} (${peso(inv.totals.totalDue)}). The rest is collected by other means, including legal action.` };
  DepositReg.add(t, 'DEDUCTED', -take, { note:`${inv.number}${lateTaken ? ', with 2% a month interest and penalty' : ''}`, invoiceId:inv.id, ref:'DEP-' + Math.floor(100000 + Math.random() * 899999) });
  const entry = t.deposit.entries[t.deposit.entries.length - 1];
  Object.assign(inv, { paymentStatus:'PAID', paymentMethod:'Safety deposit', paymentRef:entry.ref, paidAt:entry.at, paidRecordedBy:CU.name });
  if (lateTaken) inv.lateMonthsBilled = (inv.lateMonthsBilled || 0) + lateTaken;
  t.deposit.restoreBy = new Date(Date.now() + DepositReg.RESTORE_DAYS * 86400000).toISOString();
  logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI deducted ${peso(take)} from the safety deposit for ${inv.number}. The client restores it by ${fmtDate(t.deposit.restoreBy)}` });
  Store.save(db);
  return { success:true, message:`${peso(take)} deducted for ${inv.number}. ${t.name} must restore the deposit by ${fmtDate(t.deposit.restoreBy)}.` };
});

/* EPI refunds all or part of a deposit: a smaller tier, or the end of the agreement. */
LocalAPI.on("Dashboard/OpsDepositRefund", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can refund a deposit.' };
  const db = Store.db, t = db.tenants.find(x => x.id === p.tenant);
  if (!t) return { success:false, message:'Account not found.' };
  const amount = round2(Number(p.amount)), held = DepositReg.held(t);
  if (!(amount > 0)) return { success:false, message:'Enter the amount to refund.' };
  if (amount > held) return { success:false, message:`The deposit holds only ${peso(held)}.` };
  const reason = String(p.reason || '').trim();
  if (!reason) return { success:false, message:'Choose the reason for the refund.' };
  if (reason === 'Agreement ended'){
    const owed = BillingReg.all(db).filter(i => i.clientId === t.id && i.paymentStatus !== 'PAID').reduce((s, i) => s + i.totals.totalDue, 0);
    if (round2(held - amount) < round2(owed))
      return { success:false, message:`The client still owes ${peso(owed)}. Deduct it first, or refund less.` };
  }
  DepositReg.add(t, 'REFUND', -amount, { note:reason, ref:'RF-' + Math.floor(100000 + Math.random() * 899999) });
  logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI refunded ${peso(amount)} of the safety deposit (${reason})` });
  Store.save(db);
  return { success:true, message:`${peso(amount)} refunded to ${t.name}. The deposit now holds ${peso(DepositReg.held(t))}.` };
});

/* EPI records a deposit payment that arrived outside the system (a bank transfer or a check). */
LocalAPI.on("Dashboard/OpsDepositReceive", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations can record a deposit payment.' };
  const db = Store.db, t = db.tenants.find(x => x.id === p.tenant);
  if (!t) return { success:false, message:'Account not found.' };
  const amount = round2(Number(p.amount)), ref = String(p.reference || '').trim();
  if (!(amount > 0)) return { success:false, message:'Enter the amount received.' };
  if (!ref) return { success:false, message:'Enter the payment reference.' };
  const restoring = DepositReg.shortfall(t) > 0;
  DepositReg.add(t, restoring ? 'RESTORED' : 'TOPUP', amount, { note:restoring ? 'Restored to the amount for ' + PLANS[planOf(t)].label : 'For a larger tier', method:p.method || 'Bank Transfer', ref:ref.slice(0, 60) });
  if (DepositReg.shortfall(t) === 0 && t.deposit.restoreBy) t.deposit.restoreBy = null;
  logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI recorded ${peso(amount)} paid into the safety deposit (${p.method || 'Bank Transfer'} ${ref})` });
  Store.save(db);
  return { success:true, message:`${peso(amount)} recorded. The deposit now holds ${peso(DepositReg.held(t))}.` };
});

/* ============================================================
   Markup
   ============================================================ */

const DepositViews = {

  ledger(t, limit){
    let run = 0;
    const rows = DepositReg.entries(t).map(e => { run = round2(run + e.amount); return Object.assign({ balance:run }, e); }).reverse();
    const shown = limit ? rows.slice(0, limit) : rows;
    if (!shown.length) return '<div class="fs_13 text-muted">No deposit has been recorded.</div>';
    return `<div class="table-responsive"><table class="table fs_12 mb-0">
      <thead><tr><th>DATE</th><th>EVENT</th><th>DETAIL</th><th class="text-end">AMOUNT</th><th class="text-end">HELD AFTER</th></tr></thead>
      <tbody>${shown.map(e => `<tr><td>${esc(fmtDate(e.at))}</td><td>${esc(DepositReg.LABEL[e.kind] || e.kind)}</td>
        <td>${esc(e.note || '')}${e.method ? `<div class="fs_11 text-muted">${esc(e.method)}</div>` : ''}${e.ref ? `<div class="fs_11 text-muted mono">${esc(e.ref)}</div>` : ''}</td>
        <td class="text-end mono ${e.amount < 0 ? 'text-danger' : ''}">${e.amount < 0 ? '(' + num(-e.amount) + ')' : num(e.amount)}</td>
        <td class="text-end mono">${num(e.balance)}</td></tr>`).join('')}</tbody></table></div>`;
  },

  /** The client's own card on the EPI Billing screen. */
  clientCard(){
    const t = CT, held = DepositReg.held(t), req = DepositReg.required(t), short = DepositReg.shortfall(t), nxt = DepositReg.next(t);
    const f = PLANS[planOf(t)], late = DepositReg.restoreLate(t);
    let status;
    if (short > 0) status = Callout(late ? 'danger' : 'warn',
      `<strong>The deposit is ${peso(short)} short.</strong> EPI took part of it for an unpaid bill. Restore it${t.deposit && t.deposit.restoreBy ? ' by ' + esc(fmtDate(t.deposit.restoreBy)) : ' within ' + DepositReg.RESTORE_DAYS + ' days'}.
       Your account keeps issuing in the meantime.`, {cls:'mb-3'});
    else if (nxt && nxt.due > 0) status = Callout('info',
      `<strong>${esc(PLANS[nxt.plan].label)} starts ${esc(fmtDate(nxt.from))}.</strong> The deposit for it is ${peso0(nxt.amount)}. Add ${peso(nxt.due)} before then.`, {cls:'mb-3'});
    else status = '';
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <div class="d-flex flex-wrap align-items-start gap-3 mb-2">
          <div class="flex-grow-1">
            <strong class="fs_13 text-secondary fw-bold d-block mb-1">SAFETY DEPOSIT</strong>
            <div class="fs_12 text-muted">Refundable and held without interest. It is not a fee, a prepayment or a minimum charge, and it does not replace paying a bill. EPI may take an unpaid bill from it after a written notice. You then restore it within ${DepositReg.RESTORE_DAYS} days.</div>
          </div>
          ${DepositReg.due(t) > 0 && can('billing') ? `<button class="lbtn lbtn-sm lbtn-primary button_deposit_pay" data-due="${DepositReg.due(t)}">Pay into the deposit</button>` : ''}
        </div>
        <div class="row g-2 mb-3">
          <div class="col-6 col-md-4"><span class="stat-label">Held by EPI</span><div class="stat-value mono">${peso(held)}</div></div>
          <div class="col-6 col-md-4"><span class="stat-label">For ${esc(f.short)}</span><div class="stat-value mono">${peso0(req)}</div></div>
          <div class="col-12 col-md-4"><span class="stat-label">Status</span><div class="stat-value fs_15">${short > 0 ? '<span class="text-danger">Short</span>' : 'In full'}</div></div>
        </div>
        ${status}
        ${this.ledger(t, 6)}
      </div></div>`;
  },

  /** Operator: every client's deposit. */
  opsPanel(){
    const rows = OpsReg.tenants().map(t => {
      const held = DepositReg.held(t), req = DepositReg.required(t), short = DepositReg.shortfall(t), od = DepositReg.overdue(t);
      const odAmt = round2(od.reduce((s, i) => s + i.totals.totalDue, 0));
      return `<tr>
        <td>${esc(t.name)}</td><td>${esc(PLANS[planOf(t)].short)}</td>
        <td class="text-end mono">${num(req)}</td><td class="text-end mono">${num(held)}</td>
        <td class="text-end mono ${short ? 'text-danger' : ''}">${short ? num(short) : '—'}${t.deposit && t.deposit.restoreBy && short ? `<div class="fs_11 text-muted">restore by ${esc(fmtDate(t.deposit.restoreBy))}${DepositReg.restoreLate(t) ? ', late' : ''}</div>` : ''}</td>
        <td class="text-end mono">${od.length ? `${num(odAmt)}<div class="fs_11 text-muted">${od.length} overdue</div>` : '—'}</td>
        <td class="text-end text-nowrap">
          <button class="lbtn lbtn-sm lbtn-ghost button_dep_ledger" data-id="${esc(t.id)}">Ledger</button>
          ${od.length ? `<button class="lbtn lbtn-sm lbtn-ghost button_dep_deduct" data-id="${esc(t.id)}">Deduct</button>` : ''}
          <button class="lbtn lbtn-sm lbtn-ghost button_dep_receive" data-id="${esc(t.id)}">Record payment</button>
          <button class="lbtn lbtn-sm lbtn-ghost button_dep_refund" data-id="${esc(t.id)}">Refund</button>
        </td></tr>`;
    }).join('');
    return `
      <div class="lcard"><div class="lcard-body">
        <div class="fs_12 text-muted mb-2">Each client's refundable safety deposit (CSA 4.8). EPI deducts an unpaid bill only after it is past its due date and a written notice has been sent. The client then has ${DepositReg.RESTORE_DAYS} days to restore the deposit. Issuing is never stopped over it.</div>
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>CLIENT</th><th>TIER</th><th class="text-end">FOR TIER</th><th class="text-end">HELD</th><th class="text-end">SHORT</th><th class="text-end">OVERDUE BILLS</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>
      </div></div>`;
  }
};

/* ============================================================
   Modals and bindings
   ============================================================ */

const DepositUI = {

  bindClient(){
    $(".button_deposit_pay").off("click").on("click", function () {
      const due = Number($(this).data("due")) || 0;
      UI.openModal('Pay into the safety deposit', `
        <div class="fs_12 text-muted mb-2">Demo only: nothing is charged. The payment is recorded straight into your deposit.</div>
        <span class="d-block fs_12 fw-semibold mb-1">Amount</span>
        <input type="number" min="1" step="0.01" class="form-control form-control-sm mb-2 input_deposit_amount" value="${due.toFixed(2)}">
        <span class="d-block fs_12 fw-semibold mb-1">How you are paying</span>
        <select class="form-select form-select-sm select_deposit_method">
          ${Object.keys(PAY_METHODS).filter(k => PAY_METHODS[k].mode === 'INSTANT').map(k => `<option value="${k}">${esc(PAY_METHODS[k].label)}</option>`).join('')}
        </select>`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_deposit_go">Pay</button>`, 'sm');
      $(".button_deposit_go").on("click", () =>
        PayUI.act('DepositPay', { amount:$(".input_deposit_amount").val(), method:$(".select_deposit_method").val() }, 'billing'));
    });
  },

  bindOps(){
    const tenant = id => Store.db.tenants.find(x => x.id === id);
    $(".button_dep_ledger").off("click").on("click", function () {
      const t = tenant($(this).data("id"));
      UI.openModal(`Safety deposit: ${t.name}`, `
        <div class="fs_13 mb-2">Held ${peso(DepositReg.held(t))} · for ${esc(PLANS[planOf(t)].label)} ${peso0(DepositReg.required(t))}</div>
        ${DepositViews.ledger(t)}`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>`);
    });
    $(".button_dep_deduct").off("click").on("click", function () {
      const t = tenant($(this).data("id")), od = DepositReg.overdue(t);
      UI.openModal(`Deduct from ${t.name}'s deposit`, `
        <div class="fs_13 mb-2">The deposit holds <strong class="mono">${peso(DepositReg.held(t))}</strong>. Choose the unpaid bill to take from it.</div>
        <select class="form-select form-select-sm mb-2 select_dep_invoice">
          ${od.map(i => { const l = DepositReg.late(i); return `<option value="${esc(i.id)}">${esc(i.number)} · ${esc(BillingReg.label(i.period))} · ${peso(i.totals.totalDue)}${l.amount ? ' + ' + peso(l.amount) + ' interest and penalty' : ''}</option>`; }).join('')}
        </select>
        <label class="d-flex gap-2 fs_12"><input type="checkbox" class="check_dep_notice"> A written notice of the unpaid bill was sent to the client.</label>
        <div class="fs_11 text-muted mt-2">The invoice is marked paid from the deposit. The client has ${DepositReg.RESTORE_DAYS} days to restore it.</div>`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_dep_deduct_go">Deduct</button>`, 'sm');
      $(".button_dep_deduct_go").on("click", () =>
        OpsUI.call('OpsDepositDeduct', { tenant:t.id, invoice:$(".select_dep_invoice").val(), notice:$(".check_dep_notice").is(":checked") }, 'opsBilling'));
    });
    $(".button_dep_receive").off("click").on("click", function () {
      const t = tenant($(this).data("id")), due = DepositReg.due(t);
      UI.openModal(`Record a deposit payment: ${t.name}`, `
        <span class="d-block fs_12 fw-semibold mb-1">Amount received</span>
        <input type="number" min="1" step="0.01" class="form-control form-control-sm mb-2 input_dep_amount" value="${due ? due.toFixed(2) : ''}">
        <span class="d-block fs_12 fw-semibold mb-1">How it was paid</span>
        <select class="form-select form-select-sm mb-2 select_dep_method">${Object.keys(PAY_METHODS).map(k => `<option>${esc(PAY_METHODS[k].label)}</option>`).join('')}</select>
        <span class="d-block fs_12 fw-semibold mb-1">Reference</span>
        <input type="text" class="form-control form-control-sm input_dep_ref" maxlength="60" placeholder="Transfer or check number">`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_dep_receive_go">Record</button>`, 'sm');
      $(".button_dep_receive_go").on("click", () =>
        OpsUI.call('OpsDepositReceive', { tenant:t.id, amount:$(".input_dep_amount").val(), method:$(".select_dep_method").val(), reference:$(".input_dep_ref").val() }, 'opsBilling'));
    });
    $(".button_dep_refund").off("click").on("click", function () {
      const t = tenant($(this).data("id")), held = DepositReg.held(t);
      UI.openModal(`Refund from ${t.name}'s deposit`, `
        <div class="fs_13 mb-2">The deposit holds <strong class="mono">${peso(held)}</strong>.</div>
        <span class="d-block fs_12 fw-semibold mb-1">Amount to refund</span>
        <input type="number" min="1" step="0.01" class="form-control form-control-sm mb-2 input_dep_ref_amount" value="${held ? held.toFixed(2) : ''}">
        <span class="d-block fs_12 fw-semibold mb-1">Reason</span>
        <select class="form-select form-select-sm select_dep_reason"><option>Agreement ended</option><option>Move to a smaller tier</option><option>Paid in excess</option></select>
        <div class="fs_11 text-muted mt-2">When the agreement ends, EPI refunds the deposit after setting off anything the client still owes.</div>`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_dep_refund_go">Refund</button>`, 'sm');
      $(".button_dep_refund_go").on("click", () =>
        OpsUI.call('OpsDepositRefund', { tenant:t.id, amount:$(".input_dep_ref_amount").val(), reason:$(".select_dep_reason").val() }, 'opsBilling'));
    });
  }
};
