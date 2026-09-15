/**
 * The service worker owns the settings, so every page reads and writes them
 * with `chrome.runtime.sendMessage`.
 *
 * Manifest V3 stops the worker whenever it goes idle. Messaging still works
 * while it is stopped — sending a message starts it again — but the round trip
 * can fail (a worker that has not finished starting, an extension that was just
 * reloaded), and that failure arrives as `chrome.runtime.lastError` with an
 * `undefined` response instead of as an exception. The call sites used to read
 * `response.data` directly, which turned any such failure into a TypeError
 * inside the callback: a blank page and a console warning about an unchecked
 * `lastError`, with nothing pointing at the cause.
 *
 * Reading `lastError` is also what marks it as handled; leaving it unread is
 * what makes Chrome log "Unchecked runtime.lastError".
 */
export function sendMessage<T = any>(message: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: any) => {
      const failure = chrome.runtime.lastError
      if (failure) {
        reject(new Error(failure.message))
        return
      }
      if (!response) {
        reject(
          new Error(
            `the background service worker did not answer '${message.method}'`,
          ),
        )
        return
      }
      if (response.error) {
        reject(new Error(response.error))
        return
      }
      resolve(response.data as T)
    })
  })
}
