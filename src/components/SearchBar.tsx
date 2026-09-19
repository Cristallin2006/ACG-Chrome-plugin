import { h, Component } from 'preact'
import { ViewModes } from '../lib/options'
import { submit } from '../lib/search'

interface Props {
  viewMode: ViewModes
  onViewModeChange(mode: ViewModes): void
}

interface State {
  value: string
  /** True while the capsule is dimmed back so the artwork reads as the subject. */
  isGhost: boolean
  /**
   * True while the field is focused: the capsule rises to the spotlight
   * position (38dvh) over a dimming scrim. Blur or Esc lets it settle back.
   */
  isRisen: boolean
}

const GHOST_AFTER_MS = 2000

export default class SearchBar extends Component<Props, State> {
  private input: HTMLInputElement | null = null
  private ghostTimer: number | null = null

  constructor(props: Props) {
    super(props)
    this.state = { value: '', isGhost: false, isRisen: false }
  }

  componentDidMount() {
    // Listening on the document is what makes "move the mouse and it comes
    // back" true from anywhere on the page, including over the artwork.
    document.addEventListener('keydown', this.handleGlobalKeyDown)
    document.addEventListener('pointermove', this.handleActivity)
    document.addEventListener('wheel', this.handleActivity, { passive: true })
    this.armGhost()
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleGlobalKeyDown)
    document.removeEventListener('pointermove', this.handleActivity)
    document.removeEventListener('wheel', this.handleActivity)
    this.disarmGhost()
  }

  componentDidUpdate(previous: Props) {
    // Switching back to 交互 must never leave the capsule dimmed.
    if (previous.viewMode !== this.props.viewMode) {
      this.wake()
    }
  }

  private armGhost() {
    this.disarmGhost()
    if (this.props.viewMode !== ViewModes.Watch) {
      if (this.state.isGhost) this.setState({ isGhost: false })
      return
    }
    this.ghostTimer = window.setTimeout(() => {
      // Never dim while the user is typing in it.
      if (document.activeElement === this.input) return
      this.setState({ isGhost: true })
    }, GHOST_AFTER_MS)
  }

  private disarmGhost() {
    if (this.ghostTimer !== null) {
      window.clearTimeout(this.ghostTimer)
      this.ghostTimer = null
    }
  }

  private wake = () => {
    if (this.state.isGhost) this.setState({ isGhost: false })
  }

  private handleActivity = () => {
    this.wake()
    this.armGhost()
  }

  private focusInput(initial?: string) {
    const input = this.input
    if (!input) return
    input.focus()
    if (initial !== undefined) {
      this.setState({ value: initial })
      input.value = initial
    }
    this.wake()
  }

  /**
   * `/` and Ctrl/Cmd+K focus the field, and any printable character starts a
   * query the way it would in the address bar. Composition (IME) events report
   * keys longer than one character, so typing Chinese is left alone.
   */
  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      this.focusInput()
      return
    }
    if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      this.focusInput()
      return
    }
    const printable =
      event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
    if (printable) {
      event.preventDefault()
      this.focusInput(event.key)
    }
  }

  private handleFocus = () => {
    this.handleActivity()
    if (!this.state.isRisen) this.setState({ isRisen: true })
  }

  private handleBlur = () => {
    if (this.state.isRisen) this.setState({ isRisen: false })
    this.armGhost()
  }

  private handleInput = (event: Event) => {
    this.setState({ value: (event.target as HTMLInputElement).value })
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      this.setState({ value: '' })
      ;(event.target as HTMLInputElement).blur()
      this.armGhost()
      return
    }
    if (event.key !== 'Enter') return
    void this.run()
  }

  private async run() {
    const query = this.state.value.trim()
    if (query.length === 0) return
    this.disarmGhost()
    try {
      await submit(query)
    } catch (error) {
      // A failed search must say what to do next rather than nothing at all.
      console.error('Ku-nya: search failed', error)
      window.alert(`搜索没有成功：${String(error)}\n可以直接在地址栏搜索“${query}”。`)
      this.armGhost()
    }
  }

  private toggleViewMode = () => {
    const { viewMode, onViewModeChange } = this.props
    onViewModeChange(
      viewMode === ViewModes.Interactive ? ViewModes.Watch : ViewModes.Interactive,
    )
  }

  render() {
    const { viewMode } = this.props
    const isInteractive = viewMode === ViewModes.Interactive
    const hasText = this.state.value.trim().length > 0
    const className = `kunya-search${this.state.isGhost ? ' is-ghost' : ''}${
      this.state.isRisen ? ' is-risen' : ''
    }${hasText ? ' has-text' : ''}`

    return (
      <div class="kunya-search-root">
        {/* Spotlight scrim: rises with the capsule, dims the wall, lets the
            field take the room. Never intercepts the pointer. */}
        <div
          class={`kunya-scrim${this.state.isRisen ? ' is-risen' : ''}`}
          aria-hidden="true"
        />
        <div class={className} role="search">
          <span class="kunya-search__label" aria-hidden="true">
            WEB SEARCH
          </span>
          <svg
            class="kunya-search__icon"
            viewBox="0 0 16 16"
            width="15"
            height="15"
            aria-hidden="true"
          >
            <circle
              cx="7"
              cy="7"
              r="4.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path
              d="M10.5 10.5 L14 14"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>

          <input
            ref={element => {
              this.input = element
            }}
            class="kunya-search__input"
            type="text"
            value={this.state.value}
            placeholder="搜索网页或输入网址"
            aria-label="搜索网页或输入网址"
            autocomplete="off"
            spellcheck={false}
            onInput={this.handleInput}
            onKeyDown={this.handleKeyDown}
            onFocus={this.handleFocus}
            onBlur={this.handleBlur}
          />

          <button
            type="button"
            class="kunya-search__go"
            aria-label="搜索"
            title="搜索（Enter）"
            onMouseDown={event => event.preventDefault()}
            onClick={() => void this.run()}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M2.5 8 H12 M8.5 4.5 L12 8 L8.5 11.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <button
            type="button"
            class="kunya-switch"
            role="switch"
            aria-checked={isInteractive ? 'true' : 'false'}
            aria-label="交互模式：开启后插画可点击"
            title={isInteractive ? '当前：可点击打开作品页' : '当前：只可浏览，防止误触'}
            onClick={this.toggleViewMode}
          >
            <span class="kunya-switch__label">{isInteractive ? '交互' : '纯看'}</span>
            <span class="kunya-switch__track">
              <span class="kunya-switch__knob" />
            </span>
          </button>
          <span class="kunya-search__hint" aria-hidden="true">
            ↵ 搜索 · esc 收起
          </span>
        </div>
      </div>
    )
  }
}
