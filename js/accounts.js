/* ============================================================
   accounts.js — Account Management

   The source portal's account_management screen: a search box, a Create
   Account button, a table with a modify pencil, and a Generate to PDF button.
   The modal is its modal, with the fields this product actually has.

   Three things here are ours, and each is a rule rather than a preference:

     - Creating an account never sets a password. An account is created as an
       invitation and becomes usable only when the person it belongs to
       activates it themselves. An administrator who could set someone's
       password could act as them, and the activity log would name the wrong
       person.
     - An account is disabled, never deleted. Its name is attached to every
       document it issued, and removing it would leave those documents signed
       by nobody.
     - The last active owner cannot be disabled or demoted, and nobody can
       disable themselves. Either would lock the taxpayer out of their own
       records.
   ============================================================ */

const AccountReg = {

  params(){
    return {
      searchval: $(".input_searchval_account_management").val() || "",
      statusval: $(".select_status_account_management").val() || ""
    };
  },

  /** Accounts of this taxpayer, narrowed by the filter row. */
  apply(p){
    p = p || {};
    const db = Store.db;
    const q = String(p.searchval || '').trim().toLowerCase();

    return (db.users || [])
      .filter(u => u.tenantId === CU.tenantId)
      .filter(u => !p.statusval || this.status(u) === p.statusval)
      .filter(u => {
        if (!q) return true;
        const b = u.branchId ? db.branches.find(x => x.id === u.branchId) : null;
        const hay = [u.name, u.email, u.position, ROLES[u.roleKey] && ROLES[u.roleKey].label,
                     b && b.name].join(' ').toLowerCase();
        return hay.indexOf(q) > -1;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Seeded users carry `active` only; anything created here carries a status. */
  status(u){
    if (u.status) return u.status;
    return u.active === false ? 'DISABLED' : 'ACTIVE';
  },

  scope(u){
    const db = Store.db;
    if (ROLES[u.roleKey] && ROLES[u.roleKey].scope === 'org') return 'All branches';
    const b = u.branchId ? db.branches.find(x => x.id === u.branchId) : null;
    return b ? `${b.name} (${b.code})` : 'No branch assigned';
  },

  /** Owners who could still sign in. Guards the last-owner rules below. */
  activeOwners(){
    const db = Store.db;
    return (db.users || []).filter(u =>
      u.tenantId === CU.tenantId && u.roleKey === 'OWNER' && this.status(u) === 'ACTIVE');
  },

  label(p){
    p = p || this.params();
    const bits = [];
    if (p.searchval) bits.push(`matching “${p.searchval}”`);
    if (p.statusval) bits.push(STATUS.user[p.statusval] ? STATUS.user[p.statusval].label : p.statusval);
    return bits.length ? bits.join(', ') : 'All accounts on this taxpayer';
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function AccountManagement() {
  EnhanceSelect(".select_status_account_management");

  let delay;
  $(".input_searchval_account_management").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        clearTimeout(delay);
        AccountManagementSearch();
      }
    })
    .on("input", function () {
      clearTimeout(delay);
      delay = setTimeout(function () {
        AccountManagementSearch();
      }, 600);
    })
    .val("");

  $(".select_status_account_management").off("change").on("change", function () {
    AccountManagementSearch();
  });

  $(".button_account_management_create_account").off("click").on("click", function () {
    ModalAccountManagement();
  });

  $(".button_generate_account_management").off("click").on("click", function () {
    DisplayConfirmSwal("Generate the Users report?", function () {
      var searchval = $(".input_searchval_account_management").val();
      GenerationOfPDF("account_management", "", searchval, "", "");
    }, "", "Generate", false);
  });

  AccountManagementSearch();
}

function AccountManagementSearch() {
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/AccountManagementSearch",
    type: "POST",
    dataType: "json",
    data: AccountReg.params(),
    success: function (res) {
      AccountManagementTable(res.data);
      Swal.close();
    },
    error: function () {
      Swal.close();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

function AccountManagementTable(data) {
  $(".table_account_management").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_account_management").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No accounts match these filters" },
    "data": data,
    "order": [[9, "ASC"]],
    "columns": [
      { data: "fullname", "orderable": false },
      { data: "email_address", "orderable": false },
      { data: "status", "orderable": false },
      { data: "role", "orderable": false },
      { data: "scope", "orderable": false },

      { data: "position", "orderable": false },
      { data: "can_do", "orderable": false },
      { data: "last_activity", "orderable": false, className: "mono" },
      {
        data: "user_id",
        orderable: false,
        createdCell: function (td) { $(td).addClass('py-1'); },
        render: function (data) {
          return `
            <div class="d-flex align-items-center">
              <span class="fs_16 hover_transform c_orange_600 span_view_account_management" data-id="${data}">
                <i class="fa fa-edit"></i>
              </span>
            </div>`;
        }
      },
      { data: "sorting", "visible": false }
    ]
  }));

  $(document).off("click", ".span_view_account_management")
    .on("click", ".span_view_account_management", function () {
      var id = $(this).data("id");
      if (id) ModalAccountManagement(id);
    });
}

Screens.accounts = function () { AccountManagement(); };

/* ============================================================
   The modal. The portal's markup and its class hooks, filled with the
   fields this product has.
   ============================================================ */

var initialAccountFormData = {};

function ModalAccountManagement(user_id = "") {
  const db = Store.db;
  const editing = user_id ? (db.users || []).find(u => u.id === user_id) : null;

  $(".modal_account_management").off("show.bs.modal hidden.bs.modal")
    .on("show.bs.modal", function () {
      const roles = Object.keys(ROLES).filter(k => !ROLES[k].external).map(k => ({ value: k, text: ROLES[k].label }));
      const branches = Auth.visibleBranches().map(b => ({ value: b.id, text: `${b.name} (${b.code})` }));

      DisplaySelect2(roles, ".select_account_management_role");
      DisplaySelect2(branches, ".select_account_management_branch");
      InputValidation();

      $(".span_account_management_title").text(editing ? "Edit User" : "Create User");
      $(".div_account_management_invite").toggleClass("d-none", !!editing);
      $(".div_account_management_state").toggleClass("d-none", !editing);

      if (editing) ModalAccountManagementFill(editing);
      initialAccountFormData = ModalAccountManagementGetFormData();
      ModalAccountManagementRoleHint();
    })
    .on("hidden.bs.modal", function () {
      ModalAccountManagementReset();
    })
    .modal({ backdrop: "static", keyboard: false })
    .modal("show");

  function ModalAccountManagementGetFormData() {
    return {
      fullname: $(".input_account_management_fullname").val(),
      email_address: $(".input_account_management_email_address").val(),
      position: $(".input_account_management_position").val(),
      role: $(".select_account_management_role").val(),
      branch: $(".select_account_management_branch").val()
    };
  }

  function ModalAccountManagementFill(u) {
    $(".input_account_management_fullname").val(u.name);
    $(".input_account_management_email_address").val(u.email);
    $(".input_account_management_position").val(u.position || "");
    $(".select_account_management_role").val(u.roleKey).trigger("change.select2");
    $(".select_account_management_branch").val(u.branchId || "").trigger("change.select2");

    const status = AccountReg.status(u);
    $(".span_account_management_status").html(badge('user', status));
    $(".button_account_management_disable")
      .text(status === 'DISABLED' ? 'Re-enable user' : 'Disable user')
      .toggleClass("lbtn-accent", status === 'DISABLED')
      .toggleClass("lbtn-danger", status !== 'DISABLED');
    $(".button_account_management_resend").toggleClass("d-none", status !== 'INVITED');
    $(".button_account_management_invitelink").toggleClass("d-none", status !== 'INVITED');
  }

  function ModalAccountManagementReset() {
    $(".is-invalid").removeClass("is-invalid");
    $(".input_account_management_fullname").val("");
    $(".input_account_management_email_address").val("");
    $(".input_account_management_position").val("");
    $(".select_account_management_role").val("").trigger("change.select2");
    $(".select_account_management_branch").val("").trigger("change.select2");
    $(".checkbox_account_management_save_account").prop("checked", false);
    $(".button_account_management_save").prop("disabled", true);
    $(".div_account_management_role_hint").html("");
  }

  /* A role here is a set of permissions, not a job title. Saying which ones,
     as the role is picked, is the difference between an informed choice and a
     guess — and picking wrongly here is how a cashier ends up able to export
     the taxpayer's whole VAT position. */
  function ModalAccountManagementRoleHint() {
    $(".select_account_management_role").off("change.hint").on("change.hint", function () {
      const key = $(this).val();
      const r = ROLES[key], p = PERMS[key];
      if (!r || !p) { $(".div_account_management_role_hint").html(""); return; }

      const caps = [];
      if (p.issue) caps.push('operate documents');
      if (p.correct === true) caps.push('cancel invoices');
      else if (p.correct === 'request') caps.push('request cancellations for approval');
      if (p.approve) caps.push('approve cancellations');
      if (p.export) caps.push('export reports');
      if (p.users) caps.push('manage accounts');
      if (!caps.length) caps.push('read only');

      $(".div_account_management_role_hint").html(
        `<strong>${esc(r.label)}</strong> — ${r.scope === 'org' ? 'sees every branch' : 'scoped to one branch'}.
         Can ${esc(caps.join(', '))}.`);

      /* An organization-wide role has no single branch to be scoped to. */
      $(".div_account_management_branch").toggleClass("d-none", r.scope === 'org');
    }).trigger("change.hint");
  }

  $(".checkbox_account_management_save_account").off("change").on("change", function () {
    $(".button_account_management_save").prop("disabled", !$(this).is(":checked"));
  });

  $(".button_account_management_cancel").off("click").on("click", function () {
    const changed = JSON.stringify(initialAccountFormData) !==
                    JSON.stringify(ModalAccountManagementGetFormData());
    if (changed) {
      DisplayConfirmSwal("Discard Changes? <br/>You have unsaved changes. Do you want to cancel and discard them?",
        function () { $(".modal_account_management").modal("hide"); },
        function () { }, "Confirm", false);
    } else {
      $(".modal_account_management").modal("hide");
    }
  });

  $(".button_account_management_resend").off("click").on("click", function () {
    DisplayLoadingSwal();
    $.ajax({
      url: "/Portal/SPIStradcom/Dashboard/AccountManagementResendInvite",
      method: "POST",
      data: { user_id },
      success: function (res) {
        Swal.close();
        DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
      }
    });
  });

  $(".button_account_management_invitelink").off("click").on("click", function () {
    $.ajax({
      url: "/Portal/SPIStradcom/Dashboard/AccountManagementInviteLink",
      method: "POST",
      data: { user_id },
      success: function (res) {
        if (!res.success){ DisplaySwal("info", "", res.message); return; }
        $(".modal_account_management").modal("hide");
        ShowInvitation(res.data);
      }
    });
  });

  $(".button_account_management_disable").off("click").on("click", function () {
    const status = AccountReg.status(editing || {});
    const turningOff = status !== 'DISABLED';

    DisplayConfirmSwal(
      turningOff
        ? `<span class="fw-bold fs_18 text-dark">Disable this user?</span>
           <span class="fs_14 text-muted">The user can no longer sign in. Documents already issued stay under the user's name.</span>`
        : `<span class="fw-bold fs_18 text-dark">Re-enable this user?</span>
           <span class="fs_14 text-muted">The user can sign in again with the role shown.</span>`,
      function () {
        DisplayLoadingSwal();
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/AccountManagementSetState",
          method: "POST",
          data: { user_id, disable: turningOff ? "1" : "" },
          success: function (res) {
            Swal.close();
            if (res.success) {
              DisplayDelaySwal("success", "", res.message, function () {
                $(".modal_account_management").modal("hide");
                AccountManagementSearch();
              });
            } else {
              DisplaySwal("info", "", res.message);
            }
          }
        });
      }, "", turningOff ? "Disable" : "Re-enable", true);
  });

  $(".button_account_management_save").off("click").on("click", function () {
    $(".is-invalid").removeClass("is-invalid");

    const data = ModalAccountManagementGetFormData();
    const errors = [];

    if (!String(data.fullname || "").trim()) {
      $(".input_account_management_fullname").addClass("is-invalid"); errors.push("Full Name");
    }
    if (!String(data.email_address || "").trim() ||
        $(".input_account_management_email_address").hasClass("is-invalid")) {
      $(".input_account_management_email_address").addClass("is-invalid"); errors.push("Email Address");
    }
    if (!String(data.position || "").trim()) {
      $(".input_account_management_position").addClass("is-invalid"); errors.push("Position");
    }
    if (!data.role) {
      $(".select_account_management_role").next(".select2-container")
        .find(".select2-selection").addClass("is-invalid");
      errors.push("Role");
    }
    if (data.role && ROLES[data.role] && ROLES[data.role].scope === 'branch' && !data.branch) {
      $(".select_account_management_branch").next(".select2-container")
        .find(".select2-selection").addClass("is-invalid");
      errors.push("Branch");
    }

    if (errors.length) {
      DisplaySwal("info", "", "Complete the required fields marked in red.");
      return;
    }

    if (user_id && JSON.stringify(initialAccountFormData) === JSON.stringify(data)) {
      DisplayDelaySwal("info", "", "No changes were made.");
      return;
    }

    DisplayConfirmSwal(
      user_id
        ? `<span class="fw-bold fs_18 text-dark">Save these changes?</span>
           <span class="fs_14 text-muted">The change takes effect immediately and is recorded
           in the activity log.</span>`
        : `<span class="fw-bold fs_18 text-dark">Send this invitation?</span>
           <span class="fs_14 text-muted">An email goes to ${esc(data.email_address)}. The account
           becomes usable only once they activate it themselves.</span>`,
      function () {
        DisplayLoadingSwal();
        $.ajax({
          url: user_id
            ? "/Portal/SPIStradcom/Dashboard/AccountManagementUpdate"
            : "/Portal/SPIStradcom/Dashboard/AccountManagementSave",
          method: "POST",
          data: $.extend({ user_id }, data),
          success: function (res) {
            Swal.close();
            if (res.success) {
              DisplayDelaySwal("success", "", res.message, function () {
                $(".modal_account_management").modal("hide");
                AccountManagementSearch();
              });
            } else {
              DisplaySwal("info", "", res.message);
            }
          },
          error: function () {
            Swal.close();
            DisplaySwal("error", "", "The request could not be completed. Try again.");
          }
        });
      }, "", user_id ? "Save" : "Send invitation", false);
  });
}

/**
 * Stand in for the email the invitee would have received.
 *
 * The one place this demo has to differ from the real thing: an invitation is
 * private to the person it was sent to, and here the person who sent it is
 * reading it. The modal says so rather than quietly blurring the difference,
 * because someone walking through this deserves to know which part is real.
 */
function ShowInvitation(d) {
  UI.openModal('Invitation to ' + d.email, `
    ${Callout('info', `In a live system this arrives as an email to ${esc(d.email)} and only
      they can read it. There is no mail server behind a demonstration, so it is
      shown here instead — which is the one step of this flow that is pretend.`, {cls:'mb-3'})}

    <div class="card bg-light border rounded-3 p-3 mb-3">
      <div class="fs_12 text-muted mb-1">To</div>
      <div class="fs_13 fw-semibold mb-2">${esc(d.name)} &lt;${esc(d.email)}&gt;</div>
      <div class="fs_12 text-muted mb-1">Invitation code</div>
      <div class="fs_20 fw-bold mono">${esc(d.token)}</div>
      <div class="fs_11 text-muted mt-2">${esc(d.expires)}</div>
    </div>

    <div class="fs_12 text-secondary">
      Opening this signs you out and signs in as ${esc(d.name)}.
    </div>`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>
     <button class="lbtn lbtn-primary" ${d.expired ? 'disabled' : ''}
       onclick="UI.closeModal(); Auth.logout(); Activate.open('${esc(d.token)}')">
       Open it as ${esc(d.name.split(' ')[0])}</button>`);
}

/* ============================================================
   The server side of the screen.
   ============================================================ */

LocalAPI.on("Dashboard/AccountManagementSearch", function (p) {
  const db = Store.db;
  const rows = AccountReg.apply(p);

  return {
    success: true,
    data: rows.map(u => {
      const r = ROLES[u.roleKey] || { label: u.roleKey, short: u.roleKey };
      const perms = PERMS[u.roleKey] || {};
      const caps = [];
      if (perms.issue) caps.push('Operate');
      if (perms.approve) caps.push('Approve');
      if (perms.export) caps.push('Export');
      if (perms.users) caps.push('Users');
      if (!caps.length) caps.push('Read-only');

      const last = (db.activity || [])
        .filter(a => a.tenantId === u.tenantId && a.actorName === u.name)
        .sort((a, b) => new Date(b.at) - new Date(a.at))[0];

      return {
        user_id:       u.id,
        fullname:      `<strong>${esc(u.name)}</strong>${u.id === CU.id
                          ? ' <span class="lbadge lbadge-blue">You</span>' : ''}`,
        email_address: esc(u.email || '—'),
        status:        badge('user', AccountReg.status(u)),
        role:          esc(r.label),
        scope:         esc(AccountReg.scope(u)),
        position:      esc(u.position || '—'),
        can_do:        esc(caps.join(', ')),
        last_activity: last ? fmtDateTime(last.at) : '—',
        sorting:       u.name
      };
    })
  };
});

LocalAPI.on("Dashboard/AccountManagementSave", function (p) {
  const db = Store.db;
  const email = String(p.email_address || '').trim().toLowerCase();

  if ((db.users || []).some(u => u.tenantId === CU.tenantId &&
        String(u.email || '').toLowerCase() === email)){
    return { success:false, message:'An account with that email address already exists.' };
  }

  const orgScoped = ROLES[p.role] && ROLES[p.role].scope === 'org';
  const user = {
    id: uid('u'),
    tenantId: CU.tenantId,
    branchId: orgScoped ? null : (p.branch || null),
    roleKey: p.role,
    name: String(p.fullname || '').trim(),
    email: String(p.email_address || '').trim(),
    position: String(p.position || '').trim(),
    /* Invited, not active. Nobody can sign in as this account until the person
       it belongs to activates it. The token is what the emailed link carries;
       it is cleared the moment it is used, so a forwarded message is spent. */
    status: 'INVITED',
    active: false,
    invitedAt: new Date().toISOString(),
    invitedBy: CU.name,
    inviteToken: keycode(8)
  };

  db.users.push(user);
  logActivity(db, {
    action: `Invited ${user.name} (${user.email}) as ${ROLES[user.roleKey].label}`
  });
  Store.save(db);

  return {
    success: true,
    token: user.inviteToken,
    message: `Invitation sent to ${user.email}. The account activates when they accept it.`
  };
});

/** What the emailed link would carry. There is no mail server in a mockup, so
    the code is shown to whoever sent it — the one place the real flow and this
    one differ, and the modal says so rather than pretending otherwise. */
LocalAPI.on("Dashboard/AccountManagementInviteLink", function (p) {
  const db = Store.db;
  const u = (db.users || []).find(x => x.id === p.user_id);
  if (!u) return { success:false, message:'That account no longer exists.' };
  if (!can('users')) return { success:false, message:'Only an owner can see an invitation.' };
  if (u.status !== 'INVITED' || !u.inviteToken){
    return { success:false, message:'That account has already been activated.' };
  }

  const days = Activate.DAYS_VALID;
  const left = Math.ceil(days - (Date.now() - new Date(u.invitedAt).getTime()) / 864e5);

  return {
    success: true,
    data: { name:u.name, email:u.email, token:u.inviteToken, expired: left <= 0,
            expires: left > 0 ? `${left} day(s) left` : 'expired' }
  };
});

LocalAPI.on("Dashboard/AccountManagementUpdate", function (p) {
  const db = Store.db;
  const u = (db.users || []).find(x => x.id === p.user_id);
  if (!u) return { success:false, message:'That account no longer exists.' };

  /* Demoting the last owner would leave the taxpayer with no one able to
     manage accounts or attest to the tax profile. */
  if (u.roleKey === 'OWNER' && p.role !== 'OWNER' &&
      AccountReg.activeOwners().filter(o => o.id !== u.id).length === 0){
    return { success:false,
      message:'This is the last active owner. Promote another account to owner first.' };
  }

  const before = `${ROLES[u.roleKey] ? ROLES[u.roleKey].label : u.roleKey}`;
  const orgScoped = ROLES[p.role] && ROLES[p.role].scope === 'org';

  u.name = String(p.fullname || '').trim();
  u.email = String(p.email_address || '').trim();
  u.position = String(p.position || '').trim();
  u.roleKey = p.role;
  u.branchId = orgScoped ? null : (p.branch || null);

  const after = `${ROLES[u.roleKey] ? ROLES[u.roleKey].label : u.roleKey}`;
  logActivity(db, {
    action: before === after
      ? `Updated account ${u.name}`
      : `Changed ${u.name} from ${before} to ${after}`
  });
  Store.save(db);

  /* The signed-in user may have just changed their own role. */
  refreshSession();
  Auth.paintChrome();
  Nav.build();

  return { success:true, message:'Account updated.' };
});

LocalAPI.on("Dashboard/AccountManagementSetState", function (p) {
  const db = Store.db;
  const u = (db.users || []).find(x => x.id === p.user_id);
  if (!u) return { success:false, message:'That account no longer exists.' };

  const disabling = !!p.disable;

  if (disabling && u.id === CU.id){
    return { success:false, message:'You cannot disable the account you are signed in as.' };
  }
  if (disabling && u.roleKey === 'OWNER' &&
      AccountReg.activeOwners().filter(o => o.id !== u.id).length === 0){
    return { success:false,
      message:'This is the last active owner. The account cannot be disabled.' };
  }

  u.status = disabling ? 'DISABLED' : 'ACTIVE';
  u.active = !disabling;

  logActivity(db, {
    action: `${disabling ? 'Disabled' : 'Re-enabled'} user ${u.name}`
  });
  Store.save(db);

  return {
    success: true,
    message: disabling
      ? `${u.name} can no longer sign in. Their invoices are untouched.`
      : `${u.name} can sign in again.`
  };
});

LocalAPI.on("Dashboard/AccountManagementResendInvite", function (p) {
  const db = Store.db;
  const u = (db.users || []).find(x => x.id === p.user_id);
  if (!u) return { success:false, message:'That account no longer exists.' };

  /* A new code, not the old one revived. Resending is what someone does when
     the first message went astray, and the safe reading of "went astray" is
     that somebody else has it. The old token stops working here. */
  u.invitedAt = new Date().toISOString();
  u.inviteToken = keycode(8);
  logActivity(db, { action:`Resent the invitation to ${u.name} (${u.email})` });
  Store.save(db);

  return { success:true, token:u.inviteToken,
           message:`Invitation resent to ${u.email}. The previous code no longer works.` };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  accounts(){
    const opt = (value, label) => `<option value="${value}">${label}</option>`;

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Users</h1>
          <div class="screen_sub">
            Users of ${esc(CT.name)}, with role and branch. Users are invited and disabled, not deleted. Each invoice keeps the name of the user who issued it.
          </div>
        </div>
      </div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">

        <div class="d-flex flex-wrap gap-2 align-items-stretch">
          <div class="period-bar flex-grow-1" style="min-width:340px;">
            <div class="period-seg" style="flex:1.6 1 0;">
              <div class="input-group input-group-sm">
                <span class="input-group-text bg-white border-end-0 text-muted">
                  <i class="bi bi-search"></i>
                </span>
                <input type="text" class="form-control border-start-0 ps-2 input_searchval_account_management"
                       placeholder="Name, email, role or branch..." />
              </div>
            </div>
            <div class="period-seg">
              <select class="form-select form-select-sm select_status_account_management">
                ${opt('', 'Any status')}
                ${Object.keys(STATUS.user).map(k => opt(k, STATUS.user[k].label)).join('')}
              </select>
            </div>
          </div>
          <button class="lbtn lbtn-primary button_account_management_create_account">
            <i class="bi bi-person-add"></i> Invite user
          </button>
        </div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table_account_management">
            <thead>
              <tr>
                <th>FULL NAME</th>
                <th>EMAIL</th>
                <th>STATUS</th>
                <th>ROLE</th>
                <th>BRANCH SCOPE</th>

                <th>POSITION</th>
                <th>CAN</th>
                <th>LAST ACTIVITY</th>
                <th>MODIFY</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div></div>

      <div class="text-center mt-3">
        <button class="lbtn lbtn-accent button_generate_account_management">
          <i class="bi bi-file-earmark-arrow-down"></i> Generate to PDF
        </button>
      </div>`;
  }
});

/* ============================================================
   What this screen can export.
   ============================================================ */
Reporting.source('account_management', {
  title: 'Users',
  kind: 'listing',

  search(searchval){ return AccountReg.apply({ searchval }); },
  periodLabel(searchval){ return AccountReg.label({ searchval }); },

  columns(){
    return [
      { label:'Full Name',    value: u => u.name },
      { label:'Email',        value: u => u.email || '—' },
      { label:'Status',       value: u => (STATUS.user[AccountReg.status(u)] || {}).label || '—' },
      { label:'Role',         value: u => (ROLES[u.roleKey] || {}).label || u.roleKey },
      { label:'Branch Scope', value: u => AccountReg.scope(u) },
      { label:'Position',     value: u => u.position || '—' },
      { label:'Invited By',   value: u => u.invitedBy || '—' }
    ];
  }
});
