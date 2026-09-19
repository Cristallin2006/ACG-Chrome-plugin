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

export default class TagSettingSection extends Component<Props, State> {
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
      <SettingSection title="屏蔽标签" note="含任一标签的作品不上墙" stack>
        <ChipList
          values={tags}
          onDelete={handleTagDelete}
          empty="没有屏蔽的标签"
        />
        <TagInput
          label="添加屏蔽标签"
          placeholder="添加标签…"
          add={handleTagAdd}
        />
      </SettingSection>
    )
  }
}
