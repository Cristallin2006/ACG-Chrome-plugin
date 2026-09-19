import { h, FunctionalComponent } from 'preact'

interface Props {
  title: string
  note?: string
  /** Wide controls (chip lists, long segmented groups) stack under the title. */
  stack?: boolean
}

/** One setting row inside a group card: title left, control right. */
const SettingSection: FunctionalComponent<Props> = ({
  title,
  note,
  stack,
  children,
}) => (
  <section className={stack ? 'knp-row knp-row--stack' : 'knp-row'}>
    <div className="knp-row__text">
      <h3 className="knp-row__title">{title}</h3>
      {note ? <p className="knp-row__note">{note}</p> : null}
    </div>
    <div className="knp-row__control">{children}</div>
  </section>
)

export { SettingSection as default }
