import { h, render } from 'preact'
import SettingPanel from './components/SettingPanel'
import { migrateLegacyStorage } from './lib/StorageUtil'
import { sendMessage } from './lib/messaging'
import { defaultOptions, Options } from './lib/options'

document.addEventListener('DOMContentLoaded', async () => {
  const settings = document.getElementById('setting')

  let options: Options
  try {
    // The popup can be the first page opened after an upgrade, so it migrates
    // too; `migrateLegacyStorage` is a no-op once that has happened.
    await migrateLegacyStorage()
    options = await sendMessage<Options>({ method: 'getOptions' })
  } catch (error) {
    // Show the panel anyway: each section writes the whole setting it edits,
    // so the user can still change what failed to load.
    console.error('Ku-nya: could not read the stored settings', error)
    options = defaultOptions
  }

  render(<SettingPanel initialOptions={options} />, settings)
})
