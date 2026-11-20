/* ============================================================
   reports.js — Reports

   Two things live here because they answer the same question at two
   distances, and separating them into two screens would hide that.

     - A summary report cuts a stretch of time into periods and adds up the
       tax ladder across each one. It is what a bookkeeper takes into a return.

     - A reading is one branch, one day. X while the day is running, Z when it
       is closed. It is what a branch keeps in its file.

   Both are read-only views of documents that already exist. Nothing here can
   change a figure — a report that could edit what it reports would be worth
   nothing to anyone.

   Two honesty notes, both on the screen and not only in this comment:

     - "Gross sales" here is VAT-inclusive, because that is what the buyer was
       charged and what the invoice says. BIR Form 2550Q asks for gross sales
       VAT-EXCLUSIVE. Reading one number into the other box overstates sales by
       twelve per cent, so the screen states both and says which is which.

     - X and Z readings come from the cash-register world, where the Z closes
       the day and resets the counters. Nothing resets here, because nothing
       accumulates in a counter that could be reset — the documents themselves
       are the record, and they are still there tomorrow. What a Z reading does
       in this system is take a snapshot and keep it, which is the part that
       actually matters: it is evidence of what the day looked like when it was
       closed, and it does not change afterwards even if a document from that
       day is cancelled later.
   ============================================================ */

const RepReg = {

  GRAINS: {
    day:     { label:'Daily'     },
    week:    { label:'Weekly'    },
    month:   { label:'Monthly'   },
    quarter: { label:'Quarterly' },
    year:    { label:'Annual'    }
  },

  /* A daily report over a long range runs to hundreds of rows and tells nobody
     anything they could not read faster at a coarser grain. */
  MAX_DAILY_DAYS: 92,

  /** Everything issued, optionally narrowed to one branch. */
  rows(branchId){
    const all = Auth.visibleInvoices().filter(i => i.docStatus !== 'DRAFT');
    return branchId && branchId !== 'ALL'
      ? all.filter(i => i.branchId === branchId)
      : all;
  },

  params(){
    return {
      branch: $(".select_branch_reports").val() || "",
      grain:  $(".select_grain_reports").val() || "month",
      range:  $(".input_date_range_reports").val() || ""
    };
  },

  /** What the built report covers, for the page and for the PDF header. */
  label(){
    const p = this.params();
    const r = Reporting.range(p.range);
    if (!r) return 'All available records';
    return `${fmtDate(r.from + 'T00:00:00')} – ${fmtDate(r.to + 'T00:00:00')}`;
  },

  /* The ids in the report as built, so the export modal's per-document option
     has something to offer. Set by the search, read by the modal. */
  ids: [],

  /**
   * The figures a VAT return actually asks for.
   *
   * The ladder on screen is stated the way the invoice states it: gross is
   * VAT-inclusive. Form 2550Q is not — its "Gross Sales" boxes are net of VAT.
   * Deriving the return's figures here, beside the invoice figures, is the
   * whole point of putting a reporting screen in an invoicing system: the two
   * views of the same period reconcile, and the reader can see how.
   */
  returnView(t){
    const vatExclusive = round2(t.vatableSales + t.exempt + t.zero - t.scDiscount);
    return {
      vatableSales: t.vatableSales,
      vat:          t.vat,
      exempt:       t.exempt,
      zero:         t.zero,
      scDiscount:   t.scDiscount,
      vatExclusive
    };
  },

  /* ---------- readings ---------- */

  /**
   * One branch, one day.
   *
   * The accumulated grand total is the running net total of everything that
   * branch has issued since it went live — the figure a Z reading opens and
   * closes with. Beginning plus the day equals ending, always, because both
   * ends are computed the same way from the same documents.
   */
  reading(branchId, date, kind){
    /* Resolved against the branches this role can see, not against the whole
       table. Looking it up in the table would hand a branch manager a reading
       of another branch showing nothing issued, which is worse than a refusal:
       it is a wrong answer that looks like a right one. */
    const branch = Auth.visibleBranches().find(b => b.id === branchId);
    if (!branch) return null;

    const all    = this.rows(branchId);
    const before = all.filter(i => Reporting.dayOf(i.issuedAt) <  date);
    const day    = all.filter(i => Reporting.dayOf(i.issuedAt) === date);

    const beginning = Reporting.summarize(before).totalDue;
    const totals    = Reporting.summarize(day);

    return {
      kind,
      tenantId:   CU.tenantId,
      branchId:   branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      date,
      takenAt:    new Date().toISOString(),
      takenBy:    CU.name,
      takenByRole: CR,
      beginning,
      ending:     round2(beginning + totals.totalDue),
      totals,
      cancelledNumbers: day.filter(i => i.docStatus === 'CANCELLED').map(i => i.number)
    };
  },

  /** Recorded Z readings, newest first. */
  readings(branchId){
    const db = Store.db;
    return (db.readings || [])
      .filter(r => r.tenantId === CU.tenantId)
      .filter(r => !branchId || branchId === 'ALL' || r.branchId === branchId)
      .filter(r => can('allBranches') || !CU.branchId || r.branchId === CU.branchId)
      .sort((a, b) => (b.date + b.takenAt).localeCompare(a.date + a.takenAt));
  },

  /** The next Z number for a branch, continuing wherever that branch left off. */
  nextZ(branchId){
    const taken = (Store.db.readings || [])
      .filter(r => r.branchId === branchId && r.kind === 'Z')
      .map(r => r.zNumber || 0);
    return (taken.length ? Math.max.apply(null, taken) : 0) + 1;
  },

  /* A reading is an act on the day's record, so the roles that may touch
     documents at all may take one. An auditor may read every reading in the
     file and take none — which is most of what makes them evidence. */
  mayTakeReadings(){
    return can('issue') || !!permValue('correct');
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function ReportsScreen() {
  const branches = Auth.visibleBranches().map(b => ({ value:b.id, text:`${b.name} (${b.code})` }));
  DisplaySelect2(branches, ".select_branch_reports", true, "All branches", "");
  DisplaySelect2(branches, ".select_branch_reading", false, "", "");
  EnhanceSelect(".select_grain_reports");

  /* A reading is always of one branch, so the picker opens on one rather than
     on nothing: the branch this person works at, or the first they can see. */
  const preferred = CU.branchId || (branches[0] && branches[0].value);
  if (preferred) $(".select_branch_reading").val(preferred).trigger("change.select2");

  /* Our own picker rather than the shared .input_date_range. That one clamps
     to two months, which is right for a register that lists every document and
     wrong here: a quarterly or annual summary is a handful of rows however long
     the range is, and a year is the most useful thing to ask for. */
  $(".input_date_range_reports").daterangepicker({
    autoUpdateInput: false,
    maxDate: moment(),
    locale: { cancelLabel: 'Clear' },
    ranges: {
      'This month':   [moment().startOf('month'), moment()],
      'Last month':   [moment().subtract(1, 'month').startOf('month'),
                       moment().subtract(1, 'month').endOf('month')],
      'This quarter': [moment().startOf('quarter'), moment()],
      'Year to date': [moment().startOf('year'), moment()]
    }
  }).off("apply.daterangepicker cancel.daterangepicker")
    .on("apply.daterangepicker", function (ev, picker) {
      $(this).val(picker.startDate.format("MM/DD/YYYY") + ' - ' +
                  picker.endDate.format("MM/DD/YYYY"));
      ReportsSearch();
    })
    .on("cancel.daterangepicker", function () { $(this).val(""); ReportsSearch(); });

  /* Opens on the current month, so the screen has a report on it rather than an
     empty frame and an instruction. */
  $(".input_date_range_reports").val(
    moment().startOf('month').format("MM/DD/YYYY") + ' - ' + moment().format("MM/DD/YYYY"));

  $(".select_grain_reports").off("change").on("change", ReportsSearch);
  $(".select_branch_reports").off("select2:select select2:clear")
    .on("select2:select select2:clear", ReportsSearch);
  $(".button_repeat_reports").off("click").on("click", ReportsSearch);

  $(".button_generate_reports").off("click").on("click", function () {
    ModalExportToPDF(".table_reports", RepReg.ids, "reports");
  });

  /* --- readings tab --- */
  TabToggling(".tab_button_reports_1", ".tab_content_reports_1");
  $(".tab_button_reports_1").off("click").on("click", function () {
    TabToggling(".tab_button_reports_1", ".tab_content_reports_1");
  });
  $(".tab_button_reports_2").off("click").on("click", function () {
    TabToggling(".tab_button_reports_2", ".tab_content_reports_2", ReadingList);
  });

  $(".tab_button_reports_3").off("click").on("click", function () {
    TabToggling(".tab_button_reports_3", ".tab_content_reports_3", function () { ListsReg.bind(); ListsReg.renderSales(); });
  });
  $(".tab_button_reports_4").off("click").on("click", function () {
    TabToggling(".tab_button_reports_4", ".tab_content_reports_4", function () { ListsReg.renderSeries(); });
  });

  $(".button_reading_x").off("click").on("click", function () { ReadingTake('X'); });
  $(".button_reading_z").off("click").on("click", function () {
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Close the day and save the Z reading?</span>
       <span class="fs_14 text-muted">The reading is saved and cannot be changed, even if a document from that day is cancelled later. No document is affected.</span>`,
      function () { ReadingTake('Z'); }, null, 'Close day');
  });

  $(document).off("click", ".button_reading_open")
    .on("click", ".button_reading_open", function () {
      ReadingShow($(this).data("id"));
    });

  $(document).off("click", ".button_reading_pdf")
    .on("click", ".button_reading_pdf", function () { ReadingPdf(); });

  ReportsSearch();
}

Screens.reports = function () { ReportsScreen(); };

/* ---------- summary tab ---------- */

function ReportsSearch() {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ReportBuild",
    method: "POST",
    dataType: "json",
    data: RepReg.params(),
    success: function (res) {
      Swal.close();
      if (!res.success){
        RepReg.ids = [];
        $(".div_reports_result").addClass("d-none");
        $(".div_reports_empty").removeClass("d-none").find(".span_reports_empty").text(res.message);
        return;
      }
      RepReg.ids = res.data_4 || [];
      $(".div_reports_empty").addClass("d-none");
      $(".div_reports_result").removeClass("d-none");
      ReportsTotals(res.data_1);
      ReportsReturn(res.data_3);
      ReportsTable(res.data_2);
      $(".span_reports_covering").text(res.label);
    }
  });
}

function ReportsTotals(t) {
  $(".span_reports_documents").text(t.documents);
  $(".span_reports_documents_note").text(
    t.cancelled ? `${t.cancelled} of them cancelled` : 'None cancelled');
  $(".span_reports_gross").text(peso(t.gross));
  $(".span_reports_vat").text(peso(t.vat));
  $(".span_reports_total").text(peso(t.totalDue));
}

function ReportsReturn(r) {
  $(".span_return_vatable").text(peso(r.vatableSales));
  $(".span_return_vat").text(peso(r.vat));
  $(".span_return_exempt").text(peso(r.exempt));
  $(".span_return_zero").text(peso(r.zero));
  $(".span_return_scpwd").text('(' + peso(r.scDiscount) + ')');
  $(".span_return_exclusive").text(peso(r.vatExclusive));
  $(".tr_return_scpwd").toggleClass("d-none", !r.scDiscount);
}

function ReportsTable(data) {
  $(".table_reports").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_reports").DataTable({
    "language": { "emptyTable": "Nothing was issued in this period" },
    "dom": "rt",
    "searching": false,
    "data": data,
    "destroy": true,
    "info": false,
    "scrollX": true,
    "autoWidth": false,
    "paging": false,
    "ordering": false,
    "columns": [
      { data: "period" },
      { data: "documents", className: "text-center" },
      { data: "cancelled", className: "text-center" },
      { data: "gross",        className: "text-end num" },
      { data: "discount",     className: "text-end num" },
      { data: "vatableSales", className: "text-end num" },
      { data: "vat",          className: "text-end num" },
      { data: "exempt",       className: "text-end num" },
      { data: "zero",         className: "text-end num" },
      { data: "scDiscount",   className: "text-end num" },
      { data: "totalDue",     className: "text-end num fw-semibold" }
    ]
  });
}

/* ---------- readings tab ---------- */

/* The reading currently on screen, so Save as PDF has something to render
   without recomputing it and risking a different answer. */
let CURRENT_READING = null;

function ReadingTake(kind) {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ReadingTake",
    method: "POST",
    dataType: "json",
    data: {
      kind: kind,
      branch: $(".select_branch_reading").val() || "",
      date:   $(".input_date_reading").val() || ""
    },
    success: function (res) {
      Swal.close();
      if (!res.success){ DisplayDelaySwal("info", "", res.message); return; }
      ReadingPaint(res.data_1, res.message);
      if (res.recorded) ReadingList();
    }
  });
}

function ReadingList() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ReadingList",
    method: "POST",
    dataType: "json",
    data: { branch: $(".select_branch_reading").val() || "" },
    success: function (res) {
      if (!res.success) return;
      $(".table_readings").addClass("tbl").removeClass("table-hover table-borderless table-striped");
      $(".table_readings").DataTable({
        "language": { "emptyTable": "No Z reading has been taken on this account yet" },
        "dom": "rtp",
        "searching": false,
        "data": res.data_1,
        "destroy": true,
        "info": false,
        "autoWidth": false,
        "paging": true,
        "pageLength": 5,
        "order": [[8, "DESC"]],
        "columns": [
          { data: "z", className: "mono" },
          { data: "date", className: "mono" },
          { data: "branch" },
          { data: "documents", className: "text-center" },
          { data: "sales",     className: "text-end num" },
          { data: "ending",    className: "text-end num" },
          { data: "taken" },
          { data: "actions",   className: "text-end", orderable: false },
          { data: "sorting",   visible: false }
        ]
      });
    }
  });
}

function ReadingShow(id) {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ReadingOpen",
    method: "POST",
    dataType: "json",
    data: { reading_id: id },
    success: function (res) {
      if (!res.success){ DisplayDelaySwal("info", "", res.message); return; }
      ReadingPaint(res.data_1, res.message);
      $('html, body').animate({ scrollTop: $(".div_reading_paper").offset().top - 90 }, 200);
    }
  });
}

function ReadingPaint(r, note) {
  CURRENT_READING = r;
  $(".div_reading_paper").removeClass("d-none").html(ReadingMarkup(r, note));
}

/** The reading itself, laid out the way a reading is laid out: what it opened
    with, what happened, what it closed with. */
function ReadingMarkup(r, note) {
  const t = r.totals;
  const line = (k, v, cls) =>
    `<div class="d-flex justify-content-between gap-3 py-1 ${cls || ''}">
       <span class="text-muted">${esc(k)}</span>
       <span class="mono ${cls ? '' : 'text-dark'}">${v}</span>
     </div>`;

  return `
    <div class="lcard receipt-card"><div class="lcard-body">
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
        <div>
          <div class="fs_11 text-uppercase fw-bold text-muted">
            ${r.kind === 'Z' ? 'Z Reading: day closed'
              : (r.date === Reporting.ymd(new Date())
                  ? 'X Reading: day still running'
                  : 'X Reading: a past day, not recorded')}
          </div>
          <div class="fs_20 fw-bold" style="font-family:var(--font-display);">${esc(r.branchName)} · ${fmtDate(r.date + 'T00:00:00')}</div>
          <div class="fs_12 text-muted mono">
            ${esc(CT.name)} · TIN ${esc(CT.tin)}-${esc(r.branchCode)}
            ${r.kind === 'Z' ? ` · Reading No. ${String(r.zNumber).padStart(4, '0')}` : ''}
          </div>
        </div>
        <button class="lbtn lbtn-sm lbtn-ghost fs_11 button_reading_pdf">
          <i class="bi bi-file-earmark-arrow-down me-1"></i> Save as PDF
        </button>
      </div>

      ${note ? Callout('info', esc(note), {cls:'mb-3'}) : ''}

      <div class="row g-3">
        <div class="col-12 col-lg-6">
          <div class="fs_11 text-uppercase fw-bold text-muted mb-1">Accumulated grand total</div>
          <div class="border rounded p-3 fs_13">
            ${line('Beginning balance', peso(r.beginning))}
            ${line('Sales for the day', peso(t.totalDue), 'fw-semibold text-success')}
            <div class="hr_gray_200 my-2"></div>
            ${line('Ending balance', peso(r.ending), 'fw-bold')}
          </div>
          <div class="fs_11 text-muted mt-2">
            The running net total this branch has issued since activation, after credit
            notes and excluding cancelled documents. Nothing is reset by a reading.
          </div>
        </div>

        <div class="col-12 col-lg-6">
          <div class="fs_11 text-uppercase fw-bold text-muted mb-1">The day</div>
          <div class="border rounded p-3 fs_13">
            ${line('Gross sales (VAT incl.)', peso(t.gross))}
            ${line('Less discounts', '(' + peso(t.discount) + ')')}
            ${line('VATable sales', peso(t.vatableSales))}
            ${line('Output VAT', peso(t.vat))}
            ${line('VAT-exempt sales', peso(t.exempt))}
            ${line('Zero-rated sales', peso(t.zero))}
            ${t.scDiscount ? line('Less statutory discount', '(' + peso(t.scDiscount) + ')') : ''}
            <div class="hr_gray_200 my-2"></div>
            ${line('Total invoiced', peso(t.totalDue), 'fw-bold')}
          </div>
        </div>
      </div>

      <div class="hr_gray_200 my-3"></div>

      <div class="row g-3 fs_13">
        <div class="col-6 col-lg-3">
          <div class="fs_11 text-uppercase fw-bold text-muted">Invoices issued</div>
          <div class="fs_18 fw-bold">${t.documents}</div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="fs_11 text-uppercase fw-bold text-muted">Cancelled</div>
          <div class="fs_18 fw-bold ${t.cancelled ? 'text-danger' : ''}">${t.cancelled}</div>
        </div>
        <div class="col-12 col-lg-6">
          <div class="fs_11 text-uppercase fw-bold text-muted">Series covered</div>
          <div class="mono fs_13">
            ${t.firstNumber ? `${esc(t.firstNumber)} → ${esc(t.lastNumber)}` :
              '<span class="text-muted">Nothing was issued on this day</span>'}
          </div>
        </div>
      </div>

      ${r.cancelledNumbers && r.cancelledNumbers.length ? `
        ${Callout('warn', `<strong>Cancelled on this day:</strong>
          <span class="mono">${r.cancelledNumbers.map(esc).join(', ')}</span>.
          Their numbers are retired and not reused. They are excluded from the figures above and remain in the register.`, {cls:'mt-3'})}` : ''}

      <div class="fs_11 text-muted mt-3 mono">
        Taken by ${esc(r.takenBy)} · ${esc(ROLES[r.takenByRole] ? ROLES[r.takenByRole].short : r.takenByRole)}
        · ${fmtDateTime(r.takenAt)}
      </div>
    </div></div>`;
}

function ReadingPdf() {
  if (!CURRENT_READING) return;
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ReadingPdf",
    method: "POST",
    dataType: "json",
    contentType: "application/json; charset=utf-8",
    data: JSON.stringify({ reading: CURRENT_READING })
  }).done(function (res) {
    Swal.close();
    if (!res || !res.success){ DisplaySwal("info", "", (res && res.message) || "No PDF available."); return; }
    const pdf = res.pdf_list[0];
    const blob = base64ToBlob(String(pdf.base64).replace(/^data:application\/pdf;base64,/, ""),
                              "application/pdf");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = pdf.pdf_title;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }).fail(function () {
    Swal.close();
    DisplaySwal("Error", "", "Failed to generate PDF");
  });
}

/* ============================================================
   The reading on paper. Same header and footer as every other report, so a
   reading filed beside a summary looks like it came from the same system.
   ============================================================ */

Reporting.paper.reading = function (r) {
  const t = r.totals;
  const row = (k, v, bold) =>
    `<tr><td${bold ? ' style="font-weight:bold;"' : ''}>${esc(k)}</td>
         <td class="n"${bold ? ' style="font-weight:bold;"' : ''}>${v}</td></tr>`;

  return `
    ${this.header(
        r.kind === 'Z' ? `Z Reading No. ${String(r.zNumber).padStart(4, '0')}` : 'X Reading',
        `${r.branchName} · ${fmtDate(r.date + 'T00:00:00')}`,
        `${r.branchName} (branch code ${r.branchCode})`)}

    <table class="rpt_tbl" style="width:62%;">
      <thead><tr><th colspan="2">Accumulated grand total</th></tr></thead>
      <tbody>
        ${row('Beginning balance', num(r.beginning))}
        ${row('Sales for the day', num(t.totalDue))}
        ${row('Ending balance', num(r.ending), true)}
      </tbody>
    </table>

    <table class="rpt_tbl" style="width:62%; margin-top:10px;">
      <thead><tr><th colspan="2">The day</th></tr></thead>
      <tbody>
        ${row('Gross sales (VAT inclusive)', num(t.gross))}
        ${row('Less discounts', '(' + num(t.discount) + ')')}
        ${row('VATable sales', num(t.vatableSales))}
        ${row('Output VAT', num(t.vat))}
        ${row('VAT-exempt sales', num(t.exempt))}
        ${row('Zero-rated sales', num(t.zero))}
        ${t.scDiscount ? row('Less statutory discount', '(' + num(t.scDiscount) + ')') : ''}
        ${row('Total invoiced', num(t.totalDue), true)}
      </tbody>
    </table>

    <table class="rpt_tbl" style="width:62%; margin-top:10px;">
      <thead><tr><th colspan="2">Invoices</th></tr></thead>
      <tbody>
        ${row('Issued', t.documents)}
        ${row('Cancelled', t.cancelled)}
        ${row('Series covered', t.firstNumber ? esc(t.firstNumber + ' to ' + t.lastNumber) : '—')}
        ${r.cancelledNumbers && r.cancelledNumbers.length
            ? row('Cancelled numbers (retired)', esc(r.cancelledNumbers.join(', '))) : ''}
      </tbody>
    </table>

    ${this.footer(
      `Taken by ${r.takenBy} on ${fmtDateTime(r.takenAt)}. ` +
      (r.kind === 'Z'
        ? 'A Z reading records the day as it stood when it was closed and is not ' +
          'recomputed afterwards. Nothing is reset by it. The documents are the record, ' +
          'and the accumulated grand total continues.'
        : 'An X reading is a look at the day in progress. It is not recorded and ' +
          'closes nothing.'))}`;
};

/* ============================================================
   The server side of the screen.
   ============================================================ */

LocalAPI.on("Dashboard/ReportBuild", function (p) {
  if (!can('export')) return { success:false, message:'Your role cannot run reports.' };

  const r = Reporting.range(p.range);
  if (!r) return { success:false, message:'Select the period this report should cover.' };

  const grain = RepReg.GRAINS[p.grain] ? p.grain : 'month';

  if (grain === 'day'){
    const days = Math.round(
      (new Date(r.to) - new Date(r.from)) / 864e5) + 1;
    if (days > RepReg.MAX_DAILY_DAYS){
      return { success:false,
               message:`A daily report for ${days} days has ${days} rows. ` +
                       `Select weekly or monthly for this range.` };
    }
  }

  const rows = Reporting.within(RepReg.rows(p.branch), r.from, r.to);
  const buckets = Reporting.bucketsOver(r.from, r.to, grain).map(b => {
    const inRange = Reporting.within(rows, b.from, b.to);
    return Object.assign({}, b, { totals: Reporting.summarize(inRange) });
  });

  const totals = Reporting.summarize(rows);
  const dash = v => v ? num(v) : '<span class="text-muted">—</span>';

  return {
    success: true,
    label: `${RepReg.GRAINS[grain].label} · ${fmtDate(r.from + 'T00:00:00')} – ${fmtDate(r.to + 'T00:00:00')}`,
    data_1: totals,
    data_2: buckets.map(b => ({
      period:       esc(b.label),
      documents:    b.totals.documents || '<span class="text-muted">—</span>',
      cancelled:    b.totals.cancelled
                      ? `<span class="text-danger">${b.totals.cancelled}</span>`
                      : '<span class="text-muted">—</span>',
      gross:        dash(b.totals.gross),
      discount:     dash(b.totals.discount),
      vatableSales: dash(b.totals.vatableSales),
      vat:          dash(b.totals.vat),
      exempt:       dash(b.totals.exempt),
      zero:         dash(b.totals.zero),
      scDiscount:   dash(b.totals.scDiscount),
      totalDue:     dash(b.totals.totalDue)
    })),
    data_3: RepReg.returnView(totals),
    data_4: rows.map(i => i.id)
  };
});

LocalAPI.on("Dashboard/ReadingTake", function (p) {
  if (!can('export')) return { success:false, message:'Your role cannot run readings.' };

  const branchId = p.branch;
  const date = String(p.date || '').slice(0, 10);
  if (!branchId) return { success:false, message:'Select the branch this reading is for.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { success:false, message:'Select the day this reading is for.' };

  const today = Reporting.ymd(new Date());
  if (date > today)
    return { success:false, message:'A day that has not happened yet cannot be read.' };

  const db = Store.db;
  db.readings = db.readings || [];

  if (p.kind === 'X'){
    const r = RepReg.reading(branchId, date, 'X');
    if (!r) return { success:false, message:'That branch is not available to your role.' };
    return { success:true, data_1:r, recorded:false,
             message: date === today
               ? 'This is the day as it stands right now. Nothing has been recorded and nothing is closed.'
               : 'This is a past day, read back from the invoices. Nothing has been recorded.' };
  }

  if (!RepReg.mayTakeReadings()){
    return { success:false,
             message:'Your role can view all readings but cannot take new ones.' };
  }

  /* A day is closed once. Asking again gets the reading that closed it, not a
     second one — two Z readings for one day is exactly the ambiguity the
     numbering is there to prevent. */
  const already = db.readings.find(x =>
    x.branchId === branchId && x.date === date && x.kind === 'Z');
  if (already){
    return { success:true, data_1:already, recorded:false,
             message:`This day was already closed by reading no. ${String(already.zNumber).padStart(4,'0')}, ` +
                     `taken by ${already.takenBy} on ${fmtDateTime(already.takenAt)}. This is that reading.` };
  }

  const r = RepReg.reading(branchId, date, 'Z');
  if (!r) return { success:false, message:'That branch is not available to your role.' };

  r.id = uid('rdg');
  r.zNumber = RepReg.nextZ(branchId);
  db.readings.push(r);
  logActivity(db, {
    action:`Took Z reading no. ${String(r.zNumber).padStart(4,'0')} for ${r.branchName}, ` +
           `${fmtDate(date + 'T00:00:00')} — ${r.totals.documents} invoice(s), ${peso(r.totals.totalDue)}`
  });
  Store.save(db);

  return { success:true, data_1:r, recorded:true,
           message: r.totals.documents
             ? `Day closed. Reading no. ${String(r.zNumber).padStart(4,'0')} is on file and will not change.`
             : `Day closed with no invoices issued. The Z reading is saved.` };
});

LocalAPI.on("Dashboard/ReadingList", function (p) {
  const may = RepReg.mayTakeReadings();
  return {
    success: true,
    data_1: RepReg.readings(p.branch).map(r => ({
      z:         `<span class="mono">${String(r.zNumber).padStart(4, '0')}</span>`,
      date:      fmtDate(r.date + 'T00:00:00'),
      branch:    esc(r.branchName),
      documents: r.totals.documents,
      sales:     num(r.totals.totalDue),
      ending:    num(r.ending),
      taken:     `${esc(r.takenBy)}<br><span class="fs_11 text-muted">${fmtDateTime(r.takenAt)}</span>`,
      actions:   `<button class="lbtn lbtn-sm lbtn-ghost fs_11 button_reading_open"
                          data-id="${r.id}">Open</button>`,
      sorting:   r.date
    }))
  };
});

LocalAPI.on("Dashboard/ReadingOpen", function (p) {
  const r = RepReg.readings().find(x => x.id === p.reading_id);
  if (!r) return { success:false, message:'That reading is not available to your role.' };
  return { success:true, data_1:r,
           message:`Reading no. ${String(r.zNumber).padStart(4,'0')}, as it was taken. ` +
                   `It is not recomputed. It shows the day as it was when closed.` };
});

LocalAPI.on("Dashboard/ReadingPdf", function (body) {
  const r = body.reading;
  if (!r) return { success:false, message:'There is no reading on screen to save.' };

  return Reporting.paper.render(Reporting.paper.reading(r), 'portrait').then(uri => {
    Reporting.logExport(
      `Saved ${r.kind} reading for ${r.branchName}, ${fmtDate(r.date + 'T00:00:00')} as PDF`);
    return {
      success: true,
      pdf_list: [{
        base64: uri,
        pdf_title: `${CT.seriesPrefix}-${r.branchCode}-${r.kind.toLowerCase()}-reading-${r.date}.pdf`
      }]
    };
  });
});

/* ---------- what this screen can put on paper ---------- */

Reporting.source('reports', {
  title: 'Sales and VAT Summary',

  all(){ return RepReg.rows($(".select_branch_reports").val() || ''); },

  rows(ids){
    const by = new Map(RepReg.rows().map(i => [i.id, i]));
    return ids.map(id => by.get(id)).filter(Boolean);
  },

  periodLabel(){ return RepReg.label(); },

  columns(){
    const money = f => i => {
      const v = (i.totals || {})[f] || 0;
      return num(v);
    };
    return [
      { label:'Invoice Number',   value: i => i.number },
      { label:'Date Issued',       value: i => fmtDate(i.issuedAt) },
      { label:'Document Type',     value: i => (DOC_KIND[i.docType] || DOC_KIND.INVOICE).short },
      { label:'Buyer',             value: i => displayBuyer(i).name || '—' },
      { label:'Gross Sales (VAT incl.)', value: money('gross'),  align:'n' },
      { label:'Discounts',         value: money('discount'),     align:'n' },
      { label:'VATable Sales',     value: money('vatableSales'), align:'n' },
      { label:'Output VAT',        value: money('vat'),          align:'n' },
      { label:'VAT-Exempt Sales',  value: money('exempt'),       align:'n' },
      { label:'Zero-Rated Sales',  value: money('zero'),         align:'n' },
      { label:'Statutory Discount',   value: money('scDiscount'),   align:'n' },
      { label:'Creditable Withholding Tax',   value: money('ewtAmount'),    align:'n' },
      { label:'Total Invoiced',    value: money('totalDue'),     align:'n' },
      { label:'Status',   value: i => (STATUS.doc[i.docStatus] || {}).label || i.docStatus }
    ];
  }
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  reports(){
    const grains = Object.keys(RepReg.GRAINS)
      .map(k => `<option value="${k}"${k === 'month' ? ' selected' : ''}>${RepReg.GRAINS[k].label}</option>`)
      .join('');

    const kpi = (label, cls, span, note) => `
      <div class="col-6 col-lg-3">
        <div class="lcard h-100"><div class="lcard-body">
          <span class="stat-label">${label}</span>
          <span class="stat-value mono ${cls} ${span}">—</span>
          <span class="stat-note ${note || ''}">${note ? '&nbsp;' : ''}</span>
        </div></div>
      </div>`;

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Reports</h1>
          <div class="screen_sub">
            Sales and VAT for any period, and each branch's daily closings.
          </div>
        </div>
        <button class="lbtn lbtn-primary fw-semibold px-3 button_generate_reports">
          <i class="bi bi-filetype-pdf me-1"></i> Export to PDF
        </button>
      </div>

      <div class="d-flex gap-2 mb-3 overflow_x_scroll">
        <div class="tab_button tab_button_reports_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SALES AND VAT</div>
        <div class="tab_button tab_button_reports_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">DAILY CLOSING</div>
        <div class="tab_button tab_button_reports_3 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SALES LISTS</div>
        <div class="tab_button tab_button_reports_4 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">NUMBER CHECK</div>
      </div>

      <!-- ================= SUMMARY ================= -->
      <div class="tab_content tab_content_reports_1">

        <div class="lcard mb-3"><div class="lcard-body">
          <div class="d-flex flex-wrap gap-2 align-items-stretch">
            <div class="period-bar flex-grow-1" style="min-width:400px;">
              <div class="period-seg">
                <select class="form-select form-select-sm select_branch_reports"></select>
              </div>
              <div class="period-seg" style="flex:0.7 1 0;">
                <select class="form-select form-select-sm select_grain_reports">${grains}</select>
              </div>
              <div class="period-seg" style="flex:1.4 1 0;">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-white border-end-0 text-muted">
                    <i class="bi bi-calendar3"></i>
                  </span>
                  <input type="text" readonly
                         class="form-control border-start-0 ps-2 bg-white input_date_range_reports"
                         placeholder="Select a period...">
                </div>
              </div>
            </div>
            <button class="lbtn lbtn-accent fw-semibold button_repeat_reports">
              <i class="bi bi-arrow-repeat me-1"></i> Regenerate report
            </button>
          </div>
        </div></div>

        ${Callout('warn', '<div class="span_reports_empty"></div>', {cls:'mb-3 d-none div_reports_empty'})}

        <div class="div_reports_result d-none">
          <div class="row g-2 mb-2">
            ${kpi('Invoices', '', 'span_reports_documents', 'span_reports_documents_note')}
            ${kpi('Gross sales (VAT incl.)', '', 'span_reports_gross')}
            ${kpi('Output VAT', 'stat-value-accent', 'span_reports_vat')}
            ${kpi('Total invoiced', 'stat-value-positive', 'span_reports_total')}
          </div>

          <div class="row g-2">
            <div class="col-12 col-xl-8">
              <div class="lcard h-100"><div class="lcard-body">
                <div class="d-flex justify-content-between align-items-baseline mb-2">
                  <span class="fs_14 fw-bold text-uppercase">Period breakdown</span>
                  <span class="fs_11 text-muted span_reports_covering"></span>
                </div>
                <div class="table-responsive">
                  <table class="table nowrap table_reports">
                    <thead>
                      <tr>
                        <th>PERIOD</th>
                        <th class="text-center">DOCS</th>
                        <th class="text-center">CANCELLED</th>
                        <th class="text-end">GROSS SALES (VAT INCL.)</th>
                        <th class="text-end">DISCOUNTS</th>
                        <th class="text-end">VATABLE SALES</th>
                        <th class="text-end">OUTPUT VAT</th>
                        <th class="text-end">VAT-EXEMPT</th>
                        <th class="text-end">ZERO-RATED</th>
                        <th class="text-end">STATUTORY</th>
                        <th class="text-end">TOTAL INVOICED</th>
                      </tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div></div>
            </div>

            <div class="col-12 col-xl-4">
              <div class="lcard h-100"><div class="lcard-body">
                <span class="fs_14 fw-bold text-uppercase">For the VAT return</span>
                <div class="fs_11 text-muted mb-3">
                  The same period, restated the way BIR Form 2550Q asks for it.
                </div>

                <table class="w-100 fs_13">
                  <tr><td class="text-muted py-1">VATable sales (net of VAT)</td>
                      <td class="text-end mono span_return_vatable">—</td></tr>
                  <tr><td class="text-muted py-1">Output VAT</td>
                      <td class="text-end mono span_return_vat">—</td></tr>
                  <tr><td class="text-muted py-1">VAT-exempt sales</td>
                      <td class="text-end mono span_return_exempt">—</td></tr>
                  <tr><td class="text-muted py-1">Zero-rated sales</td>
                      <td class="text-end mono span_return_zero">—</td></tr>
                  <tr class="tr_return_scpwd d-none">
                      <td class="text-muted py-1">Less statutory discount</td>
                      <td class="text-end mono span_return_scpwd">—</td></tr>
                </table>

                <div class="hr_gray_200 my-2"></div>

                <div class="d-flex justify-content-between align-items-baseline">
                  <span class="fs_13 fw-bold">Gross sales, VAT-exclusive</span>
                  <span class="fs_16 fw-bold text-success mono span_return_exclusive">—</span>
                </div>

                ${Callout('warn', `This is <strong>not</strong> the gross sales figure in the table beside it. That figure is VAT-inclusive, as shown on the invoice. The return asks for sales net of VAT. Using the gross figure overstates sales by 12%.`, {cls:'mt-3'})}

                <div class="fs_11 text-muted mt-2">
                  Computed from the invoices in this account. This is not a filed return. Sales not invoiced here are not included.
                </div>
              </div></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ================= SALES LISTS ================= -->
      <div class="tab_content tab_content_reports_3 d-none">${ListsReg.salesTab()}</div>

      <!-- ================= SERIES CHECK ================= -->
      <div class="tab_content tab_content_reports_4 d-none">${ListsReg.seriesTab()}</div>

      <!-- ================= READINGS ================= -->
      <div class="tab_content tab_content_reports_2 d-none">

        ${Callout('info', `<strong>X and Z readings.</strong> These summarize a day's sales. An X reading shows the day so far and is not saved. A Z reading closes the day and saves a copy that never changes, even if an invoice from that day is cancelled later.`, {cls:'mb-3'})}

        <div class="lcard mb-3"><div class="lcard-body">
          <div class="d-flex flex-wrap gap-2 align-items-stretch">
            <div class="period-bar flex-grow-1" style="min-width:320px;">
              <div class="period-seg">
                <select class="form-select form-select-sm select_branch_reading"></select>
              </div>
              <div class="period-seg">
                <div class="input-group input-group-sm">
                  <span class="input-group-text bg-white border-end-0 text-muted icon_date">
                    <i class="bi bi-calendar3"></i>
                  </span>
                  <!-- "0" rather than "today": the shared helper reads "today" as
                       midnight, which is in the past by the time anyone opens this,
                       so the picker refuses to hold today's date at all. -->
                  <input type="text" class="form-control border-start-0 ps-2 input_date input_date_reading"
                         data-day_max="0">
                </div>
              </div>
            </div>
            <button class="lbtn lbtn-ghost fw-semibold button_reading_x">
              <i class="bi bi-eye me-1"></i> X reading
            </button>
            <button class="lbtn lbtn-primary fw-semibold button_reading_z">
              <i class="bi bi-journal-check me-1"></i> Close the day (Z reading)
            </button>
          </div>
        </div></div>

        <div class="div_reading_paper d-none mb-3"></div>

        <div class="lcard"><div class="lcard-body">
          <span class="fs_14 fw-bold text-uppercase">Z readings on file</span>
          <div class="fs_11 text-muted mb-3">
            Every day this account has closed, in the order it closed them. A reading
            here is the day as it was, not the day as it is now.
          </div>
          <div class="table-responsive">
            <table class="table nowrap table_readings">
              <thead>
                <tr>
                  <th>READING NO.</th>
                  <th>DAY</th>
                  <th>BRANCH</th>
                  <th class="text-center">DOCS</th>
                  <th class="text-end">SALES FOR THE DAY</th>
                  <th class="text-end">ENDING ACCUMULATED</th>
                  <th>TAKEN BY</th>
                  <th></th>
                </tr>
              </thead>
              <tbody></tbody>
            </table>
          </div>
        </div></div>
      </div>`;
  }
});
