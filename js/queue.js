/* ============================================================
   queue.js — Receipts queued while EPI's service is down

   When EPI's own service is down, a sale entered through the Issue
   Invoice form or an incoming platform order is not refused. It is
   kept as a queued receipt with the time of the sale. When service
   returns, every queued receipt is issued in order of sale time,
   transmitted, and sent to the buyer. Nobody resends anything.

   The same moment also:
     - issues the e-invoice for each manual invoice recorded during the
       outage and links the two (RMC VII.18), and
     - sends again every buyer copy that failed, so a document that was
       stuck behind the outage reaches its buyer without a click.

   A BIR EIS or API outage is different and unchanged: issuing keeps
   working, only transmission is held (core.js, resilience.js).
   ============================================================ */

const OutageQueue = {

  /** Keep one sale. `p` is what IssueReg.issue would have been given. */
  accept(p, extra){
    const v = IssueReg.validate(p);
    if (v.errors.length) return { success:false, message:v.errors[0], errors:v.errors };
    if (extra && extra.manualRef)
      return { success:false, message:'EPI service is down. The e-invoice for a manual invoice is issued when service returns.' };

    const db = Store.db, int = activeInterruption();
    db.queuedReceipts = db.queuedReceipts || [];
    const year = new Date().getFullYear();
    const n = db.queuedReceipts.filter(x => x.ref.indexOf(`QR-${year}-`) === 0).length + 1;
    const q = {
      id: uid('qr'), ref:`QR-${year}-${String(n).padStart(4, '0')}`,
      tenantId: CT.id, branchId: v.branch.id,
      queuedAt: new Date().toISOString(), saleAt: v.at.toISOString(),
      queuedBy: CU.name, queuedById: CU.id,
      via: (extra && extra.issuedVia) || 'Issue Invoice form',
      extra: extra || null, params: p,
      buyerName: v.buyer.name, deliverTo: v.buyer.address || null, total: v.totals.totalDue,
      interruptionId: int ? int.id : null, status:'QUEUED'
    };
    db.queuedReceipts.push(q);
    logActivity(db, { action:`Waiting sale ${q.ref} for ${q.buyerName}, ${peso(q.total)}` +
      (int ? ` (${int.ref})` : '') });
    Store.save(db);
    return { success:true, queued:true, id:q.id, ref:q.ref,
             message:`${q.ref} queued for ${q.buyerName}, ${peso(q.total)}. It is issued and sent to the buyer when service returns.` };
  },

  rows(){
    const ids = Auth.visibleBranches().map(b => b.id);
    return (Store.db.queuedReceipts || [])
      .filter(q => q.tenantId === CT.id && ids.indexOf(q.branchId) > -1)
      .sort((a, b) => new Date(b.queuedAt) - new Date(a.queuedAt));
  },

  waiting(tenantId){
    return (Store.db.queuedReceipts || []).filter(q => q.status === 'QUEUED' && (!tenantId || q.tenantId === tenantId));
  },

  /** Run `fn` as the person who queued the work, inside that account. */
  withContext(userId, tenantId, fn){
    const db = Store.db;
    const u = db.users.find(x => x.id === userId) ||
              db.users.find(x => x.tenantId === tenantId && PERMS[x.roleKey] && PERMS[x.roleKey].issue);
    const t = db.tenants.find(x => x.id === tenantId);
    if (!u || !t) return { success:false, message:'No user on the account can issue this sale. Review it in Waiting sales.' };
    const saved = [CU, CR, CT];
    CU = Object.assign({}, u, { tenantId }); CR = u.roleKey; CT = t;
    try { return fn(); } finally { [CU, CR, CT] = saved; }
  },

  /** Send the buyer copy, trying again by itself until it is delivered or the attempts run out. */
  autoDeliver(live){
    if (!live.deliverTo) return false;
    for (let i = 0; i < DelivReg.MAX_ATTEMPTS + 1; i++){
      const out = deliverWithFallback(live);
      live.deliveryAttempts = (live.deliveryAttempts || 0) + 1;
      live.deliveryStatus = out.ok ? 'DELIVERED' : 'FAILED';
      if (out.ok){ live.deliveredAt = new Date().toISOString(); return true; }
    }
    return false;
  },

  /** Service is back: issue what waited, link the manual invoices, send what did not arrive. */
  flush(int){
    const db = Store.db;
    const r = { issued:0, review:0, manual:0, sent:0, resent:0 };

    (db.queuedReceipts || []).filter(q => q.status === 'QUEUED')
      .sort((a, b) => new Date(a.saleAt) - new Date(b.saleAt))
      .forEach(q => {
        const out = this.withContext(q.queuedById, q.tenantId, () => IssueReg.issue(q.params,
          Object.assign({}, q.extra || {}, { queuedRef:{ id:q.id, ref:q.ref, queuedAt:q.queuedAt, interruptionId:q.interruptionId } })));
        if (!out.success){ q.status = 'REVIEW'; q.error = out.message; r.review++; return; }
        const live = db.invoices.find(i => i.id === out.id);
        q.status = 'ISSUED'; q.invoiceId = out.id; q.invoiceNumber = out.number; q.issuedAt = new Date().toISOString();
        r.issued++;
        if (this.autoDeliver(live)){ q.sentAt = live.deliveredAt; r.sent++; }
        logActivity(db, { tenantId:q.tenantId, actorType:'SYSTEM', actorName:'EPI service', role:'SYSTEM',
          action:`Issued waiting sale ${q.ref} as ${out.number}` + (live.deliveredAt ? `; buyer copy sent to ${live.deliverTo}` : '') });
      });

    (db.manualInvoices || []).filter(m => m.status !== 'LINKED' && int && m.interruptionId === int.id).forEach(m => {
      const out = this.withContext(m.recordedById, m.tenantId, () => IssueReg.issue(m.params, {
        issuedVia:`Manual invoice ${m.manualNo}`,
        manualRef:{ id:m.id, no:m.manualNo, issuedAt:m.issuedAt, interruptionId:m.interruptionId } }));
      if (!out.success) return;
      m.status = 'LINKED'; m.linkedInvoiceId = out.id; m.linkedAt = new Date().toISOString();
      r.manual++;
      const live = db.invoices.find(i => i.id === out.id);
      if (this.autoDeliver(live)) r.sent++;
      logActivity(db, { tenantId:m.tenantId, actorType:'SYSTEM', actorName:'EPI service', role:'SYSTEM',
        action:`Issued e-invoice ${out.number} for manual invoice ${m.manualNo}` });
    });

    db.invoices.filter(i => i.deliverTo && i.deliveryStatus === 'FAILED').forEach(i => {
      if (this.autoDeliver(i)){ r.resent++; r.sent++; }
    });

    return r;
  },

  summary(r){
    const bits = [];
    const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    if (r.issued) bits.push(`${n(r.issued, 'waiting sale', 'waiting sales')} issued`);
    if (r.manual) bits.push(`${n(r.manual, 'manual invoice', 'manual invoices')} issued and linked`);
    if (r.sent)   bits.push(`${n(r.sent, 'buyer copy', 'buyer copies')} sent`);
    if (r.review) bits.push(`${r.review} need${r.review === 1 ? 's' : ''} review`);
    return bits.length ? bits.join(', ') : 'nothing was waiting';
  }
};

/* ---------- Invoices tab ---------- */

function QueueTabBody(){
  return `<div class="div_queue_note mb-3"></div>
    <div class="lcard"><div class="lcard-body">
      <div class="div_queue_list"></div>
    </div></div>`;
}

function QueueScreen(){
  const rows = OutageQueue.rows();
  const down = activeInterruption();
  const waiting = rows.filter(q => q.status === 'QUEUED').length;

  $(".div_queue_note").html(
    outageQueueing()
      ? Callout('warn', `${waiting} sale${waiting === 1 ? '' : 's'} waiting. They are issued in the order of the sales and sent to the buyers when service returns.`)
      : Callout('info', `Sales entered while EPI service is down wait here. When service returns they are issued in the order of the sales and sent to the buyers.`));

  $(".div_queue_list").html(rows.length ? `<div class="table-responsive"><table class="table fs_13 mb-0">
    <thead><tr><th>REFERENCE</th><th>ENTERED</th><th>SALE</th><th>BUYER</th><th>ISSUED VIA</th><th class="text-end">TOTAL</th><th>STATUS</th></tr></thead><tbody>
    ${rows.map(q => {
      const inv = q.invoiceId ? Store.db.invoices.find(i => i.id === q.invoiceId) : null;
      const status = q.status === 'QUEUED' ? '<span class="lbadge lbadge-amber lbadge-dot">Waiting</span>'
        : q.status === 'REVIEW' ? `<span class="lbadge lbadge-red lbadge-dot">Needs review</span><div class="fs_11 text-muted">${esc(q.error || '')}</div>`
        : `<span class="hyperlink span_queue_open" data-id="${esc(q.invoiceId)}">${esc(q.invoiceNumber)}</span>
           <div class="fs_11 text-muted">${inv && inv.deliveredAt ? 'Sent to buyer ' + esc(fmtDateTime(inv.deliveredAt)) : (inv && inv.deliverTo ? 'Not delivered' : 'No buyer address')}</div>`;
      return `<tr><td class="mono fw-semibold">${esc(q.ref)}</td><td>${esc(fmtDateTime(q.queuedAt))}<div class="fs_11 text-muted">${esc(q.queuedBy)}</div></td>
        <td>${esc(fmtDateTime(q.saleAt))}</td><td>${esc(q.buyerName)}</td><td class="fs_12">${esc(q.via)}</td>
        <td class="text-end mono">${num(q.total)}</td><td>${status}</td></tr>`;
    }).join('')}</tbody></table></div>` :
    '<div class="fs_13 text-muted">No waiting sales.</div>');

  $(".span_queue_open").off("click").on("click", function () { Nav.go('invoices', { docId:$(this).data("id") }); });
}
