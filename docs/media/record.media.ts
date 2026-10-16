// Records the README GIF and the community directory screenshots on the fictional «showcase» vault of the test
// vaults repository: `npm run media`. Frames come from Electron's capturePage, so nothing else on the screen gets in.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { browser } from '@wdio/globals';
import { Key } from 'webdriverio';
import { focusGraph, openGraph, openVault, waitSettled } from '../../test/e2e/helpers';
import { clickAt, clickEl, glide, MEDIA_DIR, nodePoint, person, screenshot as capture, showPointer, startRecording as record, stopRecording, type Win } from './recording';

const OUT = path.resolve(import.meta.dirname);
const FRAMES = path.join(OUT, '.frames');
const SCREENS = path.join(MEDIA_DIR, 'readme', 'screenshots');

const startRecording = () => record(FRAMES);
/** A screenshot of the window for the directory listing. */
const screenshot = (name: string) => capture(path.join(SCREENS, `${name}.png`));
const clickPerson = async (id: string, options = {}) => { await waitSettled(); await clickAt(await nodePoint(id), options); };

/** Where the pointer waits while a screenshot is taken: an empty corner. */
const REST = { x: 1120, y: 300 };

/** Types a name into the dock's search and takes the first suggestion. */
async function pick(name: string) {
  await clickEl('.genealogy-dock-search input');
  for (const letter of name) { await browser.keys(letter); await browser.pause(70); }
  await browser.pause(500);
  await browser.keys(Key.Enter);
  await browser.pause(500);
}

describe('README GIF and directory screenshots', () => {
  it('records the main features', async () => {
    await openVault('showcase', { graph: false });
    await browser.executeObsidian(({ app }) => {
      const remote = (window as unknown as Win).require('@electron/remote');
      remote.getCurrentWindow().setContentSize(1200, 800);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (app.workspace as any).leftSplit.collapse();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const plugin = (app as any).plugins.plugins['genealogy-graph'];
      plugin.settings.controls.open = false;
    });
    await showPointer();
    await browser.pause(500);
    const emily = await person('Emily Carter'); const robert = await person('Robert Carter');

    await startRecording();
    // The graph opens and spreads out.
    await openGraph();
    await browser.pause(800);
    await screenshot('1-graph');

    // A click shows a person's closest family.
    await clickPerson(emily);
    await browser.pause(1500);

    // Kinship route between two people, picked by name.
    await focusGraph(); await browser.keys(Key.Escape);
    await waitSettled(); await browser.pause(400);
    await clickEl('.genealogy-dock-button .svg-icon.lucide-route');
    await pick('Emily');
    await pick('Edward');
    await waitSettled();
    // The whole route in view, as the plugin frames it when both ends are chosen.
    await browser.executeObsidian(({ app }) => (app.workspace.getLeavesOfType('genealogy-graph-view')[0].view as any).fitPath());
    await glide(REST);
    await waitSettled(); await browser.pause(2500);
    await screenshot('2-route');
    await clickEl('.genealogy-dock-button .svg-icon.lucide-route');
    await waitSettled(); await browser.pause(600);

    // Roots: every line of ancestors.
    await clickEl('.genealogy-dock-button .svg-icon.lucide-sprout');
    await glide(REST);
    await waitSettled(); await browser.pause(2200);
    await screenshot('3-roots');
    await clickEl('.genealogy-dock-button .svg-icon.lucide-sprout');
    await waitSettled(); await browser.pause(600);

    // Search, then the profile.
    await pick('Robert');
    await waitSettled(); await browser.pause(700);
    await clickPerson(robert, { double: true });
    await glide(REST);
    await browser.pause(2000);
    await screenshot('4-profile');
    await browser.keys(Key.Escape);
    await browser.pause(600);

    // Export for print.
    await clickEl('.graph-controls-button.mod-open');
    await clickEl('.graph-control-section-header=Export');
    await clickEl('button=Export…');
    await browser.$('.genealogy-export').waitForDisplayed();
    await clickEl(browser.$('.genealogy-export-segments').$('button=Print'));
    await browser.pause(800);
    await clickEl('.genealogy-export-inline');
    await glide(REST);
    await browser.pause(2000);
    await screenshot('5-export');
    await browser.keys(Key.Escape);
    await browser.pause(400);

    const frames = await stopRecording();
    fs.writeFileSync(path.join(FRAMES, 'frames.json'), JSON.stringify(frames));
  });
});
