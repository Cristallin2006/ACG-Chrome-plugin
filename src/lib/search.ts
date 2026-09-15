/**
 * The search entry behaves like the omnibox, which is what the new tab page is
 * asked to be: text goes to the browser's default search engine, and something
 * that already looks like an address is opened directly instead.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const DOMAIN = /^[^\s/?#]+\.[a-z]{2,}(?:[/?#]\S*)?$/i

export type SubmitResult = 'empty' | 'navigated' | 'searched' | 'searched-fallback'

/** "example.com/foo" and "https://x.dev" are addresses; "how to draw" is not. */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim()
  if (value.length === 0 || /\s/.test(value)) return false
  return SCHEME.test(value) || DOMAIN.test(value)
}

function withScheme(input: string): string {
  return SCHEME.test(input) ? input : `https://${input}`
}

/**
 * `chrome.search.query` runs the query through the profile's default search
 * engine, which is the behaviour being asked for, and navigates the current tab
 * to the results. It needs the "search" permission and is cast because the
 * pinned @types/chrome predates the API. Without it the page still works, just
 * against a fixed engine.
 */
export async function submit(input: string): Promise<SubmitResult> {
  const text = input.trim()
  if (text.length === 0) return 'empty'

  if (looksLikeUrl(text)) {
    location.assign(withScheme(text))
    return 'navigated'
  }

  const search = (chrome as any).search
  if (search && typeof search.query === 'function') {
    try {
      await search.query({ text, disposition: 'CURRENT_TAB' })
      return 'searched'
    } catch (error) {
      // Missing permission or no provider: still search somewhere rather than
      // leaving the keystroke with no effect.
      console.error('Ku-nya: chrome.search failed, falling back', error)
    }
  }

  location.assign(`https://www.google.com/search?q=${encodeURIComponent(text)}`)
  return 'searched-fallback'
}
