#!/usr/bin/env node
/**
 * Build launcher: `node build.js --mode production`.
 *
 * webpack 4 hashes with md4, and the uglifyjs plugin it bundles does the same
 * for its own cache keys. Node 17 and later ship OpenSSL 3, where md4 moved
 * into the legacy provider and every attempt to use it fails with
 *
 *   Error: error:0308010C:digital envelope routines::unsupported
 *
 * `--openssl-legacy-provider` brings the provider back. Node 16 and older have
 * md4 built in and exit with "bad option" when handed that flag, so it is only
 * passed where it is needed, which keeps `yarn build` working on both.
 *
 * (webpack's own hashing is already switched to sha256 in webpack.config.ts;
 * this covers the minimizer, which hardcodes md4 and exposes no option.)
 */
const { spawnSync } = require('child_process')
const path = require('path')

const nodeMajor = Number(process.versions.node.split('.')[0])
const nodeOptions = nodeMajor >= 17 ? ['--openssl-legacy-provider'] : []
const webpackBin = path.join(
  __dirname,
  'node_modules',
  'webpack',
  'bin',
  'webpack.js',
)

// stdio is inherited rather than piped: the build prints progress as it goes,
// and a piped child cannot be read from every environment this runs in.
const build = spawnSync(
  process.execPath,
  nodeOptions.concat([webpackBin], process.argv.slice(2)),
  { stdio: 'inherit' },
)

process.exit(build.status === null ? 1 : build.status)
