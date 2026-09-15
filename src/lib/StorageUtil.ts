/**
 * Storage layer.
 *
 * Manifest V3 runs the background script as a service worker, where `window`
 * (and therefore `window.localStorage`) does not exist. Every read and write
 * goes through `chrome.storage.local` instead, which is available in the
 * service worker, the new tab page, and the popup alike.
 *
 * Values keep the encoding the previous localStorage-based implementation used,
 * so existing settings migrate without reinterpretation:
 *   boolean -> '1' | '0'
 *   number  -> String(value)
 *   object  -> JSON string
 *
 * The copy runs from the page the values came from — `main.tsx` and
 * `popup.tsx` call `migrateLegacyStorage()` before their first read — because
 * the service worker, the only context that outlives a page, has no
 * localStorage to migrate out of.
 */

const MIGRATION_FLAG = '__ku_nya_migrated_to_chrome_storage'

/** Keys the pre-MV3 build kept in localStorage. */
const LEGACY_KEYS = [
  'content',
  'excluding_tags',
  'is_excluding_high_aspect_ratio',
  'smallest_includable_aspect_ratio',
  'is_safe',
]

/**
 * The pinned `@types/chrome` (0.0.75) predates the Promise-based storage API, so
 * the checked-in types describe the callback overload only. This is the real
 * shape on Chrome 88+: the call returns a Promise, and also still accepts a
 * trailing callback.
 */
interface StorageArea {
  get(keys: string | string[], callback?: (items: { [key: string]: any }) => void): any
  set(items: { [key: string]: any }, callback?: () => void): any
}

const store = (chrome.storage as any).local as StorageArea

/** Resolve a callback-style API call from the same shape a Promise API returns. */
function toPromise<T>(result: any, run: (done: (value: T) => void) => void): Promise<T> {
  if (result && typeof result.then === 'function') return result as Promise<T>
  return new Promise<T>(resolve => run(resolve))
}

/**
 * `chrome.storage.local.get` returns a Promise on Chrome 88+ and calls its
 * callback on older builds. Both are supported, so the code does not depend on
 * a modern Chrome just to read a setting.
 */
async function readKeys(keys: string | string[]): Promise<{ [key: string]: any }> {
  return toPromise<{ [key: string]: any }>(store.get(keys), done => store.get(keys, done))
}

async function writeItems(items: { [key: string]: any }): Promise<void> {
  return toPromise<void>(store.set(items), done => store.set(items, () => done(undefined)))
}

/** localStorage is unavailable in the service worker; never touch `window` unguarded. */
function legacyStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Copy pre-MV3 localStorage settings into chrome.storage.local once.
 *
 * Called by the page entries, never by the service worker. It is a no-op after
 * the first run in a given browser profile, and a no-op in a context without
 * localStorage, so calling it from every page is safe.
 */
export async function migrateLegacyStorage(): Promise<void> {
  const legacy = legacyStorage()
  if (!legacy) return
  if (legacy.getItem(MIGRATION_FLAG) === '1') return

  const existing = await readKeys(LEGACY_KEYS)
  const carried: { [key: string]: string } = {}
  for (const key of LEGACY_KEYS) {
    // Do not overwrite a value the store already holds.
    if (existing[key] !== undefined) continue
    const value = legacy.getItem(key)
    if (value !== null) carried[key] = value
  }
  if (Object.keys(carried).length > 0) await writeItems(carried)

  legacy.setItem(MIGRATION_FLAG, '1')
}

export async function getValue<T = any>(key: string, fallback?: T): Promise<T> {
  const stored = (await readKeys(key))[key]
  return stored !== undefined ? (stored as T) : (fallback as T)
}

export async function getBoolean(key: string, fallback?: boolean): Promise<boolean> {
  const stored = (await readKeys(key))[key]
  if (stored === undefined) return fallback as boolean
  return stored !== false && stored !== '0' && stored !== 0
}

export async function getJSON<T = any>(key: string, fallback?: T): Promise<T> {
  const resolvedFallback = (fallback === undefined ? {} : fallback) as T
  const stored = (await readKeys(key))[key]
  if (stored === undefined) return resolvedFallback
  try {
    return typeof stored === 'string' ? (JSON.parse(stored) as T) : (stored as T)
  } catch {
    return resolvedFallback
  }
}

export async function setValue(key: string, value: any): Promise<void> {
  await writeItems({ [key]: String(value) })
}

export async function setBoolean(key: string, value: boolean): Promise<void> {
  await writeItems({ [key]: value !== false ? '1' : '0' })
}

export async function setJSON(key: string, value: any): Promise<void> {
  await writeItems({ [key]: JSON.stringify(value) })
}
