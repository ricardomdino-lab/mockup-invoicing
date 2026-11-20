/* ============================================================
   delivery.js — Buyer Copies

   Issuing a document and getting it to the buyer are two different events, and
   conflating them is how a taxpayer ends up believing they have complied when
   half their buyers have nothing in hand. Sec. 237 requires the invoice to be
   issued *to* the purchaser. A document sitting in our database, correctly
   numbered and perfectly computed, that never reached anyone, has not been
   issued to them.

   So delivery has its own state, its own retry, and its own screen.

   Three things this screen is careful about:

     - A failure and an absence are not the same. A bounced email is a problem
       to chase. A walk-in customer who never gave an address is not a failure
       at all — there was nowhere to send it, and the buyer walked away with
       the printed copy. Marking that red would train people to ignore red.

     - Retrying is resending, not re-issuing. The document does not change,
       does not get a new number, and does not move in the register. Only the
       attempt count moves.

     - Changing where it goes is recorded. A buyer copy redirected to a
       different address after the fact is exactly the kind of thing an
       examiner asks about, and exactly the kind of thing an ordinary typo
       makes necessary. Both are true, so it is allowed and it is logged.
   ============================================================ */

const DelivReg = {

  /* How a copy travels. The tenant picks a default at onboarding; a document
     keeps whatever was chosen when it was issued. */
  CHANNELS: {
    EMAIL_PDF:  { label:'Email with PDF',  ico:'bi-paperclip' },
    EMAIL_BODY: { label:'Email body',      ico:'bi-envelope' },
    PORTAL:     { label:'In-app link',     ico:'bi-link-45deg' },
    SMS:        { label:'SMS link',        ico:'bi-chat-dots' }
  },

  MAX_ATTEMPTS: 3,

  /** Documents with a delivery story to tell — everything issued. */
  rows(){
    return Auth.visibleInvoices().filter(i => i.docStatus !== 'DRAFT');
  },

  /** The three real states, plus the one that is not a state at all. */
  state(inv){
    if (!inv.deliverTo) return 'NO_ADDRESS';
    return inv.deliveryStatus || 'PENDING';
  },

  params(){
    return {
      searchval: $(".input_searchval_delivery").val() || "",
      status:    $(".select_status_delivery").val() || "",
      branch:    $(".select_branch_delivery").val() || ""
    };
  },

  apply(p){
    p = p || {};
    const q = String(p.searchval || '').trim().toLowerCase();
    return this.rows().filter(i => {
      if (p.status && this.state(i) !== p.status) return false;
      if (p.branch && p.branch !== 'ALL' && i.branchId !== p.branch) return false;
      if (!q) return true;
      return [i.number, (i.buyer || {}).name, i.deliverTo]
        .some(v => String(v || '').toLowerCase().indexOf(q) > -1);
    });
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function DeliveryScreen() {
  const branches = Auth.visibleBranches().map(b => ({ value:b.id, text:`${b.name} (${b.code})` }));
  DisplaySelect2(branches, ".select_branch_delivery", true, "All branches", "");
  EnhanceSelect(".select_status_delivery");

  let delay;
  $(".input_searchval_delivery").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter"){ e.preventDefault(); clearTimeout(delay); DeliverySearch(); }
    })
    .on("input", function () { clearTimeout(delay); delay = setTimeout(DeliverySearch, 600); })
    .val("");

  $(".select_status_delivery").off("change").on("change", DeliverySearch);
  $(".select_branch_delivery").off("select2:select select2:clear")
    .on("select2:select select2:clear", DeliverySearch);
  $(".button_repeat_delivery").off("click").on("click", DeliverySearch);

  $(".button_delivery_retry_all").off("click").on("click", function () {
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Resend all failed buyer copies?</span>
       <span class="fs_14 text-muted">Failed copies are sent again to their current delivery addresses. No new documents are issued.</span>`,
      function () {
        DisplayLoadingSwal();
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/DeliveryRetryAll",
          method: "POST",
          success: function (res) {
            Swal.close();
            DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
            DeliverySearch();
          }
        });
      }, null, 'Resend');
  });

  DeliverySearch();
}

Screens.delivery = function () { DeliveryScreen(); };

function DeliverySearch() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/DeliverySearch",
    method: "POST",
    dataType: "json",
    data: DelivReg.params(),
    success: function (res) {
      if (!res.success) return;
      DeliveryTotals(res.data_1);
      DeliveryTable(res.data_2);
    }
  });
}

function DeliveryTotals(t) {
  $(".span_delivery_delivered").text(t.delivered);
  $(".span_delivery_rate").text(t.rate);
  $(".span_delivery_failed").text(t.failed);
  $(".span_delivery_failed_note").text(t.failed ? 'Follow up' : 'None pending');
  $(".span_delivery_pending").text(t.pending);
  $(".span_delivery_noaddress").text(t.noAddress);
  $(".button_delivery_retry_all").toggleClass("d-none", !t.failed);
}

function DeliveryTable(data) {
  $(".table_delivery").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_delivery").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No invoices match these filters" },
    "data": data,
    "order": [[7, "DESC"]],
    "columns": [
      { data: "number", render: function (d, t, row) {
          return `<span class="hyperlink fw-semibold span_deliv_open" data-id="${row.id}">${d}</span>`;
        } },
      { data: "buyer", "orderable": false },
      { data: "sent_to", "orderable": false },
      { data: "channel", "orderable": false },
      { data: "status", "orderable": false },
      { data: "attempts", "orderable": false, className: "text-center" },
      { data: "actions", "orderable": false, className: "text-end" },
      { data: "sorting", "visible": false }
    ]
  }));

  $(document).off("click", ".span_deliv_open")
    .on("click", ".span_deliv_open", function () {
      Nav.go('invoices', { docId: $(this).data("id") });
    });

  $(document).off("click", ".button_deliv_retry")
    .on("click", ".button_deliv_retry", function () {
      DeliveryRetry($(this).data("id"));
    });

  $(document).off("click", ".button_deliv_address")
    .on("click", ".button_deliv_address", function () {
      ModalDeliveryAddress($(this).data("id"));
    });
}

function DeliveryRetry(id) {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/DeliveryRetry",
    method: "POST",
    data: { invoice_id: id },
    success: function (res) {
      Swal.close();
      DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
      DeliverySearch();
    }
  });
}

function ModalDeliveryAddress(id) {
  const inv = Auth.visibleInvoices().find(i => i.id === id);
  if (!inv) return;
  const chan = inv.deliverBy || 'EMAIL_PDF';

  UI.openModal('Where the copy goes', `
    <div class="card bg-light border rounded-3 p-3 mb-3 fs_13">
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Document</span>
        <span class="fw-semibold mono">${esc(inv.number)}</span></div>
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Buyer</span>
        <span>${esc(displayBuyer(inv).name || '—')}</span></div>
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">Attempts so far</span>
        <span>${inv.deliveryAttempts || 0}</span></div>
    </div>

    <div class="mb-3">
      <span class="d-block fw-semibold fs_13 text-dark mb-2">Send to</span>
      <input type="text" id="deliv-to" maxlength="120"
             class="form-control height_40 fs_14 shadow-none"
             value="${esc(inv.deliverTo || '')}"
             placeholder="${chan === 'SMS' ? 'Mobile number' : 'Email address'}">
      <div class="fs_11 text-muted mt-1">
        This change is recorded in the activity log. The document is not changed.
      </div>
    </div>

    <div class="mb-2">
      <span class="d-block fw-semibold fs_13 text-dark mb-2">How</span>
      <select class="form-select height_40 fs_14 shadow-none" id="deliv-by">
        ${Object.keys(DelivReg.CHANNELS).map(k =>
          `<option value="${k}"${k === chan ? ' selected' : ''}>${esc(DelivReg.CHANNELS[k].label)}</option>`).join('')}
      </select>
    </div>`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn lbtn-primary" onclick="DeliveryAddressSave('${id}')">Save and resend</button>`);

  EnhanceSelect('#deliv-by', $(document.body));
}

function DeliveryAddressSave(id) {
  const to = String((document.getElementById('deliv-to') || {}).value || '').trim();
  const by = (document.getElementById('deliv-by') || {}).value;

  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/DeliveryAddress",
    method: "POST",
    data: { invoice_id:id, deliver_to:to, deliver_by:by },
    success: function (res) {
      Swal.close();
      if (!res.success){ DisplaySwal('error', '', res.message); return; }
      UI.closeModal();
      DisplayDelaySwal('success', '', res.message);
      DeliverySearch();
    }
  });
}

/* ============================================================
   The server side of the screen.
   ============================================================ */

/**
 * Whether a send gets through.
 *
 * There is no mail server, so this stands in for one. It is not random:
 * an address that has already failed three times keeps failing, because that
 * is what a wrong address does, and a demonstration where the fourth attempt
 * silently works teaches the wrong lesson about retrying.
 */
function deliveryOutcome(inv) {
  const to = String(inv.deliverTo || '');
  if (!to) return { ok:false, why:'There is no delivery address to send to.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to) && (inv.deliverBy || 'EMAIL_PDF').indexOf('EMAIL') === 0){
    return { ok:false, why:'That is not a deliverable email address.' };
  }
  if ((inv.deliveryAttempts || 0) >= DelivReg.MAX_ATTEMPTS && inv.deliveryStatus === 'FAILED'){
    return { ok:false, why:'The delivery address rejected it again. It has now failed ' +
                           ((inv.deliveryAttempts || 0) + 1) + ' times.' };
  }
  return { ok:true };
}

/** The main method first. If it fails and the account has a fallback and the document has a second contact, try that once. */
function deliverWithFallback(inv) {
  const first = deliveryOutcome(inv);
  if (first.ok) return first;
  const t = (Store.db.tenants || []).find(x => x.id === inv.tenantId) || {};
  const fb = t.deliveryFallback, alt = String(inv.deliverToAlt || '');
  if (!fb || !DelivReg.CHANNELS[fb] || !alt) return first;
  const second = deliveryOutcome(Object.assign({}, inv, { deliverTo:alt, deliverBy:fb, deliveryAttempts:0, deliveryStatus:'PENDING' }));
  return second.ok ? { ok:true, via:DelivReg.CHANNELS[fb].label, to:alt } : first;
}

LocalAPI.on("Dashboard/DeliverySearch", function (p) {
  const rows = DelivReg.apply(p);
  const all = DelivReg.rows();

  const counts = k => all.filter(i => DelivReg.state(i) === k).length;
  const delivered = counts('DELIVERED');
  const addressable = all.filter(i => DelivReg.state(i) !== 'NO_ADDRESS').length;

  return {
    success: true,
    data_1: {
      delivered,
      /* Out of the ones that had somewhere to go. Counting walk-ins as
         undelivered would make the rate a measure of the buyer mix. */
      rate: addressable ? Math.round((delivered / addressable) * 100) + '%' : '—',
      failed:    counts('FAILED'),
      pending:   counts('PENDING'),
      noAddress: counts('NO_ADDRESS')
    },
    data_2: rows.map(i => {
      const st = DelivReg.state(i);
      const chan = DelivReg.CHANNELS[i.deliverBy || 'EMAIL_PDF'] || {};
      /* Retrying a decade-old delivery is not a live operation — the record
         is frozen the same way corrections stop being offered against it. */
      const may = (can('issue') || can('users')) && retentionState(i.issuedAt) === 'LIVE';

      return {
        id:       i.id,
        number:   esc(i.number),
        buyer:    esc(displayBuyer(i).name || '—'),
        sent_to:  i.deliverTo
                    ? esc(i.deliverTo)
                    : '<span class="text-muted">No delivery address given</span>',
        channel:  st === 'NO_ADDRESS' ? '—' : esc(chan.label || '—'),
        status:   st === 'NO_ADDRESS'
                    ? '<span class="lbadge lbadge-gray">No delivery address</span>'
                    : badge('delivery', st),
        attempts: st === 'NO_ADDRESS' ? '—' : String(i.deliveryAttempts || 0),
        actions:  !may || st === 'DELIVERED' ? ''
                  : st === 'NO_ADDRESS'
                    ? `<button class="lbtn lbtn-sm lbtn-ghost button_deliv_address"
                               data-id="${i.id}">Add address</button>`
                    : `<button class="lbtn lbtn-sm lbtn-subtle button_deliv_address"
                               data-id="${i.id}">Change address</button>
                       <button class="lbtn lbtn-sm lbtn-ghost button_deliv_retry"
                               data-id="${i.id}">Resend</button>`,
        sorting:  i.issuedAt
      };
    })
  };
});

LocalAPI.on("Dashboard/DeliveryRetry", function (p) {
  const db = Store.db;
  const inv = Auth.visibleInvoices().find(i => i.id === p.invoice_id);
  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  if (!can('issue') && !can('users'))
    return { success:false, message:'Your role cannot resend buyer copies.' };
  if (!inv.deliverTo)
    return { success:false, message:'There is no delivery address on this invoice. Add one first.' };

  const live = db.invoices.find(i => i.id === inv.id);
  const out = deliverWithFallback(live);
  live.deliveryAttempts = (live.deliveryAttempts || 0) + 1;
  live.deliveryStatus = out.ok ? 'DELIVERED' : 'FAILED';
  live.deliveredAt = out.ok ? new Date().toISOString() : live.deliveredAt || null;

  logActivity(db, {
    action: out.ok
      ? `Resent the buyer copy of ${live.number} to ${live.deliverTo}: delivered${out.via ? ' by ' + out.via + ' (fallback)' : ''}`
      : `Resent the buyer copy of ${live.number} to ${live.deliverTo}: failed again`
  });
  Store.save(db);

  return { success:true,
           message: out.ok ? (out.via ? `${live.number} reached ${out.to} by ${out.via}, the fallback method.` : `${live.number} reached ${live.deliverTo}.`)
                           : `Still not delivered. ${out.why}` };
});

LocalAPI.on("Dashboard/DeliveryRetryAll", function () {
  const db = Store.db;
  if (!can('issue') && !can('users'))
    return { success:false, message:'Your role cannot resend buyer copies.' };

  const failed = DelivReg.rows().filter(i => DelivReg.state(i) === 'FAILED');
  if (!failed.length) return { success:false, message:'No failed copies to resend.' };

  let ok = 0;
  failed.forEach(f => {
    const live = db.invoices.find(i => i.id === f.id);
    const out = deliverWithFallback(live);
    live.deliveryAttempts = (live.deliveryAttempts || 0) + 1;
    live.deliveryStatus = out.ok ? 'DELIVERED' : 'FAILED';
    if (out.ok){ live.deliveredAt = new Date().toISOString(); ok++; }
  });

  logActivity(db, {
    action:`Resent ${failed.length} buyer copies: ${ok} delivered, ${failed.length - ok} failed`
  });
  Store.save(db);

  return { success:true,
           message: ok
             ? `${ok} of ${failed.length} delivered.`
             : `None of the ${failed.length} were delivered. Check the delivery addresses.` };
});

LocalAPI.on("Dashboard/DeliveryAddress", function (p) {
  const db = Store.db;
  const inv = Auth.visibleInvoices().find(i => i.id === p.invoice_id);
  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  if (!can('issue') && !can('users'))
    return { success:false, message:'Your role cannot change a delivery address.' };

  const to = String(p.deliver_to || '').trim();
  if (!to) return { success:false, message:'Enter where the copy should go.' };

  const live = db.invoices.find(i => i.id === inv.id);
  const before = live.deliverTo || 'nowhere';
  live.deliverTo = to;
  live.deliverBy = DelivReg.CHANNELS[p.deliver_by] ? p.deliver_by : (live.deliverBy || 'EMAIL_PDF');

  /* A fresh address deserves a fresh attempt count. Carrying the old one over
     would leave a correct address permanently labelled as having failed. */
  live.deliveryAttempts = 0;
  live.deliveryStatus = 'PENDING';

  logActivity(db, {
    action:`Redirected the buyer copy of ${live.number} from ${before} to ${to}`
  });

  const out = deliveryOutcome(live);
  live.deliveryAttempts = 1;
  live.deliveryStatus = out.ok ? 'DELIVERED' : 'FAILED';
  if (out.ok) live.deliveredAt = new Date().toISOString();

  logActivity(db, {
    action: out.ok
      ? `Sent the buyer copy of ${live.number} to ${to}: delivered`
      : `Sent the buyer copy of ${live.number} to ${to}: failed`
  });
  Store.save(db);

  return { success:true,
           message: out.ok ? `Saved, and ${live.number} reached ${to}.`
                           : `Saved, but it did not get through. ${out.why}` };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  delivery(){
    const opt = (v, l) => `<option value="${v}">${l}</option>`;

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Buyer Copies</h1>
          <div class="screen_sub">
            Each buyer must receive a copy of the invoice. This screen shows whether it arrived. Resending does not issue a new invoice.
          </div>
        </div>
        <button class="lbtn lbtn-ghost d-none button_delivery_retry_all">
          <i class="bi bi-arrow-repeat"></i> Resend all failed
        </button>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Delivered</span>
            <div class="stat-value mono span_delivery_delivered">—</div>
            <span class="stat-note">
              <span class="mono span_delivery_rate">—</span> of those with a delivery address
            </span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Failed</span>
            <div class="stat-value mono" style="color:var(--red-600);"><span class="span_delivery_failed">—</span></div>
            <span class="stat-note span_delivery_failed_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Pending</span>
            <div class="stat-value mono span_delivery_pending">—</div>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">No delivery address</span>
            <div class="stat-value mono span_delivery_noaddress">—</div>
          </div></div>
        </div>
      </div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">
        <div class="d-flex flex-wrap gap-2 align-items-stretch">
          <div class="period-bar flex-grow-1" style="min-width:460px;">
            <div class="period-seg">
              <select class="form-select form-select-sm select_branch_delivery"></select>
            </div>
            <div class="period-seg">
              <select class="form-select form-select-sm select_status_delivery">
                ${opt('', 'Any state')}
                ${Object.keys(STATUS.delivery).map(k =>
                  opt(k, STATUS.delivery[k].label)).join('')}
                ${opt('NO_ADDRESS', 'No delivery address')}
              </select>
            </div>
            <div class="period-seg" style="flex:1.6 1 0;">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-search"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_searchval_delivery"
                       placeholder="Number, buyer or delivery address...">
              </div>
            </div>
          </div>
          <button class="lbtn lbtn-ghost button_repeat_delivery">
            <i class="bi bi-arrow-repeat"></i> Refresh
          </button>
        </div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table table_delivery">
            <thead>
              <tr>
                <th>INVOICE</th>
                <th>BUYER</th>
                <th>SENT TO</th>
                <th>HOW</th>
                <th>STATE</th>
                <th>ATTEMPTS</th>
                <th class="text-end">ACTION</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div></div>`;
  }
});
