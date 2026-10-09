/**
 * Create with Gemini: what the plugin's Create action does, in Spark.
 *
 * The Hatch Pet skill becomes one of the user's Spark skills (kept in step with
 * the copy the desktop app ships), and Spark's home opens with the request in
 * its composer — prefilled, not sent, so a description or a reference image can
 * be added first. The run writes into the pet library, where the Pets page
 * shows its progress and then the pet.
 */
import { prepareDesktopPetCreation } from '@willow/core/desktop-bridge';
import { createSparkSkill, goToSparkHomeWithPrompt, sparkSkills, updateSparkSkill } from '../spark-store';
import skillText from './hatch-pet/SKILL.md?raw';
import { focusVisibleComposer } from './pet-composer';
import { setPetLibraryCreating } from './pet-library';
import { hatchPetSkill } from './pet-skill';

const PROMPT = 'Use the hatch-pet skill to create a pet based on what you know about me. Show me the character and animation previews.';

export async function createPetWithGemini(): Promise<void> {
  setPetLibraryCreating(true);
  try {
    const { skillPath, directory } = await prepareDesktopPetCreation();
    const skill = hatchPetSkill(skillText, skillPath.replace(/[\\/]SKILL\.md$/i, ''), directory);
    const existing = sparkSkills.get().find((candidate) => candidate.name.toLowerCase() === skill.name);
    if (existing) updateSparkSkill(existing.id, { ...skill, enabled: true });
    else createSparkSkill({ ...skill, source: 'manual', enabled: true });
    goToSparkHomeWithPrompt(PROMPT);
    focusVisibleComposer();
    setPetLibraryCreating(false);
  } catch (error) {
    setPetLibraryCreating(false, error instanceof Error ? error.message : String(error));
  }
}
