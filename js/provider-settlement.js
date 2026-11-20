/* ============================================================
   provider-settlement.js — settlement and reconciliation with the payment service providers

   When a buyer pays through the System, the provider deducts EPI's fee and VAT, pays that to EPI and
   settles the rest to the client (CSA 4.6). EPI holds no client money, but it must be able to see that
   each provider paid over what it deducted. This is that check, kept on EPI's operator console.

   One batch is one provider and one payment day. Expected is the fee and VAT the provider deducted that
   day (the documents' systemPayment records). Received is what EPI recorded against the provider's
   remittance (db.remittances). The difference decides the status:
     MATCHED   received equals expected
     AWAITING  nothing yet, and the remittance is not due (real time: the same day; T+1: the next banking day)
     MISSING   nothing, and it is past due
     SHORT     less than expected
     OVER      more than expected
   A short or missing batch can be followed up with the provider, or billed to the clients in their next
   monthly statement, which is the CSA 4.6 fallback. Only the part of the fee that was never received is
   billed, so nobody pays twice.
   ============================================================ */

const SettleReg = {

  WINDOW_DAYS: 60,

  day(iso){ return new Date(iso).toLocaleDateString('en-CA'); },

  /** Every provider-day with deductions in the window, newest first. */
  batches(db, sinceDays){
    const since = Date.now() - (sinceDays || this.WINDOW_DAYS) * 864e5, map = {};
    db.invoices.forEach(i => {
      const s = i.systemPayment;
      if (!s || !s.feeDeducted || new Date(s.at).getTime() < since) return;
      const day = this.day(s.at), key = s.provider + '|' + day;
      const b = map[key] = map[key] || { key, provider:s.provider, mode:s.mode, day, docs:[], clients:new Set(), expected:0, due:day };
      b.docs.push(i); b.clients.add(i.tenantId);
      b.expected = round2(b.expected + s.feeDeducted);
      const due = this.day(s.settleOn);
      if (due > b.due) b.due = due;
    });
    const now = Date.now();
    return Object.keys(map).map(k => {
      const b = map[k], rem = (db.remittances || []).find(r => r.provider === b.provider && r.day === b.day);
      b.entries = rem ? rem.entries : [];
      b.received = round2(b.entries.reduce((a, e) => a + e.amount, 0));
      b.diff = round2(b.received - b.expected);
      b.resolution = rem ? rem.resolution || null : null;
      const dueEnd = new Date(b.due + 'T23:59:59+08:00').getTime();
      b.status = !b.entries.length ? (now > dueEnd ? 'MISSING' : 'AWAITING')
               : b.diff === 0 ? 'MATCHED' : b.diff < 0 ? 'SHORT' : 'OVER';
      return b;
    }).sort((a, z) => z.day.localeCompare(a.day) || a.provider.localeCompare(z.provider));
  },

  /** What is still unexplained: short or missing and not yet billed to the clients or settled. */
  open(batches){ return batches.filter(b => (b.status === 'SHORT' || b.status === 'MISSING') && !b.resolution); },

  /** Providers and what they owe EPI as of now. */
  byProvider(batches){
    const m = {};
    batches.forEach(b => {
      const p = m[b.provider] = m[b.provider] || { provider:b.provider, expected:0, received:0, awaiting:0, open:0, batches:0 };
      p.batches++; p.expected = round2(p.expected + b.expected);
      p.received = round2(p.received + b.received);
      if (b.status === 'AWAITING') p.awaiting = round2(p.awaiting + b.expected);
      if ((b.status === 'SHORT' || b.status === 'MISSING') && !b.resolution) p.open = round2(p.open + (b.expected - b.received));
    });
    return Object.keys(m).map(k => m[k]);
  },

  /** Live clients that use a provider, and how many of them EPI confirmed at go-live. */
  clientsOf(db, name){
    const l = db.tenants.filter(t => !t.isProvider && t.provider && t.provider.name === name);
    return { n:l.length, confirmed:l.filter(t => t.provider.confirmed).length, names:l.map(t => t.name) };
  },

  STATUS: {
    MATCHED:{ label:'Matched', cls:'lbadge-green' }, AWAITING:{ label:'Awaiting', cls:'lbadge-blue' },
    MISSING:{ label:'Not received', cls:'lbadge-red' }, SHORT:{ label:'Short', cls:'lbadge-amber' }, OVER:{ label:'Over', cls:'lbadge-amber' }
  },

  /** Seed: the provider remits each day's fees by the due day. Two batches in the last weeks went wrong. */
  seed(db){
    db.remittances = [];
    const batches = this.batches(db, this.WINDOW_DAYS).reverse();
    const today = this.day(new Date().toISOString());
    const overdue = batches.filter(b => b.due < today);
    const partner = overdue.filter(b => b.mode === 'EPI_PARTNER').slice(-6), own = overdue.filter(b => b.mode !== 'EPI_PARTNER').slice(-6);
    const short = partner.length > 2 ? partner[partner.length - 3] : null;
    const missing = own.length > 1 ? own[own.length - 2] : null;
    overdue.forEach(b => {
      if (b === missing) return;
      const entries = [{ amount: b === short ? round2(b.expected - Math.min(round2(b.expected / 3), 25.2)) : b.expected,
        at:b.due + 'T15:00:00+08:00', ref:'REM-' + b.provider.replace(/[^A-Z]/g, '').slice(0, 3) + '-' + b.day.replace(/-/g, ''), by:'Provider remittance advice' }];
      db.remittances.push({ provider:b.provider, day:b.day, entries });
    });
  }
};

/* ============================================================
   Handlers
   ============================================================ */

LocalAPI.on("Dashboard/OpsRemitRecord", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations records remittances.' };
  const db = Store.db, amount = round2(parseFloat(p.amount));
  if (!(amount > 0)) return { success:false, message:'Enter the amount received.' };
  if (!String(p.ref || '').trim()) return { success:false, message:'Enter the bank reference.' };
  const b = SettleReg.batches(db, 400).find(x => x.key === p.key);
  if (!b) return { success:false, message:'Batch not found.' };
  const at = p.at ? new Date(p.at + 'T12:00:00+08:00').toISOString() : new Date().toISOString();
  let rem = (db.remittances = db.remittances || []).find(r => r.provider === b.provider && r.day === b.day);
  if (!rem){ rem = { provider:b.provider, day:b.day, entries:[] }; db.remittances.push(rem); }
  rem.entries.push({ amount, at, ref:String(p.ref).trim().slice(0, 60), by:CU.name });
  const after = SettleReg.batches(db, 400).find(x => x.key === p.key);
  logActivity(db, { actorType:'EPI', action:`Recorded ${peso(amount)} received from ${b.provider} for ${b.day} (expected ${peso(b.expected)}), ref ${String(p.ref).trim()}: ${SettleReg.STATUS[after.status].label}` });
  Store.save(db);
  return { success:true, message: after.status === 'MATCHED' ? 'Recorded. The batch matches.' : `Recorded. The batch is ${SettleReg.STATUS[after.status].label.toLowerCase()} by ${peso(Math.abs(after.diff))}.` };
});

/** Bill the clients for the part that was never received: their documents go back to the monthly statement. */
LocalAPI.on("Dashboard/OpsRemitBill", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations does this.' };
  const db = Store.db, b = SettleReg.batches(db, 400).find(x => x.key === p.key);
  if (!b || (b.status !== 'SHORT' && b.status !== 'MISSING')) return { success:false, message:'Only a short or missing batch can be billed to the clients.' };
  let gap = round2(b.expected - b.received);
  const docs = b.docs.slice().sort((a, z) => new Date(z.issuedAt) - new Date(a.issuedAt));
  const billed = docs.filter(i => BillingReg.billed(db, i.tenantId).indexOf(BillingReg.key(i.issuedAt)) !== -1);
  if (billed.length) return { success:false, message:'A month in this batch is already invoiced. Follow up with the provider instead, or record the difference when it arrives.' };
  const hit = [];
  docs.forEach(i => { if (gap > 0){ i.systemPayment.remitFailed = true; hit.push(i); gap = round2(gap - i.systemPayment.feeDeducted); } });
  let rem = (db.remittances = db.remittances || []).find(r => r.provider === b.provider && r.day === b.day);
  if (!rem){ rem = { provider:b.provider, day:b.day, entries:[] }; db.remittances.push(rem); }
  rem.resolution = { kind:'BILLED', at:new Date().toISOString(), by:CU.name, docs:hit.length };
  logActivity(db, { actorType:'EPI', action:`${b.provider}, ${b.day}: ${peso(b.expected - b.received)} not received. ${hit.length} invoice(s) go back to the clients' monthly statements.` });
  Store.save(db);
  return { success:true, message:`${hit.length} invoice(s) will be billed to the clients in their monthly statement.` };
});

LocalAPI.on("Dashboard/OpsRemitFollow", function (p) {
  if (!can('operate')) return { success:false, message:'Only EPI operations does this.' };
  const db = Store.db, b = SettleReg.batches(db, 400).find(x => x.key === p.key);
  if (!b) return { success:false, message:'Batch not found.' };
  let rem = (db.remittances = db.remittances || []).find(r => r.provider === b.provider && r.day === b.day);
  if (!rem){ rem = { provider:b.provider, day:b.day, entries:[] }; db.remittances.push(rem); }
  rem.resolution = { kind:'FOLLOW_UP', at:new Date().toISOString(), by:CU.name, note:String(p.note || '').slice(0, 200) };
  logActivity(db, { actorType:'EPI', action:`${b.provider}, ${b.day}: sent to the provider for follow-up` });
  Store.save(db);
  return { success:true, message:'Marked as with the provider.' };
});

/* ============================================================
   Operator view
   ============================================================ */

const SettleViews = {
  opsPanel(){
    const db = Store.db, all = SettleReg.batches(db), prov = SettleReg.byProvider(all), open = SettleReg.open(all);
    const exp = round2(all.reduce((a, b) => a + b.expected, 0)), rec = round2(all.reduce((a, b) => a + b.received, 0));
    const owed = round2(prov.reduce((a, p) => a + p.open, 0)), wait = round2(prov.reduce((a, p) => a + p.awaiting, 0));
    const kpi = (l, v, n) => `<div class="col-6 col-lg-3"><div class="lcard h-100"><div class="lcard-body"><span class="stat-label">${l}</span><div class="stat-value mono">${v}</div>${n ? `<span class="stat-note">${n}</span>` : ''}</div></div></div>`;
    const rows = all.map(b => {
      const st = SettleReg.STATUS[b.status], res = b.resolution;
      const act = b.status === 'AWAITING' ? '' : b.status === 'MATCHED' ? ''
        : res ? `<span class="fs_11 text-muted">${res.kind === 'BILLED' ? 'Billed to clients' : 'With the provider'}</span>`
        : `<button class="lbtn lbtn-sm lbtn-ghost button_remit_bill" data-key="${esc(b.key)}">Bill clients</button>
           <button class="lbtn lbtn-sm lbtn-ghost button_remit_follow" data-key="${esc(b.key)}">Follow up</button>`;
      return `<tr><td>${esc(fmtDate(b.day + 'T12:00:00+08:00'))}</td><td>${esc(b.provider)}</td>
        <td class="text-end">${b.clients.size} / ${b.docs.length}</td><td class="text-end mono">${num(b.expected)}</td>
        <td class="text-end mono">${b.entries.length ? num(b.received) : '—'}</td>
        <td class="text-end mono ${b.diff < 0 ? 'text-danger' : ''}">${b.entries.length || b.status === 'MISSING' ? num(b.diff) : '—'}</td>
        <td>${esc(fmtDate(b.due + 'T12:00:00+08:00'))}</td>
        <td><span class="lbadge ${st.cls}">${st.label}</span></td>
        <td class="text-nowrap">${b.status === 'MATCHED' ? '' : `<button class="lbtn lbtn-sm lbtn-ghost button_remit_record" data-key="${esc(b.key)}">Record</button> `}${act}</td></tr>`;
    }).join('');
    const provRows = prov.map(p => { const c = SettleReg.clientsOf(Store.db, p.provider); return `<tr><td>${esc(p.provider)}</td>
      <td class="fs_12" title="${esc(c.names.join(', '))}">${c.n} client${c.n === 1 ? '' : 's'}${c.n && c.confirmed === c.n ? ' <span class="lbadge lbadge-green">Confirmed</span>' : c.n ? ' <span class="lbadge lbadge-amber">' + (c.n - c.confirmed) + ' not confirmed</span>' : ''}</td><td class="text-end">${p.batches}</td><td class="text-end mono">${num(p.expected)}</td>
      <td class="text-end mono">${num(p.received)}</td><td class="text-end mono">${num(p.awaiting)}</td>
      <td class="text-end mono ${p.open ? 'text-danger' : ''}">${num(p.open)}</td></tr>`; }).join('');
    return `
      <div class="row g-2 mb-3">
        ${kpi('Deducted by providers', peso(exp), 'last ' + SettleReg.WINDOW_DAYS + ' days, VAT inclusive')}
        ${kpi('Received by EPI', peso(rec))}
        ${kpi('Awaiting', peso(wait), 'not yet due')}
        ${kpi('Short or not received', peso(owed), open.length + ' batch' + (open.length === 1 ? '' : 'es') + ' to resolve')}
      </div>
      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">BY PROVIDER</strong>
        <div class="table-responsive"><table class="table fs_13 mb-0">
          <thead><tr><th>PROVIDER</th><th>CLIENTS</th><th class="text-end">BATCHES</th><th class="text-end">EXPECTED</th><th class="text-end">RECEIVED</th><th class="text-end">AWAITING</th><th class="text-end">SHORT / NOT RECEIVED</th></tr></thead>
          <tbody>${provRows || '<tr><td colspan="7" class="text-muted">No payments through the System yet.</td></tr>'}</tbody></table></div>
      </div></div>
      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">DAILY PROVIDER PAYMENTS</strong>
        <div class="fs_12 text-muted mb-2">Each row is one provider and one payment day. Expected is the fee and VAT the provider took from buyer payments that day. Received is what EPI recorded as paid by the provider. A real-time provider pays the same day and a next-banking-day provider pays the day after. The provider pays the client's share to the client. EPI never holds it. A fee that is never received is billed to the client in the monthly statement.</div>
        <div class="table-responsive" style="max-height:420px; overflow-y:auto;"><table class="table fs_13 mb-0 nowrap">
          <thead><tr><th>PAYMENT DAY</th><th>PROVIDER</th><th class="text-end">CLIENTS / DOCS</th><th class="text-end">EXPECTED</th><th class="text-end">RECEIVED</th><th class="text-end">DIFFERENCE</th><th>DUE</th><th>STATUS</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="9" class="text-muted">No batches.</td></tr>'}</tbody></table></div>
      </div></div>`;
  }
};

const SettleUI = {
  bindOps(){
    const find = k => SettleReg.batches(Store.db, 400).find(x => x.key === k);
    $(".button_remit_record").off("click").on("click", function () {
      const b = find($(this).data("key")), left = round2(b.expected - b.received);
      UI.openModal('Record a remittance', `
        <div class="fs_13 mb-2">${esc(b.provider)}, payments of ${esc(fmtDate(b.day + 'T12:00:00+08:00'))}. Expected <strong class="mono">${peso(b.expected)}</strong>${b.received ? `, received so far <span class="mono">${peso(b.received)}</span>` : ''}.</div>
        <span class="d-block fs_12 fw-semibold mb-1">Amount received</span>
        <input type="number" min="0.01" step="0.01" class="form-control form-control-sm mb-2 input_remit_amount" value="${left > 0 ? left.toFixed(2) : ''}">
        <span class="d-block fs_12 fw-semibold mb-1">Date received</span>
        <input type="date" class="form-control form-control-sm mb-2 input_remit_at" value="${new Date().toLocaleDateString('en-CA')}">
        <span class="d-block fs_12 fw-semibold mb-1">Bank reference</span>
        <input type="text" class="form-control form-control-sm input_remit_ref" maxlength="60" placeholder="Credit advice or transfer number">`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_remit_go">Record</button>`, 'sm');
      $(".button_remit_go").on("click", () => OpsUI.call('OpsRemitRecord', { key:b.key, amount:$(".input_remit_amount").val(), at:$(".input_remit_at").val(), ref:$(".input_remit_ref").val() }, 'opsBilling'));
    });
    $(".button_remit_bill").off("click").on("click", function () {
      const b = find($(this).data("key"));
      UI.openModal('Bill the clients', `
        <div class="fs_13 mb-2">${esc(b.provider)}, ${esc(fmtDate(b.day + 'T12:00:00+08:00'))}: <strong class="mono">${peso(round2(b.expected - b.received))}</strong> of fees was deducted but not received.</div>
        <div class="fs_12 text-muted">The affected documents go back into the clients' monthly statements at their tier fee, as the agreement allows when a fee cannot be collected through the System. If the provider pays later, record it as a remittance first instead. Do not do both.</div>`,
        `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
         <button class="lbtn lbtn-primary button_remit_bill_go">Bill the clients</button>`, 'sm');
      $(".button_remit_bill_go").on("click", () => OpsUI.call('OpsRemitBill', { key:b.key }, 'opsBilling'));
    });
    $(".button_remit_follow").off("click").on("click", function () {
      OpsUI.call('OpsRemitFollow', { key:$(this).data("key") }, 'opsBilling');
    });
  }
};
