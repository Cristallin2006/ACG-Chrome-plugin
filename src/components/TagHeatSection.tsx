import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import Segmented from './Segmented'
import { TAG_TIER_MIXED } from '../lib/api'

interface Props {
  initialValue: number
  update(tier: number): void
}

interface State {
  value: number
}

const TIERS = [0, 100, 500, 1000, 5000, 10000, TAG_TIER_MIXED]

const tierLabel = (tier: number): string => {
  if (tier === 0) return '全部'
  if (tier === TAG_TIER_MIXED) return '混合'
  return `${tier}+`
}

/**
 * Popularity filter for the custom tag categories. pixiv keeps the popular
 * sort order behind premium, so the free workaround is the `Nusers入り`
 * bookmark-floor keyword — or the layered mix, which queries every tier and
 * merges them high-first.
 */
export default class TagHeatSection extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      value: props.initialValue,
    }
  }

  handleTierChange = (value: string) => {
    const { update } = this.props
    const tier = Number(value)
    this.setState({ value: tier })
    update(tier)
  }

  render() {
    const {
      handleTierChange,
      state: { value },
    } = this

    return (
      <SettingSection title="标签热度" note="仅作用于自定义标签" stack>
        <Segmented
          name="knp-tag-tier"
          value={String(value)}
          options={TIERS.map(tier => ({
            value: String(tier),
            label: tierLabel(tier),
          }))}
          onChange={handleTierChange}
        />
      </SettingSection>
    )
  }
}
