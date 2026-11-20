// Regenerates the Annex A sample printouts from the running mockup (needs `node serve` on :8765).
//   node tools/capture-samples.mjs <output folder>
// App-made PDFs (the system's own exports) go to <out>/pdf; screen captures go to <out>/png as one tall image each.
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';

const OUT = path.resolve(process.argv[2] || 'samples-new');
fs.mkdirSync(path.join(OUT, 'pdf'), { recursive: true }); fs.mkdirSync(path.join(OUT, 'png'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await launch('http://localhost:8765/index.html', { width: 1100, height: 1400 });
const ev = e => b.eval(e);

const loginAs = async name => { await ev(`(()=>{ const u=Store.db.users.find(x=>x.name===${JSON.stringify(name)}); Auth.enter(u); })()`); await sleep(1500); };
const go = async (screen, opts) => { await ev(`Nav.go(${JSON.stringify(screen)}, ${JSON.stringify(opts || null)})`); await sleep(1800); };
const click = async sel => { await ev(`$(${JSON.stringify(sel)}).trigger('click')`); await sleep(900); };

/* The system's own PDF export, called the way the screens call it. */
const appPdf = async (file, route, body, json) => {
  const r = await ev(`new Promise(res => $.ajax({ url:'/Portal/SPIStradcom/Dashboard/${route}', method:'POST', dataType:'json',
      ${json ? "contentType:'application/json; charset=utf-8', data:JSON.stringify(" + JSON.stringify(body) + ")" : 'data:' + JSON.stringify(body)} }).done(res))`);
  if (!r || !r.success) { console.log('FAIL', file, r && r.message); return null; }
  const uri = r.pdf_list[0].base64; const b64 = uri.slice(uri.indexOf('base64,') + 7);
  fs.writeFileSync(path.join(OUT, 'pdf', file), Buffer.from(b64, 'base64')); console.log('pdf ', file); return r;
};

/* A screen element, with a title block, as one tall image at 2x. */
const shot = async (file, selector, titleHtml, width = 1047) => {
  const clip = await ev(`(()=>{ const el=${selector.startsWith('js:') ? selector.slice(3) : 'document.querySelector(' + JSON.stringify(selector) + ')'}; if(!el) return null;
    document.querySelectorAll('#cap-wrap').forEach(e=>e.remove());
    const w=document.createElement('div'); w.id='cap-wrap';
    w.style.cssText='position:absolute;left:0;top:0;width:${width}px;background:#fff;padding:20px 24px 24px;z-index:99999;box-sizing:border-box;';
    w.innerHTML=${JSON.stringify(titleHtml)}; w.appendChild(el.cloneNode(true)); document.body.appendChild(w);
    w.querySelectorAll('.d-none').forEach(e=>{ if(e.classList.contains('tab_content')) e.classList.remove('d-none'); });
    const r=w.getBoundingClientRect(); return { x:0, y:0, width:r.width, height:r.height, scale:1 }; })()`);
  if (!clip) { console.log('MISSING', selector); return; }
  const png = await b.screenshot(clip); fs.writeFileSync(path.join(OUT, 'png', file), png); console.log('png ', file, clip.height);
  await ev(`document.querySelectorAll('#cap-wrap').forEach(e=>e.remove())`);
};
const head = (co, tin, title, sub) => `<div style="font-family:inherit;margin-bottom:10px"><div style="font-weight:700;font-size:15px">${co} · TIN ${tin}</div>
  <div style="font-weight:700;font-size:20px;margin-top:2px">${title}</div>${sub ? `<div style="color:#555;font-size:13px">${sub}</div>` : ''}</div>`;

try {
  /* ---- the taxpayer's own reports: Eastland Printink, Inc., the sample company (its owner signs in) ---- */
  await loginAs('Rodrigo L. Evangelista');
  const T = await ev(`CT.name + '|' + CT.tin`); const [CO, TIN] = T.split('|');
  await go('reports');
  const summary = async (file, type, p1, p2) => {
    const uri = await ev(`(async()=>{ const src=Reporting.get('reports'); const period=Reporting.build(src.all(), ${JSON.stringify(type)}, ${JSON.stringify(p1)}, ${JSON.stringify(p2)});
      const html=Reporting.paper.summary(period,{ title: src.title+' — '+Reporting.PERIODS[${JSON.stringify(type)}].label, scope:'All branches' }); return await Reporting.paper.render(html,'landscape'); })()`);
    fs.writeFileSync(path.join(OUT, 'pdf', file), Buffer.from(uri.slice(uri.indexOf('base64,') + 7), 'base64')); console.log('pdf ', file);
  };
  await summary('13-01-sales-and-vat-summary-monthly.pdf', 'monthly', '2026-10', '2026-10');
  await summary('13-02-sales-and-vat-summary-quarterly.pdf', 'quarterly', '2026', 'ALL');

  const yday = await ev(`(()=>{ const d=new Date(Date.now()-86400000); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })()`);
  const x = await ev(`new Promise(res=>$.ajax({url:'/Portal/SPIStradcom/Dashboard/ReadingTake',method:'POST',dataType:'json',data:{kind:'X',branch:'b_epi_000',date:${JSON.stringify(yday)}}}).done(res))`);
  if (x && x.success) await appPdf('13-03-x-reading.pdf', 'ReadingPdf', { reading:x.data_1 }, true); else console.log('X reading failed', x && x.message);
  const z = await ev(`new Promise(res=>$.ajax({url:'/Portal/SPIStradcom/Dashboard/ReadingTake',method:'POST',dataType:'json',data:{kind:'Z',branch:'b_epi_000',date:${JSON.stringify(yday)}}}).done(res))`);
  if (z && z.success) await appPdf('13-04-z-reading.pdf', 'ReadingPdf', { reading:z.data_1 }, true); else console.log('Z reading failed', z && z.message);

  /* sales lists and the series check */
  await click('.tab_button_reports_3');
  await shot('13-05-sales-list-sls-q4.png', '.div_lists_sls', head(CO, TIN, 'Sales List (SLS)', 'Q4 · October to December 2026'));
  await shot('13-06-statutory-discount-sales-q4.png', '.div_lists_special', head(CO, TIN, 'Sales with a Statutory Discount (SC / PWD / National Athletes and Coaches / Solo Parent) — Q4 · Oct to Dec 2026'));
  await click('.tab_button_reports_4');
  await shot('13-07-number-check.png', '.div_lists_series', head(CO, TIN, 'Invoice Number Check'));

  /* document register (per document, latest 11) and audit trail */
  await go('invoices');
  const ids = await ev(`Auth.visibleInvoices().slice().sort((a,b)=>new Date(b.issuedAt)-new Date(a.issuedAt)).slice(0,11).map(i=>i.id).reverse().join(',')`);
  const want = ['DOCUMENT NUMBER','DATE & TIME ISSUED','DOCUMENT TYPE','BUYER','BUYER TIN','BRANCH','GROSS SALES (VAT INCL.)','DISCOUNTS','VATABLE SALES'];
  const have = await ev(`Reporting.get('invoice_transactions').columns().map(c=>c.label)`);
  const cols = want.map((w, i) => (i + 1) + '. ' + (have.find(h => h.toUpperCase() === w) || w)).join(',');
  console.log('columns available:', have.join(' | '));
  await appPdf('13-08-invoices.pdf', 'GenerationOfPDF', { target:'invoice_transactions', export_type:'current_data', data_1:ids, data_2:cols });
  await click('.tab_button_invoices_2');
  await shot('13-09-sent-to-bir-status.png', '.tab_content_invoices_2', head(CO, TIN, 'Sent to BIR Status Report'));
  await go('activity');
  await appPdf('13-10-audit-trail-activity-log.pdf', 'GenerationOfPDF', { target:'activity_logs', data_1:'', data_2:await ev(`(()=>{ const f=d=>String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getDate()).padStart(2,'0')+'/'+d.getFullYear(); return f(new Date(Date.now()-14*86400000))+' - '+f(new Date()); })()`) });

  /* EPI's own invoices as documents: standard, mixed VAT and cancelled (Item 12.1, 12.2, 12.8) */
  const docOf = expr => ev(`(()=>{ const i=${expr}; return i && i.id; })()`);
  const mine = `Store.db.invoices.filter(i=>i.tenantId===CT.id && !i.providerBilling && i.transmissionStatus==='TRANSMITTED')`;
  const picks = [
    ['12-01-electronic-invoice-standard.png',  `${mine}.filter(i=>i.docStatus==='ISSUED' && i.ewtRate && i.paymentStatus==='PAID' && i.lines.length>=2 && i.lines.every(l=>l.treatment==='VATABLE')).sort((a,b)=>new Date(b.issuedAt)-new Date(a.issuedAt))[0]`],
    ['12-02-electronic-invoice-mixed-vat.png', `${mine}.find(i=>i.docStatus==='ISSUED' && i.lines.some(l=>l.treatment==='EXEMPT') && i.lines.some(l=>l.treatment==='ZERO'))`],
    ['12-09-cancelled-invoice.png',            `Store.db.invoices.find(i=>i.tenantId===CT.id && i.docStatus==='CANCELLED')`]
  ];
  for (const [file, expr] of picks) {
    const id = await docOf(expr); if (!id) { console.log('NO DOC for', file); continue; }
    await go('invoices', { docId: id }); await shot(file, "js:document.querySelector('.invform').closest('.doc-stage')", '', 1000);
  }

  /* EPI's own invoice to a client, as that client sees it: Bayanihan's balance invoice for October */
  await loginAs('Ramon T. Villaflor');
  const pid = await ev(`(BillingReg.all(Store.db).find(i=>i.clientId===CT.id && i.period==='2026-10' && i.terms!=='Paid by real-time deduction')||{}).id`);
  if (pid) { await go('billing', { docId: pid }); await shot('12-11-epi-invoice-to-client.png', "js:document.querySelector('.invform')", '', 1000); }

  /* operator console */
  await loginAs('Carmela T. Rivera');
  await go('home');
  await shot('13-22-operations-dashboard.png', '#content', '', 1047);

  /* ---- data files: the sales list, and EPI's periodic reports and audit log ---- */
  fs.mkdirSync(path.join(OUT, 'files'), { recursive: true });
  const intercept = (obj, fn) => ev(`(()=>{ window.__saved=[]; ${obj}.save = ${fn}; })()`);
  const saved = () => ev(`JSON.stringify(window.__saved)`).then(JSON.parse);
  await loginAs('Rodrigo L. Evangelista'); await go('reports'); await click('.tab_button_reports_3');
  await intercept('RecordsReg', `(name, mime, text) => window.__saved.push({ name, text })`);
  await click('.button_lists_csv'); await click('.button_lists_dat');
  for (const f of await saved()) { fs.writeFileSync(path.join(OUT, 'files', f.name), f.text); console.log('file', f.name); }

  await loginAs('Carmela T. Rivera');
  const key = await ev(`(OpsReg.periods().find(p=>/Q4/.test(p.key))||OpsReg.periods()[1]).key`);
  await go('opsReports', { period: key });
  await intercept('OpsReg', `(name, text) => window.__saved.push({ name, text })`);
  const kinds = await ev(`Object.keys(OpsReg.REPORTS)`);
  for (const k of kinds) await click(`.button_ops_rep[data-kind="${k}"]`);
  for (const f of await saved()) { const k = (f.name.match(/^epi-(\w+)-report/) || [])[1]; if (k) { fs.writeFileSync(path.join(OUT, 'files', `13-20-bir-report-${k}-${key}.json`), f.text); console.log('file', `13-20-bir-report-${k}-${key}.json`); } }
  await go('opsAudit'); await intercept('OpsReg', `(name, text) => window.__saved.push({ name, text })`);
  await click('.button_ops_audit_csv');
  for (const f of await saved()) { fs.writeFileSync(path.join(OUT, 'files', '13-21-epi-audit-log.csv'), f.text); console.log('file 13-21-epi-audit-log.csv'); }
} finally { await b.close(); }
