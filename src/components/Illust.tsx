import { h, Component } from 'preact'
import { Tile } from '../lib/tiling'
import { IllustEntry } from '../lib/api'

interface Props {
  tile: Tile
  isInteractive: boolean
  /** This piece's stagger slot in its screen's reveal ripple (ms). */
  revealDelay: number
  /** The hover star is part of 交互 mode and can be switched off in the popup. */
  isBookmarkEnabled: boolean
  isBookmarked: boolean
  onToggleBookmark(illust: IllustEntry): void
}

interface State {
  isLoaded: boolean
  isInView: boolean
}

/**
 * One puzzle piece. The tile's rectangle already matches the illustration's
 * own aspect ratio (see lib/tiling.ts), so the image fills it without being
 * cropped. It fades itself in as soon as it has pixels: waiting for the whole
 * ranking to finish loading first leaves the new tab as an empty dark page
 * for as long as the slowest image takes.
 *
 * Pieces below the fold start hidden and rise into place as they scroll into
 * view — the wall exposes itself progressively instead of arriving all at
 * once.
 */
export default class Illust extends Component<Props, State> {
  private viewObserver: IntersectionObserver | null = null

  constructor(props: Props) {
    super(props)
    this.state = { isLoaded: false, isInView: false }
  }

  componentWillUnmount() {
    if (this.viewObserver) this.viewObserver.disconnect()
  }

  private handleLoad = () => {
    if (!this.state.isLoaded) this.setState({ isLoaded: true })
  }

  /**
   * The star must never open the artwork page: it sits inside the tile's click
   * surface, so it swallows its own click before the link can see it.
   */
  private handleBookmarkClick = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    this.props.onToggleBookmark(this.props.tile.illust)
  }

  private attach = (img: HTMLImageElement | null) => {
    if (!img) return
    // A cached image can already be complete before the ref runs, in which case
    // no load event is coming.
    if (img.complete) {
      window.setTimeout(this.handleLoad, 0)
      return
    }
    img.onload = img.onerror = this.handleLoad
  }

  private attachTile = (el: HTMLElement | null) => {
    if (!el || this.state.isInView || this.viewObserver) return
    if (!('IntersectionObserver' in window)) {
      this.setState({ isInView: true })
      return
    }
    this.viewObserver = new IntersectionObserver(
      entries => {
        if (!entries.some(e => e.isIntersecting)) return
        if (this.viewObserver) this.viewObserver.disconnect()
        this.viewObserver = null
        this.setState({ isInView: true })
      },
      { rootMargin: '0px 0px 120px 0px' },
    )
    this.viewObserver.observe(el)
  }

  render() {
    const {
      tile,
      isInteractive,
      revealDelay,
      isBookmarkEnabled,
      isBookmarked,
    } = this.props
    const { illust } = tile

    const style = {
      left: `${tile.x}px`,
      top: `${tile.y}px`,
      width: `${tile.w}px`,
      height: `${tile.h}px`,
      // Lives on the element only until is-inview clears the pre-reveal state;
      // the hover rules pin transition-delay back to 0 so a leftover ripple
      // slot never slows the pointer's spring.
      transitionDelay: `${revealDelay}ms`,
    }
    const className = this.state.isInView
      ? 'kunya-tile is-inview'
      : 'kunya-tile'

    const image = (
      <img
        className={this.state.isLoaded ? 'loaded' : ''}
        alt={`${illust.authorName} / ${illust.title}`}
        src={illust.imageUrl}
        ref={this.attach}
      />
    )

    // The star sits beside the link, not inside it — a button nested in an
    // anchor is neither valid HTML nor honest to a screen reader. The link
    // fills the tile's content box; the star floats over its top-right corner.
    const mark = isBookmarkEnabled ? (
      <button
        type="button"
        class={isBookmarked ? 'kunya-tile__mark is-on' : 'kunya-tile__mark'}
        aria-pressed={isBookmarked ? 'true' : 'false'}
        aria-label={isBookmarked ? '从 Chrome 书签移除' : '收藏到 Chrome 书签'}
        title={isBookmarked ? '从 Chrome 书签移除' : '收藏到 Chrome 书签'}
        onClick={this.handleBookmarkClick}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M8 2.6 L9.8 6 L13.6 6.5 L10.9 9.3 L11.5 13.2 L8 11.3 L4.5 13.2 L5.1 9.3 L2.4 6.5 L6.2 6 Z"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    ) : null

    // 纯看模式 renders the piece on its own: no link, no tab stop, no caption,
    // no star, no hover lift. There is nothing left to hit by accident.
    return isInteractive ? (
      <div class={className} style={style} ref={this.attachTile}>
        <a
          class="kunya-tile__link"
          href={`https://www.pixiv.net/artworks/${illust.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {image}
          <span class="kunya-caption">
            <span class="kunya-caption__author">{illust.authorName}</span>
            <span class="kunya-caption__title">{illust.title}</span>
          </span>
        </a>
        {mark}
      </div>
    ) : (
      <div class={className} style={style} ref={this.attachTile}>
        {image}
      </div>
    )
  }
}
