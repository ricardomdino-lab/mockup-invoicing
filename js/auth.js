/* ============================================================
   auth.js — session, login, tenant switch, role switch
   ============================================================ */

const Auth = {

  /* ---------- Sign-in screen ---------- */

  /** Fills the sign-in card. Called once at boot and again after a reset. */
  paintLogin(){
    document.querySelector('.input_login_email').value = '';
    document.querySelector('.input_login_password').value = '';
    document.getElementById('login-version').textContent = `${SYSTEM.product} version ${SYSTEM.version}`;
    this.backToCredentials();
  },

  showLogin(){
    UI.show('view-login');
    this.paintLogin();
  },

  /** Corner shortcut on the login screen: picks a seeded account instead of
      hand-typing tenant/role/password. It fills the real form and runs the
      real sign-in — MFA included — so it is a fast path in, not a bypass. */
  openDemoAccounts(){
    const db = Store.db;
    const body = `
      <p class="fs_13 text-secondary mb-3">
        Demo password: <strong>${DEMO_PASSWORD}</strong>. Select an account to sign in.
      </p>
      ${db.tenants.slice().sort((x, y) => (y.isProvider ? 1 : 0) - (x.isProvider ? 1 : 0)).map(t => {
        const users = db.users.filter(u => u.tenantId === t.id && u.active);
        if (!users.length) return '';
        return `
        <div class="demo-account-group">
          <div class="demo-account-group-label">${esc(t.name)}${t.isProvider ? ' (sample company: the provider as a taxpayer)' : ''}</div>
          ${users.map(u => {
            const r = ROLES[u.roleKey];
            const br = u.branchId ? db.branches.find(b => b.id === u.branchId) : null;
            return `
            <div class="demo-account-row" onclick="Auth.signInDemo('${u.id}')">
              <div>
                <div class="demo-account-row-name">${esc(u.name)}</div>
                <div class="fs_11 text-secondary">${esc(r.label)}${br ? ' · ' + esc(br.name) : ''}</div>
              </div>
              <div class="demo-account-row-meta">${r.scope === 'org' ? 'Org-wide' : 'Branch'}</div>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}
      ${(() => {
        /* Owners of accepted applications, still setting up their accounts. */
        const setup = (db.onboardingApps || []).filter(a => a.status === 'ACCEPTED' && !a.activatedAt)
          .map(a => ({ a, u: db.users.find(u => u.tenantId === a.tenantId && u.roleKey === 'OWNER' && u.active) }))
          .filter(x => x.u);
        if (!setup.length) return '';
        return `
        <div class="demo-account-group">
          <div class="demo-account-group-label">Accepted, still setting up</div>
          ${setup.map(x => `
            <div class="demo-account-row" onclick="Auth.signInDemo('${x.u.id}')">
              <div>
                <div class="demo-account-row-name">${esc(x.u.name)}</div>
                <div class="fs_11 text-secondary">Owner · ${esc(x.a.tenantName)}</div>
              </div>
              <div class="demo-account-row-meta">Setup</div>
            </div>`).join('')}
        </div>`;
      })()}
      ${(() => {
        const ops = db.users.filter(u => u.roleKey === 'EPI_OPERATOR' && u.active);
        if (!ops.length) return '';
        return `
        <div class="demo-account-group">
          <div class="demo-account-group-label">${esc(SYSTEM.vendor)}: system administration (the provider's console)</div>
          ${ops.map(u => `
            <div class="demo-account-row" onclick="Auth.signInDemo('${u.id}')">
              <div>
                <div class="demo-account-row-name">${esc(u.name)}</div>
                <div class="fs_11 text-secondary">${esc(ROLES[u.roleKey].label)} · ${esc(u.position)}</div>
              </div>
              <div class="demo-account-row-meta">Operator console</div>
            </div>`).join('')}
        </div>`;
      })()}
      ${(() => {
        const ex = db.users.filter(u => u.roleKey === 'BIR_EXAMINER' && u.active);
        if (!ex.length) return '';
        return `
        <div class="demo-account-group">
          <div class="demo-account-group-label">BIR</div>
          ${ex.map(u => `
            <div class="demo-account-row" onclick="Auth.signInDemo('${u.id}')">
              <div>
                <div class="demo-account-row-name">${esc(u.name)}</div>
                <div class="fs_11 text-secondary">${esc(ROLES[u.roleKey].label)} · ${esc(u.position)}</div>
              </div>
              <div class="demo-account-row-meta">Read-only</div>
            </div>`).join('')}
        </div>`;
      })()}`;

    UI.openModal('Demo accounts', body,
      `<button class="lbtn lbtn-ghost" onclick="App.resetDemo()">Reset demo data</button>
       <button class="lbtn lbtn-primary" onclick="UI.closeModal()">Close</button>`);
  },

  signInDemo(uid_){
    const db = Store.db;
    const u = db.users.find(x => x.id === uid_);
    if (!u) return;
    UI.closeModal();
    $('.input_login_email').val(u.email).removeClass('is-invalid');
    $('.input_login_password').val(DEMO_PASSWORD);
    this.doLogin();
  },

  /** Wired to .button_validate_credentials, the source portal's sign-in hook. */
  doLogin(){
    const db = Store.db;
    const email = $('.input_login_email').val().trim().toLowerCase();
    const pass = $('.input_login_password').val();
    const u = db.users.find(x => (x.email || '').toLowerCase() === email);

    if (!email){ DisplaySwal('info', '', 'Enter your username.'); return; }
    if (!u){
      $('.input_login_email').addClass('is-invalid');
      DisplaySwal('info', '', 'No account found with that username.');
      return;
    }
    $('.input_login_email').removeClass('is-invalid');

    /* Seeded accounts share the demo password. An account someone activated
       through an invitation carries the password they chose, and only that
       one opens it — otherwise activation would be theatre. */
    const expected = u.password || DEMO_PASSWORD;
    if (pass !== expected){
      $('.input_login_password').addClass('is-invalid');
      DisplaySwal('error', '', u.password
        ? 'Incorrect password. This account uses the password set when it was activated.'
        : 'Incorrect password. The demo password is ' + DEMO_PASSWORD + '.');
      return;
    }
    if (!u.active){
      DisplaySwal('info', '', 'That account has not been activated yet.');
      return;
    }
    $('.input_login_password').removeClass('is-invalid');

    DisplayLoadingSwal();
    setTimeout(() => {
      Swal.close();
      this.startMfa(u);
    }, 500);
  },

  /* ---------- Verify it's you (picked fresh every sign-in) ---------- */

  startMfa(u){
    this._mfaUser = u;
    this._mfaCode = null;
    clearInterval(this._mfaTimerId);
    document.getElementById('login-step-credentials').classList.add('d-none');
    document.getElementById('login-step-mfa').classList.remove('d-none');
    document.getElementById('login-mfa-body').innerHTML = '';
    document.querySelectorAll('#login-mfa-picker .radio-card').forEach(c => c.classList.remove('selected'));

    $('#login-mfa-picker [data-mfa-method]').off('click').on('click', function(){
      document.querySelectorAll('#login-mfa-picker .radio-card').forEach(c => c.classList.remove('selected'));
      this.classList.add('selected');
      this.querySelector('input').checked = true;
      Auth.renderMfaMethod(this.dataset.mfaMethod);
    });

    $('#login-mfa-back').off('click').on('click', () => this.backToCredentials());
  },

  backToCredentials(){
    clearInterval(this._mfaTimerId);
    document.getElementById('login-step-mfa').classList.add('d-none');
    document.getElementById('login-step-credentials').classList.remove('d-none');
  },

  /**
   * Nothing here is real — no email server, no paired app, and a passkey
   * ceremony needs a platform authenticator that may not exist on whatever
   * this demo is running on. Email and authenticator both show their code
   * on screen, the same way the demo password is shown on the credentials
   * step, so the flow can be completed without any of that infrastructure.
   */
  renderMfaMethod(method){
    const body = document.getElementById('login-mfa-body');

    if (method === 'passkey'){
      body.innerHTML = `
        <div class="text-center py-3">
          <div class="fs_36 c_blue_600 mb-2"><i class="bi bi-fingerprint"></i></div>
          <div class="fs_14 fw-semibold text-dark" id="login-passkey-status">Waiting for your device&hellip;</div>
          <div class="fs_12 text-secondary mt-1">Follow the prompt from your browser or device.</div>
        </div>`;
      setTimeout(() => {
        const status = document.getElementById('login-passkey-status');
        if (!status) return;
        status.textContent = 'Confirmed.';
        setTimeout(() => this.completeMfa(), 500);
      }, 1300);
      return;
    }

    this._mfaCode = String(Math.floor(100000 + Math.random() * 900000));
    const label = method === 'email' ? 'your email address' : 'your authenticator app';
    body.innerHTML = `
      <div class="hint-box rounded-3 p-2 mb-3 fs_12">
        Demo only. No message was sent to ${label}. Code: <strong>${this._mfaCode}</strong>.
      </div>
      <div class="otp-timer mb-3" id="login-mfa-timer">05:00</div>
      <div class="otp-row mb-3">
        ${[0,1,2,3,4,5].map(i =>
          `<input type="text" inputmode="numeric" maxlength="1" class="otp-box login-mfa-digit" data-idx="${i}">`
        ).join('')}
      </div>
      <div class="d-grid">
        <button type="button" class="lbtn lbtn-primary lbtn-lg w-100" id="login-mfa-verify">Verify</button>
      </div>
      <div class="text-center mt-3 fs_12 d-none" id="login-mfa-expired">
        That code has expired.
        <span class="fw-semibold hyperlink" id="login-mfa-resend">Send a new code</span>
      </div>`;

    this._wireOtpBoxes();
    this._startMfaTimer();
    $('#login-mfa-verify').off('click').on('click', () => this.checkMfaCode());
    $('#login-mfa-resend').off('click').on('click', () => this.renderMfaMethod(method));
  },

  /** Digit-by-digit entry: types forward, backspaces back, and accepts a
      pasted 6-digit code split across every box at once. */
  _wireOtpBoxes(){
    const boxes = Array.from(document.querySelectorAll('.login-mfa-digit'));
    boxes.forEach((box, i) => {
      box.addEventListener('input', () => {
        box.value = box.value.replace(/\D/g, '').slice(0, 1);
        box.classList.remove('is-invalid');
        if (box.value && boxes[i + 1]) boxes[i + 1].focus();
        if (boxes.every(b => b.value)) this.checkMfaCode();
      });
      box.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !box.value && boxes[i - 1]) boxes[i - 1].focus();
      });
      box.addEventListener('paste', e => {
        e.preventDefault();
        const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((ch, j) => { if (boxes[j]) boxes[j].value = ch; });
        (boxes[Math.min(text.length, 5)] || boxes[5]).focus();
        if (text.length === 6) this.checkMfaCode();
      });
    });
    boxes[0].focus();
  },

  /** Cosmetic only — nothing expires server-side in a mockup with no server. */
  _startMfaTimer(){
    clearInterval(this._mfaTimerId);
    let secs = 300;
    const el = document.getElementById('login-mfa-timer');
    const paint = () => {
      if (el) el.textContent = String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    };
    paint();
    this._mfaTimerId = setInterval(() => {
      secs -= 1;
      if (secs <= 0){
        clearInterval(this._mfaTimerId);
        if (el){ el.textContent = '00:00'; el.classList.add('otp-expired'); }
        document.querySelectorAll('.login-mfa-digit').forEach(b => b.disabled = true);
        const expired = document.getElementById('login-mfa-expired');
        if (expired) expired.classList.remove('d-none');
        return;
      }
      paint();
    }, 1000);
  },

  checkMfaCode(){
    const boxes = Array.from(document.querySelectorAll('.login-mfa-digit'));
    const val = boxes.map(b => b.value).join('');
    if (val.length < 6) return;
    if (val === this._mfaCode){
      clearInterval(this._mfaTimerId);
      this.completeMfa();
    } else {
      boxes.forEach(b => b.classList.add('is-invalid'));
      DisplaySwal('error', '', 'The code is incorrect. Enter the code shown above.');
    }
  },

  completeMfa(){
    const u = this._mfaUser;
    document.getElementById('login-step-mfa').classList.add('d-none');
    document.getElementById('login-step-credentials').classList.remove('d-none');
    DisplayLoadingSwal();
    setTimeout(() => {
      Swal.close();
      this.enter(u, `Signed in as ${u.name}`);
    }, 400);
  },

  /** Everything that has to happen for a user to be inside the portal. */
  enter(u, toast){
    const db = Store.db;

    CU = Object.assign({}, u);
    CR = u.roleKey;
    /* An examiner starts on the first taxpayer and changes it from the sidebar.
       EPI's staff work across every account and sit in none of them. */
    if (!u.tenantId && !isOperator()) CU.tenantId = db.tenants[0].id;
    CT = db.tenants.find(t => t.id === CU.tenantId) || null;

    /* An owner whose application EPI accepted, still setting up. The account is
       written at activation, so until then there is no tenant to enter. */
    const setupApp = !CT && u.tenantId ? AppReg.forTenant(u.tenantId) : null;

    logActivity(db, { action: CR === 'BIR_EXAMINER' ? 'BIR examiner opened this account'
                            : isOperator() ? 'Signed in to the operator console' : 'Signed in',
                      actorType: isOperator() ? 'EPI' : 'USER' });
    Store.save(db);
    SessionCtl.open(CU);

    if (setupApp){
      Onboarding.resume(setupApp);
      if (toast) UI.toast(toast, 'ok');
      return;
    }
    this.openPortal(toast);
  },

  openPortal(toast){
    UI.show('view-portal');
    this.paintChrome();
    Nav.build();
    Nav.autoCollapse();
    Nav.go(Nav.defaultView());
    if (toast) UI.toast(toast, 'ok');
  },

  /** An applicant has no account until EPI accepts them, so the status is found by reference and TIN. */
  checkApplication(){
    UI.openModal('Check your application', `
      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Application reference</span>
        <input type="text" id="chk-ref" class="form-control height_40 fs_14 shadow-none mono text-uppercase" placeholder="APP-2026-0000" maxlength="16">
      </div>
      <div class="mb-1">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">TIN</span>
        <input type="text" id="chk-tin" class="form-control height_40 fs_14 shadow-none mono" placeholder="000-000-000" maxlength="11">
        <div class="fs_11 text-muted mt-1">The reference is in the email EPI sent when you applied.</div>
      </div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary" onclick="Auth.findApplication()">Check status</button>`);
  },

  findApplication(){
    const app = AppReg.byRef($('#chk-ref').val());
    if (!app || AppReg.normTin(app.tin) !== AppReg.normTin($('#chk-tin').val())){
      DisplaySwal('info', '', 'No application matches that reference and TIN. Check both and try again.');
      return;
    }
    UI.closeModal();
    Onboarding.openApp(app);
  },

  logout(){
    const db = Store.db;
    if (CU) { logActivity(db, { action:'Signed out' }); Store.save(db); }
    SessionCtl.close('signed out');
    CU = null; CR = null; CT = null;
    Nav.current = null;
    this.showLogin();
  },

  /**
   * Sign-out that the user did not ask for — the idle clock ran down, or
   * somebody ended this session from elsewhere. Says which, because being
   * dropped onto a login screen with no explanation reads as a fault.
   */
  forceOut(why){
    CU = null; CR = null; CT = null;
    Nav.current = null;
    this.showLogin();
    DisplaySwal('info', '', why || 'Your session has ended.');
  },

  /* ---------- Banner and sidebar ---------- */
  paintChrome(){
    refreshSession();
    if (!CU || (!CT && !isOperator())) return;
    const db = Store.db;
    const op = isOperator();
    $('#tenant-switcher').closest('.sidebar_demo_row').toggleClass('d-none', op);

    if (op){
      /* The operator is not inside any client's account, so the sidebar names
         EPI itself: the provider, and a taxpayer in its own right. */
      document.getElementById('banner-tenant-name').textContent = SYSTEM.vendor;
      document.getElementById('banner-tenant-meta').textContent = `TIN ${SYSTEM.taxpayer.tin}-000 · Operator console`;
      document.getElementById('banner-tenant-address').textContent = SYSTEM.taxpayer.address;
    }
    if (!op){
      const cls = { LARGE:'Large Taxpayer', MEDIUM:'Medium', SMALL:'Small', MICRO:'Micro' }[CT.classification] || CT.classification;
      document.getElementById('banner-tenant-name').textContent = CT.name;
      document.getElementById('banner-tenant-meta').textContent =
        `TIN ${CT.tin}-000 · ${cls} · ${CT.jurisdiction}`;
      document.getElementById('banner-tenant-address').textContent = CT.address;
    }

    const br = CU.branchId ? db.branches.find(b => b.id === CU.branchId) : null;
    document.getElementById('side-user-name').textContent = CU.name;
    document.getElementById('side-user-role').textContent =
      ROLES[CR].short + (op ? ' · All accounts' : br ? ' · ' + br.name : ' · All branches');

    document.getElementById('tenant-switcher-label').textContent =
      CR === 'BIR_EXAMINER' ? 'Taxpayer examined' : 'Demo business';
    this.paintBanner();

    const eis = eisState();
    const elEis = document.getElementById('eis-status');
    elEis.innerHTML =
      `<span class="sidebar_status_dot ${!eis.online ? 'off' : eis.waiting ? 'wait' : 'ok'}"></span>` +
      (eis.online ? 'Online' : 'Offline') + ' · ' +
      (eis.waiting ? `${eis.waiting} waiting` : 'nothing waiting');
    elEis.title = eis.online
      ? 'Simulated link. The BIR has not published a system to receive invoices yet.'
      : `${INTERRUPTION_SOURCES[eis.interruption.source].label} (${eis.interruption.ref}) since ${fmtDateTime(eis.interruption.startedAt)}`;
    document.getElementById('system-version').textContent = `${SYSTEM.product} v${SYSTEM.version}`;

    const sw = document.getElementById('tenant-switcher');
    sw.innerHTML = db.tenants.map(t =>
      `<option value="${t.id}"${t.id === CU.tenantId ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    EnhanceSelect('#tenant-switcher', $(document.body));
    $('#tenant-switcher').off('change').on('change', function () { Auth.switchTenant(this.value); });
  },

  /** What the person looking at this account needs to know before anything else:
      that it is read-only, and why, or that a legal hold is in force. */
  paintBanner(){
    const el = document.getElementById('account-banner');
    if (!el) return;
    const out = [];
    const st = CT ? accountStatus() : 'ACTIVE';
    if (CR === 'BIR_EXAMINER')
      out.push(Callout('info', `<strong>BIR examiner access.</strong> Read-only view of ${esc(CT.name)}. This access is recorded in the account's activity log.`));
    if (st !== 'ACTIVE')
      out.push(Callout('warn', `<strong>This account is ${st.toLowerCase()}.</strong> ${
        st === 'SUSPENDED' && CT.suspension ? `${esc(OpsReg.SUSPEND_REASONS[CT.suspension.reason] || '')}, ${esc(fmtDate(CT.suspension.at))}. ` : ''}It is read-only. Everything on it can still be viewed and exported. Only EPI can reopen it.`));
    const down = activeInterruption();
    if (down)
      out.push(Callout('danger', `<strong>${esc(INTERRUPTION_SOURCES[down.source].label)}.</strong> Reference ${esc(down.ref)}, since ${esc(fmtDateTime(down.startedAt))}. ${
        isOperator()
          ? (INTERRUPTION_SOURCES[down.source].blocksIssuing
              ? `Client sales are on hold (${OutageQueue.waiting().length} waiting). They are issued and sent to the buyers when this is closed.`
              : 'Every send is held on every account until it is closed.') + (down.verified ? '' : ' Not yet verified.')
        : INTERRUPTION_SOURCES[down.source].blocksIssuing
          ? 'Sales you enter wait. They are issued and sent to the buyers when service returns.'
          : 'You can still issue invoices. They are held and sent when the link returns.'}${
        !isOperator() && IncReg.notices().some(n => n.interruptionId === down.id && n.tenantIds.indexOf(CT.id) > -1)
          ? ' <a href="#" onclick="Nav.go(\'notices\');return false;">Read EPI\'s notice</a>' : ''}`));
    if (CT && CT.legalHold && CT.legalHold.active)
      out.push(Callout('warn', `<strong>Legal hold in force.</strong> Reference ${esc(CT.legalHold.reference)}. Records are kept as they are and nothing is archived out or removed while it stands.`));
    el.innerHTML = out.length ? `<div class="px-3 pt-3 d-flex flex-column gap-2">${out.join('')}</div>` : '';
  },

  /* ---------- Demo tenant switch ---------- */
  switchTenant(tenantId){
    const db = Store.db;
    if (CR === 'BIR_EXAMINER'){
      /* Same person, different taxpayer: the role stays read-only throughout. */
      SessionCtl.close('changed taxpayer');
      CU.tenantId = tenantId;
      CT = db.tenants.find(t => t.id === tenantId);
      logActivity(db, { action:'BIR examiner opened this account' });
      Store.save(db);
      SessionCtl.open(CU);
      this.paintChrome();
      Nav.build();
      Nav.goSafe(Nav.current);
      UI.toast(`Now examining ${CT.name}`, 'ok');
      return;
    }
    const owner = db.users.find(u => u.tenantId === tenantId && u.roleKey === 'OWNER');
    if (!owner){ UI.toast('No user for that business', 'err'); return; }
    /* Becoming a different person is a different session, even in a demo —
       otherwise the sessions list would show one login that changed identity. */
    SessionCtl.close('switched business');
    CU = Object.assign({}, owner);
    CR = owner.roleKey;
    CT = db.tenants.find(t => t.id === tenantId);
    SessionCtl.open(owner);
    this.paintChrome();
    Nav.build();
    Nav.goSafe(Nav.current);
    UI.toast(`Switched to ${CT.name}. Signed in as Owner`, 'ok');
  },

  /* ---------- Account sheet (sidebar footer) ---------- */
  openUserSheet(){
    const db = Store.db;
    const br = CU.branchId ? db.branches.find(b => b.id === CU.branchId) : null;
    const body = `
      <div class="user-sheet">
        <div class="user-sheet-head">
          <div class="avatar">${esc(initials(CU.name))}</div>
          <div>
            <div class="user-sheet-name">${esc(CU.name)}</div>
            <div class="muted small">${esc(CU.position)} · ${esc(ROLES[CR].label)}</div>
            <div class="muted small">${br ? esc(br.name) + ' (' + esc(br.code) + ')' : 'All branches'}</div>
          </div>
        </div>
      </div>`;
    UI.openModal('Account', body,
      `<button class="lbtn lbtn-ghost" onclick="App.resetDemo()">Reset demo data</button>
       <button class="lbtn lbtn-ghost" onclick="Auth.openRoleSwitch()">Switch role</button>
       <button class="lbtn lbtn-primary" onclick="UI.closeModal()">Close</button>`);
  },

  /* ---------- Role switch ---------- */
  openRoleSwitch(){
    if (CR === 'BIR_EXAMINER' || isOperator()){ UI.toast('This sign-in has one role. Sign out to use another account.', 'warn'); return; }
    const db = Store.db;
    const users = db.users.filter(u => u.tenantId === CU.tenantId && u.active);

    const body = `
      <p class="muted small">Switch role within ${esc(CT.name)} to see how the interface changes.
      Branch-scoped roles cannot see other branches.</p>
      <div class="radio-cards">
        ${users.map(u => {
          const r = ROLES[u.roleKey], p = PERMS[u.roleKey];
          const br = u.branchId ? db.branches.find(b => b.id === u.branchId) : null;
          const caps = [];
          if (p.issue) caps.push('Operate');
          if (p.approve) caps.push('Approve');
          if (p.export) caps.push('Export');
          if (p.users) caps.push('Manage users');
          if (!caps.length) caps.push('Read-only');
          return `
          <label class="radio-card${u.id === CU.id ? ' selected' : ''}" onclick="Auth._pickRole('${u.id}',this)">
            <input type="radio" name="rolepick" value="${u.id}"${u.id === CU.id ? ' checked' : ''}>
            <div>
              <div class="radio-card-title">${esc(r.label)}</div>
              <div class="radio-card-desc">
                ${esc(u.name)} · ${esc(u.position)}<br>
                <span class="muted">${r.scope === 'org' ? 'Organization-wide' : 'Branch: ' + esc(br ? br.name : '—')}
                · ${caps.join(' · ')}</span>
              </div>
            </div>
          </label>`;
        }).join('')}
      </div>`;

    UI.openModal('Switch role', body,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary" onclick="Auth.applyRoleSwitch()">Switch</button>`);
  },

  _pickRole(id, el){
    document.querySelectorAll('#modal-body .radio-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    el.querySelector('input').checked = true;
  },

  applyRoleSwitch(){
    const sel = document.querySelector('#modal-body input[name=rolepick]:checked');
    if (!sel) return;
    const db = Store.db;
    const u = db.users.find(x => x.id === sel.value);
    SessionCtl.close('switched role');
    CU = Object.assign({}, u);
    CR = u.roleKey;
    SessionCtl.open(u);
    UI.closeModal();
    this.paintChrome();
    Nav.build();
    Nav.goSafe(Nav.current);
    UI.toast(`Now viewing as ${ROLES[CR].label}`, 'ok');
  },

  /* ---------- Branch scoping ---------- */
  /** Invoices visible to the current user. Branch-scoped roles see only their branch. */
  visibleInvoices(){
    refreshSession();
    const db = Store.db;
    let list = db.invoices.filter(i => i.tenantId === CU.tenantId);
    if (!can('allBranches') && CU.branchId){
      list = list.filter(i => i.branchId === CU.branchId);
    }
    return list.sort((a,b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  },

  visibleBranches(){
    const db = Store.db;
    let list = db.branches.filter(b => b.tenantId === CU.tenantId);
    if (!can('allBranches') && CU.branchId){
      list = list.filter(b => b.id === CU.branchId);
    }
    return list;
  }
};

/* Sign-in is wired the way the source portal wires it: a class hook, not an
   inline handler. Enter in the password field submits. */
$(function(){
  $(document).off('click', '.button_validate_credentials')
    .on('click', '.button_validate_credentials', () => Auth.doLogin());

  $(document).off('keypress', '.input_login_password')
    .on('keypress', '.input_login_password', e => {
      if (e.which === 13) Auth.doLogin();
    });

  IconHideShow();   /* the eye toggle on the password field */
  Logout();         /* .div_logout in the sidebar footer */
});
