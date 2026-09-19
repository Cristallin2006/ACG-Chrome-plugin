import { h, Component } from 'preact'
import Illust from './Illust'
import SearchBar from './SearchBar'
import {
  IllustEntry,
  TagLoader,
  applyLoginPreference,
  createTagLoader,
  getOriginalRanking,
  getNewIllusts,
  getPopularIllusts,
  getDiscovery,
  getRanking,
} from '../lib/api'
import { Options, Modes, ViewModes, setViewMode } from '../lib/options'
import { Tile, computeTiling, pickTileCount } from '../lib/tiling'
import { shuffle } from '../lib/util'
import {
  isAvailable as bookmarksAvailable,
  listBookmarkedArtworkIds,
  setBookmarked,
} from '../lib/bookmarks'

/** A laid-out tile plus its stagger slot in the screen's reveal ripple. */
interface WallTile extends Tile {
  revealDelay: number
}

import * as Sentry from '@sentry/browser'
if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
  })
}

interface Props {
  options: Options
}

interface State {
  illusts: IllustEntry[]
  tiles: WallTile[]
  /** Pixel height of the whole wall: the screens laid out so far. */
  wallHeight: number
  viewMode: ViewModes
  /** Nothing to show: the ranking could not be fetched, or every entry was filtered out. */
  isUnavailable: boolean
  /** Artwork ids already filed in Chrome bookmarks; the tile star reads this. */
  bookmarkedIds: Set<number>
}

export default class App extends Component<Props, State> {
  private resizeTimer: number = 0
  /** How many one-viewport screens are currently laid out. */
  private screenCount = 0
  private sentinelObserver: IntersectionObserver | null = null
  private sentinelEl: HTMLDivElement | null = null
  /** Wheel paging: accumulated delta of the current gesture, its idle reset,
      and a lock that holds back new page turns while a glide is in flight. */
  private wheelRemainder = 0
  private wheelResetTimer: number = 0
  private pageLockTimer: number = 0
  /** Where the in-flight page glide is headed; landing there lifts the lock. */
  private pageTargetY = 0
  /** Tag sources paginate; null for the finite built-in rankings. */
  private tagLoader: TagLoader | null = null
  private isFetchingMore = false
  /** Pending quiet retry of the first load (see loadWall). */
  private retryTimer: number = 0

  constructor(props: Props) {
    super(props)
    this.state = {
      illusts: [],
      tiles: [],
      wallHeight: 0,
      viewMode: props.options.viewMode,
      isUnavailable: false,
      bookmarkedIds: new Set<number>(),
    }
  }

  async componentDidMount() {
    window.addEventListener('resize', this.handleResize)
    // Not passive: paging the wall means swallowing the native scroll.
    window.addEventListener('wheel', this.handleWheel, { passive: false })
    window.addEventListener('scroll', this.handleScroll, { passive: true })
    window.addEventListener('keydown', this.handleKeyDown)

    this.loadBookmarks()
    this.loadWall(0)
  }

  /**
   * The stars light up from the bookmark folder, not from the wall: a piece
   * the user filed last week shows lit the moment it is dealt again. The read
   * is best-effort — a denied bookmarks API must never hold back the gallery.
   */
  private loadBookmarks = async () => {
    if (!this.props.options.isTileBookmarkEnabled || !bookmarksAvailable()) {
      return
    }
    try {
      this.setState({ bookmarkedIds: new Set(await listBookmarkedArtworkIds()) })
    } catch (error) {
      console.error('Ku-nya: could not read bookmarks', error)
    }
  }

  /**
   * Optimistic: the star flips first, the bookmark manager catches up. A failed
   * write flips the star back — pretending the file landed would be worse.
   */
  private handleToggleBookmark = async (illust: IllustEntry) => {
    const previous = this.state.bookmarkedIds
    const next = !previous.has(illust.id)
    const flipped = new Set(previous)
    if (next) {
      flipped.add(illust.id)
    } else {
      flipped.delete(illust.id)
    }
    this.setState({ bookmarkedIds: flipped })
    try {
      await setBookmarked(illust, next)
    } catch (error) {
      console.error('Ku-nya: could not write the bookmark', error)
      this.setState({ bookmarkedIds: new Set(previous) })
    }
  }

  /**
   * ⇧R deals a fresh wall: the ranking is re-fetched and the puzzle re-laid
   * from the first screen. Plain typing belongs to the search field (see
   * SearchBar's global keydown), so the chord needs the shift modifier.
   */
  private handleKeyDown = (e: KeyboardEvent) => {
    if (!e.shiftKey || e.key !== 'R' || e.ctrlKey || e.metaKey || e.altKey) return
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'))
      return
    e.preventDefault()
    this.reloadWall()
  }

  private reloadWall = () => {
    window.clearTimeout(this.retryTimer)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
    this.loadBookmarks()
    this.loadWall(0)
  }

  /**
   * The first load can land in a dead window: right after a browser or
   * extension restart the proxy/VPN stack is still reconnecting, and every
   * pixiv request times out at once — the wall showed the empty state for
   * what a single F5 then fixes. Retry quietly (2.5s, 5s) before giving up.
   */
  private loadWall = async (attempt: number) => {
    const { options } = this.props

    // Cookie carrying is a module-level axios switch, so it has to be
    // decided before the first request goes out.
    applyLoginPreference(options.usePixivLogin)

    let allIllusts: IllustEntry[]
    try {
      const { mode } = options
      if (mode.indexOf('tag:') === 0) {
        // Tag sources are paginated: the first batch is the newest slice,
        // and the wall asks for deeper pages when the pool runs dry. A fresh
        // loader per attempt, so a failed first try re-reads pages 1-2.
        this.tagLoader = createTagLoader(mode.slice(4), options.tagBookmarkTier)
        allIllusts = await this.tagLoader.next()
      } else {
        allIllusts = await this.loadContent(options)
      }
    } catch (error) {
      console.error('Ku-nya: could not load illustrations', error)
      if (attempt < 2) {
        this.retryTimer = window.setTimeout(() => this.loadWall(attempt + 1), 2500)
        return
      }
      // An empty dark page with no explanation reads as a broken extension.
      this.setState({ isUnavailable: true })
      return
    }

    const illusts = this.filterPool(await shuffle(allIllusts))
    if (illusts.length === 0 && attempt < 2) {
      this.retryTimer = window.setTimeout(() => this.loadWall(attempt + 1), 2500)
      return
    }

    this.screenCount = 0
    this.setState(
      { illusts, isUnavailable: illusts.length === 0 },
      this.appendScreen,
    )
  }

  /**
   * Every filter the wall applies, factored out so a refilled batch passes
   * the same gates as the first one.
   */
  private filterPool(entries: IllustEntry[]): IllustEntry[] {
    const { options } = this.props
    return entries
      .filter(illust => {
        // reject if contains tags to be excluded
        return !illust.tags.some(tag => options.excludingTags.includes(tag))
      })
      .filter(illust => {
        return (
          illust.height / illust.width <= options.smallestIncludableAspectRatio
        )
      })
      .filter(illust => {
        if (illust.sl === null) return true
        if (options.isSafe) return illust.sl === 2
        return true
      })
      .filter(illust => {
        // Multi-page works are usually manga: the wall would show the cover.
        if (!options.isExcludingMultiPage) return true
        // Unknown page count is kept — never filter on missing data.
        return illust.pageCount === null || illust.pageCount <= 1
      })
      .filter(illust => {
        // pixiv marks AI-generated works with aiType 2.
        if (!options.isExcludingAI) return true
        // Unknown is kept — never filter on missing data.
        return illust.aiType !== 2
      })
      .filter(illust => {
        if (options.minBookmarks <= 0) return true
        // Sources that don't report counts are kept — never filter on
        // missing data, or those sources would empty the wall entirely.
        return (
          illust.bookmarkCount === null ||
          illust.bookmarkCount >= options.minBookmarks
        )
      })
      .filter(illust => {
        if (options.excludedAuthors.length === 0) return true
        const author = illust.authorName.toLowerCase().trim()
        return !options.excludedAuthors.some(
          name => name.toLowerCase().trim() === author,
        )
      })
  }

  /**
   * The pool ran dry but the tag source has deeper pages: pull the next
   * batch, filter it like the first, and grow the wall by a screen. Empty
   * batches (transient failures) leave everything as-is — the next wheel
   * gesture or sentinel crossing asks again.
   */
  private fetchMore = async () => {
    const loader = this.tagLoader
    if (!loader || this.isFetchingMore || !loader.hasMore()) return
    this.isFetchingMore = true
    try {
      const fresh = this.filterPool(await shuffle(await loader.next()))
      if (fresh.length > 0) {
        this.setState({ illusts: this.state.illusts.concat(fresh) }, () =>
          this.layOutScreens(this.screenCount + 1),
        )
      } else {
        // Empty batch: either the source just exhausted (the re-layout drops
        // the sentinel) or the network flaked (a later gesture asks again).
        this.layOutScreens(this.screenCount)
      }
    } catch (error) {
      console.error('Ku-nya: could not fetch more illustrations', error)
    } finally {
      this.isFetchingMore = false
    }
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.handleResize)
    window.removeEventListener('wheel', this.handleWheel)
    window.removeEventListener('scroll', this.handleScroll)
    window.removeEventListener('keydown', this.handleKeyDown)
    window.clearTimeout(this.resizeTimer)
    window.clearTimeout(this.wheelResetTimer)
    window.clearTimeout(this.pageLockTimer)
    window.clearTimeout(this.retryTimer)
    if (this.sentinelObserver) this.sentinelObserver.disconnect()
  }

  /**
   * The wall is paged, not scrolled: one wheel gesture turns exactly one
   * screen of the puzzle, like slides. A mouse wheel arrives as one big
   * delta per notch; a touchpad streams small ones, so deltas accumulate
   * until the gesture clearly means a page (60px, reset after 180ms of
   * silence). While a glide is in flight the lock drops further input —
   * otherwise a single long flick would tear through half the ranking.
   */
  private handleWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
    e.preventDefault()
    if (this.pageLockTimer) {
      this.wheelRemainder = 0
      return
    }
    this.wheelRemainder += e.deltaY
    window.clearTimeout(this.wheelResetTimer)
    this.wheelResetTimer = window.setTimeout(() => {
      this.wheelRemainder = 0
    }, 180)
    if (Math.abs(this.wheelRemainder) < 60) return
    const dir = this.wheelRemainder > 0 ? 1 : -1
    this.wheelRemainder = 0
    this.turnPage(dir)
  }

  /**
   * The glide unlocks when it LANDS, not after a fixed delay: a timer guess
   * that outlives the animation lets one flick turn two pages, while a guess
   * that the main thread delays (image decode storms) swallows the next
   * gesture whole. The fallback timer only covers the glide never arriving —
   * e.g. the user grabs the scrollbar mid-flight.
   */
  private turnPage = (dir: number) => {
    // clientHeight matches the tiling's clientWidth: the stable scrollbar
    // gutter keeps both constant whether or not the wall overflows.
    const h = document.documentElement.clientHeight
    const current = Math.round(window.scrollY / h)
    const target = current + dir
    if (target < 0) return
    if (target >= this.screenCount) {
      // Past the dealt end: try to deal the next screen on the spot; if the
      // ranking is exhausted there is simply no page to turn to.
      this.appendScreen()
      if (target >= this.screenCount) return
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches
    this.pageTargetY = target * h
    window.scrollTo({ top: this.pageTargetY, behavior: reduced ? 'auto' : 'smooth' })
    window.clearTimeout(this.pageLockTimer)
    this.pageLockTimer = window.setTimeout(() => {
      this.pageLockTimer = 0
    }, 1200)
    if (reduced) this.handleScroll()
  }

  private handleScroll = () => {
    if (
      this.pageLockTimer &&
      Math.abs(window.scrollY - this.pageTargetY) < 2
    ) {
      window.clearTimeout(this.pageLockTimer)
      this.pageLockTimer = 0
    }
  }

  private handleResize = () => {
    window.clearTimeout(this.resizeTimer)
    this.resizeTimer = window.setTimeout(this.relayout, 150)
  }

  /** Re-lay-out the screens already shown at the new viewport size. */
  private relayout = () => {
    if (this.state.illusts.length === 0 || this.screenCount === 0) return
    this.layOutScreens(this.screenCount)
  }

  /**
   * Deal one more screen of the wall. A dry pool asks the tag source for the
   * next page (see layOutScreens); a finite ranking simply stops.
   */
  private appendScreen = () => {
    if (this.state.illusts.length === 0) return
    this.layOutScreens(this.screenCount + 1)
  }

  /**
   * The wall is a stack of one-viewport screens, each an exact-fit puzzle of
   * its own (see lib/tiling.ts). Screens share the shuffled pool in order;
   * images a screen evicts as runts go back into the pool and get another
   * chance on a later screen. Recomputing is cheap enough (~ms per screen)
   * that append and resize both simply redo every screen dealt so far.
   */
  private layOutScreens(count: number) {
    const { illusts } = this.state
    // clientWidth, not innerWidth: once the wall grows past one viewport the
    // vertical scrollbar takes 10px, and a wall laid to innerWidth would
    // overflow sideways and summon a horizontal scrollbar.
    const w = document.documentElement.clientWidth
    const h = document.documentElement.clientHeight
    const perScreen = pickTileCount(w, h, illusts.length)

    let remaining = illusts.slice()
    const tiles: WallTile[] = []
    let screens = 0
    for (; screens < count && remaining.length > 0; screens++) {
      const batch = remaining.slice(0, perScreen)
      const screenTiles = computeTiling(w, h, batch)
      const used: { [id: number]: boolean } = {}
      for (let i = 0; i < screenTiles.length; i++) {
        used[screenTiles[i].illust.id] = true
      }
      remaining = remaining.filter(i => !used[i.id])

      // Reveal ripple: order the screen's pieces by distance from the
      // top-left corner, then deal each one 26ms after the last. The wall
      // washes in as a wave instead of landing as a slab.
      const order = screenTiles
        .map((t, i) => i)
        .sort(
          (a, b) =>
            screenTiles[a].x + screenTiles[a].y -
            (screenTiles[b].x + screenTiles[b].y),
        )
      for (let rank = 0; rank < order.length; rank++) {
        const t = screenTiles[order[rank]]
        tiles.push({
          illust: t.illust,
          x: t.x,
          y: t.y + screens * h,
          w: t.w,
          h: t.h,
          revealDelay: Math.min(rank * 26, 420),
        })
      }
    }

    this.screenCount = screens
    this.setState({ tiles, wallHeight: screens * h })

    const loader = this.tagLoader
    const canRefill = loader !== null && loader.hasMore()
    // The pool is running low. A paginated tag source has deeper pages
    // upstream: start the refill BEFORE the wall runs dry — a screen's
    // evicted runts go back into the pool, so an exact zero is never
    // guaranteed and waiting for it could stall the refill forever.
    if (canRefill && remaining.length < perScreen) {
      this.fetchMore()
    }
    if (remaining.length === 0 && !canRefill) {
      // Truly exhausted: no sentinel can ever deal another screen.
      if (this.sentinelObserver) {
        this.sentinelObserver.disconnect()
        this.sentinelObserver = null
      }
      return
    }
    // IntersectionObserver only fires on boundary CROSSES, but the sentinel
    // sits inside the root margin while the wall is short — the initial
    // notification arrives before the first screen exists and is a no-op.
    // Re-observing after every layout re-asks the question with the wall at
    // its new height, which is what actually deals screen two and beyond.
    this.pokeSentinel()
  }

  private pokeSentinel = () => {
    if (!this.sentinelObserver || !this.sentinelEl) return
    this.sentinelObserver.disconnect()
    this.sentinelObserver.observe(this.sentinelEl)
  }

  private attachSentinel = (el: HTMLDivElement | null) => {
    if (this.sentinelObserver) {
      this.sentinelObserver.disconnect()
      this.sentinelObserver = null
    }
    this.sentinelEl = el
    if (!el) return
    if (!('IntersectionObserver' in window)) {
      // No observer support: fall back to dealing the whole wall at once.
      this.layOutScreens(Math.ceil(this.state.illusts.length / 8))
      return
    }
    this.sentinelObserver = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) this.appendScreen()
      },
      // Deal the next screen well before its edge scrolls into view, so the
      // images are already fading in when the user arrives.
      { rootMargin: '800px 0px' },
    )
    this.sentinelObserver.observe(el)
  }

  /** Built-in rankings only; tag sources are paginated (see componentDidMount). */
  loadContent(options: Options): Promise<IllustEntry[]> {
    const { mode } = options

    return mode === Modes.Original
      ? getOriginalRanking()
      : mode === Modes.Newer
      ? getNewIllusts()
      : mode === Modes.Popular
      ? getPopularIllusts()
      : mode === Modes.Discovery
      ? getDiscovery()
      : getRanking(mode as 'illust' | 'manga' | 'ugoira')
  }

  handleViewModeChange = (viewMode: ViewModes) => {
    this.setState({ viewMode })
    setViewMode(viewMode)
  }

  render() {
    const { tiles, wallHeight, viewMode, isUnavailable } = this.state
    const isInteractive = viewMode === ViewModes.Interactive

    return (
      <div class={isInteractive ? 'kunya is-interactive' : 'kunya is-watch'}>
        <div class="kunya-gallery" style={{ height: `${wallHeight}px` }}>
          {tiles.map(tile => (
            <Illust
              key={tile.illust.id}
              isInteractive={isInteractive}
              tile={tile}
              revealDelay={tile.revealDelay}
              isBookmarkEnabled={this.props.options.isTileBookmarkEnabled}
              isBookmarked={this.state.bookmarkedIds.has(tile.illust.id)}
              onToggleBookmark={this.handleToggleBookmark}
            />
          ))}
        </div>
        <div class="kunya-sentinel" ref={this.attachSentinel} />

        {isUnavailable && (
          <p class="kunya-empty">
            暂时取不到插画，稍后刷新即可。
            <a
              href="https://www.pixiv.net/ranking.php"
              target="_blank"
              rel="noopener noreferrer"
            >
              打开 pixiv 排行榜
            </a>
          </p>
        )}

        <SearchBar
          viewMode={viewMode}
          onViewModeChange={this.handleViewModeChange}
          isBookmarkSearchEnabled={this.props.options.isBookmarkSearchEnabled}
        />
      </div>
    )
  }
}
