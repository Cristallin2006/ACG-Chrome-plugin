import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Check from './Check'
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

  handleToggle = (checked: boolean) => {
    const { update } = this.props
    this.setState({ enabled: checked })
    update(checked)
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
        return { name: '检测登录状态…', sub: '', tone: 'pending' }
      case 'logged-in':
        return {
          name: userName || 'pixiv 用户',
          sub: '已登录',
          tone: 'on',
        }
      case 'logged-out':
        return { name: '未登录', sub: '登录后可解锁「发现」与完整搜索', tone: 'off' }
      default:
        return { name: '检测失败', sub: '请检查网络后重试', tone: 'off' }
    }
  }

  render() {
    const {
      handleToggle,
      handleLoginClick,
      probe,
      state: { enabled, status },
    } = this
    const statusView = this.renderStatus()

    return (
      <div>
        <SettingSection title="携带登录状态" note="pixiv 请求带上浏览器会话">
          <Check
            id={this.checkboxId}
            checked={enabled}
            onChange={handleToggle}
            label="携带登录状态"
          />
        </SettingSection>
        <div className="knp-row">
          <div className="knp-login">
            <span className={`knp-dot knp-dot--${statusView.tone}`} />
            <div className="knp-login__text">
              <div className="knp-login__name">{statusView.name}</div>
              {statusView.sub ? (
                <div className="knp-login__sub">{statusView.sub}</div>
              ) : null}
            </div>
          </div>
          <button type="button" className="knp-btn" onClick={probe}>
            刷新
          </button>
        </div>
        {status === 'logged-out' && (
          <div className="knp-row">
            <button
              type="button"
              className="knp-btn knp-btn--primary"
              onClick={handleLoginClick}
            >
              去 pixiv 登录
            </button>
          </div>
        )}
      </div>
    )
  }
}
