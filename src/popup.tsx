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

  // Unpacked-development guard: page code is re-read from disk on every open,
  // but Chrome keeps a RUNNING service worker on its old code until the
  // extension is reloaded. A worker from before these settings answers
  // getOptions without the newest key — without this banner that mix presents
  // as "settings don't persist", because the old worker silently drops every
  // setter message it doesn't recognise. Check the newest option key; any
  // worker that knows it knows the rest.
  if (!('isExcludingAI' in options)) {
    const banner = document.createElement('p')
    banner.className = 'stale-worker'
    banner.textContent =
      '扩展程序已在磁盘上更新：请到 chrome://extensions 点一次「重新加载」，否则设置无法保存。'
    settings.insertBefore(banner, settings.firstChild)
  }
})
