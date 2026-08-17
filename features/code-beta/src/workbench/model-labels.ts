/**
 * Turning saved model config into the labels the composer shows.
 */

import { collectSavedModelsInCatalogOrder, isChatCapableModel } from '@willow/core/model-catalog';

/**
 * Flattens every provider's saved models into one list, tagging each with the
 * display name of the provider it came from.
 *
 * Non-text models stay in the catalog but do not appear in the Workbench picker.
 */
export const collectSavedModels = (modelConfig: any): any[] => {
  const providerLabels = {
    gemini: 'Google',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    moonshot: 'Moonshot AI',
    spacexai: 'SpaceXAI',
    zhipuai: 'Zhipu AI',
  } as const;
  return collectSavedModelsInCatalogOrder(modelConfig)
    .filter(isChatCapableModel)
    .map((model) => ({ ...model, provider: providerLabels[model.providerId] }));
};

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
