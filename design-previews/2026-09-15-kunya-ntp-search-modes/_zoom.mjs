// Throwaway: zoom into the capsule rect on the assembled page.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'

const ROOT = 'C:\\Users\\Lenovo\\Desktop\\src\\ku-nya-mv3\\design-previews\\2026-09-15-kunya-ntp-search-modes'
const TMP = mkdtempSync(join(tmpdir(), 'dir-a-zoom-'))
const HTTP_PORT = 8809, CDP_PORT = 9344
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

async function shoot(name, clipScale) {
  const box = await S('Runtime.evaluate', { expression: `(function(){var c=document.querySelector('.dir-a-stage .dir-a-capwrap');var r=c.getBoundingClientRect();return JSON.stringify({x:r.left-30,y:r.top-40,w:r.width+60,h:r.height+80});})()`, returnByValue: true })
  const b = JSON.parse(box.result.value)
  const png = await S('Page.captureScreenshot', { format: 'png', clip: { x: b.x, y: b.y, width: b.w, height: b.h, scale: clipScale } })
  const f = join(TMP, name + '.png')
  writeFileSync(f, Buffer.from(png.data, 'base64'))
  return { file: f, rect: b }
}

const before = await shoot('before', 3)
// Force-opacity probe: is the computed opacity the only reason it is invisible?
const info = await S('Runtime.evaluate', {
  expression: `(function(){
    var c=document.querySelector('.dir-a-stage .dir-a-capwrap');
    var out={};
    out.computedOpacity=getComputedStyle(c).opacity;
    // find every rule that sets opacity affecting this node
    var hits=[];
    for (var i=0;i<document.styleSheets.length;i++){
      var sh=document.styleSheets[i];
      var rules; try{rules=sh.cssRules;}catch(e){continue;}
      (function walk(rs){ for(var j=0;j<rs.length;j++){ var r=rs[j];
        if(r.cssRules){ walk(r.cssRules); continue; }
        if(!r.selectorText) continue;
        if(r.style && r.style.opacity!=='' && r.selectorText.indexOf('capwrap')>=0){
          var m=false; try{ m=c.matches(r.selectorText); }catch(e){}
          hits.push({sel:r.selectorText,op:r.style.opacity,matches:m,media:(r.parentRule&&r.parentRule.conditionText)||''});
        }
      }})(rules);
    }
    out.opacityRules=hits;
    return JSON.stringify(out,null,1);
  })()`,
  returnByValue: true,
})
console.log('BEFORE:', before.file)
console.log(info.result.value)
console.log('TMP:', TMP)
ws.close(); chrome.kill(); server.close(); process.exit(0)
