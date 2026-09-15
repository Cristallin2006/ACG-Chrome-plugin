# ACG-Chrome-plugin（Ku-nya 衍生版）

A Chrome extension for pixiv lovers: it picks up illustrations from the pixiv
ranking and displays them on your new tab — as a gapless, zero-crop **puzzle
wall** that reveals itself screen by screen as you scroll.

> **声明 / Credits**
>
> 本项目是 [tamanobi/Ku-nya](https://github.com/tamanobi/Ku-nya)（作者 Kohki
> YAMAGIWA）的衍生作品，原作以 **Apache License 2.0** 发布；本仓库完整保留原
> `LICENSE`，并在提交历史中保留原作的全部开发记录。在此向原作者致谢。
>
> This repository is a derivative work of
> [tamanobi/Ku-nya](https://github.com/tamanobi/Ku-nya) by Kohki YAMAGIWA,
> originally released under the **Apache License 2.0**. The original `LICENSE`
> is retained verbatim and the upstream development history is preserved in
> this repository's git history. All credit for the original project goes to
> its author.
>
> 本衍生版的主要改动 / What this derivative adds:
>
> - **Manifest V3 迁移**（见 [MIGRATION-MV3.md](MIGRATION-MV3.md)）
> - 「暗房」视觉系统：暖调近黑画布 + 底部磨砂搜索胶囊（见 [DESIGN.md](DESIGN.md)）
> - **精确拼合拼图墙**：以二叉空间分割（BSP，i3/bspwm 式）为每张图分配与原图
>   宽高比严格相等的格子，零裁切、零拉伸、灰缝均匀（`src/lib/tiling.ts`）
> - **渐进式加载**：一视口一屏拼图，下滑逐屏追加、拼块入屏逐块渐入
> - 图源修复：统一归一化为等比 `master` 图（修复 `_custom` 方图缩略图导致的
>   拉伸），分辨率提升至 `600x1200_90`
> - 插画均来自 pixiv 公开榜单，版权归原作者及 pixiv 所有；本扩展仅作展示与
>   跳转，不存储、不分发图片内容

## Build

```bash
yarn install
yarn build
```

`yarn build` writes the extension to `release/`; `yarn dev` rebuilds on change.
Any current Node.js works, 17 and later included.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Choose **Load unpacked** and select the `release` directory

Chrome 137 and later ignore `--load-extension` in branded builds, so that page
(or the Web Store) is the only way in.

## Compatibility

Manifest V3, which is what current Chrome runs; the previous Manifest V2 build
is in the history. [MIGRATION-MV3.md](MIGRATION-MV3.md) records what changed and
why.

## What it does

- Opens on a full-viewport **puzzle wall** of random illustrations from the pixiv
  daily ranking: every tile is shaped to its image's exact aspect ratio, so
  nothing is ever cropped or stretched; scrolling deals the next screen of the
  puzzle and each piece fades in as it enters view
- A frosted search capsule sits at the bottom centre and searches **the web** with
  your default search engine (what the address bar does); anything that looks like
  an address is opened directly
- The switch on the capsule toggles between **纯看 / watch** — illustrations are not
  clickable at all, so the page can be scrolled without opening anything by accident
  — and **交互 / interactive**, where they link to the artwork page. The choice is
  remembered, and the popup exposes it too
- `/` or `Ctrl/Cmd+K` focuses the search field, any printable character starts a
  query, `Esc` clears and steps out; in watch mode the capsule steps back to a ghost
  while the pointer is still and returns the moment you move

See [DESIGN.md](DESIGN.md) for the visual system it implements.

## The new tab footer, and `theme-darkroom/`

Since Chrome 138, Chrome draws its own footer on a new tab page that an
extension has taken over, crediting that extension. It is browser UI: it is not
part of this page, no stylesheet here can reach it, and the only switch Chrome
exposes is an enterprise policy (`NTPFooterExtensionAttributionEnabled`), which
also pins the "managed by your organisation" badge on the browser.

`theme-darkroom/` is the cheaper answer. Chrome's new tab surfaces take their
colours from the browser theme (`chrome://theme/colors.css`), so a minimal theme
that sets the new tab colours to the page's own `#131110` makes that footer
blend into the page:

1. `chrome://extensions` → **Developer mode** → **Load unpacked**
2. Select the `theme-darkroom` directory

It sets only `ntp_background`, `ntp_text`, `ntp_header` and `ntp_link`, so the
rest of the browser chrome keeps whatever look it has now. Installing a theme
does replace the currently active one; to undo, use **Reset to default** in
`chrome://settings/appearance` (or re-apply the previous theme).

## Test

```bash
node test/e2e.mjs
```

Starts a throwaway Chrome with its own profile, loads `release/` unpacked,
and exercises the new tab page and popup end to end. Set `CHROME_PATH` if Chrome
is not in the default location, `KUNYA_HEADFUL=1` to watch it run.

```bash
node test/measure-distortion.mjs
```

Measures the rendered aspect ratio of every gallery image against the source
pixels — the puzzle wall's zero-crop / zero-stretch contract, verified in a
real browser.
