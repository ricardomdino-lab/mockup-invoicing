/* ============================================================
   template.js — Invoice Template

   A form over InvoiceDoc's settings, with the document itself as the preview.
   The renderer owns what is configurable and what is fixed (InvoiceDoc.DEFAULTS
   and InvoiceDoc.LOCKED); this screen only edits the first list and displays
   the second.

   The point of the screen is the second list. Sellers reasonably want their
   invoice to look like theirs, and everything cosmetic is allowed — mark,
   color, trade name, a contact line, a closing note. What cannot be moved is
   any particular required by Sec. 237 of the Tax Code as amended by RA 11976,
   because a document missing one of those is not a plainer invoice, it is not
   an invoice. Rather than let a seller discover that from a rejected filing,
   the locked list is on the screen with the reason beside each entry.

   Changes apply to documents issued from now on. Nothing already issued is
   re-rendered — a buyer's copy and our copy have to stay the same document.
   ============================================================ */

const TemplateReg = {

  ZOOMS: [0.5, 0.75, 1, 1.25],
  zoom: 0.75,

  /** The working copy being edited, before it is applied. */
  draft: null,

  /* Six presets, so the color field is a choice rather than a hex box the
     seller has to be a designer to use. Free entry is there as well. */
  SWATCHES: ['#274a7a', '#0f766e', '#7c2d12', '#4c1d95', '#831843', '#334155'],

  begin(){
    this.draft = Object.assign({}, InvoiceDoc.config(CT));
    return this.draft;
  },

  dirty(){
    if (!this.draft) return false;
    const saved = InvoiceDoc.config(CT);
    return Object.keys(this.draft).some(k => String(this.draft[k]) !== String(saved[k]));
  },

  /**
   * A document to preview against. Built from the tenant's own branch and
   * catalog so the preview shows their names and their prices, and marked
   * with an obviously fake number so a screenshot of it can never be mistaken
   * for a real one.
   */
  sample(){
    const db = Store.db;
    const branch = (Auth.visibleBranches() || [])[0] ||
                   db.branches.find(b => b.tenantId === CT.id);
    const items = db.items.filter(i => i.tenantId === CT.id);
    const pick = n => items[n % Math.max(items.length, 1)] ||
                      { desc:'Sample item', sku:'SKU-0001', unit:'pc', price:1500, treatment:'VATABLE' };

    /* Two VATable lines, plus one of each treatment the tax profile declares —
       so a seller who has turned zero-rating on can see what that does to the
       ladder before their first export goes out. */
    const chosen = [pick(0), pick(1)];
    if (CT.hasExempt){
      const ex = items.find(i => i.treatment === 'EXEMPT');
      if (ex) chosen.push(ex);
    }
    if (CT.hasZero){
      const z = items.find(i => i.treatment === 'ZERO');
      if (z) chosen.push(z);
    }

    const lines = chosen.map((it, n) => ({
      desc: it.desc, sku: it.sku, qty: n === 0 ? 12 : n + 1,
      unit: it.unit, unitPrice: it.price, treatment: it.treatment, scEligible: false
    }));

    return {
      id: '__preview', tenantId: CT.id, branchId: branch ? branch.id : null,
      docType:'INVOICE', docStatus:'ISSUED',
      number: `${CT.seriesPrefix}-${branch ? branch.code : '000'}-${new Date().getFullYear()}-SAMPLE`,
      issuedAt: new Date().toISOString(),
      buyer: { name:'Sample Buyer Corporation', tin:'000-000-000',
               address:'1 Sample Street, Barangay Preview, Makati City 1200' },
      scpwd: null,
      lines, discount: 0, totals: computeTotals(lines, 0, {}),
      currency:'PHP', keycode:'SAMPLE00',
      paymentStatus:'PAID', paymentMethod:'Bank Transfer', terms:null,
      issuedBy: CU.name, issuedVia:'Template preview'
    };
  },

  /** What changed, in words, for the activity log. */
  changes(){
    const saved = InvoiceDoc.config(CT);
    const label = {
      mark:'Document mark', accent:'Accent color', showTradeName:'Show trade name',
      contactLine:'Contact line', showSku:'Show SKU', showQr:'Show QR code',
      footerNote:'Closing note'
    };
    const say = v => v === true ? 'shown' : v === false ? 'hidden' : (String(v).trim() || 'blank');
    return Object.keys(this.draft)
      .filter(k => String(this.draft[k]) !== String(saved[k]))
      .map(k => `${label[k] || k}: ${say(saved[k])} → ${say(this.draft[k])}`);
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function InvoiceTemplate(){
  TemplateReg.begin();

  /* Every control writes into the draft and repaints the sheet. Nothing is
     saved until Apply, so a seller can try a color without committing to it. */
  $(".input_template").off("input change").on("input change", function(){
    const key = $(this).data("key");
    const val = this.type === "checkbox" ? this.checked : $(this).val();
    TemplateReg.draft[key] = val;
    if (key === 'accent') $(".input_template_accent_hex").val(val);
    InvoiceTemplateRender();
  });

  $(".input_template_logo_file").off("change").on("change", function(){
    const file = this.files && this.files[0];
    const input = this;
    if (!file) return;
    if (!/^image\//.test(file.type)){
      UI.toast('Select an image file.', 'warn');
      input.value = '';
      return;
    }
    if (file.size > 200 * 1024){
      UI.toast('Keep the logo under 200 KB.', 'warn');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function(e){
      TemplateReg.draft.logo = String(e.target.result || '');
      $(".input_template_logo_preview").attr('src', TemplateReg.draft.logo);
      $(".tpl-logo-preview, .button_template_logo_remove").removeClass('d-none');
      InvoiceTemplateRender();
    };
    reader.readAsDataURL(file);
  });

  $(".button_template_logo_remove").off("click").on("click", function(){
    TemplateReg.draft.logo = '';
    $(".input_template_logo_file").val('');
    $(".tpl-logo-preview, .button_template_logo_remove").addClass('d-none');
    InvoiceTemplateRender();
  });

  $(".button_template_swatch").off("click").on("click", function(){
    TemplateReg.draft.accent = $(this).data("color");
    $(".input_template[data-key='accent']").val(TemplateReg.draft.accent);
    $(".input_template_accent_hex").val(TemplateReg.draft.accent);
    InvoiceTemplateRender();
  });

  $(".button_template_zoom").off("click").on("click", function(){
    TemplateReg.zoom = parseFloat($(this).data("zoom"));
    $(".button_template_zoom").removeClass("lbtn-primary").addClass("lbtn-ghost");
    $(this).removeClass("lbtn-ghost").addClass("lbtn-primary");
    InvoiceTemplateZoom();
  });

  $(".button_template_reset").off("click").on("click", function(){
    DisplayConfirmSwal("Discard these changes? The template already applied is not affected.",
      function(){
        TemplateReg.begin();
        Nav.go('template');
      }, "", "Discard", false);
  });

  $(".button_template_apply").off("click").on("click", function(){
    if (!TemplateReg.dirty()){ DisplaySwal("info", "", "Nothing has changed."); return; }
    DisplayConfirmSwal(
      "Apply this template to new documents? " +
      "Issued documents keep their original layout.",
      function(){ InvoiceTemplateSave(); },
      "", "Apply", false);
  });

  InvoiceTemplateRender();
}

function InvoiceTemplateRender(){
  $(".div_template_preview").html(
    InvoiceDoc.render(TemplateReg.sample(), { template: TemplateReg.draft })
  );
  $(".button_template_apply").prop("disabled", !TemplateReg.dirty());
  InvoiceTemplateZoom();
}

/** Scales the sheet and shrinks the stage to match, so no dead space is left. */
function InvoiceTemplateZoom(){
  const z = TemplateReg.zoom;
  const $sheet = $(".div_template_preview");
  $sheet.css("transform", `scale(${z})`);
  const h = $sheet.get(0) ? $sheet.get(0).scrollHeight : 0;
  $(".div_template_zoomwrap").css("height", (h * z) + "px");
}

function InvoiceTemplateSave(){
  DisplayLoadingSwal();
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/InvoiceTemplateSave",
    type: "POST",
    dataType: "json",
    data: { template: TemplateReg.draft, changes: TemplateReg.changes() },
    success: function (res) {
      Swal.close();
      if (!res.success){ DisplaySwal("info", "", res.message); return; }
      UI.toast("Template applied", "ok");
      Nav.go('template');
    },
    error: function () {
      Swal.close();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

Screens.template = function () { InvoiceTemplate(); };

/* ============================================================
   Routes
   ============================================================ */

LocalAPI.on("Dashboard/InvoiceTemplateSave", function (p) {
  /* The menu hides this screen from everyone but an owner. The route refuses
     as well, because a hidden button is not a permission check. */
  if (!can('template')){
    return { success:false, message:'Only an owner can change the document face.' };
  }

  const db = Store.db;
  const t = db.tenants.find(x => x.id === CT.id);
  if (!t) return { success:false, message:'Account not found.' };

  const clean = {};
  Object.keys(InvoiceDoc.DEFAULTS).forEach(k => {
    let v = p.template[k];
    if (typeof InvoiceDoc.DEFAULTS[k] === 'boolean') v = (v === true || v === 'true');
    else v = String(v === undefined || v === null ? '' : v).trim();
    clean[k] = v;
  });

  /* A mark longer than three characters overruns its box on a printed sheet,
     and the sheet is the thing that has to be right. */
  clean.mark = String(clean.mark).slice(0, 3).toUpperCase();
  if (!/^#[0-9a-fA-F]{6}$/.test(clean.accent)) clean.accent = InvoiceDoc.DEFAULTS.accent;
  clean.footerNote  = String(clean.footerNote).slice(0, 160);
  clean.contactLine = String(clean.contactLine).slice(0, 120);

  t.template = clean;

  logActivity(db, {
    action: 'Invoice template applied: ' +
            ([].concat(p.changes || []).join('; ') || 'no visible change')
  });
  Store.save(db);
  refreshSession();

  return { success:true };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  template(){
    const cfg = TemplateReg.draft || InvoiceDoc.config(CT);

    const check = (key, label, note) => `
      <div class="form-check mb-2">
        <input class="form-check-input input_template" type="checkbox" data-key="${key}"
               id="tpl_${key}" ${cfg[key] ? 'checked' : ''}>
        <label class="form-check-label fs_13 text-dark" for="tpl_${key}">${label}</label>
        <div class="fs_11 text-muted">${note}</div>
      </div>`;

    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Invoice Template</h1>
          <div class="screen_sub">
            How your invoices look. Changes apply to new invoices only. Issued invoices keep their original layout.
          </div>
        </div>
      </div>

      <div class="row g-3">

        <!-- ---------- Controls ---------- -->
        <div class="col-12 col-xl-5">
          <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">

            <strong class="fs_13 text-secondary fw-bold">MASTHEAD</strong>

            <div class="row g-2">
              <div class="col-5">
                <span class="fs_12 text-muted">Mark</span>
                <input type="text" maxlength="3"
                       class="form-control form-control-sm text-uppercase input_template"
                       data-key="mark" value="${esc(cfg.mark)}">
                <div class="fs_11 text-muted mt-1">Up to three characters.</div>
              </div>
              <div class="col-7">
                <span class="fs_12 text-muted">Accent color</span>
                <div class="d-flex align-items-center gap-1">
                  <input type="color" class="form-control form-control-sm tpl-swatch input_template"
                         data-key="accent" value="${esc(cfg.accent)}">
                  <input type="text" readonly value="${esc(cfg.accent)}"
                         class="form-control form-control-sm fs_12 mono input_template_accent_hex">
                </div>
                <div class="d-flex gap-1 mt-2">
                  ${TemplateReg.SWATCHES.map(c => `
                    <button type="button" class="tpl-swatch button_template_swatch"
                            data-color="${c}" style="background:${c};" title="${c}"></button>`).join('')}
                </div>
              </div>
            </div>

            <div>
              <span class="fs_12 text-muted">Company logo</span>
              <div class="d-flex align-items-center gap-2">
                <div class="tpl-logo-preview ${cfg.logo ? '' : 'd-none'}">
                  <img src="${esc(cfg.logo || '')}" alt="" class="input_template_logo_preview">
                </div>
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                       class="form-control form-control-sm input_template_logo_file">
                <button type="button"
                        class="lbtn lbtn-sm lbtn-ghost button_template_logo_remove ${cfg.logo ? '' : 'd-none'}"
                        title="Remove logo">
                  <i class="bi bi-x-lg"></i>
                </button>
              </div>
              <div class="fs_11 text-muted mt-1">
                Optional. Replaces the mark above on the invoice. PNG, JPEG, SVG or WEBP, under 200 KB.
              </div>
            </div>

            <div>
              <span class="fs_12 text-muted">Contact line</span>
              <input type="text" maxlength="120" class="form-control form-control-sm input_template"
                     data-key="contactLine" value="${esc(cfg.contactLine)}"
                     placeholder="Telephone, email or website">
              <div class="fs_11 text-muted mt-1">
                Shown under the branch address. Optional, and not a substitute for it.
              </div>
            </div>

            <div class="hr_gray_200"></div>
            <strong class="fs_13 text-secondary fw-bold">WHAT TO SHOW</strong>

            ${check('showTradeName', 'Trade name',
                    'Your registered name always appears. This adds “trading as” beneath it.')}
            ${check('showSku', 'SKU under each line',
                    'Useful when the buyer reconciles against a purchase order.')}
            ${check('showQr', 'QR code',
                    'Optional. Buyers scan it to check the invoice.')}

            <div>
              <span class="fs_12 text-muted">Closing note</span>
              <textarea maxlength="160" rows="2" class="form-control form-control-sm fs_12 input_template"
                        data-key="footerNote"
                        placeholder="Thank you for your business.">${esc(cfg.footerNote)}</textarea>
              <div class="fs_11 text-muted mt-1">
                Sits above the statutory notice, never in place of it.
              </div>
            </div>

            <div class="hr_gray_200"></div>
            <div class="d-flex gap-2">
              <button class="lbtn lbtn-accent fs_13 fw-bold flex-grow-1 button_template_apply" disabled>
                Apply template
              </button>
              <button class="lbtn lbtn-ghost fs_13 button_template_reset">Discard</button>
            </div>
          </div></div>

          <!-- ---------- What cannot change ---------- -->
          <div class="lcard mt-3"><div class="lcard-body d-flex flex-column gap-2">
            <div>
              <strong class="fs_13 text-secondary fw-bold">ALWAYS ON THE INVOICE</strong>
              <div class="fs_12 text-muted">
                These fields cannot be changed. An invoice without them is not valid.
              </div>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-borderless table-striped fs_12 mb-0">
                <tbody>
                  ${InvoiceDoc.LOCKED.map(([what, why]) => `
                    <tr>
                      <td class="fw-semibold text-dark" style="width:44%;">
                        <i class="bi bi-lock-fill text-muted me-1"></i>${esc(what)}
                      </td>
                      <td class="text-muted">${esc(why)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div></div>
        </div>

        <!-- ---------- Preview ---------- -->
        <div class="col-12 col-xl-7">
          <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">
            <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div>
                <strong class="fs_13 text-secondary fw-bold">PREVIEW</strong>
                <div class="fs_11 text-muted">
                  Preview with your branch, items and a sample buyer. The invoice number is SAMPLE.
                </div>
              </div>
              <div class="d-flex gap-1">
                ${TemplateReg.ZOOMS.map(z => `
                  <button class="lbtn lbtn-sm ${z === TemplateReg.zoom ? 'lbtn-primary' : 'lbtn-ghost'}
                                 fs_12 button_template_zoom" data-zoom="${z}">${Math.round(z*100)}%</button>`).join('')}
              </div>
            </div>

            <div class="tpl-stage">
              <div class="div_template_zoomwrap">
                <div class="tpl-zoom div_template_preview" style="width:800px;"></div>
              </div>
            </div>
          </div></div>
        </div>
      </div>`;
  }
});
