// One-off visual check (not part of e2e): renders the bookmark star on hover
// and the bookmark suggestion panel, saving PNGs to test/artifacts/.
import { spawn, spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EXTENSION = path.resolve(here, '..', 'release')
const PROFILE = path.join(here, '.profile-shot-bookmarks')
const OUT = path.join(here, 'artifacts')

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
        try {
          this.dispatch(JSON.parse(raw))
        } catch {}
      }
    })
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
    this.toChrome.write(JSON.stringify({ id, method, params, sessionId }) + '\0')
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
    const send = (m, p) => this.send(m, p, sessionId)
    await send('Runtime.enable')
    await send('Page.enable')
    return {
      send,
      eval: async expression => {
        const r = await send('Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
        return r.result.value
      },
      shot: async file => {
        const { data } = await send('Page.captureScreenshot', { format: 'png' })
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, Buffer.from(data, 'base64'))
        console.log(`screenshot: ${file}`)
      },
    }
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
      '--headless=new',
      '--enable-unsafe-extension-debugging',
      '--remote-debugging-pipe',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] },
  )
  const cdp = new Cdp(child)
  try {
    await sleep(1200)
    const { targetInfos } = await cdp.send('Target.getTargets')
    const browser = targetInfos.find(t => t.type === 'browser')
    const { extensionId } = await cdp.send('Extensions.loadUnpacked', {
      path: EXTENSION,
    })
    console.log('extension:', extensionId)
    void browser

    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const tab = await cdp.attach(targetId)

    // Wait for the wall, then go interactive and bookmark the first tile so
    // its star is lit, then hover a second tile to reveal its outline star.
    const deadline = Date.now() + 60000
    for (;;) {
      const n = await tab
        .eval(`document.querySelectorAll('.kunya-gallery img').length`)
        .catch(() => 0)
      if (n > 8) break
      if (Date.now() > deadline) throw new Error('wall never rendered')
      await sleep(500)
    }
    await tab.eval(`document.querySelector('.kunya-switch').click()`)
    await sleep(500)
    await tab.eval(`(async () => {
      const btn = document.querySelector('.kunya-tile__mark')
      btn.click()
      await new Promise(r => setTimeout(r, 800))
    })()`)

    const rect = await tab.eval(`(() => {
      const tiles = document.querySelectorAll('.kunya-tile')
      const r = tiles[1].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    await tab.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(rect.x),
      y: Math.round(rect.y),
    })
    await sleep(700)
    await tab.shot(path.join(OUT, 'bookmark-star.png'))

    // Bookmark strip: seed a few bookmarks-bar entries, refocus, and shoot
    // the bottom band where the strip floats above the capsule.
    await tab.eval(`(async () => {
      const seeds = [
        ['Pixiv', 'https://www.pixiv.net/'],
        ['GitHub', 'https://github.com/'],
        ['YouTube', 'https://www.youtube.com/'],
        ['Gmail', 'https://mail.google.com/'],
        ['Tweetdeck', 'https://x.com/'],
      ]
      for (const [title, url] of seeds) {
        await new Promise(r => chrome.bookmarks.create({ parentId: '1', title, url }, r))
      }
      window.dispatchEvent(new Event('focus'))
      await new Promise(r => setTimeout(r, 900))
    })()`)
    await sleep(600)
    await tab.shot(path.join(OUT, 'bookmark-strip.png'))

    // Bookmark suggestion panel: seed a bookmark, then type its name.
    await tab.eval(
      `new Promise(r => chrome.bookmarks.create({ title: 'Kunya 视觉验收书签', url: 'https://example.com/visual-check' }, r))`,
    )
    await tab.eval(`document.querySelector('.kunya-search__input').focus()`)
    await tab.send('Input.insertText', { text: '视觉验收' })
    await sleep(900)
    // Pick the first row so the active state shows in the shot.
    await tab.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowDown',
      windowsVirtualKeyCode: 40,
    })
    await sleep(400)
    await tab.shot(path.join(OUT, 'bookmark-suggest.png'))
  } finally {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    })
  }
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
