// Assembles index.html from template.html plus the four isolated direction
// parts (each written by a separate agent, scoped CSS, no shared shell).
//
//   node assemble.mjs
//
// Also runs the cheap contract checks from the style-preview spec, so a broken
// direction part fails here instead of in the browser.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const parts = { A: 'dir-a.html', B: 'dir-b.html', C: 'dir-c.html', D: 'dir-d.html' }

let html = readFileSync(path.join(here, 'template.html'), 'utf8')

for (const [key, file] of Object.entries(parts)) {
  const filePath = path.join(here, 'parts', file)
  if (!existsSync(filePath)) throw new Error(`missing part: ${file}`)
  const part = readFileSync(filePath, 'utf8').trim()
  if (!part.includes(`dir-${key.toLowerCase()}-`)) {
    throw new Error(`${file} does not use its own .dir-${key.toLowerCase()}- prefix`)
  }
  html = html.replace(`<!--DIR_${key}-->`, part)
}

writeFileSync(path.join(here, 'index.html'), html)

const checks = [
  ['all four parts inlined', !/<!--DIR_[A-D]-->/.test(html)],
  ['four direction names present', ['静纸', '暗房', '刊头', '台面'].every(n => html.includes(n))],
  ['recommendation marked', html.includes('推荐')],
  ['no selection button in page source (server injects it)', !html.includes('qmdp-pick-button')],
  // The file:// fallback reads the server's dial inputs by attribute, so only
  // class declarations would actually collide with the injected shell.
  ['page declares no .qmdp- classes', !/class=["'][^"']*qmdp-/.test(html)],
  // <a href> to pixiv is the mockup's click-through target, not a subresource.
  ['no external subresources', !/(?:src|srcset)=["']https?:|<link[^>]+href=["']https?:/i.test(html)],
  ['no italic', !/font-style:\s*italic/i.test(html)],
  ['no transition: all', !/transition:\s*all\b/i.test(html)],
  ['no ease-in easing', !/ease-in(?!-out)/.test(html)],
  // Black inside a mask gradient is the mask's opaque stop, not a paint color.
  ['no pure black paint', !/#000\b|#000000\b|rgb\(0,\s*0,\s*0\)|rgb\(0 0 0\)/i.test(html.replace(/^.*mask.*$/gim, ''))],
  ['all ten artworks referenced', Array.from({ length: 10 }, (_, i) => `art-${String(i + 1).padStart(2, '0')}.jpg`).every(f => html.includes(f))],
  ['each direction has a reduced-motion fallback', (html.match(/prefers-reduced-motion/g) || []).length >= 4],
]

let failed = 0
for (const [name, ok] of checks) {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
}
console.log(`\nindex.html: ${html.length} bytes, ${failed} failing check(s)`)
process.exit(failed ? 1 : 0)
