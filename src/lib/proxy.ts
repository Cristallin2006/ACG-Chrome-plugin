/**
 * Pinned local proxy (Clash & co. at 127.0.0.1:7890).
 *
 * pixiv is unreachable from a direct mainland connection, and the flakiness
 * the wall showed ("时好时坏") tracked the system proxy switch: toggling it
 * off (or a VPN stack still reconnecting after boot) killed every pixiv
 * request at once. Pinning the port makes the extension independent of the
 * system toggle — as long as the proxy core itself is up, the wall loads.
 *
 * Honest scope note: chrome.proxy is browser-wide, there is no per-extension
 * proxy. The PAC therefore sends ALL traffic to 7890 first and falls back to
 * DIRECT when nothing listens there, which mirrors a Clash system-proxy
 * setup (its rules still decide what actually gets proxied) and degrades to
 * plain direct browsing when the proxy is off. Users with another proxy
 * manager (SwitchyOmega etc.) can turn this off in the popup.
 */

const PROXY_HOST = '127.0.0.1'
const PROXY_PORT = 7890

/**
 * The pinned @types/chrome (0.0.75) predates chrome.proxy's typings; the
 * runtime API is stable since Chrome 33.
 */
const proxyApi = () => (chrome as any).proxy

const PAC_SCRIPT = `
function FindProxyForURL(url, host) {
  if (isPlainHostName(host) || host === '127.0.0.1' || host === 'localhost') {
    return 'DIRECT';
  }
  return 'PROXY ${PROXY_HOST}:${PROXY_PORT}; DIRECT';
}
`

/** Apply or release the pinned proxy. Idempotent — safe on every worker wake. */
export const applyProxySetting = async (enabled: boolean): Promise<void> => {
  const api = proxyApi()
  if (!api || !api.settings) return
  if (enabled) {
    await api.settings.set({
      value: { mode: 'pac_script', pacScript: { data: PAC_SCRIPT } },
      scope: 'regular',
    })
  } else {
    await api.settings.clear({ scope: 'regular' })
  }
}
