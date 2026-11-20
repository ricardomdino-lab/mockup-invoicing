/* ============================================================
   home.js — Home Dashboard

   The source portal's home_dashboard: a chart on the left, a headline figure
   and the period pickers on the right, and two tabs under both — a per-branch
   view and a feed of what has just been issued.

   The portal also carried a strip of per-branch cards between the two. It is
   gone: it said the same thing as the per-branch tab directly beneath it, in
   smaller type. The one figure it held that the tab did not — how much of a
   branch's output is still waiting to reach the BIR — moved onto the tab card.

   One deliberate difference from the portal. It re-polled every panel on the
   page every three seconds. Here only the feed polls, because only the feed can
   change without the user doing anything: documents arrive from a connector,
   not from this screen. Re-drawing a month's chart every three seconds would
   move under the reader's eye while telling them nothing new.

   "Live" is deliberately not used on this screen. It has one meaning in this
   system — an account that is in production rather than in sandbox — and the
   portal's "LIVE DOCUMENTS" tab quietly gave it a second one.
   ============================================================ */

const HomeReg = {

  /** The window the pickers currently describe, as inclusive calendar dates. */
  window(p){
    p = p || {};
    const pad = n => String(n).padStart(2, '0');
    const type = p.type_val || 'month_year';

    if (type === 'current_date'){
      const d = Reporting.ymd(new Date());
      return { from: d, to: d, label: fmtDate(d + 'T00:00:00') };
    }

    if (type === 'date_range'){
      const r = Reporting.range(p.date_range_val);
      if (r) return {
        from: r.from, to: r.to,
        label: `${fmtDate(r.from + 'T00:00:00')} – ${fmtDate(r.to + 'T00:00:00')}`
      };
    }

    const ym = String(p.month_year_val || '').slice(0, 7) ||
               Reporting.ymd(new Date()).slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthLabel = new Date(y, m - 1, 1)
      .toLocaleDateString('en-PH', { month:'long', year:'numeric' });

    if (type === 'week' && p.week_val){
      /* The portal's weeks are the 1st–7th, 8th–14th and so on, not calendar
         weeks. Kept as it was: what the picker offers is what it means. */
      const n = parseInt(p.week_val, 10) || 1;
      const start = (n - 1) * 7 + 1;
      const end = Math.min(start + 6, lastDay);
      if (start > lastDay) return { from:`${y}-${pad(m)}-01`, to:`${y}-${pad(m)}-${pad(lastDay)}`, label: monthLabel };
      return {
        from: `${y}-${pad(m)}-${pad(start)}`,
        to:   `${y}-${pad(m)}-${pad(end)}`,
        label: `${monthLabel} · day ${start}–${end}`
      };
    }

    return { from:`${y}-${pad(m)}-01`, to:`${y}-${pad(m)}-${pad(lastDay)}`, label: monthLabel };
  },

  /** Day-by-day buckets across a window, so an empty day still shows as zero. */
  days(from, to){
    const out = [];
    const cursor = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    while (cursor <= end && out.length < 400){
      out.push(Reporting.ymd(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function DashboardLoad() {
  FilteringOption();
  TabFunction();
}

Screens.home = function () { DashboardLoad(); };

function FilteringOption() {
  const now = new Date();
  const currentVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  $(".input_month_year_home_dashboard").off("change").on("change", function () {
    const val = $(this).val();
    if (!val) return;
    const chosen = new Date(val + "-02");
    UpdateWeekSelect(chosen.getFullYear(), chosen.getMonth());
    $(".input_home_dashboard_type").val("month_year");
    GetIssuanceData();
  }).val(currentVal).trigger("change");

  $(".select_week_home_dashboard").off("select2:select").on("select2:select", function (e) {
    $(".input_home_dashboard_type").val(e.params.data.id ? "week" : "month_year");
    GetIssuanceData();
  });

  $(".input_date_range_home_dashboard").off("change").on("change", function () {
    $(".input_home_dashboard_type").val($(this).val() ? "date_range" : "month_year");
    GetIssuanceData();
  }).val("");

  $(".button_current_date_home_dashboard").off("click").on("click", function () {
    $(".input_home_dashboard_type").val("current_date");
    GetIssuanceData();
  });

  function UpdateWeekSelect(year, month) {
    const lastDay = new Date(year, month + 1, 0).getDate();
    const ordinal = n => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';
    const weeks = [];
    for (let start = 1, n = 1; start <= lastDay; start += 7, n++){
      weeks.push({ value: String(n), text: `${ordinal(n)} Week` });
    }
    DisplaySelect2(weeks, ".select_week_home_dashboard", true, "Whole month", "", false, $(document.body));
  }
}

function HomeDashboardParams() {
  return {
    type_val:       $(".input_home_dashboard_type").val() || "",
    month_year_val: $(".input_month_year_home_dashboard").val() || "",
    week_val:       $(".select_week_home_dashboard").val() || "",
    date_range_val: $(".input_date_range_home_dashboard").val() || ""
  };
}

function GetIssuanceData() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/GetIssuanceData",
    method: "POST",
    dataType: "json",
    data: HomeDashboardParams(),
    success: function (res) {
      if (!res.success) return;

      HomeDashboardChart(res.data.chart);

      $(".span_tpc_amount").text(res.data.amount);
      $(".span_tpc_date").text(res.data.date);
      $(".span_tpc_docs").text(res.data.total_no_of_transaction);
      $(".span_tpc_vat").text(res.data.vat);
    },
    error: function (xhr, status, error) {
      console.error("Error fetching issuance data:", error);
    }
  });
}

function HomeDashboardChart(chart) {
  $(".chart").empty().append(`<div id="chart_canvas"></div>`);
  if (window.chart1) window.chart1.destroy();

  const currency = val => val === undefined || val === null
    ? '₱ 0.00'
    : '₱ ' + val.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });

  window.chart1 = new ApexCharts(document.querySelector("#chart_canvas"), {
    series: chart.series,
    chart: { type:'bar', height:300, stacked:false, toolbar:{ show:false }, animations:{ enabled:true },
             fontFamily:'"Public Sans", sans-serif' },
    colors: ['#14284b', '#3b82f6'],
    plotOptions: { bar: { horizontal:false, columnWidth:'70%', endingShape:'flat' } },
    grid: { show:true, borderColor:'#f0f0f0', xaxis:{ lines:{ show:false } }, yaxis:{ lines:{ show:true } } },
    dataLabels: { enabled:false },
    stroke: { show:true, width:1, colors:['transparent'] },
    xaxis: {
      categories: chart.categories,
      tickAmount: Math.min(chart.categories.length, 16),
      labels: {
        show:true, rotate:-30, rotateAlways:true, hideOverlappingLabels:true,
        style:{ fontSize:'11px', fontWeight:'bold', colors:'#666', fontFamily:'"Public Sans", sans-serif' }
      },
      axisBorder: { show:true, color:'#ccc' },
      axisTicks: { show:true }
    },
    yaxis: {
      min: 0, forceNiceScale: true,
      labels: { formatter: currency, style:{ fontSize:'11px', fontWeight:'bold', colors:'#555', fontFamily:'"Public Sans", sans-serif' } }
    },
    tooltip: { shared:true, intersect:false, y:{ formatter: currency },
               style:{ fontSize:'11px', fontFamily:'"IBM Plex Mono", monospace' } },
    legend: { show:true, position:'top', horizontalAlign:'right', offsetX:20, offsetY:-6,
              markers:{ width:12, height:12, radius:2 } }
  });
  window.chart1.render();
}

function TabFunction() {
  TabToggling(".tab_button_home_1", ".tab_content_home_1", GetIssuanceCard);

  $(".tab_button_home_1").off("click").on("click", function () {
    TabToggling(".tab_button_home_1", ".tab_content_home_1", function () {
      AppTraffic.stop("issuance_realtime");
      GetIssuanceCard();
    });
  });

  $(".tab_button_home_2").off("click").on("click", function () {
    TabToggling(".tab_button_home_2", ".tab_content_home_2", function () {
      /* The feed is the only panel that can change on its own: a connector
         can issue while this screen is open. Nav.go stops the timer. */
      AppTraffic.refresh("issuance_realtime", GetIssuanceRealtime, 5);
    });
  });

  /* ---------- Branch → payment method → document drill-down ----------
     One card grid, three possible contents. What is cached from the last
     fetch is what a click reads from — a card's own data-id is only ever a
     lookup key, never something re-parsed out of escaped markup. */
  $(document).off("click", ".div_issuance_card")
    .on("click", ".div_issuance_card", function () {
      const id = $(this).data("id");
      if ($(this).data("kind") === "branch"){
        const item = IssuanceCache.branches.find(b => String(b.id) === String(id));
        if (!item) return;
        CardsDrill = { level:2, branchId:item.id, branchLabel:item.branch, group:null, groupLabel:'' };
        GetIssuancePaymentMethods();
      } else {
        const item = IssuanceCache.groups.find(g => g.key === id);
        if (!item) return;
        CardsDrill.level = 3;
        CardsDrill.group = item.key;
        CardsDrill.groupLabel = item.label;
        GetIssuanceDocsByGroup();
      }
    });

  $(document).off("click", ".span_crumb_root")
    .on("click", ".span_crumb_root", function () {
      CardsDrill = { level:1, branchId:null, branchLabel:'', group:null, groupLabel:'' };
      GetIssuanceCard();
    });

  $(document).off("click", ".span_crumb_branch")
    .on("click", ".span_crumb_branch", function () {
      CardsDrill.level = 2;
      CardsDrill.group = null;
      CardsDrill.groupLabel = '';
      GetIssuancePaymentMethods();
    });

  $(document).off("click", ".span_issuance_doc_open")
    .on("click", ".span_issuance_doc_open", function () {
      const id = $(this).data("id");
      if (id) Nav.go('invoices', { docId: id });
    });
}

/** What the last fetch at each level returned, keyed for the click handler
    above rather than re-read from the DOM. */
const IssuanceCache = { branches: [], groups: [] };

/** Where the BY BRANCH tab currently is. Reset to level 1 whenever the tab
    is (re)activated — see TabFunction's onShow callback. */
let CardsDrill = { level:1, branchId:null, branchLabel:'', group:null, groupLabel:'' };

function IssuanceCardHtml(id, kind, title, subtitle, count, unsent, amount){
  return `
    <div class="lcard lcard-hero lcard-hover drill-card div_issuance_card"
         data-id="${id}" data-kind="${kind}" role="button" tabindex="0">
      <div class="lcard-body">
        <div>
          <div class="drill-title">${title}</div>
          <div class="drill-sub">${subtitle}</div>
        </div>
        <!-- Labels are given a floor height so the three figures share a
             baseline: two of them wrap to a second line and one does not. -->
        <div class="drill-stats">
          <div class="drill-stat">
            <span class="drill-stat-label">Invoices issued</span>
            <span class="drill-stat-value">${count}</span>
          </div>
          <div class="drill-stat">
            <span class="drill-stat-label">Waiting to be sent</span>
            <span class="drill-stat-value ${unsent ? 'drill-stat-danger' : ''}">${unsent}</span>
          </div>
          <div class="drill-stat">
            <span class="drill-stat-label">Total invoiced</span>
            <span class="drill-stat-value drill-stat-success">₱${amount}</span>
          </div>
        </div>
      </div>
    </div>`;
}

/** The path back to the root, shown above the cards from level 2 on. */
function IssuanceRenderCrumb(){
  const $c = $(".div_issuance_crumb");
  if (CardsDrill.level === 1){ $c.addClass('d-none').empty(); return; }

  let html = `<span class="hyperlink fw-semibold span_crumb_root">All branches</span>`;
  if (CardsDrill.level === 2){
    html += ` <span class="text-muted mx-1">/</span> <span class="fw-semibold">${CardsDrill.branchLabel}</span>`;
  } else {
    html += ` <span class="text-muted mx-1">/</span> <span class="hyperlink fw-semibold span_crumb_branch">${CardsDrill.branchLabel}</span>`;
    html += ` <span class="text-muted mx-1">/</span> <span class="fw-semibold">${CardsDrill.groupLabel}</span>`;
  }
  $c.removeClass('d-none').html(html);
}

function IssuanceShowCards(note){
  $(".div_issuance_cards_note").text(note);
  $(".div_issuance_cards").removeClass('d-none');
  $(".div_issuance_doclist").addClass('d-none');
}

function IssuanceShowDocList(){
  $(".div_issuance_cards").addClass('d-none');
  $(".div_issuance_doclist").removeClass('d-none');
}

/** Replaces the card grid's content with a brief cross-fade instead of a
    hard swap, so going from four branch cards to three payment-method cards
    (a different size grid) reads as a transition rather than a jump. */
function IssuanceSwapCards(html){
  Drill.swap($(".div_issuance_cards"), html);
}

function GetIssuanceCard() {
  CardsDrill = { level:1, branchId:null, branchLabel:'', group:null, groupLabel:'' };
  IssuanceRenderCrumb();
  IssuanceShowCards('All invoices since activation. The date filters above do not apply to these cards. Select a branch to see sales by payment method.');

  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/GetIssuanceCard",
    method: "POST",
    dataType: "json",
    success: function (res) {
      IssuanceCache.branches = res.success ? res.data : [];

      if (!res.success || !res.data.length){
        IssuanceSwapCards(`<div class="col-12 empty">
          <div class="empty-ico"><i class="bi bi-receipt"></i></div>
          <div class="empty-title">No invoices issued</div>
          <div class="empty-sub">Issued documents are listed here by branch.</div>
        </div>`);
        return;
      }

      IssuanceSwapCards(res.data.map(item =>
        IssuanceCardHtml(item.id, 'branch', item.branch, item.rdo, item.count, item.unsent, item.amount)
      ).join(''));
    },
    error: function (xhr, status, error) {
      console.error("Error fetching card data:", error);
    }
  });
}

function GetIssuancePaymentMethods() {
  IssuanceRenderCrumb();
  IssuanceShowCards(`Sales of ${CardsDrill.branchLabel} by payment method since activation. Select a group to view its invoices.`);

  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/GetIssuancePaymentMethods",
    method: "POST",
    dataType: "json",
    data: { branch_id: CardsDrill.branchId },
    success: function (res) {
      IssuanceCache.groups = res.success ? res.data : [];

      if (!res.success || !res.data.length){
        IssuanceSwapCards(`<div class="col-12 empty">
          <div class="empty-ico"><i class="bi bi-receipt"></i></div>
          <div class="empty-title">No invoices issued</div>
          <div class="empty-sub">Issued documents are listed here by payment method.</div>
        </div>`);
        return;
      }

      IssuanceSwapCards(res.data.map(item =>
        IssuanceCardHtml(item.key, 'group', item.label, item.count === 1 ? '1 document' : `${item.count} documents`,
                          item.count, item.unsent, item.amount)
      ).join(''));
    },
    error: function (xhr, status, error) {
      console.error("Error fetching payment method data:", error);
    }
  });
}

function GetIssuanceDocsByGroup() {
  IssuanceRenderCrumb();
  IssuanceShowDocList();

  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/GetIssuanceDocsByGroup",
    method: "POST",
    dataType: "json",
    data: { branch_id: CardsDrill.branchId, group: CardsDrill.group },
    success: function (res) {
      if (!res.success) return;
      $(".table_issuance_bygroup").DataTable(StandardTableOpts({
        "language": { "emptyTable": "No invoices match this branch and payment method" },
        "data": res.data,
        "scrollY": "360px",
        "order": [[5, "DESC"]],
        "columns": [
          { data: "number", render: function (d, t, row) {
              return `<span class="hyperlink fw-semibold span_issuance_doc_open" data-id="${row.id}">${d}</span>`;
            } },
          { data: "issued_at", "orderable": false },
          { data: "buyer", "orderable": false },
          { data: "total_due", "orderable": false, className: "text-end" },
          { data: "doc_status", "orderable": false },
          { data: "sorting", "visible": false }
        ]
      }));
    },
    error: function (xhr, status, error) {
      console.error("Error fetching invoices for this group:", error);
    }
  });
}

/** ids seen on the previous poll — null until the first successful load, so
    the very first paint never flashes as if every row just arrived. */
let RealtimeSeenIds = null;

function GetIssuanceRealtime() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/GetIssuanceRealtime",
    method: "POST",
    dataType: "json",
    success: function (res) {
      if (!res.success) return;

      const seen = RealtimeSeenIds;

      $(".table_home_dashboard_realtime").DataTable(StandardTableOpts({
        "language": { "emptyTable": "No invoices issued" },
        "data": res.data,
        "scrollY": "260px",
        "order": [[7, "DESC"]],
        "rowCallback": function (row, data) {
          if (seen && !seen.has(data.id)) $(row).addClass('row-flash');
        },
        "columns": [
          {
            data: "number",
            render: function (data, type, row) {
              return `<span class="hyperlink fw-semibold span_view_invoice_transactions" data-id="${row.id}">${data}</span>`;
            }
          },
          { data: "issued_at", "orderable": false },
          { data: "buyer", "orderable": false },
          { data: "branch", "orderable": false },
          { data: "issued_via", "orderable": false },
          { data: "total_due", "orderable": false, className: "text-end" },
          { data: "transmission", "orderable": false },
          { data: "sorting", "visible": false }
        ]
      }));

      RealtimeSeenIds = new Set(res.data.map(r => r.id));

      $(document).off("click", ".span_view_invoice_transactions")
        .on("click", ".span_view_invoice_transactions", function () {
          var id = $(this).data("id");
          if (id) Nav.go('invoices', { docId: id });
        });
    },
    error: function (xhr, status, error) {
      console.error("Error fetching realtime data:", error);
    }
  });
}

/* ============================================================
   The server side of the dashboard.
   ============================================================ */

LocalAPI.on("Dashboard/GetIssuanceData", function (p) {
  const db = Store.db;
  const w = HomeReg.window(p);
  const all = Auth.visibleInvoices();
  const rows = Reporting.within(all, w.from, w.to);
  const totals = Reporting.summarize(rows);

  const days = HomeReg.days(w.from, w.to);
  const perDay = days.map(d => Reporting.summarize(Reporting.within(rows, d, d)));

  return {
    success: true,
    data: {
      chart: {
        categories: days.map(d => fmtDate(d + 'T00:00:00')),
        series: [
          { name:'Total invoiced', data: perDay.map(t => round2(t.totalDue)) },
          { name:'Output VAT',     data: perDay.map(t => round2(t.vat)) }
        ]
      },
      amount: peso(totals.totalDue),
      date: w.label,
      total_no_of_transaction: `${totals.documents} invoice(s)` +
        (totals.cancelled ? ` · ${totals.cancelled} cancelled` : ''),
      vat: peso(totals.vat)
    }
  };
});

/* The per-branch cards. All-time, unlike the chart and the headline above them,
   which follow the period pickers — the tab says so, because a figure that does
   not move when the pickers do had better announce it. */
LocalAPI.on("Dashboard/GetIssuanceCard", function () {
  const all = Auth.visibleInvoices();
  return {
    success: true,
    data: Auth.visibleBranches().map(b => {
      const mine = all.filter(i => i.branchId === b.id);
      const t = Reporting.summarize(mine);
      return {
        id: b.id, branch: esc(b.name), rdo: esc(b.rdo),
        count:  t.documents,
        unsent: mine.filter(i =>
          ['QUEUED','FAILED','REJECTED'].indexOf(i.transmissionStatus) > -1).length,
        amount: num(t.totalDue)
      };
    }).filter(b => b.count > 0)
  };
});

/* Same cards, grouped by how the branch got paid instead of by branch. Cash,
   bank transfer, card and e-payment are the taxpayer's own vocabulary from
   seed data and Bulk Import CSVs — paymentGroupOf() (core.js) collapses
   whatever string showed up into one of PAYMENT_GROUP's fixed keys. */
LocalAPI.on("Dashboard/GetIssuancePaymentMethods", function (p) {
  const mine = Auth.visibleInvoices().filter(i => i.branchId === p.branch_id);
  return {
    success: true,
    data: Object.keys(PAYMENT_GROUP).map(key => {
      const rows = mine.filter(i => paymentGroupOf(i.paymentMethod) === key);
      const t = Reporting.summarize(rows);
      return {
        key, label: PAYMENT_GROUP[key].label,
        count:  t.documents,
        unsent: rows.filter(i =>
          ['QUEUED','FAILED','REJECTED'].indexOf(i.transmissionStatus) > -1).length,
        amount: num(t.totalDue)
      };
    }).filter(g => g.count > 0)
  };
});

LocalAPI.on("Dashboard/GetIssuanceDocsByGroup", function (p) {
  const rows = Auth.visibleInvoices()
    .filter(i => i.branchId === p.branch_id && paymentGroupOf(i.paymentMethod) === p.group);

  return {
    success: true,
    data: rows.map(i => {
      return {
        id:         i.id,
        number:     esc(i.number),
        issued_at:  fmtDateTime(i.issuedAt),
        buyer:      esc(displayBuyer(i).name || '—'),
        total_due:  num(i.totals.totalDue),
        doc_status: badge('doc', i.docStatus),
        sorting:    i.issuedAt
      };
    })
  };
});

LocalAPI.on("Dashboard/GetIssuanceRealtime", function () {
  const db = Store.db;
  return {
    success: true,
    data: Auth.visibleInvoices().slice(0, 30).map(i => {
      const b = db.branches.find(x => x.id === i.branchId);
      return {
        id:           i.id,
        number:       esc(i.number),
        issued_at:    fmtDateTime(i.issuedAt),
        buyer:        esc(displayBuyer(i).name || '—'),
        branch:       esc(b ? b.name : '—'),
        issued_via:   esc(i.issuedVia || '—'),
        total_due:    num(i.totals.totalDue),
        transmission: badge('transmission', i.transmissionStatus),
        sorting:      i.issuedAt
      };
    })
  };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  home(){
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Dashboard</h1>
          <div class="screen_sub">
            Issued invoices, output VAT and BIR status. ${can('allBranches') ? 'All branches.' : 'Your branch only.'}
          </div>
        </div>
      </div>

      <input type="hidden" class="input_home_dashboard_type" />

      <div class="row g-2 align-items-stretch">
        <div class="col-lg-8 d-flex flex-column">
          <div class="lcard h-100 d-flex flex-column">
            <div class="lcard-head">
              <span class="lcard-title">Invoiced value and output VAT, by day</span>
            </div>
            <div class="lcard-body flex-grow-1 d-flex flex-column">
              <div class="chart flex-grow-1"></div>
            </div>
          </div>
        </div>

        <div class="col-lg-4 d-flex flex-column gap-2">
          <div class="period-bar">
            <div class="input-group input-group-sm period-seg">
              <input type="text" class="form-control text-center hover px-1 input_month_year input_month_year_home_dashboard" readonly />
              <select class="form-select form-select-sm select_week_home_dashboard"></select>
            </div>
            <div class="input-group input-group-sm period-seg">
              <input type="text" class="form-control form-control-sm border-end-0 input_date_range input_date_range_home_dashboard"
                     placeholder="Date" readonly>
              <span class="input-group-text bg-white fs_12 icon_date_range">
                <i class="bi bi-calendar3"></i>
              </span>
            </div>
            <button class="lbtn lbtn-accent period-today button_current_date_home_dashboard">
              <i class="bi bi-cloud-sun-fill"></i>Today
            </button>
          </div>

          <div class="lcard-hero d-flex flex-column justify-content-between p-4 text-center flex-grow-1">
            <div>
              <span class="kpi-label d-block mb-1">Total invoiced</span>
              <span class="hero-sub d-block mb-3">VAT inclusive · cancelled excluded</span>
              <div class="d-flex flex-column justify-content-center align-items-center mb-3">
                <span class="kpi-amount span_tpc_amount">₱ 0.00</span>
                <span class="hero-sub span_tpc_date mt-1"></span>
              </div>
            </div>

            <div class="hero-rule my-2"></div>

            <div class="d-flex flex-column gap-2">
              <span class="hero-label mb-1">Invoices issued</span>
              <span class="kpi-row span_tpc_docs">0</span>

              <span class="hero-label mt-2 mb-1">Output VAT</span>
              <span class="kpi-row span_tpc_vat">₱ 0.00</span>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-2 mt-2">
        <div class="col-12">
          <div class="mt-2">
            <div class="d-flex mx-3 gap-1 flex-nowrap fs_14 overflow_x_scroll">
              <div class="tab_button tab_button_home_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">BY BRANCH</div>
              <div class="tab_button tab_button_home_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">RECENTLY ISSUED</div>
            </div>
          </div>

          <div class="bg-white border p-4 rounded shadow-sm">
            <div class="tab_content tab_content_home_1">
              <div class="fs_11 text-muted mb-3 div_issuance_cards_note">
                All invoices since activation. The date filters above do not apply to these cards.
              </div>
              <div class="fs_13 mb-3 d-none div_issuance_crumb"></div>
              <div class="d-flex flex-wrap gap-3 div_issuance_cards"></div>
              <div class="table-responsive d-none div_issuance_doclist">
                <table class="table nowrap table-hover table-borderless table-striped table_issuance_bygroup">
                  <thead>
                    <tr>
                      <th>INVOICE NO.</th>
                      <th>DATE AND TIME ISSUED</th>
                      <th>BUYER</th>
                      <th>TOTAL AMOUNT DUE</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody></tbody>
                </table>
              </div>
            </div>

            <div class="tab_content tab_content_home_2 d-none">
              <div class="lcard">
                <div class="table-responsive">
                  <table class="table nowrap table-hover table-borderless table-striped table_home_dashboard_realtime">
                    <thead>
                      <tr>
                        <th>INVOICE NO.</th>
                        <th>DATE AND TIME ISSUED</th>
                        <th>BUYER</th>
                        <th>BRANCH</th>
                        <th>ISSUED VIA</th>
                        <th>TOTAL AMOUNT DUE</th>
                        <th>TRANSMISSION</th>
                      </tr>
                    </thead>
                    <tbody></tbody>
                  </table>
                </div>
              </div>
              <div class="fs_11 text-muted mt-2">
                <i class="bi bi-broadcast me-1"></i>
                Refreshes every 5 seconds.
              </div>
            </div>
          </div>
        </div>
      </div>`;
  }
});
