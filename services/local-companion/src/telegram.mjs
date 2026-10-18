/**
 * Telegram's Bot API for a bot's Telegram chat (`relay.telegram`). The API sends no CORS headers and refuses browsers,
 * so the window asks here. A relay for one host and the methods below only: never a general proxy. A picture or a file
 * the bot sends goes with its method as an upload, its params beside it.
 */
const TELEGRAM_METHODS = new Set(['getMe', 'getUpdates', 'sendMessage', 'sendChatAction', 'setMessageReaction', 'sendPhoto', 'sendDocument']);
// Telegram's own limits for a bot's upload: 10 MB for a photo, 50 MB for a file; Willow keeps files to 20.
const TELEGRAM_UPLOADS = { sendPhoto: { field: 'photo', max: 10 * 1024 * 1024 }, sendDocument: { field: 'document', max: 20 * 1024 * 1024 } };

/** The file an upload method carries, checked and as bytes: what is wrong with it, or the file. */
export const telegramUpload = (method, file) => {
  const upload = TELEGRAM_UPLOADS[method];
  if (!upload) return { problem: 'That Telegram request carries no file.' };
  const name = typeof file?.name === 'string' ? file.name.trim() : '';
  if (!name || name.length > 200 || /[\\/\0]/.test(name)) return { problem: 'The file needs a plain name.' };
  if (typeof file.data !== 'string' || !/^[A-Za-z0-9+/]*=*$/.test(file.data)) return { problem: `${name} has to come as base64.` };
  const bytes = Buffer.from(file.data, 'base64');
  if (bytes.length === 0 || bytes.length > upload.max) return { problem: `Telegram takes ${upload.field === 'photo' ? 'a photo' : 'a file'} of up to ${upload.max / 1024 / 1024} MB from Willow.` };
  return { field: upload.field, name, type: typeof file.mimeType === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) ? file.mimeType : 'application/octet-stream', bytes };
};

export async function relayTelegram(payload, { fetchImpl = (...args) => fetch(...args) } = {}) {
  const token = String(payload.token || '');
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('That is not a Telegram bot token.');
  const method = String(payload.method || '');
  if (!TELEGRAM_METHODS.has(method)) throw new Error('That Telegram request is not allowed.');
  const params = payload.params && typeof payload.params === 'object' ? { ...payload.params } : {};
  if (method === 'getUpdates') params.timeout = Math.min(Math.max(Number(params.timeout) || 0, 0), 25);
  let body = JSON.stringify(params);
  let headers = { 'content-type': 'application/json' };
  if (TELEGRAM_UPLOADS[method]) {
    const file = telegramUpload(method, payload.file);
    if (file.problem) throw new Error(file.problem);
    const form = new FormData();
    for (const [key, value] of Object.entries(params)) form.append(key, typeof value === 'string' ? value : JSON.stringify(value));
    form.append(file.field, new Blob([file.bytes], { type: file.type }), file.name);
    body = form;
    headers = {};
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ((params.timeout || 0) + (TELEGRAM_UPLOADS[method] ? 90 : 15)) * 1_000);
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}
