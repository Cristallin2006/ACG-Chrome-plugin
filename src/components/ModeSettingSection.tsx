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
      <SettingSection title="Ranking Mode">
        <label for="content-selector">Ranking mode:</label>
        <select id="content-selector" value={value} onChange={handleModeChange}>
          {this.selectableOptions.map(selectable => (
            <option key={selectable} value={selectable}>
              {selectable === Modes.Discovery
                ? 'discovery 推荐(需登录)'
                : selectable}
            </option>
          ))}
          {(this.props.customTags || []).map(tag => (
            <option key={tag} value={`tag:${tag}`}>
              {tag} (tag)
            </option>
          ))}
        </select>
      </SettingSection>
    )
  }
}
