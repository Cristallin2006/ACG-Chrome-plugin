import * as storageUtil from './lib/StorageUtil'
import { getOptions } from './lib/options'

/**
 * Settings are owned by this service worker, so the new tab page and the popup
 * read and write through messages instead of touching the store themselves.
 *
 * Every branch answers asynchronously: `chrome.storage.local` is promise-based
 * and there is no synchronous storage in a service worker. Returning `true`
 * keeps the message channel open until `sendResponse` runs.
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (request.method) {
        case 'getOptions': {
          // Settings left in localStorage by the pre-MV3 build are migrated by
          // the page that asks (see `migrateLegacyStorage`); a service worker
          // has no localStorage to migrate from.
          sendResponse({ data: await getOptions() })
          break
        }
        case 'setMode':
          await storageUtil.setValue('content', request.params.mode)
          sendResponse({ data: 'setMode' })
          break
        case 'setAspectRatioSettings':
          await storageUtil.setBoolean(
            'is_excluding_high_aspect_ratio',
            request.params.is_excluding_high_aspect_ratio,
          )
          await storageUtil.setValue(
            'smallest_includable_aspect_ratio',
            request.params.smallest_includable_aspect_ratio,
          )
          sendResponse({ data: 'setAspectRatioSettings' })
          break
        case 'setExcludingTags':
          await storageUtil.setJSON('excluding_tags', request.params.tags)
          sendResponse({ data: 'setExcludingTags' })
          break
        case 'setSafe':
          await storageUtil.setBoolean('is_safe', request.params.is_safe)
          sendResponse({ data: 'setSafe', isSafe: request.params.is_safe })
          break
        case 'setViewMode':
          await storageUtil.setValue('view_mode', request.params.view_mode)
          sendResponse({ data: 'setViewMode' })
          break
        default:
          sendResponse({ data: null })
      }
    } catch (error) {
      // Surface storage failures to the caller instead of leaving the
      // channel open until it times out.
      sendResponse({ error: String(error) })
    }
  })()
  return true
})
