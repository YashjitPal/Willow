/**
 * Design's contribution to a saved project folder.
 *
 * The storage layer owns `Code/<project>/` but must not know that a Design
 * feature exists (see platform/storage/src/project-contributors.ts). So Design
 * registers a writer for the one sub-folder it owns, `Designs/`, and the save
 * pipeline calls it.
 *
 * Importing this module is what performs the registration. It is pulled in
 * exactly once, from apps/studio/src/app/register-features.ts.
 */

import { registerProjectFolderWriter } from '@willow/storage/project-contributors';
import { designNodesStore } from './design-store';

registerProjectFolderWriter('design', {
  folder: 'Designs',
  async write({ writeFile }) {
    for (const node of designNodesStore.get()) {
      // Nodes created before file naming existed fall back to their id's
      // timestamp segment, which is stable across saves.
      const baseName = node.fileName || `design_${node.id.split('-')[1] || Date.now()}`;
      const nameWithoutExt = baseName.replace(/\.[^/.]+$/, '');

      await writeFile(`${nameWithoutExt}.tsx`, node.code);

      // Canvas position/size lives beside the code rather than inside it, so
      // the .tsx stays a plain component a human can open and read.
      await writeFile(
        `${nameWithoutExt}.json`,
        JSON.stringify(
          {
            id: node.id,
            prompt: node.prompt,
            layoutData: node.layoutData,
            customSize: node.customSize,
            timestamp: node.timestamp,
          },
          null,
          2
        )
      );
    }
  },
});
