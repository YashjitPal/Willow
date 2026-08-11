/**
 * The automatic model choice for background jobs.
 *
 * Worth running rather than reading, because every rule here is a comparison
 * between strings that look alike: `gemini-3.5-flash-lite` has to beat
 * `gemini-3.6-flash` (cheaper tier wins over newer), and
 * `claude-haiku-4-5-20251001` has to parse as 4.5 rather than as a number with
 * a release date glued to the end.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';

import { importTs } from './ts-module.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

const module = await importTs(
  path.join(REPO_ROOT, 'platform/ai/src/models/auto-select.ts'),
);
const { AUTO_MODEL, pickAutoModel, resolveAutoModel } = module;

const saved = (...modelIds) => modelIds.map((modelId) => ({ modelId, name: modelId }));
const allKeys = () => true;
const keysFor = (...providers) => (provider) => providers.includes(provider);

test('prefers the cheaper tier over the newer version', () => {
  const pick = pickAutoModel(saved('gemini-3.6-flash', 'gemini-3.5-flash-lite'), allKeys);
  assert.equal(pick.modelId, 'gemini-3.5-flash-lite');
});

test('prefers the newest version within one tier', () => {
  const pick = pickAutoModel(
    saved('gemini-2.5-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'),
    allKeys,
  );
  assert.equal(pick.modelId, 'gemini-3.5-flash-lite');
});

test('walks down the family list when the cheap tiers are absent', () => {
  assert.equal(
    pickAutoModel(saved('gemini-3.1-pro-preview', 'gemini-3.6-flash'), allKeys).modelId,
    'gemini-3.6-flash',
  );
  assert.equal(
    pickAutoModel(saved('gemini-3.1-pro-preview'), allKeys).modelId,
    'gemini-3.1-pro-preview',
  );
});

test('reads Anthropic dated ids as a version, not as the date', () => {
  const pick = pickAutoModel(
    saved('claude-haiku-4-5-20251001', 'claude-haiku-3-5-20241022'),
    keysFor('anthropic'),
  );
  assert.equal(pick.modelId, 'claude-haiku-4-5-20251001');
});

test('orders each provider by its own family names', () => {
  assert.equal(
    pickAutoModel(saved('claude-opus-5', 'claude-sonnet-4.5'), keysFor('anthropic')).modelId,
    'claude-sonnet-4.5',
  );
  assert.equal(
    pickAutoModel(saved('claude-fable-5', 'claude-opus-5'), keysFor('anthropic')).modelId,
    'claude-opus-5',
  );
  assert.equal(
    pickAutoModel(saved('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'), keysFor('openai')).modelId,
    'gpt-5.6-luna',
  );
});

test('a cheap tier from a dearer provider still beats a large local tier', () => {
  const pick = pickAutoModel(
    saved('gemini-3.1-pro-preview', 'claude-haiku-4-5-20251001'),
    allKeys,
  );
  assert.equal(pick.modelId, 'claude-haiku-4-5-20251001');
});

test('breaks a same-tier tie on provider price', () => {
  const pick = pickAutoModel(
    saved('claude-haiku-4-5-20251001', 'gpt-5.6-luna', 'gemini-3.5-flash-lite'),
    allKeys,
  );
  assert.equal(pick.modelId, 'gemini-3.5-flash-lite');
});

test('ignores models the user holds no key for', () => {
  const pick = pickAutoModel(
    saved('gemini-3.5-flash-lite', 'claude-haiku-4-5-20251001'),
    keysFor('anthropic'),
  );
  assert.equal(pick.modelId, 'claude-haiku-4-5-20251001');
});

test('ignores models that cannot do the job', () => {
  assert.equal(pickAutoModel(saved('gemini-3.1-flash-image', 'nano-banana-pro'), allKeys), null);
  assert.equal(
    pickAutoModel(saved('gemini-3.1-flash-image', 'gemini-3.6-flash'), allKeys).modelId,
    'gemini-3.6-flash',
  );
});

test('ignores providers nothing can send a request to', () => {
  assert.equal(pickAutoModel(saved('kimi-k2-thinking', 'grok-4', 'glm-4.6'), allKeys), null);
});

test('returns null rather than guessing when there is nothing to pick', () => {
  assert.equal(pickAutoModel([], allKeys), null);
  assert.equal(pickAutoModel(saved('gemini-3.5-flash-lite'), keysFor('anthropic')), null);
});

test('a pinned model wins over the automatic pick', () => {
  const models = saved('gemini-3.5-flash-lite', 'gemini-3.1-pro-preview');
  assert.equal(
    resolveAutoModel('gemini-3.1-pro-preview', models, allKeys).modelId,
    'gemini-3.1-pro-preview',
  );
});

test('automatic, empty and stale pins all route themselves', () => {
  const models = saved('gemini-3.5-flash-lite', 'claude-haiku-4-5-20251001');
  assert.equal(resolveAutoModel(AUTO_MODEL, models, allKeys).modelId, 'gemini-3.5-flash-lite');
  assert.equal(resolveAutoModel(undefined, models, allKeys).modelId, 'gemini-3.5-flash-lite');
  // Pinned to a provider whose key has since been removed: route, do not stop.
  assert.equal(
    resolveAutoModel('claude-haiku-4-5-20251001', models, keysFor('gemini')).modelId,
    'gemini-3.5-flash-lite',
  );
});
