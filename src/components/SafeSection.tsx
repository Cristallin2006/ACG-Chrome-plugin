import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Toggle from './Toggle'

interface Props {
  initial_is_safe: boolean
  update(isChecked: boolean): void
}

interface State {
  is_safe: boolean
}

export default class SafeSection extends Component<Props, State> {
  private safeSettingsId = 'checkbox_for_safe'

  constructor(props: Props) {
    super(props)
    this.state = {
      is_safe: props.initial_is_safe,
    }
  }

  handleChange = (checked: boolean) => {
    this.setState({ is_safe: checked })
    this.props.update(checked)
  }

  render() {
    return (
      <SettingSection
        title="内容安全"
        note="开启后不显示敏感作品(作用于日榜类来源)"
      >
        <Toggle
          id={this.safeSettingsId}
          checked={this.state.is_safe}
          onChange={this.handleChange}
          label="仅显示安全内容"
        />
      </SettingSection>
    )
  }
}
