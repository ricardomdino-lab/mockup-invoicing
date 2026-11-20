/* ============================================================
   transmission.js — Transmission

   The most misunderstood screen in the product, so it says what it is on its
   face rather than assuming anyone knows.

   Two mandates came out of RR 11-2025 and they are not the same thing:

     - Issuance. Live. The deadline is 31 December 2026, and it is what every
       other screen here serves.

     - Electronic sales reporting — transmitting what was issued to the BIR.
       RR 26-2025 conditions it on the BIR establishing a system capable of
       receiving it and issuing separate regulations for it. Neither has
       happened. It is dormant.

   A dormant obligation is not an absent one, and this is the difference the
   screen has to hold. An accredited system has to be able to transmit on the
   day the switch is thrown, and has to be able to show that everything issued
   since go-live is accounted for. So documents carry a transmission state from
   the moment they exist, the queue is real, and the reconciliation is real —
   what is simulated is the endpoint at the far end, because there is not one
   yet to talk to.

   The screen says so plainly. A taxpayer who reads this and concludes they are
   behind on something has been misled by their software, and a taxpayer who
   concludes they will never have to do it has been misled in the more
   expensive direction.

   One rule worth stating because it surprises people: a cancelled document is
   still transmitted if it had already been acknowledged. You cannot un-report
   something the BIR has an acknowledgment number for. The cancellation is what
   gets reported next, not a retraction of the first message.
   ============================================================ */

const TransReg = {

  /* Everything issued has a transmission state. NOT_READY is the resting
     state for a document that will never go — a cancellation that never
     reached the queue in the first place. */
  ACTIONABLE: ['QUEUED', 'FAILED', 'REJECTED'],

  rows(){
    return Auth.visibleInvoices().filter(i => i.docStatus !== 'DRAFT');
  },

  params(){
    return {
      searchval: $(".input_searchval_transmission").val() || "",
      status:    $(".select_status_transmission").val() || "",
      branch:    $(".select_branch_transmission").val() || ""
    };
  },

  apply(p){
    p = p || {};
    const q = String(p.searchval || '').trim().toLowerCase();
    return this.rows().filter(i => {
      if (p.status && i.transmissionStatus !== p.status) return false;
      if (p.branch && p.branch !== 'ALL' && i.branchId !== p.branch) return false;
      if (!q) return true;
      return [i.number, i.transmissionRef, (i.buyer || {}).name]
        .some(v => String(v || '').toLowerCase().indexOf(q) > -1);
    });
  },

  /**
   * The reconciliation, which is the point of the screen.
   *
   * Issued since activation, against what carries an acknowledgment. The gap is
   * the number a taxpayer would be asked to explain, so it is stated as a
   * count and not buried in a status filter.
   */
  reconcile(){
    const all = this.rows();
    const acknowledged = all.filter(i => i.transmissionStatus === 'TRANSMITTED');
    const waiting = all.filter(i => this.ACTIONABLE.indexOf(i.transmissionStatus) > -1);
    const notGoing = all.filter(i => i.transmissionStatus === 'NOT_READY');
    return {
      issued: all.length,
      acknowledged: acknowledged.length,
      waiting: waiting.length,
      notGoing: notGoing.length,
      rejected: all.filter(i => i.transmissionStatus === 'REJECTED').length,
      /* Cancelled but already acknowledged: the case that needs its own
         message rather than looking like an inconsistency. */
            overdue: all.filter(i => limitInfo(i).state === 'OVERDUE').length,
      cancelledAfterAck: all.filter(i =>
        i.docStatus === 'CANCELLED' && i.transmissionStatus === 'TRANSMITTED').length
    };
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function TransmissionScreen() {
  const branches = Auth.visibleBranches().map(b => ({ value:b.id, text:`${b.name} (${b.code})` }));
  DisplaySelect2(branches, ".select_branch_transmission", true, "All branches", "");
  EnhanceSelect(".select_status_transmission");

  let delay;
  $(".input_searchval_transmission").off("input keydown")
    .on("keydown", function (e) {
      if (e.key === "Enter"){ e.preventDefault(); clearTimeout(delay); TransmissionSearch(); }
    })
    .on("input", function () { clearTimeout(delay); delay = setTimeout(TransmissionSearch, 600); })
    .val("");

  $(".select_status_transmission").off("change").on("change", TransmissionSearch);
  $(".select_branch_transmission").off("select2:select select2:clear")
    .on("select2:select select2:clear", TransmissionSearch);
  $(".button_repeat_transmission").off("click").on("click", TransmissionSearch);

  $(".button_transmission_send").off("click").on("click", function () {
    DisplayConfirmSwal(
      `<span class="fw-bold fs_18 text-dark">Send all waiting documents?</span>
       <span class="fs_14 text-muted">Demo only: the BIR has not published a system to receive documents. The send is simulated.</span>`,
      function () {
        DisplayLoadingSwal();
        $.ajax({
          url: "/Portal/SPIStradcom/Dashboard/TransmissionSendAll",
          method: "POST",
          success: function (res) {
            Swal.close();
            DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
            TransmissionSearch();
          }
        });
      }, null, 'Send');
  });

  TransmissionSearch();
}

function TransmissionSearch() {
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/TransmissionSearch",
    method: "POST",
    dataType: "json",
    data: TransReg.params(),
    success: function (res) {
      if (!res.success) return;
      TransmissionTotals(res.data_1);
      TransmissionTable(res.data_2);
      ResUI.paintTransmission();
    }
  });
}

function TransmissionTotals(t) {
  $(".span_transmission_issued").text(t.issued);
  $(".span_transmission_ack").text(t.acknowledged);
  $(".span_transmission_ack_note").text(t.ackPct + ' of everything issued');
  $(".span_transmission_waiting").text(t.waiting);
  $(".span_transmission_waiting_note")
    .text(t.overdue ? `${t.overdue} past the ${TRANSMIT_LIMIT_DAYS}-day limit` : t.rejected ? `${t.rejected} rejected outright` : 'Waiting or failed')
    .toggleClass('text-danger', !!t.overdue);
  $(".span_transmission_notgoing").text(t.notGoing);
  $(".button_transmission_send").toggleClass("d-none", !t.waiting || !(can('issue') || can('users')));
  $(".div_transmission_cancelled_note").toggleClass("d-none", !t.cancelledAfterAck);
  $(".span_transmission_cancelled_count").text(t.cancelledAfterAck);
}

function TransmissionTable(data) {
  $(".table_transmission").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_transmission").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No invoices match these filters" },
    "data": data,
        "order": [[8, "DESC"]],
    "columns": [
      { data: "number", render: function (d, t, row) {
          return `<span class="hyperlink fw-semibold span_trans_open" data-id="${row.id}">${d}</span>`;
        } },
      { data: "issued_at", "orderable": false, className: "mono" },
      { data: "doc_status", "orderable": false },
      { data: "status", "orderable": false },
            { data: "send_by", "orderable": false },
      { data: "ack", "orderable": false },
      { data: "total", "orderable": false, className: "text-end num" },
      { data: "actions", "orderable": false, className: "text-end" },
      { data: "sorting", "visible": false }
    ]
  }));

  $(document).off("click", ".span_trans_open")
    .on("click", ".span_trans_open", function () {
      Nav.go('invoices', { docId: $(this).data("id") });
    });

  $(document).off("click", ".button_trans_send")
    .on("click", ".button_trans_send", function () {
      const id = $(this).data("id");
      DisplayLoadingSwal();
      $.ajax({
        url: "/Portal/SPIStradcom/Dashboard/TransmissionSend",
        method: "POST",
        data: { invoice_id: id },
        success: function (res) {
          Swal.close();
          DisplayDelaySwal(res.success ? "success" : "info", "", res.message);
          TransmissionSearch();
        }
      });
    });
}

/* ============================================================
   The server side of the screen.
   ============================================================ */

/**
 * Stand in for the endpoint that does not exist yet.
 *
 * Rejection is not random either. A document with no buyer TIN on a sale that
 * needs one is the realistic rejection: a reporting system checks the payload
 * before it acknowledges it, and this is the check every such system has.
 */
function transmissionOutcome(inv) {
  const big = inv.totals && inv.totals.totalDue >= 100000;
  const noTin = !(inv.buyer && inv.buyer.tin);
  if (big && noTin){
    return { ok:false,
             why:'Rejected: a sale of ₱100,000 or more must carry the buyer\'s TIN.' };
  }
  return { ok:true };
}

LocalAPI.on("Dashboard/TransmissionSearch", function (p) {
  const rows = TransReg.apply(p);
  const r = TransReg.reconcile();
  const may = can('issue') || can('users');

  return {
    success: true,
    data_1: Object.assign({}, r, {
      ackPct: r.issued ? Math.round((r.acknowledged / r.issued) * 100) + '%' : '—'
    }),
    data_2: rows.map(i => {
      const st = i.transmissionStatus || 'NOT_READY';
      return {
        id:         i.id,
        number:     esc(i.number),
        issued_at:  fmtDateTime(i.issuedAt),
        doc_status: badge('doc', i.docStatus),
        status:     badge('transmission', st) + (() => {
                      const dl = delayInfo(i);
                      const bits = [];
                      if (dl.attempts > 1 || (dl.attempts === 1 && st !== 'TRANSMITTED')) bits.push(`${dl.attempts} attempt${dl.attempts === 1 ? '' : 's'}`);
                      if (dl.delayed) bits.push(`waited ${ResReg.hLabel(dl.hours)}`);
                      if (dl.label) bits.push(esc(dl.label));
                      return bits.length ? `<div class="fs_11 text-muted mt-1">${bits.join(' · ')}</div>` : '';
                    })(),
                send_by:    (() => { const L = limitInfo(i), d = esc(fmtDate(L.by + 'T12:00:00+08:00'));
                      return L.state === 'NA' ? '<span class="text-muted">—</span>'
                        : L.state === 'OVERDUE' ? `${d} <span class="lbadge lbadge-red">Past the limit</span>`
                        : L.state === 'LATE' ? `${d} <span class="lbadge lbadge-amber">Sent late</span>`
                        : L.state === 'DUE_SOON' ? `${d} <span class="lbadge lbadge-amber">Due soon</span>` : d; })(),
        ack:        i.transmissionRef
                      ? `<span class="mono fs_12">${esc(i.transmissionRef)}</span>`
                      : '<span class="text-muted">—</span>',
        total:      num(i.totals.totalDue),
        actions:    may && TransReg.ACTIONABLE.indexOf(st) > -1
                      ? `<button class="lbtn lbtn-sm lbtn-ghost button_trans_send"
                                 data-id="${i.id}">${st === 'QUEUED' ? 'Send' : 'Send again'}</button>`
                      : '',
        sorting:    i.issuedAt
      };
    })
  };
});

LocalAPI.on("Dashboard/TransmissionSend", function (p) {
  if (transmissionBlock()) return { success:false, message:transmissionBlock() };
  const db = Store.db;
  const inv = Auth.visibleInvoices().find(i => i.id === p.invoice_id);
  if (!inv) return { success:false, message:'That invoice is not available to your role.' };
  if (!can('issue') && !can('users'))
    return { success:false, message:'Your role cannot send invoices to the BIR.' };
  if (TransReg.ACTIONABLE.indexOf(inv.transmissionStatus) === -1)
    return { success:false, message:'That invoice is not waiting to be sent.' };

  const live = db.invoices.find(i => i.id === inv.id);
  const out = attemptTransmission(live);

  logActivity(db, { action: out.ok
    ? `Sent ${live.number}: acknowledged as ${live.transmissionRef}`
    : `Sending ${live.number} to the BIR did not go through: ${out.why}` });
  Store.save(db);
  return out.ok
    ? { success:true, message:`${live.number} acknowledged as ${live.transmissionRef}.` }
    : { success:false, message:out.why };
});

LocalAPI.on("Dashboard/TransmissionSendAll", function () {
  if (transmissionBlock()) return { success:false, message:transmissionBlock() };
  const db = Store.db;
  if (!can('issue') && !can('users'))
    return { success:false, message:'Your role cannot send invoices to the BIR.' };

  const waiting = TransReg.rows()
    .filter(i => TransReg.ACTIONABLE.indexOf(i.transmissionStatus) > -1);
  if (!waiting.length) return { success:false, message:'Nothing is waiting to be sent.' };

  let ok = 0, bad = 0;
  waiting.forEach(w => {
    const live = db.invoices.find(i => i.id === w.id);
    if (attemptTransmission(live).ok) ok++; else bad++;
  });

  logActivity(db, {
    action:`Sent ${waiting.length} invoice(s): ${ok} acknowledged, ${bad} not acknowledged`
  });
  Store.save(db);

  const down = activeInterruption();
  return { success:true,
           message: bad
             ? (down ? `${ok} acknowledged, ${bad} held: ${INTERRUPTION_SOURCES[down.source].label} (${down.ref}). They stay waiting and are tried again when it ends.`
                     : `${ok} acknowledged, ${bad} rejected. The rejected ones stay in the list with the reason.`)
             : `All ${ok} acknowledged.` };
});

/* ============================================================
   Tab body — embedded as the Invoices's second tab (js/invoices.js).
   The wiring functions above stay exactly as the standalone screen used them;
   only the markup's outer chrome changes, since the register's screen_head is
   now shared rather than duplicated per tab.
   ============================================================ */

/* Why a document might sit un-transmitted depends on the taxpayer: sales
   reporting may not apply at all, the taxpayer may issue on its own system, or
   it applies but waits for the BIR. One Callout with a dormancy flag would
   read wrong for two of the three. */
function transmissionStatusCallout(){
  if (!coverage().esr){
    return Callout('info', `<strong>Electronic sales reporting is not in scope for this taxpayer.</strong>
      It is outside the categories in RR 11-2025 Sec. 3(B).
      Documents are still recorded with a transmission state.`, {cls:'mb-3'});
  }

  if (issuesOnOwnSystem()){
    const mode = ESR_MODES[CT && CT.esrMode] || ESR_MODES.ESP_MANAGED;
    return Callout('warn', `<strong>Sales reporting to the BIR has not started.</strong> The BIR has not set up its system or issued the rules yet, so nothing is overdue. ${esc(CT ? CT.name : 'This taxpayer')} issues
      on its own system. This account only sends invoices and checks that the counts agree:
      <strong>${esc(mode.label)}</strong>: ${esc(mode.note)} The BIR system is simulated because it does not exist yet.`, {cls:'mb-3'});
  }

  return Callout('warn', `<strong>Sales reporting to the BIR has not started.</strong> The BIR has not set up its system or issued the rules yet, so nothing is overdue. This screen shows whether each invoice was sent to the BIR and that the issued, acknowledged and waiting counts agree. The BIR system is simulated because it does not exist yet. Acknowledged means the BIR received the invoice.`, {cls:'mb-3'});
}

function TransmissionTabBody(){
    const opt = (v, l) => `<option value="${v}">${l}</option>`;

    return `
      <div class="d-flex justify-content-end mb-2">
        <button class="lbtn lbtn-sm lbtn-primary d-none button_transmission_send">
          <i class="bi bi-cloud-arrow-up me-1"></i> Send everything waiting
        </button>
      </div>

      ${transmissionBlock() ? Callout('danger', `<strong>Sending to the BIR is on hold.</strong> ${esc(transmissionBlock())}`, {cls:'mb-3'}) : ''}
      ${transmissionStatusCallout()}

      <div class="row g-2 mb-2">
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Issued since activation</span>
            <span class="stat-value mono span_transmission_issued">—</span>
            <span class="stat-note">All invoices issued</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Acknowledged</span>
            <span class="stat-value stat-value-positive mono span_transmission_ack">—</span>
            <span class="stat-note span_transmission_ack_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Waiting or failed</span>
            <span class="stat-value mono span_transmission_waiting">—</span>
            <span class="stat-note span_transmission_waiting_note">&nbsp;</span>
          </div></div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="lcard h-100"><div class="lcard-body">
            <span class="stat-label">Rejected, will not be sent</span>
            <span class="stat-value mono span_transmission_notgoing">—</span>
            <span class="stat-note">Cancelled before sending</span>
          </div></div>
        </div>
      </div>

            <div class="div_trans_reconcile mb-3"></div>
      <div class="div_trans_limit"></div>

      ${Callout('info', `<span class="span_transmission_cancelled_count">0</span> invoice(s) here are cancelled but still show as acknowledged. The BIR cannot withdraw an invoice it has already received, so the cancellation is reported separately.`, {cls:'mb-3 d-none div_transmission_cancelled_note'})}

      <div class="lcard mb-3"><div class="lcard-body div_trans_checks"></div></div>
      <div class="lcard mb-3"><div class="lcard-body div_trans_problems"></div></div>
      <div class="lcard mb-3"><div class="lcard-body div_trans_tools"></div></div>

      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">
        <div class="row align-items-end fs_12 text-muted g-2">
          <div class="col-12 col-md-6 col-lg-3">
            <span>Branch</span>
            <select class="form-select form-select-sm select_branch_transmission"></select>
          </div>
          <div class="col-12 col-md-6 col-lg-3">
            <span>Sent to BIR status</span>
            <select class="form-select form-select-sm select_status_transmission">
              ${opt('', 'Any state')}
              ${Object.keys(STATUS.transmission).map(k =>
                opt(k, STATUS.transmission[k].label)).join('')}
            </select>
          </div>
          <div class="col-12 col-md-8 col-lg-4">
            <span>Search</span>
            <div class="input-group input-group-sm">
              <span class="input-group-text bg-white border-end-0 text-muted">
                <i class="bi bi-search"></i>
              </span>
              <input type="text" class="form-control border-start-0 ps-2 input_searchval_transmission"
                     placeholder="Number, acknowledgment or buyer...">
            </div>
          </div>
          <div class="col-12 col-md-4 col-lg-2">
            <button class="lbtn lbtn-sm lbtn-accent w-100 button_repeat_transmission">
              <i class="bi bi-arrow-repeat me-1"></i> Refresh
            </button>
          </div>
        </div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table-hover table-borderless table-striped table_transmission">
            <thead>
              <tr>
                <th>INVOICE</th>
                                <th>DATE AND TIME ISSUED</th>
                <th>STATUS</th>
                <th>SENT TO BIR</th>
                <th>SEND BY</th>
                <th>ACKNOWLEDGMENT</th>
                <th>TOTAL AMOUNT DUE</th>
                <th></th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div></div>`;
}
