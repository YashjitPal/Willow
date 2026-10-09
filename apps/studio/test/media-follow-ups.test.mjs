/**
 * Two things about a chat's generated images:
 *  - A follow-up that changes the last one ("make it cuter") sends no attachment, so the image
 *    model used to get nothing to edit. The chat model now marks such a call
 *    (`use_previous_image`), the newest image in the thread goes to the generator, and the
 *    history tells the model what it made earlier, so "it" means something.
 *  - Text written after an image call shows under the image, and text written before it above,
 *    as with a Canvas card. Videos and tracks keep their text above them, as Gemini's do.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { importTs } from './ts-module.mjs';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const { isThreadImage, newestThreadImage } = await importTs(path.join(ROOT, 'features/chat/src/media/previous-image.ts'));
const { mediaContext } = await importTs(path.join(ROOT, 'features/chat/src/chat-history.ts'));
const tools = await importTs(path.join(ROOT, 'features/chat/src/media/media-tools.ts'));

const image = (id) => ({ id, name: `${id}.png`, mimeType: 'image/png', kind: 'image', size: 10 });
const made = (id, extra = {}) => ({ id: `m-${id}`, kind: 'image', status: 'done', prompt: `a ${id}`, index: 0, attachment: image(id), createdAt: 0, ...extra });

describe('"make it cuter"', () => {
  it('means the newest image in the thread, whoever made it', () => {
    assert.equal(newestThreadImage([]), null);
    const thread = [
      { id: 'u1', role: 'user', content: 'a cat please', attachments: [image('upload')] },
      { id: 'a1', role: 'assistant', content: '', media: [made('cat'), made('cat-2')] },
      { id: 'u2', role: 'user', content: 'make it cuter' },
    ];
    assert.equal(newestThreadImage(thread).id, 'cat-2', 'the last image of the newest reply that made one');
    thread.push({ id: 'u3', role: 'user', content: 'use this one', attachments: [image('mine')] });
    assert.equal(newestThreadImage(thread).id, 'mine', 'an image the user sent later is newer');
    const failed = [{ id: 'a', role: 'assistant', content: '', media: [made('broken', { status: 'error', attachment: undefined })] }];
    assert.equal(newestThreadImage(failed), null, 'one that never finished is not an image to edit');
    const video = [{ id: 'a', role: 'assistant', content: '', media: [made('clip', { kind: 'video' })] }];
    assert.equal(newestThreadImage(video), null);
  });

  it('is not added to an edit of an image from the thread', () => {
    const thread = [
      { id: 'a1', role: 'assistant', content: '', media: [made('old-cat')] },
      { id: 'a2', role: 'assistant', content: '', media: [made('new-cat')] },
    ];
    assert.equal(isThreadImage(thread, 'old-cat'), true, "the image card's Edit attaches the image it is on");
    assert.equal(isThreadImage(thread, 'hat-photo'), false, 'a new upload goes along with the newest image');
    assert.match(
      read('features/chat/src/ChatView.tsx'),
      /if \(preparedAttachments\.some\(\(attachment\) => isThreadImage\(prevMessages, attachment\.id\)\)\) return null;\s*const image = newestThreadImage\(prevMessages\);/,
      'editing an older image must not blend the newest one into it',
    );
  });

  it('tells the model what it made on earlier turns', () => {
    assert.equal(mediaContext({ id: 'u', role: 'user', content: 'hi' }), '');
    assert.equal(
      mediaContext({ id: 'a', role: 'assistant', content: '', media: [made('cat'), made('song', { kind: 'music', title: 'Purr' })] }),
      '\n\n[You made an image here, from the prompt: a cat]\n\n[You made a music track titled "Purr" here, from the prompt: a song]',
    );
    assert.match(mediaContext({ id: 'a', role: 'assistant', content: '', media: [made('x', { status: 'error' })] }), /\[An image you started here did not finish\.\]/);
    assert.match(read('features/chat/src/chat-history.ts'), /let content = message\.content \+ researchContext\(message\) \+ mediaContext\(message\);/);
  });

  it('lets the model say a call changes or animates that image', () => {
    const [{ functionDeclarations }] = tools.mediaChatTools('auto');
    const byName = Object.fromEntries(functionDeclarations.map((declaration) => [declaration.name, declaration]));
    assert.equal(byName.generate_image.parameters.properties.use_previous_image.type, 'BOOLEAN');
    assert.equal(byName.generate_video.parameters.properties.use_previous_image.type, 'BOOLEAN');
    assert.equal('use_previous_image' in byName.generate_music.parameters.properties, false);
    assert.match(tools.mediaInstructions('auto'), /set use_previous_image to true, and write the prompt for the whole new image/);
    assert.match(tools.mediaInstructions('image', {}), /set use_previous_image to true/);
  });

  it('passes the call on to the generator, never for music', async () => {
    const asked = [];
    const run = tools.createMediaToolExecutor({
      options: {},
      generate: async (kind, request) => { asked.push([kind, request.usePreviousImage]); return { attachment: image('out') }; },
      contentLength: () => 0,
      publish: () => {},
      update: () => {},
      signal: new AbortController().signal,
    });
    await run('generate_image', { prompt: 'a cuter cat', use_previous_image: true });
    await run('generate_image', { prompt: 'a dog' });
    await run('generate_video', { prompt: 'the cat waves', use_previous_image: 'true' });
    await run('generate_music', { prompt: 'a purr', title: 'Purr', use_previous_image: true });
    assert.deepEqual(asked, [['image', true], ['image', false], ['video', true], ['music', false]]);
  });

  it('hands the generator that image, read only when a call asks for it', () => {
    const host = read('features/chat/src/media/media-host.ts');
    assert.match(host, /const previous = request\.usePreviousImage && previousImage \? await previousImage\(\) : null;/);
    assert.match(host, /images: previous \? \[previous, \.\.\.inputImages\] : inputImages,/);
    assert.match(host, /image: inputImages\[0\] \?\? previous \?\? undefined,/, "an attached still wins a video's first frame");
    const view = read('features/chat/src/ChatView.tsx');
    assert.match(view, /const image = newestThreadImage\(prevMessages\);/);
    assert.match(view, /mediaPreviousImage,\s*researchQuery: trimmed,/);
    assert.match(read('features/chat/src/chat-turn-setup.ts'), /previousImage: mediaPreviousImage,/);
  });
});

describe('text written after an image', () => {
  const view = read('features/chat/src/ChatView.tsx');

  it('goes under the image; text written before it stays above', () => {
    assert.match(view, /if \(item\.kind !== 'image' \|\| !bodyText\) continue;\s*const at = canvasSplitOffset\(bodyText, item\.index\);\s*if \(!bodyText\.slice\(at\)\.trim\(\)\) continue;/,
      'an image with text after it splits the reply where its call ran');
    assert.match(view, /\.\.\.inlineMedia\.map\(\(group\): Cut => \(\{ media: group\.items, at: group\.at \}\)\),/);
    assert.match(view, /if \(cut\.media !== undefined\) \{[\s\S]*?\{cut\.media\.map\(mediaCard\)\}/);
    assert.match(view, /underImage \? <div key=\{`body-\$\{start\}`\} style=\{\{ marginTop: 16 \}\}>\{body\}<\/div> : body,/);
  });

  it('does not zoom the image in again when the text under it starts', () => {
    const card = read('features/chat/src/media/GeneratedImage.tsx');
    assert.match(card, /const \[shown\] = useState\(\(\) => !!url && shownImages\.has\(url\)\);\s*const \[loaded, setLoaded\] = useState\(shown\);/,
      'moving into the reply mounts the image again, and an image already on screen is loaded');
    assert.match(card, /className=\{`gm-image__img\$\{loaded \? \(shown \? ' is-shown' : ' is-loaded'\) : ''\}`\}/);
    assert.match(card, /onLoad=\{\(\) => \{ setLoaded\(true\); shownImages\.add\(url\); \}\}/);
    assert.match(read('features/chat/src/media/media.css'), /\.gm-image__img\.is-shown \{\s*opacity: 1;\s*\}/);
  });

  it('keeps an image at the end of the reply, and every video and track, after the text', () => {
    assert.match(view, /const trailingMedia = \(msg\.media \?\? \[\]\)\.filter\(\(item\) => !inlineMedia\.some\(\(group\) => group\.items\.includes\(item\)\)\);/);
    assert.match(view, /\{trailingMedia\.length > 0 && \(/);
    assert.match(view, /\{trailingMedia\.map\(mediaCard\)\}/);
    assert.match(read('features/chat/src/media/media-tools.ts'), /image: 'The image was created and is on screen; anything you write next appears under it\. Do not describe it\.'/);
  });
});
