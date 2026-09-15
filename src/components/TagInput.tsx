import { h, Component } from 'preact'

interface Props {
  label: string
  placeholder: string
  add(value: string): void
}

interface State {
  value: string
}

export default class TagInput extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { value: '' }
  }

  // onInput, not onChange: Preact 8 does not normalise change to per-keystroke
  // delivery, so onChange would only fire on blur — racing the Add click that
  // caused the blur.
  handleInput = (ev: Event) => {
    const target = ev.target as HTMLInputElement
    this.setState({ value: target.value })
  }

  handleAddClick = () => {
    const {
      props: { add },
      state: { value },
    } = this
    add(value)
    this.setState({ value: '' })
  }

  render() {
    const {
      props: { label, placeholder },
      state: { value },
      handleInput,
      handleAddClick,
    } = this

    return (
      <span>
        <label>
          {label}
          <input
            type="text"
            value={value}
            onInput={handleInput}
            placeholder={placeholder}
          />
        </label>
        <button onClick={handleAddClick}>Add</button>
      </span>
    )
  }
}
