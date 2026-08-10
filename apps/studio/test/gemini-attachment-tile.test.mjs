/**
 * Gemini's attachment tiles: the shape decision, the label/icon split, and the box.
 *
 * Everything asserted here was transcribed from Gemini's client bundle or measured off
 * the running app over CDP. None of it is a design choice, so a failure here means the
 * clone drifted from the original — not that a number wants retuning.
 *
 * THE SHAPE DECISION. The template branches three ways:
 *
 *   !errorMessage && OU ? gem-style-attachment
 *                       : mqe ? gem-media-attachment
 *                       : Ete ? gem-media-attachment
 *                             : gem-attachment
 *
 * where `mqe` and `Ete` reduce to `q_c(name)` and `dK(name)` — both of which test the
 * file EXTENSION, never the mime type. This is the subtle part: a PNG served as
 * `application/octet-stream` still gets a cover-cropped thumbnail, and a file named
 * `report` with mime `image/png` does not. Willow's own `detectAttachmentKind` decides
 * on mime OR extension, so it disagrees with Gemini here and must not drive the tile.
 *
 * THE BOX, measured live: 112x112, `border-radius: 20px` on all corners, surface
 * `rgba(255,255,255,0.12)`, `overflow: hidden`. Strip pitch measured at 120px, which is
 * 112 + an 8px gap.
 *
 * THE GENERIC TILE. Content box is inset 12px, column, `justify-content: flex-end`, so
 * the name sits on the floor. The top-left corner holds either a 24px Drive icon or a
 * text extension label — `!e9f` picks the label for exactly PDF / TEXT / AUDIO / UNKNOWN,
 * the four types whose icon carries no more information than the word does.
 *
 * THE CLOSE BUTTON, from the authored rule:
 *
 *   { --mat-icon-color: #000; --mat-icon-button-state-layer-size: 20px;
 *     background-color: #fff; position: absolute; top: 0; inset-inline-end: 0 }
 *   :not(.is-mobile) { visibility: hidden }
 *   :hover, :focus-within { visibility: visible }
 *
 * with no transition — Gemini snaps it in rather than fading it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { importTs } from './ts-module.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const uiSrc = (...parts) => path.join(repoRoot, 'platform', 'ui', 'src', ...parts);
const coreSrc = (...parts) => path.join(repoRoot, 'platform', 'core', 'src', ...parts);
const chatSrc = (...parts) => path.join(repoRoot, 'features', 'chat', 'src', ...parts);

const CARD = () => fs.readFileSync(uiSrc('GeminiAttachmentCard.tsx'), 'utf8');
const COMPOSER = () => fs.readFileSync(chatSrc('composer', 'Composer.tsx'), 'utf8');
const AUTOSIZE = () => fs.readFileSync(chatSrc('composer', 'use-composer-textarea-autosize.ts'), 'utf8');

/** Strips comments so a doc block quoting a value can't satisfy an assertion. */
const codeOnly = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the tile shape is chosen by extension, not mime', () => {
  it('gives an image extension a thumbnail even when the mime lies', async () => {
    const { tileShape } = await importTs(coreSrc('gemini-file-info.ts'));

    assert.equal(tileShape('photo.png'), 'image');
    assert.equal(tileShape('scan.JPEG'), 'image', 'the extension test is case-insensitive');
    assert.equal(tileShape('clip.mov'), 'video');
    assert.equal(tileShape('notes.md'), 'generic');

    // The whole point of testing the name: mime is not consulted at all.
    assert.equal(tileShape('report'), 'generic', 'no extension means no thumbnail');
  });

  it('keeps Willow\'s kind detector away from the decision', () => {
    const source = codeOnly(CARD());
    assert.ok(
      !/detectAttachmentKind|attachment\.kind/.test(source),
      'the tile is branching on Willow\'s kind, which disagrees with Gemini on mime/extension conflicts',
    );
    assert.match(source, /tileShape\(attachment\.name\)/,
      'the tile shape must come from Gemini\'s extension test');
  });
});

describe('the label/icon split', () => {
  it('shows a label for exactly the four types Gemini labels', async () => {
    const { showsExtensionLabel, GeminiFileType } = await importTs(coreSrc('gemini-file-info.ts'));

    for (const type of ['PDF', 'TEXT', 'AUDIO', 'UNKNOWN']) {
      assert.equal(showsExtensionLabel(GeminiFileType[type]), true, `${type} should show a label`);
    }
    // A spot check on the other side: code and images carry a real icon instead.
    assert.equal(showsExtensionLabel(GeminiFileType.CODE), false);
    assert.equal(showsExtensionLabel(GeminiFileType.IMAGE), false);
  });

  it('routes a PDF to the label and a markdown file to the code icon', async () => {
    const { fileTypeOf, showsExtensionLabel, GeminiFileType } =
      await importTs(coreSrc('gemini-file-info.ts'));
    const { fileTypeIcon } = await importTs(coreSrc('gemini-file-icon.ts'));

    // application/pdf -> aK index 6 -> lwc[6] = 11 -> PDF -> labelled.
    const pdf = fileTypeOf('application/pdf', 'paper.pdf');
    assert.equal(pdf, GeminiFileType.PDF);
    assert.equal(showsExtensionLabel(pdf), true);

    // `md` is in the code-extension table, so a markdown file is CODE and takes the
    // `text/code` bracket icon rather than a label.
    const markdown = fileTypeOf('text/markdown', 'notes.md');
    assert.equal(markdown, GeminiFileType.CODE);
    assert.equal(showsExtensionLabel(markdown), false);
    assert.ok(
      fileTypeIcon({ name: 'notes.md', mimeType: 'text/markdown', fileType: markdown }),
      'a code file must resolve to a vendored icon, not an empty src',
    );
  });

  it('truncates the visible name but hands the tooltip the whole one', async () => {
    const { tileDisplayName, fileTypeOf } = await importTs(coreSrc('gemini-file-info.ts'));

    const name = 'cardio-vascular-system-pdf.md';
    const shown = tileDisplayName(name, fileTypeOf('text/markdown', name));
    assert.equal(shown, 'cardio-vas...system-pdf', 'measured off the live tile');

    // The tooltip is the raw filename, extension included — verified live as
    // `blood-vessels-pdf.md` against a tile reading `blood-vess...ssels-pdf`.
    assert.match(codeOnly(CARD()), /title=\{attachment\.name\}/,
      'the tooltip must carry the full filename, not the truncated label');
  });
});

describe('the tile box', () => {
  const box = () => {
    const source = codeOnly(CARD());
    const match = source.match(/const TILE_CLASS = '([^']*)'/);
    assert.ok(match, 'could not locate TILE_CLASS');
    return match[1];
  };

  it('is 112 square with 20px corners over a 12% white surface', () => {
    const klass = box();
    assert.match(klass, /\bh-28\b/, 'height must be 112px (h-28)');
    assert.match(klass, /\bw-28\b/, 'width must be 112px (w-28)');
    assert.match(klass, /rounded-\[20px\]/, 'all four corners are 20px');
    assert.match(klass, /bg-\[rgba\(255,255,255,0\.12\)\]/, 'measured surface colour');
    assert.match(klass, /overflow-hidden/, 'the thumbnail is cropped by the tile');
  });

  it('names the group the close button hangs off', () => {
    assert.match(box(), /group\/tile/,
      'the close button reveals on the tile\'s own hover, so the group must be named');
  });
});

describe('the close button', () => {
  const button = () => {
    const source = codeOnly(CARD());
    const match = source.match(/<button[\s\S]*?<\/button>/);
    assert.ok(match, 'could not locate the close button');
    return match[0];
  };

  it('is a white 20px pill inset into the tile by the content box', () => {
    const source = button();
    assert.match(source, /\bh-5\b/, '20px tall');
    assert.match(source, /\bw-5\b/, '20px wide');
    assert.match(source, /bg-white/, 'the pill is white, not the dark surface');
    assert.match(source, /text-black/, 'the glyph is black');

    // NOT the tile's own corner. Gemini nests the button inside `.gem-attachment-content`,
    // which is inset 8px over a thumbnail and 12px on a generic tile, so the button lands
    // at that inset. Measured: image 594+112-20-8 = 678, generic 834+112-20-12 = 914.
    assert.match(source, /right-2 top-2/, 'image and video tiles inset the content box 8px');
    assert.match(source, /right-3 top-3/, 'generic tiles inset it 12px');
    assert.ok(
      !/right-0|top-0/.test(source),
      'the tile corner is 8-12px out from where Gemini puts the button',
    );
  });

  it('hides until the tile is hovered or holds focus, and does not fade', () => {
    const source = button();
    assert.match(source, /\binvisible\b/, 'hidden at rest');
    assert.match(source, /group-hover\/tile:visible/);
    assert.match(source, /group-focus-within\/tile:visible/,
      'keyboard focus must reveal it too — Gemini uses :focus-within');
    assert.ok(
      !/transition|duration-/.test(source),
      'Gemini snaps the button in; a transition is an invention',
    );
  });

  it('never offers to remove an attachment from a sent message', () => {
    assert.match(codeOnly(CARD()), /variant === 'composer' && onRemove/,
      'a sent message is immutable, so the message variant carries no close button');
  });
});

describe('the composer strip', () => {
  const strips = () => {
    const source = codeOnly(COMPOSER());
    const found = source.match(/className="[^"]*max-h-\[168px\][^"]*"/g) ?? [];
    assert.equal(found.length, 2, 'both the chat and standard composers carry a strip');
    return found;
  };

  it('paces tiles 120px apart and fades them at both edges', () => {
    for (const strip of strips()) {
      // 112px tile + gap-2 (8px) = the 120px pitch measured in the live strip.
      assert.match(strip, /\bgap-2\b/, 'the 8px gap is what makes the pitch 120');
      assert.match(strip, /max-h-\[168px\]/);
      assert.match(strip, /overflow-x-auto/, 'the strip scrolls rather than wrapping');
      assert.match(
        strip,
        /mask-image:linear-gradient\(to_right,transparent_0,#000_12px,#000_calc\(100%_-_12px\),transparent_100%\)/,
        'the 12px edge fade is transcribed verbatim from Gemini',
      );
      assert.match(strip, /\bp[lx]-3\b/,
        'the 12px inline padding is what lands the first tile on the mask\'s opaque edge');
    }
  });

  it('cancels the composer shell\'s own padding with a negative inline margin', () => {
    // Gemini's `.attachment-preview-wrapper` pulls out to its container's border edge with
    // `margin-inline: -12px` before re-adding `padding-inline: 12px`. Measured live, the
    // wrapper's x equals the fieldset's x (582) and the first tile sits at 594.
    //
    // Without this the padding stacks on the shell's own and the first tile sits too far
    // in: ours measured 26px against Gemini's 12px, which is the reported left gap.
    // Verified after the fix: strip x == shell x == 574.4, first tile inset 12px.
    const [chat, standard] = strips();
    assert.match(chat, /-ml-\[14px\]/, 'cancels the chat shell\'s pl-[14px]');
    assert.match(chat, /-mr-\[15px\]/, 'cancels the chat shell\'s pr-[15px]');
    assert.match(standard, /-mx-2\b/, 'the standard shell pads with p-2');
  });

  it('detaches a tile instantly, with no enter or leave animation', () => {    // Measured on Gemini: `uploader-file-preview`, `.file-preview-container`, the tile,
    // `.attachment-preview-wrapper` and `.text-input-field` all compute `transition: all 0s`;
    // no `@keyframes` matches /attach|chip|preview/; and the strip carries no `ng-trigger-*`
    // class, so there is no Angular runtime animation either.
    const source = codeOnly(COMPOSER());
    const wrappers = source.match(/<div key=\{att\.id\} className="[^"]*"/g) ?? [];
    assert.equal(wrappers.length, 2, 'one tile wrapper per strip');
    for (const wrapper of wrappers) {
      assert.ok(
        !/animate-in|fade-in|zoom-in|transition|duration-|opacity-0|scale-9/.test(wrapper),
        `Gemini does not animate a tile in or out: ${wrapper}`,
      );
    }
    assert.ok(
      !/removingIds/.test(source),
      'the fade-out hold was there to cover an animation Gemini does not have',
    );
    for (const strip of strips()) {
      assert.ok(
        !/transition-\[grid-template-rows\]/.test(strip),
        'the box snaps to its new height, matching every measured transition-duration of 0s',
      );
    }
  });
});

describe('attaching a file expands the composer', () => {
  // Gemini puts the editor on its own grid row and the controls on the row below whenever
  // anything is attached. Measured on the live app with five files:
  //
  //   grid-template-rows: 112px 40px 38px    row-gap: 8px    padding: 12px
  //   areas: "file-preview" / "text-input" / "leading-actions … trailing-actions"
  //   12 + 112 + 8 + 40 + 8 + 38 + 12 = 230, which is the measured fieldset height.
  //
  // The 3-row template itself comes from `.with-toolbox-drawer`, not from the attachment —
  // the strip merely fills a row that was already declared, so the box grows 112 + 8 = 120.
  // Willow already had the two-row arrangement for tool chips and wrapped text; it simply
  // was not reachable from an attachment, which is the reported defect.
  //
  // Verified live after wiring: shell height 64 -> 234, plus button y 396.8 -> 482.8, and
  // the control row lands below the editor's bottom edge.

  it('feeds attachments into the autosize hook\'s expand decision', () => {
    const hook = codeOnly(AUTOSIZE());
    assert.match(hook, /hasAttachments: boolean/, 'the hook takes the flag');
    assert.match(
      hook,
      /const shouldExpand =[\s\S]*?\|\|\s*hasAttachments/,
      'an attachment must expand the box exactly as a tool chip does',
    );
    assert.match(
      hook,
      /\}, \[promptText, selectedTool, hasAttachments,/,
      're-measure when it changes, or the box expands one keystroke late',
    );
  });

  it('flips the left cluster synchronously, as a tool chip does', () => {
    // Same reason as `selectedTool`: the tile row mounts in the same render, so a flag
    // that only lands next frame lets the taller row shove Plus upward for one frame.
    assert.match(
      codeOnly(COMPOSER()),
      /const solidExpanded =[\s\S]*?\|\| hasActiveAttachments \|\|/,
      'the left cluster needs the attachment state in the same render',
    );
  });

  it('passes the flag from the composer', () => {
    assert.match(
      codeOnly(COMPOSER()),
      /hasAttachments: hasActiveAttachments/,
      'the hook is wired to the composer\'s own attachment state',
    );
  });
});
