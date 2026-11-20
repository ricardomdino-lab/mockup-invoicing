/* ============================================================
   payments.js — how a client pays EPI, and how a client changes plan

   Payment. EPI's monthly invoices (billing.js) can be paid by several methods.
   Gateway methods (card, GCash, Maya, online banking) post at once; here the
   gateway is simulated and nothing is charged. Bank transfer, over-the-counter
   deposit and check are paid outside the system: the client sends the
   reference and EPI confirms it in the operator console. A client can also set
   up auto-debit, so each invoice is paid when it is issued.

   Plan change (CSA 4.5). A move to a tier with a larger allowance is the client's own
   choice: it starts on the first day of the next month, with no charge and no review. A move
   to a smaller tier is made only at renewal, after EPI and the client reassess the plan, so
   it goes to EPI as a request that takes effect on the renewal date. The history of tiers
   lives on the tenant (planHistory), so every month is billed at the tier that applied.
   ============================================================ */

const PayReg = {

  pendingRequest(t){
    return (Store.db.planChanges || []).find(r => r.tenantId === t.id && r.status === 'PENDING') || null;
  },
  scheduled(t){
    return (t.planHistory || []).find(e => new Date(e.from) > new Date()) || null;
  },

  /** The next renewal: the next anniversary of the day the agreement started. */
  renewalDate(t){
    const d = new Date(t.goLiveAt || Date.now()), now = new Date();
    while (d <= now) d.setFullYear(d.getFullYear() + 1);
    return d.toISOString();
  }
};

/* ============================================================
   Handlers: paying
   ============================================================ */

LocalAPI.on("Dashboard/BillingPay", function (p) {
  if (!can('billing')) return { success:false, message:'Your role cannot pay EPI invoices.' };
  const db = Store.db;
  const inv = BillingReg.all(db).find(i => i.id === p.id && i.clientId === CU.tenantId);
  if (!inv) return { success:false, message:'That invoice is not on this account.' };
  if (inv.paymentStatus === 'PAID') return { success:false, message:'That invoice is already paid.' };
  const m = PAY_METHODS[p.method];
  if (!m) return { success:false, message:'Select a payment method.' };

  if (m.mode === 'INSTANT'){
    const ref = 'GW-' + Math.floor(100000 + Math.random() * 899999);
    Object.assign(inv, { paymentStatus:'PAID', paymentMethod:m.label, paymentRef:ref,
                         paidAt:new Date().toISOString(), paidRecordedBy:'Payment gateway (demo)' });
    delete inv.paymentSubmitted;
    logActivity(db, { action:`Paid EPI invoice ${inv.number}, ${peso(inv.totals.totalDue)}, by ${m.label} (${ref})` });
    Store.save(db);
    return { success:true, message:`Payment received. ${inv.number} is paid. Reference ${ref}.` };
  }

  const ref = String(p.reference || '').trim();
  if (!ref) return { success:false, message:'Enter the reference: the transfer number, deposit slip number or check number.' };
  inv.paymentSubmitted = { method:p.method, label:m.label, reference:ref.slice(0, 60),
    proof:String(p.proof || '').slice(0, 120), submittedAt:new Date().toISOString(), by:CU.name };
  logActivity(db, { action:`Sent payment details for EPI invoice ${inv.number}: ${m.label}, ${ref}` });
  Store.save(db);
  return { success:true, message:'Payment details sent to EPI. The invoice shows as paid once EPI confirms it.' };
});

LocalAPI.on("Dashboard/BillingPayDecline", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations reviews payments.' };
  const db = Store.db;
  const inv = BillingReg.all(db).find(i => i.id === p.id);
  if (!inv || !inv.paymentSubmitted) return { success:false, message:'No payment is waiting on that invoice.' };
  const why = String(p.reason || '').trim();
  if (!why) return { success:false, message:'Enter the reason the payment was not accepted.' };
  const s = inv.paymentSubmitted;
  delete inv.paymentSubmitted;
  inv.paymentDeclined = { reason:why.slice(0, 200), at:new Date().toISOString(), by:CU.name };
  logActivity(db, { tenantId:inv.clientId, actorType:'EPI', action:`EPI could not confirm the payment of ${inv.number} (${s.label}, ${s.reference}): ${why}` });
  Store.save(db);
  return { success:true, message:`Payment on ${inv.number} declined. The client is asked to pay again.` };
});

LocalAPI.on("Dashboard/AutoPaySave", function (p) {
  if (!can('billing')) return { success:false, message:'Your role cannot change auto-debit.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId);
  if (!t) return { success:false, message:'Account not found.' };
  if (p.off){
    delete t.autoPay;
    logActivity(db, { action:'Turned off auto-debit for EPI invoices' });
    Store.save(db);
    return { success:true, message:'Auto-debit is off. You pay each invoice yourself.' };
  }
  const kinds = { CARD:'Card', BANK_DEBIT:'Bank account', GCASH:'GCash', MAYA:'Maya' };
  if (!kinds[p.kind]) return { success:false, message:'Select how EPI should collect payment.' };
  const last = String(p.last || '').replace(/\D/g, '').slice(-4);
  if (p.kind === 'CARD' || p.kind === 'BANK_DEBIT'){
    if (last.length < 4) return { success:false, message:'Enter the last 4 digits.' };
  } else if (!String(p.last || '').trim()) return { success:false, message:'Enter the mobile number linked to the wallet.' };
  const label = p.kind === 'CARD' ? `card ending ${last}` : p.kind === 'BANK_DEBIT' ? `account ending ${last}`
              : `${kinds[p.kind]} ${String(p.last).trim().slice(-4).padStart(4, '*')}`;
  t.autoPay = { kind:p.kind, label, enrolledAt:new Date().toISOString(), by:CU.name };
  logActivity(db, { action:`Set up auto-debit for EPI invoices: ${label}` });
  Store.save(db);
  return { success:true, message:`Auto-debit is on (${label}). Each invoice is paid when EPI issues it.` };
});

/* ============================================================
   Handlers: changing plan
   ============================================================ */

LocalAPI.on("Dashboard/PlanChangeRequest", function (p) {
  if (!can('taxProfile')) return { success:false, message:'Only an owner can change the tier.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId);
  if (!t) return { success:false, message:'Account not found.' };
  const to = p.to, cur = planOf(t);
  if (!PLANS[to]) return { success:false, message:'Select a tier.' };
  if (to === cur) return { success:false, message:'That is the current tier.' };
  if (PayReg.pendingRequest(t) || PayReg.scheduled(t))
    return { success:false, message:'A tier change is already waiting. Cancel it before requesting another.' };
  const history = () => (t.planHistory && t.planHistory.length ? t.planHistory : [{ plan:cur, from:t.goLiveAt || '2000-01-01T00:00:00+08:00' }]);

  if (PLANS[to].rank > PLANS[cur].rank){
    const from = nextMonthStart(), more = PLANS[to].deposit - PLANS[cur].deposit;
    t.planHistory = history().concat([{ plan:to, from, by:CU.name, depositDiff:more }]);
    if (t.lane === 'EXPRESS' && PLANS[to].lane === 'ENTERPRISE') t.lane = 'ENTERPRISE';
    logActivity(db, { action:`Chose to move from ${PLANS[cur].label} to ${PLANS[to].label} on ${fmtDate(from)}` });
    Store.save(db);
    return { success:true, message:`${PLANS[to].label} starts on ${fmtDate(from)}. Until then ${PLANS[cur].label} stays in force. The safety deposit rises by ${peso0(more)}, due before then.` };
  }

  const effectiveAt = PayReg.renewalDate(t);
  db.planChanges = db.planChanges || [];
  db.planChanges.push({ id:uid('plc'), tenantId:t.id, from:cur, to, effectiveAt, requestedBy:CU.name, requestedAt:new Date().toISOString(), status:'PENDING' });
  logActivity(db, { action:`Asked to reassess the plan at renewal: ${PLANS[cur].label} to ${PLANS[to].label}` });
  Store.save(db);
  return { success:true, message:`Sent to EPI. A smaller tier is agreed at renewal, on ${fmtDate(effectiveAt)}. If you and EPI agree, ${PLANS[to].label} starts that day. Until then ${PLANS[cur].label} stays in force.` };
});

LocalAPI.on("Dashboard/PlanChangeCancel", function () {
  if (!can('taxProfile')) return { success:false, message:'Only an owner can change the plan.' };
  const db = Store.db, t = db.tenants.find(x => x.id === CU.tenantId);
  const req = PayReg.pendingRequest(t);
  if (req){
    req.status = 'CANCELLED';
    logActivity(db, { action:`Cancelled the request to move to ${PLANS[req.to].label}` });
    Store.save(db);
    return { success:true, message:'Request cancelled.' };
  }
  const sch = PayReg.scheduled(t);
  if (sch){
    t.planHistory = t.planHistory.filter(e => e !== sch);
    logActivity(db, { action:`Cancelled the scheduled move to ${PLANS[sch.plan].label}` });
    Store.save(db);
    return { success:true, message:'Scheduled change cancelled.' };
  }
  return { success:false, message:'No plan change is waiting.' };
});

LocalAPI.on("Dashboard/OpsPlanDecide", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations reviews plan changes.' };
  const db = Store.db;
  const req = (db.planChanges || []).find(r => r.id === p.id);
  if (!req || req.status !== 'PENDING') return { success:false, message:'That request has already been decided.' };
  const t = db.tenants.find(x => x.id === req.tenantId);
  if (!t) return { success:false, message:'Account not found.' };
  const note = String(p.note || '').trim();

  if (p.decision === 'DECLINE'){
    if (!note) return { success:false, message:'Enter the reason for declining.' };
    req.status = 'DECLINED'; req.note = note; req.decidedBy = CU.name; req.decidedAt = new Date().toISOString();
    logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI declined the move to ${PLANS[req.to].label}: ${note}` });
    Store.save(db);
    return { success:true, message:`Request from ${t.name} declined.` };
  }

  const now = new Date().toISOString(), cur = planOf(t);
  const from = req.effectiveAt || PayReg.renewalDate(t);
  t.planHistory = (t.planHistory && t.planHistory.length ? t.planHistory : [{ plan:cur, from:t.goLiveAt || '2000-01-01T00:00:00+08:00' }])
    .concat([{ plan:req.to, from, by:CU.name, depositDiff:PLANS[req.to].deposit - PLANS[cur].deposit }]);
  req.status = 'APPROVED'; req.note = note; req.decidedBy = CU.name; req.decidedAt = now;
  logActivity(db, { tenantId:t.id, actorType:'EPI', action:`EPI agreed to the move from ${PLANS[req.from].label} to ${PLANS[req.to].label}. It starts at renewal, on ${fmtDate(from)}` });
  Store.save(db);
  return { success:true, message:`${t.name} moves to ${PLANS[req.to].label} on ${fmtDate(from)}.` };
});

/* ============================================================
   Markup shared by the screens
   ============================================================ */

const PayViews = {

  /** The account details a client pays to. */
  howToPay(){
    const b = EPI_PAYMENT.bank;
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">HOW TO PAY EPI</strong>
        <div class="row g-3 fs_13">
          <div class="col-12 col-md-4"><div class="fw-semibold mb-1">Bank transfer</div>
            <div class="text-muted">${esc(b.bank)}<br>${esc(b.name)}<br><span class="mono">${esc(b.number)}</span><br>Use the invoice number as the reference.</div></div>
          <div class="col-12 col-md-4"><div class="fw-semibold mb-1">GCash or Maya</div>
            <div class="text-muted">GCash <span class="mono">${esc(EPI_PAYMENT.GCASH.number)}</span><br>Maya <span class="mono">${esc(EPI_PAYMENT.MAYA.number)}</span><br>${esc(EPI_PAYMENT.GCASH.name)}</div></div>
          <div class="col-12 col-md-4"><div class="fw-semibold mb-1">Check or card</div>
            <div class="text-muted">Checks payable to ${esc(EPI_PAYMENT.checkTo)}.<br>Cards, GCash, Maya and online banking can be paid on the invoice with Pay now.</div></div>
        </div>
        <div class="fs_11 text-muted mt-2">Invoices are due in ${BillingReg.PAYMENT_DAYS} days. A late payment carries 2% a month on the unpaid amount (1% interest and a 1% penalty). EPI never limits your access or records over unpaid fees. Account details are illustrative.</div>
      </div></div>`;
  },

  autoPayCard(){
    const a = CT.autoPay, can_ = can('billing');
    return `
      <div class="lcard mb-3"><div class="lcard-body d-flex flex-wrap align-items-center gap-3">
        <div class="flex-grow-1">
          <strong class="fs_13 text-secondary fw-bold d-block mb-1">AUTO-DEBIT</strong>
          <div class="fs_13">${a ? `On. Each invoice is paid when EPI issues it, from ${esc(a.label)}.`
                                 : 'Off. Set it up and each monthly invoice is paid when it is issued.'}</div>
        </div>
        ${can_ ? `<button class="lbtn lbtn-sm lbtn-ghost button_autopay_setup">${a ? 'Change' : 'Set up auto-debit'}</button>
                  ${a ? '<button class="lbtn lbtn-sm lbtn-ghost button_autopay_off">Turn off</button>' : ''}` : ''}
      </div></div>`;
  },

  /** What the owner sees about the plan, and the five tiers to move between. */
  planCard(){
    const t = CT, cur = planOf(t), canEdit = can('taxProfile');
    const req = PayReg.pendingRequest(t), sch = PayReg.scheduled(t);
    const notice = req
      ? `<div class="callout callout-info mb-3"><div>Your request to move to <strong>${esc(PLANS[req.to].label)}</strong> is waiting for EPI. Sent ${esc(fmtDate(req.requestedAt))}.
          ${canEdit ? '<span class="hyperlink ms-2 button_plan_cancel">Cancel request</span>' : ''}</div></div>`
      : sch ? `<div class="callout callout-info mb-3"><div>The plan moves to <strong>${esc(PLANS[sch.plan].label)}</strong> on ${esc(fmtDate(sch.from))}.
          ${canEdit ? '<span class="hyperlink ms-2 button_plan_cancel">Cancel change</span>' : ''}</div></div>` : '';
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">YOUR TIER</strong>
        ${notice}
        <div class="row g-2">
          ${PLAN_ORDER.map(k => { const f = PLANS[k], isCur = k === cur, up = f.rank > PLANS[cur].rank;
            return `<div class="col-12 col-md-6 col-xl"><div class="lcard h-100" style="${isCur ? 'border-color:var(--blue-500);' : ''}"><div class="lcard-body">
              <div class="fw-semibold">${esc(f.label)} ${isCur ? '<span class="lbadge lbadge-blue ms-1">Current</span>' : ''}</div>
              <div class="mono fs_15 my-1">${peso(f.fee)} <span class="fs_11 text-muted">per invoice</span></div>
              <div class="fs_11 text-muted mb-2">${f.limit ? `${f.allowance.toLocaleString('en-PH')} a month included.` : 'No monthly limit.'}</div>
              ${isCur ? '' : canEdit && !req && !sch
                ? `<button class="lbtn lbtn-sm ${up ? 'lbtn-primary' : 'lbtn-ghost'} button_plan_pick" data-plan="${k}">${up ? 'Move up' : 'Ask at renewal'}</button>` : ''}
            </div></div></div>`; }).join('')}
        </div>
        ${canEdit ? '' : '<div class="fs_11 text-muted mt-2">Only an owner can change the tier.</div>'}
        <div class="fs_11 text-muted mt-2">A move up starts next month. A move down is agreed with EPI at renewal, on ${esc(fmtDate(PayReg.renewalDate(t)))}. Fee terms are in your agreement.</div>
      </div></div>`;
  },

  /** Operator: plan changes waiting for review. */
  opsPlanQueue(){
    const rows = (Store.db.planChanges || []).filter(r => r.status === 'PENDING');
    return `
      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">TIER CHANGES AT RENEWAL</strong>
        <div class="fs_12 text-muted mb-2">Moves to a larger tier need no review. These are requests to move to a smaller tier at renewal. EPI and the client reassess the plan, and an agreed move starts on the renewal date.</div>
        ${rows.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>ACCOUNT</th><th>FROM</th><th>TO</th><th>AT RENEWAL</th><th>REQUESTED</th><th></th></tr></thead>
          <tbody>${rows.map(r => `<tr><td>${esc(OpsReg.tenantName(r.tenantId))}</td><td>${esc(PLANS[r.from].label)}</td><td>${esc(PLANS[r.to].label)}</td>
            <td>${esc(fmtDate(r.effectiveAt || r.requestedAt))}</td><td>${esc(fmtDate(r.requestedAt))} by ${esc(r.requestedBy)}</td>
            <td class="text-end"><button class="lbtn lbtn-sm lbtn-ghost button_ops_plan_review" data-id="${esc(r.id)}">Review</button></td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="fs_13 text-muted">No requests waiting.</div>'}
      </div></div>`;
  }
};

/* ============================================================
   Modals and bindings
   ============================================================ */

const PayUI = {

  post(name, body, done){
    $.ajax({ url:"/Portal/SPIStradcom/Dashboard/" + name, type:"POST", dataType:"json",
             contentType:"application/json; charset=utf-8", data:JSON.stringify(body) })
      .done(function (r) { done(r); })
      .fail(function () { DisplaySwal("error", "", "The request could not be completed. Try again."); });
  },

  /** Run an action, then refresh the screen. A refusal keeps the dialog open. */
  act(name, body, screen, opts){
    PayUI.post(name, body, function (r) {
      if (r.success){ UI.closeModal(); DisplayDelaySwal("success", "", r.message, function () { Nav.go(screen, opts); }); }
      else DisplaySwal("info", "", r.message);
    });
  },

  payModal(id){
    const inv = BillingReg.all(Store.db).find(i => i.id === id && i.clientId === CT.id);
    if (!inv) return;
    const keys = Object.keys(PAY_METHODS);
    const b = EPI_PAYMENT.bank;
    const detail = k => {
      const m = PAY_METHODS[k];
      if (k === 'CARD') return `<div class="row g-2">
          <div class="col-12"><input class="form-control form-control-sm" placeholder="Card number (demo: any number)" maxlength="19"></div>
          <div class="col-6"><input class="form-control form-control-sm" placeholder="MM/YY" maxlength="5"></div>
          <div class="col-6"><input class="form-control form-control-sm" placeholder="Name on card"></div></div>
          <div class="fs_11 text-muted mt-1">Demo only. Nothing is charged.</div>`;
      if (k === 'GCASH' || k === 'MAYA') return `<div class="fs_12 text-muted">You are sent to ${esc(m.label)} to approve ${peso(inv.totals.totalDue)}. Simulated here.</div>`;
      if (k === 'ONLINE_BANKING') return `<select class="form-select form-select-sm"><option>Select your bank</option><option>BDO Online</option><option>BPI Online</option><option>Metrobank Online</option><option>UnionBank Online</option><option>Landbank iAccess</option></select>
          <div class="fs_11 text-muted mt-1">Simulated. Nothing is charged.</div>`;
      const slip = k === 'BANK_TRANSFER' ? 'Transfer reference number' : k === 'OVER_THE_COUNTER' ? 'Deposit slip number' : 'Check number';
      const where = k === 'CHECK'
        ? `Payable to <strong>${esc(EPI_PAYMENT.checkTo)}</strong>. Deliver to ${esc(SYSTEM.taxpayer.address)} or deposit it to the account below.`
        : `${esc(b.bank)}, ${esc(b.name)}, <span class="mono">${esc(b.number)}</span>. Reference: <span class="mono">${esc(inv.number)}</span>.`;
      return `<div class="fs_12 mb-2">${where}</div>
        <input class="form-control form-control-sm mb-2 input_pay_ref" maxlength="60" placeholder="${slip}">
        <input class="form-control form-control-sm input_pay_proof" maxlength="120" placeholder="Proof of payment, file name (optional)">`;
    };
    UI.openModal(`Pay ${inv.number}`, `
      <div class="fs_13 mb-3">${esc(BillingReg.label(inv.period))}: <strong class="mono">${peso(inv.totals.totalDue)}</strong> (VAT inclusive)</div>
      ${inv.paymentDeclined ? Callout('warn', `EPI could not confirm the last payment: ${esc(inv.paymentDeclined.reason)}`, {cls:'mb-3'}) : ''}
      <div class="d-flex flex-column gap-2 mb-3">
        ${keys.map(k => `<label class="pick_card" data-k="${k}"><input type="radio" name="paym" value="${k}">
          <div><div class="fs_13 fw-semibold"><i class="bi ${PAY_METHODS[k].ico} me-1"></i>${esc(PAY_METHODS[k].label)}</div>
          <div class="fs_11 text-secondary">${esc(PAY_METHODS[k].note)}</div></div></label>`).join('')}
      </div>
      <div class="div_pay_detail"></div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_pay_go" disabled>Choose a method</button>`);
    $("input[name=paym]").on("change", function () {
      const k = this.value, m = PAY_METHODS[k];
      $(".pick_card").removeClass("selected"); $(this).closest(".pick_card").addClass("selected");
      $(".div_pay_detail").html(detail(k));
      $(".button_pay_go").prop("disabled", false).text(m.mode === 'INSTANT' ? `Pay ${peso(inv.totals.totalDue)}` : 'Send payment details');
    });
    $(".button_pay_go").on("click", function () {
      const k = $("input[name=paym]:checked").val();
      PayUI.act('BillingPay', { id:inv.id, method:k, reference:$(".input_pay_ref").val(), proof:$(".input_pay_proof").val() }, 'billing', { docId:inv.id });
    });
  },

  autoPayModal(){
    const kinds = [['CARD', 'Credit or debit card', 'Last 4 digits of the card'], ['BANK_DEBIT', 'Bank account debit', 'Last 4 digits of the account'],
                   ['GCASH', 'GCash', 'Linked mobile number'], ['MAYA', 'Maya', 'Linked mobile number']];
    UI.openModal('Set up auto-debit', `
      <div class="fs_12 text-muted mb-2">Each monthly invoice is paid from this source when EPI issues it. You can turn it off at any time. Demo only: nothing is charged.</div>
      <div class="d-flex flex-column gap-2 mb-2">
        ${kinds.map(([k, l]) => `<label class="pick_card"><input type="radio" name="apk" value="${k}"><div class="fs_13 fw-semibold">${l}</div></label>`).join('')}
      </div>
      <input class="form-control form-control-sm input_autopay_last" maxlength="20" placeholder="Select a source first">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_autopay_save">Turn on auto-debit</button>`, 'sm');
    $("input[name=apk]").on("change", function () {
      $(".pick_card").removeClass("selected"); $(this).closest(".pick_card").addClass("selected");
      $(".input_autopay_last").attr("placeholder", kinds.find(x => x[0] === this.value)[2]);
    });
    $(".button_autopay_save").on("click", () =>
      PayUI.act('AutoPaySave', { kind:$("input[name=apk]:checked").val(), last:$(".input_autopay_last").val() }, 'billing'));
  },

  planModal(to){
    const t = CT, cur = planOf(t), up = PLANS[to].rank > PLANS[cur].rank, f = PLANS[to];
    let body, go;
    if (up){
      const from = nextMonthStart(), more = f.deposit - PLANS[cur].deposit;
      body = `<div class="fs_13 mb-2">Move from <strong>${esc(PLANS[cur].label)}</strong> to <strong>${esc(f.label)}</strong> on <strong>${esc(fmtDate(from))}</strong>.</div>
        <ul class="fs_13 ps-3">
          <li>${peso(f.fee)} per invoice${f.limit ? `, up to ${f.limit.toLocaleString('en-PH')} a month. Above that, ${peso(f.excessFee)} each` : ', with no allowance and no excess fee'}.</li>
          <li>No charge for the move. ${esc(PLANS[cur].label)} stays in force until then.</li>
          <li>The safety deposit rises by ${peso0(more)}, due before ${esc(fmtDate(from))}.</li>
        </ul>
        <div class="fs_12 text-muted">This is your choice. EPI does not need to approve it.</div>`;
      go = 'Move up';
    } else {
      const at = PayReg.renewalDate(t);
      body = `<div class="fs_13 mb-2">Ask to move from <strong>${esc(PLANS[cur].label)}</strong> to <strong>${esc(f.label)}</strong> at renewal, on <strong>${esc(fmtDate(at))}</strong>.</div>
        <ul class="fs_13 ps-3">
          <li>EPI and you reassess the plan together at renewal. ${esc(PLANS[cur].label)} stays in force until then.</li>
          <li>${peso(f.fee)} per invoice. A smaller tier has a higher fee per invoice and a lower allowance.</li>
          <li>Whatever your tier, EPI bills your actual use every month.</li>
        </ul>`;
      go = 'Send to EPI';
    }
    UI.openModal(`${up ? 'Move to' : 'Ask for'} ${f.label}`, body,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_plan_go">${go}</button>`, 'sm');
    $(".button_plan_go").on("click", () => PayUI.act('PlanChangeRequest', { to }, 'settings'));
  },

  bindBilling(){
    $(".button_pay_open").off("click").on("click", function () { PayUI.payModal($(this).data("id")); });
    $(".button_autopay_setup").off("click").on("click", () => PayUI.autoPayModal());
    $(".button_autopay_off").off("click").on("click", () => PayUI.act('AutoPaySave', { off:true }, 'billing'));
  },

  bindSettings(){
    $(".button_plan_pick").off("click").on("click", function () { PayUI.planModal($(this).data("plan")); });
    $(".button_plan_cancel").off("click").on("click", () => PayUI.act('PlanChangeCancel', {}, 'settings'));
  },

  bindOps(){
    $(".button_ops_plan_review").off("click").on("click", function () {
      const r = (Store.db.planChanges || []).find(x => x.id === $(this).data("id"));
      const t = Store.db.tenants.find(x => x.id === r.tenantId);
      UI.openModal('Review a move at renewal', `
        <div class="fs_13 mb-2"><strong>${esc(t.name)}</strong>: ${esc(PLANS[r.from].label)} to ${esc(PLANS[r.to].label)}, asked ${esc(fmtDate(r.requestedAt))} by ${esc(r.requestedBy)}.</div>
        <ul class="fs_13 ps-3"><li>If agreed, it starts at renewal, on ${esc(fmtDate(r.effectiveAt || r.requestedAt))}.</li>
          <li>Check the client's monthly audit results for the term. The client is responsible for the tier it chooses, and EPI bills actual use in any case.</li></ul>
        <span class="d-block fs_12 fw-semibold mb-1">Note (required to decline)</span>
        <input class="form-control form-control-sm input_ops_plan_note" maxlength="200">`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-ghost button_ops_plan_decline">Decline</button>
         <button class="lbtn lbtn-primary button_ops_plan_approve">Approve</button>`, 'sm');
      $(".button_ops_plan_approve").on("click", () => OpsUI.call('OpsPlanDecide', { id:r.id, decision:'APPROVE', note:$(".input_ops_plan_note").val() }, 'opsOnboarding'));
      $(".button_ops_plan_decline").on("click", () => OpsUI.call('OpsPlanDecide', { id:r.id, decision:'DECLINE', note:$(".input_ops_plan_note").val() }, 'opsOnboarding'));
    });
  }
};
