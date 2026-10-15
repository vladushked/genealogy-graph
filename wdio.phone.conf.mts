import { config as base } from './wdio.conf.mts';

/** Screenshots of the graph on a phone-sized mobile Obsidian (test/e2e/phone.shots.ts); run by `npm run phone`. */
export const config: WebdriverIO.Config = { ...base, specs: ['./test/e2e/*.shots.ts'], maxInstances: 1, afterTest: undefined };
