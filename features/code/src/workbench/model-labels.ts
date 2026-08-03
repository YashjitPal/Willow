/**
 * Turning saved model config into the labels the composer shows.
 */

/**
 * Flattens every provider's saved models into one list, tagging each with the
 * display name of the provider it came from.
 *
 * Nano Banana Pro is filtered out here: it is an image model that ships in the
 * same config but must not appear in the chat model picker.
 */
export const collectSavedModels = (modelConfig: any): any[] => [
  ...(modelConfig?.gemini?.savedModels || []).map((m: any) => ({ ...m, provider: 'Google' })),
  ...(modelConfig?.openai?.savedModels || []).map((m: any) => ({ ...m, provider: 'OpenAI' })),
  ...(modelConfig?.anthropic?.savedModels || []).map((m: any) => ({ ...m, provider: 'Anthropic' })),
  ...(modelConfig?.moonshot?.savedModels || []).map((m: any) => ({ ...m, provider: 'Moonshot AI' })),
  ...(modelConfig?.spacexai?.savedModels || []).map((m: any) => ({ ...m, provider: 'SpaceXAI' })),
  ...(modelConfig?.zhipuai?.savedModels || []).map((m: any) => ({ ...m, provider: 'Zhipu AI' }))
].filter((m: any) => m.name !== "Nano Banana Pro");

/**
 * Shortens a model name to fit the composer button.
 *
 * "2.5 Flash Lite" is special-cased because the generic rules would leave it
 * too long to fit.
 */
export const getShortName = (name: string): string => {
  if (!name) return "Model";
  if (name.includes("2.5 Flash Lite")) return "2.5 Lite";
  return name
    .replace(/Gemini\s+/gi, '')
    .replace(/\s+Extended$/gi, '')
    .trim();
};
