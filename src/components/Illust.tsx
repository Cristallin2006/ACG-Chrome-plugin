import { h, Component } from 'preact'
import { Tile } from '../lib/tiling'

interface Props {
  tile: Tile
  isInteractive: boolean
  /** This piece's stagger slot in its screen's reveal ripple (ms). */
  revealDelay: number
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
    const { tile, isInteractive, revealDelay } = this.props
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

    // 纯看模式 renders the piece on its own: no link, no tab stop, no caption,
    // no hover lift. There is nothing left to hit by accident.
    return isInteractive ? (
      <a
        class={className}
        style={style}
        ref={this.attachTile}
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
    ) : (
      <div class={className} style={style} ref={this.attachTile}>
        {image}
      </div>
    )
  }
}
