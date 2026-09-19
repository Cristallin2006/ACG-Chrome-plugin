import { h, FunctionalComponent } from 'preact'

interface Props {
  values: string[]
  onDelete(value: string): void
  empty?: string
}

/** Removable chips; shared by the custom-tag, author-mute and tag-mute lists. */
const ChipList: FunctionalComponent<Props> = ({ values, onDelete, empty }) => (
  <ul className="knp-chips">
    {values.map(value => (
      <li className="knp-chip" key={value}>
        <span className="knp-chip__name">{value}</span>
        <button
          type="button"
          className="knp-chip__x"
          aria-label={`移除 ${value}`}
          onClick={() => onDelete(value)}
        >
          ×
        </button>
      </li>
    ))}
    {values.length === 0 && empty ? (
      <li className="knp-chips__empty">{empty}</li>
    ) : null}
  </ul>
)

export { ChipList as default }
