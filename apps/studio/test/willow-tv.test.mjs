// Willow TV (features/media/src/tv): Flow TV's UI fed by Willow's own projects. Every project with a
// finished video is a channel, every scene a short film; these pin how the library is built from
// storage, what each page tells the remote, the routes, and the stylesheet and icon fixes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const TV = path.join(REPO_ROOT, 'features/media/src/tv');
const lib = await importTs(path.join(TV, 'tv-library.ts'));
const props = await importTs(path.join(TV, 'tv-props.ts'));
const routes = await importTs(path.join(TV, 'tv-routes.ts'));
const motion = await importTs(path.join(TV, 'tv-motion.ts'));

const video = (id, extra = {}) => ({
  id,
  kind: 'video',
  status: 'completed',
  prompt: `prompt of ${id}`,
  modelName: 'Veo 3.1 Fast',
  modelId: 'veo-3.1-fast',
  ratio: '16:9',
  timestamp: 0,
  url: `data:video/mp4;base64,${id}`,
  ...extra,
});

const scene = (id, clips, extra = {}) => ({
  id,
  name: `Scene ${id}`,
  createdAt: 1,
  updatedAt: 1,
  aspectRatio: '16:9',
  clips: clips.map(([mediaId, trimStart, trimEnd], i) => ({ id: `${id}-c${i}`, mediaId, trimStart, trimEnd, sourceDuration: trimEnd })),
  ...extra,
});

const sources = (projects, { media = {}, scenes = {}, covers = {}, folders = {}, canReadDisk = false } = {}) => ({
  projects,
  canReadDisk,
  loadMedia: async (id) => media[id] ?? [],
  loadScenes: async (id) => scenes[id] ?? [],
  loadCover: async (id) => covers[id] ?? null,
  loadFolders: async (id) => folders[id] ?? {},
});

describe('Willow TV library', () => {
  test('a project with a finished video is a channel; one without is not', async () => {
    const library = await lib.loadTvLibrary(sources(
      [{ id: 'p1', name: 'Cat Videos' }, { id: 'p2', name: 'Empty' }, { id: 'p3', name: 'Stills' }],
      {
        media: {
          p1: [video('a', { timestamp: 2 }), video('b', { timestamp: 1 })],
          p2: [video('gen', { status: 'generating', url: undefined })],
          p3: [{ id: 'img', kind: 'image', status: 'completed', url: 'data:image/png;base64,x' }],
        },
      },
    ));
    assert.deepEqual(library.channels.map((c) => c.slug), ['cat-videos']);
    assert.deepEqual(library.channels[0].generations.map((g) => g.id), ['b', 'a'], 'clips oldest first, as a channel plays them');
  });

  test('characters, failed videos and dead blob URLs are not clips; disk files are when the folder can be read', async () => {
    const media = {
      p1: [
        video('portrait', { characterId: 'c1' }),
        video('failed', { status: 'failed' }),
        video('stale', { url: 'blob:http://localhost/123' }),
        video('disk', { url: 'blob:http://localhost/456', fsName: 'Disk.mp4', collectionId: 'col' }),
        video('ok'),
      ],
    };
    const offline = await lib.loadTvLibrary(sources([{ id: 'p1', name: 'P' }], { media }));
    assert.deepEqual(offline.channels[0].generations.map((g) => g.id), ['ok']);
    const online = await lib.loadTvLibrary(sources([{ id: 'p1', name: 'P' }], { media, canReadDisk: true, folders: { p1: { col: 'Trips/Beach' } } }));
    const disk = online.channels[0].generations.find((g) => g.id === 'disk');
    assert.ok(disk, 'a file in the project folder plays when the folder is readable');
    assert.deepEqual(disk.media, { id: 'disk', url: '', projectName: 'P', fsName: 'Disk.mp4', folder: 'Trips/Beach' });
  });

  test('slugs are unique, and never the search or short-film channels', async () => {
    const library = await lib.loadTvLibrary(sources(
      [{ id: 'a', name: 'Search' }, { id: 'b', name: 'Short Films' }, { id: 'c', name: 'Holiday' }, { id: 'd', name: 'Holiday' }],
      { media: { a: [video('1')], b: [video('2')], c: [video('3')], d: [video('4')] } },
    ));
    assert.deepEqual(library.channels.map((c) => c.slug).sort(), ['holiday', 'holiday-2', 'search-2', 'short-films-2']);
  });

  test('channels come newest first, by their latest clip', async () => {
    const library = await lib.loadTvLibrary(sources(
      [{ id: 'old', name: 'Old' }, { id: 'new', name: 'New' }],
      { media: { old: [video('o', { timestamp: 10 })], new: [video('n', { timestamp: 20 })] } },
    ));
    assert.deepEqual(library.channels.map((c) => c.name), ['New', 'Old']);
  });

  test('a scene is a short film of the clips whose videos the TV has; a trashed or empty one is not', async () => {
    const library = await lib.loadTvLibrary(sources(
      [{ id: 'p', name: 'P' }],
      {
        media: { p: [video('a'), video('b')] },
        scenes: {
          p: [
            scene('s1', [['a', 0, 4], ['gone', 0, 3], ['b', 1, 2.5]], { updatedAt: 5 }),
            scene('s2', [['gone', 0, 3]]),
            scene('s3', [['a', 0, 1]], { trashedAt: 9 }),
            scene('s4', [['b', 0, 2]], { updatedAt: 9 }),
          ],
        },
      },
    ));
    assert.deepEqual(library.shortFilms.map((f) => f.id), ['s4', 's1'], 'newest first');
    const s1 = library.shortFilms.find((f) => f.id === 's1');
    assert.deepEqual(s1.clips.map((c) => c.mediaId), ['a', 'b']);
    assert.equal(s1.duration, 5.5);
    assert.equal(s1.channelSlug, 'p');
  });

  test('the label above a prompt follows how the clip was made', () => {
    assert.equal(lib.genTypeOf({ modelId: 'veo' }), 'Text to Video');
    assert.equal(lib.genTypeOf({ modelId: 'veo', attachments: [{ id: 'i' }] }), 'Image to Video');
    assert.equal(lib.genTypeOf({ modelId: 'upload' }), 'Upload');
    assert.equal(lib.hasAudioOf({ modelName: 'Veo 2' }), false);
    assert.equal(lib.hasAudioOf({ modelName: 'Veo 3.1 Fast' }), true);
  });

  test('search matches every word of the prompt or channel name, within a model filter', async () => {
    const library = await lib.loadTvLibrary(sources(
      [{ id: 'p', name: 'Ocean Days' }],
      { media: { p: [video('w', { prompt: 'A whale breaching at dawn' }), video('g', { prompt: 'A gull at dawn', modelName: 'Veo 2' })] } },
    ));
    assert.deepEqual(lib.searchGenerations(library, 'dawn').map((g) => g.id), ['w', 'g']);
    assert.deepEqual(lib.searchGenerations(library, 'whale DAWN').map((g) => g.id), ['w']);
    assert.deepEqual(lib.searchGenerations(library, 'ocean gull').map((g) => g.id), ['g'], 'the channel name counts');
    assert.deepEqual(lib.searchGenerations(library, 'dawn', 'veo-2').map((g) => g.id), ['g']);
    assert.deepEqual(lib.searchGenerations(library, '   '), []);
    assert.deepEqual(lib.searchFilters(library).map((f) => f.label), ['All Videos', 'Veo 2', 'Veo 3.1 Fast (With Audio)']);
  });

  test('a channel name splits into Flow TV\'s two balanced lines', () => {
    assert.equal(lib.formatChannelName('Felt Cute'), 'Felt\nCute');
    assert.equal(lib.formatChannelName('Like No Ones Watching'), 'Like\u00a0No\nOnes\u00a0Watching');
    assert.equal(lib.formatChannelName('Choo-Choo Train'), 'Choo\u2011Choo\nTrain');
    assert.equal(lib.formatFilmLength(65.4), '1:05');
  });
});

describe('Willow TV remote props', () => {
  const build = () => lib.loadTvLibrary(sources(
    [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }],
    {
      media: {
        a: [video('a1', { timestamp: 30 }), video('a2', { timestamp: 31 })],
        b: [video('b1', { timestamp: 20 })],
        c: [video('c1', { timestamp: 10 })],
      },
      covers: { a: 'data:image/png;base64,A', b: 'blob:http://localhost/dead' },
      scenes: { a: [scene('f1', [['a1', 0, 2]], { updatedAt: 3 }), scene('f2', [['a2', 0, 4], ['a1', 0, 2]], { updatedAt: 2 })] },
    },
  ));

  test('channels sit in a ring, and a dead cover becomes the first clip\'s frame', async () => {
    const library = await build();
    const [a, b, c] = library.channels;
    const pa = props.channelPropsFor(library, a);
    assert.equal(pa.previousChannel.slug, 'c', 'before the first channel is the last');
    assert.equal(pa.nextChannel.slug, 'b');
    assert.equal(pa.nextChannel.generationId, 'b1');
    assert.equal(pa.firstGenerationId, 'a1');
    assert.equal(pa.lastGenerationId, 'a2');
    assert.equal(pa.thumb, 'data:image/png;base64,A');
    const pb = props.channelPropsFor(library, b);
    assert.equal(pb.thumb, null);
    assert.equal(pb.thumbMedia.id, 'b1');
    assert.equal(props.channelPropsFor(library, c).nextChannel.slug, 'a');
  });

  test('a lone channel has no neighbours', async () => {
    const library = await lib.loadTvLibrary(sources([{ id: 'x', name: 'X' }], { media: { x: [video('x1')] } }));
    const p = props.channelPropsFor(library, library.channels[0]);
    assert.equal(p.previousChannel, null);
    assert.equal(p.nextChannel, null);
  });

  test('a clip knows its neighbours in the channel; Mixing picks another channel', async () => {
    const library = await build();
    const a = library.channels[0];
    const g = props.generationPropsFor(library, a, a.generations[0], null);
    assert.equal(g.previousGenerationId, null);
    assert.equal(g.nextGenerationId, 'a2');
    assert.equal(g.description, 'prompt of a1');
    assert.equal(g.genType, 'Text to Video');
    for (let i = 0; i < 20; i += 1) {
      const next = props.nextRandomFor(library, a.generations[0]);
      assert.notEqual(next.slug, 'a', 'Mixing leaves the channel');
    }
    const lone = await lib.loadTvLibrary(sources([{ id: 'x', name: 'X' }], { media: { x: [video('x1'), video('x2')] } }));
    assert.deepEqual(props.nextRandomFor(lone, lone.channels[0].generations[0]), { slug: 'x', generationId: 'x2' });
  });

  test('a short film plays in the short-film channel, with its project as its author', async () => {
    const library = await build();
    const [f1, f2] = library.shortFilms;
    const ch = props.filmChannelProps(library, f2);
    assert.equal(ch.slug, routes.SHORT_FILMS_SLUG);
    assert.equal(ch.firstGenerationId, 'f1');
    const g = props.filmGenerationProps(library, f2);
    assert.equal(g.title, 'Scene f2');
    assert.equal(g.previousGenerationId, 'f1');
    assert.equal(g.nextGenerationId, null);
    assert.equal(g.description, '2 clips · 0:06');
    assert.equal(g.hasFullVideo, true);
    assert.equal(g.videoHasControls, true);
    assert.equal(g.createdBy, 'A');
    assert.equal(f1.clips.length, 1);
  });

  test('search results play as a channel named for the search', async () => {
    const library = await build();
    const results = lib.searchGenerations(library, 'prompt');
    const gen = results[1];
    const ch = props.searchChannelProps(library, results, gen, 'prompt');
    assert.equal(ch.slug, routes.SEARCH_SLUG);
    assert.equal(ch.name, 'prompt');
    const g = props.searchGenerationProps(library, results, gen);
    assert.equal(g.previousGenerationId, results[0].id);
    assert.equal(g.nextGenerationId, results[2].id);
    assert.equal(g.parentSlug, gen.channelSlug, 'shared links point at the clip\'s own channel');
  });
});

describe('Willow TV routes', () => {
  test('paths parse to Flow TV\'s pages under /tv', () => {
    assert.deepEqual(routes.parseTvPath('/tv'), { kind: 'home' });
    assert.deepEqual(routes.parseTvPath('/tv/'), { kind: 'home' });
    assert.deepEqual(routes.parseTvPath('/tv/channels'), { kind: 'channels' });
    assert.deepEqual(routes.parseTvPath('/tv/short-films'), { kind: 'short-films' });
    assert.deepEqual(routes.parseTvPath('/tv/faq'), { kind: 'faq' });
    assert.deepEqual(routes.parseTvPath('/tv/search'), { kind: 'search' });
    assert.deepEqual(routes.parseTvPath('/tv/channel/cat-videos'), { kind: 'grid', slug: 'cat-videos' });
    assert.deepEqual(routes.parseTvPath('/tv/channel/cat-videos/m%201'), { kind: 'clip', slug: 'cat-videos', id: 'm 1' });
    assert.deepEqual(routes.parseTvPath('/tv/nope/x/y/z'), { kind: 'not-found' });
  });

  test('links carry Flow TV\'s query parameters', () => {
    assert.equal(routes.tvClipPath('cats', 'm1'), '/tv/channel/cats/m1');
    assert.equal(routes.tvClipPath('cats', 'm1', { random: true }), '/tv/channel/cats/m1?random=true');
    assert.equal(routes.tvClipPath('cats', 'm1', { randomGeneration: true }), '/tv/channel/cats/m1?random-generation=true');
    assert.equal(routes.tvClipPath('search', 'm1', { query: 'a cat', filter: 'veo-2' }), '/tv/channel/search/m1?q=a+cat&filter=veo-2');
    assert.equal(routes.tvSearchPath('a cat', 'all'), '/tv/search?q=a+cat');
    assert.equal(routes.tvShortFilmsPath('s1'), '/tv/short-films?i=s1');
  });
});

describe('Willow TV motion', () => {
  test('Flow TV\'s easings start at 0, end at 1, and never go back', () => {
    for (const ease of [motion.EASE_OUT, motion.EASE_IN_OUT_1, motion.EASE_IN_OUT_2]) {
      assert.equal(ease(0), 0);
      assert.equal(ease(1), 1);
      let last = 0;
      for (let t = 0.05; t < 1; t += 0.05) {
        const v = ease(t);
        assert.ok(v >= last - 1e-9, `monotonic at ${t}`);
        last = v;
      }
    }
    assert.ok(motion.EASE_OUT(0.5) > 0.85, 'ease-out is most of the way at half time');
  });
});

describe('Willow TV stylesheet and icons', () => {
  const css = fs.readFileSync(path.join(TV, 'willow-tv.css'), 'utf8');

  test('Flow TV\'s two `controls` modules and two `grid` modules stay apart in the port', () => {
    const rules = (cls) => css.split(/\r?\n/).filter((l) => l.includes(`${cls} {`) || l.includes(`${cls}[`));
    assert.ok(rules('.wtv-video-controls__container').some((l) => l.includes('margin-bottom: 20px')), 'the scrub bar keeps its own layout');
    assert.ok(!rules('.wtv-controls__container').some((l) => l.includes('margin-bottom')), 'the remote\'s buttons do not get the scrub bar\'s');
    assert.ok(rules('.wtv-channel-grid__container').some((l) => l.includes('aspect-ratio: 16 / 9')));
    assert.ok(!rules('.wtv-channels-grid__container').some((l) => l.includes('aspect-ratio')));
  });

  test('page-wide rules only reach inside Willow TV\'s root', () => {
    for (const line of css.split(/\r?\n/)) {
      const sel = line.trim().split('{')[0];
      if (!sel || sel.startsWith('@') || sel.startsWith('}') || sel.startsWith('/*') || sel.startsWith('*')) continue;
      if (/^(html|body|:root|button|a|p|h1|ul|ol|dialog|input)\b/.test(sel)) assert.fail(`unscoped rule: ${sel}`);
    }
  });

  test('the subset scripts always ask for the two-letter `tv` glyph the harvest skips', () => {
    for (const file of [
      'tools/scratch/symbols-subset-headless.cjs',
      'tools/ui-research/scrapers/flow/media/symbols-subset-3101.cjs',
      'tools/ui-research/scrapers/flow/54-symbols-subset.cjs',
    ]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.match(src, /SHORT_NAMES = \['tv'\]/, file);
      assert.match(src, /\.\.\.SHORT_NAMES/, file);
    }
  });

  test('both of Media\'s Willow TV menu items open Willow TV', () => {
    for (const file of ['features/media/src/HeaderMenus.tsx', 'features/media/src/scenes/SceneBuilder.tsx']) {
      const src = fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');
      assert.match(src, /label: 'Willow TV', onSelect: openWillowTv/, file);
    }
  });
});
