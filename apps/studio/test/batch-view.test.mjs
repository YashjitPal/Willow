/**
 * Media's batch view (View settings > View mode > Batch), against Flow's own numbers.
 *
 * Measured in Flow at a 1536px window (tools/ui-research/captures/flow/media/batch/): its batch
 * is 1256px wide, so the tiles column is 824px at S and M (beside a 25rem info column) and 968px
 * at L (beside 16rem). Rows are not justified — one height per batch, from its first tile — and
 * at L a tile alone in its row grows. These pin the rules that reproduce every box measured there.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const layout = await importTs(path.join(REPO_ROOT, 'features/media/src/batch/batch-layout.ts'));

const tile = (id, ratio) => ({ id, ratio });
const aspect = (t) => layout.ratioValue(t.ratio);
const sizes = (rows) => rows.map((r) => r.tiles.map((t) => `${+(aspect(t) * r.height).toFixed(1)}x${+r.height.toFixed(1)}`).join(' '));

test('the info column is 25rem from 1280px wide, 16rem below that and at grid size L', () => {
  assert.equal(layout.batchInfoWidth(1536, 'S'), 400);
  assert.equal(layout.batchInfoWidth(1536, 'M'), 400);
  assert.equal(layout.batchInfoWidth(1536, 'L'), 256);
  assert.equal(layout.batchInfoWidth(1279, 'M'), 256);
  assert.equal(layout.batchTilesWidth(1256, 1536, 'M'), 824);
  assert.equal(layout.batchTilesWidth(1256, 1536, 'L'), 968);
  assert.equal(layout.batchTilesWidth(2000, 1920, 'M'), 1540 - 32 - 400, 'a batch is at most 96.25rem wide');
  assert.equal(layout.batchTilesWidth(390, 390, 'M'), 390, 'on a phone the info sits under the tiles');
});

test('Flow\'s rows at S, M and L for three 16:9 images, a square and a scene', () => {
  const stars = [tile('a', '16:9'), tile('b', '16:9'), tile('c', '16:9')];
  assert.deepEqual(sizes(layout.layoutBatchRows(stars, 824, 'S', aspect)), ['194x109.1 194x109.1 194x109.1']);
  assert.deepEqual(sizes(layout.layoutBatchRows(stars, 824, 'M', aspect)), ['404x227.3 404x227.3', '404x227.3']);
  assert.deepEqual(sizes(layout.layoutBatchRows(stars, 968, 'L', aspect)), ['476x267.8 476x267.8', '968x544.5']);
  const square = [tile('col', '1:1')];
  assert.deepEqual(sizes(layout.layoutBatchRows(square, 824, 'S', aspect)), ['194x194']);
  assert.deepEqual(sizes(layout.layoutBatchRows(square, 824, 'M', aspect)), ['404x404']);
  assert.deepEqual(sizes(layout.layoutBatchRows(square, 968, 'L', aspect)), ['714x714']);
  assert.deepEqual(sizes(layout.layoutBatchRows([tile('scene', '16:9')], 968, 'L', aspect)), ['968x544.5']);
});

test('portrait batches fit four to a row (six at S); below 500px every size is L', () => {
  const tall = [tile('a', '9:16'), tile('b', '9:16'), tile('c', '9:16'), tile('d', '9:16'), tile('e', '9:16')];
  assert.deepEqual(layout.layoutBatchRows(tall, 824, 'M', aspect).map((r) => r.tiles.length), [4, 1]);
  assert.deepEqual(layout.layoutBatchRows(tall, 824, 'S', aspect).map((r) => r.tiles.length), [5]);
  const lone = layout.layoutBatchRows([tile('x', '1:1')], 400, 'S', aspect);
  assert.equal(+lone[0].height.toFixed(1), +(((400 - 16) / 2) * 1.5).toFixed(1));
  assert.equal(layout.batchHeight(layout.layoutBatchRows(tall, 824, 'M', aspect)), 2 * layout.layoutBatchRows(tall, 824, 'M', aspect)[0].height + 16);
});

test('batches keep the order of their first tile', () => {
  const grouped = layout.groupBatches(['a1', 'b1', 'a2', 'c1', 'b2'], (id) => id[0]);
  assert.deepEqual(grouped.map((b) => [b.key, b.tiles]), [['a', ['a1', 'a2']], ['b', ['b1', 'b2']], ['c', ['c1']]]);
});

test('one prompt\'s outputs are one batch even without a batchId', () => {
  const gen = (id, timestamp, extra = {}) => ({ id, kind: 'image', modelId: 'nano', ratio: '16:9', prompt: 'stars and dogs', timestamp, ...extra });
  const keys = layout.legacyBatchKeys([
    gen('s1', 1_000_000), gen('s2', 999_999), gen('s3', 999_998),
    gen('t1', 999_997, { prompt: 'other' }),
    gen('s4', 999_990),
    gen('later', 1_000_000 - layout.LEGACY_BATCH_GAP_MS - 1000),
    gen('n1', 2_000_000, { batchId: 'batch-x' }),
    gen('up1', 3_000_000, { modelId: 'upload', prompt: 'photo' }),
    gen('up2', 3_000_001, { modelId: 'upload', prompt: 'photo' }),
  ]);
  assert.equal(keys.get('s1'), keys.get('s2'));
  assert.equal(keys.get('s2'), keys.get('s3'));
  assert.equal(keys.get('s3'), keys.get('s4'), 'an unrelated item in between does not split the batch');
  assert.notEqual(keys.get('t1'), keys.get('s1'));
  assert.notEqual(keys.get('later'), keys.get('s4'), 'the same prompt a minute later is another submission');
  assert.equal(keys.has('n1'), false, 'items with a batchId need no guess');
  assert.equal(keys.has('up1') || keys.has('up2'), false, 'uploads are each a batch of their own');
});

test('files adopted back from the folder group by their shared name (a real project\'s times)', () => {
  // "cute army.mp4", "(1)", "(2)", "(3)" and "ohh.png" x3, as the reconcile brings them back.
  const file = (id, kind, prompt, timestamp) => ({ id, kind, prompt, timestamp, modelId: 'external', ratio: '16:9' });
  const keys = layout.legacyBatchKeys([
    file('image1', 'image', 'image', 1790946321700),
    file('frame', 'image', 'Saved frame from Untitled Scene 10-01 182353', 1790910773752),
    file('army3', 'video', 'cute army', 1790879023848),
    file('army2', 'video', 'cute army', 1790879023527),
    file('army1', 'video', 'cute army', 1790879023054),
    file('army0', 'video', 'cute army', 1790879022245),
    file('ohh3', 'image', 'ohh', 1790878660455),
    file('ohh2', 'image', 'ohh', 1790878660177),
    file('ohh1', 'image', 'ohh', 1790878659218),
    file('image0', 'image', 'image', 1790763701240),
  ]);
  const army = new Set(['army0', 'army1', 'army2', 'army3'].map((id) => keys.get(id)));
  const ohh = new Set(['ohh1', 'ohh2', 'ohh3'].map((id) => keys.get(id)));
  assert.equal(army.size, 1);
  assert.equal(ohh.size, 1);
  assert.notEqual([...army][0], [...ohh][0]);
  assert.notEqual(keys.get('image1'), keys.get('image0'), 'the same name a day apart is two uploads');
});

test('the metadata reads as Flow writes it', () => {
  assert.deepEqual(layout.aspectLabel('16:9'), { label: '16:9', icon: 'crop_16_9' });
  assert.deepEqual(layout.aspectLabel('9:16'), { label: '9:16', icon: 'crop_9_16' });
  assert.deepEqual(layout.aspectLabel('1:1'), { label: '1:1', icon: 'crop_square' });
  assert.deepEqual(layout.aspectLabel('4:3'), { label: '4:3', icon: 'crop_landscape' });
  assert.deepEqual(layout.aspectLabel('3:4'), { label: '3:4', icon: 'crop_portrait' });
  assert.deepEqual(layout.aspectLabel('21:9'), { label: '21:9', icon: 'crop_free' });
  assert.equal(layout.formatDuration(8.04), '8s');
  assert.equal(layout.formatDuration(75.4), '75s');
  assert.equal(layout.resolutionLabel(1280, 720), '720p');
  assert.equal(layout.resolutionLabel(1920, 1080), '1080p');
  assert.equal(layout.resolutionLabel(3840, 2160), '4K');
  assert.equal(layout.resolutionLabel(640, 360), '360p');
  assert.equal(layout.createdLabel(Date.UTC(2026, 9, 2, 12)), 'Created Oct 2, 2026');
  assert.equal(layout.isGenerated({ modelId: 'upload', prompt: 'x' }), false);
  assert.equal(layout.isGenerated({ modelId: 'veo', prompt: 'a cat' }), true);
});
