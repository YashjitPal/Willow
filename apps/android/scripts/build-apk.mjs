// Builds apps/android/dist/Willow.apk: `expo prebuild` generates the native project in
// android/ (gitignored), Gradle builds the release APK (signed with the debug keystore,
// see plugins/with-release-debug-signing.js) and it is copied to dist/.
//
//   node apps/android/scripts/build-apk.mjs [--clean]
//
// --clean regenerates android/ from scratch first: use it after changing app.json or
// native dependencies. Needs `npm install` in apps/android, the Android SDK and a JDK 17+
// (Android Studio's bundled one is used when present).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(appDir, 'android');
const cacheDir = join(appDir, '.cache');
const windows = process.platform === 'win32';
const clean = process.argv.includes('--clean');
// React Native's app CMake build doesn't pin a version; this is the Android Gradle plugin's default.
const CMAKE_VERSION = '3.22.1';

const javaHome = firstDirectory(
  windows ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : null,
  process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/jbr/Contents/Home' : null,
  process.env.JAVA_HOME,
);
const sdkRoot = firstDirectory(
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null,
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  join(homedir(), 'Library', 'Android', 'sdk'),
  join(homedir(), 'Android', 'Sdk'),
);
if (!javaHome) fail('No JDK found. Install Android Studio, or set JAVA_HOME to a JDK 17 or newer.');
if (!sdkRoot) fail('No Android SDK found. Install it with Android Studio, or set ANDROID_HOME.');
if (!existsSync(join(appDir, 'node_modules', 'expo', 'package.json'))) {
  fail('Dependencies are missing: run `npm install` in apps/android first.');
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  CI: '1',
  EXPO_NO_GIT_STATUS: '1',
  EXPO_NO_TELEMETRY: '1',
};
const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
// Gradle runs `node` for autolinking and the JS bundle: make it the one running this script.
env[pathKey] = [dirname(process.execPath), join(javaHome, 'bin'), env[pathKey]].join(delimiter);
const gradleArgs = ['assembleRelease', '--no-daemon', '--max-workers=2', '-Pkotlin.compiler.execution.strategy=in-process'];
if (windows && /\s/.test(sdkRoot)) {
  gradleArgs.push('--init-script', join(appDir, 'scripts', 'clang-driver-mode.gradle'));
}

console.log(`JAVA_HOME=${javaHome}\nANDROID_HOME=${sdkRoot}\nnode ${process.version}`);

step('Generating the native project (expo prebuild)');
if (clean) {
  // Expo's own clean gives up at the first locked file (antivirus, file watchers).
  rmSync(androidDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
}
run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install', '--no-clean'], appDir);

step('Fetching Gradle');
await useLocalGradleDistribution();

step('Checking Android SDK packages');
installMissingSdkPackages();

step('Building the release APK (gradle assembleRelease)');
run(windows ? 'gradlew.bat' : './gradlew', gradleArgs, androidDir);

const built = join(androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!existsSync(built)) fail(`Gradle finished, but ${built} is missing.`);
const apk = join(appDir, 'dist', 'Willow.apk');
mkdirSync(dirname(apk), { recursive: true });
copyFileSync(built, apk);
console.log(`\nBuilt ${apk} (${(statSync(apk).size / (1024 * 1024)).toFixed(1)} MB)`);

/**
 * Downloads the Gradle distribution the wrapper names into .cache/ and points the wrapper
 * at that file. The wrapper's own download tries only the first address it resolves, and
 * GitHub, where Gradle is hosted, can resolve to one that doesn't answer; Node tries each.
 */
async function useLocalGradleDistribution() {
  const file = join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const properties = readFileSync(file, 'utf8');
  const url = /^distributionUrl=(.*)$/m.exec(properties)?.[1]?.trim().replace(/\\:/g, ':');
  if (!url) fail(`No distributionUrl in ${file}.`);
  if (url.startsWith('file:')) {
    if (!existsSync(fileURLToPath(url))) fail(`The wrapper's ${url} is gone: run again with --clean.`);
    console.log(`Using ${fileURLToPath(url)}`);
    return;
  }
  const zip = join(cacheDir, 'gradle', url.slice(url.lastIndexOf('/') + 1));
  if (!existsSync(zip)) {
    const expected =
      /^distributionSha256Sum=(\w+)/m.exec(properties)?.[1] ?? (await fetchText(`${url}.sha256`)).trim();
    console.log(`Downloading ${url}`);
    mkdirSync(dirname(zip), { recursive: true });
    const part = `${zip}.part`;
    const response = await fetch(url);
    if (!response.ok || !response.body) fail(`Downloading ${url} failed: HTTP ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(part));
    const actual = await sha256(part);
    if (actual !== expected.toLowerCase()) {
      rmSync(part, { force: true });
      fail(`${url} has SHA-256 ${actual}, but Gradle publishes ${expected}.`);
    }
    renameSync(part, zip);
  }
  const local = pathToFileURL(zip).href.replace(/:/g, '\\:');
  writeFileSync(file, properties.replace(/^distributionUrl=.*$/m, `distributionUrl=${local}`));
  console.log(`Using ${zip}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`Downloading ${url} failed: HTTP ${response.status}.`);
  return response.text();
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Installs the SDK packages the Gradle build will ask for, at the versions it asks for. */
function installMissingSdkPackages() {
  const catalog = readFileSync(join(appDir, 'node_modules', 'react-native', 'gradle', 'libs.versions.toml'), 'utf8');
  const properties = readFileSync(join(androidDir, 'gradle.properties'), 'utf8');
  const version = (catalogKey, propertyKey) => {
    const value =
      matchLine(properties, `${escapeRegExp(propertyKey)}\\s*=\\s*(\\S+)`) ??
      matchLine(catalog, `${escapeRegExp(catalogKey)}\\s*=\\s*"([^"]+)"`);
    if (!value) fail(`Can't tell which ${catalogKey} the build needs.`);
    return value;
  };
  const wanted = [
    `platforms;android-${version('compileSdk', 'android.compileSdkVersion')}`,
    `build-tools;${version('buildTools', 'android.buildToolsVersion')}`,
    `ndk;${version('ndkVersion', 'android.ndkVersion')}`,
    `cmake;${CMAKE_VERSION}`,
  ];
  const missing = wanted.filter((name) => !existsSync(join(sdkRoot, ...name.split(';'), 'source.properties')));
  if (missing.length === 0) {
    console.log(`All present: ${wanted.join(', ')}`);
    return;
  }
  const sdkmanager = join(sdkRoot, 'cmdline-tools', 'latest', 'bin', windows ? 'sdkmanager.bat' : 'sdkmanager');
  if (!existsSync(sdkmanager)) {
    fail(`Missing ${missing.join(', ')}, and there is no sdkmanager at ${sdkmanager} to install them.`);
  }
  console.log(`Installing ${missing.join(', ')}`);
  run(sdkmanager, [`--sdk_root=${sdkRoot}`, '--install', ...missing], appDir, 'y\n'.repeat(20));
}

function run(command, args, cwd, input) {
  const options = { cwd, env, stdio: [input ? 'pipe' : 'inherit', 'inherit', 'inherit'], input };
  // .bat/.cmd files only run through cmd.exe, which needs paths and package names quoted.
  const result = windows
    ? spawnSync([command, ...args].map(quoteForCmd).join(' '), { ...options, shell: true })
    : spawnSync(command, args, options);
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}.`);
}

function quoteForCmd(value) {
  return /[\s;,=&|<>^()"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function matchLine(text, pattern) {
  return new RegExp(`^\\s*${pattern}`, 'm').exec(text)?.[1] ?? null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function firstDirectory(...candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function step(title) {
  console.log(`\n== ${title}`);
}

function fail(message) {
  console.error(`\nbuild-apk: ${message}`);
  process.exit(1);
}
