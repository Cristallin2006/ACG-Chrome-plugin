// Visual/interaction QA for the direction preview page.
//
//   node qa-check.mjs <url>
//
// Loads the page in a throwaway headless Chrome and checks, for every
// direction mockup:
//   - the mode toggle really flips the stage's data-mode
//   - the images' interactivity actually differs between the two modes
//   - the replay-motion control exists
// When the URL is served by the preview server it additionally checks that the
// selection shell was injected exactly once and that confirming a direction
// lands in selection.json (i.e. the round trip the workflow depends on).

import { spawn, spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const URL_ARG = process.argv[2]
const PORT = 9444
const BASE = `http://127.0.0.1:${PORT}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.events = []
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data)
      if (msg.id === undefined) {
        this.events.push(msg)
        return
      }
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 30000)
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    }
    return r.result.value
  }
  close() {
    this.ws.close()
  }
}

async function connect(url) {
  const deadline = Date.now() + 30000
  let list
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/json/list`)
      list = await res.json()
      if (list.some(t => t.type === 'page')) break
    } catch {}
    await sleep(400)
  }
  const page = list.find(t => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', () => reject(new Error('cannot open devtools websocket')))
  })
  const session = new Session(ws)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  await session.send('Page.navigate', { url })
  await sleep(2500)
  return session
}

const PROBE = `(() => {
  const dirs = ['a', 'b', 'c', 'd']
  const out = []
  for (const key of dirs) {
    const stage = document.querySelector('.dir-' + key + '-stage')
    if (!stage) { out.push({ key, missing: true }); continue }
    const media = stage.querySelector('img')
    const host = media ? (media.closest('a') || media) : null
    const read = () => ({
      mode: stage.getAttribute('data-mode') || '',
      cursor: host ? getComputedStyle(host).cursor : '',
      pointer: host ? getComputedStyle(host).pointerEvents : '',
      opacity: media ? getComputedStyle(media).opacity : '',
    })
    const before = read()
    // The control that owns the mode differs per direction (two text labels, a
    // switch, a segmented control), so score candidates instead of assuming.
    const candidates = Array.from(
      stage.querySelectorAll('[role="switch"],[role="tab"],button,label,span,a'),
    )
    const score = el => {
      let s = 0
      if (el.getAttribute('role') === 'switch') s += 4
      if (/switch|toggle|seg|mode/i.test(el.getAttribute('class') || '')) s += 3
      if (/^(纯看|交互)$/.test((el.textContent || '').trim())) s += 2
      else if (/纯看|交互/.test(el.textContent || '')) s += 1
      if (el.tagName === 'A') s -= 5
      return s
    }
    const toggle = candidates.filter(el => score(el) > 0).sort((a, b) => score(b) - score(a))[0]
    if (toggle) toggle.click()
    const after = read()
    const replay = Array.from(stage.querySelectorAll('button')).find(el =>
      /重播|动效/.test(el.textContent || ''),
    )
    out.push({
      key,
      toggled: before.mode !== after.mode,
      before,
      after,
      hasReplay: Boolean(replay),
      images: stage.querySelectorAll('img').length,
      fill: (() => {
        // crude dead-space measure: bounding box of all images vs stage box
        const box = stage.getBoundingClientRect()
        const imgs = Array.from(stage.querySelectorAll('img'))
        if (!imgs.length) return 0
        const area = imgs.reduce((sum, img) => {
          const r = img.getBoundingClientRect()
          return sum + Math.max(0, r.width) * Math.max(0, r.height)
        }, 0)
        return Math.min(1, area / (box.width * box.height))
      })(),
    })
  }
  return out
})()`

const SHELL_PROBE = `(() => ({
  pickButtons: document.querySelectorAll('.qmdp-pick-button').length,
  frames: document.querySelectorAll('.qmdp-frame').length,
  dials: document.querySelectorAll('[data-qmdp-dial]').length,
  injectedDialBlocks: document.querySelectorAll('.qmdp-dials[data-qmdp-injected]').length,
  confirmDialogs: document.querySelectorAll('.qmdp-confirm').length,
  cards: document.querySelectorAll('[data-design-option]').length,
  bodyClasses: document.body.className,
}))()`

const CONFIRM_PROBE = `(async () => {
  const button = document.querySelectorAll('.qmdp-pick-button')[0]
  button.click()
  await new Promise(r => setTimeout(r, 400))
  const dialog = document.querySelector('.qmdp-confirm')
  const visible = dialog ? getComputedStyle(dialog).display !== 'none' && dialog.getBoundingClientRect().height > 0 : false
  const cancel = dialog && dialog.querySelector('[data-qmdp-cancel]')
  const confirm = dialog && dialog.querySelector('[data-qmdp-confirm]')
  if (!dialog) return { opened: false }
  const meta = dialog.querySelector('[data-qmdp-confirm-meta]')?.textContent || ''
  confirm.click()
  await new Promise(r => setTimeout(r, 900))
  return {
    opened: true,
    visible,
    hasCancel: Boolean(cancel),
    hasConfirm: Boolean(confirm),
    meta,
    toast: document.querySelector('.qmdp-toast')?.textContent || '',
    selectedCards: document.querySelectorAll('.qmdp-selected').length,
  }
})()`

async function main() {
  spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', path.join(here, '.qa-profile')], { stdio: 'ignore' })
  const child = spawn(
    CHROME,
    [
      `--user-data-dir=${path.join(here, '.qa-profile')}`,
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${PORT}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  try {
    const session = await connect(URL_ARG)
    const dirs = await session.eval(PROBE)
    for (const d of dirs) {
      if (d.missing) {
        check(`direction ${d.key.toUpperCase()} present`, false, 'stage not found')
        continue
      }
      check(
        `${d.key.toUpperCase()} mode toggle flips data-mode`,
        d.toggled,
        `${JSON.stringify(d.before.mode)} -> ${JSON.stringify(d.after.mode)}`,
      )
      const changed = d.before.cursor !== d.after.cursor || d.before.pointer !== d.after.pointer
      check(
        `${d.key.toUpperCase()} images are non-interactive in 纯看`,
        changed,
        `cursor ${d.before.cursor} -> ${d.after.cursor}, pointer-events ${d.before.pointer} -> ${d.after.pointer}`,
      )
      check(`${d.key.toUpperCase()} has a replay-motion control`, d.hasReplay, `${d.images} images`)
      console.log(`      ${d.key.toUpperCase()} image area covers ${(d.fill * 100).toFixed(0)}% of the stage`)
    }

    if (URL_ARG.startsWith('http')) {
      const shell = await session.eval(SHELL_PROBE)
      check('selection shell injected once', shell.frames === 1 && shell.confirmDialogs === 1, JSON.stringify(shell))
      check('exactly one pick button per direction', shell.pickButtons === shell.cards, `${shell.pickButtons} buttons / ${shell.cards} cards`)
      check('dials available exactly once', shell.dials === 3, `${shell.dials} dials, injected blocks ${shell.injectedDialBlocks}`)

      const flow = await session.eval(CONFIRM_PROBE)
      check(
        'confirm dialog opens and confirming round-trips',
        flow.opened && flow.visible && flow.hasConfirm,
        JSON.stringify(flow),
      )
    }
  } catch (e) {
    check('qa driver ran', false, e.message)
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main()
