/* ============================================================================
   reporting.js — the shared period engine and the Export to PDF modal.

   Three screens need the same thing: take a set of documents, cut them into
   periods, add up the tax ladder, and put the result on paper. Invoice
   Transactions exports its register, Transmission exports what has and has not
   been acknowledged, and Reports is nothing but this engine with a
   screen in front of it. So it is written once, here.

   The modal and the two entry points (ModalExportToPDF, GenerationOfPDF) keep
   the source portal's names, signatures and markup, so screen code that calls
   them carries over unchanged. What differs is where the PDF comes from: the
   portal posted to the server and got base64 back, and with no server here the
   document is laid out and rendered in the browser instead. The call site does
   not know the difference — the route is answered by LocalAPI, and the reply
   has the same shape the server sent.

   Each screen registers a source describing what it can export:

       Reporting.source("invoice_transactions", {
         title:   "Invoices",
         rows:    ids => [...],        // resolve the ids the screen passed
         columns: () => [ { label, value(row), align } ]
       });

   Load order: after core.js and for_all.js, before the screens that use it.
   ========================================================================== */

const Reporting = {

  /* --- sources ----------------------------------------------------------- */

  sources: {},

  source(name, def){ this.sources[name] = def; return this; },

  get(name){
    const s = this.sources[name];
    if (!s) throw new Error(`[Reporting] no source registered for "${name}"`);
    return s;
  },

  /* --- period vocabulary -------------------------------------------------- */

  PERIODS: {
    daily:        { label:'Daily Summary',      grain:'day'     },
    weekly:       { label:'Weekly Summary',     grain:'week'    },
    monthly:      { label:'Monthly Summary',    grain:'month'   },
    quarterly:    { label:'Quarterly Summary',  grain:'quarter' },
    annual:       { label:'Annual Summary',     grain:'year'    },
    current_data: { label:'Per invoice',       grain:null      }
  },

  /* Local calendar dates as YYYY-MM-DD. Documents are stamped with an ISO
     instant; comparing the date part keeps a document in the day it was issued
     rather than the day UTC happened to be on. */
  ymd(d){
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },

  dayOf(iso){
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? String(iso).slice(0, 10) : this.ymd(d);
  },

  /**
   * The daterangepicker's own output, "MM/DD/YYYY - MM/DD/YYYY", as a pair of
   * calendar dates. Every filter row in the portal carries that widget, so
   * without this each screen would parse the same string its own way.
   * Returns null when nothing has been picked, which reads as "no limit".
   */
  range(value){
    const one = s => {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim());
      return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
    };
    const parts = String(value || '').split('-').map(s => s.trim());
    const from = one(parts[0]);
    if (!from) return null;
    return { from, to: one(parts[1]) || from };
  },

  /**
   * Turn the modal's inputs into a list of period buckets.
   *
   * @param type  a key of PERIODS
   * @param p1/p2 the modal's two parameters, in the format its own widgets
   *              produce: flatpickr "Y-m-d", daterangepicker
   *              "MM/DD/YYYY - MM/DD/YYYY", monthSelect "Y-m", or a year.
   * @returns { label, from, to, buckets:[{ label, from, to }] }  dates inclusive
   */
  periods(type, p1, p2){
    const p = n => String(n).padStart(2, '0');
    const buckets = [];
    let label = '';

    if (type === 'daily'){
      const day = String(p1 || '').slice(0, 10);
      buckets.push({ label: fmtDate(day + 'T00:00:00'), from: day, to: day });
      label = fmtDate(day + 'T00:00:00');
    }

    else if (type === 'weekly'){
      /* daterangepicker hands back "MM/DD/YYYY - MM/DD/YYYY". */
      const parts = String(p1 || '').split('-').map(s => s.trim());
      const parse = s => {
        const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
        return m ? new Date(+m[3], +m[1] - 1, +m[2]) : null;
      };
      const start = parse(parts[0]), end = parse(parts[1]) || parse(parts[0]);
      if (!start || !end) return { label:'', from:'', to:'', buckets:[] };

      /* Weeks run Monday to Sunday, clipped to the range at both ends. */
      let cursor = new Date(start);
      cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
      while (cursor <= end){
        const wkEnd = new Date(cursor); wkEnd.setDate(wkEnd.getDate() + 6);
        const from = cursor < start ? start : cursor;
        const to   = wkEnd  > end   ? end   : wkEnd;
        buckets.push({
          label: `${fmtDate(this.ymd(from) + 'T00:00:00')} – ${fmtDate(this.ymd(to) + 'T00:00:00')}`,
          from: this.ymd(from), to: this.ymd(to)
        });
        cursor.setDate(cursor.getDate() + 7);
      }
      label = `${fmtDate(this.ymd(start) + 'T00:00:00')} – ${fmtDate(this.ymd(end) + 'T00:00:00')}`;
    }

    else if (type === 'monthly'){
      const one = String(p1 || '').slice(0, 7);
      const two = String(p2 || '').slice(0, 7) || one;
      if (!one) return { label:'', from:'', to:'', buckets:[] };
      const [y1, m1] = one.split('-').map(Number);
      const [y2, m2] = two.split('-').map(Number);
      let y = y1, m = m1;
      while (y < y2 || (y === y2 && m <= m2)){
        const last = new Date(y, m, 0).getDate();
        buckets.push({
          label: new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month:'long', year:'numeric' }),
          from: `${y}-${p(m)}-01`, to: `${y}-${p(m)}-${p(last)}`
        });
        m++; if (m > 12){ m = 1; y++; }
      }
      label = buckets.length
        ? (buckets.length === 1 ? buckets[0].label : `${buckets[0].label} – ${buckets[buckets.length-1].label}`)
        : '';
    }

    else if (type === 'quarterly'){
      const year = parseInt(p1, 10);
      if (!year) return { label:'', from:'', to:'', buckets:[] };
      const wanted = String(p2 || 'ALL').toUpperCase() === 'ALL'
        ? [1, 2, 3, 4] : [parseInt(p2, 10)];
      const ord = ['', '1st', '2nd', '3rd', '4th'];
      wanted.forEach(q => {
        const startM = (q - 1) * 3 + 1, endM = startM + 2;
        const last = new Date(year, endM, 0).getDate();
        buckets.push({
          label: `${ord[q]} Quarter ${year}`,
          from: `${year}-${p(startM)}-01`, to: `${year}-${p(endM)}-${p(last)}`
        });
      });
      label = wanted.length === 4 ? `Calendar Year ${year}` : `${ord[wanted[0]]} Quarter ${year}`;
    }

    else if (type === 'annual'){
      const y1 = parseInt(p1, 10), y2 = parseInt(p2, 10) || parseInt(p1, 10);
      if (!y1) return { label:'', from:'', to:'', buckets:[] };
      for (let y = y1; y <= y2; y++){
        buckets.push({ label: `Calendar Year ${y}`, from: `${y}-01-01`, to: `${y}-12-31` });
      }
      label = y1 === y2 ? `Calendar Year ${y1}` : `Calendar Years ${y1}–${y2}`;
    }

    return {
      label,
      from: buckets.length ? buckets[0].from : '',
      to:   buckets.length ? buckets[buckets.length - 1].to : '',
      buckets
    };
  },

  /**
   * Buckets over one date range, at whatever grain is asked for.
   *
   * periods() above answers the export modal, whose five widgets each hand back
   * a different shape — a day, a range, two months, a year plus a quarter. A
   * screen that asks the plainer question, one range and one grain, gets its
   * own way in rather than pretending to be one of those widgets.
   *
   * Buckets are clipped to the range at both ends, so a monthly report over
   * 10 August to 20 September has two buckets covering those dates and does
   * not quietly widen itself to two whole months.
   */
  bucketsOver(from, to, grain){
    const out = [];
    if (!from || !to || from > to) return out;

    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const start = new Date(fy, fm - 1, fd);
    const end   = new Date(ty, tm - 1, td);
    const day   = d => fmtDate(this.ymd(d) + 'T00:00:00');

    /* Every grain but the daily one produces a span that may hang over one end
       of the range, so they all clip through here. */
    const clip = (a, b, label) => {
      const lo = a < start ? start : a;
      const hi = b > end   ? end   : b;
      out.push({
        label: label || `${day(lo)} – ${day(hi)}`,
        from: this.ymd(lo), to: this.ymd(hi)
      });
    };

    if (grain === 'day'){
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)){
        out.push({ label: day(d), from: this.ymd(d), to: this.ymd(d) });
      }
    }

    else if (grain === 'week'){
      /* Monday to Sunday, the same week the rest of the engine uses. */
      const c = new Date(start);
      c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
      while (c <= end){
        const e = new Date(c); e.setDate(e.getDate() + 6);
        clip(new Date(c), e);
        c.setDate(c.getDate() + 7);
      }
    }

    else if (grain === 'month'){
      let y = fy, m = fm;
      while (y < ty || (y === ty && m <= tm)){
        clip(new Date(y, m - 1, 1), new Date(y, m, 0),
             new Date(y, m - 1, 1).toLocaleDateString('en-PH', { month:'long', year:'numeric' }));
        m++; if (m > 12){ m = 1; y++; }
      }
    }

    else if (grain === 'quarter'){
      const ord = ['', '1st', '2nd', '3rd', '4th'];
      let y = fy, q = Math.floor((fm - 1) / 3) + 1;
      const lastQ = Math.floor((tm - 1) / 3) + 1;
      while (y < ty || (y === ty && q <= lastQ)){
        const sm = (q - 1) * 3 + 1;
        clip(new Date(y, sm - 1, 1), new Date(y, sm + 2, 0), `${ord[q]} Quarter ${y}`);
        q++; if (q > 4){ q = 1; y++; }
      }
    }

    else if (grain === 'year'){
      for (let y = fy; y <= ty; y++){
        clip(new Date(y, 0, 1), new Date(y, 11, 31), `Calendar Year ${y}`);
      }
    }

    return out;
  },

  /** The documents issued within an inclusive date range. */
  within(rows, from, to){
    return (rows || []).filter(r => {
      const d = this.dayOf(r.issuedAt);
      return (!from || d >= from) && (!to || d <= to);
    });
  },

  /* --- the tax ladder ----------------------------------------------------- */

  /**
   * Add up a set of documents.
   *
   * Two rules decide what counts as sales, and both matter to anyone reading
   * the report as a tax record:
   *
   *   - A cancelled document is not a sale at all. Its money is excluded
   *     entirely and it is counted separately, the way a reading shows
   *     cancelled documents beside the sales they never became.
   *
   * "Cancelled", never "void". A till voids a line before anything is issued;
   * what happens here is the withdrawal of a document that already exists and
   * that the buyer may be holding. The regulations call that a cancellation,
   * and the status badge has always said Cancelled.
   *
   * The ladder reconciles: gross − discount = net, and
   * net = vatableSales + vat + exempt + zero − scDiscount.
   */
  summarize(rows){
    const s = {
      documents: 0, invoices: 0, cancelled: 0,
      gross: 0, discount: 0, vatableSales: 0, vat: 0, exempt: 0, zero: 0,
      scDiscount: 0, totalDue: 0,
      firstNumber: null, lastNumber: null
    };

    const ordered = (rows || []).slice().sort((a, b) => new Date(a.issuedAt) - new Date(b.issuedAt));

    ordered.forEach(r => {
      s.documents++;
      s.invoices++;

      if (s.firstNumber === null) s.firstNumber = r.number;
      s.lastNumber = r.number;

      if (r.docStatus === 'CANCELLED'){ s.cancelled++; return; }

      const t = r.totals || {};
      const sign = 1;
      s.gross        += sign * (t.gross || 0);
      s.discount     += sign * (t.discount || 0);
      s.vatableSales += sign * (t.vatableSales || 0);
      s.vat          += sign * (t.vat || 0);
      s.exempt       += sign * (t.exempt || 0);
      s.zero         += sign * (t.zero || 0);
      s.scDiscount   += sign * (t.scDiscount || 0);
      s.totalDue     += sign * (t.totalDue || 0);
    });

    ['gross','discount','vatableSales','vat','exempt','zero','scDiscount','totalDue']
      .forEach(k => { s[k] = round2(s[k]); });

    return s;
  },

  /**
   * Running total of net sales up to and including a moment — the accumulated
   * grand total a Z-reading opens and closes with. Reports uses it;
   * the summary reports do not.
   */
  accumulated(rows, uptoIso){
    const cut = uptoIso ? new Date(uptoIso) : null;
    const eligible = (rows || []).filter(r => !cut || new Date(r.issuedAt) <= cut);
    return this.summarize(eligible).totalDue;
  },

  /** Buckets with their documents and figures attached, ready to lay out. */
  build(rows, type, p1, p2){
    const period = this.periods(type, p1, p2);
    period.buckets = period.buckets.map(b => {
      const inRange = this.within(rows, b.from, b.to);
      return Object.assign({}, b, { rows: inRange, totals: this.summarize(inRange) });
    });
    period.totals = this.summarize(
      period.buckets.reduce((all, b) => all.concat(b.rows), [])
    );
    return period;
  }
};

/* ============================================================================
   Paper. The report is laid out as HTML and rendered to PDF in the browser.
   ========================================================================== */

Reporting.paper = {

  /* Kept with the markup it styles rather than in a stylesheet: the node is
     rendered off-screen and thrown away, and html2canvas only sees what is
     inline or in this block. */
  css: `
    .rpt { font-family: Arial, Helvetica, sans-serif; color:#111; font-size:9pt; width:100%; }
    .rpt h1 { font-size:14pt; margin:0 0 2px; letter-spacing:.02em; }
    .rpt .rpt_sub { font-size:8.5pt; color:#444; margin:0; }
    .rpt_head { border-bottom:2px solid #111; padding-bottom:8px; margin-bottom:10px; }
    .rpt_seller { font-size:8.5pt; line-height:1.45; }
    .rpt_seller strong { font-size:10pt; }
    .rpt_meta { width:100%; border-collapse:collapse; margin:0 0 12px; font-size:8pt; }
    .rpt_meta td { padding:2px 6px; vertical-align:top; }
    .rpt_meta td.k { color:#555; width:78px; }
    .rpt_meta td.v { font-weight:bold; }
    table.rpt_tbl { width:100%; border-collapse:collapse; font-size:7.5pt; }
    table.rpt_tbl th, table.rpt_tbl td { border:1px solid #999; padding:3px 5px; }
    table.rpt_tbl thead th { background:#e8eaed; font-size:7pt; text-transform:uppercase;
        letter-spacing:.03em; text-align:left; }
    table.rpt_tbl td.n, table.rpt_tbl th.n { text-align:right; white-space:nowrap; }
    table.rpt_tbl td.c, table.rpt_tbl th.c { text-align:center; }
    table.rpt_tbl tfoot td { background:#f1f2f4; font-weight:bold; }
    table.rpt_tbl tr.cancelled td { color:#777; }
    .rpt_note { margin-top:12px; font-size:7.5pt; color:#555; line-height:1.5;
        border-top:1px solid #ccc; padding-top:8px; }
    .rpt_empty { border:1px dashed #999; padding:22px; text-align:center; color:#666; font-size:9pt; }
  `,

  /** Registered details, period, and who ran it. Every page of a tax report
      needs to say what it covers and where it came from. */
  header(title, periodLabel, scopeLabel){
    const t = CT || {};
    const generated = new Date().toLocaleString('en-PH', {
      timeZone: 'Asia/Manila', year:'numeric', month:'long', day:'2-digit',
      hour:'2-digit', minute:'2-digit', hour12:true
    });

    return `
      <div class="rpt_head">
        <div class="rpt_seller">
          <strong>${esc(t.name || '—')}</strong><br>
          ${t.tradeName ? esc(t.tradeName) + '<br>' : ''}
          TIN ${esc(t.tin || '—')}-000 · ${esc(t.vatStatus === 'VAT' ? 'VAT-registered' : (t.vatStatus || '—'))}<br>
          ${esc(t.address || '')}
        </div>
        <h1 style="margin-top:8px;">${esc(title)}</h1>
        <p class="rpt_sub">${esc(periodLabel || 'All available records')}</p>
      </div>

      <table class="rpt_meta">
        <tr>
          <td class="k">Coverage</td><td class="v">${esc(scopeLabel)}</td>
          <td class="k">Generated</td><td class="v">${esc(generated)} PST</td>
        </tr>
        <tr>
          <td class="k">Prepared by</td>
          <td class="v">${esc(CU ? CU.name : '—')} · ${esc(CR && ROLES[CR] ? ROLES[CR].label : '—')}</td>
          <td class="k">System</td>
          <td class="v">${esc(SYSTEM.product)} v${esc(SYSTEM.version)}</td>
        </tr>
      </table>`;
  },

  footer(extra){
    return `
      <div class="rpt_note">
        ${extra ? esc(extra) + '<br>' : ''}
        System-generated report. Figures are derived from the documents held in this account;
        cancelled documents are excluded from sales and counted separately. The BIR
        accreditation program for electronic invoicing providers has not opened yet.<br>
        <strong>Demonstration only.</strong> This report was produced from local demonstration
        data and has no standing as a tax record.
      </div>`;
  },

  /** A period summary: one row per bucket, with the tax ladder across. */
  summary(period, opts){
    const cols = [
      { h:'Period',            k:b => esc(b.label),                cls:''  },
      { h:'Docs',              k:b => b.totals.documents,          cls:'c' },
      { h:'Cancelled',         k:b => b.totals.cancelled || '—',   cls:'c' },
      { h:'Gross Sales (VAT incl.)', k:b => num(b.totals.gross),   cls:'n' },
      { h:'Discounts',         k:b => num(b.totals.discount),      cls:'n' },
      { h:'VATable Sales',     k:b => num(b.totals.vatableSales),  cls:'n' },
      { h:'Output VAT',        k:b => num(b.totals.vat),           cls:'n' },
      { h:'VAT-Exempt',        k:b => num(b.totals.exempt),        cls:'n' },
      { h:'Zero-Rated',        k:b => num(b.totals.zero),          cls:'n' },
      { h:'Statutory',            k:b => num(b.totals.scDiscount),    cls:'n' },
      /* "Total amount due" is a line on one invoice — what that buyer owes.
         Added up across a period it is no longer anyone's amount due, so the
         column that sums it says what it is: the value invoiced. */
      { h:'Total Invoiced',    k:b => num(b.totals.totalDue),      cls:'n' }
    ];

    const body = period.buckets.length
      ? period.buckets.map(b => `<tr>${cols.map(c =>
          `<td class="${c.cls}">${c.k(b)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}" style="text-align:center;color:#666;padding:18px;">
           No documents were issued in this period.</td></tr>`;

    const t = period.totals;
    return `
      ${this.header(opts.title, period.label, opts.scope)}
      <table class="rpt_tbl">
        <thead><tr>${cols.map(c => `<th class="${c.cls}">${c.h}</th>`).join('')}</tr></thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <td>TOTAL</td>
            <td class="c">${t.documents}</td>
            <td class="c">${t.cancelled || '—'}</td>
            <td class="n">${num(t.gross)}</td>
            <td class="n">${num(t.discount)}</td>
            <td class="n">${num(t.vatableSales)}</td>
            <td class="n">${num(t.vat)}</td>
            <td class="n">${num(t.exempt)}</td>
            <td class="n">${num(t.zero)}</td>
            <td class="n">${num(t.scDiscount)}</td>
            <td class="n">${num(t.totalDue)}</td>
          </tr>
        </tfoot>
      </table>
      ${this.footer(
        t.documents
          ? `Documents covered: ${t.invoices} invoice(s). Series span ${t.firstNumber} to ${t.lastNumber}.` +
            this.scpwdNote(t)
          : ''
      )}`;
  },

  /**
   * Gross is stated VAT-inclusive, but a sale to a senior citizen or a person
   * with disability has its VAT removed before the 20% discount is taken
   * (RA 9994, RA 10754), so that VAT never reaches the ladder. Without this
   * line the two figures look like they disagree; with it the difference is
   * accounted for and the row adds up on the page.
   */
  scpwdNote(t){
    if (!t.scDiscount) return '';
    const stripped = round2(t.gross - t.discount - (t.totalDue + t.scDiscount));
    if (stripped <= 0) return '';
    return ` Gross is stated VAT-inclusive; ${peso(stripped)} of VAT was removed from ` +
           `statutory-discount sales (SC/PWD, solo parent) before the discount, which is why gross less discounts ` +
           `exceeds the tax ladder by that amount.`;
  },

  /**
   * A plain listing — the chosen columns and nothing else underneath.
   *
   * Not every register is a register of sales. Activity Logs records who did
   * what, Account Management records who may do it; neither has a tax ladder to
   * add up, and printing a row of zero totals under one would be worse than
   * printing nothing. So these get the same header, the same footer, and a
   * count instead of a summary.
   */
  listing(rows, columns, opts){
    const head = columns.map(c => `<th class="${c.align || ''}">${esc(c.label)}</th>`).join('');
    return `
      ${this.header(opts.title, opts.periodLabel, opts.scope)}
      ${rows.length ? `
      <table class="rpt_tbl">
        <thead><tr><th class="c" style="width:22px;">#</th>${head}</tr></thead>
        <tbody>${rows.map((r, n) => `<tr>
          <td class="c">${n + 1}</td>${columns.map(c =>
            `<td class="${c.align || ''}">${esc(c.value(r))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>` : `<div class="rpt_empty">No records matched the current filters.</div>`}
      ${this.footer(rows.length ? `${rows.length} record(s) listed.` : '')}`;
  },

  /** Per document: the chosen columns, in the order they were dragged into. */
  perDocument(rows, columns, opts){
    const head = columns.map(c => `<th class="${c.align || ''}">${esc(c.label)}</th>`).join('');
    const body = rows.length
      ? rows.map(r => `<tr class="${r.docStatus === 'CANCELLED' ? 'cancelled' : ''}">${
          columns.map(c => `<td class="${c.align || ''}">${esc(c.value(r))}</td>`).join('')
        }</tr>`).join('')
      : '';

    const t = Reporting.summarize(rows);
    return `
      ${this.header(opts.title, opts.periodLabel, opts.scope)}
      ${rows.length ? `
      <table class="rpt_tbl">
        <thead><tr><th class="c" style="width:22px;">#</th>${head}</tr></thead>
        <tbody>${rows.map((r, n) => `<tr class="${r.docStatus === 'CANCELLED' ? 'cancelled' : ''}">
          <td class="c">${n + 1}</td>${columns.map(c =>
            `<td class="${c.align || ''}">${esc(c.value(r))}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>` : `<div class="rpt_empty">No records matched the current filters.</div>`}
      ${this.footer(
        rows.length
          ? `${rows.length} invoice(s) listed. Total excluding ` +
            `${t.cancelled} cancelled invoice(s): ${peso(t.totalDue)}.`
          : ''
      )}`;
  },

  /**
   * Render markup to a PDF and hand back a base64 data URI.
   *
   * Two nodes, not one, and the reason is worth stating because getting it
   * wrong produces a blank page with no error anywhere. The report has to be
   * in the document and have a real width for html2canvas to measure it, so it
   * is parked off-screen — but html2pdf copies the node it is given, inline
   * style and all, into a container whose height is auto. A node positioned
   * `fixed` is out of flow, so the copy contributes no height, the container
   * measures zero, and the capture comes back empty.
   *
   * So the positioning lives on an outer wrapper and html2pdf is handed the
   * plain, statically positioned page inside it.
   */
  render(innerHtml, orientation){
    const widthMm = orientation === 'landscape' ? 277 : 190;   /* A4 less margins */

    const stage = document.createElement('div');
    stage.setAttribute('style',
      `position:fixed; left:-10000px; top:0; width:${widthMm}mm; background:#fff; padding:0;`);

    const page = document.createElement('div');
    page.setAttribute('style', 'width:100%; background:#fff;');
    page.innerHTML = `<style>${this.css}</style><div class="rpt">${innerHtml}</div>`;

    stage.appendChild(page);
    document.body.appendChild(stage);

    return html2pdf().set({
      margin:      orientation === 'landscape' ? [10, 10, 12, 10] : [12, 10, 14, 10],
      image:       { type:'jpeg', quality:0.98 },
      html2canvas: { scale:2, useCORS:true, backgroundColor:'#ffffff' },
      jsPDF:       { unit:'mm', format:'a4', orientation: orientation || 'portrait' },
      pagebreak:   { mode:['css','legacy'] }
    }).from(page).outputPdf('datauristring')
      .then(uri => {
        stage.remove();
        /* jsPDF may slip a filename= segment into the data URI. The carried-over
           client strips a plain "data:application/pdf;base64," prefix and nothing
           else, so normalise here rather than loosening its regex. */
        const i = String(uri).indexOf('base64,');
        return 'data:application/pdf;base64,' + (i < 0 ? uri : String(uri).slice(i + 7));
      })
      .catch(err => { stage.remove(); throw err; });
  }
};

/* ============================================================================
   The modal. Markup lives in index.html, copied from the source portal's shared
   partial, so these selectors are the portal's own.
   ========================================================================== */

/**
 * @param from_table   selector of the table whose columns feed the per-transaction
 *                     picker — a DataTable, or a plain table before it is one
 * @param list_of_ids  ids of the rows currently in view
 * @param target       which registered source to export (default: the register)
 */
function ModalExportToPDF(from_table, list_of_ids, target) {
    target = target || "invoice_transactions";
    list_of_ids = list_of_ids || [];

    $(".modal_export_to_pdf").off("show.bs.modal hidden.bs.modal").on("show.bs.modal", function () {
        $(".button_export_to_pdf").attr("disabled", true);
        if (list_of_ids.length === 0) {
            $(".checkbox_export_to_pdf_current_data_summary").prop("disabled", true);
            $(".div_checkbox_export_to_pdf_current_data_summary").addClass("bg_gray_200");
        } else {
            DisplayCurrentData(from_table);
        }
    }).on("hidden.bs.modal", function () {
        $("input[name='checkbox_export_to_pdf']").prop("checked", false).prop("disabled", false);
        $(".div_checkbox_export_to_pdf_current_data_summary").removeClass("bg_gray_200");
        ModalExportToPDFReset();
    }).modal({
        backdrop: "static",
        keyboard: false,
    }).modal("show");

    $("input[name='checkbox_export_to_pdf']").off("change").on("change", function () {
        if ($(this).is(":checked")) {
            $("input[name='checkbox_export_to_pdf']").not(this).prop("checked", false);
        }
        ModalExportToPDFReset();

        if ($(this).is(":checked")) {
            var id = $(this).attr("id");
            $(".button_export_to_pdf").attr("disabled", false);
            if (id === "checkbox_export_to_pdf_daily_summary") {
                $(".tr_export_to_pdf_daily").removeClass("d-none");
            }
            else if (id === "checkbox_export_to_pdf_weekly_summary") {
                $(".tr_export_to_pdf_weekly").removeClass("d-none");
            }
            else if (id === "checkbox_export_to_pdf_export_to_pdf_monthly_summary") {
                $(".tr_export_to_pdf_monthly").removeClass("d-none");
            }
            else if (id === "checkbox_export_to_pdf_quarterly_summary") {
                $(".tr_export_to_pdf_quarterly").removeClass("d-none");
            }
            else if (id === "checkbox_export_to_pdf_annual_summary") {
                $(".tr_export_to_pdf_yearly").removeClass("d-none");
            }
            else if (id === "checkbox_export_to_pdf_current_data_summary") {
                $(".table_export_to_pdf_current_data").removeClass("d-none");
            }
        }
    });

    $(".button_export_to_pdf").off("click").on("click", function () {
        var input_checkbox = $("input[name='checkbox_export_to_pdf']:checked");

        if (input_checkbox.length === 0) {
            DisplaySwal("info", "", "Select an export type.");
            return;
        }

        var id = input_checkbox.attr("id");
        var export_type = "";
        var param_1 = "";
        var param_2 = "";
        var is_valid = true;
        var validation_message = "";

        if (id === "checkbox_export_to_pdf_daily_summary") {
            export_type = "daily";
            param_1 = $(".input_date_export_to_pdf_daily_summary").val();

            if (!param_1) {
                is_valid = false;
                validation_message = "Select a summary date.";
            }
        }
        else if (id === "checkbox_export_to_pdf_weekly_summary") {
            export_type = "weekly";
            param_1 = $(".input_date_range_export_to_pdf_weekly_summary").val();

            if (!param_1) {
                is_valid = false;
                validation_message = "Select a weekly date range.";
            }
        }
        else if (id === "checkbox_export_to_pdf_export_to_pdf_monthly_summary") {
            export_type = "monthly";
            param_1 = $(".input_month_year_export_to_pdf_monthly_summary_from").val();
            param_2 = $(".input_month_year_export_to_pdf_monthly_summary_to").val();

            if (!param_1 || !param_2) {
                is_valid = false;
                validation_message = "Select both the From and To months.";
            }
            else if (param_1 > param_2) {
                is_valid = false;
                validation_message = "The starting month cannot be later than the ending month.";
            }
        }
        else if (id === "checkbox_export_to_pdf_quarterly_summary") {
            export_type = "quarterly";
            param_1 = $(".select_year_export_to_pdf").val();
            param_2 = $(".select_export_to_pdf_quarter").val();

            if (!param_1 || !param_2 || $(".select_year_export_to_pdf").prop("selectedIndex") === 0 || $(".select_export_to_pdf_quarter").prop("selectedIndex") === 0) {
                is_valid = false;
                validation_message = "Select a valid year and quarter.";
            }
        }
        else if (id === "checkbox_export_to_pdf_annual_summary") {
            export_type = "annual";
            param_1 = $(".select_year_export_to_pdf_from").val();
            param_2 = $(".select_year_export_to_pdf_to").val();

            if (!param_1 || !param_2 || $(".select_year_export_to_pdf_from").prop("selectedIndex") === 0 || $(".select_year_export_to_pdf_to").prop("selectedIndex") === 0) {
                is_valid = false;
                validation_message = "Enter a valid From and To year range.";
            }
            else if (parseInt(param_1) > parseInt(param_2)) {
                is_valid = false;
                validation_message = "The start year cannot be greater than the end year.";
            }
        }
        else if (id === "checkbox_export_to_pdf_current_data_summary") {
            export_type = "current_data";
            if (!list_of_ids || list_of_ids.length === 0) {
                is_valid = false;
                validation_message = "There are no records available to generate PDF.";
            }
        }

        if (!is_valid) {
            DisplaySwal("info", "", validation_message);
            return;
        } else {
            GenerationOfPDF(target, export_type, list_of_ids.join(','), param_1, param_2);
        }

    });

    $(".button_export_to_pdf_close").off("click").on("click", function () {
        DisplayConfirmSwal("Confirmation<br>Close this modal", function () {
            $(".modal_export_to_pdf").modal("hide");
        }, "", "Confirm", false)
    });

    var quarter_list = [
        { text: "ALL", value: "ALL" },
        { text: "1st Quarter", value: "1" },
        { text: "2nd Quarter", value: "2" },
        { text: "3rd Quarter", value: "3" },
        { text: "4th Quarter", value: "4" },
    ];
    $(".input_date_export_to_pdf_daily_summary").val("")
    DisplaySelect2(quarter_list, ".select_export_to_pdf_quarter", true, "Quarter", "");

    function DisplayCurrentData(source) {
        $(".checkbox_export_to_pdf_all").prop("checked", false);
        var target_body = $(".table_export_to_pdf_list_current_data");
        target_body.empty();

        /* The portal read its column names off the DataTable on screen, which
           meant the picker could only offer what the screen already showed, and
           the labels it posted had to match what the server knew how to render.
           The source's own column list is the better answer to both: it is what
           the engine can actually lay out, so the two can never drift, and a
           register that shows eight columns can still export the full tax
           ladder. The table is the fallback for a screen with no source yet. */
        var headings = [];
        var registered = Reporting.sources[target];

        if (registered && typeof registered.columns === "function") {
            registered.columns().forEach(function (col, index) {
                headings.push({ index: index, name: col.label });
            });
        } else if ($.fn.dataTable && $.fn.dataTable.isDataTable(source)) {
            $(source).DataTable().columns().every(function (index) {
                headings.push({ index: index, name: $(this.header()).text().trim() });
            });
        } else {
            $(source).find("thead th").each(function (index) {
                headings.push({ index: index, name: $(this).text().trim() });
            });
        }

        headings.forEach(function (col) {
            var rowNumber = col.index + 1;
            var checkboxId = "pdf_export_payment_" + rowNumber;
            if (!col.name) return;

            target_body.append(`
                <tr style="cursor: grab;">
                    <td class="text-center align-middle index-column">${rowNumber}</td>
                    <td class="p-1 px-2">
                        <div class="form-check d-flex align-items-center gap-2 m-0">
                            <input class="checkbox_export_to_pdf_column checkbox" type="checkbox" id="${checkboxId}" data-column-index="${col.index}" checked>
                            <label class="form-check-label fs_12 mb-0" for="${checkboxId}">
                                ${esc(col.name)}
                            </label>
                        </div>
                    </td>
                </tr>
            `);
        });

        $(".checkbox_export_to_pdf_all").prop("checked", true);

        $(".checkbox_export_to_pdf_all").off("change").on("change", function () {
            var isChecked = $(this).is(":checked");
            target_body.find(".checkbox_export_to_pdf_column").prop("checked", isChecked);
        });

        // If any single child checkbox gets unchecked, uncheck the "Select All" master box
        target_body.off("change", ".checkbox_export_to_pdf_column").on("change", ".checkbox_export_to_pdf_column", function () {
            var totalCheckboxes = target_body.find(".checkbox_export_to_pdf_column").length;
            var totalChecked = target_body.find(".checkbox_export_to_pdf_column:checked").length;

            $(".checkbox_export_to_pdf_all").prop("checked", totalCheckboxes === totalChecked);
        });

        target_body.sortable({
            axis: "y",
            containment: "parent",
            helper: function (e, tr) {
                var $originals = tr.children();
                var $helper = tr.clone();
                $helper.children().each(function (index) {
                    $(this).width($originals.eq(index).width());
                });
                return $helper;
            },
            stop: function (event, ui) {
                RenumberFiltering(".table_export_to_pdf_list_current_data");
            }
        });

        RenumberFiltering(".table_export_to_pdf_list_current_data");

        function RenumberFiltering(table_container) {
            var visibleIndex = 1;
            $(`${table_container} tr`).each(function () {
                if (!$(this).hasClass("d-none")) {
                    $(this).find("td:first").text(visibleIndex++);
                }
            });
        }
    }

    function ModalExportToPDFReset() {
        $(".table_export_to_pdf_current_data").addClass("d-none")
        $(".tr_export_to_pdf_daily").addClass("d-none")
        $(".tr_export_to_pdf_weekly").addClass("d-none")
        $(".tr_export_to_pdf_monthly").addClass("d-none")
        $(".tr_export_to_pdf_quarterly").addClass("d-none")
        $(".tr_export_to_pdf_yearly").addClass("d-none")

        $(".input_date_export_to_pdf_daily_summary").val("");
        $(".input_date_range_export_to_pdf_weekly_summary").val("");
        $(".input_month_year_export_to_pdf_monthly_summary_from").val("");
        $(".input_month_year_export_to_pdf_monthly_summary_to").val("");
        $(".select_year_export_to_pdf").prop("selectedIndex", 0).trigger("change");
        $(".select_export_to_pdf_quarter").prop("selectedIndex", 0).trigger("change");
        $(".select_year_export_to_pdf_from").prop("selectedIndex", 0).trigger("change");
        $(".select_year_export_to_pdf_to").prop("selectedIndex", 0).trigger("change");
        $(".button_export_to_pdf").attr("disabled", true);
    }
}

/**
 * Unchanged from the source portal: collect the chosen columns in the order the
 * rows were dragged into, post them, and save whatever PDFs come back. The
 * route is answered locally now — see the LocalAPI handler below — but the
 * reply has the shape the server used to send, so nothing here had to move.
 */
function GenerationOfPDF(target, export_type, data_1, data_2, data_3) {

    var selected_fields = [];
    if (export_type == "current_data") {
        $(".table_export_to_pdf_list_current_data tr").each(function () {
            var check_box = $(this).find("input[type='checkbox']");
            if (check_box.prop("checked")) {
                var number = $(this).find("td:first").text().trim();
                var label = $(this).find("label").text().replace(/@.*@/, "").trim();
                selected_fields.push(number + ". " + label);
            }
        });
        if (selected_fields.length === 0) {
            DisplayDelaySwal("info", "", "Select at least one field.");
            return;
        } else {
            data_2 = selected_fields.join(',');
        }
    }

    DisplayLoadingSwal();
    $.ajax({
        url: "/Portal/SPIStradcom/Dashboard/GenerationOfPDF",
        type: "POST",
        dataType: "json",
        contentType: "application/json; charset=utf-8",
        data: JSON.stringify({
            target,
            export_type,
            data_1,
            data_2,
            data_3
        })
    }).done(function (res) {
        Swal.close();
        if (res && res.success && res.pdf_list && res.pdf_list.length > 0) {
            res.pdf_list.forEach(pdfData => {
                if (!pdfData || !pdfData.base64) return;
                let base64 = pdfData.base64;
                if (typeof base64 !== "string") return;
                base64 = base64.replace(/^data:application\/pdf;base64,/, "");
                base64 = base64.replace(/\s/g, "");
                let pdfBlob = base64ToBlob(base64, "application/pdf");
                let link = document.createElement("a");
                link.href = URL.createObjectURL(pdfBlob);
                link.download = pdfData.pdf_title || "document.pdf";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            });
            $(".modal_export_to_pdf").modal("hide");
        } else if (!res.success) {
            DisplaySwal("info", "", res.message || "No PDF available.");
        }
    }).fail(function () {
        Swal.close();
        DisplaySwal("Error", "", "Failed to generate PDF");
    })
}

/* ============================================================================
   The server side of the export, standing in for Dashboard/GenerationOfPDF.
   ========================================================================== */

LocalAPI.on("Dashboard/GenerationOfPDF", function (body) {
  const src = Reporting.get(body.target);
  const type = body.export_type;
  const ids = String(body.data_1 || '').split(',').filter(Boolean);

  const scope = can('allBranches')
    ? 'All branches'
    : ((Store.db.branches.find(b => b.id === CU.branchId) || {}).name || 'Your branch');

  /* A screen with nothing to summarise posts no export type — the portal's
     plain "generate this list" call, which Activity Logs and Account Management
     both use. It hands over its search box and date range rather than a set of
     ids, because what it wants on paper is what it is showing. */
  if (!type){
    if (src.kind !== 'listing'){
      return { success:false, message:'That export needs a period to be chosen.' };
    }
    const rows = src.search(body.data_1, body.data_2);
    const html = Reporting.paper.listing(rows, src.columns(), {
      title: src.title,
      periodLabel: src.periodLabel ? src.periodLabel(body.data_1, body.data_2) : '',
      scope
    });

    return Reporting.paper.render(html, src.columns().length > 7 ? 'landscape' : 'portrait')
      .then(uri => {
        Reporting.logExport(`Exported ${rows.length} ${src.title.toLowerCase()} record(s) to PDF`);
        return {
          success: true,
          pdf_list: [{ base64: uri, pdf_title: Reporting.filename(src, 'listing') }]
        };
      });
  }

  /* Per document lists exactly what the screen has in view, in the column
     order the user dragged. Everything else is a period summary computed over
     the whole visible set, filters and all — a summary of a filtered register
     would not reconcile to anything. */
  if (type === 'current_data'){
    const wanted = String(body.data_2 || '')
      .split(',')
      .map(s => s.replace(/^\s*\d+\.\s*/, '').trim())
      .filter(Boolean);

    const byLabel = {};
    src.columns().forEach(c => { byLabel[c.label.toUpperCase()] = c; });
    const columns = wanted.map(l => byLabel[l.toUpperCase()]).filter(Boolean);

    if (!columns.length){
      return { success:false, message:'None of the selected columns are exportable.' };
    }

    const rows = src.rows(ids);
    const html = Reporting.paper.perDocument(rows, columns, {
      title: src.title + ': Per invoice',
      periodLabel: src.periodLabel ? src.periodLabel() : 'Current filtered data',
      scope
    });

    return Reporting.paper.render(html, columns.length > 7 ? 'landscape' : 'portrait')
      .then(uri => {
        Reporting.logExport(`Exported ${rows.length} invoice(s), one row each, to PDF`);
        return {
          success: true,
          pdf_list: [{ base64: uri, pdf_title: Reporting.filename(src, type) }]
        };
      });
  }

  const period = Reporting.build(src.all ? src.all() : src.rows(ids), type, body.data_2, body.data_3);
  if (!period.buckets.length){
    return { success:false, message:'That period could not be read. Select the period again.' };
  }

  const html = Reporting.paper.summary(period, {
    title: src.title + ' — ' + Reporting.PERIODS[type].label,
    scope
  });

  return Reporting.paper.render(html, 'portrait').then(uri => {
    Reporting.logExport(
      `Exported ${Reporting.PERIODS[type].label.toLowerCase()} for ${period.label} to PDF`);
    return {
      success: true,
      pdf_list: [{ base64: uri, pdf_title: Reporting.filename(src, type, period) }]
    };
  });
});

/* Taking taxpayer figures out of the system is an event worth keeping, whatever
   shape the export took, so both branches record it. */
Reporting.logExport = function(action){
  const db = Store.db;
  logActivity(db, { action });
  Store.save(db);
};

/** e.g. BMC-invoice-transactions-monthly-2026-08-16.pdf */
Reporting.filename = function(src, type, period){
  const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [
    (CT && CT.seriesPrefix) || 'EPI',
    slug(src.title),
    type,
    period && period.from ? period.from : this.ymd(new Date())
  ].join('-') + '.pdf';
};

/* The year pickers in the modal are select2s the portal filled from a list the
   server rendered into a hidden input. Same input, filled here instead. */
$(function(){
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now; y >= now - 6; y--) years.push({ text: String(y), value: String(y) });
  $(".input_year_list").val(JSON.stringify(years));
  if (typeof Datepicker === 'function') Datepicker("year");
});
