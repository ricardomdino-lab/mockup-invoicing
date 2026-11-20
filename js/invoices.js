/* ============================================================
   invoices.js — the register and the document detail

   The register follows the source portal's payment_transaction screen: a
   filter row, a strip of summary cards, a DataTable, and one button that
   opens the export modal. Filters are read off the DOM at search time and
   posted, the way the portal posts them, rather than held in a state object
   here — the search is the single place that knows what is on screen.

   Issued documents are immutable. There is no edit path anywhere in this file
   by design: an error is answered with a cancellation, and the right invoice
   is then issued as a new, numbered document.
   ============================================================ */

/* The ids the last search returned, in the order it returned them. The export
   modal is handed this list, exactly as the portal hands over its serial
   numbers. */
var list_ids_invoice_transactions = [];

const InvReg = {

  /** The filter row, named for the values the source portal posts. */
  params(){
    return {
      regionval:  $(".select_region_invoice_transactions").val() || "",
      date_range: $(".input_date_range_invoice_transactions").val() || "",
      searchval:  $(".input_searchval_invoice_transactions").val() || "",
      typeval:    $(".select_type_invoice_transactions").val() || "",
      statusval:  $(".select_status_invoice_transactions").val() || "",
      transval:   $(".select_transmission_invoice_transactions").val() || ""
    };
  },

  /** Applies a posted filter set to the documents this role may see. */
  apply(p){
    p = p || {};
    const q = String(p.searchval || '').trim().toLowerCase();
    const range = Reporting.range(p.date_range);
    const branch = p.regionval && p.regionval !== 'ALL' ? p.regionval : '';

    return Auth.visibleInvoices().filter(i => {
      if (branch && i.branchId !== branch) return false;
      if (p.typeval && i.docType !== p.typeval) return false;
      if (p.statusval && i.docStatus !== p.statusval) return false;
      if (p.transval && i.transmissionStatus !== p.transval) return false;
      if (range){
        const d = Reporting.dayOf(i.issuedAt);
        if (d < range.from || d > range.to) return false;
      }
      if (q){
        const hay = [i.number, i.buyer && i.buyer.name, i.buyer && i.buyer.tin,
                     i.transmissionRef,
                     ...(i.lines || []).map(l => l.desc + ' ' + (l.sku || ''))]
                    .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  },

  /** What the filters currently narrow to, in words, for the report header. */
  label(p){
    p = p || this.params();
    const db = Store.db, bits = [];
    if (p.searchval) bits.push(`matching “${p.searchval}”`);
    if (p.regionval && p.regionval !== 'ALL'){
      const b = db.branches.find(x => x.id === p.regionval);
      if (b) bits.push(b.name);
    }
    if (p.typeval) bits.push(DOC_KIND[p.typeval] ? DOC_KIND[p.typeval].short + 's' : p.typeval);
    if (p.statusval) bits.push(STATUS.doc[p.statusval] ? STATUS.doc[p.statusval].label : p.statusval);
    if (p.transval) bits.push(STATUS.transmission[p.transval] ? STATUS.transmission[p.transval].label : p.transval);
    const range = Reporting.range(p.date_range);
    if (range) bits.push(`${fmtDate(range.from + 'T00:00:00')} to ${fmtDate(range.to + 'T00:00:00')}`);
    return bits.length
      ? 'Current filtered data: ' + bits.join(', ')
      : 'Current filtered data: no filters applied';
  }
};

/* ============================================================
   Screen wiring, on the source portal's shape: bind the hooks, then search.
   ============================================================ */

function InvoiceTransactions() {
  SelectRegion(".select_region_invoice_transactions");
  EnhanceSelect(".select_type_invoice_transactions");
  EnhanceSelect(".select_status_invoice_transactions");
  EnhanceSelect(".select_transmission_invoice_transactions");

  $(".select_region_invoice_transactions, .select_type_invoice_transactions, " +
    ".select_status_invoice_transactions, .select_transmission_invoice_transactions")
    .off("change").on("change", function () {
      InvoiceTransactionsSearch();
    });

  let delay;
  $(".input_searchval_invoice_transactions").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(delay);
        InvoiceTransactionsSearch();
      }
    })
    .on("input", function () {
      clearTimeout(delay);
      delay = setTimeout(function () {
        InvoiceTransactionsSearch();
      }, 600);
    })
    .val("");

  $(".input_date_range_invoice_transactions").off("change").on("change", function () {
    InvoiceTransactionsSearch();
  }).val("");

  $(".button_repeat_invoice_transactions").off("click").on("click", function () {
    $(".select_region_invoice_transactions").val("").trigger("change.select2");
    $(".select_type_invoice_transactions, .select_status_invoice_transactions, " +
      ".select_transmission_invoice_transactions").val("");
    InvoiceTransactions();
  });

  $(".button_generate_invoice_transactions").off("click").on("click", function () {
    ModalExportToPDF(".table_invoice_transactions", list_ids_invoice_transactions,
                     "invoice_transactions");
  });

  $(document).off("click", ".div_branch_card")
    .on("click", ".div_branch_card", function () {
      var id = $(this).data("id");
      $(".select_region_invoice_transactions").val(id).trigger("change.select2").trigger("change");
    });

  TabToggling(".tab_button_invoices_1", ".tab_content_invoices_1");
  $(".tab_button_invoices_1").off("click").on("click", function () {
    TabToggling(".tab_button_invoices_1", ".tab_content_invoices_1");
  });
  $(".tab_button_invoices_2").off("click").on("click", function () {
    TabToggling(".tab_button_invoices_2", ".tab_content_invoices_2", TransmissionScreen);
  });
  $(".tab_button_invoices_3").off("click").on("click", function () {
    TabToggling(".tab_button_invoices_3", ".tab_content_invoices_3", ManualScreen);
  });
  $(".tab_button_invoices_4").off("click").on("click", function () {
    TabToggling(".tab_button_invoices_4", ".tab_content_invoices_4", QueueScreen);
  });
  if (Nav.opts && Nav.opts.tab === 'manual') $(".tab_button_invoices_3").trigger("click");
  if (Nav.opts && Nav.opts.tab === 'queue') $(".tab_button_invoices_4").trigger("click");

  InvoiceTransactionsSearch();
}

function InvoiceTransactionsSearch() {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/InvoiceTransactionSearch",
    type: "POST",
    dataType: "json",
    data: InvReg.params(),
    success: function (res) {
      InvoiceTransactionsTotals(res.data_1);
      InvoiceTransactionsCard(res.data_2);
      InvoiceTransactionsTable(res.data_3);
      Swal.close();
    },
    error: function () {
      Swal.close();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

/** The four figures above the card, recomputed for whatever the filters show. */
function InvoiceTransactionsTotals(t) {
  $(".span_invoice_transactions_documents").text(t.documents);
  /* "Document" counts every invoice, cancelled ones included. The note
     underneath says how many of them were cancelled. */
  $(".span_invoice_transactions_documents_note").text(t.composition);
  $(".span_invoice_transactions_vat").text(t.vat);
  $(".span_invoice_transactions_unsent").text(t.unsent);
  $(".span_invoice_transactions_unsent_note")
    .text(t.unsent ? "Waiting, failed or rejected" : "All acknowledged");
  $(".span_invoice_transactions_undelivered").text(t.undelivered);
  $(".span_invoice_transactions_undelivered_note")
    .text(t.undelivered ? "Buyer copy did not arrive" : "All buyer copies delivered");
}

/** One card per branch — the portal's per-account strip, read as per-location. */
function InvoiceTransactionsCard(data) {
  var list_name_holder = $(".div_list_name_holder_invoice_transactions");
  list_name_holder.empty();

  if (!data.length) {
    list_name_holder.append(
      `<div class="fs_12 text-muted py-2">No invoices match these filters.</div>`);
    return;
  }

  data.forEach(function (val) {
    var list_name = `
      <div class="lcard lcard-hero lcard-hover drill-card div_branch_card" data-id="${val.identifier}" role="button" tabindex="0">
        <div class="lcard-body">
          <div>
            <div class="drill-title">${val.branch_name}</div>
            <div class="drill-sub">${val.rdo} · Branch ${val.branch_code}</div>
          </div>
          <div class="drill-stats">
            <div class="drill-stat">
              <span class="drill-stat-label">Invoices issued</span>
              <span class="drill-stat-value">${val.count}</span>
            </div>
            <div class="drill-stat">
              <span class="drill-stat-label">Output VAT</span>
              <span class="drill-stat-value">₱${val.vat}</span>
            </div>
            <div class="drill-stat">
              <span class="drill-stat-label">Total invoiced</span>
              <span class="drill-stat-value drill-stat-success">₱${val.amount}</span>
            </div>
          </div>
        </div>
      </div>`;

    list_name_holder.append(list_name);
  });
}

function InvoiceTransactionsTable(data) {
  list_ids_invoice_transactions = data.map(item => item.id);

  $(".table_invoice_transactions").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_invoice_transactions").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No invoices match these filters" },
    "data": data,
    "order": [[10, "DESC"]],
    "columns": [
      {
        data: "number",
        render: function (data, type, row) {
          /* Two ways in, because they answer different questions. The number
             opens the full screen — history, delivery, transmission, the
             correction trail. The eye is the source portal's own quick-look
             hook (.span_viewing_invoice), and just shows the face without
             leaving the list. */
          return `
            <span class="hyperlink fw-semibold span_view_invoice_transactions" data-id="${row.id}">
              ${data}
            </span>
            <i class="bi bi-eye ms-1 text-muted hover span_viewing_invoice hyperlink"
               data-id="${row.id}" title="Quick look at the invoice"></i>
            `;
        }
      },
      { data: "issued_at", "orderable": false, className: "mono" },
      
      { data: "buyer", "orderable": false },
      { data: "buyer_tin", "orderable": false, className: "mono" },
      { data: "branch", "orderable": false },

      { data: "gross", "orderable": false, className: "text-end num" },
      { data: "vat", "orderable": false, className: "text-end num" },
      { data: "total_due", "orderable": false, className: "text-end num" },

      { data: "doc_status", "orderable": false },
      { data: "transmission", "orderable": false },
      { data: "sorting", "visible": false }
    ]
  }));

  $(document).off("click", ".span_view_invoice_transactions")
    .on("click", ".span_view_invoice_transactions", function () {
      var id = $(this).data("id");
      if (id) Nav.go('invoices', { docId: id });
    });
}

Screens.invoices = function (opts) {
  /* The detail is a document, not a register — only the buyer-payment button to wire. */
  if (opts && opts.docId){ FeeUI.bindDoc(); return; }
  InvoiceTransactions();
};

/* ============================================================
   The search, standing in for Dashboard/InvoiceTransactionSearch.
   ============================================================ */

/* The source portal's quick-look route. It returned a data URI of a scan;
   ours returns the rendered face. Scoped through visibleInvoices so the eye
   icon cannot reach a document the role's own register would not list. */
LocalAPI.on("Dashboard/GenerateInvoiceView", function (p) {
  const inv = Auth.visibleInvoices().find(i => i.id === p.reference_no);
  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  return {
    success: true,
    title: `${(DOC_KIND[inv.docType] || DOC_KIND.INVOICE).label} ${inv.number}`,
    data: InvoiceDoc.render(inv)
  };
});

LocalAPI.on("Dashboard/InvoiceTransactionSearch", function (p) {
  const db = Store.db;
  const rows = InvReg.apply(p);

  /* Cancelled documents are excluded from the money everywhere they are
     counted, here as on the reports — a cancelled invoice is not a sale. */
  const standing = rows.filter(i => i.docStatus !== 'CANCELLED');
  const signed = (i, f) => (i.totals || {})[f] || 0;

  const branches = Auth.visibleBranches().map(b => {
    const mine = standing.filter(i => i.branchId === b.id);
    return {
      identifier:  b.id,
      branch_name: esc(b.name),
      branch_code: esc(b.code),
      rdo:         esc(b.rdo),
      count:       rows.filter(i => i.branchId === b.id).length,
      vat:         num(mine.reduce((s, i) => s + signed(i, 'vat'), 0)),
      amount:      num(mine.reduce((s, i) => s + signed(i, 'totalDue'), 0))
    };
  }).filter(b => b.count > 0);

  const money = (i, f) => {
    const v = (i.totals || {})[f] || 0;
    return num(v);
  };

  const table = rows.map(i => {
    const b = db.branches.find(x => x.id === i.branchId);
    const kind = DOC_KIND[i.docType] || DOC_KIND.INVOICE;
    const buyer = displayBuyer(i);
    const rState = retentionState(i.issuedAt);
    return {
      id:           i.id,
      number:       esc(i.number),
      issued_at:    fmtDateTime(i.issuedAt),
      doc_type:     kind.short,
      doc_abbr:     kind.abbr,
      buyer:        esc(buyer.name || '—'),
      buyer_tin:    esc(buyer.tin || '—'),
      branch:       esc(b ? b.name : '—'),
      gross:        money(i, 'gross'),
      vat:          money(i, 'vat'),
      total_due:    money(i, 'totalDue'),
      doc_status:   badge('doc', i.docStatus) + (rState !== 'LIVE'
                      ? `<div class="text-muted fs_10 mt-1">Cold archive</div>`
                      : ''),
      transmission: badge('transmission', i.transmissionStatus),
      sorting:      i.issuedAt
    };
  });

  const invoiceCount = rows.filter(i => i.docType === 'INVOICE').length;
  const kinds = invoiceCount ? [`${invoiceCount} ${invoiceCount === 1 ? 'invoice' : 'invoices'}`] : [];

  /* Cancelled is a state, not a second kind, so it hangs off the list. */
  const cancelled = rows.length - standing.length;
  const composition = kinds.join(' · ') +
    (cancelled ? `, ${cancelled} cancelled` : '');

  return {
    success: true,
    data_1: {
      documents:   rows.length,
      composition: composition || 'No records in this period',
      vat:         peso(standing.reduce((s, i) => s + signed(i, 'vat'), 0)),
      unsent:      rows.filter(i => ['QUEUED','FAILED','REJECTED'].indexOf(i.transmissionStatus) > -1).length,
      undelivered: rows.filter(i => i.deliveryStatus === 'FAILED').length
    },
    data_2: branches,
    data_3: table
  };
});

/* ============================================================
   Pages
   ============================================================ */
Object.assign(Views, {

  invoices(opts){
    if (opts && opts.docId) return Views.invoiceDetail(opts.docId);

    const opt = (value, label) => `<option value="${value}">${label}</option>`;

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Invoices</h1>
          <div class="screen_sub">
            All invoices issued from this account, including cancelled ones.
            ${can('allBranches') ? 'All branches.' : 'Your branch only.'}
            An issued invoice cannot be edited. To correct it, cancel it and issue a new invoice.
          </div>
        </div>
      </div>

      <div class="d-flex gap-2 mb-3 overflow_x_scroll">
        <div class="tab_button tab_button_invoices_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">ALL INVOICES</div>
        <div class="tab_button tab_button_invoices_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SENT TO BIR</div>
        <div class="tab_button tab_button_invoices_3 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">MANUAL INVOICES</div>
        <div class="tab_button tab_button_invoices_4 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">WAITING SALES${OutageQueue.waiting(CT && CT.id).length ? ` (${OutageQueue.waiting(CT.id).length})` : ''}</div>
      </div>

      <div class="tab_content tab_content_invoices_1">

      <div class="row g-2 mb-2">
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Invoices issued</span>
            <div class="stat-value mono span_invoice_transactions_documents">—</div>
            <span class="stat-note span_invoice_transactions_documents_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Output VAT</span>
            <div class="stat-value mono span_invoice_transactions_vat">—</div>
            <span class="stat-note">Excluding cancelled</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Waiting to be sent</span>
            <div class="stat-value mono span_invoice_transactions_unsent">—</div>
            <span class="stat-note span_invoice_transactions_unsent_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Delivery failures</span>
            <div class="stat-value mono span_invoice_transactions_undelivered">—</div>
            <span class="stat-note span_invoice_transactions_undelivered_note">&nbsp;</span>
          </div></div>
        </div>
      </div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">

        <div class="d-flex flex-wrap gap-2 align-items-stretch">
          <div class="period-bar flex-grow-1" style="min-width:460px;">
            <div class="period-seg">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-geo-alt"></i>
                </span>
                <select class="form-select border-start-0 ps-2 select_region_invoice_transactions">
                  <option value="" disabled selected>Branch...</option>
                  <option value="ALL">ALL</option>
                </select>
              </div>
            </div>
            <div class="period-seg">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted icon_date_range">
                  <i class="bi bi-calendar3"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_date_range input_date_range_invoice_transactions"
                       placeholder="Date from and date to" readonly />
              </div>
            </div>
            <div class="period-seg" style="flex:1.6 1 0;">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-search"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_searchval_invoice_transactions"
                       placeholder="Number, buyer, TIN, acknowledgment or item..." />
              </div>
            </div>
          </div>
          <button class="lbtn lbtn-ghost button_repeat_invoice_transactions">
            <i class="bi bi-arrow-repeat"></i> Refresh
          </button>
        </div>

        <div class="period-bar">
          
          <div class="period-seg">
            <select class="form-select form-select-sm select_status_invoice_transactions">
              ${opt('', 'Any status')}
              ${Object.keys(STATUS.doc).map(k => opt(k, STATUS.doc[k].label)).join('')}
            </select>
          </div>
          <div class="period-seg">
            <select class="form-select form-select-sm select_transmission_invoice_transactions">
              ${opt('', 'Any BIR status')}
              ${Object.keys(STATUS.transmission).map(k => opt(k, STATUS.transmission[k].label)).join('')}
            </select>
          </div>
        </div>

        <div class="d-flex overflow_x_scroll pb-3 gap-3 div_list_name_holder_invoice_transactions"></div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table_invoice_transactions">
            <thead>
              <tr>
                <th>INVOICE NO.</th>
                <th>DATE AND TIME ISSUED</th>
                
                <th>BUYER</th>
                <th>BUYER TIN</th>
                <th>BRANCH</th>

                <th>GROSS SALES (VAT INCL.)</th>
                <th>OUTPUT VAT</th>
                <th>TOTAL AMOUNT DUE</th>
                <th>STATUS</th>
                <th>SENT TO BIR</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div></div>

      <div class="text-center mt-3 d-flex justify-content-center gap-2">
        ${can('export') ? `
        <button class="lbtn lbtn-ghost" onclick="InvList.exportCsv()">
          <i class="bi bi-filetype-csv"></i> Export CSV
        </button>
        <button class="lbtn lbtn-accent button_generate_invoice_transactions">
          <i class="bi bi-file-earmark-arrow-down"></i> Generate to PDF
        </button>` : ''}
      </div>

      </div>

      <div class="tab_content tab_content_invoices_2 d-none">
        ${TransmissionTabBody()}
      </div>

      <div class="tab_content tab_content_invoices_3 d-none">
        ${ManualTabBody()}
      </div>

      <div class="tab_content tab_content_invoices_4 d-none">
        ${QueueTabBody()}
      </div>`;
  },

  /* ---------- Document detail ---------- */
  invoiceDetail(docId){
    const db = Store.db;
    const inv = db.invoices.find(i => i.id === docId);
    if (!inv) return `<div class="empty">
      <div class="empty-ico"><i class="bi bi-file-earmark-x"></i></div>
      <div class="empty-title">Document not found</div>
      <button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('invoices')">Back to the register</button></div>`;

    /* Branch scoping applies to a direct link too, not just the list */
    if (!can('allBranches') && CU.branchId && inv.branchId !== CU.branchId){
      return `<div class="empty">
        <div class="empty-ico"><i class="bi bi-signpost-split"></i></div>
        <div class="empty-title">Outside your branch</div>
        <div class="empty-sub">This document belongs to another branch. Your role is scoped to
        ${esc((db.branches.find(b => b.id === CU.branchId) || {}).name || 'your branch')}.</div>
        <button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('invoices')">Back to the register</button></div>`;
    }

    const b = db.branches.find(x => x.id === inv.branchId);
    const kind = DOC_KIND[inv.docType] || DOC_KIND.INVOICE;
    const year = new Date(inv.issuedAt).getFullYear();
    const series = db.series[`${kind.series}:${inv.tenantId}`] || { issued:[], retired:[], next:1 };
    const seq = seqOf(inv.number);

    const acts = (db.activity || []).filter(a =>
      a.tenantId === inv.tenantId && a.action && a.action.indexOf(inv.number) > -1);

    const rState = retentionState(inv.issuedAt);

    return `
      <div class="screen_head">
        <div>
          <div class="crumb">
            <button class="lbtn lbtn-link" onclick="Nav.go('invoices')">← Register</button>
          </div>
          <h1 class="screen_title mono">${esc(inv.number)}</h1>
          <div class="screen_sub">
            ${esc(kind.label)} · ${esc(b ? b.name : '—')} · issued ${fmtDateTime(inv.issuedAt)}
          </div>
        </div>
        <div class="d-flex align-items-center gap-2">
          ${badge('doc', inv.docStatus)}
          ${rState !== 'LIVE' ? badge('retention', rState) : ''}
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="InvoiceDoc.print('${inv.id}')">
            <i class="bi bi-printer me-1"></i> Print
          </button>
          ${can('correct') && rState === 'LIVE' ? `<button class="lbtn lbtn-sm lbtn-ghost" onclick="Nav.go('corrections')">
            <i class="bi bi-arrow-counterclockwise me-1"></i> Correct
          </button>` : ''}
        </div>
      </div>

      ${inv.docStatus === 'CANCELLED' ? `
      ${Callout('danger', `<strong>Cancelled ${fmtDateTime(inv.cancelledAt)}.</strong>
        Reason: ${esc(InvoiceDoc.REASONS[inv.cancelReason] || inv.cancelReason)}.
        ${inv.cancelNote ? esc(inv.cancelNote) : ''}
        The number <span class="mono">${esc(inv.number)}</span> is retired and will never be reissued.`, {style:'margin-bottom:18px;'})}` : ''}

      ${rState === 'ARCHIVED' ? Callout('info', `<strong>In cold archive.</strong> Issued ${fmtDateTime(inv.issuedAt)}, more than
        ${RETENTION.LIVE_YEARS} years ago. The record is unchanged and can still be retrieved as issued. EPI keeps it until the BIR confirms in writing that migration to its systems is complete. Cancellation is no longer offered.`, {icon:'bi-archive', style:'margin-bottom:18px;'})
      : ''}

      <div class="detail-grid">
        <div class="doc-stage">${InvoiceDoc.render(inv)}</div>

        <aside class="d-flex flex-column gap-3">
          <div class="lcard"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold mb-3">LIFECYCLE</strong>
            <ul class="tl">
              <li class="tl-done">
                <div class="tl-title">Issued</div>
                <div class="tl-meta">${fmtDateTime(inv.issuedAt)}<br>
                  ${esc(inv.issuedBy || '—')} · ${esc(inv.issuedVia || '—')}</div>
              </li>
              <li class="tl-${inv.deliveryStatus === 'DELIVERED' ? 'done' : inv.deliveryStatus === 'FAILED' ? 'fail' : 'wait'}">
                <div class="tl-title">Buyer copy ${badge('delivery', inv.deliveryStatus)}</div>
                <div class="tl-meta">
                  ${inv.deliveryAttempts ? `${inv.deliveryAttempts} attempt${inv.deliveryAttempts === 1 ? '' : 's'}` : 'Not attempted'}
                  ${inv.deliveryStatus === 'FAILED' ? '<br>Address rejected the message. Resend from the buyer record.' : ''}
                  ${inv.deliverTo
                    ? `<br>Sent to ${esc(inv.deliverTo)}`
                    : '<br>No delivery address on file. The buyer took a printed copy.'}
                </div>
              </li>
              <li class="tl-${inv.transmissionStatus === 'TRANSMITTED' ? 'done' : ['FAILED','REJECTED'].indexOf(inv.transmissionStatus) > -1 ? 'fail' : 'wait'}">
                <div class="tl-title">BIR transmission ${badge('transmission', inv.transmissionStatus)}</div>
                <div class="tl-meta">
                  ${inv.transmissionRef
                    ? `Acknowledgment <span class="mono">${esc(inv.transmissionRef)}</span>${inv.transmittedAt ? ` · ${esc(fmtDateTime(inv.transmittedAt))}` : ''}`
                    : (inv.transmissionError ? esc(inv.transmissionError) : 'No acknowledgment yet')}
                  ${(() => {
                                        const att = transmissionAttempts(inv), dl = delayInfo(inv), L = limitInfo(inv);
                    return (L.state === 'NA' ? '' : `<br><span class="fs_12 ${L.over ? 'text-danger' : 'text-muted'}">Send by ${esc(fmtDate(L.by + 'T12:00:00+08:00'))}${L.state === 'OVERDUE' ? ', past the limit' : L.state === 'LATE' ? ', sent late' : ''}</span>`) + (dl.delayed ? `<br>Waited ${esc(ResReg.hLabel(dl.hours))}${dl.label ? ` · ${esc(dl.label)}` : ''}` : '') +
                      (att.length > 1 || (att.length === 1 && att[0].result !== 'ACKNOWLEDGED')
                        ? '<br>' + att.map(a => `<span class="fs_12 text-muted">${esc(fmtDateTime(a.at))} · ${esc(a.result.toLowerCase())}${a.detail && a.result !== 'ACKNOWLEDGED' ? ' · ' + esc(a.detail) : ''}</span>`).join('<br>')
                        : '');
                  })()}
                </div>
              </li>
            </ul>
            ${Callout('info', `Transmission is simulated. RR 26-2025 puts electronic sales reporting
              on hold until the BIR establishes a system and issues separate regulations.`, {style:'margin-top:6px;'})}
          </div></div>

          <div class="lcard"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold mb-3">SERIES POSITION</strong>
            <dl class="dl dl-tight">
              <dt>Series</dt><dd class="mono">${esc(CT.seriesPrefix)}${kind.abbr === 'INV' ? '' : esc(kind.abbr)} <span class="text-muted fw-normal">all branches</span></dd>
              <dt>Sequence</dt><dd class="mono">${String(seq).padStart(7,'0')} of ${String(Math.max(1, series.next - 1)).padStart(7,'0')}</dd>
              <dt>Issued in series</dt><dd>${series.issued.length}</dd>
              <dt>Retired</dt><dd>${series.retired.length ? `<span class="lbadge lbadge-red">${series.retired.length}</span>` : '0'}</dd>
            </dl>
          </div></div>

          ${FeeViews.docPanel(inv)}

          <div class="lcard"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold mb-3">IMMUTABILITY</strong>
            ${Callout('ok', `<strong>An issued invoice cannot be edited.</strong> It cannot be changed, renumbered or deleted. To correct it, cancel it and issue a new invoice.`, {icon:'bi-lock-fill'})}
          </div></div>

          <div class="lcard"><div class="lcard-body">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <div>
                <strong class="fs_13 text-secondary fw-bold d-block">STRUCTURED DATA</strong>
                <span class="fs_11 text-muted">What is transmitted, not what is printed</span>
              </div>
              <button class="lbtn lbtn-link" onclick="Views.showPayload('${inv.id}')">View</button>
            </div>
            <div class="fs_12 text-muted">RR 11-2025 requires the invoice data to be structured and
            machine-readable. The printed copy is a rendering of this data, never the source record.</div>
          </div></div>

          ${acts.length ? `
          <div class="lcard"><div class="lcard-body">
            <strong class="fs_13 text-secondary fw-bold mb-3">AUDIT TRAIL</strong>
            ${acts.map(a => `
              <div class="act">
                <div class="act-line">${esc(a.action)}</div>
                <div class="act-meta">${esc(a.actorName)} · ${esc(ROLES[a.role] ? ROLES[a.role].short : a.role)} · ${fmtDateTime(a.at)}</div>
              </div>`).join('')}
          </div></div>` : ''}

          <div class="lcard"><div class="lcard-body">
            <div class="fs_12 text-muted">
              The certificate numbers are illustrative. The BIR accreditation program
              for electronic invoicing providers has not opened yet; the real numbers
              replace them once issued.
            </div>
          </div></div>
        </aside>
      </div>`;
  },

  showPayload(docId){
    const db = Store.db;
    const inv = db.invoices.find(i => i.id === docId);
    const t = db.tenants.find(x => x.id === inv.tenantId);
    const b = db.branches.find(x => x.id === inv.branchId);

    const payload = {
      documentType: inv.docType,
      documentNumber: inv.number,
      issuedAt: inv.issuedAt,
      status: inv.docStatus,
      currency: inv.currency,
      seller: {
        registeredName: t.name, tradeName: t.tradeName,
        tin: t.tin, branchCode: b ? b.code : '000',
        pti: t.pti || null,
        rdo: b ? b.rdo : t.jurisdiction,
        address: b ? b.address : t.address,
        vatStatus: t.vatStatus
      },
      buyer: (() => {
        const buyer = displayBuyer(inv);
        return { name: buyer.name || null, tin: buyer.tin || null, address: buyer.address || null };
      })(),
      retention: retentionState(inv.issuedAt),
      scpwd: inv.scpwd || null,
      lines: (inv.lines || []).map((l, n) => ({
        lineNumber: n + 1, description: l.desc, sku: l.sku || null,
        quantity: l.qty, unit: l.unit, unitPriceVatInclusive: l.unitPrice,
        amountVatInclusive: round2(l.qty * l.unitPrice),
        taxTreatment: l.treatment, scpwdCovered: !!l.scEligible
      })),
      taxSummary: {
        grossSales: inv.totals.gross,
        discount: inv.totals.discount,
        netOfDiscount: inv.totals.netSales,
        vatableSales: inv.totals.vatableSales,
        vatAmount: inv.totals.vat,
        vatExemptSales: inv.totals.exempt,
        zeroRatedSales: inv.totals.zero,
        scpwdDiscount: inv.totals.scDiscount,
        totalAmountDue: inv.totals.totalDue,
        ewt: inv.totals.hasEwt
          ? { rate: inv.totals.ewtRate, base: inv.totals.ewtBase, amount: inv.totals.ewtAmount,
              netCollectible: inv.totals.netCollectible }
          : null
      },
      payment: { status: inv.paymentStatus || null, method: inv.paymentMethod || null, terms: inv.terms || null },
      issuance: { by: inv.issuedBy, via: inv.issuedVia, verificationCode: inv.keycode },
      system: { product: SYSTEM.product, version: SYSTEM.version },
      transmission: { status: inv.transmissionStatus, acknowledgment: inv.transmissionRef || null }
    };

    UI.openModal(`Structured data: ${inv.number}`,
      `<p class="small muted">This is the document as the reporting system sees it. Field names
       are illustrative and will follow the BIR schema once published.</p>
       <pre class="code">${esc(JSON.stringify(payload, null, 2))}</pre>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>`, 'lg');
  }
});

/* ============================================================
   What this register can export.

   `all()` is deliberately the unfiltered visible set: a period summary is a
   tax figure, and one computed over a search box would not reconcile to the
   return. `rows(ids)` is the opposite — it lists exactly what is on screen,
   in the order it is on screen, which is what "current filtered data" means.
   ============================================================ */
Reporting.source('invoice_transactions', {
  title: 'Invoices',

  all(){ return Auth.visibleInvoices(); },

  rows(ids){
    const by = new Map(Auth.visibleInvoices().map(i => [i.id, i]));
    return ids.map(id => by.get(id)).filter(Boolean);
  },

  periodLabel(){ return InvReg.label(); },

  columns(){
    const db = Store.db;
    const branch = i => (db.branches.find(x => x.id === i.branchId) || {}).name || '—';
    const kind   = i => (DOC_KIND[i.docType] || DOC_KIND.INVOICE).short;
    const money  = f => i => {
      const v = (i.totals || {})[f] || 0;
      return num(v);
    };

    return [
      { label:'Invoice Number',   value: i => i.number },
      { label:'Date and Time Issued',value: i => fmtDateTime(i.issuedAt) },
      { label:'Document Type',     value: kind },
      { label:'Buyer',             value: i => displayBuyer(i).name || '—' },
      { label:'Buyer TIN',         value: i => displayBuyer(i).tin || '—' },
      { label:'Branch',            value: branch },
      { label:'Gross Sales (VAT incl.)', value: money('gross'),  align:'n' },
      { label:'Discounts',         value: money('discount'),     align:'n' },
      { label:'VATable Sales',     value: money('vatableSales'), align:'n' },
      { label:'Output VAT',        value: money('vat'),          align:'n' },
      { label:'VAT-Exempt Sales',  value: money('exempt'),       align:'n' },
      { label:'Zero-Rated Sales',  value: money('zero'),         align:'n' },
      { label:'Statutory Discount',   value: money('scDiscount'),   align:'n' },
      { label:'Total Amount Due',  value: money('totalDue'),     align:'n' },
      { label:'Creditable Withholding Tax',   value: money('ewtAmount'),    align:'n' },
      { label:'Net Collectible',   value: i => num(i.totals ? (i.totals.netCollectible || i.totals.totalDue) : 0), align:'n' },
      { label:'Status',   value: i => (STATUS.doc[i.docStatus] || {}).label || i.docStatus },
      { label:'Transmission',      value: i => (STATUS.transmission[i.transmissionStatus] || {}).label || i.transmissionStatus },
      { label:'Acknowledgment',    value: i => i.transmissionRef || '—' },
      { label:'Issued Via',        value: i => i.issuedVia || '—' },
      { label:'Retention',         value: i => (STATUS.retention[retentionState(i.issuedAt)] || {}).label || 'Online' }
    ];
  }
});

/* ---------- Export ---------- */
const InvList = {
  exportCsv(){
    const rows = InvReg.apply(InvReg.params());
    const db = Store.db;
    const head = ['Number','Type','Issued','Branch','Buyer','Buyer TIN',
                  'Gross Sales (VAT incl.)','Discount','VATable Sales','Output VAT',
                  'VAT-Exempt','Zero-Rated','Statutory Discount','Total Amount Due',
                  'Creditable Withholding Tax','Net Collectible',
                  'Status','Transmission','Acknowledgment','Retention'];
    const body = rows.map(i => {
      const b = db.branches.find(x => x.id === i.branchId);
      const buyer = displayBuyer(i);
      return [i.number, i.docType, i.issuedAt, b ? b.name : '', buyer.name || '',
              buyer.tin || '', i.totals.gross, i.totals.discount,
              i.totals.vatableSales, i.totals.vat, i.totals.exempt, i.totals.zero,
              i.totals.scDiscount || 0, i.totals.totalDue,
              i.totals.ewtAmount || 0, i.totals.netCollectible || i.totals.totalDue,
              i.docStatus, i.transmissionStatus,
              i.transmissionRef || '', retentionState(i.issuedAt)];
    });
    const csv = [head, ...body].map(r => r.map(c => {
      const s = String(c === null || c === undefined ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    }).join(',')).join('\n');

    logActivity(db, { action:`Exported ${rows.length} documents to CSV` });
    Store.save(db);

    UI.openModal('Export: CSV',
      `<p class="small muted">${rows.length} document${rows.length === 1 ? '' : 's'} matching the current filters.
       Select the text below and copy it. A real deployment streams the file directly.</p>
       <pre class="code" style="max-height:340px;">${esc(csv)}</pre>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>`, 'lg');
  }
};
