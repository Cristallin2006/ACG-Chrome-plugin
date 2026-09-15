import { h, Component } from 'preact'
import SettingSection from './SettingSection'
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
  private selectId = 'view-mode-selector'

  constructor(props: Props) {
    super(props)
    this.state = { value: props.initialValue }
  }

  handleChange = (ev: Event) => {
    const value = (ev.target as HTMLSelectElement).value as ViewModes
    this.setState({ value })
    this.props.update(value)
  }

  render() {
    return (
      <SettingSection title="View Mode">
        <label for={this.selectId}>New tab gallery:</label>
        <select id={this.selectId} value={this.state.value} onChange={this.handleChange}>
          <option value={ViewModes.Watch}>watch only (no mis-taps)</option>
          <option value={ViewModes.Interactive}>interactive (opens illust)</option>
        </select>
      </SettingSection>
    )
  }
}
