import createOrbitModule from './orbit-characters.mjs';

let engine;
self.onmessage = async ({data}) => {
  try {
    if (data.type === 'initialize') {
      engine = await createOrbitModule({locateFile: file => data.files[file],
        onAbort: () => { throw new Error('Preparation runtime aborted'); }});
      self.postMessage({type: 'ready'});
      return;
    }
    const result = engine.orbitPrepareAssembly(data.appearance, data.quality, data.key, data.activities);
    self.postMessage({type: 'complete', id: data.id, ...result}, result.bytes ? [result.bytes.buffer] : []);
  } catch (error) {
    // Fatal runtime failures also wake the owner instead of leaving it pending.
    self.postMessage({type: data.type === 'initialize' ? 'failed' : 'complete',
      id: data.id, error: error instanceof Error ? error.message : String(error), milliseconds: 0});
  }
};
