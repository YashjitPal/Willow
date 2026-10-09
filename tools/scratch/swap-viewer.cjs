// One-off: replaces MediaView's hand-rolled detail viewer with the Flow editors.
const fs = require('fs');

const file = 'features/media/src/MediaView.tsx';
const src = fs.readFileSync(file, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
const lines = src.split(eol);
const start = lines.findIndex((l) => l === '      {/* Full-screen Image Viewer / Inpainting Overlay */}');
if (start < 0) throw new Error('start marker not found');
if (lines[start + 1].trim() !== '<AnimatePresence>' || lines[start + 2].trim() !== '{selectedItem && (') {
  throw new Error(`unexpected lines after start: ${JSON.stringify(lines.slice(start + 1, start + 3))}`);
}
let end = -1;
for (let i = start + 3; i < lines.length; i += 1) {
  if (lines[i] === '      </AnimatePresence>') { end = i; break; }
}
if (end < 0) throw new Error('end marker not found');
const replacement = [
  "      {/* Flow's editors: a gallery image opens in the image editor, a video in the Scenebuilder on a",
  '        * scene of its own. Portalled and stopped at the root like the Scenebuilder above, for the same',
  "        * reason: React bubbles synthetic events through a portal into the gallery's marquee. */}",
  "      {selectedItem && selectedItem.kind !== 'audio' && createPortal(",
  '        <div',
  '          onMouseDown={(e) => e.stopPropagation()}',
  '          onClick={(e) => e.stopPropagation()}',
  '          onContextMenu={(e) => {',
  '            e.stopPropagation();',
  '            const t = e.target as HTMLElement;',
  "            if (!t.closest('input, textarea')) e.preventDefault();",
  '          }}',
  '        >',
  '          <React.Suspense fallback={null}>',
  "            {selectedItem.kind === 'video'",
  '              ? <SceneBuilder key={selectedItem.id} sceneId={videoSceneId(selectedItem.id)} host={editorHost} video={videoViewHost} />',
  '              : <ImageEditor itemId={selectedItem.id} host={editorHost} edit={imageEditHost} />}',
  '          </React.Suspense>',
  '        </div>,',
  '        document.body,',
  '      )}',
];
lines.splice(start, end - start + 1, ...replacement);
fs.writeFileSync(file, lines.join(eol));
console.log(`replaced lines ${start + 1}..${end + 1} (${end - start + 1} lines) with ${replacement.length}`);
