import { h, Component } from 'preact'
import SettingSection from './SettingSection'
import TagInput from './TagInput'
import ChipList from './ChipList'

interface Props {
  initialTags: string[]
  update(tags: string[]): void
}

interface State {
  tags: string[]
}

/**
 * User-defined tag categories. Each entry becomes a `tag:<keyword>` choice in
 * the content-source dropdown and turns the new tab wall into that tag's
 * latest search results.
 */
export default class CustomTagSection extends Component<Props, State> {
  handleTagAdd = (value: string) => {
    const {
      props: { update },
      state: { tags },
    } = this
    if (value === '' || tags.includes(value)) {
      return
    }
    const newtags = [...tags, value]
    this.setState({ tags: newtags })
    update(newtags)
  }

  handleTagDelete = (name: string) => {
    const { update } = this.props
    const tags = this.state.tags.filter(tag => tag !== name)

    this.setState({ tags })
    update(tags)
  }

  constructor(props: Props) {
    super(props)
    this.state = {
      tags: this.props.initialTags,
    }
  }

  render() {
    const {
      handleTagAdd,
      handleTagDelete,
      state: { tags },
    } = this
    return (
      <SettingSection
        title="自定义标签"
        note="添加后出现在「内容源」列表"
        stack
      >
        <ChipList
          values={tags}
          onDelete={handleTagDelete}
          empty="还没有自定义标签"
        />
        <TagInput
          label="添加自定义标签"
          placeholder="添加标签,如 初音ミク…"
          add={handleTagAdd}
        />
      </SettingSection>
    )
  }
}
