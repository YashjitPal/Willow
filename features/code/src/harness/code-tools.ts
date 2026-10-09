/**
 * The Code tab's tools: what the composer's Tools menu offers, and what each
 * one means to the harness.
 *
 * Every entry is two things, the way tool menus work in ChatGPT and Gemini:
 * a model tool the agent may call on its own whenever it helps, and — picked in
 * the composer — a direction to use it for that message. Both composers build
 * their menus from this list, so the menu cannot offer a tool the agent does
 * not have.
 */

export type CodeToolId = 'plan' | 'image' | 'design' | 'annotate' | 'prototype' | 'test';

export interface CodeTool {
  /** Stable: saved with the landing page's handoff. `prototype` is Visual Edits. */
  id: CodeToolId;
  label: string;
  /** The model tool it is built on. */
  modelTool: string;
  /** What the model is told when the user picks it. Empty when a mode does the work instead. */
  directive: string;
}

export const CODE_TOOLS: readonly CodeTool[] = [
  {
    id: 'plan',
    label: 'Plan',
    modelTool: 'propose_plan',
    // Picking Plan turns on Plan mode, which has its own section in the prompt.
    directive: '',
  },
  {
    id: 'image',
    label: 'Image',
    modelTool: 'generate_image',
    directive: 'Create the images this request calls for with `generate_image`, then use them in the app.',
  },
  {
    id: 'design',
    label: 'Design',
    modelTool: 'create_design',
    directive: 'Design this as screens on the Design canvas: write each screen to /Designs/<Name>.tsx, then place it with `create_design`. Do not change the app itself unless the user asks for that too.',
  },
  {
    id: 'annotate',
    label: 'Annotate',
    modelTool: 'annotate',
    directive: 'Answer by marking up the app: look at it with `inspect`, then point things out on a screenshot with `annotate`.',
  },
  {
    id: 'prototype',
    label: 'Visual Edits',
    modelTool: 'inspect',
    directive: 'Find the elements the user means in the live preview with `inspect` — it shows the file and line that renders each one — then change exactly those elements.',
  },
  {
    id: 'test',
    label: 'Test',
    modelTool: 'computer',
    directive: 'Test the app in the live preview with `computer`, after reading skill://app-testing. Report what works and what does not; if something is broken, fix it and test it again.',
  },
];

export const codeTool = (id: string | null | undefined): CodeTool | undefined =>
  CODE_TOOLS.find((tool) => tool.id === id);
