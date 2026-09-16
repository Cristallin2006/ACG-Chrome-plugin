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

    return (
      <div>
        <ViewModeSection initialValue={viewMode} update={setViewMode} />
        <SafeSection initial_is_safe={isSafe} update={setSafe} />
        <ModeSettingsSection
          initialValue={mode}
          customTags={this.state.customTags}
          update={setMode}
        />
        <CustomTagSection
          initialTags={this.state.customTags}
          update={this.handleCustomTags}
        />
        <TagHeatSection initialValue={tagBookmarkTier} update={setTagBookmarkTier} />
        <LoginSection initialValue={usePixivLogin} update={setUsePixivLogin} />
        <MultiPageSection
          initialValue={isExcludingMultiPage}
          update={setExcludeMultiPage}
        />
        <AspectRatioSettingSection
          initial_is_excluding_high_aspect_ratio={isExcludingHighAspectRatio}
          initial_smallest_includable_aspect_ratio={
            smallestIncludableAspectRatio
          }
          update={setAspectRatioSettings}
        />
        <TagSettingSection
          initialTags={excludingTags}
          update={setExcludingTags}
        />
      </div>
    )
  }
}
