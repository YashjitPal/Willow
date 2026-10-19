import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

const checker = await importTs(path.join(ROOT, 'platform/core/src/update-checker.ts'));

describe('update checker semver parsing and comparison', () => {
  it('parses valid semver with or without v prefix', () => {
    assert.deepEqual(checker.parseSemver('v0.1.0'), { major: 0, minor: 1, patch: 0, prerelease: undefined });
    assert.deepEqual(checker.parseSemver('0.1.0'), { major: 0, minor: 1, patch: 0, prerelease: undefined });
    assert.deepEqual(checker.parseSemver('v1.2.3-beta.1'), { major: 1, minor: 2, patch: 3, prerelease: 'beta.1' });
    assert.equal(checker.parseSemver('invalid'), null);
  });

  it('correctly compares version numbers', () => {
    assert.equal(checker.compareSemver('0.1.1', '0.1.0') > 0, true);
    assert.equal(checker.compareSemver('0.2.0', '0.1.9') > 0, true);
    assert.equal(checker.compareSemver('1.0.0', '0.9.9') > 0, true);
    assert.equal(checker.compareSemver('0.1.0', '0.1.0'), 0);
    assert.equal(checker.compareSemver('0.1.0', '0.1.1') < 0, true);
  });

  it('detects whether a remote release is newer than current', () => {
    assert.equal(checker.isNewerVersion('v0.1.1', '0.1.0'), true);
    assert.equal(checker.isNewerVersion('v0.1.0', '0.1.0'), false);
    assert.equal(checker.isNewerVersion('v0.0.9', '0.1.0'), false);
  });

  it('resolves appropriate download URLs from release assets', () => {
    const mockRelease = {
      html_url: 'https://github.com/YashjitPal/Willow/releases/tag/v0.1.1',
      assets: [
        { name: 'Willow.apk', browser_download_url: 'https://github.com/.../Willow.apk', size: 60000000 },
        { name: 'Willow_0.1.1_x64-setup.exe', browser_download_url: 'https://github.com/.../Willow_0.1.1_x64-setup.exe', size: 140000000 },
      ],
    };

    const resolved = checker.resolveDownloadUrl(mockRelease);
    assert.equal(resolved.windowsAssetUrl, 'https://github.com/.../Willow_0.1.1_x64-setup.exe');
    assert.equal(resolved.androidAssetUrl, 'https://github.com/.../Willow.apk');
    assert.equal(resolved.downloadUrl, 'https://github.com/.../Willow_0.1.1_x64-setup.exe');
  });
});

describe('update and get-app button integration in StudioLayout', () => {
  const layout = read('apps/studio/src/shell/StudioLayout.tsx');

  it('gates the Get app button behind the get-app-button labs experiment', () => {
    assert.match(layout, /experiments\['get-app-button'\]/);
  });

  it('renders DesktopUpdateButton when an update is available', () => {
    assert.match(layout, /updateState\.available/);
    assert.match(layout, /<DesktopUpdateButton/);
    assert.match(layout, /<PhoneUpdateButton/);
  });
});
