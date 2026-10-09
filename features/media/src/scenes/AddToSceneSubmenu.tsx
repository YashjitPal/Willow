// The "Add to scene" submenu on a video's menu: New scene, then every scene in the project.
// Its own component so only an open submenu subscribes to the scene list.
import React from 'react';
import { useStore } from '@nanostores/react';
import { $scenePhases, $scenes, addVideoToScene, createSceneWithVideo, type SceneMediaRef } from './scene-store';
import { FlowMatMenuItem } from './flow-ui';

export const AddToSceneSubmenu: React.FC<{ item: SceneMediaRef }> = ({ item }) => {
  const scenes = useStore($scenes);
  const phases = useStore($scenePhases);
  const listed = scenes
    .filter((s) => !s.trashedAt && phases[s.id] !== 'creating')
    .sort((a, b) => b.createdAt - a.createdAt);
  return (
    <>
      <FlowMatMenuItem icon="add" label="New scene" onSelect={() => { void createSceneWithVideo(item); }} />
      {listed.map((scene) => (
        <FlowMatMenuItem key={scene.id} label={scene.name} onSelect={() => { void addVideoToScene(scene.id, item); }} />
      ))}
    </>
  );
};
