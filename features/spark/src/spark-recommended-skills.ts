export interface RecommendedSkill {
  title: string;
  description: string;
  /** What the skill is called once created; Gemini names skills in kebab case. */
  name: string;
  instructions: string;
}

/**
 * Gemini Spark's recommended skills, read off each card's editor. Its page shows the first four
 * not yet added and a "Show more" only while more than four remain, so adding one brings the
 * next in — which is how "Prep for meetings" first appears.
 */
export const RECOMMENDED_SKILLS: readonly RecommendedSkill[] = [
  {
    title: 'Match your writing style',
    description: 'Learns your voice from your real writing across Workspace apps',
    name: 'match-my-writing-style',
    instructions: 'Always-on skill that ensures every piece of writing sounds like the user. On first activation, auto-scans the workspace to build a persistent Voice Card — sentence length, vocabulary, tone, openings, closings, punctuation quirks, and channel-specific registers from real writing samples. The card is saved in Google Drive and every future draft uses it automatically. This skill triggers on ANY writing request — emails, messages, posts, docs, memos, replies, summaries, announcements, or any other written output. The user should never have to ask to "sound like me" — it just happens.',
  },
  {
    title: 'Focus your energy',
    description: 'Align your workload with your energy instead of your calendar',
    name: 'focus-my-energy',
    instructions: "Matches tasks to the user's current energy level — deep work when sharp, admin when fried. Classifies any task list by cognitive demand and recommends what to work on NOW based on time-of-day heuristics and self-reported energy state. Use when the user asks what to work on next, says they're tired or overwhelmed, or needs help prioritizing by mental bandwidth rather than deadline.",
  },
  {
    title: 'Get more perspectives',
    description: 'Get 3\u20135 distinct viewpoints before you commit to a decision',
    name: 'get-more-perspectives',
    instructions: "Convenes a virtual advisory panel of experts — each with a distinct expertise and perspective — to weigh in on any decision, strategy, or dilemma. Default panel includes an Operator (execution), a Skeptic (risk), a Visionary (opportunity), a Customer Advocate (user impact), and a Finance Mind (numbers). Each advisor gives their take independently, then the skill synthesizes a panel recommendation. Use when the user wants multiple perspectives on a big decision, is stuck between options, or says 'what would experts think.'",
  },
  {
    title: 'Generate fresh ideas',
    description: 'Turn existing content into 5 entirely new creative concepts',
    name: 'generate-fresh-ideas',
    instructions: 'Generates 5 derivative content ideas from any source material through fixed creative lenses: Contrarian Take, Personal Story Hook, Data/Evidence Angle, Practical Playbook, and What They Missed. Each remix is a genuinely new angle, not a summary or rephrase. Use when the user shares existing content (article, tweet, notes, transcript) and wants fresh content ideas, new angles, or ways to repurpose it.',
  },
  {
    title: 'Prep for meetings',
    description: 'Prep for any meeting with a brief \u2014 including context, goals, danger zones',
    name: 'prep-for-meetings',
    instructions: "Scans workspace notes, tasks, and past meeting records for mentions of the user's name to surface what they owe, what they need to know, and what could blindside them. Produces a tight TL;DR brief (must do, must know, watch out) and a 30-second glance card. Use when the user has an upcoming meeting and asks to be prepped, or wants to know what to prepare for a specific meeting.",
  },
] as const;

export const recommendedSkillByTitle = (title: string): RecommendedSkill | undefined =>
  RECOMMENDED_SKILLS.find((skill) => skill.title === title);
