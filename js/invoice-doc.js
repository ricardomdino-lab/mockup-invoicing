/* ============================================================
   invoice-doc.js — the electronic document face

   One renderer, used by the detail view, the print sheet and the
   issue-form preview. Field selection follows Sec. 237 of the Tax
   Code as amended by RA 11976, with the VAT presentation required
   by RMC 77-2024.

   Deliberately absent: "valid for five (5) years from the date of
   issuance". That was Authority-to-Print validity, which EOPT
   removed. Invoices do not expire.
   ============================================================ */

const InvoiceDoc = {

  /* ============================================================
     What a taxpayer may restyle, and what they may not.

     The face carries both lists because the face is what they describe. A
     template screen that owned its own idea of the document would drift from
     the renderer the first time either changed.
     ============================================================ */

  /** The settings a taxpayer may change. Anything absent falls back to these. */
  DEFAULTS: {
    mark:          '',        // blank means "use the series prefix"
    logo:          '',        // optional data URI; takes over from the mark when set
    accent:        '#274a7a',
    showTradeName: true,
    contactLine:   '',
    showSku:       true,
    showQr:        true,
    footerNote:    ''
  },

  /**
   * The parts that cannot be switched off, each with the reason.
   *
   * This is the substance of the template screen. Everything a seller wants to
   * do to an invoice — logo, color, a thank-you line — is cosmetic, and every
   * cosmetic thing is allowed. What is not allowed is removing a particular
   * required by Sec. 237 as amended by RA 11976, because a document missing one
   * is not a deficient invoice, it is not an invoice.
   */
  LOCKED: [
    ['Registered name and business style', 'The name registered with the BIR, not a trading name alone.'],
    ['VAT status, TIN and branch code',    'Shows which registered branch issued the invoice, and that the seller is VAT-registered.'],
    ['Registered address',                 'The address where the invoice is used.'],
    ['Title and invoice number',           'The word Invoice, and the number that lets the BIR find the invoice and check the numbering.'],
    ['Date and time of issuance',          'Decides the taxable period the sale falls in.'],
    ['Buyer name, TIN and address',        'Required above the BIR threshold. The buyer uses it for their own claim.'],
    ['The VAT breakdown and discounts',    'VATable, VAT, exempt and zero-rated sales and any statutory discount are shown separately, never as one figure.'],
    ['Senior citizen, PWD and similar ID', 'The ID number and signature spaces for statutory discounts.'],
    ['Permit, series and system details',  'The Permit to Issue number, approved series, date of issuance and the approved invoicing system.'],
    ['QR code',                            'Lets a buyer check the invoice against EPI records by scanning it, without signing in.'],
    ['Electronic issuance notice',         'The BIR notice that the invoice is valid without a signature.']
  ],

  /** A tenant's settings, defaults filled in. */
  config(t){
    const cfg = Object.assign({}, this.DEFAULTS, (t && t.template) || {});
    if (!cfg.mark) cfg.mark = (t && t.seriesPrefix || 'EI').slice(0, 3);
    return cfg;
  },

  /** Reason codes for a cancellation, used by the corrections screen. */
  REASONS: {
    DUPLICATE:      'Duplicate invoice',
    DATA_ERROR:     'Data entry error',
    WRONG_BUYER:    'Wrong buyer details',
    CANCELLED_SALE: 'Sale cancelled before delivery'
  },

  /**
   * Render the document face. One form for every invoice in the system: EPI's own Service Invoice
   * (seller EPI, buyer a client) and every client's Invoice (seller the taxpayer, buyer the customer).
   * RR 7-2024 Sec. 6(B), RMC 98-2026. A printed copy after the first carries REPRINT (Sec. 6(B)(21)).
   * @param inv   the document record
   * @param opts  { print:boolean, reprint:boolean, template:object }
   */
  render(inv, opts){
    opts = opts || {};
    const db = Store.db, T = SYSTEM.taxpayer, tot = inv.totals;
    const prov = !!inv.providerBilling;
    const epi = db.tenants.find(x => x.id === 't_epi') || {};
    /* EPI's own invoices to its clients: the seller is EPI, the client is the buyer. */
    const t = prov
      ? { name:SYSTEM.vendor, tradeName:null, address:T.address, tin:T.tin, vatStatus:T.vatStatus, seriesPrefix:'EPI', template:null,
          pti:epi.pti, ptiIssuedAt:epi.ptiIssuedAt, goLiveAt:epi.goLiveAt }
      : db.tenants.find(x => x.id === inv.tenantId);
    const b = prov ? null : db.branches.find(x => x.id === inv.branchId);
    /* opts.template lets the template screen preview an unsaved change without writing it first. */
    const cfg = opts.template || this.config(t);
    const own = !prov && issuesOnOwnSystem(t);
    const isCancelled = inv.docStatus === 'CANCELLED';
    const buyer = displayBuyer(inv), walkIn = !buyer.tin;
    const mdy = iso => iso ? new Date(iso).toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric', timeZone:'Asia/Manila' }) : '';
    const pad = n => String(n).padStart(T.series.digits, '0');
    const tinLine = `${t.vatStatus === 'VAT' ? 'VAT Reg. TIN' : 'Non-VAT Reg. TIN'}: ${t.tin}-${String(b ? b.code : '000').padStart(5, '0')}`;
    const kindLabel = prov ? 'SERVICE INVOICE' : 'INVOICE';

    /* ---------- Seller ---------- */
    const mark = prov ? '<img src="img/epi-logo.png" alt="">'
      : cfg.logo ? `<img src="${esc(cfg.logo)}" alt="">`
      : `<div class="si-mark" style="background:${esc(cfg.accent)};">${esc(cfg.mark)}</div>`;
    const seller = `
      <div class="si-co">${mark}
        <div><div class="si-name">${esc(t.name).toUpperCase()}</div>
          ${cfg.showTradeName && t.tradeName && t.tradeName !== t.name ? `<div>trading as ${esc(t.tradeName)}</div>` : ''}
          <div>${esc(tinLine)}</div>
          <div>${esc(b ? b.address : t.address)}</div>
          ${cfg.contactLine ? `<div>${esc(cfg.contactLine)}</div>` : ''}</div></div>`;

    /* Sale-type stamps required on the face when separate treatments are present */
    const stamps = [];
    if (tot.hasExempt) stamps.push('VAT-EXEMPT SALE');
    if (tot.hasZero)   stamps.push('ZERO-RATED SALE');

    /* ---------- Lines ---------- */
    const special = inv.scpwd ? SPECIAL_BUYERS[inv.scpwd.type] : null;
    const lines = (inv.lines || []).map(l => {
      const amt = round2((Number(l.qty) || 0) * (Number(l.unitPrice) || 0));
      const tags = [];
      /* A covered SC/PWD line is sold VAT-exempt whatever its catalog treatment, so the face says so. */
      const soldExempt = l.treatment === 'EXEMPT' || (special && special.vatExempt && l.scEligible && l.treatment !== 'ZERO');
      if (soldExempt)               tags.push('<span class="doc-tag doc-tag-x">VAT-EXEMPT</span>');
      if (l.treatment === 'ZERO')   tags.push('<span class="doc-tag doc-tag-z">ZERO-RATED</span>');
      if (special && l.scEligible)  tags.push(`<span class="doc-tag doc-tag-s">${esc(special.short.toUpperCase())}</span>`);
      return `
      <div class="si-l"><div class="si-d">${esc(l.desc)}${tags.length ? `<div class="doc-tags">${tags.join('')}</div>` : ''}${cfg.showSku && l.sku ? `<div class="doc-sku mono">${esc(l.sku)}</div>` : ''}</div>
        <div class="si-q">${num(l.qty, Number.isInteger(Number(l.qty)) ? 0 : 2)}${l.unit ? ' ' + esc(l.unit) : ''}</div>
        <div class="si-u">${num(l.unitPrice)}</div><div class="si-a">${num(amt)}</div></div>`;
    }).join('');

    /* ---------- Totals ----------
       Total sales (VAT inclusive) - VAT - discounts + VAT added = total due. The 12% VAT exemption of an SC/PWD
       sale is the gap between gross, the trade and athlete discounts, and the net sales the totals work out. */
    const sum = (label, v, cls, note) => `<div class="si-r ${cls || ''}"><span>${label}${note ? `<small>${note}</small>` : ''}</span><span class="n">${v === null ? '' : num(v)}</span></div>`;
    const hasWht = tot.hasEwt;
    const scVat = round2(Math.max(0, tot.gross - tot.discount - tot.netSales));
    const lessVat = round2(tot.vat + scVat);
    const discAll = round2(tot.discount + (tot.scDiscount || 0));
    const due = hasWht ? tot.netCollectible : tot.totalDue;

    /* ---------- Foot ---------- */
    const seriesYear = new Date(inv.issuedAt).getFullYear(), bc = b ? b.code : '000';
    const series = prov ? `${pad(T.series.from)}-${pad(T.series.to)}`
      : own ? '' : `<span class="nw">${esc(formatSeriesNumber(t.seriesPrefix, bc, seriesYear, 1))}</span> to <span class="nw">${esc(formatSeriesNumber(t.seriesPrefix, bc, seriesYear, 999999))}</span>`;
    const ptiDate = t.ptiIssuedAt || (t.goLiveAt ? String(t.goLiveAt).slice(0, 10) : '');
    const payNote = prov && inv.paymentStatus !== 'PAID'
      ? `<strong>How to pay.</strong> Bank transfer to ${esc(EPI_PAYMENT.bank.bank)}, ${esc(EPI_PAYMENT.bank.name)}, ${esc(EPI_PAYMENT.bank.number)}. GCash ${esc(EPI_PAYMENT.GCASH.number)}. Maya ${esc(EPI_PAYMENT.MAYA.number)}. Use ${esc(inv.number)} as the reference. Due ${esc(fmtDate(inv.dueAt))}. A late payment may carry 1% a month on the unpaid amount.` : '';
    const mr = manualFor(inv);
    const notes = [
      inv.queuedRef ? `Queued as ${esc(inv.queuedRef.ref)} during interruption${inv.queuedRef.interruptionId && interruptionById(inv.queuedRef.interruptionId) ? ` ${esc(interruptionById(inv.queuedRef.interruptionId).ref)}` : ''}. Issued on ${esc(fmtDate(inv.recordedAt))}.` : '',
      mr ? `Manually issued as ${esc(mr.no)} on ${esc(fmtDate(mr.issuedAt))}${mr.interruptionId && interruptionById(mr.interruptionId) ? ` (${esc(interruptionById(mr.interruptionId).ref)})` : ''}.` : '',
      `Issued by ${esc(inv.issuedBy || '—')}${inv.issuedVia ? ' · ' + esc(inv.issuedVia) : ''}${prov ? '' : ' for and on behalf of ' + esc(t.name)}`
    ].filter(Boolean);

    return `
      <article class="doc invform${opts.print ? ' doc-print' : ''}${isCancelled ? ' doc-cancelled' : ''}">
        ${isCancelled ? '<div class="doc-watermark">CANCELLED</div>' : ''}
        <header class="si-head">
          ${seller}
          <div class="si-title"><div class="si-reprint">${opts.reprint ? 'REPRINT' : ''}</div>
            <div class="si-kind">${kindLabel}</div><div class="si-no mono">No. ${esc(inv.number)}</div>
            ${stamps.length ? `<div class="si-stamp">${stamps.join(' · ')}</div>` : ''}</div>
        </header>
        <div class="si-ref"><span>Transaction Reference Number (TRN): <b class="mono">${esc(inv.transmissionRef || '')}</b></span>
          <span>${prov ? 'For ' + esc(BillingReg.label(inv.period)) : 'Branch: ' + esc(b ? `${b.name} (${b.code})` : '—')}</span>
          <span>Date &amp; Time: ${esc(fmtDate(inv.issuedAt))} ${esc(fmtTime(inv.issuedAt))}</span></div>
        <div class="si-cols">
          <div class="si-left">
            <div class="si-box si-sold"><h3>SOLD TO</h3>
              <div>Registered Name: <b>${esc(buyer.name || 'Walk-in Customer')}</b></div>
              <div>TIN: <b class="mono">${walkIn ? 'N/A' : esc(buyer.tin)}</b></div>
              <div>Business Address: <b>${esc(buyer.address || (prov ? '' : 'Not provided'))}</b></div>
              ${inv.scpwd && (inv.scpwd.name || inv.scpwd.children) ? `<div class="si-sc">${esc(inv.scpwd.type)}${inv.scpwd.name ? ' · Cardholder: ' + esc(inv.scpwd.name) : ''}${inv.scpwd.children ? ' · Child: ' + esc(inv.scpwd.children) + (inv.scpwd.rxShown ? ' (prescription shown)' : '') : ''}</div>` : ''}</div>
            <div class="si-box si-items">
              <div class="si-ih"><div>Item Description/Nature of Service</div><div>Quantity</div><div>Unit Price</div><div>Amount</div></div>
              <div class="si-ib"><i class="vl vl1"></i><i class="vl vl2"></i><i class="vl vl3"></i>${lines}</div>
              <div class="si-tot"><span>Total</span><span class="n">${num(tot.gross)}</span></div>
              <div class="si-tot"><span>Mode of Payment: ${esc(inv.paymentMethod || inv.terms || 'Cash')}${inv.paymentStatus && !prov ? ' · ' + esc({ PAID:'Paid', PARTIAL:'Partially paid', UNPAID:'Unpaid' }[inv.paymentStatus] || inv.paymentStatus) : ''}</span></div>
            </div>
          </div>
          <div class="si-right">
            <div class="si-box si-rb">
              ${sum('Total Sales', tot.gross, '', '(VAT inclusive)')}
              ${sum('Less: VAT', lessVat)}
              ${sum('Amount : Net of VAT', round2(tot.gross - lessVat))}
              ${sum('Less: Discount', discAll, '', '(SC, PWD, Athlete or Coach, Medal of Valor, Solo Parent)')}
              ${sum('Add: VAT', tot.vat)}
              ${sum('Less: Withholding Tax', hasWht ? tot.ewtAmount : 0)}
              ${sum('TOTAL AMOUNT DUE', due, 'big')}
            </div>
            <div class="si-box si-rb si-sm"><div class="si-cap">DISCOUNT BREAKDOWN <span>(if applicable)</span></div>
              ${sum('20% or 5% discount', tot.scpwdApplied ? tot.scDiscount : null, 'sub')}
              ${sum('12% VAT exemption', tot.scpwdApplied ? scVat : null, 'sub')}
              ${sum('Other statutory discount', tot.athleteDiscount > 0 ? tot.athleteDiscount : null, 'sub')}</div>
            <div class="si-box si-rb">
              ${sum('VATable Sales', tot.vatableSales)}${sum('VAT', tot.vat)}${sum('Zero-Rated Sales', tot.zero)}${sum('VAT-Exempt Sales', tot.exempt)}
            </div>
            <div class="si-id"><span>Senior Citizen / PWD / Athlete or Coach / Medal of Valor / Solo Parent ID No.:</span><i class="mono">${inv.scpwd ? esc(inv.scpwd.id) : ''}</i></div>
            <div class="si-id"><span>Senior Citizen / PWD / Athlete or Coach / Medal of Valor / Solo Parent Signature:</span><i></i></div>
          </div>
        </div>
        <footer class="si-foot">
          <div class="si-f1">BIR Permit to Issue (PTI) Electronic Invoice No.: <b>${esc(t.pti || 'Not yet issued')}</b><br>
            ${series ? `Approved Invoice Series: ${prov ? esc(series) : series}<br>` : ''}
            Date of Issuance: ${esc(mdy(ptiDate))}<br>
            ${own ? `Reported through: ${esc(SYSTEM.product)} (sales-data transmission only)` : `Approved Invoicing System: ${esc(SYSTEM.product)} (DIS) v${esc(SYSTEM.version)}`}<br>
            BIR ESP Accreditation No.: ${esc(SYSTEM.certificates.esp.no)}</div>
          <div class="si-f2">BIR ESP Provider:<br><b>${esc(SYSTEM.vendor.toUpperCase())}</b><br>${esc(`VAT Reg. TIN: ${T.tin}-00000`)}<br>${esc(T.address)}</div>
          <div class="si-f3">${cfg.showQr ? `<div class="si-qr">${qrSvg(verifyUrl(inv), 96)}</div>` : ''}
            <div><div class="si-n mono">No. ${esc(inv.number)}</div>
              <div class="si-t">To view/verify this Digitized Invoice, please scan this QR Code.</div></div></div>
        </footer>
        ${payNote ? `<div class="doc-note-foot">${payNote}</div>` : ''}
        ${notes.map(n => `<div class="si-meta">${n}</div>`).join('')}
        ${cfg.footerNote ? `<div class="doc-note-foot">${esc(cfg.footerNote)}</div>` : ''}
        <div class="si-legal">Issued electronically under RR No. 11-2025, as amended by RR No. 26-2025. Valid without a signature.</div>
      </article>`;
  },

  /**
   * Print the document.
   *
   * Rendered into a hidden same-document iframe rather than a new window:
   * pop-up blockers stop window.open silently in plenty of browsers, and this
   * mockup is opened straight from the filesystem where that is likelier still.
   * <base> keeps the relative stylesheet paths resolving.
   */
  print(invId){
    const inv = Store.db.invoices.find(i => i.id === invId) || BillingReg.all(Store.db).find(i => i.id === invId);
    if (!inv) return;
    /* The first printed copy is the original. Every later one is a REPRINT (RR 7-2024 Sec. 6(B)(21)). */
    const reprint = (inv.printCount || 0) > 0;
    inv.printCount = (inv.printCount || 0) + 1;

    const old = document.getElementById('print-frame');
    if (old) old.remove();

    const f = document.createElement('iframe');
    f.id = 'print-frame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
    document.body.appendChild(f);

    const doc = f.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <base href="${location.href.split('#')[0]}">
      <title>${esc(inv.number)}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap">
      <link rel="stylesheet" href="css/main.css">
      <link rel="stylesheet" href="css/components.css">
      <link rel="stylesheet" href="css/invoice.css">
      <style>@page{size:landscape;margin:8mm}</style>
      </head><body style="background:#fff;padding:0;">
      ${this.render(inv, { print:true, reprint })}</body></html>`);
    doc.close();

    /* Give the stylesheets a moment to land, or the sheet prints unstyled */
    setTimeout(() => {
      try{ f.contentWindow.focus(); f.contentWindow.print(); }
      catch(e){ UI.toast('Printing is not available in this browser', 'warn'); }
    }, 350);

    logActivity(Store.db, { action:`Printed ${DOC_KIND[inv.docType].short.toLowerCase()} ${inv.number}` });
    Store.save(Store.db);
  }
};
