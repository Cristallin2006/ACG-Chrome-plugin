import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Check from './Check'

interface Props {
  initial_smallest_includable_aspect_ratio: number
  initial_is_excluding_high_aspect_ratio: boolean
  update(isChecked: boolean, value: number): void
}

interface State {
  smallest_includable_aspect_ratio: number
  is_excluding_high_aspect_ratio: boolean
}

export default class AspectRatioSettingSection extends Component<Props, State> {
  private aspectRatioSettingsId = 'checkbox_for_excluding_high_aspect_ratio'

  constructor(props: Props) {
    super(props)
    this.state = {
      smallest_includable_aspect_ratio:
        props.initial_smallest_includable_aspect_ratio,
      is_excluding_high_aspect_ratio:
        props.initial_is_excluding_high_aspect_ratio,
    }
  }

  handleToggle = (checked: boolean) => {
    const {
      state: { smallest_includable_aspect_ratio },
      props: { update },
    } = this
    this.setState({ is_excluding_high_aspect_ratio: checked })
    update(checked, smallest_includable_aspect_ratio)
  }

  handleNumberChange = (ev: Event) => {
    const {
      state: { is_excluding_high_aspect_ratio },
      props: { update },
    } = this
    const target = ev.target as HTMLInputElement
    const value = parseInt(target.value, 10)
    this.setState({ smallest_includable_aspect_ratio: value })
    update(is_excluding_high_aspect_ratio, value)
  }

  render() {
    const {
      aspectRatioSettingsId,
      handleToggle,
      handleNumberChange,
      state: {
        smallest_includable_aspect_ratio,
        is_excluding_high_aspect_ratio,
      },
    } = this

    return (
      <SettingSection title="排除竖长图" note="高 / 宽不超过右侧倍数">
        <span className="knp-cluster">
          <input
            type="number"
            className="knp-num"
            aria-label="高宽比上限"
            min={1}
            value={smallest_includable_aspect_ratio}
            onChange={handleNumberChange}
            disabled={!is_excluding_high_aspect_ratio}
          />
          <Check
            id={aspectRatioSettingsId}
            checked={is_excluding_high_aspect_ratio}
            onChange={handleToggle}
            label="排除竖长图"
          />
        </span>
      </SettingSection>
    )
  }
}
