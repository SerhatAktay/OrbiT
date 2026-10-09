import { build } from 'esbuild'
import { polyfillNode } from 'esbuild-plugin-polyfill-node'

await build({
  entryPoints: ['scripts/vendor-entry.js'],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: 'vendor/bbi.bundle.js',
  plugins: [polyfillNode()],
})
