import { h, FunctionalComponent } from 'preact'

interface Props {
  id: string
  checked: boolean
  onChange(checked: boolean): void
  label: string
}

/**
 * The iOS-style switch. The accent amber only ever appears here (on state) and
 * on focus rings — everywhere else the panel stays neutral.
 */
const Toggle: FunctionalComponent<Props> = ({ id, checked, onChange, label }) => (
  <label className="knp-switch" aria-label={label}>
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={ev => onChange((ev.target as HTMLInputElement).checked)}
    />
    <span className="knp-switch__track" aria-hidden="true">
      <span className="knp-switch__knob" />
    </span>
  </label>
)

export { Toggle as default }
