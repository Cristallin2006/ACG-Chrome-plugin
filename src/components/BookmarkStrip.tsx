import { h, Component } from 'preact'
import {
  BookmarkHit,
  faviconUrl,
  isAvailable,
  listBarBookmarks,
} from '../lib/bookmarks'

interface Props {
  /** Mirrors the capsule's idle step-back: the two dim together. */
  isGhost: boolean
  /** While the capsule is risen the scrim owns the room; the strip bows out. */
  isRisen: boolean
  isEnabled: boolean
}

interface State {
  items: BookmarkHit[]
}

/** One row is glanceable; twenty is already past that. */
const LIMIT = 20

/**
 * The homepage bookmark strip: a single row of quick-access links floating
 * above the search capsule — the bookmarks bar's direct links first, Other
 * Bookmarks' after (Chrome's own star button files there, so a bar-only read
 * would leave the strip empty for most casual users). It holds no state of
 * its own — the bar is re-read on mount, on chrome.bookmarks.onChanged (where
 * the platform delivers it), and every time the tab regains focus or
 * visibility, which is how edits made in Chrome's bookmark manager reach an
 * open tab.
 */
export default class BookmarkStrip extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { items: [] }
  }

  componentDidMount() {
    if (!isAvailable()) return
    void this.reload()
    const api = (chrome as any).bookmarks
    if (api && api.onChanged) api.onChanged.addListener(this.reload)
    document.addEventListener('visibilitychange', this.handleVisible)
    window.addEventListener('focus', this.reload)
  }

  componentWillUnmount() {
    if (!isAvailable()) return
    const api = (chrome as any).bookmarks
    if (api && api.onChanged) api.onChanged.removeListener(this.reload)
    document.removeEventListener('visibilitychange', this.handleVisible)
    window.removeEventListener('focus', this.reload)
  }

  private handleVisible = () => {
    if (!document.hidden) void this.reload()
  }

  private reload = async () => {
    if (!this.props.isEnabled) return
    try {
      this.setState({ items: await listBarBookmarks(LIMIT) })
    } catch (error) {
      console.error('Ku-nya: could not read the bookmarks bar', error)
    }
  }

  render() {
    if (!this.props.isEnabled || this.state.items.length === 0) return null
    const className = `kunya-marks${this.props.isGhost ? ' is-ghost' : ''}${
      this.props.isRisen ? ' is-dimmed' : ''
    }`
    return (
      <nav class={className} aria-label="书签栏">
        {this.state.items.map(hit => (
          <a
            key={hit.id}
            class="kunya-marks__item"
            href={hit.url}
            title={hit.title}
          >
            <img src={faviconUrl(hit.url)} alt="" width="14" height="14" />
            <span class="kunya-marks__title">{hit.title}</span>
          </a>
        ))}
      </nav>
    )
  }
}
