import * as path from 'node:path';

/**
 * UI tests in a real Obsidian (wdio-obsidian-service downloads it into .obsidian-cache). Each spec opens a fresh copy
 * of a test vault from test/fixtures. OBSIDIAN_VERSIONS picks app/installer pairs, e.g. "1.8.7/earliest,latest/latest".
 */
const versions = (process.env.OBSIDIAN_VERSIONS ?? 'latest/latest').split(',').map((pair) => pair.trim().split('/'));

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./test/e2e/**/*.e2e.ts'],
  maxInstances: Number(process.env.WDIO_INSTANCES ?? 2),
  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: 'obsidian',
    browserVersion: appVersion,
    'wdio:obsidianOptions': { installerVersion: installerVersion ?? 'latest', plugins: ['.'] },
  })),
  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir: path.resolve('.obsidian-cache'),
  mochaOpts: { ui: 'bdd', timeout: 90000 },
  logLevel: 'warn',
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const dir = path.resolve('test-results');
    await import('node:fs').then((fs) => fs.mkdirSync(dir, { recursive: true }));
    await browser.saveScreenshot(path.join(dir, `${test.parent} — ${test.title}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 180) + '.png'));
  },
};
