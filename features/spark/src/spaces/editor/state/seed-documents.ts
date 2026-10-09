import { seedDotId } from "../../willow/dot/dot-identity";
import { selfUserId } from "../../willow/dot/state/room-store";
import type { PageActor } from "../../state";
import { text, type PageBlock, type PageDocument, type PageTableRow } from "./page-document";

const minute = 60_000;
const hour = 60 * minute;

const dot = (slot: number): PageActor => ({ actor_type: "agent", agent_kind: "o", account_user_id: selfUserId, dot_id: seedDotId(slot) });
const willow: PageActor = { actor_type: "agent", agent_kind: null, account_user_id: selfUserId };
const dotAuthor = (slot: number) => ({ kind: "dot", accountUserId: selfUserId, conversationId: seedDotId(slot) }) as const;

function ago(ms: number) {
  return new Date(Date.now() - ms).toISOString();
}

/** Markdown tables import with their header text bold. */
function tableRows(rows: string[][]): PageTableRow[] {
  return rows.map((cells, row) => ({ cells: cells.map((value) => ({ content: [text(value, row === 0 ? ["bold"] : undefined)] })) }));
}

const launchBlocks: PageBlock[] = [
  { id: "launch-intro", type: "paragraph", content: [text("This page tracks everything we need for the "), text("October launch", ["bold"]), text(". Owners update their sections as work lands.")] },
  { id: "launch-goals-heading", type: "heading", level: 2, content: [text("Goals")] },
  {
    id: "launch-goals",
    type: "list",
    items: [
      { id: "launch-goal-1", content: [text("Ship the public beta to every workspace")] },
      { id: "launch-goal-2", content: [text("Publish the docs and the "), text("migration guide", ["italic"])] },
      { id: "launch-goal-3", content: [text("Brief support before the announcement")] },
    ],
  },
  { id: "launch-checklist-heading", type: "heading", level: 2, content: [text("Checklist")] },
  {
    id: "launch-checklist",
    type: "list",
    task: true,
    items: [
      { id: "launch-check-1", content: [text("Freeze the feature branch")], checked: true },
      { id: "launch-check-2", content: [text("Run the load test against staging")], checked: true },
      { id: "launch-check-3", content: [text("Draft the announcement post")], checked: false },
      { id: "launch-check-4", content: [text("Schedule the social posts")], checked: false },
    ],
  },
  { id: "launch-callout", type: "callout", emoji: "💡", content: [{ ...text("Press embargo lifts at 9:00 PT on launch day."), threadId: "thread-launch-embargo" }] },
  { id: "launch-timeline-heading", type: "heading", level: 2, content: [text("Timeline")] },
  {
    id: "launch-timeline",
    type: "ordered_list",
    items: [
      { id: "launch-step-1", content: [text("Code freeze — Oct 7")] },
      { id: "launch-step-2", content: [text("Docs review — Oct 9")] },
      { id: "launch-step-3", content: [text("Launch — Oct 14")] },
    ],
  },
  {
    id: "launch-owners",
    type: "table",
    layout: "full-width",
    rows: tableRows([
      ["Area", "Due", "Status"],
      ["Docs", "Oct 9", "In review"],
      ["Support", "Oct 11", "Ready"],
      ["Press", "Oct 13", "Drafting"],
    ]),
  },
  { id: "launch-quote", type: "blockquote", content: [text("Launch small, learn fast, then turn up the volume.")] },
  { id: "launch-divider", type: "horizontal_rule" },
  {
    id: "launch-dot-summary",
    type: "paragraph",
    content: [text("Summary from this morning: the staging load test held at 2× expected traffic, and the docs PR is waiting on one review.")],
  },
  { id: "launch-prompt", type: "code_block", lang: "codex-prompt", text: "Summarize the open launch risks from this page and suggest an owner for each." },
  { id: "launch-code", type: "code_block", lang: "bash", text: "npm run release -- --channel beta" },
];

const questionsBlocks: PageBlock[] = [
  { id: "questions-intro", type: "paragraph", content: [text("Questions collected from the timeline review. Your bot keeps this list current.")] },
  {
    id: "questions-list",
    type: "list",
    items: [
      { id: "questions-1", content: [text("Do we need a separate migration window for enterprise workspaces?")] },
      { id: "questions-2", content: [text("Who signs off on the pricing page copy?")] },
    ],
  },
  { id: "questions-dot-note", type: "paragraph", content: [text("I checked last quarter’s launch notes: enterprise migrations ran in a separate weekend window.")] },
];

const digestBlocks: PageBlock[] = [
  { id: "digest-heading", type: "heading", level: 1, content: [text("This week")] },
  {
    id: "digest-list",
    type: "list",
    items: [
      { id: "digest-1", content: [text("3 launch tasks closed, 2 still open")] },
      { id: "digest-2", content: [text("Design review moved to Thursday")] },
      { id: "digest-3", content: [text("New questions on the Open questions page")] },
    ],
  },
  { id: "digest-next", type: "paragraph", content: [text("Next digest goes out Monday morning.")] },
];

const designBlocks: PageBlock[] = [
  { id: "design-intro", type: "paragraph", content: [text("Shared foundations for every product surface.")] },
  { id: "design-principles-heading", type: "heading", level: 2, content: [text("Principles")] },
  {
    id: "design-principles",
    type: "ordered_list",
    items: [
      { id: "design-p1", content: [text("Clarity over decoration")] },
      { id: "design-p2", content: [text("One accent per surface")] },
      { id: "design-p3", content: [text("Motion explains, never distracts")] },
    ],
  },
  { id: "design-tokens-note", type: "paragraph", content: [text("Token names follow the "), text("surface / text / border", ["code"]), text(" families.")] },
  { id: "design-visualization", type: "page_visualization", fileId: "file-design-palette", title: "Palette contrast explorer", status: "ready" },
];

export function seedPageDocuments(): Record<string, PageDocument> {
  return {
    "page-launch-root": {
      pageId: "page-launch-root",
      status: "ready",
      blocks: launchBlocks,
      attribution: {
        "launch-dot-summary": { actor: dot(0), changedAt: ago(2 * hour) },
        "launch-owners": { actor: dot(1), changedAt: ago(5 * hour) },
      },
      taskMentions: {},
      threads: [
        {
          id: "thread-launch-embargo",
          quote: "Press embargo lifts at 9:00 PT on launch day.",
          blockId: "launch-callout",
          state: "open",
          createdAt: Date.now() - 3 * hour,
          messages: [
            {
              id: "message-embargo-1",
              author: dotAuthor(2),
              body: [text("Should I confirm this with the agency before Friday?")],
              createdAt: Date.now() - 3 * hour,
              reactions: [{ emoji: "👍", reactorIds: [seedDotId(1)] }],
            },
            {
              id: "message-embargo-2",
              author: dotAuthor(1),
              body: [text("Confirmed by email, they have it in writing.")],
              createdAt: Date.now() - 2 * hour,
              reactions: [],
            },
          ],
        },
      ],
    },
    "page-launch-questions": {
      pageId: "page-launch-questions",
      status: "ready",
      blocks: questionsBlocks,
      attribution: {
        "questions-intro": { actor: dot(0), changedAt: ago(5 * hour) },
        "questions-dot-note": { actor: dot(0), changedAt: ago(5 * hour) },
        "questions-list": { actor: willow, changedAt: ago(9 * hour) },
      },
      taskMentions: {},
      threads: [
        {
          id: "thread-questions-dot",
          quote: "enterprise migrations ran in a separate weekend window",
          blockId: "questions-dot-note",
          state: "resolved",
          resolvedAt: Date.now() - 4 * hour,
          createdAt: Date.now() - 6 * hour,
          messages: [
            {
              id: "message-questions-1",
              author: { kind: "user", accountUserId: selfUserId },
              body: [text("Can you check how we handled this last time?")],
              createdAt: Date.now() - 6 * hour,
              reactions: [{ emoji: "👍", reactorIds: [selfUserId] }],
            },
            {
              id: "message-questions-2",
              author: dotAuthor(0),
              body: [text("Check enterprise migration history")],
              createdAt: Date.now() - 5 * hour,
              reactions: [],
            },
          ],
        },
      ],
    },
    "page-digest": {
      pageId: "page-digest",
      status: "ready",
      blocks: digestBlocks,
      attribution: Object.fromEntries(digestBlocks.map((block) => [block.id, { actor: dot(0), changedAt: ago(20 * minute) }])),
      taskMentions: {},
      threads: [],
    },
    "page-design-root": {
      pageId: "page-design-root",
      status: "ready",
      blocks: designBlocks,
      attribution: { "design-tokens-note": { actor: dot(1), changedAt: ago(6 * hour) } },
      taskMentions: {},
      threads: [],
    },
  };
}
