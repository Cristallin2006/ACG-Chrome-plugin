import { h, Component } from 'preact'
import Illust from './Illust'
import SearchBar from './SearchBar'
import {
  IllustEntry,
  getOriginalRanking,
  getNewIllusts,
  getPopularIllusts,
  getRanking,
} from '../lib/api'
import { Options, Modes, ViewModes, setViewMode } from '../lib/options'
import { Tile, computeTiling, pickTileCount } from '../lib/tiling'
import { shuffle } from '../lib/util'

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
}

export default class App extends Component<Props, State> {
  private resizeTimer: number = 0
  /** How many one-viewport screens are currently laid out. */
  private screenCount = 0
  private sentinelObserver: IntersectionObserver | null = null
  private sentinelEl: HTMLDivElement | null = null

  constructor(props: Props) {
    super(props)
    this.state = {
      illusts: [],
      tiles: [],
      wallHeight: 0,
      viewMode: props.options.viewMode,
      isUnavailable: false,
    }
  }

  async componentDidMount() {
    const { options } = this.props

    window.addEventListener('resize', this.handleResize)

    let allIllusts: IllustEntry[]
    try {
      allIllusts = await this.loadContent(options)
    } catch (error) {
      // An empty dark page with no explanation reads as a broken extension.
      console.error('Ku-nya: could not load illustrations', error)
      this.setState({ isUnavailable: true })
      return
    }

    const illusts = await shuffle(allIllusts)
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

    this.screenCount = 0
    this.setState(
      { illusts, isUnavailable: illusts.length === 0 },
      this.appendScreen,
    )
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.handleResize)
    window.clearTimeout(this.resizeTimer)
    if (this.sentinelObserver) this.sentinelObserver.disconnect()
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

  /** Deal one more screen of the wall (no-op once the ranking is exhausted). */
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
    const w = window.innerWidth
    const h = window.innerHeight
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

    // The ranking is exhausted: no sentinel can ever deal another screen.
    if (remaining.length === 0 && this.sentinelObserver) {
      this.sentinelObserver.disconnect()
      this.sentinelObserver = null
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

  loadContent(options: Options): Promise<IllustEntry[]> {
    const { mode } = options

    return mode === Modes.Original
      ? getOriginalRanking()
      : mode === Modes.Newer
      ? getNewIllusts()
      : mode === Modes.Popular
      ? getPopularIllusts()
      : getRanking(mode)
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
        />
      </div>
    )
  }
}
