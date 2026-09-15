// Throwaway: why is .dir-a-capwrap invisible inside the assembled page?
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, mkdtempSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = 'C:\\Users\\Lenovo\\Desktop\\src\\ku-nya-mv3\\design-previews\\2026-09-15-kunya-ntp-search-modes'
const TMP = mkdtempSync(join(tmpdir(), 'dir-a-diag-'))
const HTTP_PORT = 8808, CDP_PORT = 9343
const MIME = { '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }
const server = createServer((req, res) => {
  try {
    const p = decodeURIComponent(req.url.split('?')[0])
    const buf = readFileSync(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, '')))
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' }).end(buf)
  } catch { res.writeHead(404).end('nope') }
})
await new Promise((r) => server.listen(HTTP_PORT, '127.0.0.1', r))
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--remote-debugging-port=' + CDP_PORT, '--hide-scrollbars', '--no-first-run', '--user-data-dir=' + join(TMP, 'p'), 'about:blank'], { stdio: 'ignore' })
async function dt() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); if (r.ok) return (await r.json()).webSocketDebuggerUrl } catch {} await sleep(250) } throw new Error('no devtools') }
const ws = new WebSocket(await dt()); const pending = new Map(); let id = 0
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) } })
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)
await S('Page.enable'); await S('Runtime.enable')
await S('Emulation.setDeviceMetricsOverride', { width: 880, height: 1000, deviceScaleFactor: 1, mobile: false })
await S('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` })
await sleep(2500)

const P = `(function(){
  var st=document.querySelector('.dir-a-stage');
  var flow=st.querySelector('.dir-a-flow');
  var cap=st.querySelector('.dir-a-capwrap');
  var inp=st.querySelector('.dir-a-input');
  var top=st.querySelector('.dir-a-topbar');
  var cs=getComputedStyle(cap);
  var r=cap.getBoundingClientRect();
  // walk ancestors for clipping / opacity / display
  var anc=[], el=cap;
  while(el && el!==document.documentElement){
    var c=getComputedStyle(el);
    anc.push((el.className||el.tagName)+'|op:'+c.opacity+'|disp:'+c.display+'|vis:'+c.visibility+'|ov:'+c.overflow+'|tf:'+c.transform+'|z:'+c.zIndex+'|ct:'+(c.containerType||'-'));
    el=el.parentElement;
  }
  return JSON.stringify({
    dataRun: flow.getAttribute('data-run'),
    stageMode: st.getAttribute('data-mode'),
    capRect: Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height),
    capOpacity: cs.opacity, capDisplay: cs.display, capVisibility: cs.visibility,
    capTransform: cs.transform, capBg: cs.backgroundColor,
    capBoxShadow: cs.boxShadow.slice(0,60),
    capWidthRule: cs.width,
    inputRect: (function(){var b=inp.getBoundingClientRect();return Math.round(b.left)+','+Math.round(b.top)+' '+Math.round(b.width)+'x'+Math.round(b.height);})(),
    inputOpacity: getComputedStyle(inp).opacity,
    topbarRect: (function(){var b=top.getBoundingClientRect();return Math.round(b.left)+','+Math.round(b.top)+' '+Math.round(b.width)+'x'+Math.round(b.height);})(),
    stageRect: (function(){var b=st.getBoundingClientRect();return Math.round(b.left)+','+Math.round(b.top)+' '+Math.round(b.width)+'x'+Math.round(b.height);})(),
    ancestors: anc.slice(0,9)
  }, null, 1);
})()`
const r = await S('Runtime.evaluate', { expression: P, returnByValue: true })
console.log(r.result.value)
console.log('TMP:', TMP)
ws.close(); chrome.kill(); server.close(); process.exit(0)
