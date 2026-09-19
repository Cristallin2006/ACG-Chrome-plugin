// README screenshot generator: renders the real extension UI (tiling, capsule,
// spotlight scrim, popup) but swaps every illustration for a generated gradient,
// so the shots carry no copyrighted artwork and can be published safely.
//
//   node test/shot-readme.mjs
//
// Output: docs/screenshots/newtab-wall.png, newtab-spotlight.png, popup.png

import { spawn, spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EXTENSION = path.resolve(here, '..', 'release')
const PROFILE = path.join(here, '.profile-shot')
const OUT = path.resolve(here, '..', 'docs', 'screenshots')
const sleep = ms => new Promise(r => setTimeout(r, ms))

class Cdp {
  constructor(child) {
    this.toChrome = child.stdio[3]
    this.fromChrome = child.stdio[4]
    this.seq = 0
    this.pending = new Map()
    this.buffer = ''
    this.fromChrome.on('data', chunk => this.consume(chunk))
  }
  consume(chunk) {
    this.buffer += chunk.toString('utf8')
    let end
    while ((end = this.buffer.indexOf('\0')) !== -1) {
      const raw = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      if (!raw.trim()) continue
      try {
        this.dispatch(JSON.parse(raw))
      } catch {}
    }
  }
  dispatch(msg) {
    if (msg.id === undefined) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
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
  async attach(targetId) {
    const { sessionId } = await this.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    const send = (method, params = {}) => this.send(method, params, sessionId)
    await send('Runtime.enable')
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description || r.exceptionDetails.text,
        )
      }
      return r.result.value
    }
    return { send, evaluate }
  }
}

async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const value = await fn()
      if (value) return value
    } catch (e) {
      last = e.message
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${label} (${JSON.stringify(last)})`)
}

async function shot(session, name) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(OUT, { recursive: true })
  const file = path.join(OUT, name)
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`screenshot: ${file}`)
}

// The darkroom palette from the design previews, as tiny canvas gradients.
// Swapping src keeps the tile frame, grout, and Ken Burns settle intact.
const SWAP_IMAGES = `(() => {
  const palettes = [
    ['#a8d8d2', '#3f8f8a', '#1e4550'],
    ['#f2c98a', '#e07856', '#8a3a4e'],
    ['#8aa8c8', '#40618e', '#1d2c46'],
    ['#e89aa2', '#b23a48', '#4e1f2c'],
    ['#f2e6c8', '#d4b483', '#8a6f42'],
    ['#f4c9d4', '#de84a6', '#7e4060'],
    ['#eed49a', '#c08a3e', '#5e421e'],
    ['#cbe4be', '#78a874', '#33503a'],
    ['#6a6058', '#3a332c', '#211d19'],
    ['#f6cfa8', '#e08a5e', '#8a4a30'],
    ['#c9c2b6', '#8d8375', '#4a4238'],
  ]
  const imgs = Array.from(document.querySelectorAll('.kunya-tile img'))
  imgs.forEach((img, i) => {
    const p = palettes[i % palettes.length]
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 40, 64)
    g.addColorStop(0, p[0])
    g.addColorStop(0.55, p[1])
    g.addColorStop(1, p[2])
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    img.src = canvas.toDataURL()
  })
  return imgs.length
})()`

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
    await waitFor(() => cdp.send('Browser.getVersion').catch(() => null), 30000, 'browser')
    const { id: extensionId } = await cdp.send('Extensions.loadUnpacked', {
      path: EXTENSION,
    })
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const tab = await cdp.attach(targetId)
    await waitFor(
      async () => {
        const n = await tab.evaluate(
          `Array.from(document.querySelectorAll('.kunya-gallery img')).filter(i => Number(getComputedStyle(i).opacity) > 0.9).length`,
        )
        return n > 0 ? n : null
      },
      60000,
      'wall tiles',
    )
    const swapped = await tab.evaluate(SWAP_IMAGES)
    console.log(`swapped ${swapped} illustrations for gradients`)
    await sleep(800) // let the swapped images settle into their frames

    // Wake the capsule out of its watch-mode ghost for the portrait.
    await tab.evaluate(`document.dispatchEvent(new PointerEvent('pointermove'))`)
    await sleep(400)
    await shot(tab, 'newtab-wall.png')

    await tab.evaluate(`(() => {
      const input = document.querySelector('.kunya-search__input')
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'pixiv 排行榜')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(900) // rise + label/hint delays, then settle
    await shot(tab, 'newtab-spotlight.png')

    const popupTarget = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup.html`,
    })
    const popup = await cdp.attach(popupTarget.targetId)
    await waitFor(
      () => popup.evaluate(`document.querySelectorAll('input').length > 0 || null`),
      20000,
      'popup controls',
    )
    await sleep(600)
    // The panel is taller than the window: pin the viewport to the content's
    // full height so the shot shows every group, at 2x for the README.
    const panelHeight = await popup.evaluate(
      `document.documentElement.scrollHeight`,
    )
    await popup.send('Emulation.setDeviceMetricsOverride', {
      width: 400,
      height: Math.min(Math.ceil(panelHeight), 2000),
      deviceScaleFactor: 2,
      mobile: false,
    })
    await sleep(300)
    await shot(popup, 'popup.png')
    await popup.send('Emulation.clearDeviceMetricsOverride')
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
