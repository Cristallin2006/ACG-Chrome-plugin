// End-to-end check for the unpacked extension in `release/`.
//
//   node test/e2e.mjs              # headless
//   KUNYA_HEADFUL=1 node test/e2e.mjs
//   CHROME_PATH=/path/to/chrome node test/e2e.mjs
//
// Chrome 137+ ignores --load-extension in branded builds, so the extension is
// loaded the way Puppeteer's Browser.installExtension() does it: launch Chrome
// with --remote-debugging-pipe --enable-unsafe-extension-debugging and call the
// CDP `Extensions.loadUnpacked`. A pipe transport replaces the usual HTTP and
// WebSocket one (Chrome refuses to serve both), so this speaks CDP over fd 3
// and fd 4 directly and needs no dependencies.
//
// Checked, in order:
//   1. Chrome accepts the manifest and loads the unpacked extension
//   2. the MV3 background service worker registers
//   3. chrome://newtab is served by the extension (the new tab override)
//   4. the new tab reaches the worker, reads settings and renders illusts
//   5. i.pximg.net images load, which is what proves the declarativeNetRequest
//      Referer rule works (without it they answer 403)
//   6. settings left in localStorage by the Manifest V2 build migrate over
//   7. the popup renders and a click round-trips through the worker into
//      chrome.storage.local

import { spawn, spawnSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CHROME =
  process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const EXTENSION = path.resolve(here, '..', 'release')
const PROFILE = path.join(here, '.profile')

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []

function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

class Cdp {
  constructor(child) {
    this.child = child
    this.toChrome = child.stdio[3]
    this.fromChrome = child.stdio[4]
    this.seq = 0
    this.pending = new Map()
    this.logs = new Map()
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
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        continue
      }
      this.dispatch(msg)
    }
  }

  dispatch(msg) {
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result)
      return
    }
    const log = this.logs.get(msg.sessionId)
    if (!log) return
    if (msg.method === 'Log.entryAdded') log.push(msg.params.entry)
    if (msg.method === 'Runtime.exceptionThrown') {
      log.push({ level: 'exception', text: msg.params.exceptionDetails.text })
    }
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
    this.logs.set(sessionId, [])
    const session = new Session(this, sessionId)
    await session.send('Runtime.enable')
    await session.send('Log.enable').catch(() => {})
    return session
  }
}

class Session {
  constructor(cdp, sessionId) {
    this.cdp = cdp
    this.sessionId = sessionId
  }

  send(method, params = {}) {
    return this.cdp.send(method, params, this.sessionId)
  }

  get logs() {
    return this.cdp.logs.get(this.sessionId) || []
  }

  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      )
    }
    return r.result.value
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
  throw new Error(`timed out waiting for ${label} (last: ${JSON.stringify(last)})`)
}

function killTree(pid) {
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
}

async function saveScreenshot(session, file) {
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' })
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, Buffer.from(data, 'base64'))
  console.log(`      screenshot: ${file}`)
}

async function main() {
  spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', PROFILE], { stdio: 'ignore' })

  const args = [
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-component-update',
    '--enable-unsafe-extension-debugging',
    '--remote-debugging-pipe',
    // Fixed window size keeps the screenshots comparable between runs.
    '--window-size=1280,800',
  ]
  if (!process.env.KUNYA_HEADFUL) args.push('--headless=new')
  args.push('about:blank')

  console.log(`launching ${CHROME}`)
  console.log(`  extension: ${EXTENSION}`)
  console.log(`  profile:   ${PROFILE}`)
  const child = spawn(CHROME, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
  })
  const chromeLog = []
  child.stderr.on('data', d => chromeLog.push(d.toString()))

  const cdp = new Cdp(child)

  try {
    const version = await waitFor(
      () => cdp.send('Browser.getVersion').catch(() => null),
      30000,
      'the browser to answer on the pipe',
    )
    console.log(`browser: ${version.product}\n`)

    // 1. Loading at all is the first real check: loadUnpacked validates the
    //    manifest and reports what it rejects.
    let extensionId
    try {
      const loaded = await cdp.send('Extensions.loadUnpacked', { path: EXTENSION })
      extensionId = loaded.id
      check('Chrome loads the MV3 manifest (Extensions.loadUnpacked)', true, extensionId)
    } catch (e) {
      check('Chrome loads the MV3 manifest (Extensions.loadUnpacked)', false, e.message)
      throw new Error(`extension did not load: ${e.message}`)
    }

    // 2. The MV3 background service worker.
    const worker = await waitFor(
      async () => {
        const { targetInfos } = await cdp.send('Target.getTargets')
        return targetInfos.find(
          t =>
            t.url === `chrome-extension://${extensionId}/background.js` &&
            t.type === 'service_worker',
        )
      },
      20000,
      'the background service worker',
    ).catch(async e => {
      const { targetInfos } = await cdp.send('Target.getTargets')
      check('MV3 service worker registered', false, e.message)
      console.log(
        '   targets:',
        JSON.stringify(targetInfos.map(t => `${t.type} ${t.url}`), null, 2),
      )
      throw e
    })
    check('MV3 service worker registered', true, `${worker.url} (${worker.type})`)

    // 3. chrome://newtab must come up as the extension's page.
    const { targetId } = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const newTab = await cdp.attach(targetId)
    const href = await waitFor(
      async () => {
        const h = await newTab.eval('location.href')
        return h && h !== 'about:blank' ? h : null
      },
      20000,
      'the new tab to navigate',
    )
    check(
      'chrome://newtab is overridden by the extension',
      href.startsWith(`chrome-extension://${extensionId}/newTab.html`),
      href,
    )

    // 4. Illustrations: settings read through the worker, then pixiv fetched.
    const gallery = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => {
          const imgs = Array.from(document.querySelectorAll('.kunya-gallery img'))
          return {
            images: imgs.length,
            // Visible ones matter: an image can be in the DOM, loaded, and still
            // at opacity 0, which looks exactly like a broken empty page.
            visible: imgs.filter(i => Number(getComputedStyle(i).opacity) > 0.9).length,
            ready: document.readyState,
          }
        })()`)
        return state.images > 0 && state.visible > 0 ? state : null
      },
      60000,
      'illustrations to render',
    ).catch(e => ({ error: e.message }))

    if (gallery.error) {
      const probe = await newTab.eval(`(async () => {
        const urls = [
          'https://www.pixiv.net/ranking.php?mode=daily&format=json&content=illust&p=1',
          'https://www.pixiv.net/touch/ajax_api/ajax_api.php?mode=new_illust&p=4',
        ]
        const out = {}
        for (const u of urls) {
          try {
            const r = await fetch(u, { credentials: 'include' })
            out[u.split('?')[1]] = r.status + ' len=' + (await r.text()).length
          } catch (e) { out[u.split('?')[1]] = 'threw ' + e.message }
        }
        return out
      })()`)
      check(
        'new tab renders illustrations',
        false,
        `${gallery.error}; pixiv probe: ${JSON.stringify(probe)}`,
      )
    } else {
      check('new tab renders illustrations', true, JSON.stringify(gallery))
    }

    // 5. naturalWidth > 0 means i.pximg.net accepted the request, which only
    //    happens with the Referer the declarativeNetRequest rule injects.
    const images = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => {
          const imgs = Array.from(document.images)
          return {
            total: imgs.length,
            loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
            sample: imgs.length ? imgs[0].src : null,
          }
        })()`)
        return state.total > 0 && state.loaded > 0 ? state : null
      },
      60000,
      'pximg images to finish loading',
    ).catch(async e => {
      const fallback = await newTab.eval(
        `(() => ({ total: document.images.length, sample: document.images[0] ? document.images[0].src : null }))()`,
      )
      return { error: e.message, ...fallback }
    })

    if (images.error) {
      check(
        'i.pximg.net images load with the DNR Referer rule',
        false,
        JSON.stringify(images),
      )
    } else {
      check(
        'i.pximg.net images load with the DNR Referer rule',
        true,
        `${images.loaded}/${images.total} loaded, e.g. ${images.sample}`,
      )
    }

    if (images.sample) {
      const reload = await newTab.eval(`new Promise(resolve => {
        const img = new Image()
        img.onload = () => resolve('loaded ' + img.naturalWidth + 'x' + img.naturalHeight)
        img.onerror = () => resolve('error event (HTTP 403 happens without a Referer)')
        img.src = ${JSON.stringify(images.sample)} + '?cachebust=' + Date.now()
        setTimeout(() => resolve('still pending after 20s'), 20000)
      })`)
      check('a cache-busted pximg request still succeeds', reload.startsWith('loaded'), reload)
    }

    const pageLogs = newTab.logs.filter(l => l.level === 'error' || l.level === 'exception')
    check(
      'new tab has no console errors',
      pageLogs.length === 0,
      JSON.stringify(pageLogs.slice(0, 3)),
    )

    // 5c. Rainy-day pool: the successful load above persisted its pool to
    //     chrome.storage.local. Block pixiv at the network layer and reload;
    //     once the retry schedule (2.5s + 5s + 10s) gives up, the wall must
    //     deal the cached pool instead of the empty state. The images
    //     themselves stay broken (pximg is blocked too), so the assertion is
    //     tiles present vs the empty message.
    await newTab.send('Network.enable')
    await newTab.send('Network.setBlockedURLs', {
      urls: ['*pixiv.net*', '*pximg.net*'],
    })
    await newTab.send('Page.reload')
    const rainy = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => ({
          imgs: document.querySelectorAll('.kunya-gallery img').length,
          empty: !!document.querySelector('.kunya-empty'),
        }))()`)
        return state.imgs > 0 || state.empty ? state : null
      },
      45000,
      'the cached pool to stand in while pixiv is blocked',
    ).catch(e => ({ error: e.message }))
    check(
      'pixiv unreachable: wall falls back to the last cached pool',
      !rainy.error && rainy.imgs > 0 && !rainy.empty,
      JSON.stringify(rainy),
    )
    await newTab.send('Network.setBlockedURLs', { urls: [] })
    await newTab.send('Page.reload')
    await waitFor(
      async () => {
        const n = await newTab.eval(
          `document.querySelectorAll('.kunya-gallery img').length`,
        )
        return n > 0 ? n : null
      },
      60000,
      'the wall to recover after pixiv is unblocked',
    )

    // 5d. The pinned proxy: the worker must hold the browser's proxy slot
    //     with a PAC pointing at 127.0.0.1:7890 (default ON for a fresh
    //     profile), so pixiv loading no longer tracks the system proxy.
    const proxyState = await newTab.eval(`(async () => {
      const state = await new Promise(r => chrome.proxy.settings.get({}, r))
      return {
        level: state.levelOfControl,
        mode: state.value && state.value.mode,
        has7890: !!(state.value && state.value.pacScript &&
          (state.value.pacScript.data || '').indexOf('127.0.0.1:7890') !== -1),
      }
    })()`)
    check(
      'worker pins the browser proxy at 127.0.0.1:7890',
      proxyState.level === 'controlled_by_this_extension' &&
        proxyState.mode === 'pac_script' &&
        proxyState.has7890,
      JSON.stringify(proxyState),
    )

    // 6. Upgrading from the Manifest V2 build: its settings live in this
    //    page's localStorage, the migrated ones in chrome.storage.local. Seed
    //    the old shape, wipe the new one, and reload.
    await newTab.eval(`(async () => {
      localStorage.setItem('content', 'manga')
      localStorage.setItem('excluding_tags', JSON.stringify(['r-18']))
      localStorage.setItem('is_safe', '0')
      localStorage.removeItem('__ku_nya_migrated_to_chrome_storage')
      await new Promise(r => chrome.storage.local.clear(r))
      return true
    })()`)
    await newTab.send('Page.enable')
    await newTab.send('Page.reload')
    await sleep(1500)
    const migrated = await waitFor(
      async () => {
        const stored = await newTab.eval(
          `new Promise(r => chrome.storage.local.get(null, r))`,
        )
        return stored.content === 'manga' ? stored : null
      },
      15000,
      'the pre-MV3 localStorage settings to migrate',
    ).catch(e => ({ error: e.message }))
    check(
      'pre-MV3 localStorage settings migrate into chrome.storage.local',
      !migrated.error && migrated.excluding_tags === '["r-18"]' && migrated.is_safe === '0',
      JSON.stringify(migrated),
    )

    // 7. The search capsule and the two view modes. The reload above restarts
    // the whole fetch → layout pipeline, so wait for the gallery to come back
    // instead of sampling at a fixed delay.
    const bar = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => {
          const capsule = document.querySelector('.kunya-search')
          const input = capsule && capsule.querySelector('input')
          const toggle = capsule && capsule.querySelector('[role="switch"]')
          return {
            capsule: Boolean(capsule),
            input: Boolean(input),
            placeholder: input ? input.placeholder : '',
            toggle: Boolean(toggle),
            checked: toggle ? toggle.getAttribute('aria-checked') : '',
            links: document.querySelectorAll('.kunya-gallery a').length,
            images: document.querySelectorAll('.kunya-gallery img').length,
          }
        })()`)
        return state.images > 0 ? state : null
      },
      60000,
      'the gallery to re-render after the migration reload',
    )
    check(
      'search capsule carries an input and the mode switch',
      bar.capsule && bar.input && bar.toggle,
      JSON.stringify(bar),
    )
    check(
      'gallery starts in 纯看 (nothing to mis-tap)',
      bar.links === 0 && bar.images > 0,
      `${bar.links} links / ${bar.images} images`,
    )
    await saveScreenshot(newTab, path.join(here, 'artifacts', 'newtab-watch.png'))

    const switched = await newTab.eval(`(async () => {
      document.querySelector('.kunya-switch').click()
      await new Promise(r => setTimeout(r, 400))
      return {
        checked: document.querySelector('.kunya-switch').getAttribute('aria-checked'),
        links: document.querySelectorAll('.kunya-gallery a').length,
        href: document.querySelector('.kunya-gallery a') ? document.querySelector('.kunya-gallery a').href : '',
      }
    })()`)
    check(
      '交互 mode turns the illustrations back into links',
      switched.checked === 'true' && switched.links > 0,
      JSON.stringify(switched),
    )
    await saveScreenshot(newTab, path.join(here, 'artifacts', 'newtab-interactive.png'))

    await newTab.send('Page.reload')
    const persisted = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => ({
          checked: document.querySelector('.kunya-switch')
            ? document.querySelector('.kunya-switch').getAttribute('aria-checked')
            : '',
          links: document.querySelectorAll('.kunya-gallery a').length,
        }))()`)
        return state.checked === 'true' && state.links > 0 ? state : null
      },
      30000,
      'the chosen view mode to survive a reload',
    ).catch(e => ({ error: e.message }))
    check('view mode survives a reload', !persisted.error, JSON.stringify(persisted))

    // 7a2. Muted authors must never kill the wall: the daily-ranking detail
    //      endpoint names authors in camelCase (userName), and an entry with
    //      no usable name is kept — one odd entry must not crash the pool.
    //      The wall is in manga mode here, which walks exactly that detail
    //      endpoint.
    await newTab.eval(`(async () => {
      await new Promise(r => chrome.storage.local.set({ excluding_authors: '["__e2e_no_such_artist__"]' }, r))
      return true
    })()`)
    await newTab.send('Page.reload')
    const mutedWall = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => ({
          imgs: document.querySelectorAll('.kunya-gallery img').length,
          empty: !!document.querySelector('.kunya-empty'),
        }))()`)
        return state.imgs > 0 || state.empty ? state : null
      },
      60000,
      'the wall to render with a muted author set',
    ).catch(e => ({ error: e.message }))
    check(
      'a muted author never kills the ranking wall',
      !mutedWall.error && mutedWall.imgs > 0 && !mutedWall.empty,
      JSON.stringify(mutedWall),
    )
    await newTab.eval(`(async () => {
      await new Promise(r => chrome.storage.local.set({ excluding_authors: '[]' }, r))
      return true
    })()`)
    await newTab.send('Page.reload')
    await waitFor(
      async () => {
        const n = await newTab.eval(
          `document.querySelectorAll('.kunya-gallery img').length`,
        )
        return n > 0 ? n : null
      },
      60000,
      'the wall to come back after un-muting',
    )

    // 7b. Progressive disclosure: the wall starts as one screen of pieces and
    // deals another screen as the user scrolls towards the end; pieces reveal
    // themselves (is-inview) as they enter the viewport.
    const beforeScroll = await newTab.eval(
      `document.querySelectorAll('.kunya-gallery img').length`,
    )
    await newTab.eval(`window.scrollTo(0, document.body.scrollHeight)`)
    const afterScroll = await waitFor(
      async () => {
        const state = await newTab.eval(`(() => ({
          images: document.querySelectorAll('.kunya-gallery img').length,
          revealed: document.querySelectorAll('.kunya-tile.is-inview').length,
          scrollable: document.body.scrollHeight > window.innerHeight,
        }))()`)
        return state.images > beforeScroll ? state : null
      },
      20000,
      'the wall to deal another screen on scroll',
    ).catch(e => ({ error: e.message }))
    check(
      'scrolling deals the next screen of the puzzle',
      !afterScroll.error && afterScroll.revealed > 0 && afterScroll.scrollable,
      JSON.stringify({ before: beforeScroll, ...afterScroll }),
    )
    await saveScreenshot(newTab, path.join(here, 'artifacts', 'newtab-scrolled.png'))
    await newTab.eval(`window.scrollTo(0, 0)`)

    // 7c. Wheel paging: one wheel gesture turns exactly one screen of the
    // puzzle (and back), like slides.
    await sleep(300)
    await newTab.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 640,
      y: 400,
      deltaX: 0,
      deltaY: 240,
    })
    const pagedDown = await waitFor(
      async () => {
        const y = await newTab.eval(`Math.round(window.scrollY)`)
        return Math.abs(y - (await newTab.eval(`window.innerHeight`))) < 8
          ? y
          : null
      },
      5000,
      'one wheel gesture to page down exactly one screen',
    ).catch(e => ({ error: e.message }))
    check(
      'one wheel gesture pages down exactly one screen',
      typeof pagedDown === 'number',
      JSON.stringify(pagedDown),
    )
    await sleep(900) // outlast the page-turn lock before wheeling back
    // Synthetic event for the way back: right after the page-down, the real
    // input pipeline is starved for seconds by the newly dealt screen's image
    // decodes (verified manually to work fine with a real wheel). The handler
    // logic is what this asserts, not Chrome's input timing.
    await newTab.eval(
      `window.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, cancelable: true }))`,
    )
    const pagedUp = await waitFor(
      async () => {
        const y = await newTab.eval(`Math.round(window.scrollY)`)
        // Truthy wrapper: 0 is the success value here, and waitFor treats
        // falsy returns as "not yet".
        return y < 8 ? { y } : null
      },
      15000,
      'one wheel gesture to page back up',
    ).catch(e => ({ error: e.message }))
    check(
      'one wheel gesture pages back up',
      !pagedUp.error,
      JSON.stringify(pagedUp),
    )

    // 7d. Custom tag category: storing a `tag:` mode turns the wall into that
    // tag's search results after a reload.
    await newTab.eval(
      `chrome.storage.local.set({ content: 'tag:風景', custom_tags: '["風景"]' })`,
    )
    await newTab.send('Page.reload')
    const tagWall = await waitFor(
      async () => {
        const n = await newTab.eval(
          `document.querySelectorAll('.kunya-gallery img').length`,
        )
        return n > 0 ? { images: n } : null
      },
      30000,
      'the wall to render a custom tag category',
    ).catch(e => ({ error: e.message }))
    check(
      'custom tag category renders illustrations',
      !tagWall.error,
      JSON.stringify(tagWall),
    )

    // 7e. Tag sources refill from deeper search pages: the first batch is at
    // most 120 entries (2 pages × 60, deduped), so a wall growing past that
    // has pulled page 3+ from pixiv by itself. Scroll to the bottom on every
    // poll — a one-shot jump lands mid-wall because the wall keeps growing
    // past the position it was aimed at.
    const refill = await waitFor(
      async () => {
        await newTab.eval(`window.scrollTo(0, document.body.scrollHeight)`)
        const n = await newTab.eval(
          `document.querySelectorAll('.kunya-gallery img').length`,
        )
        return n > 125 ? { images: n } : null
      },
      60000,
      'the tag wall to refill past the first search batch',
    ).catch(async e => ({
      error: e.message,
      diag: await newTab
        .eval(
          `JSON.stringify({
            images: document.querySelectorAll('.kunya-gallery img').length,
            scrollY: Math.round(window.scrollY),
            docH: document.documentElement.scrollHeight,
          })`,
        )
        .catch(x => String(x)),
    }))
    check(
      'tag wall refills from deeper search pages',
      !refill.error,
      JSON.stringify(refill),
    )
    // Hand the ranking mode back to the default for whatever runs next.
    await newTab.eval(`chrome.storage.local.set({ content: 'illust' })`)

    // 8. Keyboard entry, and the pure-watch idle step-back.
    await newTab.eval(`document.querySelector('.kunya-switch').click()`)
    await sleep(300)
    await newTab.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: '/',
      text: '/',
      windowsVirtualKeyCode: 191,
    })
    await sleep(200)
    const focused = await newTab.eval(
      `document.activeElement === document.querySelector('.kunya-search__input')`,
    )
    check('pressing / focuses the search field', focused)

    await newTab.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      windowsVirtualKeyCode: 27,
    })
    await sleep(2700)
    const ghost = await newTab.eval(
      `document.querySelector('.kunya-search').classList.contains('is-ghost')`,
    )
    check('pure-watch mode steps the capsule back when idle', ghost)

    await newTab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 240, y: 240 })
    await sleep(320)
    const awake = await newTab.eval(
      `!document.querySelector('.kunya-search').classList.contains('is-ghost')`,
    )
    check('any pointer movement brings it straight back', awake)

    // 9. Enter has to run a web search, in the current tab, in a fresh tab so
    //    the page under test keeps its state.
    const searchApi = await newTab.eval(
      `typeof chrome.search !== 'undefined' && typeof chrome.search.query === 'function'`,
    )
    check('chrome.search is available for web search', searchApi)

    const searchTarget = await cdp.send('Target.createTarget', { url: 'chrome://newtab' })
    const searchTab = await cdp.attach(searchTarget.targetId)
    await waitFor(
      async () =>
        (await searchTab.eval(
          `Boolean(document.querySelector('.kunya-search__input'))`,
        ))
          ? true
          : null,
      20000,
      'the search field on a fresh new tab',
    )
    await searchTab.eval(`document.querySelector('.kunya-search__input').focus()`)
    await searchTab.send('Input.insertText', { text: 'deepseek' })
    await searchTab.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
    })
    const searched = await waitFor(
      async () => {
        const href = await searchTab.eval('location.href')
        return href.startsWith('http') ? href : null
      },
      20000,
      'the search to navigate the tab',
    ).catch(e => `error: ${e.message}`)
    check(
      'Enter runs the query as a web search',
      /^https?:/.test(searched) && /search|q=|google|bing|duckduckgo|baidu/i.test(searched),
      searched,
    )

    // 9b. Typing lists matching Chrome bookmarks under the risen capsule, and
    //     ↓ + Enter opens the pick instead of running a web search. Done in a
    //     fresh tab because the pick navigates the page away.
    await newTab.eval(
      `new Promise(r => chrome.bookmarks.create({ title: 'kunya suggestion target', url: 'https://example.com/kunya-bookmark-test' }, r))`,
    )
    const bmTarget = await cdp.send('Target.createTarget', { url: 'chrome://newtab' })
    const bmTab = await cdp.attach(bmTarget.targetId)
    await waitFor(
      async () =>
        (await bmTab.eval(
          `Boolean(document.querySelector('.kunya-search__input'))`,
        ))
          ? true
          : null,
      20000,
      'the search field on the bookmark-test tab',
    )
    await bmTab.eval(`document.querySelector('.kunya-search__input').focus()`)
    await bmTab.send('Input.insertText', { text: 'kunya-bookmark-test' })
    const listed = await waitFor(
      async () => {
        const n = await bmTab.eval(
          `document.querySelectorAll('.kunya-bmarks__row').length`,
        )
        return n > 0 ? { rows: n } : null
      },
      15000,
      'bookmark suggestions under the risen capsule',
    ).catch(e => ({ error: e.message }))
    check(
      'typing lists matching Chrome bookmarks',
      !listed.error,
      JSON.stringify(listed),
    )
    if (!listed.error) {
      await bmTab.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'ArrowDown',
        windowsVirtualKeyCode: 40,
      })
      await sleep(250)
      await bmTab.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        windowsVirtualKeyCode: 13,
      })
      const opened = await waitFor(
        async () => {
          const href = await bmTab.eval('location.href')
          return href.indexOf('example.com/kunya-bookmark-test') !== -1
            ? href
            : null
        },
        15000,
        'the picked bookmark to open',
      ).catch(e => `error: ${e.message}`)
      check(
        'arrow-down + Enter opens the picked bookmark',
        typeof opened === 'string' && opened.indexOf('example.com') !== -1,
        String(opened),
      )
    }
    await cdp.send('Target.closeTarget', { targetId: bmTarget.targetId })

    // 9c. The tile star (交互 mode) files the artwork page into the Ku-nya
    //     bookmark folder; a second click removes it again. Section 8 left
    //     the wall in 纯看, so switch it back first.
    await newTab.eval(`document.querySelector('.kunya-switch').click()`)
    await sleep(400)
    const markTrip = await waitFor(
      async () => {
        const r = await newTab.eval(`(async () => {
          const link = document.querySelector('.kunya-tile__link')
          const btn = document.querySelector('.kunya-tile__mark')
          if (!link || !btn) return null
          const search = q => new Promise(res => chrome.bookmarks.search(q, res))
          const url = link.href
          btn.click()
          await new Promise(r => setTimeout(r, 700))
          const added = await search({ url })
          let folder = null
          if (added.length) {
            const parent = await new Promise(res => chrome.bookmarks.get(added[0].parentId, res))
            folder = parent && parent[0] ? parent[0].title : null
          }
          const litAfterAdd = btn.classList.contains('is-on')
          btn.click()
          await new Promise(r => setTimeout(r, 700))
          const removed = await search({ url })
          const mark = document.querySelector('.kunya-tile__mark')
          const litAfterRemove = mark ? mark.classList.contains('is-on') : null
          return { url, added: added.length, folder, litAfterAdd, removed: removed.length, litAfterRemove }
        })()`)
        return r
      },
      20000,
      'a tile bookmark star on the wall',
    ).catch(e => ({ error: e.message }))
    check(
      'tile star files the artwork into the Ku-nya bookmark folder',
      !markTrip.error &&
        markTrip.added === 1 &&
        markTrip.folder === 'Ku-nya' &&
        markTrip.litAfterAdd === true,
      JSON.stringify(markTrip),
    )
    check(
      'a second click on the star removes the bookmark',
      !markTrip.error &&
        markTrip.removed === 0 &&
        markTrip.litAfterRemove === false,
      JSON.stringify(markTrip),
    )

    // 9d. The homepage strip mirrors the Chrome bookmarks bar: seeding a
    //     bookmark into the bar must surface it when the tab regains focus
    //     (onChanged is not delivered everywhere; focus/visibility re-reads
    //     the bar), and clicking the item navigates the tab.
    await newTab.eval(
      `new Promise(r => chrome.bookmarks.create({ parentId: '1', title: 'kunya strip target', url: 'https://example.com/kunya-strip-test' }, r))`,
    )
    await newTab.eval(`window.dispatchEvent(new Event('focus'))`)
    const stripItem = await waitFor(
      async () => {
        const item = await newTab.eval(`(() => {
          const a = document.querySelector('.kunya-marks__item')
          return a ? { text: a.textContent, href: a.href } : null
        })()`)
        return item && item.href.indexOf('kunya-strip-test') !== -1
          ? item
          : null
      },
      15000,
      'the bookmark strip to mirror a new bookmarks-bar entry',
    ).catch(e => ({ error: e.message }))
    check(
      'homepage strip mirrors the Chrome bookmarks bar on focus',
      !stripItem.error,
      JSON.stringify(stripItem),
    )

    // 9d2. Chrome's own star button files into Other Bookmarks, so the strip
    //      falls back to it: a bookmark there must surface too, after any
    //      direct bookmarks-bar links.
    await newTab.eval(
      `new Promise(r => chrome.bookmarks.create({ parentId: '2', title: 'kunya other target', url: 'https://example.com/kunya-other-test' }, r))`,
    )
    await newTab.eval(`window.dispatchEvent(new Event('focus'))`)
    const otherItem = await waitFor(
      async () => {
        // Fold-aware: entries may sit behind the 更多 chip, whose menu keeps
        // the same order as the row — chips first, folded tail after.
        const items = await newTab.eval(`(() => {
          const more = document.querySelector('.kunya-marks__more')
          if (more && more.getAttribute('aria-expanded') !== 'true') more.click()
          return Array.from(document.querySelectorAll(
            '.kunya-marks-root a.kunya-marks__item, .kunya-marks-root a.kunya-marks__menu-item'
          )).map(a => a.href)
        })()`)
        const otherIndex = items.findIndex(
          h => h.indexOf('kunya-other-test') !== -1,
        )
        const barIndex = items.findIndex(
          h => h.indexOf('kunya-strip-test') !== -1,
        )
        return otherIndex !== -1 && barIndex !== -1 && barIndex < otherIndex
          ? items
          : null
      },
      15000,
      'the bookmark strip to fall back to Other Bookmarks',
    ).catch(e => ({ error: e.message }))
    check(
      'homepage strip falls back to Other Bookmarks after bar links',
      !otherItem.error,
      JSON.stringify(otherItem),
    )

    // 9d3. Folders stay folders: a bookmark filed inside one must NOT spill
    //      into the row as a loose chip — it appears as a folder chip whose
    //      menu holds the link, opened on click and shut again by Escape.
    await newTab.eval(`(async () => {
      const folder = await new Promise(r => chrome.bookmarks.create({ parentId: '2', title: 'kunya folder' }, r))
      await new Promise(r => chrome.bookmarks.create({ parentId: folder.id, title: 'kunya nested target', url: 'https://example.com/kunya-nested-test' }, r))
      const sub = await new Promise(r => chrome.bookmarks.create({ parentId: folder.id, title: 'kunya subfolder' }, r))
      await new Promise(r => chrome.bookmarks.create({ parentId: sub.id, title: 'kunya deep target', url: 'https://example.com/kunya-deep-test' }, r))
    })()`)
    await newTab.eval(`window.dispatchEvent(new Event('focus'))`)
    const folderChip = await waitFor(
      async () => {
        return await newTab.eval(`(() => {
          const more = document.querySelector('.kunya-marks__more')
          if (more && more.getAttribute('aria-expanded') !== 'true') more.click()
          const chip = document.querySelector('.kunya-marks__folder:not(.kunya-marks__more)')
            || document.querySelector('.kunya-marks__menu-folder')
          const spilled = document.querySelector('.kunya-marks-root a[href*="kunya-nested-test"]')
          if (!chip || spilled) return null
          return { text: chip.textContent.trim(), expanded: chip.getAttribute('aria-expanded') }
        })()`)
      },
      15000,
      'the bookmark strip to group foldered bookmarks under a folder chip',
    ).catch(e => ({ error: e.message }))
    check(
      'homepage strip keeps foldered bookmarks inside a folder chip',
      !folderChip.error &&
        folderChip.text.indexOf('kunya folder') !== -1 &&
        folderChip.expanded === 'false',
      JSON.stringify(folderChip),
    )

    // Click the folder's entry once — a chip on the row, or its row inside
    // the overflow menu when the strip has folded it away — then wait for
    // the folder's own menu to appear with the nested bookmark inside.
    const folderEntry = await waitFor(
      async () => {
        return await newTab.eval(`(() => {
          const chip = document.querySelector('.kunya-marks__folder:not(.kunya-marks__more)')
            || document.querySelector('.kunya-marks__menu-folder')
          if (!chip) return null
          chip.click()
          return true
        })()`)
      },
      15000,
      'the folder entry to appear on the strip or in the overflow menu',
    ).catch(e => ({ error: e.message }))
    const folderMenu = folderEntry.error
      ? folderEntry
      : await waitFor(
          async () => {
            return await newTab.eval(`(() => {
              const link = document.querySelector('.kunya-marks__menu a[href*="kunya-nested-test"]')
              return link ? { text: link.textContent.trim() } : null
            })()`)
          },
          15000,
          'the folder chip to open a menu holding the nested bookmark',
        ).catch(e => ({ error: e.message }))
    check(
      'clicking a folder chip opens its menu with the nested bookmark',
      !folderMenu.error && folderMenu.text.indexOf('kunya nested target') !== -1,
      JSON.stringify(folderMenu),
    )

    // 9d3b. A folder inside a folder is not flattened away: it appears as a
    //       folder row inside the parent menu and opens its own menu, one
    //       click deeper.
    const subRow = await waitFor(
      async () => {
        return await newTab.eval(`(() => {
          const row = Array.from(document.querySelectorAll('.kunya-marks__menu-folder'))
            .filter(b => b.textContent.indexOf('kunya subfolder') !== -1)[0]
          if (!row) return null
          row.click()
          return true
        })()`)
      },
      15000,
      'the subfolder row to appear in the parent menu',
    ).catch(e => ({ error: e.message }))
    const deepMenu = subRow.error
      ? subRow
      : await waitFor(
          async () => {
            return await newTab.eval(`(() => {
              const link = document.querySelector('.kunya-marks__menu a[href*="kunya-deep-test"]')
              return link ? { text: link.textContent.trim() } : null
            })()`)
          },
          15000,
          'the subfolder to open a menu holding the deep bookmark',
        ).catch(e => ({ error: e.message }))
    check(
      'a folder inside a folder opens as its own menu',
      !deepMenu.error && deepMenu.text.indexOf('kunya deep target') !== -1,
      JSON.stringify(deepMenu),
    )

    const menuShut = await waitFor(
      async () => {
        const shut = await newTab.eval(`(() => {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
          return new Promise(r => setTimeout(() => r({
            menu: !!document.querySelector('.kunya-marks__menu'),
          }), 300))
        })()`)
        return shut && !shut.menu ? shut : null
      },
      10000,
      'Escape to shut the folder menu',
    ).catch(e => ({ error: e.message }))
    check(
      'Escape shuts the folder menu',
      !menuShut.error,
      JSON.stringify(menuShut),
    )

    // 9d5. Overflow folds instead of clipping: more entries than the strip
    //      can hold collapse behind a "更多 · N" chip whose menu lists the
    //      folded tail — nothing is dropped, nothing is cropped.
    await newTab.eval(`(async () => {
      for (let i = 1; i <= 30; i++) {
        await new Promise(r => chrome.bookmarks.create({ parentId: '1', title: 'kunya overflow ' + i, url: 'https://example.com/kunya-overflow-' + i }, r))
      }
    })()`)
    await newTab.eval(`window.dispatchEvent(new Event('focus'))`)
    const folded = await waitFor(
      async () => {
        return await newTab.eval(`(() => {
          const more = document.querySelector('.kunya-marks__more')
          if (!more) return null
          if (more.getAttribute('aria-expanded') !== 'true') more.click()
          const links = document.querySelectorAll('.kunya-marks__menu a.kunya-marks__menu-item')
          if (!links.length) return null
          const texts = Array.from(links).map(a => a.textContent.trim())
          return {
            chip: more.textContent.trim(),
            menuLinks: links.length,
            holdsLastSeed: texts.some(t => t.indexOf('kunya overflow 30') !== -1),
          }
        })()`)
      },
      15000,
      'the overflow to fold behind a 更多 chip',
    ).catch(e => ({ error: e.message }))
    check(
      'overflowing bookmarks fold into a 更多 menu',
      !folded.error &&
        folded.chip.indexOf('更多') !== -1 &&
        folded.holdsLastSeed === true,
      JSON.stringify(folded),
    )

    // 9d6. The menu's wheel budget is its own: a wheel gesture inside it must
    //      scroll the menu without the wall's pager consuming the event
    //      (defaultPrevented stays false) — scrolling never leaks outward.
    const menuWheel = await waitFor(
      async () => {
        return await newTab.eval(`(() => {
          const menu = document.querySelector('.kunya-marks__menu')
          if (!menu) return null
          const item = menu.querySelector('.kunya-marks__menu-item')
          // An untrusted wheel performs no native default scroll, so the two
          // halves are asserted separately: the pager must not consume the
          // event (defaultPrevented false), and the menu must actually have
          // overflow to scroll (taller than its frame).
          const event = new WheelEvent('wheel', { deltaY: 240, cancelable: true, bubbles: true })
          item.dispatchEvent(event)
          return new Promise(r => setTimeout(() => r({
            defaultPrevented: event.defaultPrevented,
            scrollable: menu.scrollHeight > menu.clientHeight + 1,
          }), 300))
        })()`)
      },
      10000,
      'a wheel inside the menu to stay inside the menu',
    ).catch(e => ({ error: e.message }))
    check(
      'wheel inside a bookmark menu scrolls it independently',
      !menuWheel.error &&
        menuWheel.defaultPrevented === false &&
        menuWheel.scrollable === true,
      JSON.stringify(menuWheel),
    )
    await newTab.eval(`(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })()`)
    await newTab.eval(`(async () => {
      const kids = await new Promise(r => chrome.bookmarks.getChildren('1', r))
      for (const k of kids) {
        if (k.title.indexOf('kunya overflow ') === 0) {
          await new Promise(r => chrome.bookmarks.remove(k.id, r))
        }
      }
    })()`)

    const stripTarget = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const stripTab = await cdp.attach(stripTarget.targetId)
    const stripOpened = await waitFor(
      async () => {
        const clicked = await stripTab.eval(`(() => {
          let a = document.querySelector('a.kunya-marks__item[href*="kunya-strip-test"]')
          if (!a) {
            const more = document.querySelector('.kunya-marks__more')
            if (more && more.getAttribute('aria-expanded') !== 'true') more.click()
            a = document.querySelector('.kunya-marks__menu a[href*="kunya-strip-test"]')
          }
          if (!a) return null
          a.click()
          return true
        })()`)
        if (!clicked) return null
        const href = await stripTab.eval('location.href')
        return href.indexOf('kunya-strip-test') !== -1 ? href : null
      },
      20000,
      'the strip link to open its bookmark',
    ).catch(e => `error: ${e.message}`)
    check(
      'clicking a strip item opens the bookmark',
      typeof stripOpened === 'string' &&
        stripOpened.indexOf('example.com') !== -1,
      String(stripOpened),
    )
    await cdp.send('Target.closeTarget', { targetId: stripTarget.targetId })

    // 9d4. The strip rides the capsule: focusing the search field rises the
    //      capsule, and the strip must park right above it — still visible,
    //      still clickable, not dimmed away with the wall.
    const rideTarget = await cdp.send('Target.createTarget', {
      url: 'chrome://newtab',
    })
    const rideTab = await cdp.attach(rideTarget.targetId)
    const ride = await waitFor(
      async () => {
        const state = await rideTab.eval(`(() => {
          const marks = document.querySelector('.kunya-marks')
          const capsule = document.querySelector('.kunya-search')
          if (!marks || !capsule) return null
          const input = document.querySelector('.kunya-search__input')
          if (!capsule.classList.contains('is-risen')) input.focus()
          if (!capsule.classList.contains('is-risen')) return null
          const m = marks.getBoundingClientRect()
          const c = capsule.getBoundingClientRect()
          return {
            risen: marks.classList.contains('is-risen'),
            gap: Math.round(c.top - m.bottom),
            clickable: getComputedStyle(marks).pointerEvents !== 'none',
          }
        })()`)
        return state &&
          state.risen &&
          state.clickable &&
          state.gap >= 4 &&
          state.gap <= 30
          ? state
          : null
      },
      15000,
      'the strip to ride the risen capsule',
    ).catch(e => ({ error: e.message }))
    check(
      'bookmark strip rides above the risen capsule',
      !ride.error,
      JSON.stringify(ride),
    )

    // 9d8. Clicking a folder chip mid-search must not read as "clicked
    //      outside the capsule": the capsule stays risen and the folder's
    //      menu opens, instead of everything settling back down.
    const risenReady = await waitFor(
      async () => {
        return await rideTab.eval(`(() => {
          const capsule = document.querySelector('.kunya-search')
          if (!capsule.classList.contains('is-risen')) {
            document.querySelector('.kunya-search__input').focus()
            return null
          }
          // The strip may have folded every folder behind 更多 — open it so
          // a folder entry exists either on the row or in the overflow menu.
          const more = document.querySelector('.kunya-marks__more')
          if (more && more.getAttribute('aria-expanded') !== 'true') more.click()
          const chip = document.querySelector('.kunya-marks__folder:not(.kunya-marks__more)')
            || document.querySelector('.kunya-marks__menu-folder')
          return chip ? true : null
        })()`)
      },
      15000,
      'the capsule to rise with a folder chip on the strip',
    ).catch(e => ({ error: e.message }))
    const risenFolder = risenReady.error
      ? risenReady
      : await (async () => {
          // A faithful click: synthetic .click() never moves focus, but a
          // dispatched mousedown performs the default focus grab — exactly
          // what used to blur the field and drop the capsule.
          await rideTab.eval(`(() => {
            const chip = document.querySelector('.kunya-marks__folder:not(.kunya-marks__more)')
              || document.querySelector('.kunya-marks__menu-folder')
            chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
            chip.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
            chip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          })()`)
          return await waitFor(
            async () => {
              return await rideTab.eval(`(() => {
                const menus = document.querySelectorAll('.kunya-marks__menu')
                // The folder's own menu, not the 更多 menu it may replace.
                const own = Array.from(menus).filter(
                  m => m.getAttribute('aria-label') !== '更多书签',
                )[0]
                if (!own) return null
                const active = document.activeElement
                return {
                  risen: document.querySelector('.kunya-search').classList.contains('is-risen'),
                  focused: !!(active && active.classList.contains('kunya-search__input')),
                }
              })()`)
            },
            10000,
            'the folder menu to open while the capsule stays risen',
          ).catch(e => ({ error: e.message }))
        })()
    check(
      'folder chip opens its menu while the capsule stays risen',
      !risenFolder.error &&
        risenFolder.risen === true &&
        risenFolder.focused === true,
      JSON.stringify(risenFolder),
    )

    // 9d9. The clipboard button opens the clipboard, it does not paste on
    //      sight: the first click lifts a preview panel (and focuses the
    //      field), the second pours the previewed text in and shuts it.
    await cdp
      .send('Browser.setPermission', {
        permission: { name: 'clipboardReadWrite' },
        setting: 'granted',
      })
      .catch(() => {})
    const clipSettle = await waitFor(
      async () => {
        return await rideTab.eval(`(async () => {
          const capsule = document.querySelector('.kunya-search')
          const input = document.querySelector('.kunya-search__input')
          if (capsule.classList.contains('is-risen')) {
            input.blur()
            return null
          }
          try {
            await navigator.clipboard.writeText('kunya clip probe')
            return true
          } catch (e) { return { clipboardError: String(e) } }
        })()`)
      },
      10000,
      'the capsule to settle with the probe text on the clipboard',
    ).catch(e => ({ error: e.message }))
    const clipOpen = clipSettle.error
      ? clipSettle
      : await waitFor(
          async () => {
            return await rideTab.eval(`(() => {
              const panel = document.querySelector('.kunya-clip')
              if (!panel) {
                document.querySelector('.kunya-search__clip').click()
                return null
              }
              const active = document.activeElement
              return {
                risen: document.querySelector('.kunya-search').classList.contains('is-risen'),
                focused: !!(active && active.classList.contains('kunya-search__input')),
                preview: panel.textContent,
                value: document.querySelector('.kunya-search__input').value,
              }
            })()`)
          },
          10000,
          'the clipboard button to open the preview panel',
        ).catch(e => ({ error: e.message }))
    check(
      'clipboard button opens a preview panel, no paste yet',
      !clipOpen.error &&
        clipOpen.risen === true &&
        clipOpen.focused === true &&
        clipOpen.preview.indexOf('kunya clip probe') !== -1 &&
        clipOpen.value.indexOf('kunya clip probe') === -1,
      JSON.stringify(clipOpen),
    )

    const clipPaste = clipOpen.error
      ? clipOpen
      : await waitFor(
          async () => {
            return await rideTab.eval(`(() => {
              const panel = document.querySelector('.kunya-clip')
              if (panel) {
                document.querySelector('.kunya-search__clip').click()
                return null
              }
              const value = document.querySelector('.kunya-search__input').value
              return value.indexOf('kunya clip probe') !== -1 ? { value } : null
            })()`)
          },
          10000,
          'the second click to paste the previewed text',
        ).catch(e => ({ error: e.message }))
    check(
      'a second clipboard-button click pastes the preview',
      !clipPaste.error && clipPaste.value.indexOf('kunya clip probe') !== -1,
      JSON.stringify(clipPaste),
    )

    // 9d9b. The preview panel itself is the second click: clear the field,
    //       reopen, then click the PANEL (mousedown included) — the paste
    //       must land all the same.
    if (!clipPaste.error) {
      await rideTab.eval(`(() => {
        const input = document.querySelector('.kunya-search__input')
        input.value = ''
        input.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`)
    }
    const clipPanelOpen = clipPaste.error
      ? clipPaste
      : await waitFor(
          async () => {
            return await rideTab.eval(`(() => {
              const panel = document.querySelector('.kunya-clip')
              if (!panel) {
                document.querySelector('.kunya-search__clip').click()
                return null
              }
              return {
                preview: panel.textContent,
                pasteable: panel.classList.contains('is-pasteable'),
              }
            })()`)
          },
          10000,
          'the preview panel to reopen',
        ).catch(e => ({ error: e.message }))
    const clipPanelPaste = clipPanelOpen.error
      ? clipPanelOpen
      : await waitFor(
          async () => {
            return await rideTab.eval(`(() => {
              const panel = document.querySelector('.kunya-clip')
              if (panel) {
                panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
                panel.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
                panel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
                return null
              }
              const value = document.querySelector('.kunya-search__input').value
              return value.indexOf('kunya clip probe') !== -1 ? { value } : null
            })()`)
          },
          10000,
          'a click on the preview panel to paste',
        ).catch(e => ({ error: e.message }))
    check(
      'clicking the preview panel itself pastes',
      !clipPanelPaste.error &&
        clipPanelOpen.pasteable === true &&
        clipPanelPaste.value.indexOf('kunya clip probe') !== -1,
      JSON.stringify(clipPanelPaste),
    )

    // 9d10. A right-click only wants the context menu: the field takes focus
    //       (so 粘贴 works) but the capsule stays parked; content arriving —
    //       the paste itself — is what finally raises it.
    const rightClick = await waitFor(
      async () => {
        return await rideTab.eval(`(() => {
          const capsule = document.querySelector('.kunya-search')
          const input = document.querySelector('.kunya-search__input')
          if (capsule.classList.contains('is-risen')) {
            input.blur()
            return null
          }
          input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }))
          input.focus()
          return new Promise(r => setTimeout(() => r({
            focused: document.activeElement === input,
            risen: capsule.classList.contains('is-risen'),
          }), 400))
        })()`)
      },
      10000,
      'a right-click to focus the field without rising the capsule',
    ).catch(e => ({ error: e.message }))
    check(
      'right-click focuses the field but keeps the capsule parked',
      !rightClick.error &&
        rightClick.focused === true &&
        rightClick.risen === false,
      JSON.stringify(rightClick),
    )

    const pasteRise = rightClick.error
      ? rightClick
      : await waitFor(
          async () => {
            return await rideTab.eval(`(() => {
              const capsule = document.querySelector('.kunya-search')
              if (capsule.classList.contains('is-risen')) return true
              const input = document.querySelector('.kunya-search__input')
              input.value = 'kunya pasted text'
              input.dispatchEvent(new Event('input', { bubbles: true }))
              return new Promise(r => setTimeout(() => r(
                capsule.classList.contains('is-risen') ? true : null
              ), 400))
            })()`)
          },
          10000,
          'pasted content to raise the parked capsule',
        ).catch(e => ({ error: e.message }))
    check(
      'content pasted after a right-click raises the capsule',
      !pasteRise.error && pasteRise === true,
      JSON.stringify(pasteRise),
    )

    await cdp.send('Target.closeTarget', { targetId: rideTarget.targetId })

    // 10. Popup: settings render, and a click has to land in
    //    chrome.storage.local through the worker.
    const popupTarget = await cdp.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup.html`,
    })
    const popup = await cdp.attach(popupTarget.targetId)
    const panel = await waitFor(
      async () => {
        const s = await popup.eval(`(() => ({
          inputs: document.querySelectorAll('input').length,
          labels: document.querySelectorAll('label').length,
        }))()`)
        return s.inputs > 0 ? s : null
      },
      20000,
      'the popup settings panel',
    ).catch(e => ({ error: e.message }))
    check('popup renders the settings panel', !panel.error, JSON.stringify(panel))

    if (!panel.error) {
      const roundTrip = await popup.eval(`(async () => {
        const read = () => new Promise(r => chrome.storage.local.get(null, r))
        const before = await read()
        const box = document.querySelector('#checkbox_for_safe')
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const after = await read()
        return { before: before.is_safe, after: after.is_safe, checkedInUi: box.checked }
      })()`)
      check(
        'popup click round-trips through the worker into chrome.storage.local',
        roundTrip.after !== roundTrip.before,
        JSON.stringify(roundTrip),
      )

      // Custom categories must persist: type a tag, click its Add button,
      // then read the store back. The input is located by its placeholder.
      const tagRoundTrip = await popup.eval(`(async () => {
        const input = document.querySelector('input[placeholder="添加标签,如 初音ミク…"]')
        if (!input) return {
          error: 'custom tag input not found',
          placeholders: Array.from(document.querySelectorAll('input')).map(i => i.placeholder),
          sections: Array.from(document.querySelectorAll('h1,h2,h3,legend')).map(el => el.textContent),
        }
        input.value = '風景'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.closest('span').querySelector('button').click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('custom_tags', r))
        return {
          stored: stored.custom_tags,
          listed: Array.from(document.querySelectorAll('li.knp-chip')).map(li => li.textContent),
        }
      })()`)
      check(
        'custom tag added in the popup persists to chrome.storage.local',
        !tagRoundTrip.error &&
          !!tagRoundTrip.stored &&
          tagRoundTrip.stored.indexOf('風景') !== -1,
        JSON.stringify(tagRoundTrip),
      )

      // ...and survives a full popup reopen: a fresh page must read the tag
      // back through getOptions and list it.
      const popupTarget2 = await cdp.send('Target.createTarget', {
        url: `chrome-extension://${extensionId}/popup.html`,
      })
      const popup2 = await cdp.attach(popupTarget2.targetId)
      const reopened = await waitFor(
        async () => {
          const listed = await popup2.eval(
            `Array.from(document.querySelectorAll('li.knp-chip')).map(li => li.textContent)`,
          )
          return listed && listed.some(t => t.indexOf('風景') !== -1)
            ? { listed }
            : null
        },
        15000,
        'a reopened popup to list the stored custom tag',
      ).catch(e => ({ error: e.message }))
      check(
        'custom tag survives a popup reopen',
        !reopened.error,
        JSON.stringify(reopened),
      )
      await cdp.send('Target.closeTarget', { targetId: popupTarget2.targetId })

      // The bookmark-tier segmented control writes tag_bookmark_tier as a string.
      const tierRoundTrip = await popup.eval(`(async () => {
        const radio = document.querySelector('input[name="knp-tag-tier"][value="500"]')
        if (!radio) return { error: 'tier radio not found' }
        radio.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('tag_bookmark_tier', r))
        return { stored: stored.tag_bookmark_tier, ui: radio.checked }
      })()`)
      check(
        'tag bookmark tier persists to chrome.storage.local',
        !tierRoundTrip.error && tierRoundTrip.stored === '500' && tierRoundTrip.ui === true,
        JSON.stringify(tierRoundTrip),
      )

      // The login toggle writes use_pixiv_login as '1'/'0'.
      const loginRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_pixiv_login')
        if (!box) return { error: 'login checkbox not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('use_pixiv_login', r))
        return { before, checkedInUi: box.checked, stored: stored.use_pixiv_login }
      })()`)
      check(
        'pixiv login toggle persists to chrome.storage.local',
        !loginRoundTrip.error &&
          loginRoundTrip.checkedInUi === !loginRoundTrip.before &&
          loginRoundTrip.stored === (loginRoundTrip.before ? '0' : '1'),
        JSON.stringify(loginRoundTrip),
      )

      // The multi-page filter toggle writes is_excluding_multi_page as '1'/'0'.
      const multiPageRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_multi_page')
        if (!box) return { error: 'multi-page checkbox not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('is_excluding_multi_page', r))
        return { before, checkedInUi: box.checked, stored: stored.is_excluding_multi_page }
      })()`)
      check(
        'multi-page filter toggle persists to chrome.storage.local',
        !multiPageRoundTrip.error &&
          multiPageRoundTrip.checkedInUi === !multiPageRoundTrip.before &&
          multiPageRoundTrip.stored === (multiPageRoundTrip.before ? '0' : '1'),
        JSON.stringify(multiPageRoundTrip),
      )

      // The AI filter toggle writes is_excluding_ai as '1'/'0'.
      const aiRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_ai')
        if (!box) return { error: 'AI checkbox not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('is_excluding_ai', r))
        return { before, checkedInUi: box.checked, stored: stored.is_excluding_ai }
      })()`)
      check(
        'AI filter toggle persists to chrome.storage.local',
        !aiRoundTrip.error &&
          aiRoundTrip.checkedInUi === !aiRoundTrip.before &&
          aiRoundTrip.stored === (aiRoundTrip.before ? '0' : '1'),
        JSON.stringify(aiRoundTrip),
      )

      // The tile bookmark toggle writes tile_bookmark as '1'/'0'.
      const tileBookmarkRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_tile_bookmark')
        if (!box) return { error: 'tile bookmark toggle not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('tile_bookmark', r))
        return { before, checkedInUi: box.checked, stored: stored.tile_bookmark }
      })()`)
      check(
        'tile bookmark toggle persists to chrome.storage.local',
        !tileBookmarkRoundTrip.error &&
          tileBookmarkRoundTrip.checkedInUi === !tileBookmarkRoundTrip.before &&
          tileBookmarkRoundTrip.stored === (tileBookmarkRoundTrip.before ? '0' : '1'),
        JSON.stringify(tileBookmarkRoundTrip),
      )

      // The bookmark suggestion toggle writes bookmark_search as '1'/'0'.
      const bookmarkSearchRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_bookmark_search')
        if (!box) return { error: 'bookmark search toggle not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('bookmark_search', r))
        return { before, checkedInUi: box.checked, stored: stored.bookmark_search }
      })()`)
      check(
        'bookmark suggestion toggle persists to chrome.storage.local',
        !bookmarkSearchRoundTrip.error &&
          bookmarkSearchRoundTrip.checkedInUi === !bookmarkSearchRoundTrip.before &&
          bookmarkSearchRoundTrip.stored === (bookmarkSearchRoundTrip.before ? '0' : '1'),
        JSON.stringify(bookmarkSearchRoundTrip),
      )

      // The homepage bookmark strip toggle writes bookmark_bar as '1'/'0'.
      const bookmarkBarRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_bookmark_bar')
        if (!box) return { error: 'bookmark bar toggle not found' }
        const before = box.checked
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('bookmark_bar', r))
        return { before, checkedInUi: box.checked, stored: stored.bookmark_bar }
      })()`)
      check(
        'bookmark strip toggle persists to chrome.storage.local',
        !bookmarkBarRoundTrip.error &&
          bookmarkBarRoundTrip.checkedInUi === !bookmarkBarRoundTrip.before &&
          bookmarkBarRoundTrip.stored === (bookmarkBarRoundTrip.before ? '0' : '1'),
        JSON.stringify(bookmarkBarRoundTrip),
      )

      // The fixed-proxy toggle both persists AND moves the browser's proxy
      // slot: off releases it, on re-pins 7890. Restored ON at the end so the
      // later network probes still run through the proxy.
      const proxyRoundTrip = await popup.eval(`(async () => {
        const box = document.querySelector('#checkbox_for_fixed_proxy')
        if (!box) return { error: 'fixed proxy toggle not found' }
        const get = () => new Promise(r => chrome.proxy.settings.get({}, r))
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const offStored = await new Promise(r => chrome.storage.local.get('fixed_proxy', r))
        const offState = await get()
        box.click()
        await new Promise(r => setTimeout(r, 800))
        const onStored = await new Promise(r => chrome.storage.local.get('fixed_proxy', r))
        const onState = await get()
        return {
          offStored: offStored.fixed_proxy,
          offLevel: offState.levelOfControl,
          onStored: onStored.fixed_proxy,
          onLevel: onState.levelOfControl,
          onMode: onState.value && onState.value.mode,
        }
      })()`)
      check(
        'fixed proxy toggle persists and moves the proxy slot',
        !proxyRoundTrip.error &&
          proxyRoundTrip.offStored === '0' &&
          proxyRoundTrip.offLevel !== 'controlled_by_this_extension' &&
          proxyRoundTrip.onStored === '1' &&
          proxyRoundTrip.onLevel === 'controlled_by_this_extension' &&
          proxyRoundTrip.onMode === 'pac_script',
        JSON.stringify(proxyRoundTrip),
      )

      // The bookmark floor writes min_bookmarks as a string.
      const floorRoundTrip = await popup.eval(`(async () => {
        const input = document.querySelector('input[aria-label="收藏数下限"]')
        if (!input) return { error: 'bookmark floor input not found' }
        input.value = '500'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('min_bookmarks', r))
        return { stored: stored.min_bookmarks, ui: input.value }
      })()`)
      check(
        'bookmark floor persists to chrome.storage.local',
        !floorRoundTrip.error && floorRoundTrip.stored === '500',
        JSON.stringify(floorRoundTrip),
      )

      // Muting an author writes excluding_authors as a JSON list.
      const authorRoundTrip = await popup.eval(`(async () => {
        const input = document.querySelector('input[placeholder="添加画师名…"]')
        if (!input) return { error: 'author input not found' }
        input.value = '测试画师'
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
        input.closest('span').querySelector('button').click()
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('excluding_authors', r))
        return { stored: stored.excluding_authors }
      })()`)
      check(
        'muted author persists to chrome.storage.local',
        !authorRoundTrip.error &&
          !!authorRoundTrip.stored &&
          authorRoundTrip.stored.indexOf('测试画师') !== -1,
        JSON.stringify(authorRoundTrip),
      )

      // The login probe must settle: a fresh profile has no pixiv session,
      // and a network failure reads as logged-out rather than hanging.
      const loginStatus = await waitFor(
        async () => {
          const text = await popup.eval(
            `(document.querySelector('.knp-login__text') || {}).textContent || ''`,
          )
          return text && text.indexOf('…') === -1 ? { text } : null
        },
        20000,
        'the popup login probe to settle',
      ).catch(e => ({ error: e.message }))
      check(
        'popup login probe settles on a definite status',
        !loginStatus.error &&
          /未登录|已登录|检测失败/.test(loginStatus.text),
        JSON.stringify(loginStatus),
      )
    }

    const popupLogs = popup.logs.filter(l => l.level === 'error' || l.level === 'exception')
    check(
      'popup has no console errors',
      popupLogs.length === 0,
      JSON.stringify(popupLogs.slice(0, 3)),
    )
  } catch (e) {
    console.error('\ndriver error:', e.message)
    const interesting = chromeLog
      .join('')
      .split('\n')
      .filter(l => /extension|manifest|error/i.test(l))
      .slice(-10)
    if (interesting.length) console.error('chrome said:\n' + interesting.join('\n'))
    killTree(child.pid)
    process.exit(2)
  }

  killTree(child.pid)

  const failed = results.filter(r => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  process.exit(failed.length ? 1 : 0)
}

main()
