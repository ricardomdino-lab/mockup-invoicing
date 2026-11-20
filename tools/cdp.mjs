// A very small Chrome DevTools Protocol client, no dependencies (Node 22+ has WebSocket).
// Drives the cached headless Chromium that Playwright installed, to run the mockup and take its PDFs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');

export async function launch(url, { port = 9333, width = 1500, height = 1100 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dis-cap-'));
  const proc = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false });
  const api = {
    send,
    async goto(u) { await send('Page.navigate', { url: u }); await new Promise(r => setTimeout(r, 2500)); },
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result.value;
    },
    async screenshot(clip) { const r = await send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: true }); return Buffer.from(r.data, 'base64'); },
    async close() { try { await send('Browser.close'); } catch {} ws.close(); proc.kill(); await new Promise(r => setTimeout(r, 500)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {} }
  };
  await api.goto(url);
  return api;
}
