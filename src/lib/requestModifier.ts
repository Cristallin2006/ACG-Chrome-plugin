/**
 * pixiv image requests need a Referer of https://www.pixiv.net/, otherwise
 * i.pximg.net rejects them (HTTP 403 for a correctly formed URL).
 *
 * The Manifest V2 build rewrote that header at runtime with
 * `chrome.webRequest.onBeforeSendHeaders` and the blocking `webRequestBlocking`
 * permission. Manifest V3 removed blocking webRequest, so the header is now set
 * declaratively, by the static rule in `release/rules/pximg-referer.json`
 * declared through `declarative_net_request` in the manifest.
 *
 * Nothing to do at runtime and no listener to register. This module stays as
 * the single place documenting why the rule exists; the rule is the
 * implementation.
 */
export {}
