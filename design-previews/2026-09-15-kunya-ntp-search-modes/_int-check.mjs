// Throwaway: verify dir-a inside the ASSEMBLED index.html (integration check).
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = 'C:\\Users\\Lenovo\\Desktop\\src\\ku-nya-mv3\\design-previews\\2026-09-15-kunya-ntp-search-modes'
const TMP = mkdtempSync(join(tmpdir(), 'dir-a-int-'))
const HTTP_PORT = 8807, CDP_PORT = 9342
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
const errs = []
await new Promise((r) => ws.addEventListener('open', r))
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result) }
})
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })) })
const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
const S = (m, p) => send(m, p, sessionId)
await S('Page.enable'); await S('Runtime.enable')

const PROBE = `(function(){
  var st=document.querySelector('.dir-a-stage');
  if(!st) return JSON.stringify({found:false});
  var sr=st.getBoundingClientRect();
  var cols=st.querySelectorAll('.dir-a-col');
  var bullets=[]; st.querySelectorAll('.dir-a-item').forEach(function(t){var r=t.getBoundingClientRect(); if(r.top<sr.bottom&&r.bottom>sr.top) bullets.push(r);});
  var lanes=[]; cols.forEach(function(c){lanes.push(c.getBoundingClientRect());});
  var worst=0;
  lanes.forEach(function(lane){var run=0,max=0;
    for(var y=0;y<Math.round(sr.height);y+=2){var absY=sr.top+y,cov=false;
      for(var i=0;i<bullets.length;i++){var t=bullets[i];if(absY>=t.top&&absY<t.bottom&&t.left<lane.right&&t.right>lane.left){cov=true;break;}}
      if(cov){run=0;}else{run+=2;if(run>max)max=run;}}
    if(max>worst)worst=max;});
  var maxRight=0; bullets.forEach(function(t){if(t.right>maxRight)maxRight=t.right;});
  return JSON.stringify({
    found:true,
    stage:Math.round(sr.width)+'x'+Math.round(sr.height),
    cols:cols.length,
    visibleBullets:bullets.length,
    maxEmptyRunPct:+((worst/sr.height)*100).toFixed(1),
    rightBlankPct:+(((sr.right-maxRight)/sr.width)*100).toFixed(1),
    stageOverflowX: st.scrollWidth>st.clientWidth,
    imgsOk: Array.prototype.every.call(st.querySelectorAll('.dir-a-img'),function(i){return i.naturalWidth>0;}),
    mode: st.getAttribute('data-mode'),
    inputFontPx:getComputedStyle(st.querySelector('.dir-a-input')).fontSize,
    replayBg:getComputedStyle(st.querySelector('.dir-a-replay')).backgroundColor,
    hintW:getComputedStyle(st.querySelector('.dir-a-hint[data-for=watch]')).textContent
  });
})()`

const out = []
for (const vw of [1440, 880, 480]) {
  await S('Emulation.setDeviceMetricsOverride', { width: vw, height: 1000, deviceScaleFactor: 1, mobile: vw < 600 })
  await S('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/index.html` })
  await sleep(2200)
  const r = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true })
  const o = JSON.parse(r.result.value)
  o.viewport = vw
  if (o.found) {
    const box = await S('Runtime.evaluate', { expression: `(function(){var r=document.querySelector('.dir-a-stage').getBoundingClientRect();return JSON.stringify({x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)});})()`, returnByValue: true })
    const b = JSON.parse(box.result.value)
    vw === 1440 ? null : null
    const png = await S('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: 1 } })
    writeFileSync(join(TMP, `int-${vw}.png`), Buffer.from(png.data, 'base64'))
    o.shot = join(TMP, `int-${vw}.png`)
  }
  out.push(o)
}
console.log(JSON.stringify(out, null, 2))
console.log('EXCEPTIONS:', JSON.stringify(errs))
console.log('SHOTS DIR:', TMP)
ws.close(); chrome.kill(); server.close(); process.exit(0)
