import * as storageUtil from '../lib/StorageUtil'

export enum Modes {
  Original = 'original',
  Illust = 'illust',
  Manga = 'manga',
  Ugoira = 'ugoira',
  Newer = 'newer',
  Popular = 'popular',
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
  excludingTags: string[]
  isExcludingHighAspectRatio: boolean
  smallestIncludableAspectRatio: number
  isSafe: boolean
  viewMode: ViewModes
}

/** What a fresh install runs with, and what a page falls back to. */
export const defaultOptions: Options = {
  mode: Modes.Illust,
  customTags: [],
  excludingTags: [],
  isExcludingHighAspectRatio: false,
  smallestIncludableAspectRatio: 3,
  isSafe: true,
  // The gallery is the point of the page, so it starts out un-clickable.
  viewMode: ViewModes.Watch,
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

  return {
    mode: await storageUtil.getValue('content', defaultOptions.mode),
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
  }
}

export const setMode = (mode: Modes) => {
  chrome.runtime.sendMessage(
    { method: 'setMode', params: { mode: mode } },
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
