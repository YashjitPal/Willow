/**
 * A bot's failed turn as the user reads it (`features/spark/src/dots/dot-error.ts`): a provider's SDK error — tag, request
 * URL, status, JSON — comes down to a sentence saying whose it was and what to do, with the original kept as details;
 * the runtime's own note that it will try again stays on the end; the harness's own messages stay as they are.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { it } from 'node:test';
import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const { readableTurnError } = await importTs(path.join(repoRoot, 'features', 'spark', 'src', 'dots', 'dot-error.ts'));

const GEMINI_BAD_KEY = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse: [400 ] API key not valid. Please pass a valid API key. [{"@type":"type.googleapis.com/google.rpc.ErrorInfo","reason":"API_KEY_INVALID","domain":"googleapis.com","metadata":{"service":"generativelanguage.googleapis.com"}},{"@type":"type.googleapis.com/google.rpc.LocalizedMessage","locale":"en-US","message":"API key not valid. Please pass a valid API key."}]';

it('says in a sentence that the provider turned the key down, and keeps its own words as details', () => {
  assert.deepEqual(readableTurnError(GEMINI_BAD_KEY), {
    message: 'Gemini didn’t accept the API key. Check it in Settings › Models & API, or choose another model.',
    detail: GEMINI_BAD_KEY,
  });
  const anthropic = '401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011"}';
  assert.match(readableTurnError(anthropic).message, /^The model’s provider didn’t accept the API key\./);
});

it('keeps the runtime\'s note that it will try again, after what went wrong', () => {
  const limited = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse: [429 Too Many Requests] Resource has been exhausted (e.g. check quota). Trying again in 4 minutes.';
  const { message, detail } = readableTurnError(limited);
  assert.equal(message, 'Gemini is turning requests away for now: the account’s rate limit or quota is used up. Trying again in 4 minutes.');
  assert.ok(!detail.includes('Trying again'), 'the details are the provider\'s words alone');
  assert.equal(readableTurnError('529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}. Trying again in 1 minute.').message, 'The model’s provider is having trouble right now (error 529). Trying again in 1 minute.');
  assert.match(readableTurnError('503 {"error":{"message":"The service is unavailable"}}').message, /\(error 503\)\. Try again in a moment\.$/, 'with no try of its own coming, it says to try again');
});

it('names a model that is not there, a connection that is down, and anything else in the provider\'s own sentence', () => {
  assert.equal(readableTurnError('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-9-ultra:streamGenerateContent?alt=sse: [404 Not Found] models/gemini-9-ultra is not found for API version v1beta.').message, 'Gemini doesn’t offer the model “gemini-9-ultra”. Choose another model.');
  assert.equal(readableTurnError('TypeError: Failed to fetch').message, 'Couldn’t reach the model’s provider. Check the internet connection. Try again in a moment.');
  assert.equal(readableTurnError('[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse: [400 ] Request contains an invalid argument. [{"@type":"type.googleapis.com/google.rpc.BadRequest"}]').message, 'Gemini returned an error (400): Request contains an invalid argument.');
});

it('leaves the harness\'s own messages as they are, and never shows a key that rode in a URL', () => {
  assert.deepEqual(readableTurnError('No model is set up for bots yet.'), { message: 'No model is set up for bots yet.' });
  assert.deepEqual(readableTurnError('The turn failed.'), { message: 'The turn failed.' });
  const keyed = readableTurnError('Error fetching from https://relay.example.com/v1/chat?key=sk-secret-123: [500 ] Internal error');
  assert.ok(!keyed.detail.includes('sk-secret-123'));
  assert.match(keyed.detail, /key=…/);
});
