import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  version: '1.85.2',
  workspaceFolder: './test/fixtures/ts-project',
  launchArgs: ['--disable-extensions'],
  mocha: { ui: 'tdd', timeout: 60000 },
});
