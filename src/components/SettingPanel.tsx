import { h, Component } from 'preact'
import {
  Options,
  defaultOptions,
  setMode,
  setAspectRatioSettings,
  setExcludingTags,
  setCustomTags,
  setSafe,
  setViewMode,
  setTagBookmarkTier,
  setUsePixivLogin,
  setExcludeMultiPage,
  setExcludeAI,
  setMinBookmarks,
  setExcludedAuthors,
  setTileBookmark,
  setBookmarkSearch,
  setBookmarkBar,
} from '../lib/options'
import ModeSettingsSection from './ModeSettingSection'
import AspectRatioSettingSection from './AspectRatioSettingSection'
import TagSettingSection from './TagSettingSection'
import CustomTagSection from './CustomTagSection'
import TagHeatSection from './TagHeatSection'
import LoginSection from './LoginSection'
import MultiPageSection from './MultiPageSection'
import SafeSection from './SafeSection'
import ViewModeSection from './ViewModeSection'
import AISection from './AISection'
import BookmarkFloorSection from './BookmarkFloorSection'
import BookmarkSection from './BookmarkSection'
import ExcludedAuthorsSection from './ExcludedAuthorsSection'

interface Props {
  initialOptions: Options
}

interface State {
  /** Lifted so the mode dropdown lists a new category the moment it is added. */
  customTags: string[]
}

export default class SettingPanel extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    // A stale pre-categories service worker answers getOptions without
    // customTags; render the panel anyway (an empty list is the truth then).
    this.state = { customTags: props.initialOptions.customTags || [] }
  }

  handleCustomTags = (tags: string[]) => {
    this.setState({ customTags: tags })
    setCustomTags(tags)
  }

  render() {
    const {
      mode,
      isExcludingHighAspectRatio,
      smallestIncludableAspectRatio,
      excludingTags,
      isSafe,
      viewMode,
    } = this.props.initialOptions

    // A stale worker (pre-tier / pre-login builds) answers getOptions without
    // these keys; fall back to the defaults instead of rendering undefined.
    const tagBookmarkTier =
      this.props.initialOptions.tagBookmarkTier === undefined
        ? defaultOptions.tagBookmarkTier
        : this.props.initialOptions.tagBookmarkTier
    const usePixivLogin =
      this.props.initialOptions.usePixivLogin === undefined
        ? defaultOptions.usePixivLogin
        : this.props.initialOptions.usePixivLogin
    const isExcludingMultiPage =
      this.props.initialOptions.isExcludingMultiPage === undefined
        ? defaultOptions.isExcludingMultiPage
        : this.props.initialOptions.isExcludingMultiPage
    const isExcludingAI =
      this.props.initialOptions.isExcludingAI === undefined
        ? defaultOptions.isExcludingAI
        : this.props.initialOptions.isExcludingAI
    const minBookmarks =
      this.props.initialOptions.minBookmarks === undefined
        ? defaultOptions.minBookmarks
        : this.props.initialOptions.minBookmarks
    const excludedAuthors =
      this.props.initialOptions.excludedAuthors === undefined
        ? defaultOptions.excludedAuthors
        : this.props.initialOptions.excludedAuthors
    const isTileBookmarkEnabled =
      this.props.initialOptions.isTileBookmarkEnabled === undefined
        ? defaultOptions.isTileBookmarkEnabled
        : this.props.initialOptions.isTileBookmarkEnabled
    const isBookmarkSearchEnabled =
      this.props.initialOptions.isBookmarkSearchEnabled === undefined
        ? defaultOptions.isBookmarkSearchEnabled
        : this.props.initialOptions.isBookmarkSearchEnabled
    const isBookmarkBarEnabled =
      this.props.initialOptions.isBookmarkBarEnabled === undefined
        ? defaultOptions.isBookmarkBarEnabled
        : this.props.initialOptions.isBookmarkBarEnabled

    const version =
      chrome.runtime && chrome.runtime.getManifest
        ? chrome.runtime.getManifest().version
        : ''

    return (
      <div className="knp">
        <header className="knp-head">
          <h1 className="knp-head__title">Ku-nya 设置</h1>
          <span className="knp-head__ver">v{version}</span>
        </header>

        <div className="knp-card">
          <ViewModeSection initialValue={viewMode} update={setViewMode} />
          <SafeSection initial_is_safe={isSafe} update={setSafe} />
        </div>

        <div className="knp-card">
          <BookmarkSection
            initialTileBookmark={isTileBookmarkEnabled}
            initialBookmarkSearch={isBookmarkSearchEnabled}
            initialBookmarkBar={isBookmarkBarEnabled}
            updateTileBookmark={setTileBookmark}
            updateBookmarkSearch={setBookmarkSearch}
            updateBookmarkBar={setBookmarkBar}
          />
        </div>

        <div className="knp-card">
          <ModeSettingsSection
            initialValue={mode}
            customTags={this.state.customTags}
            update={setMode}
          />
          <CustomTagSection
            initialTags={this.state.customTags}
            update={this.handleCustomTags}
          />
          <TagHeatSection
            initialValue={tagBookmarkTier}
            update={setTagBookmarkTier}
          />
        </div>

        <div className="knp-card">
          <LoginSection initialValue={usePixivLogin} update={setUsePixivLogin} />
        </div>

        <div className="knp-card">
          <MultiPageSection
            initialValue={isExcludingMultiPage}
            update={setExcludeMultiPage}
          />
          <AISection initialValue={isExcludingAI} update={setExcludeAI} />
          <BookmarkFloorSection
            initialValue={minBookmarks}
            update={setMinBookmarks}
          />
          <AspectRatioSettingSection
            initial_is_excluding_high_aspect_ratio={isExcludingHighAspectRatio}
            initial_smallest_includable_aspect_ratio={
              smallestIncludableAspectRatio
            }
            update={setAspectRatioSettings}
          />
        </div>

        <div className="knp-card">
          <ExcludedAuthorsSection
            initialAuthors={excludedAuthors}
            update={setExcludedAuthors}
          />
          <TagSettingSection
            initialTags={excludingTags}
            update={setExcludingTags}
          />
        </div>

        <p className="knp-foot">设置即时生效,新标签页刷新后应用</p>
      </div>
    )
  }
}
