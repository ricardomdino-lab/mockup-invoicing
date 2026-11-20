/* ============================================================
   settings.js — Settings

   Four tabs on the source portal's tab strip: what the BIR registered, what
   the taxpayer attested to, the numbering under each branch, and the plan.

   Most of this is read-only on purpose. Registration details come from BIR
   Form 2303 and are not the taxpayer's to retype here; branch structure and
   series are set during onboarding and changing either mid-year would break
   the numbering. The one thing that can change is the tax profile — and
   because it decides how every future document is computed, changing it
   requires attesting to it again, in the owner's name, in the log.
   ============================================================ */

const SettingsReg = {

  /** Invoices issued in the current calendar month, against the plan. */
  usage(){
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const mine = Store.db.invoices.filter(i =>
      i.tenantId === CT.id && String(i.issuedAt).slice(0, 7) === key);
    const included = feesFor(CT).allowance || 0;
    return {
      month: now.toLocaleDateString('en-PH', { month:'long', year:'numeric' }),
      issued: mine.length,
      included,
      pct: included ? Math.min(100, Math.round((mine.length / included) * 100)) : 0
    };
  },

  /* This account's own Permit to Issue and the one action a client can take on it. */
  ptiCard(){
    const pti = ptiStatus(), ps = PTI_STATES[pti], eis = eisInfo();
    return `
      <div class="lcard"><div class="lcard-body">
        <strong class="fs_13 text-secondary fw-bold mb-3">PERMIT TO ISSUE</strong>
        <dl class="dl mb-0">
          <dt>PTI number</dt><dd class="mono">${esc(CT.pti || '—')}</dd>
          <dt>Status</dt><dd><span class="lbadge lbadge-${ps.tone}">${esc(ps.label)}</span></dd>
          ${pti === 'ISSUED' ? `<dt>EIS Certification</dt><dd><span class="lbadge lbadge-${eis.tone}">${esc(eis.label)}</span>
            <div class="fs_11 text-muted fw-normal">${eis.key === 'CERTIFIED'
              ? `${esc(fmtDate(eis.at + 'T12:00:00+08:00'))}${eis.ref ? ' · ' + esc(eis.ref) : ''}`
              : `Due ${esc(fmtDate(eis.due + 'T12:00:00+08:00'))}, 6 months after the PTI. The BIR can revoke the PTI if it is missed.`}</div></dd>` : ''}
        </dl>
        ${pti === 'ISSUED' && eis.key !== 'CERTIFIED' ? `<div class="fs_11 text-muted mt-2">The BIR tests your system on its portal (eis-cert.bir.gov.ph). EPI's sandbox test in setup is not that test.</div>
          ${can('taxProfile') ? '<button class="lbtn lbtn-sm lbtn-ghost mt-2" onclick="SettingsReg.recordEis()">Record the certification</button>' : ''}` : ''}
        ${pti !== 'ISSUED' ? Callout('warn', esc(issuanceBlock()), {cls:'mt-3'}) : ''}
        ${pti === 'NOT_APPLIED' && can('taxProfile') ? `
        <button class="lbtn lbtn-sm lbtn-primary mt-3" onclick="SettingsReg.ptiAction('file')">Have EPI file the application</button>` : ''}
        ${pti === 'APPLIED' && can('taxProfile') ? `
        <div class="fs_11 text-muted mt-3">Filed ${fmtDate(CT.ptiAppliedAt)}. The BIR has not issued it yet.</div>
        <button class="lbtn lbtn-sm lbtn-ghost mt-2" onclick="SettingsReg.ptiAction('issue')">Demo: simulate the BIR issuing it</button>` : ''}
      </div></div>`;
  },

  /** Filing and issuing a PTI. The BIR step is simulated: there is no real
      permit service to call. */
  ptiAction(kind){
    const file = kind === 'file';
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">${file ? 'Have EPI file the application?' : 'Simulate the BIR issuing the permit?'}</span>
       <span class="fs_14 text-muted">${file
         ? 'This is your written authorization for EPI to file the Permit to Issue application for your business.'
         : 'This demonstration step stands in for the BIR. A PTI number is added to the account.'}</span>`,
      function () {
        const db = Store.db, t = db.tenants.find(x => x.id === CT.id);
        if (file){
          t.ptiAppliedAt = new Date().toISOString();
          t.authorizations = (t.authorizations || []).concat({ kind:'PTI_FILING', by:CU.name, at:t.ptiAppliedAt });
          logActivity(db, { action:'Authorized EPI in writing to file the Permit to Issue application' });
        } else {
          t.pti = 'BIR-PTI-2026-' + String(Math.floor(10000 + Math.random() * 89999));
          t.ptiIssuedAt = new Date().toISOString();
          logActivity(db, { action:`Permit to Issue ${t.pti} issued by the BIR (simulated)` });
        }
        Store.save(db);
        refreshSession();
        Nav.go('settings');
      }, null, file ? 'File' : 'Simulate');
  },

  /** The BIR has certified the system on its EIS portal; the owner records the date and reference. */
  recordEis(){
    UI.openModal('Record the EIS Certification', `
      <p class="fs_12 text-muted">Enter the date the BIR certified your system and the reference it gave. Do this only after the BIR has certified.</p>
      <span class="d-block fs_12 fw-semibold mb-1">Date certified</span>
      <input type="date" class="form-control form-control-sm mb-2 input_eis_at" max="${new Date().toLocaleDateString('en-CA')}" value="${new Date().toLocaleDateString('en-CA')}">
      <span class="d-block fs_12 fw-semibold mb-1">BIR reference</span>
      <input type="text" class="form-control form-control-sm input_eis_ref" maxlength="60" placeholder="Certificate or ticket number">`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
       <button class="lbtn lbtn-primary button_eis_go">Record</button>`, 'sm');
    $(".button_eis_go").on("click", () => {
      const at = $(".input_eis_at").val(), ref = String($(".input_eis_ref").val() || '').trim();
      if (!at || !ref){ DisplayDelaySwal("info", "", "Enter the date and the BIR reference."); return; }
      const db = Store.db, t = db.tenants.find(x => x.id === CT.id);
      t.eis = { certifiedAt:at, ref:ref.slice(0, 60), by:CU.name, recordedAt:new Date().toISOString() };
      logActivity(db, { action:`Recorded the EIS Certification, reference ${t.eis.ref}, dated ${at}` });
      Store.save(db); refreshSession(); UI.closeModal(); Nav.go('settings');
    });
  },

  laneLabel(){
    const f = feesFor(CT);
    return f.label + ' (' + planRange(f.key) + ' invoices a month)';
  },

  deliveryLabel(){
    const ch = k => (DelivReg.CHANNELS[k] || {}).label;
    const main = ch(CT.deliveryMethod) || 'Email with PDF';
    const fb = ch(CT.deliveryFallback);
    return fb ? main + ', then ' + fb.toLowerCase() + ' if it fails' : main;
  },

  /* An account may hold more than one method, so this reads as a list. The
     labels live in core.js because the menu gate reads them too. */
  connLabel(){
    const list = connections().map(k => CONNECTIONS[k].label);
    return list.length ? list.join(' · ') : '—';
  },

  /* The four answers that change how a document is computed. Each is a real
     question with a real consequence, so each says what it decides. */
  PROFILE: [
    { key:'hasExempt',
      label:'Sells VAT-exempt goods or services',
      note:'Sec. 109 items. Turning this on lets a line be tagged VAT-exempt, and puts an exempt column on every document that carries one.' },
    { key:'hasZero',
      label:'Makes zero-rated sales',
      note:'Exports and other zero-rated transactions. These never carry VAT and never qualify for the SC/PWD discount.' },
    { key:'servesSCPWD',
      label:'Serves senior citizens or persons with disability',
      note:'RA 9994 and RA 10754. VAT comes off an eligible line first, then 20% off what remains. This applies per line, not per sale.' },
    { key:'isWithholdingAgent',
      label:'Is a withholding agent',
      note:'Expanded withholding tax is deducted from the amount collected but not from the tax due on the invoice.' }
  ]
};

/* ============================================================
   Screen wiring
   ============================================================ */

function SettingsScreen() {
  TabToggling(".tab_button_settings_1", ".tab_content_settings_1");

  $(".tab_button_settings_1").off("click").on("click", function () {
    TabToggling(".tab_button_settings_1", ".tab_content_settings_1");
  });
  $(".tab_button_settings_2").off("click").on("click", function () {
    TabToggling(".tab_button_settings_2", ".tab_content_settings_2");
  });
  $(".tab_button_settings_3").off("click").on("click", function () {
    TabToggling(".tab_button_settings_3", ".tab_content_settings_3");
  });
  $(".tab_button_settings_4").off("click").on("click", function () {
    TabToggling(".tab_button_settings_4", ".tab_content_settings_4");
  });
  /* Repainted on each open rather than once with the screen: a session can end
     while this tab is sitting behind another one. */
  $(".tab_button_settings_5").off("click").on("click", function () {
    TabToggling(".tab_button_settings_5", ".tab_content_settings_5", SettingsSessionsPaint);
  });

  $(".button_settings_attest").off("click").on("click", function () {
    ModalTaxProfile();
  });
  $(".button_settings_rep").off("click").on("click", function () { ModalRequestRep(); });
  $(".button_settings_rep_cancel").off("click").on("click", function () {
    DisplayConfirmSwal(`<span class="fw-bold fs_18 text-dark">Cancel the request?</span>
      <span class="fs_14 text-muted">The current representative stays. You can ask again at any time.</span>`,
      () => {
        UI.closeModal();
        $.ajax({ url:"/Portal/SPIStradcom/Dashboard/SettingsCancelRep", method:"POST", dataType:"json" }).done(res => {
          DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
          if (res.success) Nav.go('settings');
        });
      }, null, 'Cancel request');
  });

  SettingsSessionsWire();
}

Screens.settings = function () {
  SettingsScreen();
  PayUI.bindSettings();
  AgreementUI.bind();
};


/* ============================================================
   Re-attestation. The taxpayer, not EPI, answers for what is declared here.
   ============================================================ */

/** The client asks for a new authorized representative; EPI validates the document (RMC VII.1). */
function ModalRequestRep(){
  let file = '';
  const cur = CT.representative || CT.signatory;
  UI.openModal('Request a new representative', `
    <p class="fs_12 text-muted">${cur ? `Current: ${esc(cur.name)}, ${esc(cur.position)}. ` : ''}The new person becomes the account owner, and the current representative's access ends once EPI approves. Nothing changes until then.</p>
    <div class="row g-2 mb-2">
      <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm input_rep_name" maxlength="80" placeholder="Full name" aria-label="Full name"></div>
      <div class="col-12 col-md-6"><input type="text" class="form-control form-control-sm input_rep_pos" maxlength="80" placeholder="Position" aria-label="Position"></div>
      <div class="col-12"><input type="email" class="form-control form-control-sm input_rep_email" maxlength="120" placeholder="Email" aria-label="Email"></div>
    </div>
    <div class="fs_12 fw-semibold mb-1">${esc(AUTHORITY_DOCS[(CT.authority || {}).kind || (ENTITY_TYPES[CT.entity] || ENTITY_TYPES.CORPORATION).authority])}</div>
    <div class="fs_11 text-muted mb-1">It must name the new representative and authorize them to sign agreements, give EPI written authorizations and confirm the tax profile.</div>
    <div class="d-flex align-items-center gap-2 py-2 border-top border-bottom mb-2">
      <i class="bi bi-file-earmark-arrow-up fs_18 icon_rep_file"></i>
      <div class="flex-grow-1 fs_12"><div class="fw-semibold">Authority document <span class="text-danger">*</span></div><div class="text-muted div_rep_file">Not uploaded</div></div>
      <button class="lbtn lbtn-sm lbtn-ghost button_rep_upload">Upload</button>
    </div>
    <div class="d-flex align-items-center gap-2 mb-2"><span class="fs_12">Valid until</span>
      <input type="date" class="form-control form-control-sm input_rep_exp" style="max-width:170px"></div>
    <input type="text" class="form-control form-control-sm input_rep_reason" maxlength="200" placeholder="Reason (optional)" aria-label="Reason">`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn lbtn-primary button_rep_send">Send to EPI</button>`);
  $(".button_rep_upload").on("click", () => {
    file = 'Authority-' + AppReg.normTin(CT.tin) + '-' + new Date().getFullYear() + '.pdf';
    $(".div_rep_file").text(file);
    $(".icon_rep_file").removeClass('bi-file-earmark-arrow-up').addClass('bi-file-earmark-check text-success');
  });
  $(".button_rep_send").on("click", () => {
    $.ajax({ url:"/Portal/SPIStradcom/Dashboard/SettingsRequestRep", method:"POST", dataType:"json",
      data:{ name:$(".input_rep_name").val(), position:$(".input_rep_pos").val(), email:$(".input_rep_email").val(),
             file, expiresAt:$(".input_rep_exp").val(), reason:$(".input_rep_reason").val() } }).done(res => {
      if (!res.success){ DisplayDelaySwal("info", "", res.message); return; }
      UI.closeModal();
      DisplayDelaySwal("success", "", res.message);
      Nav.go('settings');
    });
  });
}

function ModalTaxProfile() {
  const rows = SettingsReg.PROFILE.map(f => `
    <label class="d-flex gap-2 align-items-start border rounded-3 p-3 mb-2 hover_lift" style="cursor:pointer;">
      <input type="checkbox" class="checkbox mt-1 checkbox_tax_profile" data-key="${f.key}"
             ${CT[f.key] ? 'checked' : ''}>
      <span>
        <span class="fw-semibold fs_13 d-block text-dark">${esc(f.label)}</span>
        <span class="fs_11 text-muted">${esc(f.note)}</span>
      </span>
    </label>`).join('');

  UI.openModal('Tax profile', `
    <p class="fs_12 text-muted">
      These four settings determine how VAT is computed on documents. A change applies to new documents only. Issued documents are not changed. The declaration is recorded under your name.
    </p>
    ${rows}
    ${Callout('warn', `I confirm that this is a true statement of ${esc(CT.name)}'s VAT position as
      registered with the BIR, and that I am authorized to make it.`, {style:'margin-top:14px;'})}
    <label class="d-flex gap-2 align-items-start fs_12 text-secondary mt-2" style="cursor:pointer;">
      <input type="checkbox" class="checkbox mt-1" id="chk_tax_profile_attest"
             onchange="document.getElementById('btn_tax_profile_save').disabled = !this.checked">
      <span>I confirm the above as ${esc(CU.name)}, ${esc(ROLES[CR].label)}.</span>
    </label>`,
    `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Cancel</button>
     <button class="lbtn lbtn-primary" id="btn_tax_profile_save" disabled
             onclick="SaveTaxProfile()">Attest and save</button>`, 'lg');
}

function SaveTaxProfile() {
  const changes = {};
  $(".checkbox_tax_profile").each(function () {
    changes[$(this).data("key")] = $(this).is(":checked");
  });

  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/SettingsAttestTaxProfile",
    type: "POST",
    dataType: "json",
    contentType: "application/json; charset=utf-8",
    data: JSON.stringify(changes)
  }).done(function (res) {
    Swal.close();
    UI.closeModal();
    if (res.success) {
      DisplayDelaySwal("success", "", res.message, function () { Nav.go('settings'); });
    } else {
      DisplaySwal("info", "", res.message);
    }
  }).fail(function () {
    Swal.close();
    DisplaySwal("error", "", "The request could not be completed. Try again.");
  });
}

LocalAPI.on("Dashboard/SettingsRequestRep", function (p) {
  if (!can('users')) return { success:false, message:'Only an owner can ask to replace the representative.' };
  const db = Store.db;
  db.repRequests = db.repRequests || [];
  if (db.repRequests.some(r => r.tenantId === CT.id && r.status === 'PENDING'))
    return { success:false, message:'A request is already waiting for EPI. Cancel it first to send another.' };
  const bad = AppReg.repProblem(db, p);
  if (bad) return { success:false, message:bad };
  if (db.repRequests.some(r => r.status === 'PENDING' && String(r.email).toLowerCase() === String(p.email).trim().toLowerCase()))
    return { success:false, message:'Another request already uses that email.' };
  db.repRequests.push({ id:uid('rr'), tenantId:CT.id, name:p.name.trim(), position:p.position.trim(), email:p.email.trim(),
    file:p.file, expiresAt:p.expiresAt || null, reason:String(p.reason || '').trim().slice(0, 200), status:'PENDING', by:CU.name, at:new Date().toISOString() });
  logActivity(db, { action:`Asked EPI to replace the authorized representative with ${p.name.trim()}` });
  Store.save(db);
  return { success:true, message:'Request sent to EPI. The current representative stays until EPI approves it.' };
});

LocalAPI.on("Dashboard/SettingsCancelRep", function () {
  if (!can('users')) return { success:false, message:'Only an owner can cancel the request.' };
  const db = Store.db, r = (db.repRequests || []).find(x => x.tenantId === CT.id && x.status === 'PENDING');
  if (!r) return { success:false, message:'No request is waiting.' };
  r.status = 'CANCELLED'; r.decidedAt = new Date().toISOString(); r.note = 'Cancelled by the client';
  logActivity(db, { action:'Cancelled the request to replace the authorized representative' });
  Store.save(db);
  return { success:true, message:'Request cancelled.' };
});

LocalAPI.on("Dashboard/SettingsAttestTaxProfile", function (body) {
  if (!can('taxProfile')){
    return { success:false, message:'Only an owner may confirm the tax profile.' };
  }

  const db = Store.db;
  const t = db.tenants.find(x => x.id === CU.tenantId);
  const changed = [];

  SettingsReg.PROFILE.forEach(f => {
    const next = !!body[f.key];
    if (!!t[f.key] !== next){
      changed.push(`${f.label}: ${t[f.key] ? 'yes' : 'no'} → ${next ? 'yes' : 'no'}`);
      t[f.key] = next;
    }
  });

  if (!changed.length){
    return { success:false, message:'No changes. The profile is already as declared.' };
  }

  t.attestedBy = CU.name;
  t.attestedAt = new Date().toISOString();

  logActivity(db, {
    action: `Confirmed the tax profile again: ${changed.join('; ')}`
  });
  Store.save(db);
  refreshSession();

  return { success:true, message:'Tax profile updated and confirmed.' };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  settings(){
    const db = Store.db;
    const allBranches = db.branches.filter(b => b.tenantId === CT.id);
    const invoices = db.invoices.filter(i => i.tenantId === CT.id);
    const usage = SettingsReg.usage();

    const branchRows = allBranches.map(b => {
      const mine = invoices.filter(i => i.branchId === b.id);
      return `
        <tr>
          <td class="mono">${esc(b.code)}</td>
          <td><strong>${esc(b.name)}</strong></td>
          <td>${esc(b.rdo)}</td>
          <td>${esc(b.address)}</td>
          <td class="text-end">${mine.length}</td>
          <td>${b.active ? 'Active'
                          : '<span class="lbadge lbadge-gray">Closed</span>'}</td>
        </tr>`;
    }).join('');

    /* EPI keeps two series on its one branch: printing sales, and the System fees it bills its clients. */
    const epiSystemRow = b => {
      const sys = invoices.filter(i => i.providerBilling), sr = SYSTEM.taxpayer.series, pad = n => String(n).padStart(sr.digits, '0');
      const last = sys.reduce((m, i) => Math.max(m, parseInt(String(i.number).split('-').pop(), 10) || 0), 0);
      const retired = sys.filter(i => i.docStatus === 'CANCELLED').length;
      return `
        <tr>
          <td><strong>System fees</strong></td>
          <td class="mono">${pad(sr.from)}</td>
          <td class="mono">${pad(Math.max(1, last))}</td>
          <td class="text-end">${sys.length}</td>
          <td class="text-end">${retired ? `<span class="lbadge lbadge-red">${retired}</span>` : '0'}</td>
        </tr>`;
    };
    /* One running series for the whole taxpayer, shared by all its branches (EPI keeps a second one for System fees). */
    const seriesRows = (() => {
      const s = db.series[`INVOICE:${CT.id}`], next = s ? s.next : 1;
      const own = CT.isProvider ? invoices.filter(i => !i.providerBilling) : invoices;
      const issued = own.filter(i => i.docType === 'INVOICE').length;
      const retired = own.filter(i => i.docStatus === 'CANCELLED').length;
      return `
        <tr>
          <td><strong>${CT.isProvider ? 'Printing' : 'All branches'}</strong></td>
          <td class="mono">${esc(formatSeriesNumber(CT.seriesPrefix, '', 0, 1))}</td>
          <td class="mono">${esc(formatSeriesNumber(CT.seriesPrefix, '', 0, Math.max(1, next - 1)))}</td>
          <td class="text-end">${issued}</td>
          <td class="text-end">${retired
            ? `<span class="lbadge lbadge-red">${retired}</span>` : '0'}</td>
        </tr>${CT.isProvider ? epiSystemRow(allBranches[0] || {}) : ''}`;
    })();

    const profileRows = SettingsReg.PROFILE.map(f => `
      <dt>${esc(f.label)}</dt>
      <dd>${CT[f.key] ? 'Yes' : 'No'}</dd>`).join('');

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Settings</h1>
          <div class="screen_sub">
            BIR registration details, tax profile, branches, invoice numbers, tier and fees.
          </div>
        </div>
        <div>${badge('onboarding', CT.onboardingStatus)}</div>
      </div>

      <div class="mt-2">
        <div class="d-flex mx-3 gap-1 flex-nowrap fs_13 overflow_x_scroll">
          <div class="tab_button tab_button_settings_1 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">ACCOUNT AND TAX PROFILE</div>
          <div class="tab_button tab_button_settings_2 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">BRANCHES</div>
          <div class="tab_button tab_button_settings_3 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">INVOICE NUMBERS</div>
          <div class="tab_button tab_button_settings_4 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">${CT.isProvider ? 'CONNECTION' : 'TIER AND CONNECTION'}</div>
          <div class="tab_button tab_button_settings_5 px-3 py-2 fw-semibold hover_lift" tabindex="0" role="tab">SESSIONS</div>
        </div>
      </div>

      <div class="mt-3">

        <!-- ---------- Account & tax profile ---------- -->
        <div class="tab_content tab_content_settings_1 d-none">
          <div class="row g-3">
            <div class="col-12 col-lg-6">
              <div class="lcard h-100"><div class="lcard-body">
                <strong class="fs_13 text-secondary fw-bold">REGISTRATION</strong>
                <span class="fs_11 text-muted mb-3">Captured from BIR Form 2303 and verified by EPI</span>
                <dl class="dl">
                  <dt>Registered name</dt><dd>${esc(CT.name)}</dd>
                  <dt>Trade name</dt><dd>${esc(CT.tradeName)}</dd>
                  <dt>TIN</dt><dd class="mono">${esc(CT.tin)}-000</dd>
                  <dt>Classification</dt><dd>${esc(CT.classification)}</dd>
                  <dt>Jurisdiction</dt><dd>${esc(CT.jurisdiction)}</dd>
                  <dt>Registered address</dt><dd>${esc(CT.address)}</dd>
                </dl>
              </div></div>
            </div>

            <div class="col-12 col-lg-6">
              <div class="lcard h-100"><div class="lcard-body">
                <div class="d-flex justify-content-between align-items-start">
                  <div>
                    <strong class="fs_13 text-secondary fw-bold d-block">TAX PROFILE</strong>
                    <span class="fs_11 text-muted">Confirmed by the taxpayer. Confirm again when it changes.</span>
                  </div>
                  ${can('taxProfile') ? `
                  <button class="lbtn lbtn-sm lbtn-ghost text-nowrap button_settings_attest">
                    <i class="bi bi-pencil-square me-1"></i> Change
                  </button>` : ''}
                </div>
                <dl class="dl mt-3">
                  <dt>VAT status</dt>
                  <dd>${CT.vatStatus === 'VAT' ? 'VAT Registered' : 'Non-VAT (Percentage Tax)'}</dd>
                  ${profileRows}
                  <dt>Confirmed by</dt>
                  <dd>${esc(CT.attestedBy)}
                    <div class="fs_11 text-muted fw-normal mono">${fmtDateTime(CT.attestedAt)}</div></dd>
                </dl>
                ${can('taxProfile') ? '' : `
                <div class="fs_11 text-muted mt-2">Only an owner may change this declaration.</div>`}
              </div></div>
            </div>
          </div>

          <div class="row g-3 mt-0">
            <div class="col-12">
              <div class="lcard"><div class="lcard-body">
                <strong class="fs_13 text-secondary fw-bold d-block">SIGNATORY AND AUTHORITY</strong>
                <span class="fs_11 text-muted d-block mb-3">Only these people can confirm the tax profile and give EPI written authorizations.</span>
                <dl class="dl mb-0">
                  <dt>Signatory</dt><dd>${CT.signatory ? `${esc(CT.signatory.name)} · ${esc(CT.signatory.position)}` : esc(CT.attestedBy || 'Not recorded')}</dd>
                  <dt>Authorized representative</dt><dd>${CT.representative ? `${esc(CT.representative.name)} · ${esc(CT.representative.position)}` : 'None. The signatory acts for the business.'}</dd>
                  ${CT.authority && CT.authority.expiresAt ? `<dt>Authority valid until</dt><dd>${esc(fmtDate(CT.authority.expiresAt))}${AppReg.authorityState(CT) === 'EXPIRED' ? ' <span class="lbadge lbadge-red">Expired</span>' : AppReg.authorityState(CT) === 'SOON' ? ' <span class="lbadge lbadge-amber">Expires soon</span>' : ''}</dd>` : ''}
                </dl>
                ${(() => {
                  const reqs = (Store.db.repRequests || []).filter(r => r.tenantId === CT.id);
                  const pend = reqs.find(r => r.status === 'PENDING'), last = reqs.filter(r => r.status === 'DECLINED').sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt))[0];
                  return pend
                    ? `<div class="mt-3">${Callout('info', `<strong>Waiting for EPI.</strong> You asked on ${esc(fmtDate(pend.at))} to replace the representative with ${esc(pend.name)}. EPI validates the new authority document first. Until then the current representative stays.`)}
                       ${can('users') ? '<button class="lbtn lbtn-sm lbtn-ghost mt-2 button_settings_rep_cancel">Cancel request</button>' : ''}</div>`
                    : `${last ? `<div class="mt-3">${Callout('warn', `<strong>EPI declined the last request, ${esc(fmtDate(last.decidedAt))}:</strong> ${esc(last.note || '')}`)}</div>` : ''}
                       <div class="d-flex align-items-center gap-3 flex-wrap mt-3">
                         ${can('users') ? '<button class="lbtn lbtn-sm lbtn-ghost button_settings_rep"><i class="bi bi-person-gear me-1"></i> Request a new representative</button>' : ''}
                       </div>`;
                })()}
              </div></div>
            </div>
          </div>

          <div class="row g-3 mt-0">
            <div class="col-12">${CT.isProvider ? '' : SettingsReg.ptiCard()}</div>
          </div>
        </div>

        <!-- ---------- Branches ---------- -->
        <div class="tab_content tab_content_settings_2 d-none">
          <div class="lcard"><div class="lcard-body">
          <div class="d-flex justify-content-between align-items-end mb-3">
            <div>
              <strong class="fs_13 text-secondary fw-bold d-block">BRANCHES</strong>
              <span class="fs_11 text-muted">
                Each branch is registered with its own RDO and has its own numbering. Branches are added during registration.
              </span>
            </div>
            <span class="fs_11 text-muted text-nowrap">
              ${allBranches.length} branch${allBranches.length === 1 ? '' : 'es'} ·
              ${new Set(allBranches.map(b => b.rdo)).size} RDO(s)
            </span>
          </div>
          <div class="table-responsive">
            <table class="table nowrap tbl fs_12">
              <thead>
                <tr>
                  <th>CODE</th><th>BRANCH</th><th>RDO</th><th>ADDRESS</th>
                  <th class="text-end">DOCUMENTS</th><th>STATUS</th>
                </tr>
              </thead>
              <tbody>${branchRows}</tbody>
            </table>
          </div>
          </div></div>
        </div>

        <!-- ---------- Invoice series ---------- -->
        <div class="tab_content tab_content_settings_3 d-none">
          <div class="lcard"><div class="lcard-body">
          <div class="mb-3">
            <strong class="fs_13 text-secondary fw-bold d-block">INVOICE NUMBERS</strong>
            <span class="fs_11 text-muted">
              One running series for the whole taxpayer: the prefix and seven digits, shared by all branches and never restarted${CT.isProvider ? ', and EPI keeps a second, plain series (0000001 to 0500000) for the System fees it bills its clients' : ''}. A number is given only after the invoice passes checks.
            </span>
          </div>
          <div class="table-responsive">
            <table class="table nowrap tbl fs_12">
              <thead>
                <tr>
                  <th>SERIES</th><th>FIRST NUMBER</th><th>LAST NUMBER</th>
                  <th class="text-end">ISSUED</th><th class="text-end">CANCELLED</th>
                </tr>
              </thead>
              <tbody>${seriesRows}</tbody>
            </table>
          </div>
          ${Callout('info', `<strong>The numbers have no gaps and are never reused.</strong>
            A rejected invoice does not use a number. A gap would look like a deleted invoice to the BIR.
            A cancelled invoice keeps its number, and the number is never used again.`, {cls:'mt-3'})}
          </div></div>
        </div>

        <!-- ---------- Plan & connection ---------- -->
        <div class="tab_content tab_content_settings_4 d-none">
          ${CT.isProvider ? '' : PayViews.planCard()}
          <div class="row g-3">
                        <div class="${CT.isProvider ? 'd-none ' : ''}col-12 col-lg-6">
              <div class="lcard h-100"><div class="lcard-body">
                <strong class="fs_13 text-secondary fw-bold mb-3">USAGE</strong>
                <dl class="dl">
                  <dt>Covered as</dt><dd>${esc(coverage().basis.label)}
                    <div class="fs_11 text-muted fw-normal">${esc(coverage().basis.ref)}</div></dd>
                  <dt>Allowance per month</dt><dd class="mono">${usage.included ? num(usage.included, 0) + ' invoices' : 'No limit'}</dd>
                  <dt>${esc(usage.month)}</dt><dd class="mono">${num(usage.issued, 0)} issued</dd>
                </dl>
                <div class="lprogress mt-2"><div class="lprogress-bar" style="width:${usage.pct}%"></div></div>
                <span class="fs_11 text-muted mt-2">
                  ${usage.included ? usage.pct + '% of your monthly allowance used this month.' : 'Your tier has no monthly allowance.'}
                </span>
              </div></div>
            </div>

            <div class="col-12 col-lg-6">
              <div class="lcard h-100"><div class="lcard-body">
                <strong class="fs_13 text-secondary fw-bold mb-3">CONNECTION</strong>
                <dl class="dl">
                  <dt>Method</dt><dd>${esc(SettingsReg.connLabel())}</dd>
                  <dt>Issues on</dt><dd>${issuesOnOwnSystem()
                    ? `The taxpayer's own system${CT.esrMode ? ` · ${esc((ESR_MODES[CT.esrMode] || {}).label || CT.esrMode)}` : ''}`
                    : 'This system'}</dd>
                  <dt>Plan</dt><dd>${esc(SettingsReg.laneLabel())}</dd>
                  <dt>Buyer copy</dt><dd>${esc(SettingsReg.deliveryLabel())}</dd>
                  <!-- One date, stated once. This block used to show the same
                       timestamp three times under three names — "Sandbox
                       completed", "Go-live" and "Active since" — which reads as
                       three separate events that happened to coincide. -->
                  <dt>Active since</dt><dd class="mono">${fmtDateTime(CT.goLiveAt)}</dd>
                </dl>
              </div></div>
            </div>
          </div>

          ${CT.isProvider ? '' : AgreementViews.card(CT)}
        </div>

        <!-- ---------- Sessions ---------- -->
        <div class="tab_content tab_content_settings_5 d-none">
          <div class="lcard"><div class="lcard-body">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
            <div>
              <strong class="fs_13 text-secondary fw-bold d-block">WHERE YOU ARE SIGNED IN</strong>
              <span class="fs_11 text-muted">
                One row per active session. Ending a session signs out that device. Invoices issued from it are not affected.
              </span>
            </div>
            <button class="lbtn lbtn-sm lbtn-danger text-nowrap button_settings_end_others">
              <i class="bi bi-box-arrow-right me-1"></i> Sign out everywhere else
            </button>
          </div>

          <div class="d-flex flex-column gap-2 div_settings_sessions_mine"></div>

          ${can('users') ? `
          <div class="hr_gray_200 my-4"></div>
          <div class="mb-3">
            <strong class="fs_13 text-secondary fw-bold d-block">EVERYONE ELSE IN THIS ACCOUNT</strong>
            <span class="fs_11 text-muted">
              Owners can see and end every open session in the business.
            </span>
          </div>
          <div class="d-flex flex-column gap-2 div_settings_sessions_all"></div>` : ''}

          ${Callout('info', `<strong>Idle sessions sign out after 15 minutes</strong>, with a warning in the last minute.
            <div class="mt-2">
              <button class="lbtn lbtn-sm lbtn-ghost fs_11 button_settings_demo_idle">
                Demo: set the idle timer to 20 seconds
              </button>
            </div>`, {cls:'mt-4'})}
          </div></div>
        </div>
      </div>`;
  }
});

/* ============================================================
   Sessions — screen wiring
   ============================================================ */

/** One session, as a row. `mine` decides whether the button says who. */
function SessionRow(s, mine) {
  const db = Store.db;
  const u = (db.users || []).find(x => x.id === s.userId);
  const here = s.id === SessionCtl.current;
  const open = !s.endedAt;

  return `
    <div class="ses-row d-flex justify-content-between align-items-center gap-3 flex-wrap
                ${here ? 'ses-current' : ''} ${open ? '' : 'ses-ended'}">
      <div>
        <div class="fs_13 fw-semibold text-dark">
          <span class="ses-dot me-2 ${open ? 'bg-success' : 'bg-secondary'}"></span>
          ${esc(s.device)} · ${esc(s.browser)}
          ${here ? '<span class="lbadge lbadge-green ms-2">This device</span>' : ''}
          ${mine ? '' : `<span class="fs_12 text-muted ms-2">${esc(u ? u.name : 'Unknown user')}</span>`}
        </div>
        <div class="fs_11 text-muted mt-1">
          Started ${fmtDateTime(s.startedAt)} ·
          ${open ? `last used ${fmtDateTime(s.lastSeenAt)}`
                 : `ended ${fmtDateTime(s.endedAt)} (${esc(s.endedBy || 'signed out')})`}
        </div>
        <div class="fs_11 text-muted">
          ${esc(s.location)} · ${esc(s.ip)}
        </div>
      </div>
      ${open && !here ? `
        <button class="lbtn lbtn-sm lbtn-danger fs_11 text-nowrap button_settings_end_session"
                data-id="${esc(s.id)}">End this session</button>` : ''}
    </div>`;
}

function SettingsSessionsPaint() {
  const mine = SessionCtl.forUser(CU.id);
  $(".div_settings_sessions_mine").html(
    mine.length ? mine.slice(0, 12).map(s => SessionRow(s, true)).join('')
                : '<div class="fs_12 text-muted">No sessions recorded.</div>');

  if (can('users')){
    /* Only the ones still open, and not the reader's own — those are directly
       above. A list that repeats itself teaches people to skim it. */
    const others = SessionCtl.forTenant(CU.tenantId)
      .filter(s => !s.endedAt && s.userId !== CU.id);
    $(".div_settings_sessions_all").html(
      others.length ? others.map(s => SessionRow(s, false)).join('')
                    : '<div class="fs_12 text-muted">No other active sessions.</div>');
  }

  $(".button_settings_end_session").off("click").on("click", function () {
    const id = $(this).data("id");
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">End this session?</span>
       <span class="fs_14 text-muted">The device is signed out immediately. Invoices issued from it are not affected.</span>`,
      function () {
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/SessionEnd",
          method: "POST", data: { session_id: id },
          success: function (res) {
            DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
            SettingsSessionsPaint();
          }
        });
      }, null, "End session");
  });
}

function SettingsSessionsWire() {
  SettingsSessionsPaint();

  $(".button_settings_end_others").off("click").on("click", function () {
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Sign out everywhere else?</span>
       <span class="fs_14 text-muted">All your other sessions end immediately. This session stays open. Use this if you signed in on a device you no longer control.</span>`,
      function () {
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/SessionEndOthers",
          method: "POST",
          success: function (res) {
            DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
            SettingsSessionsPaint();
          }
        });
      }, null, "Sign out");
  });

  $(".button_settings_demo_idle").off("click").on("click", function () {
    SessionCtl.demoTimeout();
  });
}
