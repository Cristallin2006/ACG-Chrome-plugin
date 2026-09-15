import { h, Component } from 'preact'
import {
  Options,
  setMode,
  setAspectRatioSettings,
  setExcludingTags,
  setCustomTags,
  setSafe,
  setViewMode,
} from '../lib/options'
import ModeSettingsSection from './ModeSettingSection'
import AspectRatioSettingSection from './AspectRatioSettingSection'
import TagSettingSection from './TagSettingSection'
import CustomTagSection from './CustomTagSection'
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
    this.state = { customTags: props.initialOptions.customTags }
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
