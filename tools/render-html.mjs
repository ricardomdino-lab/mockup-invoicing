// Renders a local HTML file to PNG and PDF. node tools/render-html.mjs <file.html> <out-base> <width>
import fs from 'node:fs'; import path from 'node:path'; import { launch } from './cdp.mjs';
const [file, base, w] = [process.argv[2], process.argv[3], +process.argv[4] || 1330];
const b = await launch('file://' + path.resolve(file), { width: w, height: 1200 });
await b.eval('document.fonts.ready.then(() => true)');
const h = Math.ceil(await b.eval("document.querySelector('.sheet').getBoundingClientRect().height"));
fs.writeFileSync(base + '.png', await b.screenshot({ x: 0, y: 0, width: w, height: h, scale: 1 }));
const pdf = await b.send('Page.printToPDF', { printBackground: true, paperWidth: w / 96, paperHeight: h / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
fs.writeFileSync(base + '.pdf', Buffer.from(pdf.data, 'base64'));
await b.close();
