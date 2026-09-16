import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import { getLoginStatus } from '../lib/api'

interface Props {
  initialValue: boolean
  update(usePixivLogin: boolean): void
}

interface State {
  enabled: boolean
  /** What the last probe heard back; 'checking' until it answers. */
  status: 'checking' | 'logged-in' | 'logged-out' | 'error'
  userName: string | null
}

/**
 * pixiv session sharing. With the toggle on, the new tab's requests carry the
 * browser's pixiv cookies, so a logged-in account searches with its own
 * visibility settings (the anonymous listing hides R-18 and throttles harder).
 * The probe runs credentialed regardless — detecting the session is its job.
 */
export default class LoginSection extends Component<Props, State> {
  private checkboxId = 'checkbox_for_pixiv_login'

  constructor(props: Props) {
    super(props)
    this.state = {
      enabled: props.initialValue,
      status: 'checking',
      userName: null,
    }
  }

  componentDidMount() {
    this.probe()
  }

  probe = async () => {
    this.setState({ status: 'checking' })
    const result = await getLoginStatus()
    this.setState({
      status: result.networkError
        ? 'error'
        : result.loggedIn
        ? 'logged-in'
        : 'logged-out',
      userName: result.userName,
    })
  }

  handleCheckboxClick = (ev: Event) => {
    const { update } = this.props
    const target = ev.target as HTMLInputElement
    this.setState({ enabled: target.checked })
    update(target.checked)
  }

  handleLoginClick = () => {
    chrome.tabs.create({
      url: 'https://accounts.pixiv.net/login?return_to=https%3A%2F%2Fwww.pixiv.net%2F',
    })
  }

  renderStatus() {
    const {
      state: { status, userName },
    } = this
    switch (status) {
      case 'checking':
        return 'Checking the session… 检测登录状态…'
      case 'logged-in':
        return `Logged in as ${userName || 'a pixiv user'} 已登录`
      case 'logged-out':
        return 'Not logged in 未登录'
      default:
        return 'Probe failed (network error) 检测失败，请检查网络'
    }
  }

  render() {
    const {
      handleCheckboxClick,
      handleLoginClick,
      probe,
      state: { enabled, status },
    } = this

    return (
      <SettingSection title="pixiv Login(登录)">
        <input
          type="checkbox"
          id={this.checkboxId}
          onClick={handleCheckboxClick}
          checked={enabled}
        />
        {h('label', {
          htmlFor: this.checkboxId,
          children: ['send the pixiv login session with requests 请求携带登录状态'],
        })}
        <p className="login-status">
          {this.renderStatus()}
          <button className="login-refresh" onClick={probe}>
            re-check
          </button>
        </p>
        {status === 'logged-out' && (
          <button onClick={handleLoginClick}>Open pixiv login 去登录</button>
        )}
      </SettingSection>
    )
  }
}
