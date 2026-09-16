import axios from 'axios'

/**
 * Whether pixiv requests carry the browser's login session (PHPSESSID). The
 * new tab page flips this from the stored `usePixivLogin` option before its
 * first fetch; anonymous requests behave exactly as before, a logged-in
 * session unlocks the account's full search results (incl. R-18 per the
 * account's own browsing settings).
 */
export const applyLoginPreference = (usePixivLogin: boolean) => {
  axios.defaults.withCredentials = usePixivLogin
}

export interface IllustEntry {
  id: number
  imageUrl: string
  title: string
  tags: string[]
  width: number
  height: number
  authorName: string
  sl: number | null
  /**
   * How many images the work contains. Multi-page works are usually manga
   * (or compilations), so the popup can filter them out. Every source API
   * carries the count, but under different names; null means the source
   * didn't say, and null is never filtered out.
   */
  pageCount: number | null
}

/** Page counts arrive as `pageCount` or `illust_page_count`, or not at all. */
const toPageCount = (value: any): number | null =>
  typeof value === 'number' ? value : null

const imageResolution = '600x1200_90'

/**
 * Ranking APIs hand back whatever thumbnail the listing used: `_square` and
 * `_custom` thumbs are centre-cropped squares whose pixels do NOT match
 * illust_width/illust_height. The puzzle wall sizes every tile from those
 * dimensions, so a square thumb would be stretched by up to ~50%. Normalise
 * every URL to the proportional master image.
 */
const toMasterUrl = (url: string): string =>
  url
    .replace(/c\/\d+x\d+(_\d+_\w+)?\//, `c/${imageResolution}/`)
    .replace('/custom-thumb/', '/img-master/')
    .replace('_square', '_master')
    .replace('_custom', '_master')

export const getNewIllusts = async (): Promise<IllustEntry[]> => {
  const URL =
    'https://www.pixiv.net/touch/ajax_api/ajax_api.php?mode=new_illust'
  const responses = await Promise.all([
    axios.get(`${URL}&p=4`),
    axios.get(`${URL}&p=5`),
    axios.get(`${URL}&p=6`),
    axios.get(`${URL}&p=7`),
  ])

  return responses
    .filter(res => res.status == 200)
    .map(res =>
      res.data.filter(content => typeof content.illust_id !== 'undefined'),
    )
    .map(res =>
      res.map(
        (content): IllustEntry => ({
          id: content.illust_id,
          imageUrl: toMasterUrl(content.url),
          title: content.title,
          tags: content.tags,
          width: content.illust_width,
          height: content.illust_height,
          authorName: content.user_name,
          sl: content.illust_sanity_level,
          pageCount: toPageCount(content.illust_page_count),
        }),
      ),
    )
    .reduce((l, r) => l.concat(...r), []) // flatten
}

export const getPopularIllusts = async (): Promise<IllustEntry[]> => {
  const URL =
    'https://www.pixiv.net/touch/ajax_api/ajax_api.php?mode=popular_illust&type='
  const responses = await Promise.all([
    axios.get(`${URL}&p=1`),
    axios.get(`${URL}&p=2`),
    axios.get(`${URL}&p=3`),
    axios.get(`${URL}&p=4`),
  ])

  return responses
    .filter(res => res.status == 200)
    .map(res =>
      res.data.filter(content => typeof content.illust_id !== 'undefined'),
    )
    .map(res =>
      res.map(
        (content): IllustEntry => ({
          id: content.illust_id,
          imageUrl: toMasterUrl(content.url),
          title: content.title,
          tags: content.tags,
          width: content.illust_width,
          height: content.illust_height,
          authorName: content.user_name,
          sl: content.illust_sanity_level,
          pageCount: toPageCount(content.illust_page_count),
        }),
      ),
    )
    .reduce((l, r) => l.concat(...r), []) // flatten
}

export const getOriginalRanking = async (): Promise<IllustEntry[]> => {
  const URL = 'https://www.pixiv.net/ranking.php?format=json&mode=original'
  const responses = await Promise.all([
    axios.get(`${URL}&p=1`),
    axios.get(`${URL}&p=2`),
    axios.get(`${URL}&p=3`),
  ])

  return responses
    .filter(res => res.status == 200)
    .map(res =>
      res.data.contents.map(
        (content): IllustEntry => ({
          id: content.illust_id,
          imageUrl: toMasterUrl(content.url),
          title: content.title,
          tags: content.tags,
          width: content.width,
          height: content.height,
          authorName: content.user_name,
          sl: null,
          pageCount: toPageCount(content.illust_page_count),
        }),
      ),
    )
    .reduce((l, r) => l.concat(...r), []) // flatten
}

/**
 * Bookmark tiers for the `Nusers入り` search keyword: the only popularity
 * filter a tag search gets without a premium login. `TAG_TIER_MIXED` asks for
 * the layered search instead of one tier.
 */
export const TAG_TIER_MIXED = -1
const MIXED_TIERS = [10000, 5000, 1000, 500]

/**
 * A user-defined tag category. The search listing answers anonymously; each
 * entry carries its own width/height, so the puzzle wall can size tiles
 * without a detail round-trip. `order=date_d` because the popular ordering
 * requires a premium login.
 */
const searchTag = async (
  word: string,
  pages: number[],
): Promise<IllustEntry[]> => {
  const URL = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(
    word,
  )}?order=date_d&mode=all&s_mode=s_tag`
  const responses = await Promise.all(
    pages.map(p => axios.get(`${URL}&p=${p}`)),
  )

  return responses
    .filter(
      res =>
        res.status == 200 &&
        res.data &&
        res.data.body &&
        res.data.body.illustManga,
    )
    .map(res =>
      res.data.body.illustManga.data
        // The listing pads itself with ad slots that look like artworks.
        .filter(content => content && content.id && !content.isAdContainer)
        .map(
          (content): IllustEntry => ({
            id: Number(content.id),
            imageUrl: toMasterUrl(content.url),
            title: content.title,
            tags: content.tags || [],
            width: content.width,
            height: content.height,
            authorName: content.userName,
            sl: typeof content.sl === 'number' ? content.sl : null,
            pageCount: toPageCount(content.pageCount),
          }),
        ),
    )
    .reduce((l, r) => l.concat(...r), []) // flatten
}

/**
 * A paginated tag content source. pixiv caps every search listing at 60
 * entries per page, so one pull is only the newest slice of a large tag; the
 * loader walks deeper pages on demand (App calls next() when its pool of
 * unshown entries runs dry).
 */
export interface TagLoader {
  /** Next batch of fresh entries; empty once the query has no more pages. */
  next(): Promise<IllustEntry[]>
  hasMore(): boolean
}

export const createTagLoader = (
  tag: string,
  tier: number = 0,
): TagLoader => {
  // One cursor per query: a single tier walks its own pages two at a time;
  // the layered mix walks every tier in lockstep so a thin high tier (some
  // tags have a dozen 10000users入り works in total) can't starve the wall.
  const mixed = tier === TAG_TIER_MIXED
  const words = mixed
    ? MIXED_TIERS.map(t => `${tag} ${t}users入り`)
    : [tier > 0 ? `${tag} ${tier}users入り` : tag]
  const cursors = words.map(() => 1)
  const exhausted = words.map(() => false)
  // New uploads shift page boundaries between batches, so overlap happens;
  // everything the loader ever hands out is deduped here.
  const seen: { [id: number]: boolean } = {}

  return {
    hasMore: () => exhausted.some(isDone => !isDone),
    next: async () => {
      const batch = await Promise.all(
        words.map((word, i) => {
          if (exhausted[i]) return Promise.resolve([] as IllustEntry[])
          const pages = mixed ? [cursors[i]] : [cursors[i], cursors[i] + 1]
          cursors[i] += pages.length
          return searchTag(word, pages)
            .then(entries => {
              // pixiv answers an out-of-range page with an empty listing.
              if (entries.length === 0) exhausted[i] = true
              return entries
            })
            .catch((error): IllustEntry[] => {
              // A network failure must not kill the cursor: stay retryable,
              // the next user gesture asks again. Warn so an all-cursor
              // failure (proxy still down, etc.) is visible in DevTools.
              console.warn('Ku-nya: tag search request failed', error)
              return []
            })
        }),
      )
      const merged: IllustEntry[] = batch.reduce((l, r) => l.concat(...r), [])
      return merged.filter(entry => {
        if (seen[entry.id]) return false
        seen[entry.id] = true
        return true
      })
    },
  }
}

export interface LoginStatus {
  loggedIn: boolean
  userName: string | null
  /** The probe never reached pixiv — distinct from a definite logged-out. */
  networkError: boolean
}

/**
 * Asks pixiv who the current session belongs to. Always credentialed —
 * detecting "not logged in" is the point. The endpoint answers 200 both ways:
 * anonymous is `{ userData: null, ... }`, a session fills `userData`. (An
 * earlier guess at pixiv's usual `{ error, body }` envelope read every real
 * session as logged-out.) A thrown request means the network, not pixiv,
 * answered — the popup reports that separately instead of claiming logged-out.
 */
export const getLoginStatus = async (): Promise<LoginStatus> => {
  try {
    const res = await axios.get('https://www.pixiv.net/ajax/user/self', {
      withCredentials: true,
    })
    const userData = res.data && res.data.userData
    if (userData && (userData.id || userData.userId)) {
      return {
        loggedIn: true,
        userName: userData.name || userData.userName || null,
        networkError: false,
      }
    }
    return { loggedIn: false, userName: null, networkError: false }
  } catch {
    return { loggedIn: false, userName: null, networkError: true }
  }
}

export const getRanking = async (
  content: 'illust' | 'manga' | 'ugoira',
): Promise<IllustEntry[]> => {  const URL = `https://www.pixiv.net/ranking.php?mode=daily&format=json&content=${content}`
  const responses = await Promise.all(
    [axios.get(`${URL}&p=1`), axios.get(`${URL}&p=2`)].concat(
      // cannnot fetch ugoira ranking over page 3.
      content !== 'ugoira' ? [axios.get(`${URL}&p=3`)] : [],
    ),
  )

  const id_chunk = responses
    .filter(res => res.status == 200)
    .map(res => res.data.contents.map(content => content.illust_id))

  const promises = await Promise.all(id_chunk.map(ids => getIllustsDetail(ids)))
  return promises.reduce((l, r) => l.concat(...r), []) // flatten
}

const getIllustsDetail = async (ids: Array<number>): Promise<IllustEntry[]> => {
  ids = ids.slice(0, 100) // NOTICE: this can't work over 100 ids because endpoint returns 400.
  const URL = encodeURI(
    'https://www.pixiv.net/ajax/user/11/illusts?ids[]=' + ids.join('&ids[]='),
  )

  const responses = await Promise.all([axios.get(URL)])
  return responses
    .filter(res => res.status == 200)
    .map(res => {
      const entities = []
      for (const id in res.data.body) {
        const content = res.data.body[id]
        entities.push({
          id: content.id,
          imageUrl: toMasterUrl(content.url),
          title: content.title,
          tags: content.tags,
          width: content.width,
          height: content.height,
          authorName: content.user_name,
          sl: content.sl,
          pageCount: toPageCount(content.pageCount),
        })
      }
      return entities
    })
    .reduce((l, r) => l.concat(...r), []) // flatten
}
