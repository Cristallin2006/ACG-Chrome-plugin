import { h, Component } from 'preact'
import SettingSection from './SettingSection'

interface Props {
  initialValue: boolean
  update(isExcluding: boolean): void
}

interface State {
  is_excluding: boolean
}

/**
 * Multi-page works are usually manga (or photo-set style compilations): the
 * wall can only show the first page, which is a cover more often than an
 * illustration. Every content source carries the page count, so this filter
 * costs no extra requests (see api.IllustEntry.pageCount).
 */
export default class MultiPageSection extends Component<Props, State> {
  private checkboxId = 'checkbox_for_multi_page'

  constructor(props: Props) {
    super(props)
    this.state = {
      is_excluding: props.initialValue,
    }
  }

  handleCheckboxClick = (ev: Event) => {
    const { update } = this.props
    const target = ev.target as HTMLInputElement
    this.setState({ is_excluding: target.checked })
    update(target.checked)
  }

  render() {
    return (
      <SettingSection title="Multi-image Filter(多图/漫画)">
        <input
          type="checkbox"
          id={this.checkboxId}
          onClick={this.handleCheckboxClick}
          checked={this.state.is_excluding}
        />
        {h('label', {
          htmlFor: this.checkboxId,
          children: ['hide works with multiple pages 过滤多图作品（多为漫画）'],
        })}
      </SettingSection>
    )
  }
}
