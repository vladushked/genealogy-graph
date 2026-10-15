import { config as base } from './wdio.conf.mts';

/** Records the README GIF and the directory screenshots (docs/media/record.media.ts); run by `npm run media`. */
export const config: WebdriverIO.Config = { ...base, specs: ['./docs/media/*.media.ts'], maxInstances: 1, mochaOpts: { ui: 'bdd', timeout: 600000 } };
