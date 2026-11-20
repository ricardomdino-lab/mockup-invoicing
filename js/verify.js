/* ============================================================
   verify.js — public document verification

   The one screen in this system with no account behind it. A buyer is handed
   a document, scans the QR code printed on it, and is told whether we really issued it and whether it still stands.

   Three decisions worth writing down, because each one is a place where the
   obvious build is the wrong one.

     - It answers with a summary, not the document. A code is eight
       characters, and anyone holding a real document number can sit and try
       codes against it. The buyer already has the line items — they are
       holding the copy. What they cannot get anywhere else is confirmation
       that the seller, the date and the total on that copy match what we
       recorded, so that is what this returns. Guessing a code correctly
       therefore buys an attacker a total they would have had to know to be
       looking, rather than a customer's order history.

     - A cancelled document verifies. It does not fail — it comes back
       clearly marked cancelled, with the date. Refusing to answer would let
       a seller cancel a document and leave the buyer unable to tell the
       difference between "withdrawn" and "never existed", which is the exact
       situation verification is for.

     - The seller sees that it happened. A verification is written into the
       account's activity log as an outside action with no name attached: the
       buyer never signed in and we do not know who they are. A seller
       watching a run of failed checks against one number learns something
       worth knowing.

   Attempts are limited per browser. It is a demonstration limit — a real
   deployment throttles at the edge, by address — but the shape is the same
   and the screen says what it is doing.
   ============================================================ */

const Verify = {

  MAX_TRIES: 6,
  COOL_OFF_MS: 60000,

  tries: 0,
  blockedUntil: 0,

  /** prefill: optional { number, code }, e.g. from a scanned invoice QR
      (see verifyUrl() in core.js) landing on ?verify=...&code=.... The scan
      checks at once; there is nothing to type. */
  open(prefill){
    this.tries = 0;
    this.blockedUntil = 0;
    UI.show('view-verify');
    if (prefill && prefill.number){
      document.getElementById('verify-result').innerHTML = '';
      this.check(prefill.number, prefill.code);
    }
  },

  close(){
    UI.show('view-login');
  },

  remaining(){ return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)); },

  check(number, code){
    if (this.remaining()){
      this.paint(Callout('warn', `<strong>Too many attempts.</strong> Try again in ${this.remaining()} seconds.`));
      return;
    }
    number = String(number || '').trim();
    code   = String(code || '').trim();
    if (!number || !code){
      this.paint(Callout('warn', 'This link is incomplete. Scan the QR code printed on the invoice again.'));
      return;
    }

    DisplayLoadingSwal();
    $.ajax({
      url: "/Portal/SPIStradcom/Public/VerifyDocument",
      type: "POST",
      dataType: "json",
      data: { number, code },
      success: res => { Swal.close(); this.render(res); },
      error: () => { Swal.close(); DisplaySwal("error", "", "The request could not be completed. Try again."); }
    });
  },

  paint(html){ document.getElementById('verify-result').innerHTML = html; },

  render(res){
    if (!res.success){
      this.tries++;
      const left = this.MAX_TRIES - this.tries;
      if (left <= 0){
        this.blockedUntil = Date.now() + this.COOL_OFF_MS;
        this.tries = 0;
      }
      this.paint(`
        ${Callout('danger', `<strong>No match.</strong> ${esc(res.message)}
          ${left > 0
            ? `<div class="fs_11 mt-1">${left} attempt${left === 1 ? '' : 's'} left before a short pause.</div>`
            : `<div class="fs_11 mt-1">Further attempts are paused for a minute.</div>`}
          `)}`);
      return;
    }

    this.tries = 0;
    const d = res.data;

    const banner = d.cancelled
      ? Callout('danger', `<strong>This document was cancelled on ${esc(d.cancelledAt)}.</strong>
           It was issued by the seller below. It cannot support a purchase or an input VAT claim. If you were not told it was cancelled, contact the seller.`)
      : Callout('ok', `<strong>This document is valid.</strong>
           It was issued through this system by the seller shown below. Compare the figures with your copy. If they differ, your copy does not match the record.`);

    const rows = [
      ['Seller',            d.seller],
      ['Seller TIN',        d.tin],
      ['Branch',            d.branch],
      ['Document',          d.kind],
      ['Invoice number',   d.number],
      ['Date issued',       d.issuedAt],
      ['Total amount due',  d.total],
      ['Reported to the BIR', d.transmission]
    ];

    this.paint(`
      ${banner}
      <div class="card bg-white p-4 shadow-sm mt-3">
        <table class="table table-sm table-borderless fs_13 mb-0">
          <tbody>
            ${rows.map(([k, v]) => `
              <tr>
                <td class="text-muted" style="width:42%;">${esc(k)}</td>
                <td class="fw-semibold text-dark">${esc(v)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="fs_11 text-muted mt-3">
        Line items are not shown on this page. Compare the details above with your copy.
      </div>`);
  }
};

/* ============================================================
   Route
   ============================================================ */

LocalAPI.on("Public/VerifyDocument", function (p) {
  const db = Store.db;
  const number = String(p.number || '').trim().toUpperCase();
  const code   = String(p.code || '').trim().toUpperCase();

  const inv = (db.invoices || []).find(i => String(i.number).toUpperCase() === number) ||
              BillingReg.all(db).find(i => String(i.number).toUpperCase() === number);

  /* One message for "no such number" and for "wrong code", on purpose. Telling
     the difference would turn this into a way to find out which numbers exist. */
  if (!inv || String(inv.keycode || '').toUpperCase() !== code){
    /* A wrong code against a number that does exist is the case worth showing
       the seller: someone is holding one of their documents, or working
       through codes against it. An unknown number tells us no tenant to log
       it against, so it goes nowhere — there is no one it is about. */
    if (inv){
      logActivity(db, {
        tenantId: inv.tenantId, actorType:'PUBLIC', actorName:'Buyer (not signed in)',
        role:'Not signed in',
        action:`Failed verification of ${inv.number}: wrong code`,
        location:'Not recorded', device:'Not recorded', browser:'', ip:'Not recorded'
      });
      Store.save(db);
    }
    return { success:false,
             message:'The document number and verification code do not match any document issued through this system.' };
  }

  const t = db.tenants.find(x => x.id === inv.tenantId);
  const b = db.branches.find(x => x.id === inv.branchId);
  const kind = DOC_KIND[inv.docType] || DOC_KIND.INVOICE;
  const cancelled = inv.docStatus === 'CANCELLED';

  logActivity(db, {
    tenantId:  inv.tenantId,
    actorType: 'PUBLIC',
    actorName: 'Buyer (not signed in)',
    role:      'Not signed in',
    action:    `Document ${inv.number} verified from the public page`,
    /* We know nothing about who this was, and the log should not imply we do. */
    location:  'Not recorded',
    device:    'Not recorded',
    browser:   '',
    ip:        'Not recorded'
  });
  Store.save(db);

  return {
    success: true,
    data: {
      seller:      inv.providerBilling ? SYSTEM.vendor : (t ? t.name : '—'),
      tin:         inv.providerBilling ? `${SYSTEM.taxpayer.tin}-00000` : (t ? `${t.tin}-${b ? b.code : '000'}` : '—'),
      branch:      b ? `${b.name} (${b.code})` : '—',
      kind:        kind.label,
      number:      inv.number,
      issuedAt:    `${fmtDate(inv.issuedAt)} ${fmtTime(inv.issuedAt)}`,
      total:       peso(inv.totals.totalDue),
      transmission: inv.transmissionStatus === 'TRANSMITTED'
                      ? 'Yes' + (inv.transmissionRef ? ` — ${inv.transmissionRef}` : '')
                      : 'Not yet',
      cancelled,
      cancelledAt: cancelled && inv.cancelledAt ? fmtDate(inv.cancelledAt) : 'an earlier date'
    }
  };
});
