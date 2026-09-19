import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Check from './Check'

interface Props {
  initialValue: boolean
  update(isExcluding: boolean): void
}

interface State {
  is_excluding: boolean
}

/**
 * pixiv marks AI-generated works with aiType 2. Sources that don't report the
 * flag are never filtered (see api.IllustEntry.aiType).
 */
export default class AISection extends Component<Props, State> {
  private checkboxId = 'checkbox_for_ai'

  constructor(props: Props) {
    super(props)
    this.state = {
      is_excluding: props.initialValue,
    }
  }

  handleChange = (checked: boolean) => {
    this.setState({ is_excluding: checked })
    this.props.update(checked)
  }

  render() {
    return (
      <SettingSection title="隐藏 AI 生成作品" note="按 pixiv 的 AI 标记过滤">
        <Check
          id={this.checkboxId}
          checked={this.state.is_excluding}
          onChange={this.handleChange}
          label="隐藏 AI 生成作品"
        />
      </SettingSection>
    )
  }
}
