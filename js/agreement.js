/* ============================================================
   agreement.js — the Client Service Agreement, built for each client

   The agreement text comes from the Word file EPI's lawyer will review, converted by
   tools/build_agreement_html.py into agreement-text.js (CSA). This file fills the client's own details
   into it (the parties, Schedule A, Annex 1), shows it, and prints it for signing.

   The signing flow (CSA 3, 11.1 and 12.9): the client downloads the agreement, signs it in ink with
   initials on every page, has it notarized (EPI arranges the notary, pays the fee, and never signs for
   the client), and uploads the signed and notarized copy. EPI checks the copy before the account goes
   live and then countersigns. Nothing is signed electronically. The upload is simulated here: a file
   name is kept, not the file.
   ============================================================ */

const AgreementReg = {

  BLANK: '____________________',

  typeLabel(key){ return (ENTITY_TYPES[key] || {}).label || 'Corporation'; },

  /** What goes into the document for an account that is still being set up. */
  fromApp(app, s){
    const ex = s.extracted || {}, a = app.applicant || {};
    const sig = app.authority ? { name:app.authority.signatory, position:app.authority.signatoryPosition } : { name:a.person, position:a.position };
    const branches = s.lane === 'EXPRESS' ? [{ code:'000', name:'Main', address:ex.address || '' }] : (s.branches || []);
    return this.data({
      name:app.tenantName, tin:app.tin, entity:app.entity, address:ex.address || '', signatory:sig.name, position:sig.position,
      contact:[a.person, app.email].filter(Boolean).join(', '), branches, plan:s.plan, usage:s.usage, provider:s.provider,
      depositPaid: !!(s.deposit && s.deposit.paid)
    });
  },

  /** What goes into the document for an active account. */
  fromTenant(t){
    const db = Store.db, sig = t.signatory || {};
    const owner = (db.users || []).find(u => u.tenantId === t.id && u.roleKey === 'OWNER') || {};
    const uh = t.usageHistory || {};
    return this.data({
      name:t.name, tin:t.tin, entity:t.entity, address:t.address, signatory:sig.name || owner.name, position:sig.position || owner.position,
      contact:[owner.name, owner.email].filter(Boolean).join(', '),
      branches:db.branches.filter(b => b.tenantId === t.id && b.active), plan:planOf(t),
      usage:{ avg:uh.avgMonthly == null ? null : uh.avgMonthly, newBusiness:!!uh.newBusiness }, provider:t.provider, depositPaid:true
    });
  },

  data(c){
    const P = PLANS[planKey(c.plan)] || null, u = c.usage || {};
    const n0 = v => v.toLocaleString('en-PH');
    const prov = c.provider;
    return {
      name:c.name, tin:c.tin, type:this.typeLabel(c.entity), type_lc:this.typeLabel(c.entity).toLowerCase(),
      address:c.address, notice_address:c.address, signatory:c.signatory, position:c.position, contact:c.contact,
      plan: P ? `${P.label}: ${("₱" + P.fee.toFixed(2))} per invoice. Monthly Allowance ${P.limit ? n0(P.allowance) + ' (' + n0(P.limit) + ' with the 1% margin), excess fee ' + ("₱" + P.excessFee.toFixed(2)) : 'none (no limit)'}` : '',
      usage: u.newBusiness ? 'New business with no sales history. Starts on Tier 1.' : (u.avg ? `${n0(u.avg)} a month (12-month average)` : ''),
      deposit: P ? `${peso0(P.deposit)}${c.depositPaid ? ', paid' : ', to be paid before activation'}` : '',
      provider: prov ? (prov.mode === 'OWN' ? 'CLIENT’s own provider: ' : 'EPI’s partner: ') + prov.name : '',
      settlement: prov && prov.account ? `${prov.account.kind}: ${prov.account.label}, settled ${prov.settlement === 'T+1' ? 'on the next banking day (T+1)' : 'in real time'}` : '',
      branches: c.branches || []
    };
  },

  /** The agreement, with the client's details filled in. */
  html(d){
    const rows = (d.branches || []).map(b => `<tr><td>${esc(b.code || '')}</td><td>${esc(b.name || '')}</td><td>${esc(b.address || '')}</td></tr>`).join('') ||
                 '<tr><td>&nbsp;</td><td></td><td></td></tr>';
    return CSA.html.replace(/\{\{(\w+)\}\}/g, (m, k) => {
      if (k === 'branch_rows') return rows;
      const v = d[k];
      return v ? `<u>${esc(v)}</u>` : this.BLANK;
    });
  },

  /** The whole document, for printing and for the preview. */
  doc(d){
    return `<div class="csa">${this.html(d)}<div class="csa-foot">Client Service Agreement, version ${esc(CSA.version)} | Digitized Invoice System | Initials: Client ______ EPI ______</div></div>`;
  },

  preview(d, title){
    UI.openModal(title || 'Client Service Agreement', `
      <div class="fs_12 text-muted mb-2">Version ${esc(CSA.version)}. This is the text you sign. Your details are underlined.</div>
      <div class="csa-view">${this.doc(d)}</div>`,
      `<button class="lbtn lbtn-ghost" onclick="UI.closeModal()">Close</button>
       <button class="lbtn lbtn-primary button_csa_print_modal">Download (PDF)</button>`, 'lg');
    $(".button_csa_print_modal").off("click").on("click", () => this.print(d));
  },

  /** Print through the browser. "Save as PDF" in the print dialog is the download. */
  print(d, name){
    const old = document.getElementById('print-frame');
    if (old) old.remove();
    const f = document.createElement('iframe');
    f.id = 'print-frame'; f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(f);
    const doc = f.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><base href="${location.href.split('#')[0]}">
      <title>${esc(name || 'Client-Service-Agreement-' + (d.tin || 'DIS'))}</title>
      <link rel="stylesheet" href="css/agreement.css"></head><body style="background:#fff;margin:0;">${this.doc(d)}</body></html>`);
    doc.close();
    setTimeout(() => {
      try { f.contentWindow.focus(); f.contentWindow.print(); }
      catch (e) { UI.toast('Printing is not available in this browser', 'warn'); }
    }, 350);
  }
};

/* ============================================================
   On an active account (Settings)
   ============================================================ */

const AgreementViews = {
  card(t){
    const a = t.agreement;
    return `
      <div class="lcard mt-3"><div class="lcard-body">
        <div class="d-flex flex-wrap align-items-start gap-3">
          <div class="flex-grow-1">
            <strong class="fs_13 text-secondary fw-bold d-block mb-1">CLIENT SERVICE AGREEMENT</strong>
            ${a ? `<dl class="dl mb-0">
              <dt>Version</dt><dd>${esc(a.version)}</dd>
              <dt>Signed copy</dt><dd class="mono fs_12">${esc(a.signedFile || 'On file')}</dd>
              <dt>Checked by EPI</dt><dd>${esc(a.verifiedBy || 'EPI')} on ${esc(fmtDate(a.verifiedAt))}</dd>
              <dt>Countersigned by EPI</dt><dd>${esc(fmtDate(a.countersignedAt || a.verifiedAt))}</dd>
              <dt>Term</dt><dd>One year from ${esc(fmtDate(t.goLiveAt))}, renewing yearly</dd>
            </dl>` : '<div class="fs_13 text-muted">No signed agreement is on file for this account.</div>'}
          </div>
          <div class="d-flex gap-2">
            <button class="lbtn lbtn-sm lbtn-ghost button_csa_view">View</button>
            <button class="lbtn lbtn-sm lbtn-ghost button_csa_print">Download (PDF)</button>
          </div>
        </div>
      </div></div>`;
  }
};

const AgreementUI = {
  bind(){
    $(".button_csa_view").off("click").on("click", () => AgreementReg.preview(AgreementReg.fromTenant(CT)));
    $(".button_csa_print").off("click").on("click", () => AgreementReg.print(AgreementReg.fromTenant(CT)));
  }
};
