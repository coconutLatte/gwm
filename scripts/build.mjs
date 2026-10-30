import { build } from 'esbuild';
import { checkLocalization } from './check-localization.mjs';

await checkLocalization();

await build({
  entryPoints: {
    extension: 'src/extension.ts',
    'catalog.test': 'test/catalog.test.ts',
    'commitReview.test': 'test/commitReview.test.ts',
    'worktreeDelete.test': 'test/worktreeDelete.test.ts',
    integration: 'test/integration.ts',
  },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
});
