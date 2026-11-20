/* ============================================================
   import.js — Bulk Import

   For accounts whose sales reach us as a file rather than as a live post.
   One row per line item, grouped into documents by a reference the sender
   controls. Only visible to accounts that hold the BULK connection method —
   see the `conn` gate in navigation.js.

   Three rules, and each one is here for a reason worth stating.

     - All or nothing. If any document in the file is rejected, none of the
       file is written. The alternative — import the good rows, quarantine
       the rest — sounds friendlier and is worse: the series has already
       advanced by the time the operator fixes the file, so the corrected
       rows come back carrying numbers issued after documents that describe
       earlier sales. One upload, one outcome.

     - The date on the document is the date of the sale, taken from the
       file. Not the time of upload. What a document is worth depends on
       the period it falls in, and the period is decided by when the sale
       happened, not by when the seller got round to sending us the file.

     - The lag between the two is recorded, never hidden. An invoice is
       required to be issued at the time of the transaction, so a day-end
       upload is late by construction. That is a fact about the account,
       an examiner will ask about it, and a system that quietly papers
       over it is not helping its user.

   Numbers are allocated at commit. A file that fails validation consumes
   nothing, so nothing has to be cancelled afterwards to tidy up.
   ============================================================ */

const ImportReg = {

  COLUMNS: ['ref','issued_at','branch_code','buyer_name','buyer_tin','buyer_address',
            'payment_status','payment_method','terms','description','sku','qty','unit',
            'unit_price','treatment'],

  /* Anything past this is still imported — refusing would leave the sale with
     no invoice at all, which is worse than an invoice that is visibly late —
     but it is called out on screen and written into the log. */
  LATE_HOURS: 24,

  raw: '',
  result: null,
  fileName: '',

  /* ---------- Timestamps ---------- */

  /**
   * "2026-08-14 15:40" and its ISO and seconds-bearing variants, as a local
   * Date. Deliberately strict: a file that writes dates some other way is
   * better rejected with the offending value quoted back than silently read
   * as some other day by Date.parse, which will happily accept almost
   * anything and guess.
   */
  parseStamp(s){
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '').trim());
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    return isNaN(d) ? null : d;
  },

  /** Hours between the sale and now, which is when this file is being read. */
  lagHours(at){ return (Date.now() - new Date(at).getTime()) / 36e5; },

  lagLabel(hours){
    if (hours < 1)  return 'within the hour';
    if (hours < 24) return `${Math.round(hours)}h after the sale`;
    const days = Math.round(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} after the sale`;
  },

  /* ---------- Parsing ---------- */

  parseCsv(text){
    const rows = [];
    let field = '', row = [], inQuote = false;
    for (let i = 0; i < text.length; i++){
      const c = text[i];
      if (inQuote){
        if (c === '"' && text[i+1] === '"'){ field += '"'; i++; }
        else if (c === '"') inQuote = false;
        else field += c;
      } else if (c === '"') inQuote = true;
      else if (c === ','){ row.push(field); field = ''; }
      else if (c === '\n'){ row.push(field); rows.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field.length || row.length){ row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  },

  /* ---------- Validation ---------- */

  validate(raw){
    const rows = this.parseCsv(raw || '');
    if (!rows.length) return { fatal:'The file is empty.' };

    const header = rows[0].map(h => h.trim().toLowerCase());
    const missing = this.COLUMNS.filter(c => header.indexOf(c) === -1);
    if (missing.length){
      return { fatal:`Missing column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.` };
    }

    const idx = {};
    this.COLUMNS.forEach(c => idx[c] = header.indexOf(c));
    const branches = Auth.visibleBranches();
    const goLive = CT.goLiveAt ? new Date(CT.goLiveAt) : null;
    const future = Date.now() + 5 * 60000;     // a little tolerance for clock skew
    const groups = {};

    rows.slice(1).forEach((r, n) => {
      const g = (r[idx.ref] || '').trim();
      const lineNo = n + 2;                     // 1-based, header counted
      const errs = [];

      const branch = branches.find(b => b.code === (r[idx.branch_code] || '').trim());
      const qty    = Number(r[idx.qty]);
      const price  = Number(r[idx.unit_price]);
      const treat  = (r[idx.treatment] || 'VATABLE').trim().toUpperCase();
      const tin    = (r[idx.buyer_tin] || '').trim();
      const rawAt  = (r[idx.issued_at] || '').trim();
      const at     = this.parseStamp(rawAt);

      if (!g) errs.push('ref is blank: rows cannot be grouped into an invoice');

      if (!rawAt) errs.push('issued_at is required: the invoice takes the date of the sale');
      else if (!at) errs.push(`issued_at "${rawAt}" is not YYYY-MM-DD HH:MM`);
      else if (at.getTime() > future)
        errs.push(`issued_at "${rawAt}" is a future date`);
      else if (goLive && at < goLive)
        errs.push(`issued_at "${rawAt}" is before this account was activated on ${fmtDate(CT.goLiveAt)}`);

      if (!branch) errs.push(`branch_code "${(r[idx.branch_code]||'').trim()}" is not a branch you can issue from`);
      if (!(r[idx.buyer_name] || '').trim()) errs.push('buyer_name is required');
      if (tin && !/^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/.test(tin)) errs.push(`buyer_tin "${tin}" is not a valid TIN`);
      if (!(r[idx.description] || '').trim()) errs.push('description is required');
      if (!Number.isFinite(qty) || qty <= 0) errs.push(`qty "${r[idx.qty]}" must be greater than zero`);
      if (!Number.isFinite(price) || price <= 0) errs.push(`unit_price "${r[idx.unit_price]}" must be greater than zero`);
      if (!TREATMENT[treat]) errs.push(`treatment "${treat}" is not VATABLE, EXEMPT or ZERO`);
      if (treat === 'EXEMPT' && !CT.hasExempt)
        errs.push('tax profile does not declare VAT-exempt sales. Confirm the tax profile again before importing these');
      if (treat === 'ZERO' && !CT.hasZero)
        errs.push('tax profile does not declare zero-rated sales. Confirm the tax profile again before importing these');

      const key = g || `__blank_${lineNo}`;
      groups[key] = groups[key] || { ref:g, rows:[], errors:[], warnings:[], branchId:null, header:null };
      groups[key].rows.push({
        lineNo, errs,
        at, rawAt,
        branchId: branch ? branch.id : null,
        branchCode: (r[idx.branch_code] || '').trim(),
        buyer: { name:(r[idx.buyer_name]||'').trim(), tin: tin || null,
                 address:(r[idx.buyer_address]||'').trim() || null },
        paymentStatus: (r[idx.payment_status] || 'PAID').trim().toUpperCase(),
        paymentMethod: (r[idx.payment_method] || '').trim() || null,
        terms: (r[idx.terms] || '').trim() || null,
        line: { desc:(r[idx.description]||'').trim(), sku:(r[idx.sku]||'').trim() || null,
                qty, unit:(r[idx.unit]||'pc').trim(), unitPrice:price, treatment:treat, scEligible:false }
      });
    });

    /* Group-level consistency */
    const list = Object.keys(groups).map(k => {
      const g = groups[k];
      const first = g.rows[0];
      g.branchId = first.branchId;
      g.header = first;

      g.rows.forEach(r => r.errs.forEach(e => g.errors.push(`Row ${r.lineNo}: ${e}`)));

      if (g.rows.some(r => r.branchId !== first.branchId))
        g.errors.push(`Rows under ref "${g.ref}" name different branches. One invoice cannot span branches`);
      if (g.rows.some(r => r.buyer.name !== first.buyer.name))
        g.errors.push(`Rows under ref "${g.ref}" name different buyers`);

      /* One document, one date. Line timestamps inside a sale may differ by
         seconds and that is fine — the document takes the earliest. Spanning
         two calendar days is not fine: the two halves belong to different VAT
         periods and cannot sit on one number. */
      const stamps = g.rows.map(r => r.at).filter(Boolean);
      if (stamps.length){
        g.at = new Date(Math.min.apply(null, stamps.map(d => d.getTime())));
        const days = new Set(stamps.map(d => Reporting.dayOf(d)));
        if (days.size > 1)
          g.errors.push(`Rows under ref "${g.ref}" span ${days.size} dates. One invoice covers one day`);
      }

      if (!g.errors.length){
        g.lines = g.rows.map(r => r.line);
        g.totals = computeTotals(g.lines, 0, {});
        if (g.totals.totalDue <= 0) g.errors.push('Invoice total is zero');
      }

      /* Late is not a rejection. It is a fact about the document, and it goes
         on the record rather than in the way. */
      if (g.at){
        g.lag = ImportReg.lagHours(g.at);
        if (g.lag > ImportReg.LATE_HOURS)
          g.warnings.push(`Issued ${ImportReg.lagLabel(g.lag)} (an invoice is due at the time of the transaction)`);
      }

      g.ok = g.errors.length === 0;
      return g;
    }).sort((a, b) => (a.at && b.at) ? a.at - b.at : 0);

    const accepted = list.filter(g => g.ok);
    const rejected = list.filter(g => !g.ok);

    return {
      groups: list,
      accepted, rejected,
      /* The whole file rides on every document in it being valid. */
      importable: rejected.length === 0 && accepted.length > 0,
      late: accepted.filter(g => g.warnings.length),
      rowCount: rows.length - 1,
      total: accepted.reduce((s, g) => s + g.totals.totalDue, 0),
      at: new Date().toISOString(),
      committed: false
    };
  },

  /* ---------- Sample ---------- */

  sample(faults){
    const db = Store.db;
    const branches = Auth.visibleBranches();
    const code = branches.length ? branches[0].code : '000';
    const alt  = branches.length > 1 ? branches[1].code : code;
    const items = db.items.filter(i => i.tenantId === CT.id);
    const it = n => items[Math.min(n, items.length - 1)] ||
                    { desc:'Item', sku:'SKU', unit:'pc', price:100, treatment:'VATABLE' };

    /* Addresses and product descriptions carry commas, so the sample has to be
       quoted properly — an unquoted one silently shifts every later column. */
    const cell = v => {
      const s = String(v === null || v === undefined ? '' : v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    };
    const row = a => a.map(cell).join(',');
    const lines = [ this.COLUMNS.join(',') ];

    /* Yesterday's trading, uploaded this morning — the ordinary shape of a
       day-end file, and the reason the lag column exists. */
    const stamp = (daysAgo, h, m) => {
      const d = new Date();
      d.setDate(d.getDate() - daysAgo);
      d.setHours(h, m, 0, 0);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` +
             ` ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    };

    const i0 = it(0), i1 = it(1), i2 = it(2);
    lines.push(row(['SO-2026-0912', stamp(1, 9, 24), code, 'Northgate Facilities Management Inc.','221-556-903',
      '8F Northgate Tower, Alabang, Muntinlupa City','UNPAID','','30 days',
      i0.desc, i0.sku, 25, i0.unit, i0.price, i0.treatment]));
    lines.push(row(['SO-2026-0912', stamp(1, 9, 24), code, 'Northgate Facilities Management Inc.','221-556-903',
      '8F Northgate Tower, Alabang, Muntinlupa City','UNPAID','','30 days',
      i1.desc, i1.sku, 4, i1.unit, i1.price, i1.treatment]));
    lines.push(row(['SO-2026-0913', stamp(1, 14, 8), alt, 'Cordillera Trading House','882-441-006',
      'Marcos Highway, Baguio City','PAID','Bank Transfer','',
      i2.desc, i2.sku, 6, i2.unit, i2.price, i2.treatment]));
    lines.push(row(['SO-2026-0914', stamp(1, 17, 45), code, 'Walk-in Customer','',
      '','PAID','Cash','', i0.desc, i0.sku, 2, i0.unit, i0.price, i0.treatment]));

    if (faults){
      /* Four deliberate faults, one of each kind the validator checks, so the
         all-or-nothing refusal can be seen doing its job. */
      lines.push(row(['SO-2026-0915', stamp(1, 10, 2), '999', 'Unknown Branch Trading','114-228-330',
        'Somewhere','PAID','Cash','', i0.desc, i0.sku, 2, i0.unit, i0.price, i0.treatment]));
      lines.push(row(['SO-2026-0916', stamp(1, 11, 30), code, 'Bad TIN Enterprises','12345',
        'Pasig City','PAID','Cash','', i0.desc, i0.sku, 3, i0.unit, i0.price, i0.treatment]));
      lines.push(row(['SO-2026-0917', stamp(1, 12, 15), code, 'Zero Quantity Corp.','551-220-887',
        'Makati City','PAID','Cash','', i0.desc, i0.sku, 0, i0.unit, i0.price, i0.treatment]));
      lines.push(row(['SO-2026-0918', '14/08/2026 10:00', code, 'Wrong Date Format Ltd.','448-102-556',
        'Cebu City','PAID','Cash','', i0.desc, i0.sku, 1, i0.unit, i0.price, i0.treatment]));
    }

    return lines.join('\n');
  },

  label(){
    const r = this.result;
    if (!r || r.fatal) return 'No file validated';
    return `${r.rowCount} row${r.rowCount === 1 ? '' : 's'}, ${r.groups.length} invoice${r.groups.length === 1 ? '' : 's'}`;
  }
};

/* ============================================================
   Screen wiring
   ============================================================ */

function BulkImport(){
  ImportReg.raw = '';
  ImportReg.result = null;
  ImportReg.fileName = '';

  $(".input_import_file").off("change").on("change", function(){
    const file = this.files && this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e){
      ImportReg.raw = String(e.target.result || '');
      ImportReg.fileName = file.name;
      $(".textarea_import_raw").val(ImportReg.raw);
      $(".span_import_filename").text(file.name);
      BulkImportValidate();
    };
    reader.onerror = function(){ DisplaySwal("error", "", "That file could not be read."); };
    reader.readAsText(file);
  });

  $(".textarea_import_raw").off("input").on("input", function(){
    ImportReg.raw = $(this).val();
    ImportReg.fileName = '';
    $(".span_import_filename").text('pasted text');
  });

  $(".button_import_sample").off("click").on("click", function(){
    ImportReg.raw = ImportReg.sample($(this).data("faults") === true);
    ImportReg.fileName = $(this).data("faults") === true ? 'sample-with-faults.csv' : 'sample-clean.csv';
    $(".textarea_import_raw").val(ImportReg.raw);
    $(".span_import_filename").text(ImportReg.fileName);
    BulkImportValidate();
  });

  $(".button_import_clear").off("click").on("click", function(){
    ImportReg.raw = ''; ImportReg.result = null; ImportReg.fileName = '';
    $(".textarea_import_raw").val('');
    $(".input_import_file").val('');
    $(".span_import_filename").text('no file');
    BulkImportRender(null);
  });

  $(".button_import_validate").off("click").on("click", function(){
    BulkImportValidate();
  });

  $(".button_import_commit").off("click").on("click", function(){
    const r = ImportReg.result;
    if (!r || !r.importable) return;
    DisplayConfirmSwal(
      `Issue ${r.accepted.length} invoice${r.accepted.length === 1 ? '' : 's'} totalling ${peso(r.total)}? ` +
      `Invoice numbers are assigned now and cannot be reused.`,
      function(){ BulkImportCommit(); },
      "", "Import", false);
  });

  BulkImportRender(null);
}

/* A determinate bar rather than a spinner-then-dump: it fills as the file is
   actually read, so a large file visibly takes longer than a small one
   instead of both showing the same indefinite spin. */
function ShowImportProgress(label){
  $(".button_import_validate, .button_import_commit").prop("disabled", true);
  $(".div_import_progress").removeClass("d-none").find(".span_import_progress_label").text(label);
  const $bar = $(".div_import_progress .lprogress-bar").css("width", "0%");
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){ $bar.css("width", "85%"); });
  });
}
function HideImportProgress(){
  $(".button_import_validate, .button_import_commit").prop("disabled", false);
  $(".div_import_progress .lprogress-bar").css("width", "100%");
  setTimeout(function(){ $(".div_import_progress").addClass("d-none"); }, 200);
}

function BulkImportValidate(){
  if (!String(ImportReg.raw || '').trim()){
    DisplaySwal("info", "", "Select a file or paste the rows first.");
    return;
  }
  ShowImportProgress('Checking rows…');
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/BulkImportValidate",
    type: "POST",
    dataType: "json",
    data: { raw: ImportReg.raw },
    success: function (res) {
      HideImportProgress();
      ImportReg.result = res.data;
      BulkImportRender(res.data);
    },
    error: function () {
      HideImportProgress();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

function BulkImportCommit(){
  ShowImportProgress('Issuing invoices…');
  $.ajax({
    url: "/Portal/SPIStradcom/Dashboard/BulkImportCommit",
    type: "POST",
    dataType: "json",
    data: {},
    success: function (res) {
      HideImportProgress();
      if (!res.success){ DisplaySwal("info", "", res.message); return; }
      ImportReg.result = res.data;
      BulkImportRender(res.data);
      UI.toast(`${res.data.created.length} invoice${res.data.created.length === 1 ? '' : 's'} issued`, 'ok');
    },
    error: function () {
      HideImportProgress();
      DisplaySwal("error", "", "The request could not be completed. Try again.");
    }
  });
}

/** Paints the three counters, the verdict banner and the results table. */
function BulkImportRender(r){
  const $panel = $(".div_import_results");

  if (!r){
    $panel.addClass("d-none");
    $(".div_import_verdict").html('');
    return;
  }
  $panel.removeClass("d-none");

  if (r.fatal){
    $(".span_import_rows").text('—');
    $(".span_import_docs").text('—');
    $(".span_import_value").text('—');
    $(".div_import_verdict").html(`
      ${Callout('danger', `<strong>File rejected.</strong> ${esc(r.fatal)}
        No documents were imported and no series number was used.`)}`);
    BulkImportTable([]);
    return;
  }

  $(".span_import_rows").text(r.rowCount);
  $(".span_import_docs").text(r.groups.length);
  /* A held file imports nothing, so quoting the value of the part that passed
     would advertise a total that is not going to happen. */
  $(".span_import_value").text(r.importable || r.committed ? peso(r.total) : '—');

  let verdict;
  if (r.committed){
    verdict = `
      ${Callout('ok', `<strong>Imported.</strong> ${r.created.length} invoice${r.created.length === 1 ? '' : 's'}
        issued and queued for transmission. Each carries the date of its sale, not the time of
        this upload.`)}`;
  } else if (r.rejected.length){
    verdict = `
      ${Callout('danger', `<strong>No documents imported.</strong>
        ${r.rejected.length} of ${r.groups.length} invoice${r.groups.length === 1 ? '' : 's'}
        did not pass, so the whole file is held. Correct the rows listed below and upload the file again. No series number has been used.`)}`;
  } else {
    verdict = `
      ${Callout('ok', `<strong>Ready to import.</strong> All ${r.accepted.length}
        invoice${r.accepted.length === 1 ? '' : 's'} passed.
        ${r.late.length
          ? `${r.late.length} ${r.late.length === 1 ? 'is' : 'are'} more than a day
             after the sale. This is recorded on the document and in the activity log.`
          : ''}
        Numbers are allocated when you import, not now.`)}`;
  }
  $(".div_import_verdict").html(verdict);

  $(".button_import_commit")
    .toggleClass("d-none", !r.importable || r.committed)
    .text(`Import ${r.accepted.length} invoice${r.accepted.length === 1 ? '' : 's'}`);

  BulkImportTable((r.groups || []).map((g, n) => {
    const made = r.created && r.created.find(c => c.ref === g.ref);
    const detail = g.errors.concat(g.warnings.map(w => w));
    return {
      index:     n + 1,
      reference: `<span class="mono">${esc(g.ref || '(blank)')}</span>`,
      issued_at: g.at ? `${fmtDate(g.at)} <span class="text-muted">${fmtTime(g.at)}</span>` : '—',
      lag:       g.at
                   ? `<span class="${g.warnings.length ? 'text-danger fw-semibold' : 'text-muted'}">${
                        esc(ImportReg.lagLabel(g.lag))}</span>`
                   : '—',
      buyer:     esc(g.header.buyer.name || '—'),
      lines:     g.rows.length,
      total:     g.ok ? num(g.totals.totalDue) : '—',
      result:    (g.ok
                   ? '<span class="lbadge lbadge-green lbadge-dot">Passed</span>'
                   : '<span class="lbadge lbadge-red lbadge-dot">Rejected</span>') +
                 (detail.length
                   ? `<div class="fs_11 text-muted mt-1">${detail.map(e => `<div>${esc(e)}</div>`).join('')}</div>`
                   : ''),
      number:    made
                   ? `<span class="mono hyperlink" onclick="Nav.go('invoices',{docId:'${made.id}'})">${esc(made.number)}</span>`
                   : '<span class="text-muted fs_11">not allocated</span>',
      sorting:   g.at ? new Date(g.at).toISOString() : ''
    };
  }));
}

function BulkImportTable(data){
  $(".table_bulk_import").addClass("tbl").removeClass("table-hover table-borderless table-striped");
  $(".table_bulk_import").DataTable(StandardTableOpts({
    "language": { "emptyTable": "No data. Validate a file first." },
    "data": data,
    /* Row order, which is already the file in date order — an operator working
       down a list of things to fix wants it to stay where they left it. */
    "order": [[0, "ASC"]],
    "columns": [
      { data: "index" },
      { data: "reference", "orderable": false },
      { data: "issued_at", "orderable": false, className: "mono" },
      { data: "lag",       "orderable": false },
      { data: "buyer",     "orderable": false },
      { data: "lines",     "orderable": false },
      { data: "total",     "orderable": false, "className": "text-end num" },
      { data: "result",    "orderable": false },
      { data: "number",    "orderable": false },
      { data: "sorting",   "visible": false }
    ]
  }));
}

Screens.import = function () { BulkImport(); };

/* ============================================================
   Routes
   ============================================================ */

LocalAPI.on("Dashboard/BulkImportValidate", function (p) {
  const result = ImportReg.validate(p.raw);
  ImportReg.result = result;
  return { success: true, data: result };
});

LocalAPI.on("Dashboard/BulkImportCommit", function () {
  if (outageQueueing())
    return { success:false, message:'EPI service is down. A file cannot be held. Upload it again when service returns, or enter the sales one at a time.' };
  if (issuanceBlock()) return { success:false, message:issuanceBlock() };
  const r = ImportReg.result;
  if (!r || r.fatal)     return { success:false, message:'Validate a file first.' };
  if (r.committed)       return { success:false, message:'This file has already been imported.' };
  if (!r.importable){
    return { success:false, message:
      `${r.rejected.length} invoice${r.rejected.length === 1 ? '' : 's'} in this file did not pass. ` +
      `The file is imported in full or not at all. Correct the errors and upload the file again.` };
  }

  const db = Store.db;
  const created = [];
  const now = new Date().toISOString();

  r.accepted.forEach(g => {
    const number = allocateNumber(db, CT.id, g.branchId, 'INVOICE');
    const h = g.header;
    const inv = {
      id: uid('inv'), tenantId: CT.id, branchId: g.branchId,
      docType:'INVOICE', docStatus:'ISSUED', number,

      /* The document's date is the date of the sale. `recordedAt` is when this
         upload happened and `issueLagHours` is the distance between them —
         both kept, because the first decides the tax period and the second is
         what an examiner asks about. */
      issuedAt: new Date(g.at).toISOString(),
      recordedAt: now,
      issueLagHours: Math.round(g.lag * 10) / 10,

      buyer: h.buyer, scpwd: null,
      lines: g.lines, discount: 0, totals: g.totals,
      currency:'PHP', keycode: keycode(8),
      paymentStatus: ['PAID','PARTIAL','UNPAID'].indexOf(h.paymentStatus) > -1 ? h.paymentStatus : 'PAID',
      paymentMethod: h.paymentMethod, terms: h.terms,
      externalRef: g.ref,
      deliveryStatus: h.buyer.address ? 'DELIVERED' : 'PENDING',
      deliveryAttempts: h.buyer.address ? 1 : 0,
      issuedBy: CU.name,
      issuedVia: 'Bulk import' + (ImportReg.fileName ? `: ${ImportReg.fileName}` : '')
    };
    db.invoices.push(inv);
    settleTransmission(inv);
    created.push({ ref:g.ref, number, total:g.totals.totalDue, id:inv.id, lag:inv.issueLagHours });
  });

  const late = created.filter(c => c.lag > ImportReg.LATE_HOURS);
  logActivity(db, {
    action: `Bulk import: ${created.length} invoice${created.length === 1 ? '' : 's'} issued` +
            (ImportReg.fileName ? ` from ${ImportReg.fileName}` : '') +
            (late.length ? `, ${late.length} more than ${ImportReg.LATE_HOURS}h after the sale` : '')
  });
  Store.save(db);

  r.committed = true;
  r.created = created;
  return { success: true, data: r };
});

/* ============================================================
   Page
   ============================================================ */
Object.assign(Views, {

  import(){
    return `
      <div class="screen_head">
        <div>
          <h1 class="screen_title">Bulk Import</h1>
          <div class="screen_sub">
            Upload a file of sales to issue invoices in bulk. The whole file is validated before any document is issued. If one document fails, none of the file is imported.
          </div>
        </div>
      </div>

      <!-- ---------- Upload ---------- -->
      <div class="lcard"><div class="lcard-body d-flex flex-column gap-3">

        <div class="row align-items-end g-2 fs_12 text-muted">
          <div class="col-12 col-md-5">
            <span>CSV file</span>
            <input type="file" accept=".csv,text/csv,text/plain"
                   class="form-control form-control-sm input_import_file">
          </div>
          <div class="col-12 col-md-4">
            <span class="d-block">Loaded</span>
            <span class="fs_13 fw-semibold text-dark span_import_filename">no file</span>
          </div>
          <div class="col-12 col-md-3 text-md-end">
            <button class="lbtn lbtn-sm lbtn-ghost fs_12 button_import_sample" data-faults="false">
              Sample
            </button>
            <button class="lbtn lbtn-sm lbtn-ghost fs_12 button_import_sample" data-faults="true">
              Sample with faults
            </button>
          </div>
        </div>

        <div>
          <span class="fs_12 text-muted">Or paste the rows</span>
          <textarea class="form-control fs_12 mono textarea_import_raw" rows="6"
                    placeholder="${esc(ImportReg.COLUMNS.join(','))}&#10;..."></textarea>
          <div class="fs_11 text-muted mt-1">
            <strong>Sample with faults</strong> contains an unknown branch, an invalid TIN, a zero quantity and a wrong date format. Use it to test validation.
          </div>
        </div>

        <div class="div_import_progress d-none">
          <div class="d-flex justify-content-between fs_11 text-muted mb-1">
            <span class="span_import_progress_label">Working…</span>
          </div>
          <div class="lprogress"><div class="lprogress-bar" style="width:0%"></div></div>
        </div>

        <div class="text-center">
          <button class="lbtn lbtn-primary fs_13 fw-bold px-5 button_import_validate">
            <i class="bi bi-check2-circle me-1"></i> Validate file
          </button>
          <button class="lbtn lbtn-ghost fs_13 px-4 ms-2 button_import_clear">Clear</button>
        </div>
      </div></div>

      <!-- ---------- Results ---------- -->
      <div class="lcard mt-3 d-none div_import_results"><div class="lcard-body d-flex flex-column gap-3">

        <div class="row align-items-end justify-content-between fs_12 text-muted g-2">
          <div class="col-4 col-lg-3">
            <span class="d-block">Rows read</span>
            <span class="fs_20 fw-bold text-dark span_import_rows">—</span>
          </div>
          <div class="col-4 col-lg-3">
            <span class="d-block">Documents</span>
            <span class="fs_20 fw-bold text-dark span_import_docs">—</span>
          </div>
          <div class="col-4 col-lg-3 text-lg-end">
            <span class="d-block">Value if imported</span>
            <span class="fs_20 fw-bold text-dark span_import_value">—</span>
          </div>
        </div>

        <div class="div_import_verdict"></div>

        <div class="hr_gray_200"></div>
        <div class="table-responsive">
          <table class="table nowrap table_bulk_import">
            <thead>
              <tr>
                <th>NO.</th>
                <th>REFERENCE</th>
                <th>DATE OF SALE</th>
                <th>ISSUED</th>
                <th>BUYER</th>
                <th>LINES</th>
                <th class="text-end">TOTAL</th>
                <th>RESULT</th>
                <th>INVOICE NO.</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="text-center">
          <button class="lbtn lbtn-accent fs_13 fw-bold px-5 d-none button_import_commit">
            Import
          </button>
        </div>
      </div></div>

      <!-- ---------- Format ---------- -->
      <div class="lcard mt-3"><div class="lcard-body d-flex flex-column gap-3">
        <div>
          <strong class="fs_13 text-secondary fw-bold">FILE FORMAT</strong>
          <div class="fs_12 text-muted">
            One row per line item. Rows sharing a <span class="mono">ref</span> become one document.
          </div>
        </div>
        <div class="table-responsive">
          <table class="table table-sm table-borderless table-striped fs_12">
            <thead><tr><th>COLUMN</th><th>REQUIRED</th><th>NOTES</th></tr></thead>
            <tbody>
              <tr><td class="mono">ref</td><td>Yes</td><td>Your own reference. Groups rows into a document.</td></tr>
              <tr><td class="mono">issued_at</td><td>Yes</td>
                  <td><span class="mono">YYYY-MM-DD HH:MM</span> — <strong>when the sale happened</strong>,
                      not when you upload. This is the date the document carries and the period it
                      falls in. Rows sharing a ref must fall on one day.</td></tr>
              <tr><td class="mono">branch_code</td><td>Yes</td><td>Must be a branch you can issue from. One invoice cannot span branches.</td></tr>
              <tr><td class="mono">buyer_name</td><td>Yes</td><td>Registered name, or <span class="mono">Walk-in Customer</span>.</td></tr>
              <tr><td class="mono">buyer_tin</td><td>No</td><td>Pattern <span class="mono">000-000-000</span> with optional branch code.</td></tr>
              <tr><td class="mono">buyer_address</td><td>No</td><td>Absent means no electronic copy is delivered.</td></tr>
              <tr><td class="mono">payment_status</td><td>No</td><td><span class="mono">PAID</span>, <span class="mono">PARTIAL</span> or <span class="mono">UNPAID</span>. Defaults to PAID.</td></tr>
              <tr><td class="mono">payment_method / terms</td><td>No</td><td>Free text.</td></tr>
              <tr><td class="mono">description / sku / unit</td><td>desc only</td><td>SKU and unit are optional.</td></tr>
              <tr><td class="mono">qty / unit_price</td><td>Yes</td><td>Unit price is <strong>VAT inclusive</strong>.</td></tr>
              <tr><td class="mono">treatment</td><td>Yes</td><td><span class="mono">VATABLE</span>, <span class="mono">EXEMPT</span> or <span class="mono">ZERO</span> — must match your attested tax profile.</td></tr>
            </tbody>
          </table>
        </div>

        ${Callout('info', `<strong>An invoice is due at the time of the transaction.</strong>
          A file uploaded at the end of the day is therefore late by construction, and this
          screen does not pretend otherwise: each document keeps the date of its sale, and the
          gap between that and the upload is shown above and written into the activity log.
          Sales more than ${ImportReg.LATE_HOURS} hours old are still imported, because refusing them would leave the sale without an invoice. They are flagged each time.`)}
      </div></div>`;
  }
});
