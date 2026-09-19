import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import TagInput from './TagInput'
import ChipList from './ChipList'

interface Props {
  initialAuthors: string[]
  update(authors: string[]): void
}

interface State {
  authors: string[]
}

/**
 * Muted authors. Matched case-insensitively against the entry's author name —
 * names are what the user sees on the wall, so names are what the list stores.
 */
export default class ExcludedAuthorsSection extends Component<Props, State> {
  handleAdd = (value: string) => {
    const {
      props: { update },
      state: { authors },
    } = this
    if (value === '' || authors.includes(value)) {
      return
    }
    const next = [...authors, value]
    this.setState({ authors: next })
    update(next)
  }

  handleDelete = (name: string) => {
    const { update } = this.props
    const authors = this.state.authors.filter(author => author !== name)

    this.setState({ authors })
    update(authors)
  }

  constructor(props: Props) {
    super(props)
    this.state = {
      authors: this.props.initialAuthors,
    }
  }

  render() {
    const {
      handleAdd,
      handleDelete,
      state: { authors },
    } = this
    return (
      <SettingSection
        title="屏蔽画师"
        note="按画师名精确匹配(大小写不敏感)"
        stack
      >
        <ChipList
          values={authors}
          onDelete={handleDelete}
          empty="没有屏蔽的画师"
        />
        <TagInput
          label="添加屏蔽画师"
          placeholder="添加画师名…"
          add={handleAdd}
        />
      </SettingSection>
    )
  }
}
