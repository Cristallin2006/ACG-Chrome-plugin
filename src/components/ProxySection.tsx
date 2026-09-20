import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Toggle from './Toggle'

interface Props {
  initialValue: boolean
  update(isEnabled: boolean): void
}

interface State {
  isEnabled: boolean
}

/**
 * The pinned local proxy. Chrome offers no per-extension proxy, so the PAC
 * is browser-wide: everything tries 127.0.0.1:7890 first and falls back to
 * a direct connection when nothing listens there. The note says so plainly —
 * silently taking over the browser's proxy would be worse.
 */
export default class ProxySection extends Component<Props, State> {
  private toggleId = 'checkbox_for_fixed_proxy'

  constructor(props: Props) {
    super(props)
    this.state = { isEnabled: props.initialValue }
  }

  handleChange = (checked: boolean) => {
    this.setState({ isEnabled: checked })
    this.props.update(checked)
  }

  render() {
    return (
      <SettingSection
        title="固定代理"
        note="开启后全部流量优先走 127.0.0.1:7890(如 Clash),代理未运行时自动回退直连;pixiv 加载不再受系统代理开关影响。使用其他代理工具(如 SwitchyOmega)时请关闭"
      >
        <Toggle
          id={this.toggleId}
          checked={this.state.isEnabled}
          onChange={this.handleChange}
          label="固定走 127.0.0.1:7890 代理"
        />
      </SettingSection>
    )
  }
}
