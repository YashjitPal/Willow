import assert from 'node:assert/strict';
import { it } from 'node:test';
import { relayTelegram } from '../src/telegram.mjs';

// A made-up bot token, joined at run time so secret scanners don't take the source for a real one.
const TOKEN = ['123456789', 'AAH-abcdefghijklmnopqrstuvwxyz01234'].join(':');

const answer = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

it('relays its own methods as JSON, a picture or a file as an upload, and nothing else', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return answer({ ok: true });
  };
  await relayTelegram({ token: TOKEN, method: 'sendMessage', params: { chat_id: 5, text: 'hi' } }, { fetchImpl });
  assert.equal(calls[0].url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { chat_id: 5, text: 'hi' });

  await relayTelegram({ token: TOKEN, method: 'sendPhoto', params: { chat_id: 5, caption: 'Your screen' }, file: { name: 'shot.jpg', mimeType: 'image/jpeg', data: Buffer.from('JPEG').toString('base64') } }, { fetchImpl });
  const form = calls[1].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('chat_id'), '5');
  assert.equal(form.get('caption'), 'Your screen');
  assert.equal(form.get('photo').name, 'shot.jpg');
  assert.equal(Buffer.from(await form.get('photo').arrayBuffer()).toString(), 'JPEG');

  await relayTelegram({ token: TOKEN, method: 'sendDocument', params: { chat_id: 5 }, file: { name: 'report.pdf', mimeType: 'application/pdf', data: Buffer.from('PDF').toString('base64') } }, { fetchImpl });
  assert.equal(calls[2].init.body.get('document').name, 'report.pdf');

  await assert.rejects(relayTelegram({ token: TOKEN, method: 'sendPhoto', params: { chat_id: 5 }, file: { name: 'huge.jpg', data: Buffer.alloc(11 * 1024 * 1024).toString('base64') } }, { fetchImpl }), /up to 10 MB/);
  await assert.rejects(relayTelegram({ token: TOKEN, method: 'sendPhoto', params: { chat_id: 5 } }, { fetchImpl }), /plain name/);
  await assert.rejects(relayTelegram({ token: TOKEN, method: 'deleteWebhook', params: {} }, { fetchImpl }), /not allowed/);
  await assert.rejects(relayTelegram({ token: 'nope', method: 'sendMessage', params: {} }, { fetchImpl }), /not a Telegram bot token/);
  assert.equal(calls.length, 3, 'nothing refused reached Telegram');
});
