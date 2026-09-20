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
  children?: BookmarkNode[]
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

const getSubTree = (id: string) => call<BookmarkNode[]>('getSubTree', id)

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

/** A folder chip on the strip: its descendants, flattened depth-first. */
export interface BarFolder {
  id: string
  title: string
  children: BookmarkHit[]
}

/** One slot on the homepage strip: either a direct link or a folder menu. */
export type BarItem =
  | { kind: 'link'; hit: BookmarkHit }
  | { kind: 'folder'; folder: BarFolder }

/** A folder menu is glanceable; past fifty entries it is a manager's job. */
const FOLDER_CAP = 50

const hitOf = (node: BookmarkNode): BookmarkHit => ({
  id: node.id,
  title: node.title || node.url || '',
  url: node.url || '',
})

const flattenInto = (node: BookmarkNode, out: BookmarkHit[]) => {
  if (out.length >= FOLDER_CAP) return
  if (node.url) {
    out.push(hitOf(node))
    return
  }
  // The tile star's own folder holds artwork pages, not web destinations —
  // those belong to the wall, not the strip.
  if (node.title === FOLDER_TITLE) return
  const children = node.children || []
  for (let i = 0; i < children.length && out.length < FOLDER_CAP; i++) {
    flattenInto(children[i], out)
  }
}

/**
 * Quick-access entries for the homepage strip: the bookmarks bar first, then
 * Other Bookmarks — many users (and Chrome's own star button) file into Other
 * Bookmarks, so a bar-only read would leave the strip empty for exactly the
 * people who just started bookmarking. Top-level links become chips; folders
 * become menus that keep the user's own grouping (nested folders flatten
 * depth-first into the parent menu). Empty folders and the Ku-nya artwork
 * folder stay out.
 */
export const listBarItems = async (limit: number): Promise<BarItem[]> => {
  const items: BarItem[] = []
  const roots = [BOOKMARKS_BAR, OTHER_BOOKMARKS]
  for (let r = 0; r < roots.length && items.length < limit; r++) {
    const tree = await getSubTree(roots[r])
    const top = tree[0] && tree[0].children ? tree[0].children : []
    for (let i = 0; i < top.length && items.length < limit; i++) {
      const node = top[i]
      if (node.url) {
        items.push({ kind: 'link', hit: hitOf(node) })
        continue
      }
      if (node.title === FOLDER_TITLE) continue
      const children: BookmarkHit[] = []
      flattenInto(node, children)
      if (children.length === 0) continue
      items.push({
        kind: 'folder',
        folder: { id: node.id, title: node.title || '未命名文件夹', children },
      })
    }
  }
  return items
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
