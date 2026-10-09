import { defineMessage } from "react-intl";

/** `at` (state-7c58121ceae9 chunk): initial Markdown of each user's guide to Pages. */
export const starterBodyGuideMessage = defineMessage({
  id: "space.gettingStartedPages.starterBody.guide",
  defaultMessage: `> [!CALLOUT] 💡
>
> Pages are a place for you to write, build, and collaborate with Willow and your teammates. Use this page as your playground to learn the basics — and have fun!

## Getting started

- [ ] **Play with this page.** Type \`/\` to add headings, images, checklists, tables, and more. Try it out in the empty space below 👇

- [ ] **Work with Willow.** Type \`@Willow\`, followed by your request, and Willow will jump in to help with whatever you need.

- [ ] **Get organized.** Instead of folders, organize information by nesting pages *inside of* pages. Type \`/page\` to create a page inside this one.

- [ ] When your masterpiece is ready, **share** it with your teammates (using the share button in the upper-right), **collaborate**, and fiercely debate in the **comments**.

## Imagine anything, and make it real

Create **interactive visualizations** by typing \`/visualize\` and describing your idea, whether it’s *“Show me how my savings could grow with an interactive calculator”*, *“Simulate the solar system”*, or even *“Create a playable mini-piano.”*

{savings}

{solar}

{piano}

---

- [ ] Try it out yourself: In the empty space below, type \`/visualize\` and describe your idea 👇

---

## Put Willow to work

You can add instructions to pages, and Willow will do the work for you, like creating a self-updating to-do list or comprehensive trip planner. Here are a couple examples of pages Willow can create for you.

\`\`\`codex-prompt
Create a daily list of prioritized tasks from my email, messages, and calendar, and update it every morning
\`\`\`

\`\`\`codex-prompt
Create a new trip planner page with flight details, hotel reservations, and tour info, pulled from my emails
\`\`\``,
  description:
    `Initial Markdown for each user's editable guide to Pages. Preserve headings, the light-bulb callout, pointing-down emoji, checkboxes, emphasis, dividers, code fences, and the literal commands /, /page, @Willow, /visualize, and codex-prompt. Preserve the savings, solar, and piano placeholders: each inserts a complete interactive visualization.`,
});
