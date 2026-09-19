import { h, FunctionalComponent } from 'preact'

export interface SegmentedOption {
  value: string
  label: string
}

interface Props {
  name: string
  value: string
  options: SegmentedOption[]
  onChange(value: string): void
}

/** A segmented radio group: the selected segment is lit, never amber. */
const Segmented: FunctionalComponent<Props> = ({
  name,
  value,
  options,
  onChange,
}) => (
  <div className="knp-seg" role="radiogroup">
    {options.map(option => (
      <label className="knp-seg__item" key={option.value}>
        <input
          type="radio"
          name={name}
          value={option.value}
          checked={option.value === value}
          onChange={() => onChange(option.value)}
        />
        <span>{option.label}</span>
      </label>
    ))}
  </div>
)

export { Segmented as default }
