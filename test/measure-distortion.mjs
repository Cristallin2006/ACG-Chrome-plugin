// Measures real in-browser distortion: each gallery img's rendered aspect
// vs its natural aspect. Reuses the e2e CDP plumbing (pipe transport).
import { spawn, spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EXTENSION = path.resolve(here, '..', 'release')
const PROFILE = path.join(here, '.profile-measure')

const sleep = ms => new Promise(r => setTimeout(r, ms))

class Cdp {
  constructor(child) {
    this.toChrome = child.stdio[3]
    this.fromChrome = child.stdio[4]
    this.seq = 0
    this.pending = new Map()
    this.buffer = ''
    this.fromChrome.on('data', c => {
      this.buffer += c.toString('utf8')
      let end
      while ((end = this.buffer.indexOf('\0')) !== -1) {
        const raw = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        if (!raw.trim()) continue
        let msg
        try {
          msg = JSON.parse(raw)
        } catch {
          continue
        }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
        }
      }
    })
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    this.toChrome.write(JSON.stringify(payload) + '\0')
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 30000)
    })
  }
}

async function main() {
  spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', PROFILE], { stdio: 'ignore' })
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--disable-component-update',
      '--enable-unsafe-extension-debugging',
      '--remote-debugging-pipe',
      '--window-size=1280,800',
      '--headless=new',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  )
  const cdp = new Cdp(child)
  try {
    const deadline = Date.now() + 30000
    let version = null
    while (Date.now() < deadline && !version) {
      version = await cdp.send('Browser.getVersion').catch(() => null)
      if (!version) await sleep(400)
    }
    const loaded = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION })
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const { sessionId } = await cdp.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    await cdp.send('Runtime.enable', {}, sessionId)
    const evalIn = async expr => {
      const r = await cdp.send(
        'Runtime.evaluate',
        { expression: expr, awaitPromise: true, returnByValue: true },
        sessionId,
      )
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
      return r.result.value
    }
    // wait for images to render and load
    let rows = null
    const dl = Date.now() + 45000
    while (Date.now() < dl) {
      rows = await evalIn(`(() => {
        const imgs = [...document.querySelectorAll('.kunya-tile img')]
        if (!imgs.length) return null
        return imgs.map(img => {
          const r = img.getBoundingClientRect()
          return {
            rendered: +(r.width / r.height).toFixed(4),
            natural: img.naturalWidth ? +(img.naturalWidth / img.naturalHeight).toFixed(4) : null,
            nw: img.naturalWidth,
            nh: img.naturalHeight,
            cw: Math.round(r.width),
            complete: img.complete,
            src: img.src.slice(-40),
          }
        })
      })()`).catch(() => null)
      if (rows && rows.every(r => r.complete && r.natural)) break
      await sleep(600)
    }
    if (!rows) throw new Error('no tiles rendered')
    let worst = 0
    for (const r of rows) {
      if (!r.natural) {
        console.log(`  ?? not loaded: ${r.src}`)
        continue
      }
      const err = (Math.abs(r.rendered - r.natural) / r.natural) * 100
      worst = Math.max(worst, err)
      console.log(
        `  ${err > 2 ? 'BAD ' : 'ok  '} rendered=${r.rendered} natural=${r.natural} err=${err.toFixed(2)}%  ${r.nw}x${r.nh}px shown@${r.cw}w  ${r.src}`,
      )
    }
    console.log(`worst distortion: ${worst.toFixed(2)}%  over ${rows.length} tiles`)
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
    spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', PROFILE], { stdio: 'ignore' })
  }
}

main().catch(e => {
  console.error('FAILED:', e.message)
  process.exit(1)
})
