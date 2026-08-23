export interface RecommendedSkill {
  description: string;
  title: string;
}

export const RECOMMENDED_SKILLS: readonly RecommendedSkill[] = [
  {
    title: 'Match your writing style',
    description: 'Learns your voice from your real writing across Workspace apps',
  },
  {
    title: 'Focus your energy',
    description: 'Align your workload with your energy instead of your calendar',
  },
  {
    title: 'Get more perspectives',
    description: 'Get 3\u20135 distinct viewpoints before you commit to a decision',
  },
  {
    title: 'Generate fresh ideas',
    description: 'Turn existing content into 5 entirely new creative concepts',
  },
  {
    title: 'Write clearer updates',
    description: 'Turn rough notes into concise, audience-ready project updates',
  },
  {
    title: 'Challenge your assumptions',
    description: 'Surface risks, counterarguments and missing evidence before you decide',
  },
  {
    title: 'Prepare for meetings',
    description: 'Create a focused brief with context, questions and desired outcomes',
  },
  {
    title: 'Turn feedback into action',
    description: 'Organise feedback into themes, priorities and concrete next steps',
  },
] as const;
