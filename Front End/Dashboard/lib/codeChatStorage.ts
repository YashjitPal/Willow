const CODE_CHATS_KEY = 'willow_code_chats';

type CodeChatMap = Record<string, true>;

function readCodeChats(): CodeChatMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(CODE_CHATS_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeCodeChats(chats: CodeChatMap): void {
  localStorage.setItem(CODE_CHATS_KEY, JSON.stringify(chats));
  window.dispatchEvent(new Event('willow_code_chats_updated'));
}

export function isCodeChat(chatId: string): boolean {
  return readCodeChats()[chatId] === true;
}

export function markCodeChat(chatId: string): void {
  if (!chatId) return;
  const chats = readCodeChats();
  if (chats[chatId]) return;
  chats[chatId] = true;
  writeCodeChats(chats);
}

export function unmarkCodeChat(chatId: string): void {
  const chats = readCodeChats();
  if (!chats[chatId]) return;
  delete chats[chatId];
  writeCodeChats(chats);
}

export function renameCodeChat(oldChatId: string, newChatId: string): void {
  const chats = readCodeChats();
  if (!chats[oldChatId] || oldChatId === newChatId) return;
  delete chats[oldChatId];
  chats[newChatId] = true;
  writeCodeChats(chats);
}
