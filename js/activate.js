/* ============================================================
   activate.js — accepting an invitation

   Account Management creates people; it does not create their access. An owner
   filling in a name, an email and a role produces an account nobody can sign in
   as, and this is the screen that finishes the job — in the hands of the person
   the account belongs to, not the person who created it.

   That split is the whole point, and it is worth saying why it is not just
   ceremony. If an administrator set the password, then for as long as the
   account exists there are two people who can be it, and the activity log — the
   thing this system offers an examiner as evidence of who did what — is no
   longer evidence of anything. The invitation is what makes a name in that log
   mean one person.

   What activation asks for, and why each one is there:

     - Confirm the name and position. The owner typed them from memory. The
       person they describe is better placed to correct them, and this is the
       last moment before their name starts appearing against documents.

     - Set a password nobody else has seen. Stored on the account; the demo
       password does not open it afterwards. Anything less and the paragraph
       above is a lie.

     - Acknowledge what the role can do. A branch supervisor who does not know
       they can approve corrections is a control that exists on paper only.

     - Consent to the activity logging, by name, under RA 10173. Their actions
       are about to be recorded against them and retained; they are told so
       before it starts, not after.

   Invitations expire. Seven days, and a link that has run out says so plainly
   and points at the person who sent it — an expired invitation is almost
   always someone who changed their mind slowly, not an attack.
   ============================================================ */

const Activate = {

  DAYS_VALID: 7,

  /** The invitation being accepted, once a token has resolved to one. */
  user: null,

  /* ---------- Entry ---------- */

  /**
   * @param token  the code from the emailed link. Omitted means "show the box
   *               and let them paste it", which is where the sign-in link goes.
   */
  open(token){
    this.user = null;
    UI.show('view-activate');
    const box = document.getElementById('activate-token');
    if (box) box.value = token || '';
    this.paint(token ? this.lookup(token) : this.askForToken());
    if (!token && box) box.focus();
  },

  close(){ this.user = null; Auth.showLogin(); },

  paint(html){ document.getElementById('activate-body').innerHTML = html; },

  submitToken(){
    const t = String(document.getElementById('activate-token').value || '').trim();
    if (!t){ UI.toast('Paste the code from your invitation', 'warn'); return; }
    this.paint(this.lookup(t));
  },

  /* ---------- Resolving a token ---------- */

  /**
   * Tokens are matched case-insensitively and every failure returns the same
   * text. There is nothing to enumerate here — a token is not a document
   * number — but a message that distinguishes "no such invitation" from
   * "expired" tells a stranger which codes were once real.
   */
  lookup(token){
    const db = Store.db;
    const code = String(token).trim().toUpperCase();
    const u = (db.users || []).find(x =>
      String(x.inviteToken || '').toUpperCase() === code);

    if (!u) return this.dead(
      'Invitation code not found.',
      'The code has 8 characters. Use the code in your latest invitation. A new invitation replaces the old one.');

    if (u.status === 'ACTIVE') return this.dead(
      'That invitation has already been used.',
      'The account is active. Sign in with the password that was set when it was activated.');

    if (u.status === 'DISABLED') return this.dead(
      'That account has been disabled.',
      'The account owner can re-enable it.');

    if (this.expired(u)){
      const inviter = u.invitedBy || 'whoever invited you';
      return this.dead(
        'That invitation has expired.',
        `The invitation expired after ${this.DAYS_VALID} days. Ask ${esc(inviter)} to send a new invitation from the Users screen.`);
    }

    this.user = u;
    return this.form(u);
  },

  expired(u){
    if (!u.invitedAt) return false;
    const age = Date.now() - new Date(u.invitedAt).getTime();
    return age > this.DAYS_VALID * 864e5;
  },

  /* ---------- Panels ---------- */

  askForToken(){
    return `
      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Invitation code</span>
        <div class="input-group">
          <span class="input-group-text bg_blue_100 border-end-0">
            <i class="bi bi-envelope-open fs_14"></i>
          </span>
          <input type="text" id="activate-token" maxlength="12" autocomplete="off"
                 class="form-control border-start-0 px-2 height_40 fs_14 mono text-uppercase shadow-none"
                 placeholder="Eight characters"
                 onkeydown="if(event.key==='Enter')Activate.submitToken()">
        </div>
        <div class="fs_11 text-muted mt-1">
          In the message you were sent when your account was created.
        </div>
      </div>
      <div class="d-grid gap-2 mt-4">
        <button type="button" onclick="Activate.submitToken()"
                class="lbtn lbtn-primary lbtn-lg w-100">
          Continue
        </button>
      </div>`;
  },

  dead(title, detail){
    return `
      ${Callout('warn', `<strong>${esc(title)}</strong><div class="mt-1">${detail}</div>`)}
      <div class="d-grid gap-2 mt-4">
        <button type="button" onclick="Activate.open()"
                class="lbtn lbtn-ghost lbtn-lg w-100">
          Try another code
        </button>
      </div>`;
  },

  form(u){
    const db = Store.db;
    const t = db.tenants.find(x => x.id === u.tenantId);
    const b = u.branchId ? db.branches.find(x => x.id === u.branchId) : null;
    const r = ROLES[u.roleKey] || { label:u.roleKey, scope:'branch' };
    const p = PERMS[u.roleKey] || {};

    /* Spelled out rather than badged. Someone reading this has never seen the
       system and has no idea what "Approve" on a chip is meant to mean. */
    const powers = [
      [p.issue,       'Run day-to-day work: bulk import where the account uses it, buyer copies and resending, and daily closings.'],
      [p.approve,     'Approve cancellations other people request.'],
      [p.correct === 'request', 'Request a cancellation, which someone else approves.'],
      [p.export,      'Export registers and reports.'],
      [p.users,       'Create, disable and re-invite accounts.'],
      [p.taxProfile,  'Change the tax profile the whole business is computed on.'],
      [p.template,    'Change the invoice template every buyer sees.']
    ].filter(x => x[0]).map(x => x[1]);

    if (!powers.length) powers.push('Read and export only. You cannot issue or change anything.');

    return `
      <div class="card bg_blue_100 border-0 rounded-3 p-3 mb-4">
        <div class="fs_11 text-uppercase fw-bold text-secondary mb-1">You have been invited to</div>
        <div class="fs_18 fw-bold text-dark">${esc(t ? t.name : (AppReg.forTenant(u.tenantId) || {}).tenantName || 'a business')}</div>
        <div class="fs_13 text-secondary">
          as <strong>${esc(r.label)}</strong> ·
          ${b ? esc(b.name) + ' (' + esc(b.code) + ')' : 'all branches'}
        </div>
        <div class="fs_12 text-muted mt-2">
          Invited by ${esc(u.invitedBy || '—')} on ${esc(fmtDate(u.invitedAt))}.
        </div>
      </div>

      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Your name</span>
        <input type="text" id="act-name" maxlength="80"
               class="form-control height_40 fs_14 shadow-none" value="${esc(u.name || '')}">
        <div class="fs_11 text-muted mt-1">
          This is the name that will appear against everything you do.
        </div>
      </div>

      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Your position</span>
        <input type="text" id="act-position" maxlength="80"
               class="form-control height_40 fs_14 shadow-none" value="${esc(u.position || '')}">
      </div>

      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Email</span>
        <input type="text" class="form-control height_40 fs_14 shadow-none bg-light"
               value="${esc(u.email || '')}" readonly disabled>
        <div class="fs_11 text-muted mt-1">
          The invitation was sent here, so it is not yours to change on this screen.
        </div>
      </div>

      <div class="hr_gray_200 my-4"></div>

      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Password</span>
        <input type="password" id="act-pass1" maxlength="64" autocomplete="new-password"
               class="form-control height_40 fs_14 shadow-none">
        <div class="fs_11 text-muted mt-1">
          At least eight characters, with uppercase and lowercase letters, a number and a special character. No one at your business can view your password.
        </div>
      </div>

      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Confirm password</span>
        <input type="password" id="act-pass2" maxlength="64" autocomplete="new-password"
               class="form-control height_40 fs_14 shadow-none"
               onkeydown="if(event.key==='Enter')Activate.submit()">
      </div>

      <div class="card border rounded-3 p-3 mb-3">
        <div class="fs_12 fw-bold text-dark mb-2">What this role lets you do</div>
        <ul class="fs_12 text-secondary mb-0 ps-3">
          ${powers.map(x => `<li class="mb-1">${esc(x)}</li>`).join('')}
        </ul>
      </div>

      <label class="d-flex gap-2 align-items-start fs_12 text-secondary mb-2">
        <input type="checkbox" id="act-ack-role" class="mt-1">
        <span>I understand what this role can do, and that these actions are mine.</span>
      </label>

      <label class="d-flex gap-2 align-items-start fs_12 text-secondary mb-3">
        <input type="checkbox" id="act-ack-log" class="mt-1">
        <span>I understand that what I do here is recorded against my name and kept
        as part of this business's records, under RA 10173.</span>
      </label>

      <div class="d-grid gap-2">
        <button type="button" onclick="Activate.submit()"
                class="lbtn lbtn-primary lbtn-lg w-100">
          Activate my account
        </button>
      </div>`;
  },

  /* ---------- Submit ---------- */

  submit(){
    if (!this.user) return;
    const v = id => String((document.getElementById(id) || {}).value || '').trim();
    const on = id => !!(document.getElementById(id) || {}).checked;

    const name = v('act-name');
    const p1 = v('act-pass1'), p2 = v('act-pass2');

    /* Checked here before the round trip so the field can be pointed at, and
       checked again in the route because a screen is not a gate. */
    if (!name) return this.nope('Enter the name that should appear against your work.');
    if (p1.length < 8) return this.nope('The password needs at least eight characters.');
    if (!/[a-z]/.test(p1) || !/[A-Z]/.test(p1) || !/\d/.test(p1) || !/[^A-Za-z0-9]/.test(p1))
      return this.nope('The password needs uppercase and lowercase letters, a number and a special character.');
    if (p1 !== p2) return this.nope('The two passwords do not match.');
    if (!on('act-ack-role') || !on('act-ack-log'))
      return this.nope('Both acknowledgments have to be ticked.');

    DisplayLoadingSwal();
    $.ajax({
      url: "/Portal/SPIStradcom/Public/ActivateInvitation",
      type: "POST",
      dataType: "json",
      data: {
        token: this.user.inviteToken,
        fullname: name,
        position: v('act-position'),
        password: p1
      },
      success: res => {
        Swal.close();
        if (!res.success){ DisplaySwal('error', '', res.message); return; }
        /* Straight in. Asking someone to sign in with a password they set
           fifteen seconds ago is a step that exists only for the developer. */
        const u = Store.db.users.find(x => x.id === res.user_id);
        Auth.enter(u, `Welcome, ${u.name}`);
      },
      error: () => { Swal.close(); DisplaySwal('error', '', 'The request could not be completed. Try again.'); }
    });
  },

  nope(msg){ DisplaySwal('info', '', msg); }
};

/* ============================================================
   Route
   ============================================================ */

LocalAPI.on("Public/ActivateInvitation", function (p) {
  const db = Store.db;
  const code = String(p.token || '').trim().toUpperCase();
  const u = (db.users || []).find(x =>
    String(x.inviteToken || '').toUpperCase() === code);

  if (!u || u.status !== 'INVITED'){
    return { success:false, message:'That invitation is no longer valid.' };
  }
  if (Activate.expired(u)){
    return { success:false, message:'That invitation has expired. Ask for a new one.' };
  }

  const pass = String(p.password || '');
  if (pass.length < 8 || !/[a-z]/.test(pass) || !/[A-Z]/.test(pass) || !/\d/.test(pass) || !/[^A-Za-z0-9]/.test(pass)){
    return { success:false, message:'That password does not meet the rules.' };
  }
  const name = String(p.fullname || '').trim();
  if (!name) return { success:false, message:'A name is required.' };

  const renamed = name !== u.name;
  u.name = name;
  u.position = String(p.position || '').trim();
  /* A real deployment stores a hash and never the password. This is a mockup
     with no server to hash on, so it is kept as typed and never shown again —
     the shape of the flow is what is being demonstrated, not the storage. */
  u.password = pass;
  u.status = 'ACTIVE';
  u.active = true;
  u.activatedAt = new Date().toISOString();
  /* The token is kept rather than cleared. It stops working the moment status
     leaves INVITED — every path checks that — and keeping it is what lets
     someone who clicks the same link twice be told "already used" instead of
     "no such invitation", which reads as a fault they need to report. */
  u.tokenUsedAt = u.activatedAt;

  logActivity(db, {
    tenantId: u.tenantId,
    actorType: 'USER',
    actorName: u.name,
    role: u.roleKey,
    action: `Accepted their invitation and activated their account` +
            (renamed ? ' (corrected the name it was created under)' : '')
  });
  Store.save(db);

  return { success:true, user_id:u.id };
});
