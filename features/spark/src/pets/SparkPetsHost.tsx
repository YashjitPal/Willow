import React, { useEffect, useRef } from 'react';
import { onDesktopMessage } from '@willow/core/desktop-bridge';
import { goToSparkTask } from '../spark-store';
import { focusVisibleComposer } from './pet-composer';
import { startPets } from './pets-controller';

interface SparkPetsHostProps {
  /** Brings Spark on screen (the shell's experience and view), before a task is opened in it. */
  onOpenSpark: () => void | Promise<void>;
}

/**
 * Every tab's part in the desktop pet: a turn at keeping it, and — in the tab in
 * front — opening what the pet asked for. Renders nothing; mount it only in the
 * desktop app.
 */
const SparkPetsHost: React.FC<SparkPetsHostProps> = ({ onOpenSpark }) => {
  const openSpark = useRef(onOpenSpark);
  openSpark.current = onOpenSpark;

  useEffect(() => startPets(), []);

  useEffect(() => onDesktopMessage((message) => {
    if (message.kind !== 'pets-show') return;
    const { taskId, composer } = message;
    if (taskId) {
      void Promise.resolve(openSpark.current()).then(() => {
        goToSparkTask(taskId);
        if (composer) focusVisibleComposer();
      });
      return;
    }
    if (composer) focusVisibleComposer();
  }), []);

  return null;
};

export default SparkPetsHost;
