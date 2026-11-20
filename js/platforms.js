/* ============================================================
   platforms.js — Connections

   Where sales come from, and whose sales they are. Those are two different
   questions and the screen keeps them apart, because conflating them is how a
   marketplace ends up issuing invoices under its own registration for goods it
   never sold.

     - A connected source is plumbing. An ERP posting over the API, a seller
       centre dropping a file each night, a marketplace connector. It says how
       a sale reached us and nothing more.

     - A seller identity is the answer to whose sale it was. Every platform has
       its own name for a store — a numeric seller id, a shop code — and that
       name means nothing to the BIR. What matters is the TIN it maps to,
       because that is the registration the invoice is issued under.

   The rule that follows from this is the whole point of the screen: a sale
   arriving under a seller identity we cannot map to a registered TIN is not
   issued. It is held. Guessing would produce a document in the wrong
   taxpayer's name and a number out of the wrong series, and both are worse
   than a held order somebody has to go and fix.

   RR 11-2025 brings e-marketplaces and their sellers into scope, and a
   marketplace may facilitate issuance for the sellers on it. That does not
   make the invoice the marketplace's. It stays the seller's, under the
   seller's own registration — which is exactly what the mapping here records.

   This account is registered to one taxpayer, so every identity on it maps to
   that one TIN and the screen says so when you try to link a different one.
   An account that issues for many sellers is a different kind of registration
   and is not what this one is.
   ============================================================ */

const PlatReg = {

  KINDS: {
    MARKETPLACE: { label:'Marketplace',        ico:'bi-shop',
                   note:'Orders placed on another seller\'s storefront.' },
    ERP:         { label:'ERP / own system',   ico:'bi-diagram-3',
                   note:'The taxpayer\'s own system, posting each sale.' },
    STOREFRONT:  { label:'Own storefront',     ico:'bi-bag',
                   note:'The taxpayer\'s own online shop or seller center.' },
    ACCOUNTING:  { label:'Accounting package', ico:'bi-calculator',
                   note:'A bookkeeping system that raises the sale first.' }
  },

  /** Connections on this account. Revoked ones stay — the documents they
      issued are still in the register and still have to be accounted for. */
  all(){
    const db = Store.db;
    return (db.platforms || []).filter(p => p.tenantId === CU.tenantId);
  },

  sellers(platformId){
    const db = Store.db;
    return (db.sellers || [])
      .filter(s => s.tenantId === CU.tenantId)
      .filter(s => !platformId || s.platformId === platformId);
  },

  /** Documents that came in through a given connection. */
  countFor(platformId){
    return Auth.visibleInvoices().filter(i => i.platformId === platformId).length;
  },

  live(){ return this.all().filter(p => p.status === 'CONNECTED'); },

  totals(){
    const all = this.all();
    const sellers = this.sellers();
    return {
      connected: this.live().length,
      revoked:   all.filter(p => p.status !== 'CONNECTED').length,
      documents: Auth.visibleInvoices().filter(i => i.platformId).length,
      linked:    sellers.filter(s => s.status === 'LINKED').length,
      unlinked:  sellers.filter(s => s.status === 'UNLINKED').length,
      held:      sellers.filter(s => s.status === 'UNLINKED')
                        .reduce((n, s) => n + (s.heldOrders || 0), 0)
    };
  },

  /* Managing a connection is granting or withdrawing the ability to issue in
     this taxpayer's name. That sits with whoever administers the account, not
     with whoever happens to be issuing today. */
  mayManage(){ return can('users'); },

  /** Half a key, and never the whole of one after it is first shown. */
  mask(key){
    if (!key) return '—';
    return String(key).slice(0, 9) + '…' + String(key).slice(-4);
  },

  newKey(){ return 'epi_live_' + keycode(4).toLowerCase() + keycode(4).toLowerCase(); }
};

/* Nothing here is wired to a real ERP or marketplace, so there is no live
   connector to actually post a sale. These stand in for the buyer on an
   order a connector would hand us — invented, the way every other buyer in
   this demo is. */
const DEMO_BUYERS = [
  'Marisol Reyes', 'Jun Carlo Santos', 'Faith Anne Cruz', 'Bea Lorenzo',
  'Miguel Torres', 'Anna Liza Ramos', 'Patrick Uy', 'Grace Villanueva'
];

/* ============================================================
   Screen wiring
   ============================================================ */

function PlatformsScreen() {
  $(".button_repeat_platforms").off("click").on("click", PlatformsSearch);

  TabToggling(".tab_button_platforms_1", ".tab_content_platforms_1");
  $(".tab_button_platforms_1").off("click").on("click", function () {
    TabToggling(".tab_button_platforms_1", ".tab_content_platforms_1");
  });
  $(".tab_button_platforms_2").off("click").on("click", function () {
    TabToggling(".tab_button_platforms_2", ".tab_content_platforms_2");
  });

  $(document).off("click", ".button_platform_pause")
    .on("click", ".button_platform_pause", function () {
      const id = $(this).data("id");
      const resuming = $(this).data("action") === 'RESUME';
      DisplayConfirmSwal(
        resuming
          ? `<span class="fw-bold fs_18 text-dark">Resume this connection?</span>
             <span class="fs_14 text-muted">Orders held while paused are issued on the next post.</span>`
          : `<span class="fw-bold fs_18 text-dark">Pause this connection?</span>
             <span class="fs_14 text-muted">Incoming sales are held until you resume. The API key stays valid.</span>`,
        function () { PlatformAct("PlatformPause", { platform_id:id, resume: resuming ? 1 : 0 }); },
        null, resuming ? 'Resume' : 'Pause');
    });

  $(document).off("click", ".button_platform_rotate")
    .on("click", ".button_platform_rotate", function () {
      const id = $(this).data("id");
      DisplayConfirmSwal(
        `<span class="fw-bold fs_18 text-dark">Issue a new key?</span>
         <span class="fs_14 text-muted">The current key stops working as soon as the new one is created. Update the new key in the connected system before the next sale is posted.</span>`,
        function () { PlatformAct("PlatformRotate", { platform_id:id }); },
        null, 'Issue new key');
    });

  $(document).off("click", ".button_platform_revoke")
    .on("click", ".button_platform_revoke", function () {
      const id = $(this).data("id");
      const last = PlatReg.live().length === 1;
      DisplayConfirmSwal(
        `<span class="fw-bold fs_18 text-dark">Revoke this connection?</span>
         <span class="fs_14 text-muted">The API key is deleted and cannot be restored. Connecting again issues a new key. Documents already issued through it are not affected and stay in the register.
         ${last ? '<br><br><strong>This is the only connection currently issuing on this ' +
                  'account.</strong> Revoking it stops issuance until another one is set up.' : ''}</span>`,
        function () { PlatformAct("PlatformRevoke", { platform_id:id }); },
        null, 'Revoke', true);
    });

  $(document).off("click", ".button_platform_simulate")
    .on("click", ".button_platform_simulate", function () {
      const id = $(this).data("id");
      DisplayLoadingSwal();
      $.ajax({
        url: "/Portal/SPIStradcom/Dashboard/PlatformSimulate",
        method: "POST",
        dataType: "json",
        data: { platform_id: id },
        success: function (res) {
          Swal.close();
          DisplayDelaySwal(res.success ? (res.issued ? "success" : "info") : "info", "", res.message);
          PlatformsSearch();
        }
      });
    });

  $(document).off("click", ".button_seller_link")
    .on("click", ".button_seller_link", function () {
      ModalSellerLink($(this).data("id"));
    });

  $(document).off("click", ".button_seller_suspend")
    .on("click", ".button_seller_suspend", function () {
      const id = $(this).data("id");
      const resuming = $(this).data("action") === 'RESUME';
      DisplayConfirmSwal(
        resuming
          ? `<span class="fw-bold fs_18 text-dark">Reinstate this seller identity?</span>
             <span class="fs_14 text-muted">Sales under it will be issued again under its linked TIN.</span>`
          : `<span class="fw-bold fs_18 text-dark">Suspend this seller identity?</span>
             <span class="fs_14 text-muted">Sales under it are held, not issued. The TIN link and issued documents are kept.</span>`,
        function () { PlatformAct("SellerSuspend", { seller_id:id, resume: resuming ? 1 : 0 }); },
        null, resuming ? 'Reinstate' : 'Suspend');
    });

  PlatformsSearch();
}

Screens.platforms = function () { PlatformsScreen(); };

function PlatformsSearch() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/PlatformSearch",
    method: "POST",
    dataType: "json",
    success: function (res) {
      if (!res.success) return;
      PlatformsTotals(res.data_1);
      $(".div_platform_list").html(res.data_2);
      PlatformsSellerTable(res.data_3);
    }
  });
}

function PlatformsTotals(t) {
  $(".span_platforms_connected").text(t.connected);
  $(".span_platforms_connected_note").text(
    t.revoked ? `${t.revoked} paused or revoked` : 'None paused or revoked');
  $(".span_platforms_documents").text(t.documents);
  $(".span_platforms_linked").text(t.linked);
  $(".span_platforms_unlinked").text(t.unlinked)
    .toggleClass("text-danger", !!t.unlinked)
    .toggleClass("text-success", !t.unlinked);
  $(".span_platforms_unlinked_note").text(
    t.unlinked ? `${t.held} order(s) held` : 'Every store maps to a TIN');
  $(".div_platform_held_note").toggleClass("d-none", !t.unlinked);
}

function PlatformsSellerTable(data) {
  $(".table_sellers").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_sellers").DataTable({
    "language": { "emptyTable": "No seller identity has been seen on this account" },
    "dom": "<'top'f>rtp<'bottom'l>",
    "searching": false,
    "data": data,
    "destroy": true,
    "info": true,
    "scrollX": true,
    "autoWidth": false,
    "paging": true,
    "pageLength": 10,
    "order": [[0, "ASC"]],
    "columns": [
      { data: "store" },
      { data: "external", orderable: false },
      { data: "platform", orderable: false },
      { data: "tin", orderable: false },
      { data: "branch", orderable: false },
      { data: "status", orderable: false },
      { data: "documents", className: "text-center", orderable: false },
      { data: "actions", className: "text-end", orderable: false }
    ]
  });
}

function PlatformAct(route, data) {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/" + route,
    method: "POST",
    dataType: "json",
    data: data,
    success: function (res) {
      Swal.close();
      if (res.success && res.key){ ShowNewKey(res.key, res.message); }
      else DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
      PlatformsSearch();
    }
  });
}

/** Shown once, because after this it is stored the way a secret is stored:
    not in a form anybody can read back. */
function ShowNewKey(key, message) {
  UI.openModal('New API key',
    `<div class="fs_13 mb-3">${esc(message)}</div>
     ${Callout('warn', `This is the only time the key is shown in full. If it is lost, issue a new key.`, {cls:'mb-3'})}
     <pre class="code" style="user-select:all;">${esc(key)}</pre>
     <div class="fs_11 text-muted mt-2">In this demonstration the key does nothing: there
     is no gateway on the other side of it. What is real is that it exists, that it can be
     replaced, and that replacing it is in the activity log.</div>`,
    `<button class="lbtn lbtn-primary" onclick="UI.closeModal()">Done</button>`);
}

/** Linking a store to a registration — the one place a TIN is typed on this
    screen, and the one place it is checked. */
function ModalSellerLink(id) {
  const s = PlatReg.sellers().find(x => x.id === id);
  if (!s) return;
  const branches = Auth.visibleBranches();

  UI.openModal(`Link ${s.storeName}`,
    `<div class="card bg-light border rounded-3 p-3 mb-3 fs_13">
       <div class="d-flex justify-content-between py-1">
         <span class="text-muted">Arrives from</span>
         <span class="fw-semibold">${esc((PlatReg.all().find(p => p.id === s.platformId) || {}).name || '—')}</span></div>
       <div class="d-flex justify-content-between py-1">
         <span class="text-muted">Known there as</span>
         <span class="mono">${esc(s.externalId)}</span></div>
       <div class="d-flex justify-content-between py-1">
         <span class="text-muted">Orders held</span>
         <span class="${s.heldOrders ? 'text-danger fw-semibold' : ''}">${s.heldOrders || 0}</span></div>
     </div>

     <div class="mb-3">
       <span class="d-block fw-semibold fs_13 text-dark mb-2">Registered TIN</span>
       <input type="text" maxlength="15" class="form-control height_40 fs_14 shadow-none input_seller_tin"
              placeholder="000-000-000" value="${esc(CT.tin)}">
       <div class="fs_11 text-muted mt-1">
         This account is registered to ${esc(CT.name)}, TIN ${esc(CT.tin)}. A store on it can
         only issue under that registration.
       </div>
     </div>

     <div class="mb-2">
       <span class="d-block fw-semibold fs_13 text-dark mb-2">Issue into which branch's series</span>
       <select class="form-select height_40 fs_14 shadow-none select_seller_branch">
         ${branches.map(b => `<option value="${b.id}">${esc(b.name)} (${esc(b.code)})</option>`).join('')}
       </select>
       <div class="fs_11 text-muted mt-1">
         Every document needs a number, and numbers belong to a branch. A store that is not
         physically anywhere issues into the branch it is registered against, usually the
         head office.
       </div>
     </div>`,

    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn lbtn-primary button_seller_link_save">Link this store</button>`);

  EnhanceSelect('.select_seller_branch', $(document.body));

  $(".button_seller_link_save").off("click").on("click", function () {
    PlatformAct("SellerLink", {
      seller_id: id,
      tin:       $(".input_seller_tin").val(),
      branch_id: $(".select_seller_branch").val()
    });
    UI.closeModal();
  });
}

/* ============================================================
   The server side of the screen.
   ============================================================ */

LocalAPI.on("Dashboard/PlatformSearch", function () {
  const db = Store.db;
  const may = PlatReg.mayManage();
  const platforms = PlatReg.all();

  const card = p => {
    const kind = PlatReg.KINDS[p.kind] || PlatReg.KINDS.ERP;
    const method = CONNECTIONS[p.method] || {};
    const docs = PlatReg.countFor(p.id);
    const dead = p.status === 'REVOKED';
    const sellers = PlatReg.sellers(p.id);

    const actions = !may || dead ? '' : `
      <div class="d-flex gap-2 flex-wrap">
        <button class="lbtn lbtn-sm lbtn-hero button_platform_pause"
                data-id="${p.id}" data-action="${p.status === 'PAUSED' ? 'RESUME' : 'PAUSE'}">
          <i class="bi ${p.status === 'PAUSED' ? 'bi-play' : 'bi-pause'}"></i>
          ${p.status === 'PAUSED' ? 'Resume' : 'Pause'}
        </button>
        <button class="lbtn lbtn-sm lbtn-hero button_platform_rotate"
                data-id="${p.id}"><i class="bi bi-key"></i> New key</button>
        <button class="lbtn lbtn-sm lbtn-danger button_platform_revoke"
                data-id="${p.id}"><i class="bi bi-x-circle"></i> Revoke</button>
      </div>`;

    /* The one button on this screen that isn't managing the connection — it is
       standing in for it. Available to whoever may cause documents to be
       issued at all, same as bulk import, since that is exactly what this
       does: posts one sale the way this connection would, unattended. */
    const simulate = (!dead && can('issue') && !issuesOnOwnSystem()) ? `
      <button class="lbtn lbtn-sm lbtn-accent button_platform_simulate"
              data-id="${p.id}">
        <i class="bi bi-lightning-charge"></i> Simulate incoming order
      </button>` : '';

    return `
      <div class="lcard lcard-hero mb-3 ${dead ? 'opacity-75' : ''}"><div class="lcard-body" style="gap:0;">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div class="d-flex gap-3">
            <div class="fs_25" style="color:rgba(255,255,255,.55);"><i class="bi ${kind.ico}"></i></div>
            <div>
              <div class="drill-title" style="font-size:16px;">${esc(p.name)}</div>
              <div class="hero-sub">${esc(kind.label)} · reaches us by
                ${esc(method.label || p.method)}</div>
              <div class="hero-sub mt-1">${esc(kind.note)}</div>
            </div>
          </div>
          <div class="text-end">
            ${badge('connection', p.status)}
            <div class="hero-sub mt-1">${docs} invoice(s) issued through it</div>
          </div>
        </div>

        <div class="hero-rule my-3"></div>

        <div class="row g-3 fs_12">
          <div class="col-12 col-lg-4">
            <div class="hero-label">Authorized by</div>
            <div>${esc(p.authorizedBy)}</div>
            <div class="hero-sub">${fmtDateTime(p.authorizedAt)}</div>
          </div>
          <div class="col-12 col-lg-4">
            <div class="hero-label">What it may do</div>
            <div>${esc(p.scope)}</div>
          </div>
          <div class="col-12 col-lg-4">
            <div class="hero-label">Key</div>
            <div class="mono">${dead ? '<span class="hero-sub">destroyed</span>'
                                     : esc(PlatReg.mask(p.key))}</div>
            <div class="hero-sub">
              ${dead ? `Revoked ${fmtDate(p.revokedAt)} by ${esc(p.revokedBy || '—')}`
                     : (p.lastUsedAt ? `Last used ${fmtDateTime(p.lastUsedAt)}`
                                     : 'Never used')}
            </div>
          </div>
        </div>

        ${sellers.length ? `
          <div class="hero-sub mt-3">
            ${sellers.length} seller identit${sellers.length === 1 ? 'y' : 'ies'} arrive
            through this connection${
              sellers.some(s => s.status === 'UNLINKED')
                ? ', <span style="color:#f87171;font-weight:600;">one or more of them unlinked</span>' : ''}.
          </div>` : ''}

        ${dead ? `
          ${Callout('info', `${docs
              ? `This connection is finished and stays on the list because ${docs}
                 invoice(s) came through it. Removing the row would not remove the
                 documents — it would only make them harder to explain.`
              : `This connection is finished and issued nothing into the register.
                 It stays on the list because the authorization and its withdrawal are
                 both part of how this account came to be issuing.`}`, {cls:'mt-3'})}` : ''}

        ${(simulate || actions) ? `
          <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mt-3">
            <div>${simulate}</div>
            <div>${actions}</div>
          </div>` : ''}
      </div></div>`;
  };

  const sellerRow = s => {
    const p = platforms.find(x => x.id === s.platformId) || {};
    const branch = (db.branches.find(b => b.id === s.branchId) || {}).name;
    const docs = Auth.visibleInvoices().filter(i => i.sellerId === s.id).length;

    let actions = '';
    if (may && s.status === 'UNLINKED'){
      actions = `<button class="lbtn lbtn-sm lbtn-ghost button_seller_link"
                         data-id="${s.id}">Link to a TIN</button>`;
    } else if (may && s.status !== 'UNLINKED'){
      actions = `<button class="lbtn lbtn-sm lbtn-subtle button_seller_suspend"
                         data-id="${s.id}" data-action="${s.status === 'SUSPENDED' ? 'RESUME' : 'SUSPEND'}">
                   ${s.status === 'SUSPENDED' ? 'Reinstate' : 'Suspend'}</button>`;
    }

    return {
      store:    `<span class="fw-semibold">${esc(s.storeName)}</span>` +
                (s.heldOrders ? `<br><span class="fs_11 text-danger">${s.heldOrders} order(s) held</span>` : ''),
      external: `<span class="mono fs_12">${esc(s.externalId)}</span>`,
      platform: esc(p.name || '—'),
      tin:      s.tin ? `<span class="mono fs_12">${esc(s.tin)}</span>`
                      : '<span class="text-danger">Not known</span>',
      branch:   branch ? esc(branch) : '<span class="text-muted">—</span>',
      status:   s.status === 'LINKED' ? 'Linked' : badge('seller', s.status),
      documents: docs,
      actions
    };
  };

  return {
    success: true,
    data_1: PlatReg.totals(),
    data_2: platforms.length
      ? platforms.map(card).join('')
      : `<div class="lcard"><div class="empty">
           <div class="empty-ico"><i class="bi bi-plug"></i></div>
           <div class="empty-title">Nothing connected yet</div>
           <div class="empty-sub">Sales will reach this account once a platform, marketplace or
           POS is connected. Nothing is issued until then.</div>
         </div></div>`,
    data_3: PlatReg.sellers().map(sellerRow)
  };
});

/** The three actions on a connection, which differ only in how final they are. */
LocalAPI.on("Dashboard/PlatformPause", function (p) {
  const db = Store.db;
  if (!PlatReg.mayManage())
    return { success:false, message:'Your role cannot manage connections.' };

  const conn = (db.platforms || []).find(x => x.id === p.platform_id && x.tenantId === CU.tenantId);
  if (!conn) return { success:false, message:'That connection is not on this account.' };
  if (conn.status === 'REVOKED')
    return { success:false, message:'That connection was revoked. Connect again to use it.' };

  const resume = String(p.resume) === '1';
  conn.status = resume ? 'CONNECTED' : 'PAUSED';
  logActivity(db, { action:`${resume ? 'Resumed' : 'Paused'} connection — ${conn.name}` });
  Store.save(db);

  return { success:true,
           message: resume
             ? `${conn.name} is issuing again.`
             : `${conn.name} is paused. Sales arriving through it are held until you resume.` };
});

LocalAPI.on("Dashboard/PlatformRotate", function (p) {
  const db = Store.db;
  if (!PlatReg.mayManage())
    return { success:false, message:'Your role cannot manage connections.' };

  const conn = (db.platforms || []).find(x => x.id === p.platform_id && x.tenantId === CU.tenantId);
  if (!conn) return { success:false, message:'That connection is not on this account.' };
  if (conn.status === 'REVOKED')
    return { success:false, message:'That connection was revoked. There is no key to replace.' };

  const key = PlatReg.newKey();
  conn.key = key;
  conn.rotatedAt = new Date().toISOString();
  logActivity(db, { action:`Issued a new API key for connection: ${conn.name}` });
  Store.save(db);

  return { success:true, key,
           message:`${conn.name} has a new key. The previous key is no longer valid.` };
});

LocalAPI.on("Dashboard/PlatformRevoke", function (p) {
  const db = Store.db;
  if (!PlatReg.mayManage())
    return { success:false, message:'Your role cannot manage connections.' };

  const conn = (db.platforms || []).find(x => x.id === p.platform_id && x.tenantId === CU.tenantId);
  if (!conn) return { success:false, message:'That connection is not on this account.' };
  if (conn.status === 'REVOKED')
    return { success:false, message:'That connection is already revoked.' };

  const last = PlatReg.live().length === 1;
  conn.status = 'REVOKED';
  conn.key = null;                       /* gone, not hidden */
  conn.revokedAt = new Date().toISOString();
  conn.revokedBy = CU.name;

  /* The identities that arrived through it stop issuing with it. They are not
     deleted: what they already issued is still in the register under them. */
  (db.sellers || []).forEach(s => {
    if (s.platformId === conn.id && s.status === 'LINKED') s.status = 'SUSPENDED';
  });

  logActivity(db, { action:`Revoked connection: ${conn.name}. Its API key was deleted.` });
  Store.save(db);

  return { success:true,
           message: last
             ? `${conn.name} is revoked and nothing is issuing on this account now. ` +
               `The invoices it issued are untouched.`
             : `${conn.name} is revoked. The invoices it issued are untouched.` };
});

/** Stands in for the connector, because nothing here is wired to a real one.
    Picks one seller identity behind this connection and posts a sale through
    it exactly the way that identity's own state says a real post would land —
    issued, held for an unmapped store, or held because the connection itself
    is paused. Gated the same as bulk import: whoever may cause a document to
    be issued at all may trigger this, because that is what it does. */
LocalAPI.on("Dashboard/PlatformSimulate", function (p) {
  if (issuanceBlock() && !outageQueueing()) return { success:false, message:issuanceBlock() };
  if (!can('issue'))
    return { success:false, message:'Your role cannot post incoming orders.' };
  if (issuesOnOwnSystem())
    return { success:false, message:'This account only sends the sales data from your own system to the BIR. It does not issue invoices itself.' };

  const db = Store.db;
  const platform = (db.platforms || []).find(x => x.id === p.platform_id && x.tenantId === CU.tenantId);
  if (!platform) return { success:false, message:'That connection is not on this account.' };
  if (platform.status === 'REVOKED')
    return { success:false, message:'That connection is revoked. There is nothing left to post through it.' };

  /* A branch-scoped role can only land an order in a branch it can see —
     the same rule that keeps a reading from showing another branch's day. */
  const visible = Auth.visibleBranches().map(b => b.id);
  const candidates = PlatReg.sellers(platform.id).filter(s => !s.branchId || visible.indexOf(s.branchId) > -1);
  if (!candidates.length)
    return { success:false, message:'No seller identity in your scope is registered against this connection.' };

  const seller = candidates[Math.floor(Math.random() * candidates.length)];

  if (platform.status === 'PAUSED'){
    logActivity(db, { actorType:'SYSTEM', actorName:platform.name, role:'INTEGRATION',
      action:`Order arrived through ${platform.name} while paused: held, not issued` });
    Store.save(db);
    return { success:true, issued:false,
             message:`An order arrived through ${platform.name}. The connection is paused, so the order is held. Resume the connection to issue it on the next post.` };
  }

  if (seller.status !== 'LINKED'){
    seller.heldOrders = (seller.heldOrders || 0) + 1;
    seller.firstSeenAt = seller.firstSeenAt || new Date().toISOString();
    logActivity(db, { actorType:'SYSTEM', actorName:platform.name, role:'INTEGRATION',
      action:`Order arrived under ${seller.status === 'SUSPENDED' ? 'suspended' : 'unmapped'} store ` +
             `${seller.storeName} (${seller.externalId}): held, not issued` });
    Store.save(db);
    return { success:true, issued:false,
             message:`An order arrived under ${seller.storeName}. The store is ` +
                     `${seller.status === 'SUSPENDED' ? 'suspended' : 'not linked to a registered TIN'}, ` +
                     `so the order is held and not issued. ${seller.heldOrders} order(s) now held.` };
  }

  const branch = db.branches.find(b => b.id === seller.branchId && b.tenantId === CU.tenantId);
  if (!branch) return { success:false, message:'The branch this store issues into is not available to your role.' };

  const items = (db.items || []).filter(it => it.tenantId === CT.id);
  if (!items.length) return { success:false, message:'This account has no items to build an order from.' };

  const lineCount = 1 + Math.floor(Math.random() * Math.min(2, items.length));
  const chosen = [];
  while (chosen.length < lineCount){
    const it = items[Math.floor(Math.random() * items.length)];
    if (chosen.indexOf(it) === -1) chosen.push(it);
  }
  const lines = chosen.map(it => ({
    itemId: it.id, desc: it.desc, sku: it.sku,
    qty: 1 + Math.floor(Math.random() * 3), unit: it.unit, unitPrice: it.price, treatment: it.treatment
  }));

  const buyerName = DEMO_BUYERS[Math.floor(Math.random() * DEMO_BUYERS.length)];

  /* EPI is down: the order is kept and issued when service returns. */
  if (outageQueueing()){
    const q = OutageQueue.accept({
      branchId: branch.id, at: new Date().toISOString(), buyer:{ name:buyerName },
      lines: lines.map(l => ({ itemId:l.itemId, qty:l.qty, unitPrice:l.unitPrice })),
      paymentStatus:'PAID', paymentMethod: platform.method === 'API' ? 'Bank Transfer' : 'Online Payment'
    }, { platformId:platform.id, sellerId:seller.id, issuedBy:platform.name,
         issuedVia:`${(CONNECTIONS[platform.method] || {}).label || platform.method} — ${seller.storeName}` });
    return q.success ? { success:true, issued:false, queued:true, message:q.message } : q;
  }

  const totals = computeTotals(lines, 0, {});
  const number = allocateNumber(db, CT.id, branch.id, 'INVOICE');
  const now = new Date().toISOString();

  const inv = {
    id: uid('inv'), tenantId: CT.id, branchId: branch.id,
    docType:'INVOICE', docStatus:'ISSUED', number,
    issuedAt: now,
    buyer: { name: buyerName, tin:null, address:null }, scpwd: null,
    lines, discount:0, totals,
    currency:'PHP', keycode: keycode(8),
    paymentStatus:'PAID',
    paymentMethod: platform.method === 'API' ? 'Bank Transfer' : 'Online Payment',
    platformId: platform.id, sellerId: seller.id,
    /* No address came with the order — same gap bulk import leaves — so
       delivery starts pending rather than pretending an address exists. */
    deliveryStatus:'PENDING', deliveryAttempts:0,
    /* Not a person's name. That is the point of the button. */
    issuedBy: platform.name,
    issuedVia: `${(CONNECTIONS[platform.method] || {}).label || platform.method} — ${seller.storeName}`
  };
  db.invoices.push(inv);
  settleTransmission(inv);
  platform.lastUsedAt = now;

  logActivity(db, { actorType:'SYSTEM', actorName:platform.name, role:'INTEGRATION',
    action:`Issued invoice ${number}: order from ${seller.storeName} via ${platform.name}` });
  Store.save(db);

  return { success:true, issued:true,
           message:`Order posted. ${number} issued for ${peso(totals.totalDue)} into the ${branch.name} series. Created automatically.` };
});

LocalAPI.on("Dashboard/SellerLink", function (p) {
  const db = Store.db;
  if (!PlatReg.mayManage())
    return { success:false, message:'Your role cannot link seller identities.' };

  const s = (db.sellers || []).find(x => x.id === p.seller_id && x.tenantId === CU.tenantId);
  if (!s) return { success:false, message:'That seller identity is not on this account.' };
  if (s.status !== 'UNLINKED')
    return { success:false, message:'That store is already linked.' };

  const tin = String(p.tin || '').trim();
  if (!tin) return { success:false, message:'A store cannot be linked without a TIN.' };

  /* The guard the screen exists for. One registration on this account means one
     TIN, and issuing under any other would be issuing somebody else's invoice
     out of our series. */
  if (tin !== CT.tin){
    return { success:false,
             message:`This account is registered to ${CT.name}, TIN ${CT.tin}. ` +
                     `A store on it cannot issue under ${tin}, because that would issue ` +
                     `another taxpayer's invoice from this taxpayer's series.` };
  }

  const branch = db.branches.find(b => b.id === p.branch_id && b.tenantId === CU.tenantId);
  if (!branch) return { success:false, message:'Select the branch whose series this store issues into.' };

  const held = s.heldOrders || 0;
  s.tin = tin;
  s.branchId = branch.id;
  s.status = 'LINKED';
  s.linkedBy = CU.name;
  s.linkedAt = new Date().toISOString();
  s.heldOrders = 0;

  logActivity(db, {
    action:`Linked seller identity ${s.externalId} (${s.storeName}) to TIN ${tin}, ` +
           `issuing into ${branch.name}` + (held ? `, ${held} held order(s) released` : '')
  });
  Store.save(db);

  return { success:true,
           message: held
             ? `${s.storeName} is linked. Its ${held} held order(s) will be issued on the next post.`
             : `${s.storeName} is linked and will issue into ${branch.name}.` };
});

LocalAPI.on("Dashboard/SellerSuspend", function (p) {
  const db = Store.db;
  if (!PlatReg.mayManage())
    return { success:false, message:'Your role cannot manage seller identities.' };

  const s = (db.sellers || []).find(x => x.id === p.seller_id && x.tenantId === CU.tenantId);
  if (!s) return { success:false, message:'That seller identity is not on this account.' };
  if (s.status === 'UNLINKED')
    return { success:false, message:'That store is not linked to anything yet.' };

  const resume = String(p.resume) === '1';
  s.status = resume ? 'LINKED' : 'SUSPENDED';
  logActivity(db, {
    action:`${resume ? 'Reinstated' : 'Suspended'} seller identity ${s.externalId} (${s.storeName})`
  });
  Store.save(db);

  return { success:true,
           message: resume
             ? `${s.storeName} is issuing again.`
             : `${s.storeName} is suspended. Sales arriving under it are held.` };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  platforms(){
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Connections</h1>
          <div class="screen_sub">
            The systems and stores that send sales to this account, and the TIN each one issues under.
          </div>
        </div>
        <button class="lbtn lbtn-ghost button_repeat_platforms">
          <i class="bi bi-arrow-repeat"></i> Refresh
        </button>
      </div>

      <div class="row g-2 mb-2">
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Connections</span>
            <div class="stat-value mono span_platforms_connected">—</div>
            <span class="stat-note span_platforms_connected_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Invoices through them</span>
            <div class="stat-value mono span_platforms_documents">—</div>
            <span class="stat-note">Issued without anyone typing them in</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Stores linked to a TIN</span>
            <div class="stat-value mono" style="color:var(--green-600);"><span class="span_platforms_linked">—</span></div>
            <span class="stat-note">Able to issue</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Unlinked</span>
            <div class="stat-value mono span_platforms_unlinked">—</div>
            <span class="stat-note span_platforms_unlinked_note">&nbsp;</span>
          </div></div>
        </div>
      </div>

      ${Callout('warn', `<strong>Some orders are on hold.</strong> They came from a store that is not linked to a TIN, so no invoice was issued. Link the store below and the orders are issued on the next post.`, {cls:'mb-3 d-none div_platform_held_note'})}

      <div class="d-flex gap-2 mb-3 overflow_x_scroll">
        <div class="tab_button tab_button_platforms_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">CONNECTIONS</div>
        <div class="tab_button tab_button_platforms_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">STORES AND TINS</div>
      </div>

      <div class="tab_content tab_content_platforms_1">
        ${can('issue') ? `
        ${Callout('info', `<strong>Demo only. No ERP or marketplace is connected.</strong>
          <em>Simulate incoming order</em> posts one sale as a connector would. The invoice is issued automatically, or held if the connection is paused or the store is not linked to a TIN.`, {cls:'mb-3'})}` : ''}
        <div class="div_platform_list"></div>
      </div>

      <div class="tab_content tab_content_platforms_2 d-none">
        ${Callout('info', `<strong>Link each store to a TIN.</strong> Each platform has its own name for a shop, such as a seller ID or shop code. The BIR does not know these names. The invoice is issued under the TIN you link here.`, {cls:'mb-3'})}

        <div class="lcard"><div class="lcard-body">
          <div class="table-responsive">
            <table class="table nowrap table_sellers">
              <thead>
                <tr>
                  <th>STORE</th>
                  <th>STORE NAME IN THE PLATFORM</th>
                  <th>ARRIVES FROM</th>
                  <th>TIN USED</th>
                  <th>BRANCH</th>
                  <th>STATUS</th>
                  <th class="text-center">INVOICES</th>
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
