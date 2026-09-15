import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('./parts/dir-d.html', import.meta.url), 'utf8');
const markup = src.replace(/<script>[\s\S]*?<\/script>/, '');
const code = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';

const out = `// generated probe data — safe module form, no HTML parsing involved
export const MARKUP = ${JSON.stringify(markup)};
export const CODE = ${JSON.stringify(code)};
export const SRC = ${JSON.stringify(src)};
`;
writeFileSync(new URL('./_probe-d.data.mjs', import.meta.url), out, 'utf8');
console.log('data module written, markup bytes =', markup.length, 'code bytes =', code.length);
