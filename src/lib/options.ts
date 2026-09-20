import * as storageUtil from '../lib/StorageUtil'

export enum Modes {
  Original = 'original',
  Illust = 'illust',
  Manga = 'manga',
  Ugoira = 'ugoira',
  Newer = 'newer',
  Popular = 'popular',
  /** Algorithmic recommendation feed; requires a carried pixiv login. */
  Discovery = 'discovery',
}

/**
 * How the gallery behaves. `Watch` leaves the illustrations non-interactive so
 * the page can be scrolled and enjoyed without opening anything by accident;
 * `Interactive` turns them back into links to the artwork page.
 */
export enum ViewModes {
  Watch = 'watch',
  Interactive = 'interactive',
}

export interface Options {
  /** Built-in ranking (Modes) or a user-defined tag source: 'tag:<keyword>'. */
  mode: string
  /** User-defined tag categories, selectable in the mode dropdown. */
  customTags: string[]
  /**
   * Bookmark floor for tag sources: 0 = unfiltered, a positive number becomes
   * the `Nusers入り` keyword, api.TAG_TIER_MIXED (-1) = layered search.
   */
  tagBookmarkTier: number
  /** Whether pixiv requests carry the browser's login session. */
  usePixivLogin: boolean
  /** Hide multi-page works (usually manga) from the wall. */
  isExcludingMultiPage: boolean
  /** Hide AI-generated works (pixiv aiType 2) from the wall. */
  isExcludingAI: boolean
  /** Bookmark floor; 0 = unfiltered. Sources without counts are never filtered. */
  minBookmarks: number
  /** Author names to hide, matched case-insensitively against the entry's author. */
  excludedAuthors: string[]
  excludingTags: string[]
  isExcludingHighAspectRatio: boolean
  smallestIncludableAspectRatio: number
  isSafe: boolean
  viewMode: ViewModes
  /** The hover star on a puzzle piece files the artwork into Chrome bookmarks. */
  isTileBookmarkEnabled: boolean
  /** While typing, the risen capsule lists matching Chrome bookmarks. */
  isBookmarkSearchEnabled: boolean
  /** A strip above the capsule mirrors the Chrome bookmarks bar for quick access. */
  isBookmarkBarEnabled: boolean
}

/** What a fresh install runs with, and what a page falls back to. */
export const defaultOptions: Options = {
  mode: Modes.Illust,
  customTags: [],
  tagBookmarkTier: 0,
  // Carrying the session only changes anything once the user logs in on
  // pixiv; until then requests are anonymous either way.
  usePixivLogin: true,
  isExcludingMultiPage: false,
  isExcludingAI: false,
  minBookmarks: 0,
  excludedAuthors: [],
  excludingTags: [],
  isExcludingHighAspectRatio: false,
  smallestIncludableAspectRatio: 3,
  isSafe: true,
  // The gallery is the point of the page, so it starts out un-clickable.
  viewMode: ViewModes.Watch,
  isTileBookmarkEnabled: true,
  isBookmarkSearchEnabled: true,
  isBookmarkBarEnabled: true,
}

export const getOptions = async (): Promise<Options> => {
  // Everything in the store is a string ('3'), but this one is bound to an
  // <input type="number"> and compared against a ratio, so hand back a number.
  const aspectRatio = Number(
    await storageUtil.getValue(
      'smallest_includable_aspect_ratio',
      defaultOptions.smallestIncludableAspectRatio,
    ),
  )

  // Same string-to-number story as the aspect ratio: the store hands back the
  // raw string, and a missing key must fall back to the default, not NaN.
  const storedTier = await storageUtil.getValue('tag_bookmark_tier')
  const tier = Number(
    storedTier === undefined ? defaultOptions.tagBookmarkTier : storedTier,
  )
  const storedFloor = await storageUtil.getValue('min_bookmarks')
  const minBookmarks = Number(
    storedFloor === undefined ? defaultOptions.minBookmarks : storedFloor,
  )

  return {
    mode: await storageUtil.getValue('content', defaultOptions.mode),
    customTags: await storageUtil.getJSON(
      'custom_tags',
      defaultOptions.customTags,
    ),
    tagBookmarkTier: Number.isFinite(tier) ? tier : defaultOptions.tagBookmarkTier,
    usePixivLogin: await storageUtil.getBoolean(
      'use_pixiv_login',
      defaultOptions.usePixivLogin,
    ),
    isExcludingMultiPage: await storageUtil.getBoolean(
      'is_excluding_multi_page',
      defaultOptions.isExcludingMultiPage,
    ),
    isExcludingAI: await storageUtil.getBoolean(
      'is_excluding_ai',
      defaultOptions.isExcludingAI,
    ),
    minBookmarks: Number.isFinite(minBookmarks)
      ? minBookmarks
      : defaultOptions.minBookmarks,
    excludedAuthors: await storageUtil.getJSON(
      'excluding_authors',
      defaultOptions.excludedAuthors,
    ),
    excludingTags: await storageUtil.getJSON(
      'excluding_tags',
      defaultOptions.excludingTags,
    ),
    isExcludingHighAspectRatio: await storageUtil.getBoolean(
      'is_excluding_high_aspect_ratio',
      defaultOptions.isExcludingHighAspectRatio,
    ),
    smallestIncludableAspectRatio: Number.isFinite(aspectRatio)
      ? aspectRatio
      : defaultOptions.smallestIncludableAspectRatio,
    isSafe: await storageUtil.getBoolean('is_safe', defaultOptions.isSafe),
    viewMode: await storageUtil.getValue('view_mode', defaultOptions.viewMode),
    isTileBookmarkEnabled: await storageUtil.getBoolean(
      'tile_bookmark',
      defaultOptions.isTileBookmarkEnabled,
    ),
    isBookmarkSearchEnabled: await storageUtil.getBoolean(
      'bookmark_search',
      defaultOptions.isBookmarkSearchEnabled,
    ),
    isBookmarkBarEnabled: await storageUtil.getBoolean(
      'bookmark_bar',
      defaultOptions.isBookmarkBarEnabled,
    ),
  }
}

export const setMode = (mode: string) => {
  chrome.runtime.sendMessage(
    { method: 'setMode', params: { mode: mode } },
    () => {},
  )
}

export const setCustomTags = (tags: string[]) => {
  chrome.runtime.sendMessage(
    {
      method: 'setCustomTags',
      params: {
        custom_tags: tags,
      },
    },
    () => {},
  )
}

export const setTagBookmarkTier = (tier: number) => {
  chrome.runtime.sendMessage(
    {
      method: 'setTagBookmarkTier',
      params: {
        tag_bookmark_tier: tier,
      },
    },
    () => {},
  )
}

export const setUsePixivLogin = (usePixivLogin: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setUsePixivLogin',
      params: {
        use_pixiv_login: usePixivLogin,
      },
    },
    () => {},
  )
}

export const setExcludeMultiPage = (isExcluding: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setExcludeMultiPage',
      params: {
        is_excluding_multi_page: isExcluding,
      },
    },
    () => {},
  )
}

export const setExcludeAI = (isExcluding: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setExcludeAI',
      params: {
        is_excluding_ai: isExcluding,
      },
    },
    () => {},
  )
}

export const setMinBookmarks = (minBookmarks: number) => {
  chrome.runtime.sendMessage(
    {
      method: 'setMinBookmarks',
      params: {
        min_bookmarks: minBookmarks,
      },
    },
    () => {},
  )
}

export const setExcludedAuthors = (authors: string[]) => {
  chrome.runtime.sendMessage(
    {
      method: 'setExcludedAuthors',
      params: {
        excluding_authors: authors,
      },
    },
    () => {},
  )
}

export const setAspectRatioSettings = (isChecked: boolean, value: number) => {
  chrome.runtime.sendMessage(
    {
      method: 'setAspectRatioSettings',
      params: {
        is_excluding_high_aspect_ratio: isChecked,
        smallest_includable_aspect_ratio: value,
      },
    },
    () => {},
  )
}

export const setExcludingTags = (tags: string[]) => {
  chrome.runtime.sendMessage(
    {
      method: 'setExcludingTags',
      params: {
        excluding_tags: tags,
      },
    },
    () => {},
  )
}

export const setSafe = (isSafe: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setSafe',
      params: {
        is_safe: isSafe,
      },
    },
    () => {},
  )
}

export const setViewMode = (viewMode: ViewModes) => {
  chrome.runtime.sendMessage(
    {
      method: 'setViewMode',
      params: {
        view_mode: viewMode,
      },
    },
    () => {},
  )
}

export const setTileBookmark = (isEnabled: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setTileBookmark',
      params: {
        tile_bookmark: isEnabled,
      },
    },
    () => {},
  )
}

export const setBookmarkSearch = (isEnabled: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setBookmarkSearch',
      params: {
        bookmark_search: isEnabled,
      },
    },
    () => {},
  )
}

export const setBookmarkBar = (isEnabled: boolean) => {
  chrome.runtime.sendMessage(
    {
      method: 'setBookmarkBar',
      params: {
        bookmark_bar: isEnabled,
      },
    },
    () => {},
  )
}
