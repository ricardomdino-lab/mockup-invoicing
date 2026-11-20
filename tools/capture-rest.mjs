// The rest of the Annex A samples, from the running mockup (needs `node serve` on :8765).
//   node tools/capture-rest.mjs <output folder>
// Companion to capture-samples.mjs. It replays the demonstration stories on a fresh seed:
//   - the four statutory-discount invoices (12.3 to 12.6), issued from a client that sells discount-eligible goods
//   - an EPI service interruption on EPI's own account: waiting sales, manual invoices, restoration and the
//     e-invoice issued from a queued receipt (12.7, 13.14, 13.15a, 13.15b)
//   - the evidence of attempted transmission, the certificate of provider-caused delay and the incident report
//     (12.10 to 12.12), as HTML and PDF
//   - the incident log and service status (13.19, 13.20)
//   - the Item 10 and Item 11 screenshots (menu, accreditation tab, online and offline indicator, banner)
import fs from 'node:fs';
import path from 'node:path';
import { launch } from './cdp.mjs';

const OUT = path.resolve(process.argv[2] || 'samples-rest');
for (const d of ['pdf', 'png', 'html']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const b = await launch('http://localhost:8765/index.html', { width: 1100, height: 900 });
const ev = e => b.eval(e);

const loginAs = async name => { await ev(`(()=>{ const u=Store.db.users.find(x=>x.name===${JSON.stringify(name)}); Auth.enter(u); })()`); await sleep(1500); };
const go = async (screen, opts) => { await ev(`Nav.go(${JSON.stringify(screen)}, ${JSON.stringify(opts || null)})`); await sleep(1800); };
const click = async sel => { await ev(`$(${JSON.stringify(sel)}).trigger('click')`); await sleep(900); };
const out = (...p) => path.join(OUT, ...p);

/* A screen element, with a title block, as one tall image at 2x (same as capture-samples.mjs). */
const shot = async (file, selector, titleHtml, width = 1047) => {
  const clip = await ev(`(()=>{ const el=${selector.startsWith('js:') ? selector.slice(3) : 'document.querySelector(' + JSON.stringify(selector) + ')'}; if(!el) return null;
    document.querySelectorAll('#cap-wrap').forEach(e=>e.remove());
    const w=document.createElement('div'); w.id='cap-wrap';
    w.style.cssText='position:absolute;left:0;top:0;width:${width}px;background:#fff;padding:20px 24px 24px;z-index:99999;box-sizing:border-box;';
    w.innerHTML=${JSON.stringify(titleHtml)}; w.appendChild(el.cloneNode(true)); document.body.appendChild(w);
    w.querySelectorAll('.d-none').forEach(e=>{ if(e.classList.contains('tab_content')) e.classList.remove('d-none'); });
    const r=w.getBoundingClientRect(); return { x:0, y:0, width:r.width, height:r.height, scale:1 }; })()`);
  if (!clip) { console.log('MISSING', file, selector); return; }
  fs.writeFileSync(out('png', file), await b.screenshot(clip)); console.log('png ', file, clip.height);
  await ev(`document.querySelectorAll('#cap-wrap').forEach(e=>e.remove())`);
};
const head = (co, tin, title, sub) => `<div style="font-family:inherit;margin-bottom:10px"><div style="font-weight:700;font-size:15px">${co} · TIN ${tin}</div>
  <div style="font-weight:700;font-size:20px;margin-top:2px">${title}</div>${sub ? `<div style="color:#555;font-size:13px">${sub}</div>` : ''}</div>`;
/* A part of the live screen, as it looks, at 2x. */
const clipShot = async (file, rectJs) => {
  const r = await ev(`(()=>{ const b=(${rectJs})(); if(!b) return null; window.scrollTo(0,0); return { x:b.x, y:b.y, width:b.w, height:b.h, scale:1 }; })()`);
  if (!r) { console.log('MISSING', file); return; }
  fs.writeFileSync(out('png', file), await b.screenshot(r)); console.log('png ', file, r.width + 'x' + r.height);
};
const docShot = async (file, id) => { await go('invoices', { docId:id }); await shot(file, "js:document.querySelector('.invform').closest('.doc-stage')", '', 1000); };
const say = (label, r) => console.log(label, r && r.success === false ? 'FAILED: ' + r.message : 'ok');

try {
  /* ---- Item 10 and 11: the menu, the About the service section of the Terms page, the online and offline indicator ---- */
  await loginAs('Rodrigo L. Evangelista');
  await go('home');
  await clipShot('10-02-sidebar.png', `()=>{ const e=document.querySelector('aside.sidebar'), r=e.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height }; }`);
  const eis = `()=>{ const d=document.querySelector('.sidebar_demo'), r=d.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:101 }; }`;
  await clipShot('11-01-online-indicator.png', eis);
  await b.goto('http://localhost:8765/terms.html');
  await clipShot('10-03-terms-about-the-service.png', `()=>{ const h=[...document.querySelectorAll('h2')].find(x=>/About the service/i.test(x.innerText)); if(!h) return null; const r=h.getBoundingClientRect(), m=document.querySelector('.lp-terms').getBoundingClientRect(); return { x:m.left, y:r.top + window.scrollY - 10, w:m.width, h:Math.min(760, document.documentElement.scrollHeight - (r.top + window.scrollY) - 10) }; }`);
  await b.goto('http://localhost:8765/index.html');

  /* an open BIR EIS interruption: the indicator goes offline and the banner appears */
  await loginAs('Carmela T. Rivera');
  say('EIS interruption', await ev(`ResReg.start('EIS', 'BIR EIS not answering (demonstration)')`));
  await loginAs('Rodrigo L. Evangelista'); await go('home');
  await clipShot('11-02-offline-indicator.png', eis);
  await clipShot('11-03-offline-banner.png', `()=>{ const e=[...document.querySelectorAll('div')].find(d=>/^BIR EIS unavailable/.test(d.innerText.trim()) && d.getBoundingClientRect().height<120); if(!e) return null; const r=e.getBoundingClientRect(); return { x:r.left, y:r.top, w:r.width, h:r.height }; }`);
  await loginAs('Carmela T. Rivera');
  say('EIS interruption closed', await ev(`ResReg.end()`));

  /* ---- 12.3 to 12.6: one invoice for each statutory discount, from a client that sells discount-eligible goods ---- */
  await loginAs('Marites B. Sandoval');
  const sale = (n, over) => `(()=>{ const items=Store.db.items; const L=(id,q)=>({ itemId:id, qty:q, unitPrice:items.find(x=>x.id===id).price, scEligible:true });
    return IssueReg.issue(Object.assign({ branchId:'b_bmc_000', at:new Date(Date.now()-${n} * 3600000).toISOString(), paymentStatus:'PAID', paymentMethod:'Cash' }, ${over})); })()`;
  const issue = async (file, over) => {
    const r = await ev(sale(1, over)); say(file, r);
    if (r && r.id) await docShot(file, r.id);
  };
  await issue('12-03-electronic-invoice-senior-citizen.png', `{ buyer:{ name:'Bienvenido S. Torres', address:'14 Mabini St., Makati City' }, scpwd:{ on:true, type:'Senior Citizen', id:'SC-NCR-2016-08834', name:'Bienvenido S. Torres' },
    lines:[ L('i_bmc_5', 2), L('i_bmc_8', 1) ] }`.replace(/L\(/g, 'L('));
  await issue('12-04-electronic-invoice-pwd.png', `{ buyer:{ name:'Liza M. Marquez', address:'3 Aguinaldo Ave., Makati City' }, scpwd:{ on:true, type:'Person with Disability', id:'PWD-NCR-2021-15520', name:'Liza M. Marquez' },
    lines:[ L('i_bmc_8', 3), L('i_bmc_5', 1) ] }`);
  await issue('12-05-electronic-invoice-athlete.png', `{ buyer:{ name:'Ramil C. Dizon', address:'21 Pioneer St., Mandaluyong City' }, scpwd:{ on:true, type:'Athlete or Coach', id:'PNSTM-2024-00871', name:'Ramil C. Dizon' },
    lines:[ L('i_bmc_12', 1), L('i_bmc_8', 2) ] }`);
  await issue('12-06-electronic-invoice-solo-parent.png', `{ buyer:{ name:'Grace A. Tan', address:'88 Rizal Ave., Pasig City' }, scpwd:{ on:true, type:'Solo Parent', id:'SPIC-2025-04417', name:'Grace A. Tan', children:'Mika A. Tan, aged 4' },
    lines:[ L('i_bmc_9', 2), L('i_bmc_10', 1) ] }`);
  /* the helper L is defined inside sale(); the line lists above are evaluated there */

  /* ---- an EPI service interruption on EPI's own account ---- */
  await loginAs('Carmela T. Rivera');
  say('ESP interruption', await ev(`ResReg.start('ESP', 'Planned database migration ran past its window (demonstration)')`));
  await loginAs('Nestor B. Calderon');
  const epiSale = (mins, over) => `(()=>{ const items=Store.db.items; const L=(id,q)=>({ itemId:id, qty:q, unitPrice:items.find(x=>x.id===id).price });
    return IssueReg.issue(Object.assign({ branchId:'b_epi_000', at:new Date(Date.now()-${mins} * 60000).toISOString(), paymentStatus:'PAID', paymentMethod:'Bank Transfer' }, ${over})); })()`;
  say('queued 1', await ev(epiSale(26, `{ buyer:{ name:'Sampaloc Learning Center, Inc.', tin:'447-210-668', address:'purchasing@sampaloclearning.ph' }, lines:[ L('i_epi_2', 2), L('i_epi_3', 4) ] }`)));
  say('queued 2', await ev(epiSale(18, `{ buyer:{ name:'Malolos Trading and Supply', tin:'227-884-150', address:'accounts@malolostrading.ph' }, lines:[ L('i_epi_1', 60) ] }`)));
  say('queued 3', await ev(epiSale(9, `{ buyer:{ name:'Caloocan Food Ventures Corp.', tin:'562-007-319', address:'finance@caloocanfood.ph' }, lines:[ L('i_epi_5', 6), L('i_epi_3', 2) ] }`)));
  /* a manual invoice written by hand in the plant during the outage */
  say('manual', await ev(`(()=>{ const items=Store.db.items, it=items.find(x=>x.id==='i_epi_6'); const int=Store.db.interruptions.find(x=>!x.endedAt);
    const p={ branchId:'b_epi_000', at:new Date(Date.now()-14*60000).toISOString(), paymentStatus:'PAID', paymentMethod:'Cash', manualNo:'MI-0001', interruptionId:int.id,
      buyer:{ name:'Valenzuela Hardware and Industrial Corp.', tin:'318-559-004', address:'procurement@valenzuelahardware.ph' }, lines:[{ itemId:it.id, qty:1, unitPrice:it.price }] };
    const v=IssueReg.validate(p), errs=ResReg.validateManual(p).concat(v.errors); if(errs.length) return { success:false, message:errs[0] };
    ResReg.record(p, v); Store.save(Store.db); return { success:true }; })()`));

  const co = 'Eastland Printink, Inc.', tin = '005-743-462';
  await go('invoices');
  await click('.tab_button_invoices_4');
  await shot('13-11-waiting-sales-during-outage.png', '.tab_content_invoices_4', head(co, tin, 'Waiting Sales, during an EPI service interruption'));

  await loginAs('Carmela T. Rivera');
  say('service returned', await ev(`ResReg.end()`));
  await sleep(1500);
  await loginAs('Nestor B. Calderon');
  await go('invoices'); await click('.tab_button_invoices_4');
  await shot('13-13-waiting-sales-after-restoration.png', '.tab_content_invoices_4', head(co, tin, 'Waiting Sales, after service returned'));
  await click('.tab_button_invoices_3');
  await shot('13-12-manual-invoices.png', '.tab_content_invoices_3', head(co, tin, 'Manual Invoices'));
  const qid = await ev(`(Store.db.invoices.find(i=>i.tenantId==='t_epi' && i.queuedRef)||{}).id`);
  if (qid) await docShot('12-14-electronic-invoice-waiting-sale.png', qid); else console.log('NO queued e-invoice');

  /* ---- 13.19 and 13.20: the provider's incident log and service status, now with the interruptions above ---- */
  await loginAs('Carmela T. Rivera');
  await go('opsIncidents');
  await shot('13-23-incident-log.png', '#content', '', 1047);
  await go('opsService');
  await shot('13-24-service-status.png', '#content', '', 1047);

  /* ---- 12.10 to 12.12: evidence, certificate and incident report, as HTML ---- */
  const save = (name, html) => { fs.writeFileSync(out('html', name), html); console.log('html', name, html.length); };
  await loginAs('Ramon T. Villaflor');
  const evi = await ev(`ResReg.evidenceHtml().then(e => e.html)`); save('12-10-evidence-of-attempted-transmission.html', evi);
  await loginAs('Carmela T. Rivera');
  say('problem report reviewed', await ev(`(()=>{ const r=Store.db.problemReports[0]; return ResReg.confirm(r.id, 'Reviewed against the attempt log and the interruption record.'); })()`));
  await loginAs('Ramon T. Villaflor');
  const cert = await ev(`(async()=>{ const r=ResReg.reports().find(x=>x.certificate); return r ? (await ResReg.certificateHtml(r)).html : ''; })()`);
  if (cert) save('12-13-certificate-of-provider-caused-delay.html', cert); else console.log('NO certificate issued');
  await loginAs('Carmela T. Rivera');
  const rep = await ev(`IncReg.reportHtml(Store.db.incidents.find(i=>i.critical && i.writtenReport))`); save('12-12-incident-report-to-bir.html', rep);

  /* HTML to PDF, A4 */
  for (const f of fs.readdirSync(out('html'))) {
    await b.goto('file://' + out('html', f));
    const r = await b.send('Page.printToPDF', { printBackground:true, paperWidth:8.27, paperHeight:11.69, marginTop:0.4, marginBottom:0.4, marginLeft:0.4, marginRight:0.4 });
    fs.writeFileSync(out('pdf', f.replace(/\.html$/, '.pdf')), Buffer.from(r.data, 'base64')); console.log('pdf ', f);
  }
} finally { await b.close(); }
