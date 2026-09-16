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
        const input = document.querySelector('input[placeholder="初音ミク"]')
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
          listed: Array.from(document.querySelectorAll('li.tag')).map(li => li.textContent),
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
            `Array.from(document.querySelectorAll('li.tag')).map(li => li.textContent)`,
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

      // The bookmark-tier dropdown writes tag_bookmark_tier as a string.
      const tierRoundTrip = await popup.eval(`(async () => {
        const select = document.querySelector('#tag-tier-selector')
        if (!select) return { error: 'tier selector not found' }
        select.value = '500'
        select.dispatchEvent(new Event('input', { bubbles: true }))
        select.dispatchEvent(new Event('change', { bubbles: true }))
        await new Promise(r => setTimeout(r, 800))
        const stored = await new Promise(r => chrome.storage.local.get('tag_bookmark_tier', r))
        return { stored: stored.tag_bookmark_tier, ui: select.value }
      })()`)
      check(
        'tag bookmark tier persists to chrome.storage.local',
        !tierRoundTrip.error && tierRoundTrip.stored === '500',
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

      // The login probe must settle: a fresh profile has no pixiv session,
      // and a network failure reads as logged-out rather than hanging.
      const loginStatus = await waitFor(
        async () => {
          const text = await popup.eval(
            `(document.querySelector('.login-status') || {}).textContent || ''`,
          )
          return text && text.indexOf('…') === -1 ? { text } : null
        },
        20000,
        'the popup login probe to settle',
      ).catch(e => ({ error: e.message }))
      check(
        'popup login probe settles on a definite status',
        !loginStatus.error && /Not logged in|Logged in/.test(loginStatus.text),
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
