import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild-wasm';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mocks = {
  '@willow/auth/AuthContext': 'export const useAuth = () => ({user: null, userProfile: null});',
  '@willow/storage/local-fs/LocalFSContext': 'export const useLocalFS = () => ({});',
  '@nanostores/react': 'export const useStore = () => ({});',
  '@willow/core/experiments-store': 'export const experimentsStore = {};',
  './tabs/index': 'export const WorkspaceTab = () => null, PeopleTab = () => null, PrivacyTab = () => null, LabsTab = () => null, AccountTab = () => null, ConnectorsTab = () => null, ModelsTab = () => null, GovernanceTab = () => null, PersonalIntelligenceTab = () => null;',
  './provider-models': 'export const GEMINI_MODELS = [];',
  './use-provider-settings': 'export const useProviderSettings = () => ({providerState: {}, handleUpdateConfig: () => {}});',
};

test('Settings moves, contains, and restores focus across its modal lifecycle', {
  skip: !existsSync(await puppeteer.executablePath()) && 'Install the test browser with npx puppeteer browsers install chrome',
}, async () => {
  const bundle = await build({
    stdin: { contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {SettingsModal} from './apps/studio/src/settings/SettingsModal';
      const config = {gemini: {model: 'test', thinkingLevel: 0}};
      function Harness() {
        const [open, setOpen] = useState(false);
        const [mounted, setMounted] = useState(true);
        window.removeSettings = () => setMounted(false);
        return <>
          {mounted && <SettingsModal isOpen={open} onClose={() => setOpen(false)}
            modelConfig={config} setModelConfig={() => {}}/>}
          <button id="trigger" onClick={() => setOpen(true)}>Settings</button>
          <button id="background">Background action</button>
        </>;
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, write: false, format: 'iife', platform: 'browser',
    plugins: [{ name: 'settings-boundaries', setup(builder) {
      builder.onResolve({ filter: /.*/ }, ({path}) => path in mocks ? {path, namespace: 'stub'} : undefined);
      builder.onLoad({filter: /.*/, namespace: 'stub'}, ({path}) => ({contents: mocks[path], loader: 'js'}));
      builder.onLoad({filter: /\.css$/}, () => ({contents: '', loader: 'js'}));
    }}],
  });
  const browser = await puppeteer.launch({headless: true, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({content: bundle.outputFiles[0].text});
    await page.click('#trigger');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close settings');
    const shiftTab = async () => {
      await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      await page.keyboard.up('Shift');
    };
    await shiftTab();
    assert.equal(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('[role="dialog"] button')].at(-1)), true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close settings');
    await page.focus('#background');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close settings');

    // Recompute the focusable controls after the tab's contents change.
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      dialog.insertAdjacentHTML('beforeend', '<button id="dynamic">Dynamic</button><button disabled>Disabled</button><button hidden>Hidden</button>');
      document.getElementById('dynamic').focus();
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Close settings');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'background');

    await page.click('#trigger');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close settings');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');

    await page.click('#trigger');
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close settings');
    await page.evaluate(() => removeSettings());
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
