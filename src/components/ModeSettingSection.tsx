import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import { Modes } from '../lib/options'

interface Props {
  initialValue: string
  /** User-defined tag categories, offered alongside the built-in rankings. */
  customTags: string[]
  update(mode: string)
}

interface State {
  value: string
}

const MODE_LABELS: { [mode: string]: string } = {
  [Modes.Illust]: '插画日榜',
  [Modes.Manga]: '漫画日榜',
  [Modes.Ugoira]: '动图',
  [Modes.Original]: '原创',
  [Modes.Newer]: '最新',
  [Modes.Popular]: '人气',
  [Modes.Discovery]: '发现(需登录)',
}

export default class ModeSettingSection extends Component<Props, State> {
  private selectableOptions: Array<string> = [
    Modes.Illust,
    Modes.Manga,
    Modes.Original,
    Modes.Ugoira,
    Modes.Newer,
    Modes.Popular,
    Modes.Discovery,
  ]

  constructor(props: Props) {
    super(props)
    this.state = {
      value: props.initialValue,
    }
  }

  handleModeChange = (ev: Event) => {
    const { update } = this.props
    const value = (ev.target as HTMLSelectElement).value
    this.setState({ value })
    update(value)
  }

  render() {
    const {
      handleModeChange,
      state: { value },
    } = this

    return (
      <SettingSection title="内容源">
        <select
          className="knp-select"
          id="content-selector"
          aria-label="内容源"
          value={value}
          onChange={handleModeChange}
        >
          {this.selectableOptions.map(selectable => (
            <option key={selectable} value={selectable}>
              {MODE_LABELS[selectable] || selectable}
            </option>
          ))}
          {(this.props.customTags || []).map(tag => (
            <option key={tag} value={`tag:${tag}`}>
              {tag}(自定义)
            </option>
          ))}
        </select>
      </SettingSection>
    )
  }
}
