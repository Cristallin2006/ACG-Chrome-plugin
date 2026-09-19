import { h, FunctionalComponent } from 'preact'

interface Props {
  id: string
  checked: boolean
  onChange(checked: boolean): void
  label: string
}

/** Neutral square checkbox for the filter rows — the amber is the switch's. */
const Check: FunctionalComponent<Props> = ({ id, checked, onChange, label }) => (
  <label className="knp-check" aria-label={label}>
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={ev => onChange((ev.target as HTMLInputElement).checked)}
    />
    <span className="knp-check__box" aria-hidden="true" />
  </label>
)

export { Check as default }
