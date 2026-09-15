# Manifest V3 migration

Current Chrome no longer runs Manifest V2 extensions, so this build targets
Manifest V3. Everything below is verified against **Chrome 153.0.8010.37** by
`node test/e2e.mjs`, which loads `release/` unpacked and drives the new tab page
and the popup (20/20 checks, headless and headful).

Since the port, the new tab page also gained the search capsule and the two view
modes described in [DESIGN.md](DESIGN.md) and the README; the `search` permission
is what lets the capsule run a query through the profile's default engine
(`chrome.search.query`) instead of a hard-coded one.

## What changed

| Area | Manifest V2 | Manifest V3 |
| --- | --- | --- |
| Background | persistent page (`background.scripts`) | service worker (`background.service_worker`), stopped by Chrome whenever it goes idle |
| Settings | `window.localStorage`, read directly from the background page | `chrome.storage.local`, owned by the service worker; pages read and write over `chrome.runtime.sendMessage` |
| pximg Referer | `chrome.webRequest.onBeforeSendHeaders` with `webRequestBlocking` | static `declarative_net_request` rule, `release/rules/pximg-referer.json` |
| Toolbar button | `browser_action` | `action` |
| CSP | `script-src 'self' 'unsafe-eval'` | `script-src 'self'; object-src 'self'` |
| Permissions | host patterns inline in `permissions` | `permissions` + `host_permissions`, with `declarativeNetRequestWithHostAccess` |

`i.pximg.net` answers 403 unless the request carries a `Referer` of
`https://www.pixiv.net/`, which is the whole reason the rule exists. It is
declared once in the manifest; nothing registers a listener at runtime, so
`src/lib/requestModifier.ts` is now only the comment explaining why.

## Settings

The worker is the single owner of the store. Pages ask for settings with
`{ method: 'getOptions' }` and change them with `setMode`, `setSafe`,
`setExcludingTags` and `setAspectRatioSettings`, and never touch
`chrome.storage` themselves.

Values keep the encoding the localStorage implementation used — booleans as
`'1'`/`'0'`, numbers as `String(value)`, objects as JSON — so settings survive
an upgrade without being reinterpreted. `migrateLegacyStorage()` copies them out
of `localStorage` once, and each page runs it *before* its first read, because
the service worker has no `localStorage` to migrate from; a worker-only
migration would silently lose them.

Messaging goes through `src/lib/messaging.ts`. A message to a stopped worker
starts it again, but the round trip can still fail (a worker that has not
finished starting, a just-reloaded extension), and that failure arrives as
`chrome.runtime.lastError` plus an `undefined` response. Reading `response.data`
in the callback — what the call sites used to do — turns it into a TypeError
inside the callback and leaves a blank page, so the helper rejects instead and
the caller falls back to the default settings.

## The caching service worker is gone

The Manifest V2 build registered `sw.js` from the new tab page to cache
`i.pximg.net` responses and the illust detail endpoint. Manifest V3 in an
extension page refuses that registration:

```
NotSupportedError: Failed to register a ServiceWorker for scope
('chrome-extension://<id>/') with script ('chrome-extension://<id>/sw.js'):
The user denied permission to use Service Worker.
```

observed on Chrome 153 both headless and headful, so `src/sw.js`, its webpack
entry and the registration were removed. Images are still cached by Chrome's
HTTP cache. If the extra caching is wanted back, the Cache API can be used
directly from the page, without a service worker.

## Build

webpack 4 hashes with md4, and so does the uglifyjs plugin it bundles. OpenSSL 3
shipped with Node 17 moved md4 into the legacy provider, so `webpack --mode
production` fails with:

```
Error: error:0308010C:digital envelope routines::unsupported
```

Three changes make the build work on current Node as well as old Node:

- `webpack.config.ts` sets `output.hashFunction: 'sha256'` for webpack's own
  hashing.
- `build.js` passes `--openssl-legacy-provider` on Node 17 and later and nothing
  on older Node, which rejects the unknown flag. The minimizer hardcodes md4 and
  exposes no option, so this is what covers it.
- `output.globalObject: 'self'`, since `window` does not exist in a service
  worker. In the two page bundles `self === window`.

`yarn build` and `yarn dev` run `build.js`, which keeps the same command working
on the CircleCI image as on a current local Node.

## Not done

- webpack 4, ts-loader 5 and TypeScript 3.1 are kept. webpack 5 and terser would
  drop the md4 workaround entirely, but that is a toolchain upgrade rather than
  a Chrome compatibility fix.
