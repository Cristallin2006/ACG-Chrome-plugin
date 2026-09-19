// Visual proof for the spotlight-rise search capsule: loads the unpacked
// extension exactly like e2e.mjs does (raw CDP over pipe), screenshots the
// search bar at rest, then focused with a typed query.
//
//   node test/shot-search.mjs
//
// Output: test/shots/search-rest.png and test/shots/search-risen.png

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

async function shot(session, file) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`screenshot: ${file}`)
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
    await sleep(1200) // let the reveal ripple finish before the portrait
    await shot(tab, path.join(here, 'shots', 'search-rest.png'))

    const risen = await tab.evaluate(`(() => {
      const input = document.querySelector('.kunya-search__input')
      if (!input) return 'no input'
      input.focus()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, 'pixiv 排行榜')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      const capsule = document.querySelector('.kunya-search')
      return {
        risen: capsule.classList.contains('is-risen'),
        hasText: capsule.classList.contains('has-text'),
        scrim: !!document.querySelector('.kunya-scrim.is-risen'),
        label: !!document.querySelector('.kunya-search__label'),
        hint: !!document.querySelector('.kunya-search__hint'),
        go: !!document.querySelector('.kunya-search__go'),
      }
    })()`)
    console.log('risen state:', JSON.stringify(risen))
    await sleep(900) // rise (340ms) + label/hint delays, then settle
    await shot(tab, path.join(here, 'shots', 'search-risen.png'))

    // Fall-back path: blurring must settle the capsule back into the safety band.
    const settled = await tab.evaluate(`(async () => {
      const input = document.querySelector('.kunya-search__input')
      const capsule = document.querySelector('.kunya-search')
      input.blur()
      await new Promise(r => setTimeout(r, 700))
      const rect = capsule.getBoundingClientRect()
      const de = document.documentElement
      return {
        risen: capsule.classList.contains('is-risen'),
        bottomGap: Math.round(window.innerHeight - rect.bottom),
        height: Math.round(rect.height),
        inner: window.innerWidth + 'x' + window.innerHeight,
        scroll: de.scrollWidth + 'x' + de.scrollHeight,
        client: de.clientWidth + 'x' + de.clientHeight,
        capsuleBottom: getComputedStyle(capsule).bottom,
      }
    })()`)
    console.log('settled state:', JSON.stringify(settled))
    if (settled.risen) {
      throw new Error(`capsule did not settle back: ${JSON.stringify(settled)}`)
    }
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
