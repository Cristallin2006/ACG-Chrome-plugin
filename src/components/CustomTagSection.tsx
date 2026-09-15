import { h, Component, FunctionalComponent } from 'preact'
import SettingSection from './SettingSection'
import TagInput from './TagInput'

interface Props {
  initialTags: string[]
  update(tags: string[]): void
}

interface State {
  tags: string[]
}

/**
 * User-defined tag categories. Each entry becomes a `tag:<keyword>` choice in
 * the Ranking Mode dropdown and turns the new tab wall into that tag's latest
 * search results (see api.getIllustsByTag).
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
      <SettingSection title="Custom Category(Tag)">
        <TagInput
          label="Category tag"
          placeholder="初音ミク"
          add={handleTagAdd}
        />
        <ul>
          {tags.map(tag => (
            <Tag key={tag} name={tag} onDelete={handleTagDelete} />
          ))}
        </ul>
        {tags.length > 0 && (
          <p>Added tags appear in the Ranking Mode dropdown above.</p>
        )}
      </SettingSection>
    )
  }
}

const Tag: FunctionalComponent<{
  name: string
  onDelete(name: string): void
}> = ({ name, onDelete }) => {
  const handleTagDelete = () => onDelete(name)

  return (
    <li className="tag">
      {name}
      <button value="tag.name" onClick={handleTagDelete}>
        x
      </button>
    </li>
  )
}
