// Renders the sample invoice for the landing page with the real renderer, as a picture. node tools/landing-invoice.mjs <out.png>
import fs from 'node:fs'; import { launch } from './cdp.mjs';
const b = await launch('http://localhost:8765/index.html', { width: 1100, height: 900 });
const html = await b.eval(`(() => {
  const db = Store.db;
  db.tenants.push({ id:'t_lp', name:'Sample Trading Co.', tradeName:null, tin:'123-456-789', vatStatus:'VAT', seriesPrefix:'INV', pti:'BIR-PTI-2026-00123', ptiIssuedAt:'2026-01-15', goLiveAt:'2026-01-20', connection:['MANUAL'], template:null });
  db.branches.push({ id:'b_lp', tenantId:'t_lp', code:'000', name:'Head Office', address:'Unit 4B, Fortune Corporate Plaza, Ortigas Center, Pasig City', rdo:'RDO 043', active:true });
  const lines = [{ desc:'Offset printing, 4-color, 5,000 pcs', qty:1, unit:'', unitPrice:96000, treatment:'VATABLE' }, { desc:'Lamination, matte finish', qty:1, unit:'', unitPrice:12400, treatment:'VATABLE' }];
  const inv = { id:'lp1', tenantId:'t_lp', branchId:'b_lp', docType:'INVOICE', docStatus:'ISSUED', number:'INV0000142', issuedAt:'2026-08-24T11:40:00+08:00', recordedAt:'2026-08-24T11:40:00+08:00',
    buyer:{ name:'Northgate Facilities Management Inc.', tin:'221-558-902-000', address:'38 Kalayaan Avenue, Quezon City' }, lines, totals:computeTotals(lines, 0, {}),
    keycode:'7F3K9QXM', transmissionRef:'ESRS-20260824-48213', paymentMethod:'Bank Transfer', paymentStatus:'PAID', issuedBy:'Sample User', issuedVia:'DIS web' };
  const h = InvoiceDoc.render(inv, { template:Object.assign({}, InvoiceDoc.DEFAULTS, { mark:'INV', logo:'img/dis-mark.png', showSku:false }) });
  db.tenants.pop(); db.branches.pop(); return h; })()`);
await b.eval(`(() => { document.body.insertAdjacentHTML('beforeend', '<div id="lp-cap" style="position:absolute;left:0;top:0;width:1000px;background:#fff;z-index:99999">' + ${JSON.stringify(html)} + '</div>'); return true; })()`);
await b.eval('document.fonts.ready.then(() => true)'); await new Promise(r => setTimeout(r, 1200));
const r = await b.eval(`(() => { const e = document.querySelector('#lp-cap'); const x = e.getBoundingClientRect(); return { x:0, y:0, width:x.width, height:x.height, scale:1 }; })()`);
fs.writeFileSync(process.argv[2], await b.screenshot(r)); await b.close();
