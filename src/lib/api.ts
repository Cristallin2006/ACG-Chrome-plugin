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
}

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
          }),
        ),
    )
    .reduce((l, r) => l.concat(...r), []) // flatten
}

/**
 * `tier` is a bookmark floor: 100 filters to `tag 100users入り`, and so on.
 * `TAG_TIER_MIXED` runs the layered search — one query per tier, high tiers
 * first, deduped by id — so the wall mixes flagship pieces with merely-good
 * ones instead of starving on a single high bar.
 */
export const getIllustsByTag = async (
  tag: string,
  tier: number = 0,
): Promise<IllustEntry[]> => {
  if (tier === TAG_TIER_MIXED) {
    // A tier with no recent uploads answers 0 entries; treat a failed layer
    // as empty rather than sinking the whole wall.
    const layers = await Promise.all(
      MIXED_TIERS.map(t =>
        searchTag(`${tag} ${t}users入り`, [1]).catch((): IllustEntry[] => []),
      ),
    )
    const seen: { [id: number]: boolean } = {}
    const merged: IllustEntry[] = []
    layers.forEach(layer =>
      layer.forEach(entry => {
        if (seen[entry.id]) return
        seen[entry.id] = true
        merged.push(entry)
      }),
    )
    return merged
  }

  const word = tier > 0 ? `${tag} ${tier}users入り` : tag
  return searchTag(word, [1, 2])
}

export interface LoginStatus {
  loggedIn: boolean
  userName: string | null
}

/**
 * Asks pixiv who the current session belongs to. Always credentialed —
 * detecting "not logged in" is the point — and deliberately quiet: a network
 * failure reads as logged-out, the popup's status line says so either way.
 */
export const getLoginStatus = async (): Promise<LoginStatus> => {
  try {
    const res = await axios.get('https://www.pixiv.net/ajax/user/self', {
      withCredentials: true,
    })
    const body = res.data && res.data.body
    if (res.data && res.data.error === false && body && body.userId) {
      return { loggedIn: true, userName: body.userName || null }
    }
  } catch {
    // fall through to logged-out
  }
  return { loggedIn: false, userName: null }
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
        })
      }
      return entities
    })
    .reduce((l, r) => l.concat(...r), []) // flatten
}
