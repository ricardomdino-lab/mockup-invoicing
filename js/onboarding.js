/* ============================================================
   onboarding.js — applying, then setting up

   Validation comes first (RMC VII.1). A business applies without an account:
   who is applying, its documents, the representative's authority, coverage,
   and the fee schedule with consent. EPI checks legal existence, coverage and
   authority in the operator console within three working days. Only an
   accepted application gets a login, sent as a set-password link to the
   applicant, who becomes the account owner.

   Setup then happens inside the account: tier and fees, tax profile and
   attestation, branches, invoicing, Permit to Issue, sandbox and activation.
   The tenant record is written only at activation, so an account still in
   setup is never billed, listed or reported as a client. Tier 1 activates
   on its own; Tiers 2 to 5 wait for EPI's activation review.

   The numbering series is opened per branch at the number declared in setup,
   and nothing else in the system can move it afterwards.
   ============================================================ */

/* Demo switch: shows the "Demo:" buttons in the header and on the status page. Set to false to remove them. */
const DEMO_MODE = true;

const APPLY_STEPS = [
  { key:'applicant', label:'Applicant' },
  { key:'documents', label:'Business documents' },
  { key:'authority', label:'Authority' },
  { key:'coverage',  label:'Coverage' },
  { key:'consent',   label:'Fees and consent', gate:true },
  { key:'submitted', label:'Submitted', final:true }
];

const SETUP_STEPS = [
  { key:'lane',     label:'Tier and fees' },
  { key:'business', label:'Tax profile', gate:true },
  { key:'branches', label:'Branches' },
  { key:'agreement', label:'Agreement' },
  { key:'setup',    label:'Invoicing setup' },
  { key:'pti',      label:'Permit to Issue' },
  { key:'sandbox',  label:'Sandbox testing', gate:true },
  { key:'finish',   label:'Activation', gate:true },
  { key:'golive',   label:'Done', final:true }
];

/* Proof of legal existence by type of business, and who can sign for it. */
const ENTITY_TYPES = {
  SOLE:        { label:'Sole proprietorship', authority:'SPA', signer:'The proprietor',
                 legal:[['dti', 'DTI Certificate of Business Name Registration']] },
  PARTNERSHIP: { label:'Partnership', authority:'PARTNERS_RES', signer:'A managing partner',
                 legal:[['sec', 'SEC Certificate of Registration'], ['aop', 'Articles of Partnership']] },
  CORPORATION: { label:'Corporation', authority:'SEC_CERT', signer:'The president or a corporate officer named in the latest GIS',
                 legal:[['sec', 'SEC Certificate of Incorporation'], ['gis', 'Latest General Information Sheet (GIS)']] },
  OPC:         { label:'One Person Corporation', authority:'SEC_CERT', signer:'The single stockholder or the president',
                 legal:[['sec', 'SEC Certificate of Incorporation'], ['gis', 'Latest General Information Sheet (GIS)']] },
  COOPERATIVE: { label:'Cooperative', authority:'BOARD_RES', signer:'The chairperson or the general manager',
                 legal:[['cda', 'CDA Certificate of Registration']] }
};
const AUTHORITY_DOCS = {
  SEC_CERT:     "Secretary's certificate or board resolution",
  PARTNERS_RES: "Partners' resolution or special power of attorney (SPA)",
  SPA:          'Special power of attorney (SPA) signed by the proprietor',
  BOARD_RES:    'Board resolution'
};
const DOC_LABELS = {
  cor:'BIR Form 2303 (Certificate of Registration)', dti:'DTI certificate', sec:'SEC certificate', aop:'Articles of Partnership',
  gis:'General Information Sheet', cda:'CDA certificate', idApplicant:'Government ID of the applicant',
  authDoc:'Authority document', idSignatory:'Government ID of the signatory', extra:'Additional document',
  signedAgreement:'Signed and notarized Client Service Agreement, with Annex 1', usageHistory:'Sales history, each of the last 12 months'
};

/* ---------- Applications: the record EPI validates (RMC VII.1, VII.12) ---------- */
const AppReg = {
  TURNAROUND_DAYS: 3,        /* working days for EPI to answer an application */
  GOLIVE_DAYS: 1,            /* working days for the activation review */
  RETENTION_DAYS: 30,        /* declined or abandoned: documents deleted after this (placeholder) */
  AUTHORITY_WARN_DAYS: 30,
  OPEN: ['PENDING_VERIFICATION', 'NEEDS_INFO', 'ACCEPTED'],

  STATUS: {
    PENDING_VERIFICATION: { label:'Under review',             tone:'amber' },
    NEEDS_INFO:           { label:'More information needed',  tone:'blue'  },
    ACCEPTED:             { label:'Accepted',                 tone:'green' },
    DECLINED:             { label:'Declined',                 tone:'gray'  }
  },

  DECLINE_REASONS: {
    NOT_COVERED:   'Not required to issue e-invoices by the deadline',
    NO_LEGAL:      'Legal existence could not be confirmed',
    NO_AUTHORITY:  "The representative's authority could not be confirmed",
    DOCS_MISMATCH: 'The documents do not match the application',
    NO_REPLY:      'No reply to a request for more information',
    DUPLICATE:     'Duplicate of another application or account'
  },

  get(id){ return (Store.db.onboardingApps || []).find(a => a.id === id) || null; },
  byRef(ref){
    const r = String(ref || '').trim().toUpperCase();
    return (Store.db.onboardingApps || []).find(a => String(a.ref).toUpperCase() === r) || null;
  },
  /** The accepted application behind an account still in setup or in activation review. */
  forTenant(tid){
    return (Store.db.onboardingApps || []).find(a => a.tenantId === tid && a.status === 'ACCEPTED' && !a.activatedAt) || null;
  },

  nextRef(db){
    const y = new Date().getFullYear();
    const n = (db.onboardingApps || []).filter(a => String(a.ref || '').indexOf('APP-' + y) === 0).length + 1;
    return `APP-${y}-${String(n).padStart(4, '0')}`;
  },

  /* Same company: case, punctuation and the usual suffixes do not count. */
  normName(s){
    return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b(inc|incorporated|corp|corporation|co|company|opc|ltd|limited|the)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  },
  normTin(s){ return String(s || '').replace(/\D/g, '').slice(0, 9); },

  /** Why a new application cannot be taken, or ''. */
  duplicate(tin, name, email){
    const db = Store.db, t = this.normTin(tin), n = this.normName(name);
    const open = (db.onboardingApps || []).filter(a => this.OPEN.indexOf(a.status) > -1);
    const hit = x => (t && this.normTin(x.tin) === t) ? 'TIN' : (n && this.normName(x.tenantName || x.name) === n) ? 'name' : '';
    for (const a of open){
      const h = hit(a);
      if (h) return `An application with the same ${h} is already ${a.status === 'ACCEPTED' ? 'accepted' : 'being reviewed'}. Check its status with the reference you were given, or contact EPI if this is a mistake.`;
    }
    for (const x of db.tenants){
      const h = hit(x);
      if (h) return `A business with the same ${h} already has an account with EPI. Ask its owner to add you as a user, or contact EPI if this is a mistake.`;
    }
    if (email && (db.users || []).some(u => String(u.email).toLowerCase() === String(email).toLowerCase()))
      return 'That email already belongs to an account. Enter another email.';
    return '';
  },

  workingDaysAfter(iso, n){
    const d = new Date(iso);
    let left = n;
    while (left > 0){ d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
    return d.toISOString();
  },
  overdue(a){ return a.status === 'PENDING_VERIFICATION' && a.dueAt && new Date() > new Date(a.dueAt); },
  /** While EPI waits for the applicant, its own clock is paused; this is the applicant's deadline. */
  replyBy(a){ return new Date(new Date(a.info.at).getTime() + this.RETENTION_DAYS * 864e5).toISOString(); },
  daysTaken(a){
    if (!a.reviewedAt) return null;
    return Math.max(0, Math.round((new Date(a.reviewedAt) - new Date(a.submittedAt)) / 864e5));
  },
  /** 'EXPIRED', 'SOON' or '' for a representative's authority. */
  authorityState(x){
    const exp = x && x.authority && x.authority.expiresAt;
    if (!exp) return '';
    const days = (new Date(exp + 'T23:59:59+08:00') - new Date()) / 864e5;
    return days < 0 ? 'EXPIRED' : days <= this.AUTHORITY_WARN_DAYS ? 'SOON' : '';
  },
  note(a, what, by){
    a.history = a.history || [];
    a.history.push({ at:new Date().toISOString(), what, by:by || 'EPI' });
  },

  /** Unanswered requests lapse, and documents of closed applications are deleted. */
  sweep(db){
    const now = Date.now(), keep = this.RETENTION_DAYS * 864e5;
    let changed = false;
    (db.onboardingApps || []).forEach(a => {
      if (a.status === 'NEEDS_INFO' && a.info && now - new Date(a.info.at) > keep){
        Object.assign(a, { status:'DECLINED', declineCode:'NO_REPLY', declineReason:this.DECLINE_REASONS.NO_REPLY,
                           reviewedBy:'System', reviewedAt:new Date().toISOString(),
                           purgeAt:new Date(now + keep).toISOString() });
        this.note(a, 'Closed: no reply within ' + this.RETENTION_DAYS + ' days', 'System');
        changed = true;
      }
      if (a.status === 'DECLINED' && a.purgeAt && new Date(a.purgeAt) <= new Date() && !a.docsDeletedAt){
        a.documents = {}; a.docsDeletedAt = new Date().toISOString();
        this.note(a, 'Documents deleted after the retention period', 'System');
        changed = true;
      }
    });
    return changed;
  },

  /**
   * Accept a validated application: record the three checks and what was read
   * from Form 2303, reserve the account and invite the applicant as owner.
   * The account itself is written at activation (AppReg.build).
   */
  accept(db, a, r, by){
    const now = new Date().toISOString(), b = COVERAGE_BASES[r.basis];
    a.checks = {
      legal:     { ok:true, note:r.legal, by, at:now },
      coverage:  { ok:true, basis:r.basis, note:`${b.label}, ${b.ref}`, by, at:now },
      authority: { ok:true, note:r.authority, by, at:now }
    };
    a.cor = { taxType:r.taxType, rdo:r.rdo, address:r.address, lob:r.lob, by, at:now };
    if (a.authority && r.expiresAt) a.authority.expiresAt = r.expiresAt;
    a.tenantId = a.tenantId || uid('t');
    const token = keycode(8);
    db.users.push({
      id:uid('u'), tenantId:a.tenantId, branchId:null, roleKey:'OWNER',
      name:a.applicant.person, email:a.email, position:a.applicant.position,
      active:false, status:'INVITED', invitedAt:now, invitedBy:'EPI Client Onboarding', inviteToken:token
    });
    a.ownerToken = token;
    Object.assign(a, { status:'ACCEPTED', stage:'SETUP', reviewedBy:by, reviewedAt:now });
    this.note(a, 'Accepted. Set-password link sent to ' + a.email, by);
    logActivity(db, { tenantId:a.tenantId, actorType:'EPI', actorName:by, role:'EPI_OPERATOR',
      action:`Application ${a.ref} from ${a.tenantName} validated and accepted: ${a.checks.coverage.note}` });
    return token;
  },

  /** Why a representative change cannot go ahead, or ''. Shared by the client's request and EPI's own replacement. */
  repProblem(db, d){
    const email = String(d.email || '').trim();
    if (!String(d.name || '').trim() || !String(d.position || '').trim() || !email) return "Enter the new representative's name, position and email.";
    if (!d.file) return 'Upload the new authority document. A representative cannot be replaced without one.';
    if (d.expiresAt && new Date(d.expiresAt + 'T23:59:59+08:00') < new Date()) return 'That authority document has already expired.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter a valid email.';
    if (db.users.some(u => String(u.email).toLowerCase() === email.toLowerCase())) return 'That email already belongs to an account.';
    return '';
  },

  /** Replace the representative: invite the new owner, end the old one's access, record the validated document. */
  replaceRep(db, t, d, by){
    const now = new Date().toISOString(), name = d.name.trim(), position = d.position.trim(), email = d.email.trim();
    const old = t.representative;
    const oldUser = old && old.userId ? db.users.find(u => u.id === old.userId) : null;
    if (oldUser){ oldUser.active = false; oldUser.status = 'DISABLED'; }
    const token = keycode(8), id = uid('u');
    db.users.push({ id, tenantId:t.id, branchId:null, roleKey:'OWNER', name, email, position,
      active:false, status:'INVITED', invitedAt:now, invitedBy:'EPI Client Onboarding', inviteToken:token });
    t.representative = { name, position, userId:id };
    t.authority = { kind:(t.authority || {}).kind || (ENTITY_TYPES[t.entity] || ENTITY_TYPES.CORPORATION).authority,
                    file:d.file, expiresAt:d.expiresAt || null, validatedBy:by, validatedAt:now };
    logActivity(db, { tenantId:t.id, actorType:'EPI', actorName:by, role:'EPI_OPERATOR',
      action:`Representative replaced${old ? ': ' + old.name + ' to ' + name : ' by ' + name}. New authority document validated${oldUser ? " and the previous representative's access disabled" : ''}` });
    return token;
  },

  /**
   * Write the taxpayer, its branches, its series and finish its owner, from
   * the setup the owner completed. One pass, saved once by the caller.
   */
  build(db, a, approvedBy){
    const s = a.setup, now = new Date().toISOString();
    const express = s.lane === 'EXPRESS', ex = s.extracted || {};
    const tenantId = a.tenantId;
    const owner = db.users.find(u => u.tenantId === tenantId && u.roleKey === 'OWNER' && u.email === a.email);
    const person = owner ? owner.name : a.applicant.person;
    const branchSpecs = express ? [{ code:'000', name:'Main', rdo:ex.rdo, address:ex.address }] : s.branches;

    db.tenants.push({
      id: tenantId,
      name: ex.name || a.tenantName,
      tradeName: ex.trade || a.tenantName,
      tin: String(a.tin).replace(/[^\d-]/g, ''),
      entity: a.entity,
      classification: s.coverage.micro ? 'MICRO' : (express ? 'SMALL' : 'LARGE'),
      jurisdiction: ex.rdo || '—',
      address: ex.address || '—',
      lineOfBusiness: ex.lob || '—',
      email: a.email,
      lane: s.lane,
      plan: s.plan,
      planHistory: [{ plan:s.plan, from:now }],
      deposit: DepositReg.opening(s.plan, (s.deposit || {}).method, person, now),
      provider: s.provider ? Object.assign({}, s.provider, { instruction:{ status:'ACTIVE', signedAt:now, by:person }, confirmed:{ by:(a.providerCheck || {}).by || 'EPI', at:(a.providerCheck || {}).at || now } }) : undefined,
      agreement: { version:CSA.version, signedFile:(s.docs || {}).signedAgreement || '', notary:s.notary || null,
                   verifiedBy:(a.agreementCheck || {}).by || 'EPI', verifiedAt:(a.agreementCheck || {}).at || now, countersignedAt:now },
      usageHistory: { avgMonthly: (s.usage || {}).avg == null ? null : Number(s.usage.avg), newBusiness: !!(s.usage || {}).newBusiness },
      tierDeclaredAt: s.declared ? now : null,
      deliveryFallback: s.config.deliveryFallback || '',
      vatStatus: s.profile.vatStatus,
      hasExempt: s.profile.hasExempt,
      hasZero: s.profile.hasZero,
      servesSCPWD: s.profile.servesSCPWD,
      isWithholdingAgent: s.profile.withholding,
      attestedBy: s.attestedBy,
      attestedAt: s.attestedAt || now,
      seriesPrefix: s.config.prefix,
      deliveryMethod: s.config.delivery,
      /* Stored as a list from the outset; see connections() in core.js. */
      connection: [s.connection],
      onboardingStatus: 'LIVE',
      goLiveAt: now,
      coverageBasis: (a.checks.coverage && a.checks.coverage.basis) || a.coverage.basis,
      pti: s.pti.mode === 'HAVE' ? s.pti.number : '',
      ptiIssuedAt: s.pti.mode === 'HAVE' ? s.pti.issuedAt : null,
      ptiAppliedAt: s.pti.mode === 'EPI' ? now : null,
      /* Who can bind the business, and the authority EPI validated (RMC VII.1). */
      signatory: a.authority ? { name:a.authority.signatory, position:a.authority.signatoryPosition }
                             : { name:a.applicant.person, position:a.applicant.position },
      representative: a.authority ? { name:a.applicant.person, position:a.applicant.position, userId:owner ? owner.id : null } : null,
      authority: a.authority ? { kind:a.authority.kind, file:a.documents.authDoc || '', expiresAt:a.authority.expiresAt || null,
                                 validatedBy:a.checks.authority.by, validatedAt:a.checks.authority.at } : null,
      applicationRef: a.ref,
      /* Written authorizations given during setup (RMC V.A.2). */
      authorizations: [
        s.auth.file ? { kind:'PTI_FILING', by:person, at:now } : null,
        s.auth.api  ? { kind:'INTEGRATION_TESTING', by:person, at:now } : null
      ].filter(Boolean),
      consents: Object.assign({}, a.consents),
      template: {}
    });

    const branchIds = branchSpecs.map(b => {
      const id = uid('b');
      db.branches.push({ id, tenantId, code:b.code, name:b.name, rdo:b.rdo, city:'', address:b.address, active:true });
      return id;
    });

    /* One invoice series for the whole taxpayer, shared by all its branches. */
    db.series = db.series || {};
    db.series[`INVOICE:${tenantId}`] = { next: s.config.seriesStart, issued:[], retired:[] };

    a.activatedAt = now;
    a.stage = 'LIVE';
    a.activatedBy = approvedBy || person;
    this.note(a, approvedBy ? 'Activation approved and account activated' : 'Account activated', approvedBy || person);

    const log = (action, actorType, actorName) => logActivity(db, { tenantId, actorType:actorType || 'USER', actorName:actorName || person,
      role:actorType === 'EPI' ? 'EPI_OPERATOR' : 'OWNER', action });
    log(`Applied as ${a.authority ? 'authorized representative' : 'signatory'} under ${a.ref}. Terms of Use accepted and privacy consent given`);
    log(`Confirmed the tax profile (${s.profile.vatStatus === 'VAT' ? 'VAT Registered' : 'Non-VAT'})`, 'USER', s.attestedBy);
    if (s.auth.file) log('Authorized EPI in writing to file the Permit to Issue application');
    if (s.auth.api) log('Authorized EPI in writing to connect to and test the integration');
    if (approvedBy) log('Activation review passed', 'EPI', approvedBy);
    log(`Account activated on ${feesFor(s.plan).label}. Fees start with the first invoice`, approvedBy ? 'EPI' : 'USER', approvedBy || person);
    return tenantId;
  }
};

const Onboarding = {
  idx: 0,
  state: null,
  mode: 'apply',     // 'apply' (public, no account) or 'setup' (inside an accepted account)
  app: null,         // the application record, once there is one

  /* ---------- Lifecycle ---------- */
    start(){
    this.mode = 'apply';
    this.app = null;
    this.idx = 0;
    this.state = {
      applicant: { tin:'', name:'', entity:'', email:'', person:'', position:'', capacity:'' },
      docs: {},
      authority: { signatory:'', signatoryPosition:'', expires:'' },
      coverage: { picks:[], micro:false, headOffice:false },
      agree: { terms:false, privacy:false, truth:false }
    };
    this.show();
  },

  /** The status page of an application already submitted. */
  openApp(app){
    this.mode = 'apply';
    this.app = app;
    this.state = null;
    this.idx = this.visibleSteps().length - 1;
    this.show();
  },

  /** Setup inside an accepted account. Progress is kept on the application. */
  resume(app){
    this.mode = 'setup';
    this.app = app;
    if (!app.setup){ app.setup = this.freshSetup(app); Store.save(Store.db); }
    this.state = app.setup;
    const last = this.visibleSteps().length - 1;
    /* A review returned for changes reopens the activation step. */
    this.idx = app.stage === 'GOLIVE_REVIEW' ? last : Math.min(this.state.idx || 0, last - 1);
    this.show();
  },

  freshSetup(app){
    const c = app.cor || {};
    return {
      idx: 0, lane:null, plan:null, usage:{ avg:null, newBusiness:false }, declared:false, deposit:{ paid:false, method:null }, provider:null, notary:{ arrange:true, date:'' },
      signup: { tin:app.tin, name:app.tenantName, email:app.email, person:app.applicant.person },
      cor: { verified:true },
      extracted: {
        name: app.tenantName,
        trade: app.tenantName.replace(/,?\s*(Inc\.|Corp\.|Corporation|Incorporated|OPC)$/i, ''),
        tin: app.tin, branchCode:'000',
        taxType: c.taxType === 'NONVAT' ? 'Non-VAT (Percentage Tax)' : 'VAT',
        rdo: c.rdo || '—', address: c.address || '—', lob: c.lob || '—'
      },
      profile: { vatStatus:c.taxType || 'VAT', hasExempt:false, hasZero:false, servesSCPWD:false, withholding:false },
      attested:false, attestedBy:'',
      coverage: app.coverage,
      pti: { mode:null, number:'' },
      auth: { api:false, file:false },
      ack: false,
      branches: [],
      config: { prefix: app.tenantName.split(/\s+/).slice(0, 3).map(w => w[0]).join('').toUpperCase().slice(0, 4) || 'INV',
                seriesStart:1, delivery:'EMAIL_PDF', deliveryFallback:'' },
      connection: null,
      sandbox: { run:false, passed:false }
    };
  },

  show(){
    const setup = this.mode === 'setup';
    document.getElementById('ob-title').textContent = setup ? 'Set up your account' : 'Apply for an account';
    document.getElementById('ob-exit-btn').textContent = setup ? 'Sign out' : (this.app ? 'Close' : 'Exit application');
    UI.show('view-onboarding');
    this.render();
  },

  exit(){
    if (this.mode === 'setup'){
      DisplayConfirmSwal(
        `<span class="fw-bold fs_18 text-dark">Sign out?</span>
         <span class="fs_14 text-muted">Your setup is saved. Sign in again to continue where you stopped.</span>`,
        () => { UI.closeModal(); Auth.logout(); }, null, 'Sign out');
      return;
    }
    if (this.app){ Auth.showLogin(); return; }
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Leave the application?</span>
       <span class="fs_14 text-muted">Nothing has been submitted. You will start again from the first step.</span>`,
      () => { UI.closeModal(); Auth.showLogin(); }, null, 'Leave');
  },

  /* ---------- Step chrome ---------- */
  visibleSteps(){
    if (this.mode === 'setup')
      /* Tier 1 is single-location by definition, so there is nothing to map. */
      return SETUP_STEPS.filter(s => !(s.key === 'branches' && this.state.lane === 'EXPRESS'));
    const ap = this.state ? this.state.applicant : this.app.applicant;
    return APPLY_STEPS.filter(s => !(s.key === 'authority' && ap.capacity !== 'REPRESENTATIVE'));
  },

  render(){
    const steps = this.visibleSteps();
    const shown = steps.filter(s => !s.final);
    if (this.idx >= steps.length) this.idx = steps.length - 1;
    const cur = steps[this.idx];
    const demoBtn = document.getElementById('ob-demo-btn');
    if (demoBtn) demoBtn.style.display = DEMO_MODE && !cur.final ? '' : 'none';

    document.getElementById('ob-lane-badge').textContent = this.mode === 'setup'
      ? (this.state.plan ? feesFor(this.state.plan).label : 'Tier not selected')
      : (this.app ? this.app.ref : 'New application');

    document.getElementById('ob-step-list').innerHTML = shown.map((s, i) => {
      const cls = i < this.idx ? 'done' : (i === this.idx ? 'active' : '');
      return `<li class="${cls}${s.gate ? ' gate' : ''}">${esc(s.label)}</li>`;
    }).join('');

    document.getElementById('ob-content').innerHTML = this['step_' + cur.key]();
    EnhanceSelect('#p-vat');
    window.scrollTo(0, 0);
  },

  /** Setup progress survives signing out. */
  persist(){
    if (this.mode !== 'setup') return;
    this.state.idx = this.idx;
    this.state.updatedAt = new Date().toISOString();
    Store.save(Store.db);
  },

  next(){ this.idx++; this.persist(); this.render(); },
  back(){ if (this.idx > 0){ this.idx--; this.persist(); this.render(); } },

  /* ---------- Shared markup ---------- */

  panel(title, lede, body, actions){
    /* Inside a combined step the pieces are sections of one page. */
    if (this._compose){
      return `<section class="mb-4">
        ${title ? `<h2 class="fs_18 fw-bold text-dark mb-1">${title}</h2>` : ''}
        ${lede ? `<div class="fs_13 text-secondary mb-3 line_height_1_6">${lede}</div>` : ''}
        ${body}
      </section>`;
    }
    const shown = this.visibleSteps().filter(s => !s.final);
    const eyebrow = this.idx < shown.length
      ? `<div class="fs_11 text-muted fw-semibold text-uppercase mb-1">Step ${this.idx + 1} of ${shown.length}</div>` : '';
    return `
      <div class="lcard"><div class="lcard-body p-4 p-lg-5">
        ${eyebrow}
        <h1 class="fs_25 fw-bold text-dark mb-2">${title}</h1>
        ${lede ? `<div class="fs_14 text-secondary mb-4 line_height_1_6">${lede}</div>` : ''}
        ${body}
        ${actions || ''}
      </div></div>`;
  },

  gateBanner(text){
    if (this._compose) return '';
    return `
      ${Callout('warn', `<strong class="me-1">This step is a gate.</strong>${text}`, {cls:'mb-4'})}`;
  },

  actions(nextLabel, nextFn, disabled){
    return `
      <div class="d-flex gap-2 align-items-center mt-4 pt-4 border-top">
        ${this.idx > 0
          ? '<button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.back()">Back</button>'
          : ''}
        <div class="flex-grow-1"></div>
        <button class="lbtn lbtn-sm lbtn-primary" ${disabled ? 'disabled' : ''}
          onclick="${nextFn || 'Onboarding.next()'}">${esc(nextLabel || 'Continue')}</button>
      </div>`;
  },

  /** A choice with a paragraph behind it. */
  pick(name, value, current, title, desc, onpick){
    return `
      <label class="pick_card${current === value ? ' selected' : ''}" onclick="${onpick}">
        <input type="radio" name="${name}" ${current === value ? 'checked' : ''}>
        <div>
          <div class="fs_14 fw-semibold text-dark">${title}</div>
          <div class="fs_12 text-secondary line_height_1_6 mt-1">${desc}</div>
        </div>
      </label>`;
  },

  field(label, id, opts){
    opts = opts || {};
    return `
      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">
          ${label}${opts.req ? ' <span class="text-danger">*</span>' : ''}
        </span>
        <input type="${opts.type || 'text'}" id="${id}"
               class="form-control height_40 fs_14 shadow-none ${opts.mono ? 'mono' : ''} ${opts.readonly ? 'bg-light' : ''}"
               value="${esc(opts.value || '')}" placeholder="${esc(opts.placeholder || '')}"
               ${opts.maxlength ? `maxlength="${opts.maxlength}"` : ''}
               ${opts.min ? `min="${opts.min}"` : ''}
               ${opts.max ? `max="${opts.max}"` : ''}
               ${opts.oninput ? `oninput="${opts.oninput}"` : ''}
               ${opts.readonly ? 'readonly disabled' : ''}>
        ${opts.hint ? `<div class="fs_11 text-muted mt-1">${opts.hint}</div>` : ''}
      </div>`;
  },

  check(id, checked, html){
    return `
      <label class="d-flex gap-2 align-items-start fs_13 text-secondary mb-3">
        <input type="checkbox" id="${id}" class="mt-1" ${checked ? 'checked' : ''}>
        <span>${html}</span>
      </label>`;
  },

  /* ================= Application (public, no account yet) ================= */

  step_applicant(){
    const a = this.state.applicant;
    return this.panel('Apply for an account',
      `EPI checks every business before accepting it. Enter the details as they appear on your BIR Form 2303.
       You choose a plan and set up the account after EPI accepts the application.`,
      `<div class="row g-3">
        <div class="col-12 col-md-6">
          ${this.field('Taxpayer Identification Number', 'ap-tin',
            { req:true, mono:true, value:a.tin, placeholder:'000-000-000', maxlength:11, hint:'Nine digits, from your Form 2303.' })}
        </div>
        <div class="col-12 col-md-6">
          ${this.field('Registered business name', 'ap-name', { req:true, value:a.name, placeholder:'As registered with the BIR' })}
        </div>
      </div>
      <div class="mb-3">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">Type of business <span class="text-danger">*</span></span>
        <select class="form-select height_40 fs_14 shadow-none" id="ap-entity">
          <option value="">Select the type</option>
          ${Object.keys(ENTITY_TYPES).map(k => `<option value="${k}"${a.entity === k ? ' selected' : ''}>${esc(ENTITY_TYPES[k].label)}</option>`).join('')}
        </select>
      </div>
      ${this.field('Contact email', 'ap-email', { req:true, value:a.email, placeholder:'finance@yourbusiness.com.ph',
        hint:'The application status, and once accepted the link to set your password, are sent here.' })}

      <div class="hr_gray_200 my-4"></div>

      <div class="fs_13 fw-bold text-dark mb-1">Who is applying</div>
      <div class="fs_12 text-muted mb-3 line_height_1_6">
        The applicant becomes the account owner, and only this person can attest to the tax profile and give EPI written authorizations.
      </div>
      <div class="row g-3">
        <div class="col-12 col-md-6">${this.field('Full name', 'ap-person', { req:true, value:a.person })}</div>
        <div class="col-12 col-md-6">${this.field('Position', 'ap-position', { req:true, value:a.position, placeholder:'For example, Finance Manager' })}</div>
      </div>
      <div class="d-flex flex-column gap-2">
        ${this.pick('cap', 'SIGNATORY', a.capacity, 'I can sign for the business',
          'The proprietor, a managing partner, or an officer named in the latest GIS or board records.', "Onboarding.pickCapacity('SIGNATORY')")}
        ${this.pick('cap', 'REPRESENTATIVE', a.capacity, 'I am an authorized representative',
          'You will upload a document from the business that authorizes you to apply, sign agreements, give authorizations and confirm the tax profile.',
          "Onboarding.pickCapacity('REPRESENTATIVE')")}
      </div>`,
      this.actions('Continue', 'Onboarding.saveApplicant()'));
  },

  holdApplicant(){
    const v = id => String((document.getElementById(id) || {}).value || '').trim();
    Object.assign(this.state.applicant, { tin:v('ap-tin'), name:v('ap-name'), entity:v('ap-entity'),
      email:v('ap-email'), person:v('ap-person'), position:v('ap-position') });
  },

  pickCapacity(c){ this.holdApplicant(); this.state.applicant.capacity = c; this.render(); },

  saveApplicant(){
    this.holdApplicant();
    const a = this.state.applicant;
    if (!a.tin || !a.name || !a.entity || !a.email || !a.person || !a.position){
      UI.toast('Everything marked with a star is required', 'err'); return;
    }
    if (AppReg.normTin(a.tin).length !== 9){ UI.toast('Enter the nine digits of the TIN', 'err'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)){ UI.toast('Enter a valid email', 'err'); return; }
    if (!a.capacity){ UI.toast('Select how you are applying', 'err'); return; }
    const dup = AppReg.duplicate(a.tin, a.name, a.email);
    if (dup){ DisplaySwal('info', '', dup); return; }
    this.next();
  },

  /** A simulated upload slot. Only the file name is kept. */
  docSlot(key, label, hint){
    const f = this.state.docs[key];
    return `
      <div class="d-flex align-items-center gap-3 py-2 border-bottom">
        <i class="bi ${f ? 'bi-file-earmark-check text-success' : 'bi-file-earmark-arrow-up text-secondary'} fs_20"></i>
        <div class="flex-grow-1 min_width_0">
          <div class="fs_13 fw-semibold text-dark">${esc(label)} <span class="text-danger">*</span></div>
          <div class="fs_11 text-muted text-truncate">${f ? esc(f) : esc(hint || 'Not uploaded')}</div>
        </div>
        <button class="lbtn lbtn-sm lbtn-ghost text-nowrap" onclick="Onboarding.upload('${key}')">${f ? 'Replace' : 'Upload'}</button>
      </div>`;
  },

  upload(key, quiet){
    const tin = AppReg.normTin((this.state.applicant || {}).tin || (this.app || {}).tin) || '000000000';
    this.state.docs[key] = (DOC_LABELS[key] || key).replace(/\(.*\)/, '').trim().replace(/[^A-Za-z0-9]+/g, '-') + '-' + tin + '.pdf';
    this.render();
    if (!quiet) UI.toast('Uploaded', 'ok');
  },

  requiredDocs(){
    const a = this.state.applicant, ent = ENTITY_TYPES[a.entity];
    return ['cor'].concat(ent.legal.map(x => x[0]), ['idApplicant']);
  },

  step_documents(){
    const a = this.state.applicant, ent = ENTITY_TYPES[a.entity];
    return this.panel('Business documents',
      `EPI uses these to confirm that ${esc(a.name)} legally exists and is registered with the BIR. PDF or image, up to 10 MB each.`,
      `<div class="lcard"><div class="lcard-body">
        ${this.docSlot('cor', DOC_LABELS.cor, 'EPI records your tax type, RDO and registered activities from it.')}
        ${ent.legal.map(([k, label]) => this.docSlot(k, label)).join('')}
        ${this.docSlot('idApplicant', 'Government ID of ' + (a.person || 'the applicant'), "Passport, driver's license, UMID or PhilSys ID.")}
      </div></div>
      ${Callout('info', `There is no public BIR lookup available to providers, so an EPI reviewer checks each document by hand.`, {cls:'mt-3'})}`,
      this.actions('Continue', 'Onboarding.saveDocuments()'));
  },

  saveDocuments(){
    if (this.requiredDocs().some(k => !this.state.docs[k])){ UI.toast('Upload every document marked with a star', 'err'); return; }
    this.next();
  },

  step_authority(){
    const a = this.state.applicant, au = this.state.authority, ent = ENTITY_TYPES[a.entity];
    const keep = f => `Onboarding.state.authority.${f}=this.value`;
    return this.panel('Authority to apply',
      `You are applying for ${esc(a.name)} as its authorized representative. Upload the document that authorizes you and the ID of the person who signed it.`,
      `<div class="lcard mb-3"><div class="lcard-body">
        <div class="fs_13 fw-bold text-dark mb-1">${esc(AUTHORITY_DOCS[ent.authority])}</div>
        <div class="fs_12 text-secondary line_height_1_6">It must name you and authorize you to:</div>
        <ul class="fs_12 text-secondary mt-1 mb-2 ps-3">
          <li>apply to EPI and complete onboarding</li>
          <li>sign the Client Service Agreement</li>
          <li>give EPI written authorizations, such as filing the Permit to Issue or connecting to your systems</li>
          <li>attest to the business's tax profile</li>
        </ul>
        ${this.docSlot('authDoc', DOC_LABELS.authDoc)}
        <div class="row g-3 mt-1">
          <div class="col-12 col-md-6">
            ${this.field('Valid until', 'au-expires', { type:'date', value:au.expires, oninput:keep('expires'),
              hint:'Leave blank if the document has no end date.' })}
          </div>
        </div>
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <div class="fs_13 fw-bold text-dark mb-1">Who signed it</div>
        <div class="fs_12 text-muted mb-3">${esc(ent.signer)}.</div>
        <div class="row g-3">
          <div class="col-12 col-md-6">${this.field('Full name', 'au-sig', { req:true, value:au.signatory, oninput:keep('signatory') })}</div>
          <div class="col-12 col-md-6">${this.field('Position', 'au-sigpos', { req:true, value:au.signatoryPosition, oninput:keep('signatoryPosition') })}</div>
        </div>
        ${this.docSlot('idSignatory', DOC_LABELS.idSignatory)}
      </div></div>`,
      this.actions('Continue', 'Onboarding.saveAuthority()'));
  },

  saveAuthority(){
    const au = this.state.authority, d = this.state.docs;
    if (!d.authDoc || !d.idSignatory){ UI.toast('Upload the authority document and the signatory\'s ID', 'err'); return; }
    if (!au.signatory.trim() || !au.signatoryPosition.trim()){ UI.toast('Enter the name and position of the signatory', 'err'); return; }
    if (au.expires && new Date(au.expires + 'T23:59:59+08:00') < new Date()){ UI.toast('The authority document has expired', 'err'); return; }
    this.next();
  },

  /** All five tiers side by side. Disclosed before onboarding (RMC V.A.4). */
  feeSchedule(){
    const tiers = PLAN_ORDER;
    const fees = feeRows('TIER1').map((r, i) => [r.charge].concat(tiers.map(k => feeRows(k)[i].amount)));
    return `
      <div class="table-responsive"><table class="table tbl fs_12">
        <thead><tr><th>CHARGE</th>${tiers.map(k => `<th>${esc(PLANS[k].short.toUpperCase())}</th>`).join('')}</tr></thead>
        <tbody>${fees.map(r => `<tr><td><strong>${esc(r[0])}</strong></td>${r.slice(1).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>`;
  },

  step_consent(){
    const a = this.state.agree;
    const box = (id, on, html) => this.check(id, on, html).replace('<input', '<input onchange="Onboarding.syncAgree()"');
    return this.panel('Fees and consent',
      `These are all of EPI's fees. Applying is free. After EPI accepts the application you choose your tier, pay the safety deposit and sign the Client Service Agreement, which prevails over these terms.`,
      this.gateBanner('All three statements below are required to submit.') +
      `<div class="lcard mb-3"><div class="lcard-body">
        ${this.feeSchedule()}
        <div class="fs_11 text-muted mt-1">Amounts are illustrative and exclude VAT. There are no other charges.
          Billing starts when your account is activated. If EPI declines the application, nothing is charged.</div>
      </div></div>

      <div class="lcard"><div class="lcard-body">
        ${box('ag-truth', a.truth,
          `I confirm that the information and documents in this application are true, and that I may apply for
           <strong>${esc(this.state.applicant.name)}</strong>.`)}
        ${box('ag-privacy', a.privacy,
          `I consent to Eastland Printink, Inc. collecting and processing my business's and my personal information
           to validate this application and to provide e-invoicing and electronic sales reporting, and to transmit it
           to the BIR as the law requires, in accordance with the Data Privacy Act of 2012 (RA 10173).
           I understand that invoice and sales data transmitted to the BIR becomes an official tax-administration record.`)}
        ${box('ag-terms', a.terms,
          `I have read and agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a>.`)}
      </div></div>`,
      this.actions('Submit application', 'Onboarding.submit()', !(a.privacy && a.terms && a.truth))
        .replace('<button class="lbtn lbtn-sm lbtn-primary"', '<button id="ob-terms-next" class="lbtn lbtn-sm lbtn-primary"'));
  },

  syncAgree(){
    const a = this.state.agree, on = id => !!(document.getElementById(id) || {}).checked;
    a.privacy = on('ag-privacy'); a.terms = on('ag-terms'); a.truth = on('ag-truth');
    document.getElementById('ob-terms-next').disabled = !(a.privacy && a.terms && a.truth);
  },

  submit(){
    this.syncAgree();
    const s = this.state, a = s.applicant;
    if (!(s.agree.privacy && s.agree.terms && s.agree.truth)) return;
    const dup = AppReg.duplicate(a.tin, a.name, a.email);
    if (dup){ DisplaySwal('info', '', dup); return; }

    const db = Store.db, now = new Date().toISOString();
    db.onboardingApps = db.onboardingApps || [];
    const rep = a.capacity === 'REPRESENTATIVE';
    const docs = {};
    this.requiredDocs().concat(rep ? ['authDoc', 'idSignatory'] : []).forEach(k => { docs[k] = s.docs[k]; });
    const app = {
      id: uid('app'), ref: AppReg.nextRef(db),
      tenantName: a.name, tin: a.tin, email: a.email, entity: a.entity,
      applicant: { person:a.person, position:a.position, capacity:a.capacity },
      authority: rep ? { kind:ENTITY_TYPES[a.entity].authority, signatory:s.authority.signatory.trim(),
                         signatoryPosition:s.authority.signatoryPosition.trim(), expiresAt:s.authority.expires || null } : null,
      documents: docs,
      coverage: Object.assign({}, s.coverage, { basis:this.coverageBasis() }),
      consents: { declarationAt:now, privacyAt:now, termsAt:now, by:a.person },
      status: 'PENDING_VERIFICATION', submittedAt: now,
      dueAt: AppReg.workingDaysAfter(now, AppReg.TURNAROUND_DAYS),
      checks: { legal:null, coverage:null, authority:null }
    };
    AppReg.note(app, 'Submitted', a.person);
    db.onboardingApps.push(app);
    Store.save(db);
    this.openApp(app);
    UI.toast('Application ' + app.ref + ' submitted', 'ok');
  },

  /** The application's status, for the applicant. */
  step_submitted(){
    const app = AppReg.get(this.app.id) || this.app;
    this.app = app;
    const st = AppReg.STATUS[app.status], ck = app.checks || {};
    const rep = !!app.authority;
    const checkRow = (label, c) => {
      if (c && c.ok) return `<li class="v-pass"><span class="v-ico">✓</span><span class="v-label">${esc(label)}</span><span class="v-note">confirmed</span></li>`;
      if (app.status === 'DECLINED') return `<li class="v-wait"><span class="v-ico">·</span><span class="v-label">${esc(label)}</span></li>`;
      return `<li class="v-run"><span class="v-ico">◷</span><span class="v-label">${esc(label)}</span><span class="v-note">with EPI reviewer</span></li>`;
    };
    const title = { PENDING_VERIFICATION:'Application submitted', NEEDS_INFO:'EPI needs more information',
                    ACCEPTED:'Application accepted', DECLINED:'Application declined' }[app.status];

    let callout = '';
    if (app.status === 'PENDING_VERIFICATION')
      callout = Callout('info', `An EPI reviewer is checking your documents. You are emailed at <strong>${esc(app.email)}</strong>
        when the application is decided. Keep the reference <strong class="mono">${esc(app.ref)}</strong> to check its status from the sign-in page.`);
    if (app.status === 'NEEDS_INFO')
      callout = Callout('warn', `<strong>Request from EPI, ${esc(fmtDate(app.info.at))}:</strong> ${esc(app.info.request)}`) + `
        <div class="lcard mt-3"><div class="lcard-body">
          <div class="d-flex align-items-center gap-3 pb-2 border-bottom">
            <i class="bi ${app.info.file ? 'bi-file-earmark-check text-success' : 'bi-file-earmark-arrow-up text-secondary'} fs_20"></i>
            <div class="flex-grow-1 min_width_0"><div class="fs_13 fw-semibold text-dark">Additional document</div>
              <div class="fs_11 text-muted text-truncate">${app.info.file ? esc(app.info.file) : 'Optional if your reply answers the request'}</div></div>
            <button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.uploadReply()">${app.info.file ? 'Replace' : 'Upload'}</button>
          </div>
          <span class="d-block fw-semibold fs_13 text-dark mt-3 mb-2">Your reply</span>
          <textarea id="ap-reply" class="form-control fs_14 shadow-none" rows="3" maxlength="500"></textarea>
          <div class="fs_11 text-muted mt-1">Unanswered requests close the application after ${AppReg.RETENTION_DAYS} days.</div>
          <div class="text-end mt-3"><button class="lbtn lbtn-sm lbtn-primary" onclick="Onboarding.sendReply()">Send reply</button></div>
        </div></div>`;
    if (app.status === 'ACCEPTED')
      callout = Callout('ok', `<strong>Accepted on ${esc(fmtDate(app.reviewedAt))}.</strong> A link to set your password was sent to
        <strong>${esc(app.email)}</strong>. Set your password, then sign in to choose your plan and finish setting up your account.`) +
        (DEMO_MODE && app.stage === 'SETUP' && app.ownerToken && this.ownerPending(app)
          ? `<div class="hint-box rounded-3 p-2 mt-3 fs_12">Demo only. No email was sent. Set-password code: <strong class="mono">${esc(app.ownerToken)}</strong></div>` : '');
    if (app.status === 'DECLINED')
      callout = Callout('danger', `<strong>Reason:</strong> ${esc(app.declineReason)}${app.declineNote ? '. ' + esc(app.declineNote) : ''}
        <div class="mt-1">Nothing was charged. ${app.docsDeletedAt ? 'Your documents have been deleted.' : `Your documents are deleted on ${esc(fmtDate(app.purgeAt))}.`}
        You can apply again with the same TIN once the reason is resolved.</div>`);

    const btns = [];
    if (DEMO_MODE && (app.status === 'PENDING_VERIFICATION' || app.status === 'NEEDS_INFO'))
      btns.push(`<button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.demoAccept()">Demo: EPI accepts now</button>`);
    if (app.status === 'ACCEPTED' && this.ownerPending(app))
      btns.push(`<button class="lbtn lbtn-sm lbtn-primary" onclick="Activate.open('${esc(app.ownerToken)}')">Set your password</button>`);
    if (app.status === 'DECLINED')
      btns.push(`<button class="lbtn lbtn-sm lbtn-primary" onclick="Onboarding.start()">Apply again</button>`);

    return `
      <div class="lcard"><div class="lcard-body p-4 p-lg-5">
        <div class="d-flex justify-content-between align-items-start gap-3 flex-wrap mb-2">
          <h1 class="fs_25 fw-bold text-dark mb-0">${title}</h1>
          <span class="lbadge lbadge-${st.tone} lbadge-dot">${esc(st.label)}</span>
        </div>
        <div class="fs_14 text-secondary mb-4 line_height_1_6">EPI answers every application within ${AppReg.TURNAROUND_DAYS} working days.</div>

        <div class="lcard mb-3"><div class="lcard-body">
          <dl class="dl mb-0">
            <dt>Reference</dt><dd class="mono">${esc(app.ref)}</dd>
            <dt>Business</dt><dd>${esc(app.tenantName)} <span class="text-muted mono">${esc(app.tin)}</span></dd>
            <dt>Applicant</dt><dd>${esc(app.applicant.person)} · ${rep ? 'Authorized representative' : 'Signatory'}</dd>
            <dt>Submitted</dt><dd>${esc(fmtDateTime(app.submittedAt))}</dd>
            ${app.status === 'PENDING_VERIFICATION' ? `<dt>Answer due by</dt><dd>${esc(fmtDate(app.dueAt))}</dd>`
              : app.status === 'NEEDS_INFO' ? `<dt>Reply by</dt><dd>${esc(fmtDate(AppReg.replyBy(app)))}</dd>`
              : `<dt>Decided</dt><dd>${esc(fmtDateTime(app.reviewedAt))}</dd>`}
          </dl>
        </div></div>

        <div class="lcard mb-3"><div class="lcard-body">
          <strong class="fs_13 text-secondary fw-bold d-block mb-2">WHAT EPI CHECKS</strong>
          <ul class="vcheck">
            ${checkRow('The business legally exists', ck.legal)}
            ${checkRow(`Required to issue e-invoices by ${complianceDeadline()}`, ck.coverage)}
            ${checkRow(rep ? "The representative's authority" : 'The applicant can sign for the business', ck.authority)}
          </ul>
        </div></div>

        ${callout}

        <div class="d-flex gap-2 align-items-center flex-wrap mt-4 pt-4 border-top">
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Auth.showLogin()">Close</button>
          <div class="flex-grow-1"></div>
          ${btns.join('')}
        </div>
      </div></div>`;
  },

  /** The owner invited on acceptance has not set a password yet. */
  ownerPending(app){
    const u = Store.db.users.find(x => x.tenantId === app.tenantId && x.roleKey === 'OWNER' && x.email === app.email);
    return !!u && u.status === 'INVITED';
  },

  uploadReply(){
    const db = Store.db, app = AppReg.get(this.app.id);
    const r = document.getElementById('ap-reply'), typed = r ? r.value : '';
    app.info.file = 'Additional-document-' + AppReg.normTin(app.tin) + '.pdf';
    Store.save(db);
    this.render();
    const r2 = document.getElementById('ap-reply'); if (r2) r2.value = typed;
    UI.toast('Uploaded', 'ok');
  },

  sendReply(){
    const db = Store.db, app = AppReg.get(this.app.id);
    const text = String((document.getElementById('ap-reply') || {}).value || '').trim();
    if (!text && !app.info.file){ UI.toast('Enter a reply or upload a document', 'err'); return; }
    app.info.reply = text; app.info.repliedAt = new Date().toISOString();
    if (app.info.file) app.documents.extra = app.info.file;
    app.status = 'PENDING_VERIFICATION';
    /* The answer clock restarts from the reply. */
    app.dueAt = AppReg.workingDaysAfter(app.info.repliedAt, AppReg.TURNAROUND_DAYS);
    AppReg.note(app, 'Replied to the request for information', app.applicant.person);
    Store.save(db);
    this.render();
    UI.toast('Reply sent to EPI', 'ok');
  },

  /** Demo: the reviewer's decision, with what a reviewer would record. */
  demoAccept(){
    if (!DEMO_MODE) return;
    const db = Store.db, app = AppReg.get(this.app.id);
    const ent = ENTITY_TYPES[app.entity];
    const basis = acceptable({ coverageBasis:app.coverage.basis, classification:app.coverage.micro ? 'MICRO' : 'SMALL' })
      ? app.coverage.basis : null;
    if (!basis){ DisplaySwal('info', '', 'EPI cannot accept this application: the business is not required to issue e-invoices by the deadline.'); return; }
    const big = ['LTS', 'LARGE'].indexOf(basis) > -1;
    AppReg.accept(db, app, {
      legal: ent.legal.map(x => x[1]).join(' and ') + ' checked against Form 2303',
      basis,
      authority: app.authority ? `${AUTHORITY_DOCS[app.authority.kind]} names ${app.applicant.person}; signed by ${app.authority.signatory}`
                               : `${app.applicant.person} confirmed as ${app.applicant.position}`,
      taxType: 'VAT',
      rdo: big ? 'LT Division — Makati' : 'RDO 039 — South Quezon City',
      address: big ? '12F Corporate Centre, Salcedo St., Legaspi Village, Makati City 1229' : '19 Kalayaan Ave., Barangay Diliman, Quezon City 1101',
      lob: big ? 'Wholesale of general merchandise' : 'Retail sale via internet'
    }, 'EPI Client Onboarding (demo)');
    Store.save(db);
    this.render();
    UI.toast('Accepted. Set-password link sent', 'ok');
  },

  /* ================= Setup (inside the accepted account) ================= */

  /* ---------- Plan and billing ---------- */
  step_lane(){
    const s = this.state, u = s.usage = s.usage || { avg:null, newBusiness:false };
    const suggested = u.newBusiness ? 'TIER1' : (u.avg > 0 ? planForCount(u.avg) : null);
    const n0 = v => v.toLocaleString('en-PH');
    const planTitle = k => PLANS[k].label + ': ' + peso(PLANS[k].fee) + ' per invoice';
    const planDesc = k => {
      const f = PLANS[k];
      return `${f.who} ${f.limit ? `Allowance ${n0(f.allowance)} a month. Each invoice above ${n0(f.limit)} costs ${peso(f.excessFee)}.` : 'No allowance and no excess fee.'}
        Safety deposit ${peso0(f.deposit)}, refundable. No onboarding fee.`;
    };
    return this.panel('Your tier and fees',
      `EPI accepted ${esc(this.app.tenantName.replace(/\.$/, ""))}. You and EPI assess your tier together, from your sales history. Prices exclude VAT and are illustrative.`,
      `<div class="lcard mb-3"><div class="lcard-body">
        <label class="fs_13 fw-semibold d-block mb-1" for="ob-usage-avg">Average invoices, receipts and other sales transactions a month, over the past 12 months</label>
        <input type="number" min="0" class="form-control form-control-sm" style="max-width:200px" id="ob-usage-avg"
               value="${u.avg == null ? '' : u.avg}" ${u.newBusiness ? 'disabled' : ''} onchange="Onboarding.setUsage()">
        ${this.check('ob-usage-new', u.newBusiness, 'We are a new business with no sales history.').replace('<input', '<input onchange="Onboarding.setUsage()"')}
        <div class="fs_11 text-muted mt-1">You provide the 12-month history with your documents for the agreement. A new business starts on Tier 1 and may move up at any time.</div>
        ${suggested ? Callout('info', `Your history points to <strong>${esc(PLANS[suggested].label)}</strong> (${esc(planRange(suggested))} invoices a month).`, {cls:'mt-2 mb-0'}) : ''}
      </div></div>
      <div class="d-flex flex-column gap-2">
        ${PLAN_ORDER.map(k => this.pick('plan', k, s.plan, planTitle(k), planDesc(k), "Onboarding.pickPlan('" + k + "')")).join('')}
      </div>
      ${s.plan && suggested && s.plan !== suggested ? Callout('warn',
        PLANS[s.plan].rank > PLANS[suggested].rank
          ? `Your history points to ${esc(PLANS[suggested].label)}, and you chose ${esc(PLANS[s.plan].label)}. If your use falls below the range of the tier you chose, EPI bills that month at the fee of the tier your use falls in.`
          : `Your history points to ${esc(PLANS[suggested].label)}, and you chose ${esc(PLANS[s.plan].label)}. Invoices above your allowance cost the excess fee. You can move up at any time.`,
        {cls:'mt-3 mb-0'}) : ''}
      ${s.plan ? `<div class="lcard mt-4"><div class="lcard-body">${this.feeBlock()}</div></div>
        <div class="mt-3">${this.check('ob-declared', s.declared,
          `I declare my usage truthfully. I understand that I am responsible for choosing the right tier, that EPI's assessment is not a guarantee that the tier fits, and that EPI bills my actual use every month.`)
          .replace('<input', '<input onchange="Onboarding.setDeclared()"')}</div>` : ''}`,
      this.actions('Continue', null, !s.plan || !s.declared));
  },

  setUsage(){
    const avg = document.getElementById('ob-usage-avg'), nb = document.getElementById('ob-usage-new');
    const u = this.state.usage = { avg: avg && avg.value !== '' ? Math.max(0, parseInt(avg.value, 10) || 0) : null, newBusiness: !!(nb && nb.checked) };
    if (u.newBusiness) u.avg = null;
    const suggested = u.newBusiness ? 'TIER1' : (u.avg > 0 ? planForCount(u.avg) : null);
    this.persist();
    if (suggested && !this.state.plan) this.pickPlan(suggested); else this.render();
  },

  setDeclared(){
    this.state.declared = !!(document.getElementById('ob-declared') || {}).checked;
    this.persist(); this.render();
  },

  pickPlan(plan){
    this.state.plan = plan;
    this.state.lane = PLANS[plan].lane;
    this.render();
  },

  /* ---------- Form 2303 details, as EPI recorded them at validation ---------- */
  step_cor(){
    const ex = this.state.extracted, c = this.app.cor || {};
    return this.panel('Registration details',
      `Recorded by EPI from your Form 2303 when it validated the application. These details appear on every invoice you issue.`,
      `<div class="lcard"><div class="lcard-body">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <strong class="fs_13 text-secondary fw-bold d-block">FROM FORM 2303</strong>
            <span class="fs_11 text-muted">Validated by ${esc(c.by || 'EPI')} · ${esc(fmtDateTime(c.at || this.app.reviewedAt))}</span>
          </div>
          <span class="lbadge lbadge-green lbadge-dot">Validated</span>
        </div>
        <div class="row g-3">
          <div class="col-12 col-md-6">${this.field('Registered name', 'ex-name', { value:ex.name, readonly:true })}</div>
          <div class="col-12 col-md-6">${this.field('Trade name or business style', 'ex-trade', { value:ex.trade })}</div>
          <div class="col-12 col-md-4">${this.field('TIN', 'ex-tin', { value:ex.tin, mono:true, readonly:true })}</div>
          <div class="col-12 col-md-4">${this.field('Branch code', 'ex-branch', { value:ex.branchCode, mono:true, readonly:true })}</div>
          <div class="col-12 col-md-4">${this.field('Tax type', 'ex-tax', { value:ex.taxType, readonly:true })}</div>
        </div>
        ${this.field('RDO', 'ex-rdo', { value:ex.rdo, readonly:true })}
        ${this.field('Registered address', 'ex-addr', { value:ex.address, readonly:true })}
        ${this.field('Registered activities', 'ex-lob', { value:ex.lob, readonly:true,
          hint:'If any of these details changed, send EPI your updated Form 2303 before continuing.' })}
      </div></div>`,
      this.actions('Continue', 'Onboarding.saveExtracted()'));
  },

  /** Only the trade name is the taxpayer's to change here; the rest was validated. */
  saveExtracted(){
    const el = document.getElementById('ex-trade');
    if (el) this.state.extracted.trade = String(el.value || '').trim();
  },

  /* ---------- Tax profile + attestation (part of the Tax profile step) ---------- */
  step_profile(){
    const p = this.state.profile;
    return this.panel('Tax profile',
      `This decides how VAT is computed on every invoice you issue. Re-attestation is
       required whenever it changes.`,
      this.gateBanner(`You confirm the tax profile. EPI applies what you declare.`) +
      `<div class="lcard mb-3"><div class="lcard-body">
        <span class="d-block fw-semibold fs_13 text-dark mb-2">VAT status</span>
        <select class="form-select height_40 fs_14 shadow-none mb-1" id="p-vat">
          <option value="VAT"${p.vatStatus === 'VAT' ? ' selected' : ''}>VAT Registered</option>
          <option value="NONVAT"${p.vatStatus === 'NONVAT' ? ' selected' : ''}>Non-VAT — Percentage Tax</option>
        </select>
        <div class="fs_11 text-muted mb-4">
          Must match the tax type EPI recorded from your Form 2303 (${this.app && this.app.cor && this.app.cor.taxType === 'NONVAT' ? 'Non-VAT' : 'VAT'}).
          If your registration changed, send EPI the updated Form 2303 for a new review.
        </div>

        ${this.check('p-exempt', p.hasExempt,
          `<strong>We have VAT-exempt sales</strong> under Sec. 109 — agricultural products,
           prescription medicines for diabetes, hypertension or cholesterol, and the rest of
           the list. <span class="text-muted">Invoices carrying these lines print
           “VAT-EXEMPT SALE”.</span>`)}
        ${this.check('p-zero', p.hasZero,
          `<strong>We have zero-rated sales</strong> — exports and other zero-rated
           transactions. <span class="text-muted">These print “ZERO-RATED SALE”.</span>`)}
        ${this.check('p-scpwd', p.servesSCPWD,
          `<strong>We serve senior citizens and persons with disability</strong> — RA 9994
           and RA 10754. <span class="text-muted">VAT comes off an eligible line first, then
           20% off what remains.</span>`)}
        ${this.check('p-wht', p.withholding,
          `<strong>We are a withholding agent.</strong>
           <span class="text-muted">EWT is deducted from what is collected, never from the
           tax due on the document.</span>`)}
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold mb-3">ATTESTATION</strong>
        ${this.check('p-attest', false,
          `I confirm the tax profile above is accurate and complete, that I am authorized to
           make this declaration for
           <strong>${esc(this.state.signup.name || 'this business')}</strong>, and that I
           will update it if it changes.`)}
        ${this.field(this.app && this.app.authority ? 'Authorized representative' : 'Signatory', 'p-attest-name',
          { value:this.state.signup.person, readonly:true,
            hint:'Validated by EPI. Only this person can confirm for the business.' })}
      </div></div>`,
      this.actions('Confirm and continue', 'Onboarding.saveProfile()'));
  },

  saveProfile(){
    const on = id => !!document.getElementById(id).checked;
    const who = this.state.signup.person;
    if (!on('p-attest')){ UI.toast('Confirmation is required to continue', 'err'); return; }
    /* The declared VAT status has to agree with Form 2303 as EPI recorded it. */
    const recorded = (this.app.cor || {}).taxType || 'VAT';
    if (document.getElementById('p-vat').value !== recorded){
      DisplaySwal('info', '', `Your Form 2303 as validated by EPI shows ${recorded === 'VAT' ? 'VAT' : 'Non-VAT'}. Send EPI the updated Form 2303 for a new review before declaring a different VAT status.`);
      return;
    }

    this.state.profile = {
      vatStatus:   document.getElementById('p-vat').value,
      hasExempt:   on('p-exempt'),
      hasZero:     on('p-zero'),
      servesSCPWD: on('p-scpwd'),
      withholding: on('p-wht')
    };
    this.state.attested = true;
    this.state.attestedBy = who;
    this.state.attestedAt = new Date().toISOString();
    UI.toast('Attestation recorded', 'ok');
    this.next();
  },

  /* ---------- 5. Coverage check ----------
     RR 11-2025 Sec. 3 decides what applies, so the taxpayer says which
     categories it falls in and the answer is shown at once. Order is priority:
     the first ticked category becomes the basis on record. */
  COVERAGE_ORDER: ['LTS','LARGE','ECOMMERCE','SOFTWARE_USER','EXPORTER','INCENTIVES','POS','OTHER'],

  coverageBasis(){
    const picks = this.state.coverage.picks;
    return this.COVERAGE_ORDER.find(k => picks.indexOf(k) > -1) || 'NONE';
  },

  /** The tenant shape coverage() reads, from what has been answered so far. */
  coverageProbe(){
    const express = this.state.lane === 'EXPRESS';
    return { coverageBasis:this.coverageBasis(),
             classification: this.state.coverage.micro ? 'MICRO' : (express ? 'SMALL' : 'LARGE') };
  },

  step_coverage(){
    const c = this.state.coverage;
    const probe = this.coverageProbe();
    return this.panel('Coverage check',
      `Tick every category that applies. Whether you must issue electronic invoices, and when, depends on these categories.`,
      `<div class="lcard mb-3"><div class="lcard-body">
        ${this.COVERAGE_ORDER.map(k => this.check('cv-' + k, c.picks.indexOf(k) > -1,
          `<strong>${esc(COVERAGE_BASES[k].label)}</strong>
           <span class="text-muted">${esc(COVERAGE_BASES[k].ref)}</span>`)
          .replace('<input', `<input onchange="Onboarding.setCoverage()"`)).join('')}
        <div class="hr_gray_200 my-3"></div>
        ${this.check('cv-micro', c.micro,
          `<strong>We are a Micro taxpayer.</strong>
           <span class="text-muted">RR 11-2025 Sec. 4.</span>`)
          .replace('<input', `<input onchange="Onboarding.setCoverage()"`)}
        ${this.check('cv-ho', c.headOffice,
          `This application covers our head office and every branch together. Where a branch is
           covered, the head office and all other branches are covered with it.`)
          .replace('<input', `<input onchange="Onboarding.setCoverage()"`)}
      </div></div>

      ${coverageNotes(probe).issuance}
      ${!acceptable(probe) && (c.picks.length || c.micro) ? Callout('warn', `<strong>EPI cannot accept this application yet.</strong>
        ${esc(refusalReason(probe))} EPI may accept only taxpayers required to issue e-invoices by ${esc(complianceDeadline())}.
        Change the answers above if they are wrong, or come back when your category is covered.`, {cls:'mt-3'}) : ''}
      ${Callout('info', `This system does not replace the registration of your CAS, cash register machine
        or POS. Register those with the BIR as you do today.`, {cls:'mt-3'})}`,
      this.actions('Continue', 'Onboarding.saveCoverage()'));
  },

  setCoverage(){
    const on = id => !!document.getElementById(id).checked;
    this.state.coverage = {
      picks: this.COVERAGE_ORDER.filter(k => on('cv-' + k)),
      micro: on('cv-micro'),
      headOffice: on('cv-ho')
    };
    this.render();
  },

  saveCoverage(){
    if (!this.state.coverage.headOffice){
      UI.toast('Confirm that the head office and all branches are included', 'err'); return;
    }
    if (!this.state.coverage.picks.length){
      UI.toast('Tick the categories that apply to you', 'err'); return;
    }
    if (!acceptable(this.coverageProbe())){
      UI.toast('EPI can accept only taxpayers required to issue by the deadline. See the note above.', 'err'); return;
    }
    this.next();
  },

  /* ---------- 9. Permit to Issue ----------
     The permit belongs to the taxpayer. EPI may file it, but only on written
     authorization, and live issuance waits until the BIR has issued it. */
  step_pti(){
    const s = this.state, p = s.pti;
    const apiConn = s.connection === 'API' || s.connection === 'CONNECTOR';
    const person = esc(s.signup.person || 'the authorized representative');
    return this.panel('Permit to Issue',
      `Every electronic invoice carries your Permit to Issue (PTI) number. The permit
       belongs to your business; EPI holds no interest in it.`,
      `<div class="d-flex flex-column gap-2">
        ${this.pick('pti', 'HAVE', p.mode, 'We already have one',
          'Enter the number from the permit the BIR issued.', "Onboarding.pickPti('HAVE')")}
        ${this.pick('pti', 'EPI', p.mode, 'Have EPI file the application',
          'EPI prepares and files it for you. You can issue invoices once the BIR issues it.', "Onboarding.pickPti('EPI')")}
        ${this.pick('pti', 'SELF', p.mode, 'We will file it ourselves',
          'You can issue invoices once the BIR issues it and you add the number in Settings.', "Onboarding.pickPti('SELF')")}
      </div>

      ${p.mode === 'HAVE' ? `<div class="mt-3">${this.field('PTI number', 'pti-no',
        { req:true, mono:true, value:p.number, placeholder:'BIR-PTI-0000-00000' })}
        ${this.field('Date the PTI was issued', 'pti-date', { req:true, type:'date', value:p.issuedAt, max:new Date().toLocaleDateString('en-CA') })}
        <div class="fs_11 text-muted" style="margin-top:-8px">The BIR requires your EIS Certification within 6 months of this date.</div></div>` : ''}

      ${(p.mode === 'EPI' || apiConn) ? `
      <div class="lcard mt-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold mb-3">WRITTEN AUTHORIZATION</strong>
        ${p.mode === 'EPI' ? this.check('au-file', s.auth.file,
          `I, ${person}, authorize Eastland Printink, Inc. to file the Permit to Issue application
           for <strong>${esc(s.signup.name || 'this business')}</strong>. The permit stays with the business.`) : ''}
        ${apiConn ? this.check('au-api', s.auth.api,
          `I, ${person}, authorize Eastland Printink, Inc. to connect to our systems through the
           integration chosen above and to run tests against it.`) : ''}
      </div></div>` : ''}`,
      this.actions('Continue', 'Onboarding.savePti()', !p.mode));
  },

  /** Keeps what was typed before the screen repaints. */
  holdPti(){
    const n = document.getElementById('pti-no');
    if (n) this.state.pti.number = n.value.trim();
    const dt = document.getElementById('pti-date');
    if (dt) this.state.pti.issuedAt = dt.value;
    const f = document.getElementById('au-file'), a = document.getElementById('au-api');
    if (f) this.state.auth.file = f.checked;
    if (a) this.state.auth.api = a.checked;
  },

  pickPti(mode){ this.holdPti(); this.state.pti.mode = mode; this.render(); },

  savePti(){
    this.holdPti();
    const s = this.state, apiConn = s.connection === 'API' || s.connection === 'CONNECTOR';
    if (s.pti.mode === 'HAVE' && !s.pti.number){ UI.toast('Enter the PTI number', 'err'); return; }
    if (s.pti.mode === 'HAVE' && !s.pti.issuedAt){ UI.toast('Enter the date the PTI was issued', 'err'); return; }
    if (s.pti.mode === 'EPI' && !s.auth.file){ UI.toast('The filing authorization is required', 'err'); return; }
    if (apiConn && !s.auth.api){ UI.toast('The integration authorization is required', 'err'); return; }
    this.next();
  },

  /* ---------- Agreement: build it, sign it, notarize it, upload it (CSA 3, 11.1, 12.9) ---------- */
  step_agreement(){
    const s = this.state; s.docs = s.docs || {}; s.notary = s.notary || { arrange:true, date:'' };
    const d = AgreementReg.fromApp(this.app, s), nb = !!(s.usage && s.usage.newBusiness), prov = s.provider;
    const ready = !!prov;
    const dl = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="text-muted">Not available</span>'}</dd>`;
    const form = `
      <div class="row g-2">
        <div class="col-12 col-md-6"><span class="d-block fs_12 fw-semibold mb-1">Whose payment provider collects the fee</span>
          <select class="form-select form-select-sm" id="ob-prov-mode">
            ${Object.keys(FeeReg.PROVIDERS).map(k => `<option value="${k}" ${(s.provider || {}).mode === k ? 'selected' : ''}>${esc(FeeReg.PROVIDERS[k].label)}</option>`).join('')}
          </select></div>
        <div class="col-12 col-md-6" id="ob-prov-ownwrap"><span class="d-block fs_12 fw-semibold mb-1">Provider name</span>
          <input type="text" class="form-control form-control-sm" id="ob-prov-name" maxlength="80" placeholder="Your payment service provider"></div>
        <div class="col-12 col-md-4"><span class="d-block fs_12 fw-semibold mb-1">Settle the balance to</span>
          <select class="form-select form-select-sm" id="ob-prov-kind"><option value="Bank">Bank account</option><option value="E-wallet">E-wallet</option></select></div>
        <div class="col-12 col-md-5"><span class="d-block fs_12 fw-semibold mb-1">Account name and number</span>
          <input type="text" class="form-control form-control-sm" id="ob-prov-account" maxlength="80"></div>
        <div class="col-12 col-md-3"><span class="d-block fs_12 fw-semibold mb-1">Settled</span>
          <select class="form-select form-select-sm" id="ob-prov-settle"><option value="REALTIME">In real time</option><option value="T+1">Next banking day</option></select></div>
      </div>
      <label class="d-flex gap-2 fs_12 mt-2" id="ob-prov-instrwrap"><input type="checkbox" id="ob-prov-instr"> I have instructed my provider in writing to deduct EPI's fee from each payment, and I will keep that instruction in force.</label>
      <button class="lbtn lbtn-sm lbtn-primary mt-2" onclick="Onboarding.saveProvider()">Save the provider</button>`;
    return this.panel('Client Service Agreement',
      'EPI builds your agreement from your application. Check the details, name your payment provider, and download the agreement. Signing it in ink and having it notarized takes some days, so you can carry on with setup meanwhile. Upload the signed copy before you ask for activation.',
      Callout('info', 'Sign the version you download. If you change your tier, branches or payment provider after that, download the agreement again and sign the new one.', {cls:'mb-4'}) +
      `<div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">1. CHECK YOUR DETAILS</strong>
        <dl class="dl mb-1">
          ${dl('Client', d.name)}${dl('TIN', d.tin)}${dl('Type', d.type)}${dl('Registered address', d.address)}
          ${dl('Signs for the client', [d.signatory, d.position].filter(Boolean).join(', '))}
          ${dl('Tier', d.plan)}${dl('12-month usage', d.usage)}${dl('Safety deposit', d.deposit)}
          ${dl('Branches', (d.branches || []).map(b => b.name).join(', '))}
        </dl>
        <div class="fs_11 text-muted">These come from your application and setup. To change them, go back to the step where you entered them.</div>
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">2. YOUR PAYMENT PROVIDER</strong>
        <div class="fs_12 text-muted mb-2">The fee for each invoice is deducted from the buyer's payment by the provider, which pays EPI and pays the rest to you. It is your own provider or EPI's partner. EPI does not hold your money.</div>
        ${prov && !s.providerEdit
          ? `<dl class="dl mb-2"><dt>Provider</dt><dd>${esc(prov.name)} <span class="text-muted">· ${prov.mode === 'OWN' ? 'your own' : 'EPI\'s partner'}</span></dd>
              <dt>Paid to</dt><dd>${esc(prov.account.kind)}: ${esc(prov.account.label)} · ${prov.settlement === 'T+1' ? 'next banking day' : 'real time'}</dd></dl>
             <button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.editProvider()">Change</button>`
          : form}
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-2">3. DOWNLOAD, SIGN AND NOTARIZE</strong>
        <ol class="fs_13 ps-3 mb-2">
          <li>Download the agreement and print it. Sign it in ink, and initial every page. A wet-ink signature is required.</li>
          <li>Have it notarized. Your authorized signatory appears before the notary in person. EPI does not sign for you.</li>
          <li>EPI can book the notary, deliver the documents and collect the notarized copies for you, and pays the notarial fee.</li>
          <li>Scan every page and upload it below, or later in the Activation step.</li>
        </ol>
        <div class="d-flex flex-wrap gap-2 mb-2">
          <button class="lbtn lbtn-sm lbtn-ghost" ${prov ? '' : 'disabled'} onclick="Onboarding.viewAgreement()">Preview the agreement</button>
          <button class="lbtn lbtn-sm lbtn-primary" ${prov ? '' : 'disabled'} onclick="Onboarding.printAgreement()"><i class="bi bi-download me-1"></i>Download (PDF)</button>
        </div>
        ${prov ? '' : '<div class="fs_11 text-muted mb-2">Save your payment provider first. It is part of the agreement.</div>'}
        <label class="d-flex gap-2 fs_12 align-items-center"><input type="checkbox" id="ob-notary" ${s.notary.arrange ? 'checked' : ''} onchange="Onboarding.setNotary()">
          Ask EPI to arrange the notarization.</label>
        ${s.notary.arrange ? `<div class="d-flex gap-2 align-items-center mt-1 fs_12">Preferred date <input type="date" class="form-control form-control-sm" style="max-width:170px" id="ob-notary-date" value="${esc(s.notary.date || '')}" onchange="Onboarding.setNotary()"></div>` : ''}
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">4. UPLOAD WHEN IT IS SIGNED</strong>
        ${this.docSlot('signedAgreement', DOC_LABELS.signedAgreement, 'Scan of every page, signed, initialed and notarized.')}
        ${nb ? '<div class="fs_12 text-muted py-2">You said you are a new business, so no sales history is needed.</div>'
             : this.docSlot('usageHistory', DOC_LABELS.usageHistory, 'From your system, books or sales reports. It supports the tier you chose.')}
      </div></div>`,
      this.actions('Continue', null, !ready));
  },

  editProvider(){ this.state.providerEdit = true; this.persist(); this.render(); },

  saveProvider(){
    const v = id => String((document.getElementById(id) || {}).value || '').trim(), mode = v('ob-prov-mode');
    const name = mode === 'OWN' ? v('ob-prov-name') : FeeReg.EPI_PARTNER_NAME, account = v('ob-prov-account');
    if (!name){ UI.toast('Enter the name of your payment provider', 'err'); return; }
    if (!account){ UI.toast('Enter the account the balance is paid to', 'err'); return; }
    if (mode === 'OWN' && !(document.getElementById('ob-prov-instr') || {}).checked){ UI.toast('Confirm the written instruction to your provider', 'err'); return; }
    this.state.provider = { mode, name, account:{ kind:v('ob-prov-kind'), label:account }, settlement:v('ob-prov-settle') };
    this.state.providerEdit = false;
    this.persist(); this.render();
  },

  setNotary(){
    const cb = document.getElementById('ob-notary'), dt = document.getElementById('ob-notary-date');
    this.state.notary = { arrange: !!(cb && cb.checked), date: dt ? dt.value : '' };
    this.persist(); this.render();
  },

  viewAgreement(){ AgreementReg.preview(AgreementReg.fromApp(this.app, this.state)); },
  printAgreement(){ AgreementReg.print(AgreementReg.fromApp(this.app, this.state)); },

  /* ---------- Fees for the chosen tier (tier and fees step) ---------- */
  feeBlock(){
    const s = this.state, f = feesFor(s.plan);
    const rows = list => list.map(r => `
      <tr><td><strong>${esc(r.charge)}</strong></td><td>${esc(r.amount)}</td><td>${esc(r.note)}</td></tr>`).join('');
    return `
      <strong class="fs_12 text-secondary fw-bold d-block mb-2">FEES FOR ${esc(f.label.toUpperCase())}</strong>
      <div class="table-responsive">
        <table class="table tbl fs_12">
          <thead><tr><th>CHARGE</th><th>AMOUNT</th><th>WHAT IT COVERS</th></tr></thead>
          <tbody>${rows(feeRows(s.plan))}</tbody>
        </table>
      </div>
      <div class="fs_11 text-muted mt-1">Amounts are illustrative and exclude VAT. There are no other charges. Fees run from your first invoice. You can move up a tier at any time in Settings.</div>`;
  },

  /* ---------- 5. Branches — enterprise only ---------- */
  step_branches(){
    const list = this.state.branches;
    const rows = list.length ? list.map((b, i) => `
      <tr>
        <td class="mono">${esc(b.code)}</td>
        <td class="fw-semibold">${esc(b.name)}</td>
        <td>${esc(b.rdo)}</td>
        <td class="text-muted">${esc(b.address)}</td>
        <td class="text-end">
          <span class="hyperlink fs_12" onclick="Onboarding.removeBranch(${i})">Remove</span>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="5" class="text-center text-muted py-4">
           No branches yet. Add your head office first. Its branch code is 000.</td></tr>`;

    return this.panel('Branches',
      `RR 11-2025 covers the head office <strong>and all branch offices</strong> together.
       Branches may sit under different RDOs than the head office, so jurisdiction is
       resolved per branch rather than per business.`,
      `<div class="lcard mb-3">
        <div class="table-responsive">
          <table class="table table-sm table-borderless table-striped fs_13 mb-0">
            <thead><tr class="text-muted fs_11 text-uppercase">
              <th>Code</th><th>Name</th><th>RDO</th><th>Address</th><th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="p-3 border-top d-flex gap-2">
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.addBranchForm()">
            + Add branch
          </button>
          ${list.length === 0 ? `
          <button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.prefillBranches()">
            Use a sample structure
          </button>` : ''}
        </div>
      </div>

      ${Callout('info', `There is no charge for branches. Add as many as you need.`, {cls:'mb-3'})}
      ${Callout('info', `Each branch gets its own invoice numbers, and a branch-scoped user — an issuer
        or a supervisor — never sees another branch's documents.`)}`,
      this.actions('Continue', null, list.length === 0));
  },

  addBranchForm(){
    UI.openModal('Add branch',
      `<div class="row g-3">
        <div class="col-6">${this.field('Branch code', 'nb-code', { req:true, mono:true, placeholder:'001', maxlength:5 })}</div>
        <div class="col-6">${this.field('Branch name', 'nb-name', { req:true, placeholder:'Cebu Branch' })}</div>
      </div>
      ${this.field('RDO', 'nb-rdo', { req:true, placeholder:'RDO 080 — Mandaue City' })}
      ${this.field('Address', 'nb-addr', { req:true, placeholder:'Street, city, postal code' })}`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary" onclick="Onboarding.addBranch()">Add branch</button>`);
  },

  addBranch(){
    const v = id => String(document.getElementById(id).value || '').trim();
    const code = v('nb-code'), name = v('nb-name'), rdo = v('nb-rdo'), addr = v('nb-addr');
    if (!code || !name || !rdo || !addr){ UI.toast('All fields are required', 'err'); return; }
    if (this.state.branches.some(b => b.code === code)){
      UI.toast('That branch code is already used', 'err'); return;
    }
    this.state.branches.push({ code, name, rdo, address:addr });
    UI.closeModal();
    this.render();
  },

  removeBranch(i){ this.state.branches.splice(i, 1); this.render(); },

  prefillBranches(){
    this.state.branches = [
      { code:'000', name:'Head Office',   rdo:'LT Division — Makati',      address:'12F Corporate Centre, Salcedo St., Makati City 1229' },
      { code:'001', name:'Cebu Branch',   rdo:'RDO 080 — Mandaue City',    address:'A.S. Fortuna St., Mandaue City 6014' },
      { code:'002', name:'Davao Branch',  rdo:'RDO 113 — Davao City West', address:'McArthur Hwy, Davao City 8000' },
      { code:'003', name:'Baguio Branch', rdo:'RDO 008 — Baguio City',     address:'Session Road, Baguio City 2600' }
    ];
    this.render();
    UI.toast('Sample structure added: four branches across four RDOs', 'ok');
  },

  /* ---------- 6. Invoice configuration ---------- */
  step_config(){
    const c = this.state.config;
    const sample = formatSeriesNumber(c.prefix || 'INV', '000', new Date().getFullYear(), c.seriesStart || 1);
    return this.panel('Invoice configuration',
      `Your invoice numbers <strong>start fresh</strong> in this system. Numbers from your manual books or other systems do not carry over.`,
      `<div class="lcard mb-3"><div class="lcard-body">
        <div class="row g-3">
          <div class="col-12 col-md-6">
            ${this.field('Invoice prefix', 'c-prefix',
              { req:true, mono:true, value:c.prefix, maxlength:6,
                oninput:'Onboarding.previewSeries()',
                hint:'Two to six characters identifying your business.' })}
          </div>
          <div class="col-12 col-md-6">
            ${this.field('Starting number', 'c-start',
              { req:true, mono:true, type:'number', min:1, value:c.seriesStart,
                oninput:'Onboarding.previewSeries()' })}
          </div>
        </div>
        ${Callout('info', `Your first invoice number will be
            <strong class="mono" id="series-preview">${esc(sample)}</strong>
            <div class="mt-1">Prefix · branch code · year · sequence. Gapless and enforced;
            a cancelled number is retired permanently and never reused.</div>`, {cls:'mb-0'})}
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold mb-3">HOW BUYERS RECEIVE THEIR COPY</strong>
        <div class="d-flex flex-column gap-2">
          ${[['EMAIL_PDF','Email with PDF attachment','The buyer receives a PDF. Delivery is retried three times, then flagged.'],
             ['EMAIL_BODY','Email body','The invoice is shown in the message itself. Nothing to open.'],
             ['PORTAL','In-app viewing','The buyer follows a link and reads it in a browser. Useful for marketplaces.'],
             ['SMS','SMS link','A short link by text message. Common where buyers have no reliable email.']
            ].map(([v, t, d]) => this.pick('delivery', v, c.delivery, t, d,
                                           `Onboarding.pickDelivery('${v}')`)).join('')}
        </div>
        <div class="mt-3">
          <span class="d-block fw-semibold fs_13 text-dark mb-2">If the main method fails (optional)</span>
          <select class="form-select height_40 fs_14 shadow-none" id="c-fallback" onchange="Onboarding.keepConfig()">
            <option value="">No fallback</option>
            ${Object.keys(DelivReg.CHANNELS).filter(k => k !== c.delivery).map(k =>
              `<option value="${k}"${c.deliveryFallback === k ? ' selected' : ''}>${esc(DelivReg.CHANNELS[k].label)}</option>`).join('')}
          </select>
          <div class="fs_11 text-muted mt-1">Each invoice is sent once. The fallback is used if the main method fails or the buyer has no address for it.</div>
        </div>
      </div></div>`,
      this.actions('Continue', 'Onboarding.saveConfig()'));
  },

  previewSeries(){
    const p = String(document.getElementById('c-prefix').value || '').trim().toUpperCase() || 'INV';
    const n = parseInt(document.getElementById('c-start').value, 10) || 1;
    document.getElementById('series-preview').textContent =
      formatSeriesNumber(p, '000', new Date().getFullYear(), n);
  },

  /** Re-rendering loses whatever is typed, so the fields are read first. */
  keepConfig(){
    const p = document.getElementById('c-prefix');
    const n = document.getElementById('c-start');
    if (p) this.state.config.prefix = String(p.value || '').trim().toUpperCase();
    if (n) this.state.config.seriesStart = parseInt(n.value, 10) || 1;
    const fb = document.getElementById('c-fallback');
    if (fb) this.state.config.deliveryFallback = fb.value === this.state.config.delivery ? '' : fb.value;
  },

  pickDelivery(v){
    this.keepConfig();
    this.state.config.delivery = v;
    this.render();
  },

  saveConfig(){
    this.keepConfig();
    if (this.state.config.prefix.length < 2){
      UI.toast('The invoice prefix needs at least two characters', 'err'); return;
    }
    this.next();
  },

  /* ---------- 7. Connection ---------- */
  step_connection(){
    const s = this.state;
    /* Most documents are raised from a record of a sale that already exists
       somewhere else, which is what makes its number, timestamp and totals
       answerable to something. This step asks how that record reaches us. A
       single invoice can also be issued in the portal (issue.js). */
    return this.panel('Connection method',
      `Select how sales data reaches the system. You can also issue a single invoice in the portal at any time, and add more methods later.`,
      `<div class="d-flex flex-column gap-2">
        ${Object.keys(CONNECTIONS).map(k => this.pick('conn', k, s.connection,
          CONNECTIONS[k].label, CONNECTIONS[k].note, `Onboarding.pickConn('${k}')`)).join('')}
      </div>

      ${s.connection === 'API' || s.connection === 'CONNECTOR' ? `
      ${Callout('info', `Automated issuance is attributed to a <strong>named integration
        credential</strong>, not to a person. Your audit trail will read
        “Bayanihan ERP connector · credential #3”, never “the API”.`, {cls:'mt-4'})}` : ''}`,
      this.actions('Continue', null, !s.connection));
  },

  pickConn(v){ this.keepConfig(); this.state.connection = v; this.render(); },

  /* ---------- 8. Sandbox — GATE ---------- */
  step_sandbox(){
    const sb = this.state.sandbox;
    const checks = [
      'Invoice shows every detail the BIR requires',
      'VAT is worked out correctly from the VAT-inclusive price',
      'VATable, VAT-exempt and zero-rated sales are shown separately',
      'Invoice numbers have no gaps',
      'Buyer copy is delivered',
      'The invoice data is valid'
    ];

    if (!sb.run){
      return this.panel('Sandbox testing',
        `We issue ${this.state.lane === 'ENTERPRISE'
          ? 'a batch of test invoices at realistic volume'
          : 'three test invoices'} and check that each looks right, that VAT is correct, that the buyer copy arrives and that the data is valid. This is a test only. Nothing is sent to the BIR. It is EPI's own check, not the BIR's EIS Certification, which you get after your Permit to Issue.`,
        this.gateBanner(`Required before activation.`) +
        `<div class="lcard"><div class="lcard-body">
          <ul class="vcheck">
            ${checks.map(c => `<li class="v-wait"><span class="v-ico">·</span>
              <span class="v-label">${esc(c)}</span></li>`).join('')}
          </ul>
        </div></div>`,
        this.actions('Run sandbox tests', 'Onboarding.runSandbox()'));
    }

    const lines = [{ desc:'Test item: standard rated', sku:'TEST-VAT', qty:2, unit:'pc',
                     unitPrice:560.00, treatment:'VATABLE' }];
    if (this.state.profile.hasExempt)
      lines.push({ desc:'Test item: VAT-exempt', sku:'TEST-EXM', qty:1, unit:'pc', unitPrice:1650.00, treatment:'EXEMPT' });
    if (this.state.profile.hasZero)
      lines.push({ desc:'Test item: zero-rated', sku:'TEST-ZRO', qty:1, unit:'pc', unitPrice:3200.00, treatment:'ZERO' });
    const t = computeTotals(lines, 0);

    return this.panel('Sandbox results',
      `All checks passed. These test invoices are marked as tests, are numbered apart from your real invoice numbers and are never sent to the BIR.`,
      `<div class="lcard mb-3"><div class="lcard-body">
        <ul class="vcheck">
          ${checks.map((c, i) => `<li class="v-pass"><span class="v-ico">✓</span>
            <span class="v-label">${esc(c)}</span>
            <span class="v-note">${i === 2 && !t.isMixed ? 'not applicable' : 'passed'}</span></li>`).join('')}
        </ul>
      </div></div>

      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block">TEST DOCUMENT: TAX SUMMARY</strong>
        <span class="fs_11 text-muted mb-3">
          Prices captured VAT-inclusive; VAT derived and shown as a separate item
        </span>
        <div class="table-responsive">
          <table class="table table-sm table-borderless fs_13">
            <thead><tr class="text-muted fs_11 text-uppercase">
              <th>Description</th><th>Treatment</th>
              <th class="text-end">Qty</th><th class="text-end">Unit price</th>
              <th class="text-end">Amount</th>
            </tr></thead>
            <tbody>
              ${lines.map(l => `<tr>
                <td>${esc(l.desc)}</td>
                <td><span class="lbadge ${TREATMENT[l.treatment].badge}">${TREATMENT[l.treatment].label}</span></td>
                <td class="text-end">${l.qty}</td>
                <td class="text-end">${num(l.unitPrice)}</td>
                <td class="text-end">${num(l.qty * l.unitPrice)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${this.summaryBlock(t)}
      </div></div>`,
      this.actions('Continue'));
  },

  summaryBlock(t){
    const row = (label, value, strong) => `
      <div class="d-flex justify-content-between py-1">
        <span class="text-muted">${label}</span>
        <span class="${strong ? 'fw-bold' : ''}">${value}</span>
      </div>`;

    return `
      <div class="ms-auto fs_13" style="max-width:380px;">
        ${row('Gross Sales (VAT inclusive)', num(t.gross), true)}
        ${t.hasExempt ? row('Less: VAT-Exempt Sales', num(t.exempt)) : ''}
        ${t.hasZero ? row('Less: Zero-Rated Sales', num(t.zero)) : ''}
        ${t.discount ? row('Less: Discounts', num(t.discount)) : ''}
        <div class="border-top mt-1 pt-1">
          ${row('VATable Sales', num(t.vatableSales), true)}
          ${row('VAT (12%)', num(t.vat), true)}
        </div>
        <div class="border-top border-dark mt-1 pt-2 d-flex justify-content-between">
          <strong>TOTAL AMOUNT DUE</strong>
          <strong class="fs_15">${peso(t.totalDue)}</strong>
        </div>
        <div class="fs_11 text-muted mt-2">${esc(amountInWords(t.totalDue))}</div>
      </div>`;
  },

  runSandbox(){
    this.state.sandbox.run = true;
    this.state.sandbox.passed = true;
    this.render();
    UI.toast('Sandbox tests passed', 'ok');
  },

  /* ---------- Combined steps ----------
     Some setup pages stack the older single-purpose steps as sections of one
     page, so each rule and gate is still written once. */

  step_business(){
    this._compose = true;
    let body;
    try { body = this.step_cor() + this.step_profile(); } finally { this._compose = false; }
    return this.panel('Tax profile',
      'Confirm the details EPI recorded from your Form 2303, then declare your tax profile and confirm it.',
      body, this.actions('Confirm and continue', 'Onboarding.saveBusiness()'));
  },

  saveBusiness(){ this.saveExtracted(); this.saveProfile(); },

  step_setup(){
    this._compose = true;
    let body;
    try { body = this.step_config() + this.step_connection(); } finally { this._compose = false; }
    return this.panel('Invoicing setup',
      'Set your invoice numbering, how buyers receive their copy and how sales reach the system.',
      body, this.actions('Continue', 'Onboarding.saveSetup()'));
  },

  saveSetup(){
    this.keepConfig();
    if (this.state.config.prefix.length < 2){
      UI.toast('The invoice prefix needs at least two characters', 'err'); return;
    }
    if (!this.state.connection){ UI.toast('Select how sales reach the system', 'err'); return; }
    this.next();
  },

  /* ---------- Activation — GATE ---------- */
  step_finish(){
    const s = this.state, express = s.lane === 'EXPRESS';
    const f = feesFor(s.plan);
    s.docs = s.docs || {};
    const nb = !!(s.usage && s.usage.newBusiness);
    const items = [
      ['Application accepted by EPI', true],
      ['Tax profile confirmed', s.attested],
      ['Branches mapped', express ? null : s.branches.length > 0],
      ['Invoice numbers set', !!s.config.prefix],
      ['Connection method selected', !!s.connection],
      ['Permit to Issue', s.pti.mode === 'HAVE' ? true : (s.pti.mode ? 'pti' : false)],
      ['Payment provider named', !!s.provider],
      ['Safety deposit received', !!(s.deposit && s.deposit.paid)],
      ['Agreement signed, notarized and uploaded', !!(s.docs && s.docs.signedAgreement)],
      nb ? null : ['Sales history uploaded', !!(s.docs && s.docs.usageHistory)],
      ['Sandbox testing passed', s.sandbox.passed],
      ['Activation review', 'pending']
    ].filter(x => x[1] !== null);
    const ready = !!(s.deposit && s.deposit.paid) && !!(s.docs && s.docs.signedAgreement) && (nb || !!s.docs.usageHistory) && !!s.provider && s.attested && s.sandbox.passed && !!s.pti.mode && !!s.connection && (express || s.branches.length > 0);

    return this.panel('Activation',
      `EPI checks your signed agreement and reviews the account before it is activated, within ${AppReg.GOLIVE_DAYS} working day.`,
      this.gateBanner('Invoicing and billing start when the account is activated.') +
      (this.app.goLiveReturn ? Callout('warn', `<strong>Returned by EPI on ${esc(fmtDate(this.app.goLiveReturn.at))}:</strong> ${esc(this.app.goLiveReturn.note)}`, {cls:'mb-3'}) : '') +
      `<div class="lcard mb-3"><div class="lcard-body">
        <ul class="vcheck">
          ${items.map(([label, state]) => {
            if (state === 'pending') return `<li class="v-run"><span class="v-ico">◷</span>
              <span class="v-label">${esc(label)}</span><span class="v-note">EPI reviews after you send it</span></li>`;
            if (state === 'pti') return `<li class="v-run"><span class="v-ico">◷</span>
              <span class="v-label">${esc(label)}</span><span class="v-note">${s.pti.mode === 'EPI' ? 'EPI files it' : 'to be filed by you'}; live invoicing waits for it</span></li>`;
            if (state === 'auto') return `<li class="v-pass"><span class="v-ico">✓</span>
              <span class="v-label">${esc(label)}</span><span class="v-note">not needed on Tier 1</span></li>`;
            return `<li class="${state ? 'v-pass' : 'v-fail'}"><span class="v-ico">${state ? '✓' : '✕'}</span>
              <span class="v-label">${esc(label)}</span></li>`;
          }).join('')}
        </ul>
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">SAFETY DEPOSIT</strong>
        <div class="fs_12 text-muted mb-2">Refundable, held without interest, and not a fee. Due before activation: <strong>${peso0(f.deposit)}</strong> for ${esc(f.label)}. EPI may take an unpaid bill from it after a written notice, and you then restore it within ${DepositReg.RESTORE_DAYS} days.</div>
        ${(s.deposit && s.deposit.paid) ? Callout('ok', `Received: ${peso0(f.deposit)} (${esc(s.deposit.method || '')}).`, {cls:'mb-0'}) : `
          <div class="d-flex gap-2 align-items-center flex-wrap">
            <select class="form-select form-select-sm" style="max-width:260px" id="ob-dep-method">
              ${Object.keys(PAY_METHODS).filter(k => PAY_METHODS[k].mode === 'INSTANT').map(k => `<option value="${k}">${esc(PAY_METHODS[k].label)}</option>`).join('')}
            </select>
            <button class="lbtn lbtn-sm lbtn-primary" onclick="Onboarding.payDeposit()">Pay ${peso0(f.deposit)}</button>
          </div>
          <div class="fs_11 text-muted mt-1">Demo only: nothing is charged.</div>`}
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold d-block mb-1">AGREEMENT PAPERS</strong>
        <div class="fs_12 text-muted mb-1">${(s.docs.signedAgreement && (nb || s.docs.usageHistory)) ? 'Uploaded. EPI checks it against your application.' : 'Not uploaded yet. Notarizing takes some days. Your setup is saved, so you can sign out and come back to upload it.'}</div>
        ${this.docSlot('signedAgreement', DOC_LABELS.signedAgreement, 'Scan of every page, signed, initialed and notarized.')}
        ${nb ? '' : this.docSlot('usageHistory', DOC_LABELS.usageHistory, 'From your system, books or sales reports. It supports the tier you chose.')}
      </div></div>

      <div class="lcard mb-3"><div class="lcard-body">
        <dl class="dl mb-3">
          <dt>Tier</dt><dd>${esc(f.label)}</dd>
          <dt>Fee</dt><dd>${peso(f.fee)} per invoice plus VAT${f.limit ? `, ${peso(f.excessFee)} above ${f.limit.toLocaleString('en-PH')} a month` : ', no allowance and no excess fee'}</dd>
          <dt>Safety deposit</dt><dd>${peso0(f.deposit)}, refundable, due before activation</dd>
        </dl>
        ${this.check('fin-ack', s.ack,
          `I confirm the tier and fees above for <strong>${esc(this.app.tenantName)}</strong>.
           Fees run from the first invoice issued after activation.`).replace('<input', '<input onchange="Onboarding.state.ack=this.checked"')}
      </div></div>

      ${s.pti.mode !== 'HAVE' ? Callout('warn', 'You can issue invoices once the BIR issues your Permit to Issue. You can sign in and set up in the meantime.') : ''}`,
      this.actions('Send for activation review', 'Onboarding.activate()', !ready));
  },

  payDeposit(){
    const sel = document.getElementById('ob-dep-method');
    this.state.deposit = { paid:true, method:(PAY_METHODS[sel && sel.value] || PAY_METHODS.CARD).label, at:new Date().toISOString() };
    this.persist(); this.render();
  },

  activate(){
    const s = this.state;
    s.ack = !!(document.getElementById('fin-ack') || {}).checked;
    if (!s.ack){ UI.toast('Confirm the tier and fees to continue', 'err'); return; }
    const db = Store.db, app = AppReg.get(this.app.id);
    /* EPI checks the signed agreement before any account goes live (CSA 2.5), so every account is reviewed. */
    app.stage = 'GOLIVE_REVIEW';
    delete app.goLiveReturn;
    app.goLiveRequestedAt = new Date().toISOString();
    app.goLiveDueAt = AppReg.workingDaysAfter(app.goLiveRequestedAt, AppReg.GOLIVE_DAYS);
    AppReg.note(app, 'Setup complete. Sent for activation review', s.signup.person);
    this.idx++;
    this.persist();
    this.render();
  },

  /* ---------- Demo ----------
     Fills the step on screen with sample data so the process can be shown one
     screen at a time. It never moves on; the user presses Continue. Switch it
     off by setting DEMO_MODE to false. */
  demoFill(){
    if (!DEMO_MODE) return;
    const s = this.state, key = this.visibleSteps()[this.idx].key;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const tick = id => { const el = document.getElementById(id); if (el) el.checked = true; };
    const digits = n => Array.from({ length:n }, () => Math.floor(Math.random() * 10)).join('');
    const big = this.mode === 'setup' ? s.lane === 'ENTERPRISE' : ['CORPORATION', 'OPC'].indexOf((s.applicant || {}).entity) > -1;
    let msg = 'Demo details filled';

    switch (key){
      case 'applicant': {
        const pool = [
          { name:'Luzon Industrial Supply Corp.', entity:'CORPORATION', person:'Ramon Dela Cruz', position:'Finance Manager', email:'finance@luzonindustrial.com.ph', capacity:'REPRESENTATIVE' },
          { name:'Pinoy Crafts Online Shop', entity:'SOLE', person:'Maria Santos', position:'Proprietor', email:'maria@pinoycrafts.com.ph', capacity:'SIGNATORY' }
        ];
        const d = pool.find(x => !AppReg.duplicate('', x.name, x.email)) || pool[0];
        let tin;
        do { tin = digits(3) + '-' + digits(3) + '-' + digits(3); }
        while (AppReg.duplicate(tin, '', ''));
        Object.assign(s.applicant, d, { tin });
        this.render();
        break;
      }
      case 'documents':
        this.requiredDocs().forEach(k => { if (!s.docs[k]) this.upload(k, true); });
        break;
      case 'authority':
        ['authDoc', 'idSignatory'].forEach(k => { if (!s.docs[k]) this.upload(k, true); });
        Object.assign(s.authority, { signatory:'Teresita M. Lagman', signatoryPosition:'Corporate Secretary',
          expires:(new Date().getFullYear() + 1) + '-12-31' });
        this.render();
        break;
      case 'coverage':
        s.coverage = { picks: big ? ['LTS', 'LARGE'] : ['ECOMMERCE'], micro:false, headOffice:true };
        this.render();
        break;
      case 'consent':
        s.agree = { privacy:true, terms:true, truth:true };
        this.render();
        break;
      case 'lane':
        if (!s.plan){ s.usage = { avg:5000, newBusiness:false }; s.declared = true; this.pickPlan('TIER1'); } else { s.declared = true; this.render(); }
        msg = 'Tier selected';
        break;
      case 'business':
        tick('p-attest');
        break;
      case 'branches':
        if (!s.branches.length) this.prefillBranches();
        break;
      case 'setup':
        this.keepConfig();
        if (s.config.prefix.length < 2) s.config.prefix = 'INV';
        s.config.seriesStart = 1; s.config.delivery = 'EMAIL_PDF';
        s.config.deliveryFallback = 'SMS';
        s.connection = s.connection || (big ? 'API' : 'BULK');
        this.render();
        break;
      case 'pti':
        s.pti.mode = 'HAVE';
        s.pti.number = 'BIR-PTI-' + new Date().getFullYear() + '-' + digits(5);
        s.pti.issuedAt = new Date().toLocaleDateString('en-CA');
        if (s.connection === 'API' || s.connection === 'CONNECTOR') s.auth.api = true;
        this.render();
        break;
      case 'sandbox':
        if (!s.sandbox.run) this.runSandbox();
        break;
      case 'agreement':
        s.provider = s.provider || { mode:'OWN', name:'Kapitbahay Payments, Inc.', account:{ kind:'Bank', label:'Sample Bank (illustrative), ' + (this.app.tenantName || 'Client') }, settlement:'T+1' };
        this.render();
        break;
      case 'finish':
        s.docs = s.docs || {};
        s.docs.signedAgreement = 'Client-Service-Agreement-signed-' + (this.app.tin || '000') + '.pdf';
        if (!(s.usage && s.usage.newBusiness)) s.docs.usageHistory = 'Sales-history-12-months-' + (this.app.tin || '000') + '.pdf';
        s.deposit = { paid:true, method:'Card (demo)', at:new Date().toISOString() };
        s.ack = true;
        this.render();
        break;
    }
    UI.toast(msg, 'ok');
  },

  /* ---------- Done, or waiting for the activation review ---------- */
  step_golive(){
    const s = this.state, app = AppReg.get(this.app.id) || this.app;
    const live = !!app.activatedAt;
    const first = formatSeriesNumber(s.config.prefix, '000', new Date().getFullYear(), s.config.seriesStart);
    return `
      <div class="lcard"><div class="lcard-body p-4 p-lg-5">
        <div class="text-center py-4">
          <div class="mx-auto mb-4 d-flex align-items-center justify-content-center rounded-circle"
               style="width:62px;height:62px;background:var(--${live ? 'green' : 'amber'}-50);
                      border:2px solid var(--${live ? 'green' : 'amber'}-600);color:var(--${live ? 'green' : 'amber'}-600);font-size:30px;">${live ? '✓' : '◷'}</div>
          <h1 class="fs_25 fw-bold text-dark mb-2">${live ? `${esc(app.tenantName)} is active` : 'Waiting for the activation review'}</h1>
          <div class="fs_14 text-secondary mx-auto" style="max-width:520px;">
            ${live ? 'The account exists, its numbering is open, and you are its first owner. Billing starts today.'
                   : `Setup is complete. EPI reviews it by ${esc(fmtDate(app.goLiveDueAt))} and emails ${esc(app.email)}. Nothing is billed until the account is activated.`}
          </div>
        </div>

        <div class="lcard my-3"><div class="lcard-body">
          <dl class="dl mb-0">
            <dt>First invoice number</dt><dd class="mono">${esc(first)}</dd>
            <dt>Tier</dt><dd>${esc(feesFor(s.plan).label)}</dd>
            <dt>Branches</dt><dd>${s.lane === 'EXPRESS' ? '1 (single location)' : s.branches.length}</dd>
            <dt>Connection</dt><dd>${esc((CONNECTIONS[s.connection] || {}).label || '—')}</dd>
            <dt>Permit to Issue</dt><dd>${s.pti.mode === 'HAVE' ? esc(s.pti.number) : s.pti.mode === 'EPI' ? 'Filed by EPI, awaiting the BIR' : 'Not yet filed'}</dd>
            <dt>Attested by</dt><dd>${esc(s.attestedBy)}</dd>
            <dt>Your account</dt><dd>${esc(s.signup.person)} · Owner</dd>
          </dl>
        </div></div>

        ${live && s.pti.mode !== 'HAVE' ? Callout('warn', `<strong>You cannot issue invoices until the BIR issues your Permit to Issue.</strong>
          You can sign in and set up in the meantime.`, {cls:'mb-3'}) : ''}
        ${live ? Callout('info', `<strong>Sales reporting to the BIR has not started.</strong> The BIR has not set up its system or issued the rules yet. Your invoices are ready to be sent when it starts. Nothing more is needed today.`) : ''}

        <div class="d-flex gap-2 align-items-center flex-wrap mt-4 pt-4 border-top">
          <div class="flex-grow-1"></div>
          ${live
            ? `<button class="lbtn lbtn-sm lbtn-primary" onclick="Onboarding.finish()">Open the portal</button>`
            : `${DEMO_MODE ? '<button class="lbtn lbtn-sm lbtn-ghost" onclick="Onboarding.demoGoLive()">Demo: EPI activates the account</button>' : ''}
               <button class="lbtn lbtn-sm lbtn-primary" onclick="Onboarding.exit()">Sign out</button>`}
        </div>
      </div></div>`;
  },

  demoGoLive(){
    if (!DEMO_MODE) return;
    const db = Store.db, app = AppReg.get(this.app.id);
    AppReg.build(db, app, 'EPI Client Onboarding (demo)');
    Store.save(db);
    this.render();
    UI.toast('Activation approved. Account activated', 'ok');
  },

  /** Into the portal as the owner, now that the account exists. */
  finish(){
    refreshSession();
    if (!CT){ Auth.showLogin(); return; }
    Auth.openPortal(`Welcome, ${CU.name}`);
  }
};
