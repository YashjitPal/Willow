const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs release builds with the debug keystore prebuild puts in android/app, so
 * `assembleRelease` gives an APK anyone can sideload and later builds install over
 * it. Not for the Play Store. Expo's template does this today; this keeps it so.
 */
module.exports = function withReleaseDebugSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = signReleaseWithDebugKey(mod.modResults.contents);
    return mod;
  });
};

function signReleaseWithDebugKey(gradle) {
  const buildTypes = blockAfter(gradle, /\bbuildTypes\s*\{/g);
  const release = buildTypes && blockAfter(gradle, /\brelease\s*\{/g, buildTypes.start, buildTypes.end);
  if (!release) {
    throw new Error('with-release-debug-signing: no buildTypes { release { ... } } in android/app/build.gradle');
  }
  const body = gradle.slice(release.start, release.end);
  if (/^\s*signingConfig\s+signingConfigs\.debug\s*$/m.test(body)) {
    return gradle;
  }
  const signed =
    '\n            signingConfig signingConfigs.debug' + body.replace(/^\s*signingConfig\s+.*$\n?/gm, '');
  return gradle.slice(0, release.start) + signed + gradle.slice(release.end);
}

/** The inside of the first `{ ... }` block opened by `opener` within [from, to). */
function blockAfter(text, opener, from = 0, to = text.length) {
  opener.lastIndex = from;
  const match = opener.exec(text);
  if (!match || match.index >= to) return null;
  const start = match.index + match[0].length;
  let depth = 1;
  for (let index = start; index < to; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}' && --depth === 0) return { start, end: index };
  }
  return null;
}
