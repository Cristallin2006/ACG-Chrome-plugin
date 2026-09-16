import { h, Component } from 'preact'
import SettingSection from './SettingSection'
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
  if (tier === 0) return 'No filter 不限'
  if (tier === TAG_TIER_MIXED) return 'Layered mix 分层混合 (500 → 10000)'
  return `${tier}+ bookmarks ${tier}users入り`
}

/**
 * Popularity filter for the custom tag categories. pixiv keeps the popular
 * sort order behind premium, so the free workaround is the `Nusers入り`
 * bookmark-floor keyword — or the layered mix, which queries every tier and
 * merges them high-first (see api.getIllustsByTag).
 */
export default class TagHeatSection extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      value: props.initialValue,
    }
  }

  handleTierChange = (ev: Event) => {
    const { update } = this.props
    const value = Number((ev.target as HTMLSelectElement).value)
    this.setState({ value })
    update(value)
  }

  render() {
    const {
      handleTierChange,
      state: { value },
    } = this

    return (
      <SettingSection title="Tag Heat Filter(users入り)">
        <label for="tag-tier-selector">Bookmark floor:</label>
        <select
          id="tag-tier-selector"
          value={String(value)}
          onChange={handleTierChange}
        >
          {TIERS.map(tier => (
            <option key={tier} value={String(tier)}>
              {tierLabel(tier)}
            </option>
          ))}
        </select>
        <p>Only applies to custom tag categories. 仅作用于自定义标签分类。</p>
      </SettingSection>
    )
  }
}
