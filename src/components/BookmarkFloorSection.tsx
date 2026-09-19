import { h, Component } from 'preact'
import SettingSection from './SettingSection'

interface Props {
  initialValue: number
  update(minBookmarks: number): void
}

interface State {
  value: number
}

/**
 * Client-side bookmark floor. Only sources that report a count (search
 * listing, ranking JSON) are filtered; the rest pass through untouched —
 * never filter on missing data.
 */
export default class BookmarkFloorSection extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { value: props.initialValue }
  }

  handleChange = (ev: Event) => {
    const { update } = this.props
    const value = parseInt((ev.target as HTMLInputElement).value, 10)
    const floor = Number.isFinite(value) && value > 0 ? value : 0
    this.setState({ value: floor })
    update(floor)
  }

  render() {
    return (
      <SettingSection
        title="收藏数下限"
        note="来源未报告收藏数时不过滤;0 为不限"
      >
        <input
          type="number"
          className="knp-num"
          aria-label="收藏数下限"
          min={0}
          step={100}
          value={this.state.value}
          onChange={this.handleChange}
        />
      </SettingSection>
    )
  }
}
