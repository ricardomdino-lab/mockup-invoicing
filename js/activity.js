/* ============================================================
   activity.js — Activity Logs

   Carried over from the source portal's activity_logs screen: a search box, a
   date range, a table, and one button that puts the list on paper. What is
   ours is who may read it and what a row can say.

   Two rules the portal did not need:

     - An entry is never edited or removed. The log is the account's own audit
       trail, and a trail with a gap in it is worth less than no trail.
     - A branch-scoped role reads only its own actions. An issuer has no
       business reading a colleague's device and address, and the Data Privacy
       Act (RA 10173) asks that personal data be visible to those who need it
       for a purpose, not to everyone who happens to have a login.
   ============================================================ */

/* Roles that appear in the log but are not portal roles: an integration
   issuing under a credential, and EPI's own support staff during break-glass
   access. Both must be nameable, or the rows they write read as anonymous. */
const ACTOR_KIND = {
  USER:   { label:'User',        badge:'lbadge-gray'   },
  SYSTEM: { label:'Integration', badge:'lbadge-blue'   },
  EPI:    { label:'EPI staff',   badge:'lbadge-violet' },
  /* Someone outside the account who was handed a document and checked it.
     They never signed in, so the row carries no name — only that a particular
     document was verified, and when. */
  PUBLIC: { label:'Buyer',       badge:'lbadge-teal'   }
};

const ActivityReg = {

  params(){
    return {
      searchval:  $(".input_searchval_activity_logs").val() || "",
      date_range: $(".input_date_range_activity_logs").val() || ""
    };
  },

  /** The entries this role may read, narrowed by the filter row. */
  apply(p){
    p = p || {};
    const db = Store.db;
    const q = String(p.searchval || '').trim().toLowerCase();
    const range = Reporting.range(p.date_range);
    const ownOnly = !can('allBranches');

    return (db.activity || [])
      .filter(a => a.tenantId === CU.tenantId)
      .filter(a => !ownOnly || a.actorName === CU.name)
      .filter(a => {
        if (range){
          const d = Reporting.dayOf(a.at);
          if (d < range.from || d > range.to) return false;
        }
        if (q){
          const hay = [a.actorName, a.action, a.role, a.location, a.device,
                       a.browser, a.ip].join(' ').toLowerCase();
          if (hay.indexOf(q) === -1) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.at) - new Date(a.at));
  },

  label(p){
    p = p || this.params();
    const bits = [];
    if (p.searchval) bits.push(`matching “${p.searchval}”`);
    const range = Reporting.range(p.date_range);
    if (range) bits.push(`${fmtDate(range.from + 'T00:00:00')} to ${fmtDate(range.to + 'T00:00:00')}`);
    if (!can('allBranches')) bits.push('own actions only');
    return bits.length ? bits.join(', ') : 'All recorded activity';
  },

  roleLabel(a){
    if (ROLES[a.role]) return ROLES[a.role].label;
    /* INTEGRATION, SUPPORT_T2 and anything else the log carries. */
    return String(a.role || '—').replace(/_/g, ' ');
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function ActivityLogs() {
  let delay;
  $(".input_searchval_activity_logs").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(delay);
        ActivityLogsSearch();
      }
    })
    .on("input", function () {
      clearTimeout(delay);
      delay = setTimeout(function () {
        ActivityLogsSearch();
      }, 600);
    })
    .val("");

  $(".input_date_range_activity_logs").off("change").on("change", function () {
    ActivityLogsSearch();
  }).val("");

  $(".button_generate_activity_logs").off("click").on("click", function () {
    DisplayConfirmSwal("Generate the Activity Log report?", function () {
      var date_range = $(".input_date_range_activity_logs").val();
      var searchval = $(".input_searchval_activity_logs").val();
      GenerationOfPDF("activity_logs", "", searchval, date_range, "");
    }, "", "Generate", false);
  });

  ActivityLogsSearch();
}

function ActivityLogsSearch() {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/ActivityLogsSearch",
    type: "POST",
    dataType: "json",
    data: ActivityReg.params(),
    success: function (res) {
      $(".span_activity_logs_count").text(res.count);
      ActivityLogsTable(res.data);
      Swal.close();
    },
    error: function () {
      Swal.close();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

function ActivityLogsTable(data) {
  $(".table_activity_logs").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_activity_logs").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No activity matches these filters" },
    "data": data,
    "scrollY": "450px",
    "order": [[9, "DESC"]],
    "columns": [
      { data: "index" },
      { data: "fullname", "orderable": false },
      { data: "actor_type", "orderable": false },
      { data: "role", "orderable": false },
      { data: "activity_logs", "orderable": false },
      { data: "date_created", "orderable": false, className: "mono" },

      { data: "location", "orderable": false },
      { data: "device", "orderable": false },
      { data: "ip_address", "orderable": false },
      { data: "sorting", "visible": false }
    ]
  }));
}

Screens.activity = function () { ActivityLogs(); };

LocalAPI.on("Dashboard/ActivityLogsSearch", function (p) {
  const rows = ActivityReg.apply(p);

  return {
    success: true,
    count: rows.length,
    data: rows.map((a, n) => {
      const kind = ACTOR_KIND[a.actorType] || ACTOR_KIND.USER;
      return {
        index:         n + 1,
        fullname:      esc(a.actorName),
        actor_type:    a.actorType === 'USER' || !a.actorType ? esc(kind.label) : `<span class="lbadge ${kind.badge}">${kind.label}</span>`,
        role:          esc(ActivityReg.roleLabel(a)),
        activity_logs: esc(a.action),
        date_created:  fmtDateTime(a.at),
        location:      esc(a.location || '—'),
        device:        esc([a.device, a.browser].filter(Boolean).join(' · ') || '—'),
        ip_address:    `<span class="mono">${esc(a.ip || '—')}</span>`,
        sorting:       a.at
      };
    })
  };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  activity(){
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Activity Log</h1>
          <div class="screen_sub">
            All actions in this account: user, role, date and time, device and IP address. Entries cannot be edited or deleted.
            ${can('allBranches') ? '' : 'Your role reads its own actions only.'}
            <div class="mt-1"><i class="bi bi-clock me-1"></i>Clock: ${esc(SYSTEM.timeSync.source)}.
              Offset ${(SYSTEM.timeSync.offsetMs / 1000).toFixed(3)} s, checked ${SYSTEM.timeSync.checkedMinutesAgo} minutes ago.</div>
          </div>
        </div>
      </div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">

        <div class="d-flex flex-wrap gap-2 align-items-stretch">
          <div class="period-bar flex-grow-1" style="min-width:400px;">
            <div class="period-seg" style="flex:1.6 1 0;">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-search"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_searchval_activity_logs"
                       placeholder="User, action, address..." />
              </div>
            </div>
            <div class="period-seg">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted icon_date_range">
                  <i class="bi bi-calendar3"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_date_range input_date_range_activity_logs"
                       placeholder="Date From &amp; Date To" readonly />
              </div>
            </div>
          </div>
          <div class="lcard" style="padding:6px 16px;display:flex;flex-direction:column;justify-content:center;">
            <span class="stat-label" style="margin-bottom:0;">Entries</span>
            <span class="mono fw-bold fs_16 span_activity_logs_count">—</span>
          </div>
        </div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table_activity_logs">
            <thead>
              <tr>
                <th>NO.</th>
                <th>FULL NAME</th>
                <th>ACTOR</th>
                <th>ROLE</th>
                <th>ACTIVITY</th>
                <th>TIMESTAMP</th>

                <th>LOCATION</th>
                <th>DEVICE</th>
                <th>IP ADDRESS</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        ${Callout('info', `<strong>EPI support access is logged here too.</strong> EPI staff access to this account is time-limited and recorded here with the reason. Address and device are kept for audit under RA 10173 and used for nothing else.`)}
      </div></div>

      <div class="text-center mt-3">
        <button class="lbtn lbtn-accent button_generate_activity_logs">
          <i class="bi bi-file-earmark-arrow-down"></i> Generate to PDF
        </button>
      </div>`;
  }
});

/* ============================================================
   What this screen can export. A log has no tax ladder under it, so it is
   laid out as a listing — see Reporting.paper.listing.
   ============================================================ */
Reporting.source('activity_logs', {
  title: 'Activity Log',
  kind: 'listing',

  search(searchval, date_range){
    return ActivityReg.apply({ searchval, date_range });
  },

  periodLabel(searchval, date_range){
    return ActivityReg.label({ searchval, date_range });
  },

  columns(){
    return [
      { label:'Full Name', value: a => a.actorName },
      { label:'Actor',     value: a => (ACTOR_KIND[a.actorType] || ACTOR_KIND.USER).label },
      { label:'Role',      value: a => ActivityReg.roleLabel(a) },
      { label:'Activity',  value: a => a.action },
      { label:'Timestamp', value: a => fmtDateTime(a.at) },
      { label:'Location',  value: a => a.location || '—' },
      { label:'Device',    value: a => [a.device, a.browser].filter(Boolean).join(' · ') || '—' },
      { label:'IP Address',value: a => a.ip || '—' }
    ];
  }
});
