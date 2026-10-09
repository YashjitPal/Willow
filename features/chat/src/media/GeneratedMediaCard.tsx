import React from 'react';
import type { GeneratedMedia } from './generated-media';
import { GeneratedImage } from './GeneratedImage';
import { GeneratedMusic } from './GeneratedMusic';
import { GeneratedVideo } from './GeneratedVideo';

export const GeneratedMediaCard: React.FC<{
  item: GeneratedMedia;
  onEditImage?: (item: GeneratedMedia, instruction: string) => void;
}> = ({ item, onEditImage }) => {
  if (item.kind === 'image') return <GeneratedImage item={item} onEdit={onEditImage} />;
  if (item.kind === 'video') return <GeneratedVideo item={item} />;
  return <GeneratedMusic item={item} />;
};
