import axios from 'axios'

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
 * A user-defined tag category. The search listing answers anonymously; each
 * entry carries its own width/height, so the puzzle wall can size tiles
 * without a detail round-trip. `order=date_d` because the popular ordering
 * requires a premium login.
 */
export const getIllustsByTag = async (tag: string): Promise<IllustEntry[]> => {
  const URL = `https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(
    tag,
  )}?order=date_d&mode=all&s_mode=s_tag`
  const responses = await Promise.all([
    axios.get(`${URL}&p=1`),
    axios.get(`${URL}&p=2`),
  ])

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
