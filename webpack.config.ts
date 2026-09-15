import webpack = require('webpack')
import path = require('path')

export default (env, argv) =>
  ({
    context: path.join(__dirname, 'src'),
    entry: {
      "dist/main": './main.tsx',
      "dist/popup": './popup.tsx',
      "background": './background.tsx',
    },
    output: {
      path: path.join(__dirname, 'release'),
      filename: '[name].js',
      // webpack 4 hashes with md4, which OpenSSL 3 (Node 17+) no longer
      // provides: the build dies with
      // "error:0308010C:digital envelope routines::unsupported".
      // sha256 exists in every Node this project can be built with.
      hashFunction: 'sha256',
      // background.js is a Manifest V3 service worker, where `window` is not
      // defined and `self` is the global object. In the two page bundles
      // `self === window`, so one setting covers all three entries.
      globalObject: 'self',
    },
    resolve: {
      extensions: ['.js', '.ts', '.tsx'],
      modules: ['node_modules'],
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: [{ loader: 'ts-loader' }],
        },
      ],
    },
    optimization: {
      minimize: argv.mode === 'production',
    },
    plugins: [
      new webpack.DefinePlugin({
        SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN || null),
      }),
    ],
  } as webpack.Configuration)
