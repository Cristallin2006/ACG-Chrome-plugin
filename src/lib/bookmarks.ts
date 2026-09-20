/**
 * Chrome bookmarks are the wall's memory. The star on a puzzle piece files the
 * artwork page into a "Ku-nya" folder in Other Bookmarks — ordinary Chrome
 * bookmarks, so they sync and show up in the manager like anything the user
 * saved by hand. The risen search capsule also answers with matching bookmarks
 * before the web search goes out.
 *
 * The pinned @types/chrome predates this API's promise form, so every call is
 * wrapped in a callback-style promise — the same trick lib/search.ts uses for
 * chrome.search.
 */

import { IllustEntry } from './api'

export interface BookmarkHit {
  id: string
  title: string
  url: string
}

interface BookmarkNode {
  id: string
  title: string
  url?: string
  parentId?: string
}

const FOLDER_TITLE = 'Ku-nya'
/** The fixed id of Chrome's "Other Bookmarks" root. */
const OTHER_BOOKMARKS = '2'
/** The fixed id of Chrome's bookmarks bar — what the homepage strip mirrors. */
const BOOKMARKS_BAR = '1'
const ARTWORK_PATH = /^https:\/\/www\.pixiv\.net\/artworks\/(\d+)/

export const artworkUrl = (id: number): string =>
  `https://www.pixiv.net/artworks/${id}`

export const isAvailable = (): boolean =>
  typeof chrome !== 'undefined' && !!(chrome as any).bookmarks

const api = (): any => (chrome as any).bookmarks

const call = <T>(method: string, ...args: any[]): Promise<T> =>
  new Promise((resolve, reject) => {
    try {
      api()[method](...args, (result: T) => {
        const lastError = (chrome as any).runtime
          ? (chrome as any).runtime.lastError
          : null
        if (lastError) {
          reject(new Error(lastError.message))
        } else {
          resolve(result)
        }
      })
    } catch (error) {
      reject(error)
    }
  })

const search = (query: string | { url?: string; title?: string }) =>
  call<BookmarkNode[]>('search', query)

const create = (node: { parentId?: string; title: string; url?: string }) =>
  call<BookmarkNode>('create', node)

const remove = (id: string) => call<void>('remove', id)

const getChildren = (id: string) => call<BookmarkNode[]>('getChildren', id)

/**
 * The folder is looked up, not remembered: the user is free to move or rename
 * things in the bookmark manager between sessions, and a stale id must never
 * throw the star button into an error state. A bookmark (has a url) that merely
 * shares the folder's name is not the folder.
 */
const findFolder = async (): Promise<string | null> => {
  const named = await search({ title: FOLDER_TITLE })
  const folder = named.filter(node => !node.url)[0]
  return folder ? folder.id : null
}

/**
 * Only a write may create the folder. Reading (to light up the stars) must
 * not plant an empty Ku-nya folder in the bookmarks of a user who never
 * starred anything.
 */
const ensureFolder = async (): Promise<string> => {
  const existing = await findFolder()
  if (existing) return existing
  const made = await create({ parentId: OTHER_BOOKMARKS, title: FOLDER_TITLE })
  return made.id
}

/** Ids of every artwork page filed in the Ku-nya folder. */
export const listBookmarkedArtworkIds = async (): Promise<number[]> => {
  const folderId = await findFolder()
  if (!folderId) return []
  const children = await getChildren(folderId)
  const ids: number[] = []
  for (let i = 0; i < children.length; i++) {
    const url = children[i].url
    if (!url) continue
    const match = ARTWORK_PATH.exec(url)
    if (match) ids.push(Number(match[1]))
  }
  return ids
}

/**
 * Toggle target state. Adding files into the Ku-nya folder; removing deletes
 * every bookmark that points at the artwork page, wherever it lives — a star
 * that only half-removes would look broken.
 */
export const setBookmarked = async (
  illust: IllustEntry,
  want: boolean,
): Promise<void> => {
  const url = artworkUrl(illust.id)
  const existing = await search({ url })
  if (want) {
    if (existing.length > 0) return
    const folderId = await ensureFolder()
    await create({
      parentId: folderId,
      title: `${illust.title} / ${illust.authorName}`,
      url,
    })
    return
  }
  for (let i = 0; i < existing.length; i++) {
    await remove(existing[i].id)
  }
}

/** Title-or-url matches for the capsule's suggestion panel, folders excluded. */
export const queryBookmarks = async (
  text: string,
  limit: number,
): Promise<BookmarkHit[]> => {
  const nodes = await search(text)
  const hits: BookmarkHit[] = []
  for (let i = 0; i < nodes.length && hits.length < limit; i++) {
    const node = nodes[i]
    if (!node.url) continue
    hits.push({ id: node.id, title: node.title || node.url, url: node.url })
  }
  return hits
}

/** "https://www.pixiv.net/artworks/1" → "www.pixiv.net"; unusable urls echo back. */
export const hostOf = (url: string): string => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)
  return match ? match[1] : url
}

/**
 * Quick-access links for the homepage strip: the bookmarks bar's direct links
 * first, then Other Bookmarks' — many users (and Chrome's own star button)
 * file into Other Bookmarks, so a bar-only read would leave the strip empty
 * for exactly the people who just started bookmarking. Folders are skipped:
 * the strip is one row of destinations, not a menu system.
 */
export const listBarBookmarks = async (
  limit: number,
): Promise<BookmarkHit[]> => {
  const hits: BookmarkHit[] = []
  const roots = [BOOKMARKS_BAR, OTHER_BOOKMARKS]
  for (let r = 0; r < roots.length && hits.length < limit; r++) {
    const children = await getChildren(roots[r])
    for (let i = 0; i < children.length && hits.length < limit; i++) {
      const node = children[i]
      if (!node.url) continue
      hits.push({ id: node.id, title: node.title || node.url, url: node.url })
    }
  }
  return hits
}

/**
 * MV3's favicon endpoint (needs the "favicon" permission): Chrome serves the
 * icon it already shows for the page, so the strip never hot-links a site.
 * Asked at 32px so a 14px slot stays sharp on hidpi screens.
 */
export const faviconUrl = (pageUrl: string): string =>
  chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`,
  )
