import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';
import { builtinModules } from 'module';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const isWatch = process.argv.includes('--watch');
const buildChannel = process.env.TOOLKIT_DEV_BUILD === '1' || isWatch ? 'dev' : 'production';

// Node builtins should not be bundled
const nodeBuiltins = [
  ...builtinModules,
  ...builtinModules.map(m => `node:${m}`),
];

export default defineConfig({
  entry: { 'ai-toolkit': 'src/index.tsx' },
  outDir: 'bin',
  format: ['esm'],
  target: 'node20',
  clean: false,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  external: [...nodeBuiltins, 'react-devtools-core'],
  banner: { js: '#!/usr/bin/env node\nimport { createRequire } from "module";\nconst require = createRequire(import.meta.url);' },
  shims: true,
  esbuildOptions(options) {
    options.alias = {
      'react-devtools-core': '/dev/null',
    };
    options.platform = 'node';
  },
  define: {
    'process.env.TOOLKIT_VERSION': JSON.stringify(pkg.version),
    'process.env.TOOLKIT_BUILD_CHANNEL': JSON.stringify(buildChannel),
  },
});
