import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const loadErrors = () => importTs(path.join(root, 'features/chat/src/chat-errors.ts'));

describe('friendly upstream error handling', () => {
  it('uses the original attempt plus exactly five retries', async () => {
    const { MAX_UPSTREAM_RETRIES, UPSTREAM_RETRY_DELAYS_MS } = await loadErrors();
    assert.equal(MAX_UPSTREAM_RETRIES, 5);
    assert.equal(UPSTREAM_RETRY_DELAYS_MS.length, 5);

    const runner = read('features', 'chat', 'src', 'chat-turn-runner.ts');
    assert.match(runner, /retry <= MAX_UPSTREAM_RETRIES/);
    assert.match(runner, /retry === MAX_UPSTREAM_RETRIES/);
    assert.match(runner, /waitForRetry\(UPSTREAM_RETRY_DELAYS_MS\[retry\]\)/);
  });

  it('randomizes four friendly messages without immediately repeating one', async () => {
    const { FRIENDLY_CHAT_ERROR_MESSAGES, friendlyChatErrorFor } = await loadErrors();
    assert.equal(FRIENDLY_CHAT_ERROR_MESSAGES.length, 4);
    assert.equal(
      friendlyChatErrorFor([], () => 0),
      'Something went wrong. Please try sending the message again.',
    );
    assert.equal(
      friendlyChatErrorFor([
        { role: 'assistant', isError: true, content: FRIENDLY_CHAT_ERROR_MESSAGES[0] },
      ], () => 0),
      "Sorry, I couldn't help with that. Could you try editing the prompt and sending it again?",
    );
    assert.equal(
      friendlyChatErrorFor([], () => 0.999999),
      FRIENDLY_CHAT_ERROR_MESSAGES[3],
    );
    assert.equal(
      friendlyChatErrorFor([{ role: 'assistant', isError: false }], () => 0),
      FRIENDLY_CHAT_ERROR_MESSAGES[0],
    );
  });

  it('keeps the final provider status and message for the opt-in dialog', async () => {
    const { formatUpstreamError } = await loadErrors();
    assert.equal(
      formatUpstreamError({ status: 429, message: 'Quota exceeded' }),
      'Error code: 429\nQuota exceeded',
    );
  });

  it('never puts the raw upstream error into the assistant response or saved chat', () => {
    const runner = read('features', 'chat', 'src', 'chat-turn-runner.ts');
    const message = read('features', 'chat', 'src', 'chat-message.ts');

    assert.doesNotMatch(runner, /finalContent\s*=\s*`Something went wrong:\s*\$\{/);
    assert.match(runner, /record\.errorDetail = formatUpstreamError\(error\)/);
    assert.match(runner, /record\.finalContent = friendlyChatErrorFor\(record\.historyBefore\)/);
    assert.match(message, /errorDetail: _errorDetail/);
    assert.match(message, /'errorDetail'/);
  });

  it('shows the snackbar action and the Gemini dialog with Copy and Close', () => {
    const chat = read('features', 'chat', 'src', 'ChatView.tsx');

    assert.match(chat, /showCopyToast\('Something went wrong', \{/);
    assert.match(chat, /label: 'Show error'/);
    assert.match(chat, /onClick: \(\) => openErrorDialog\(detail\)/);
    assert.match(chat, /title="Something went wrong"/);
    assert.match(chat, /<GeminiDialogPill[\s\S]{0,260}>\s*Copy\s*<\/GeminiDialogPill>/);
    assert.match(chat, /<GeminiDialogPill onClick=\{closeErrorDialog\}>Close<\/GeminiDialogPill>/);
    assert.match(chat, /navigator\.clipboard\.writeText\(errorDialog\.detail\)/);
  });

  it('offers failed responses in thinking steps and displays their final error', () => {
    const chat = read('features', 'chat', 'src', 'ChatView.tsx');
    const chrome = read('features', 'chat', 'src', 'ChatResponseChrome.tsx');

    assert.match(chat, /canShowThinking=\{!msg\.isError \|\| !!msg\.errorDetail\}/);
    assert.match(chat, /thinkingMessage\.isError\s*\? thinkingMessage\.errorDetail/);
    assert.match(chat, /isError=\{!!thinkingMessage\.isError\}/);
    assert.match(chrome, /isError\?: boolean/);
    assert.match(chrome, /name=\{isError \? 'close' : 'check'\}/);
    assert.match(chrome, /\{isError \? 'Error' : 'Done'\}/);
    assert.match(chrome, /overflowWrap: 'anywhere'/);
  });
});
