import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Segmented from './Segmented'
import { ViewModes } from '../lib/options'

interface Props {
  initialValue: ViewModes
  update(mode: ViewModes): void
}

interface State {
  value: ViewModes
}

/** Popup twin of the switch on the new tab page. */
export default class ViewModeSection extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { value: props.initialValue }
  }

  handleChange = (value: string) => {
    const mode = value as ViewModes
    this.setState({ value: mode })
    this.props.update(mode)
  }

  render() {
    return (
      <SettingSection title="浏览模式" note="纯看只保留拼图画廊,防止误触">
        <Segmented
          name="knp-view-mode"
          value={this.state.value}
          options={[
            { value: ViewModes.Watch, label: '纯看' },
            { value: ViewModes.Interactive, label: '交互' },
          ]}
          onChange={this.handleChange}
        />
      </SettingSection>
    )
  }
}
