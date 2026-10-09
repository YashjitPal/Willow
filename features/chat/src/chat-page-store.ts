import { atom } from 'nanostores';

/**
 * Gemini's creation pages, opened from its sidebar: `/images` (a page of its own — a hero, the
 * composer and a template carousel) and `/videos` (the video tool's gallery). Both are a new
 * chat with the tool picked; the first message turns either into the chat's own address.
 */
export type ChatCreationPage = 'images' | 'videos';

/**
 * The creation page the new chat is on, or null. Written by ChatView; read by the shell, whose
 * sidebar lights Images or Videos instead of New chat and whose address shows the page's.
 */
export const $chatCreationPage = atom<ChatCreationPage | null>(null);

/**
 * A creation page the shell asks for: the sidebar's rows, or an address opened at one. ChatView
 * takes it once the chat on show is a new one, picks the page's tool, and clears it. `none` is
 * New chat pressed on a page: the tool comes off and the page ends.
 */
export const $chatCreationPageRequest = atom<ChatCreationPage | 'none' | null>(null);

export const creationPageTool = (page: ChatCreationPage): 'images' | 'video' => (page === 'images' ? 'images' : 'video');
