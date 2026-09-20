import { h, Component } from 'preact'
import {
  BarFolder,
  BarItem,
  faviconUrl,
  isAvailable,
  listBarItems,
} from '../lib/bookmarks'

interface Props {
  /** Mirrors the capsule's idle step-back: the two dim together. */
  isGhost: boolean
  /** While the capsule is risen the scrim owns the room; the strip bows out. */
  isRisen: boolean
  isEnabled: boolean
}

interface State {
  items: BarItem[]
  /** Chips up to this index render on the strip; the rest fold into "更多". */
  visibleCount: number
  /** False while a measure pass is pending — the strip stays invisible then,
      so the brief all-chips render never flashes on screen. */
  measured: boolean
  /** The open menu: a folder id, MORE_ID for the overflow menu, or null. */
  openId: string | null
  /** Fixed-position anchor for the open menu, taken from the chip's rect. */
  menuLeft: number
  menuBottom: number
  /** Clamped so the menu never runs off the top edge when the strip is risen. */
  menuMaxHeight: number
}

/** Nothing is silently dropped — overflow folds into a menu, never a void. */
const LIMIT = 100

/** openId value for the overflow menu; real bookmark ids are numeric. */
const MORE_ID = 'more'

/** Conservative width reserved for the "更多 · N" chip before it exists. */
const MORE_RESERVE = 96

/** Folder lookup that sees nesting: subfolders live inside their parents. */
const findFolder = (items: BarItem[], id: string): BarFolder | null => {
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind !== 'folder') continue
    if (item.folder.id === id) return item.folder
    const deeper = findFolder(item.folder.children, id)
    if (deeper) return deeper
  }
  return null
}

/** Link count across a folder tree, for the "N 个书签" hints. */
const countLinks = (items: BarItem[]): number =>
  items.reduce(
    (n, item) =>
      n + (item.kind === 'link' ? 1 : countLinks(item.folder.children)),
    0,
  )

/**
 * The homepage bookmark strip: a single row of quick-access chips floating
 * above the search capsule — the bookmarks bar first, Other Bookmarks after
 * (Chrome's own star button files there, so a bar-only read would leave the
 * strip empty for most casual users). Folders keep the user's own grouping:
 * a folder chip opens a small glass menu of its links, so tidying into
 * folders is rewarded with organisation instead of punished with a longer
 * row. What doesn't fit is folded, not dropped or scrolled away: a "更多 · N"
 * chip opens the same glass menu over the overflow, exactly how Chrome's own
 * bar tucks its tail behind the chevron — and a folder inside the overflow
 * menu still opens out into its own menu. The bar is re-read on mount, on
 * chrome.bookmarks.onChanged (where the platform delivers it), and every time
 * the tab regains focus or visibility, which is how edits made in Chrome's
 * bookmark manager reach an open tab.
 */
export default class BookmarkStrip extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      items: [],
      visibleCount: 0,
      measured: false,
      openId: null,
      menuLeft: 0,
      menuBottom: 0,
      menuMaxHeight: 320,
    }
  }

  private nav: HTMLElement | null = null

  componentDidMount() {
    if (!isAvailable()) return
    void this.reload()
    const api = (chrome as any).bookmarks
    if (api && api.onChanged) api.onChanged.addListener(this.reload)
    document.addEventListener('visibilitychange', this.handleVisible)
    document.addEventListener('pointerdown', this.handleOutside, true)
    document.addEventListener('keydown', this.handleKey)
    window.addEventListener('focus', this.reload)
    window.addEventListener('resize', this.handleResize)
  }

  componentWillUnmount() {
    if (!isAvailable()) return
    const api = (chrome as any).bookmarks
    if (api && api.onChanged) api.onChanged.removeListener(this.reload)
    document.removeEventListener('visibilitychange', this.handleVisible)
    document.removeEventListener('pointerdown', this.handleOutside, true)
    document.removeEventListener('keydown', this.handleKey)
    window.removeEventListener('focus', this.reload)
    window.removeEventListener('resize', this.handleResize)
  }

  componentDidUpdate(prevProps: Props) {
    // The strip rides the capsule up when it rises; an open menu is anchored
    // to where the chip used to be, so it shuts rather than floats orphaned.
    if (this.props.isRisen && !prevProps.isRisen) this.closeMenu()
    if (!this.state.measured) this.measure()
  }

  /**
   * The fold point, measured against the live layout: render every chip,
   * then keep only those whose right edge clears the width the "更多" chip
   * will need. Runs again whenever items or the viewport change, so widening
   * the window hands chips back to the strip.
   */
  private measure = () => {
    const nav = this.nav
    if (!nav) return
    const chips = nav.querySelectorAll('.kunya-marks__item')
    if (chips.length === 0) {
      if (!this.state.measured) this.setState({ measured: true })
      return
    }
    const room = nav.clientWidth - 6
    const last = chips[chips.length - 1] as HTMLElement
    let count = chips.length
    if (last.offsetLeft + last.offsetWidth > room) {
      const budget = room - MORE_RESERVE
      count = chips.length
      for (let i = 0; i < chips.length; i++) {
        const el = chips[i] as HTMLElement
        if (el.offsetLeft + el.offsetWidth > budget) {
          count = i
          break
        }
      }
      count = Math.max(1, count)
    }
    if (count !== this.state.visibleCount || !this.state.measured) {
      this.setState({ visibleCount: count, measured: true })
    }
  }

  /** A wider window may fit chips back — re-render all and measure again. */
  private handleResize = () => {
    this.closeMenu()
    this.setState({
      visibleCount: this.state.items.length,
      measured: false,
    })
  }

  private handleVisible = () => {
    if (!document.hidden) void this.reload()
  }

  private handleKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.closeMenu()
  }

  private handleOutside = (event: Event) => {
    if (!this.state.openId) return
    const target = event.target as HTMLElement | null
    // The menu lives outside the nav (the strip clips overflow), so the
    // whole root is "inside" — closing on menu pointerdown would unmount the
    // link before its click ever fires.
    if (target && target.closest('.kunya-marks-root')) return
    this.closeMenu()
  }

  private closeMenu = () => {
    if (this.state.openId) this.setState({ openId: null })
  }

  private reload = async () => {
    if (!this.props.isEnabled) return
    try {
      const items = await listBarItems(LIMIT)
      this.setState(prev => {
        // A folder deleted in the bookmark manager takes its open menu down.
        const stillThere =
          prev.openId !== null &&
          findFolder(items, prev.openId as string) !== null
        return {
          items,
          openId:
            prev.openId === MORE_ID || stillThere ? prev.openId : null,
          visibleCount: items.length,
          measured: false,
        }
      })
    } catch (error) {
      console.error('Ku-nya: could not read the bookmarks bar', error)
    }
  }

  /** Shared menu anchor: above the element that opened it, clamped on screen. */
  private anchorFrom(el: HTMLElement) {
    const rect = el.getBoundingClientRect()
    return {
      menuLeft: Math.max(8, Math.min(rect.left, window.innerWidth - 240 - 8)),
      menuBottom: window.innerHeight - rect.top + 6,
      /* The menu grows upward from its bottom anchor; when the strip rides
         the risen capsule the chip sits high, so headroom — not 320px — is
         the budget. */
      menuMaxHeight: Math.max(120, Math.min(320, rect.top - 14)),
    }
  }

  private toggleFolder = (id: string, event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (this.state.openId === id) {
      this.closeMenu()
      return
    }
    this.setState({
      openId: id,
      ...this.anchorFrom(event.currentTarget as HTMLElement),
    })
  }

  private toggleMore = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (this.state.openId === MORE_ID) {
      this.closeMenu()
      return
    }
    this.setState({
      openId: MORE_ID,
      ...this.anchorFrom(event.currentTarget as HTMLElement),
    })
  }

  private renderFolderIcon() {
    return (
      <svg
        class="kunya-marks__folder-icon"
        viewBox="0 0 16 16"
        width="14"
        height="14"
        aria-hidden="true"
      >
        <path
          d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.6h5.8c.7 0 1.2.5 1.2 1.2v5.9c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2V4.2z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linejoin="round"
        />
      </svg>
    )
  }

  private renderChevron(direction: 'up' | 'right') {
    return (
      <svg
        class={`kunya-marks__chevron${
          direction === 'right' ? ' kunya-marks__chevron--right' : ''
        }`}
        viewBox="0 0 10 6"
        width="8"
        height="5"
        aria-hidden="true"
      >
        <path
          d="M1 5l4-4 4 4"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    )
  }

  private renderChip(item: BarItem) {
    if (item.kind === 'link') {
      const hit = item.hit
      return (
        <a
          key={hit.id}
          class="kunya-marks__item"
          href={hit.url}
          title={hit.title}
        >
          <img src={faviconUrl(hit.url)} alt="" width="14" height="14" />
          <span class="kunya-marks__title">{hit.title}</span>
        </a>
      )
    }
    const folder = item.folder
    const isOpen = this.state.openId === folder.id
    return (
      <button
        key={folder.id}
        type="button"
        class={`kunya-marks__item kunya-marks__folder${
          isOpen ? ' is-open' : ''
        }`}
        title={`${folder.title}（${countLinks(folder.children)} 个书签）`}
        aria-haspopup="true"
        aria-expanded={isOpen ? 'true' : 'false'}
        onClick={event => this.toggleFolder(folder.id, event)}
      >
        {this.renderFolderIcon()}
        <span class="kunya-marks__title">{folder.title}</span>
        {this.renderChevron('up')}
      </button>
    )
  }

  private renderMoreChip(overflow: number) {
    const isOpen = this.state.openId === MORE_ID
    return (
      <button
        key={MORE_ID}
        type="button"
        class={`kunya-marks__item kunya-marks__folder kunya-marks__more${
          isOpen ? ' is-open' : ''
        }`}
        title={`还有 ${overflow} 个书签`}
        aria-haspopup="true"
        aria-expanded={isOpen ? 'true' : 'false'}
        onClick={this.toggleMore}
      >
        <span class="kunya-marks__title">更多 · {overflow}</span>
        {this.renderChevron('up')}
      </button>
    )
  }

  private renderMenuLink(
    hit: { id: string; title: string; url: string },
    index: number,
  ) {
    return (
      <a
        key={hit.id}
        class="kunya-marks__menu-item"
        role="menuitem"
        href={hit.url}
        title={hit.title}
        style={{ animationDelay: `${index * 24}ms` }}
      >
        <img src={faviconUrl(hit.url)} alt="" width="14" height="14" />
        <span class="kunya-marks__menu-title">{hit.title}</span>
      </a>
    )
  }

  private renderMenuFolderRow(folder: BarFolder, index: number) {
    // A folder row keeps its grouping one click deeper: it opens the
    // folder's own menu rather than spilling its links into this one.
    return (
      <button
        key={folder.id}
        type="button"
        class="kunya-marks__menu-item kunya-marks__menu-folder"
        role="menuitem"
        title={`${folder.title}（${countLinks(folder.children)} 个书签）`}
        aria-haspopup="true"
        aria-expanded="false"
        style={{ animationDelay: `${index * 24}ms` }}
        onClick={event => this.toggleFolder(folder.id, event)}
      >
        {this.renderFolderIcon()}
        <span class="kunya-marks__menu-title">{folder.title}</span>
        {this.renderChevron('right')}
      </button>
    )
  }

  private renderMenuEntry(item: BarItem, index: number) {
    if (item.kind === 'link') return this.renderMenuLink(item.hit, index)
    return this.renderMenuFolderRow(item.folder, index)
  }

  private renderMenu() {
    if (!this.state.openId) return null
    const menuStyle = {
      left: `${this.state.menuLeft}px`,
      bottom: `${this.state.menuBottom}px`,
      maxHeight: `${this.state.menuMaxHeight}px`,
    }

    if (this.state.openId === MORE_ID) {
      const overflow = this.state.items.slice(this.state.visibleCount)
      return (
        <div
          class="kunya-marks__menu"
          role="menu"
          aria-label="更多书签"
          style={menuStyle}
        >
          {overflow.map((item, index) => this.renderMenuEntry(item, index))}
        </div>
      )
    }

    const folder = findFolder(this.state.items, this.state.openId)
    if (!folder) return null
    return (
      <div
        class="kunya-marks__menu"
        role="menu"
        aria-label={folder.title}
        style={menuStyle}
      >
        {folder.children.map((item, index) =>
          this.renderMenuEntry(item, index),
        )}
      </div>
    )
  }

  render() {
    if (!this.props.isEnabled || this.state.items.length === 0) return null
    const shown = this.state.items.slice(0, this.state.visibleCount)
    const overflow = this.state.items.length - shown.length
    const className = `kunya-marks${this.props.isGhost ? ' is-ghost' : ''}${
      this.props.isRisen ? ' is-risen' : ''
    }${this.state.measured ? '' : ' is-measuring'}`
    return (
      <div
        class="kunya-marks-root"
        /* Mousedown is swallowed so a click never blurs the search field:
           while the capsule is risen, losing focus would drop it — and the
           strip with it — before the folder's own click could open its menu
           (the same trick the suggestion rows use). */
        onMouseDown={event => event.preventDefault()}
      >
        <nav
          class={className}
          aria-label="书签栏"
          ref={el => {
            this.nav = el as HTMLElement | null
          }}
        >
          {shown.map(item => this.renderChip(item))}
          {overflow > 0 && this.renderMoreChip(overflow)}
        </nav>
        {this.renderMenu()}
      </div>
    )
  }
}
