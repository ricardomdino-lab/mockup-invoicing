/* ============================================================
   corrections.js — Corrections

   An issued document cannot be edited. That is the whole premise of the
   system, and it is not a limitation of the software: a document the buyer is
   holding, that has been counted in a VAT period and possibly transmitted, is a
   statement that was made. You do not unmake a statement, you make another one.

   So the one way to correct a document is to cancel it. A cancellation
   withdraws the document entirely, and is only honest when the sale did not
   happen at all — a duplicate, a keying error, a sale that fell through before
   delivery. It retires the number permanently, and the right invoice is then
   issued as a new document. If money changed hands, this is the wrong
   instrument and the screen says so. Credit and debit notes are not part of
   this system.

   Who may do it is two different questions, and PERMS already answers both.
   `correct: true` is authority to correct; `correct: 'request'` is authority to
   ask. An owner or a supervisor raises a correction and it takes effect. An
   issuer or a bookkeeper raises a request that waits for one of them. That is
   not bureaucracy for its own sake — the person who keyed the original is the
   person most likely to be wrong about it a second time.

   Nobody approves their own request. The roles that can approve never create a
   pending one, so the rule costs nothing and closes the hole anyway.
   ============================================================ */

const CorrReg = {

  /** What a correction can be, and the shape of the reasoning behind each. */
  KINDS: {
    CANCEL: {
      label: 'Cancellation',
      verb:  'withdraw',
      note:  'The document is cancelled and its number is retired. Use only if the sale did not take place.',
      reasons: ['DUPLICATE','DATA_ERROR','WRONG_BUYER','CANCELLED_SALE']
    }
  },

  /** Corrections this role is allowed to see, newest first. */
  visible(){
    refreshSession();
    const db = Store.db;
    let list = (db.corrections || []).filter(c => c.tenantId === CU.tenantId);
    if (!can('allBranches') && CU.branchId){
      list = list.filter(c => c.branchId === CU.branchId);
    }
    return list.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  },

  /** Documents this role could raise a correction against. Retention-expired
      and archived documents are excluded — a correction reopens a document,
      and a decade-old one is a record to preserve, not to amend. */
  correctable(){
    return Auth.visibleInvoices().filter(i =>
      i.docType === 'INVOICE' && i.docStatus !== 'CANCELLED' &&
      retentionState(i.issuedAt) === 'LIVE');
  },

  /* A correction that has already been decided is history. Only a pending one
     has anything left to do, and only an approver can do it. */
  actionable(c){ return c.status === 'PENDING' && can('approve'); },

  params(){
    return {
      searchval: $(".input_searchval_corrections").val() || "",
      status:    $(".select_status_corrections").val() || "",
      branch:    $(".select_branch_corrections").val() || ""
    };
  },

  apply(p){
    p = p || {};
    const q = String(p.searchval || '').trim().toLowerCase();
    return this.visible().filter(c => {
      if (p.status && c.status !== p.status) return false;
      if (p.branch && p.branch !== 'ALL' && c.branchId !== p.branch) return false;
      if (!q) return true;
      return [c.invoiceNumber, c.resultNumber, c.requestedBy, c.note,
              InvoiceDoc.REASONS[c.reason]]
        .some(v => String(v || '').toLowerCase().indexOf(q) > -1);
    });
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function CorrectionsScreen() {
  const branches = Auth.visibleBranches().map(b => ({ value:b.id, text:`${b.name} (${b.code})` }));
  DisplaySelect2(branches, ".select_branch_corrections", true, "All branches", "");
  EnhanceSelect(".select_status_corrections");

  /* Typed search settles before it searches, the way the register's does. */
  let delay;
  $(".input_searchval_corrections").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter"){ e.preventDefault(); clearTimeout(delay); CorrectionsSearch(); }
    })
    .on("input", function () {
      clearTimeout(delay);
      delay = setTimeout(CorrectionsSearch, 600);
    })
    .val("");

  $(".select_status_corrections").off("change").on("change", CorrectionsSearch);
  $(".select_branch_corrections").off("select2:select select2:clear")
    .on("select2:select select2:clear", CorrectionsSearch);
  $(".button_repeat_corrections").off("click").on("click", CorrectionsSearch);
  $(".button_corrections_new").off("click").on("click", function () { ModalCorrection(); });

  CorrectionsSearch();
}

Screens.corrections = function () { CorrectionsScreen(); };

function CorrectionsSearch() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/CorrectionSearch",
    method: "POST",
    dataType: "json",
    data: CorrReg.params(),
    success: function (res) {
      if (!res.success) return;
      CorrectionsTotals(res.data_1);
      CorrectionsTable(res.data_2);
    }
  });
}

function CorrectionsTotals(t) {
  $(".span_corrections_pending").text(t.pending);
  $(".span_corrections_pending_note").text(
    t.pending ? 'Pending approval' : 'None pending');
  $(".span_corrections_approved").text(t.approved);
  $(".span_corrections_rejected").text(t.rejected);
}

function CorrectionsTable(data) {
  $(".table_corrections").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_corrections").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No cancellations match these filters" },
    "data": data,
    "order": [[4, "DESC"]],
    "columns": [
      { data: "original", render: function (d, t, row) {
          return `<span class="hyperlink fw-semibold span_corr_open_doc" data-id="${row.invoice_id}">${d}</span>`;
        } },
      { data: "reason", "orderable": false },
      { data: "requested", "orderable": false },
      { data: "status", "orderable": false },
      { data: "actions", "orderable": false, className: "text-end" },
      { data: "sorting", "visible": false }
    ]
  }));

  $(document).off("click", ".span_corr_open_doc")
    .on("click", ".span_corr_open_doc", function () {
      Nav.go('invoices', { docId: $(this).data("id") });
    });

  $(document).off("click", ".button_corr_decide")
    .on("click", ".button_corr_decide", function () {
      ModalCorrectionDecide($(this).data("id"), $(this).data("verdict"));
    });
}

/* ============================================================
   Raising one
   ============================================================ */

function ModalCorrection() {
  const docs = CorrReg.correctable();
  if (!docs.length){
    DisplaySwal('info', '', 'There is no invoice here that can be cancelled.');
    return;
  }

  const requesting = permValue('correct') === 'request';

  CorrectionForm.kind = 'CANCEL';

  UI.openModal('Cancel an invoice', `
    ${Callout(requesting ? 'info' : 'warn', requesting
        ? `Your role sends a request. A supervisor or an owner approves it. The invoice stays active until they do.`
        : `You can cancel directly. The invoice you select is cancelled at once and cannot be restored.`, {cls:'mb-3'})}

    <div class="mb-3">
      <span class="d-block fw-semibold fs_13 text-dark mb-2">Invoice to cancel</span>
      <select class="form-select height_40 fs_14 shadow-none" id="corr-doc">
        <option value="">Select an invoice…</option>
        ${docs.map(i => `<option value="${i.id}">${esc(i.number)} · ${esc((i.buyer && i.buyer.name) || '—')} · ${peso(i.totals.totalDue)}</option>`).join('')}
      </select>
    </div>

    <div id="corr-doc-summary"></div>

    <div id="corr-kind-detail"></div>

    <div class="mb-3">
      <span class="d-block fw-semibold fs_13 text-dark mb-2">
        What happened <span class="text-danger">*</span>
      </span>
      <textarea id="corr-note" rows="3" maxlength="300"
                class="form-control fs_14 shadow-none"
                placeholder="Enter the reason. It is read by the approver and kept on the record."></textarea>
      <div class="fs_11 text-muted mt-1">
        Reason is required.
      </div>
    </div>`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn lbtn-primary" onclick="CorrectionForm.submit()">
       ${requesting ? 'Send for approval' : 'Cancel the invoice'}</button>`);

  EnhanceSelect('#corr-doc', $(document.body));
  $('#corr-doc').off('change').on('change', () => CorrectionForm.pickDoc());
}

const CorrectionForm = {
  doc: null,
  kind: null,

  pickDoc(){
    const id = document.getElementById('corr-doc').value;
    this.doc = Store.db.invoices.find(i => i.id === id) || null;
    const box = document.getElementById('corr-doc-summary');

    if (!this.doc){ box.innerHTML = ''; this.paintKind(); return; }
    const d = this.doc;

    box.innerHTML = `
      <div class="card bg-light border rounded-3 p-3 mb-3 fs_12">
        <div class="d-flex justify-content-between"><span class="text-muted">Buyer</span>
          <span class="fw-semibold">${esc((d.buyer && d.buyer.name) || '—')}</span></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Issued</span>
          <span>${fmtDateTime(d.issuedAt)}</span></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Total amount due</span>
          <span class="fw-semibold">${peso(d.totals.totalDue)}</span></div>
        <div class="d-flex justify-content-between"><span class="text-muted">Reported to the BIR</span>
          <span>${d.transmissionStatus === 'TRANSMITTED' ? 'Yes — ' + esc(d.transmissionRef || '') : 'Not yet'}</span></div>
      </div>`;
    this.paintKind();
  },

  paintKind(){
    const box = document.getElementById('corr-kind-detail');
    if (!box) return;
    if (!this.kind || !this.doc){ box.innerHTML = ''; return; }

    const spec = CorrReg.KINDS.CANCEL;
    const paid = this.doc.paymentStatus === 'PAID';

    /* The one combination the screen refuses outright. Everything else is a
       judgement call the approver makes; this one is just wrong. */
    if (this.kind === 'CANCEL' && paid){
      box.innerHTML = `
        ${Callout('danger', `<strong>This invoice cannot be cancelled.</strong> It is marked paid. A cancellation means the sale did not take place.`, {cls:'mb-3'})}`;
      return;
    }

    box.innerHTML = `
      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">
          Reason <span class="text-danger">*</span>
        </span>
        <select class="form-select height_40 fs_14 shadow-none" id="corr-reason">
          ${spec.reasons.map(r =>
            `<option value="${r}">${esc(InvoiceDoc.REASONS[r])}</option>`).join('')}
        </select>
      </div>

      ${Callout('warn', `The number <strong class="mono">${esc(this.doc.number)}</strong> is retired and will not be used again. The cancelled invoice stays in Invoices. Issue a new invoice with the correct details.`, {cls:'mb-3'})}`;

    EnhanceSelect('#corr-reason', $(document.body));
  },

  submit(){
    const note = String((document.getElementById('corr-note') || {}).value || '').trim();
    const reasonEl = document.getElementById('corr-reason');

    if (!this.doc){ UI.toast('Select an invoice first', 'warn'); return; }
    if (!reasonEl){ UI.toast('This invoice cannot be cancelled', 'warn'); return; }
    if (!note){ UI.toast('Enter the reason for the cancellation', 'warn'); return; }

    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">
         ${permValue('correct') === 'request' ? 'Send this for approval?' : 'Cancel this invoice?'}</span>
       <span class="fs_14 text-muted">${esc(this.doc.number)} will be cancelled and its number retired. ${permValue('correct') === 'request'
         ? 'Nothing changes until an approver decides it.'
         : 'This cannot be reversed.'}</span>`,
      () => {
        DisplayLoadingSwal();
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/CorrectionRaise",
          method: "POST",
          data: { invoice_id:this.doc.id, kind:this.kind,
                  reason:reasonEl.value, note },
          success: res => {
            Swal.close();
            if (!res.success){ DisplaySwal('error', '', res.message); return; }
            UI.closeModal();
            DisplayDelaySwal('success', '', res.message);
            CorrectionsSearch();
          }
        });
      }, null, permValue('correct') === 'request' ? 'Submit' : 'Cancel it');
  }
};

/* ============================================================
   Deciding one
   ============================================================ */

function ModalCorrectionDecide(id, verdict) {
  const c = (Store.db.corrections || []).find(x => x.id === id);
  if (!c) return;
  const approving = verdict === 'APPROVE';
  UI.openModal(approving ? 'Approve this cancellation' : 'Reject this cancellation', `
    <div class="card bg-light border rounded-3 p-3 mb-3 fs_13">
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Invoice</span><span class="fw-semibold mono">${esc(c.invoiceNumber)}</span></div>
      <div class="d-flex justify-content-between py-1">
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Reason</span><span>${esc(InvoiceDoc.REASONS[c.reason] || c.reason)}</span></div>
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Requested by</span><span>${esc(c.requestedBy)}</span></div>
      <div class="mt-2 pt-2 border-top fs_12">
        <div class="text-muted mb-1">What they said happened</div>
        <div>${esc(c.note)}</div>
      </div>
    </div>

    ${approving ? `
      ${Callout('warn', `Approving withdraws <strong class="mono">${esc(c.invoiceNumber)}</strong> and retires its number. The decision cannot be reversed.`, {cls:'mb-3'})}` : ''}

    <div class="mb-2">
      <span class="d-block fw-semibold fs_13 text-dark mb-2">
        Your note${approving ? '' : ' <span class="text-danger">*</span>'}
      </span>
      <textarea id="corr-decision-note" rows="3" maxlength="300"
                class="form-control fs_14 shadow-none"
                placeholder="${approving
                  ? 'Optional. Anything the record should carry alongside your approval.'
                  : 'Required. The person who raised this needs to know what to do instead.'}"></textarea>
    </div>`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn ${approving ? 'lbtn-primary' : 'lbtn-danger'}"
       onclick="CorrectionDecide('${id}','${verdict}')">
       ${approving ? 'Approve and cancel' : 'Reject'}</button>`);
}

function CorrectionDecide(id, verdict) {
  const note = String((document.getElementById('corr-decision-note') || {}).value || '').trim();
  if (verdict === 'REJECT' && !note){
    UI.toast('Enter the reason for rejection', 'warn');
    return;
  }

  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/CorrectionDecide",
    method: "POST",
    data: { correction_id:id, verdict, note },
    success: function (res) {
      Swal.close();
      if (!res.success){ DisplaySwal('error', '', res.message); return; }
      UI.closeModal();
      DisplayDelaySwal('success', '', res.message);
      CorrectionsSearch();
    }
  });
}

/* ============================================================
   The server side of the screen.
   ============================================================ */

LocalAPI.on("Dashboard/CorrectionSearch", function (p) {
  const db = Store.db;
  const rows = CorrReg.apply(p);

  const pending = rows.filter(c => c.status === 'PENDING');

  return {
    success: true,
    data_1: {
      pending:      pending.length,
      approved:     rows.filter(c => c.status === 'APPROVED').length,
      rejected:     rows.filter(c => c.status === 'REJECTED').length
    },
    data_2: rows.map(c => {
      const decide = CorrReg.actionable(c);
      return {
        id:          c.id,
        invoice_id:  c.invoiceId,
        original:    esc(c.invoiceNumber),
        reason:      esc(InvoiceDoc.REASONS[c.reason] || c.reason),
        requested:   `${esc(c.requestedBy)}<div class="fs_11 text-muted mono">${fmtDateTime(c.requestedAt)}</div>`,
        status:      badge('correction', c.status) +
                     (c.decidedBy ? `<div class="fs_11 text-muted mt-1">${esc(c.decidedBy)}</div>` : ''),
        actions:     decide
          ? `<button class="lbtn lbtn-sm lbtn-ghost button_corr_decide"
                     data-id="${c.id}" data-verdict="APPROVE">Approve</button>
             <button class="lbtn lbtn-sm lbtn-danger button_corr_decide"
                     data-id="${c.id}" data-verdict="REJECT">Reject</button>`
          : '',
        sorting:     c.requestedAt
      };
    })
  };
});

LocalAPI.on("Dashboard/CorrectionRaise", function (p) {
  const db = Store.db;
  const inv = Auth.visibleInvoices().find(i => i.id === p.invoice_id);

  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  if (!permValue('correct')) return { success:false, message:'Your role cannot cancel invoices.' };
  if (inv.docStatus === 'CANCELLED')
    return { success:false, message:'That invoice has already been cancelled.' };

  const kind = p.kind;
  const spec = CorrReg.KINDS[kind];
  if (!spec) return { success:false, message:'Only a cancellation can be raised.' };
  if (spec.reasons.indexOf(p.reason) === -1)
    return { success:false, message:'That reason does not apply to a cancellation.' };

  /* Checked on the screen too. Repeated here because a screen is not a gate. */
  if (kind === 'CANCEL' && inv.paymentStatus === 'PAID')
    return { success:false, message:'A paid invoice cannot be cancelled.' };

  const note = String(p.note || '').trim();
  if (!note) return { success:false, message:'A cancellation needs a reason.' };

  /* Direct authority issues; the rest queue. This is the whole of the
     difference between correct:true and correct:'request'. */
  const direct = permValue('correct') === true;

  const c = {
    id: uid('corr'),
    tenantId: inv.tenantId,
    branchId: inv.branchId,
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    kind, reason: p.reason, note, amount: 0,
    status: 'PENDING',
    requestedBy: CU.name,
    requestedByRole: CR,
    requestedAt: new Date().toISOString(),
    decidedBy: null, decidedAt: null, decisionNote: null, resultNumber: null
  };

  db.corrections = db.corrections || [];
  db.corrections.unshift(c);

  logActivity(db, {
    action: direct
      ? `Raised a ${spec.label.toLowerCase()} against ${inv.number}: ${InvoiceDoc.REASONS[p.reason]}`
      : `Requested a ${spec.label.toLowerCase()} against ${inv.number}: ${InvoiceDoc.REASONS[p.reason]}`
  });

  if (direct){
    const out = applyCorrection(db, c, CU.name, '');
    Store.save(db);
    return { success:true, message: out.message };
  }

  Store.save(db);
  return { success:true,
           message:`Submitted for approval. ${inv.number} stays unchanged until approved.` };
});

LocalAPI.on("Dashboard/CorrectionDecide", function (p) {
  const db = Store.db;
  const c = (db.corrections || []).find(x => x.id === p.correction_id);

  if (!c) return { success:false, message:'That request no longer exists.' };
  if (c.status !== 'PENDING') return { success:false, message:'That request has already been decided.' };
  if (!can('approve')) return { success:false, message:'Your role cannot approve cancellations.' };

  /* Cheap to enforce and free to keep, because the roles that approve never
     create a pending request in the first place. */
  if (c.requestedBy === CU.name)
    return { success:false, message:'You cannot decide your own request.' };

  const note = String(p.note || '').trim();

  /* Cancelling acts on a live document, so it waits while issuing is blocked. */
  if (p.verdict !== 'REJECT' && issuanceBlock())
    return { success:false, message:issuanceBlock() };

  if (p.verdict === 'REJECT'){
    if (!note) return { success:false, message:'A rejection needs a reason.' };
    c.status = 'REJECTED';
    c.decidedBy = CU.name;
    c.decidedAt = new Date().toISOString();
    c.decisionNote = note;
    logActivity(db, {
      action:`Rejected the ${(CorrReg.KINDS[c.kind] || {}).label.toLowerCase()} requested against ${c.invoiceNumber}: ${note}`
    });
    Store.save(db);
    return { success:true, message:`Rejected. ${c.invoiceNumber} is unchanged.` };
  }

  const out = applyCorrection(db, c, CU.name, note);
  Store.save(db);
  return out.ok ? { success:true, message:out.message }
                : { success:false, message:out.message };
});

/**
 * Carry out an approved correction.
 *
 * Called from two places — a direct correction by someone with the authority,
 * and an approval of somebody else's request. Both end in exactly the same
 * documents, which is the point of putting it here rather than in each route:
 * a correction should not depend on who was allowed to make it.
 */
function applyCorrection(db, c, decidedBy, note) {
  const inv = db.invoices.find(i => i.id === c.invoiceId);
  if (!inv) return { ok:false, message:'The original invoice is no longer available.' };

  c.status = 'APPROVED';
  c.decidedBy = decidedBy;
  c.decidedAt = new Date().toISOString();
  c.decisionNote = note || null;

  if (c.kind === 'CANCEL'){
    inv.docStatus = 'CANCELLED';
    inv.cancelledAt = c.decidedAt;
    inv.cancelReason = c.reason;
    inv.cancelNote = c.note;
    /* A cancelled document is not reported as a sale. If it never went, it
       never goes; if it did, the cancellation is what gets reported next. */
    if (inv.transmissionStatus !== 'TRANSMITTED'){
      inv.transmissionStatus = 'NOT_READY';
      inv.transmissionRef = null;
    }

    const key = `INVOICE:${inv.tenantId}`;
    if (db.series[key] && db.series[key].retired.indexOf(inv.number) === -1){
      db.series[key].retired.push(inv.number);
    }

    logActivity(db, { action:`Cancelled ${inv.number} — ${InvoiceDoc.REASONS[c.reason]}` });
    return { ok:true, message:`${inv.number} is cancelled and its number retired.` };
  }

  return { ok:false, message:'Only a cancellation can be applied.' };
}

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  corrections(){
    const opt = (v, l) => `<option value="${v}">${l}</option>`;
    const mayRaise = !!permValue('correct');
    const requesting = permValue('correct') === 'request';

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Cancellations</h1>
          <div class="screen_sub">
            An issued invoice cannot be edited. To correct it, cancel it and issue a new invoice.
            ${can('approve')
              ? 'You can approve or reject requests from other users.'
              : requesting ? 'You can request a cancellation. A supervisor or owner approves it.' : ''}
          </div>
        </div>
        ${mayRaise ? `
        <button class="lbtn lbtn-primary button_corrections_new">
          <i class="bi bi-arrow-counterclockwise"></i>
          ${requesting ? 'Request a cancellation' : 'Cancel an invoice'}
        </button>` : ''}
      </div>

      <div class="row g-2 mb-2">
        <div class="col-6 col-lg-4">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Pending approval</span>
            <div class="stat-value mono span_corrections_pending">—</div>
            <span class="stat-note span_corrections_pending_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-4">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Approved</span>
            <div class="stat-value mono span_corrections_approved">—</div>
            <span class="stat-note">An invoice was cancelled</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-4">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Rejected</span>
            <div class="stat-value mono span_corrections_rejected">—</div>
          </div></div>
        </div>
      </div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">
        <div class="d-flex flex-wrap gap-2 align-items-stretch">
          <div class="period-bar flex-grow-1" style="min-width:460px;">
            <div class="period-seg">
              <select class="form-select form-select-sm select_branch_corrections"></select>
            </div>
            <div class="period-seg">
              <select class="form-select form-select-sm select_status_corrections">
                ${opt('', 'Any status')}
                ${Object.keys(STATUS.correction).map(k =>
                  opt(k, STATUS.correction[k].label)).join('')}
              </select>
            </div>
            <div class="period-seg" style="flex:1.4 1 0;">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-search"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_searchval_corrections"
                       placeholder="Number, person or reason...">
              </div>
            </div>
          </div>
          <button class="lbtn lbtn-ghost button_repeat_corrections">
            <i class="bi bi-arrow-repeat"></i>
          </button>
        </div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table_corrections">
            <thead>
              <tr>
                <th>INVOICE</th>
                <th>REASON</th>
                <th>REQUESTED BY</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div></div>`;
  }
});
