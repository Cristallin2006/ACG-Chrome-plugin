import { h, render } from 'preact'
import App from './components/App'
import { migrateLegacyStorage } from './lib/StorageUtil'
import { sendMessage } from './lib/messaging'
import { defaultOptions, Options } from './lib/options'
import './lib/requestModifier'

/**
 * The pre-MV3 build kept the settings in this page's localStorage. The service
 * worker that owns them now has no localStorage of its own, so the old values
 * can only be carried over from a page, and only before the first read.
 */
const loadOptions = async (): Promise<Options> => {
  await migrateLegacyStorage()
  return sendMessage<Options>({ method: 'getOptions' })
}

document.addEventListener('DOMContentLoaded', async () => {
  const gallery = document.getElementById('gallery')
  try {
    render(<App options={await loadOptions()} />, gallery)
  } catch (error) {
    // A wall of illustrations with the default settings beats a blank new tab.
    console.error('Ku-nya: could not read the stored settings', error)
    render(<App options={defaultOptions} />, gallery)
  }
})
