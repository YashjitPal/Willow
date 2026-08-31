/**
 * The Canvas tools the model is offered, and the instruction block that tells it
 * when to reach for them.
 *
 * ## Why this is tool-calling and not a text convention
 *
 * A canvas could be expressed in the reply stream — a fenced block with a magic
 * header, parsed out on arrival. That fails on the second turn. The whole point
 * of a canvas is that a follow-up edits *the same document*, which needs a
 * stable id, and the model has no way to quote an id it has not been told. Tool
 * calling gives both halves for free: the call carries the id, and the result
 * carries the id back, so the next turn's `update_canvas` names it without
 * anyone parsing prose.
 *
 * ## Two calls, not three
 *
 * ChatGPT's `canmore` has `create_textdoc`, `update_textdoc` and
 * `comment_textdoc`. The third is skipped here: comments are an editor feature
 * with no UI in Willow, and a declared tool with nowhere to put its output is
 * how you get a model announcing feedback the user cannot see. Willow's Canvas
 * matches Gemini's, which has no comment affordance either.
 *
 * ## Targeted edits are literal, not regex
 *
 * `canmore`'s `updates` take a regex per edit. That is more expressive and
 * measurably worse in practice — a model writing `\.` vs `.` or forgetting that
 * `(` is a group produces an edit that silently matches the wrong span, and the
 * failure surfaces as a corrupted document rather than an error. `find` here is
 * a literal substring, which is the same shape every coding agent's edit tool
 * settled on, for the same reason. Expressiveness is recovered by asking for
 * more context around the anchor, which a model is good at.
 *
 * A `find` that occurs more than once is *rejected* rather than applied to the
 * first hit (see `applyCanvasUpdates`). Ambiguity resolved silently is how you
 * edit the wrong paragraph.
 *
 * ## Provider reach
 *
 * These are Gemini-shaped `functionDeclarations`, handed to `streamChat` through
 * the `toolDeclarations` seam. The native-Gemini, Gemini-interactions and
 * Anthropic adapters all honour it — the Anthropic branch translates them to
 * `input_schema` tools and runs the same feedback loop. The OpenAI and
 * OpenAI-compatible branches still pass no declarations at all, so Canvas is
 * quietly absent there rather than declared into a request that would drop it.
 * That gap is worth knowing about because of how it fails: the instruction block
 * below is added for every provider, so a model with no tool writes the document
 * into the reply instead — which is exactly what Claude did before its branch
 * learned to send declarations.
 */

export const CREATE_CANVAS = 'create_canvas';
export const UPDATE_CANVAS = 'update_canvas';

/** One literal-anchored replacement inside a document. */
export interface CanvasEdit {
  /** Exact substring to find. Must occur exactly once unless `all` is set. */
  find: string;
  replace: string;
  /** Replace every occurrence instead of requiring a unique one. */
  all?: boolean;
}

/*
 * The descriptions are the actual behaviour spec.
 *
 * A model reads these before it reads the system prompt block, and for the
 * question it asks most often — "does this belong in a canvas?" — the
 * description is where it looks. So the negative cases are here rather than only
 * in the prompt: a tool described as "create a document" gets called for every
 * three-paragraph answer, which turns the thread into a stack of cards nobody
 * asked for.
 */
const CREATE_DESCRIPTION = `Create a new Canvas document: a titled artifact that opens in a side panel beside the conversation, which the user can read, edit, download, and ask you to revise across later turns.

Use this when the user's output is a THING they will keep or work on:
- A document they asked you to write — an essay, report, plan, spec, story, letter, guide.
- Code they will run or iterate on — a script, a component, a self-contained web page.
- Anything they explicitly asked to put in Canvas.

Do NOT use this for:
- An answer to a question, however long. Explanations, comparisons, analysis, advice and summaries belong in the reply.
- A short snippet illustrating a point — a few lines of example code, a command, a formula. Use a normal fenced code block in the reply.
- Something the user only asked about rather than asked for ("how would you structure a README?").

Call it at most once per turn, and only when nothing in this conversation is already the document being discussed — if a canvas exists and the user wants it different, call ${UPDATE_CANVAS} instead.`;

const UPDATE_DESCRIPTION = `Revise an existing Canvas document. Use this for every follow-up that changes a document you already created — "make it shorter", "add error handling", "change the tone", "rename it".

Prefer targeted edits: pass \`updates\`, an array of literal find/replace pairs. Each \`find\` must be copied EXACTLY from the current document, including whitespace and punctuation, and must be long enough to occur only once — include the surrounding sentence or line if a short anchor would be ambiguous. Targeted edits keep the parts the user was happy with byte-identical, which is what makes the version history readable.

Pass \`content\` (the complete new document) only when the change is structural — a reorganisation, a rewrite, a change of language or framework — where most of the text moves anyway.

Never pass both. Never send a document that is mostly unchanged as \`content\` to save yourself the trouble of anchoring an edit.`;

const TYPE_DESCRIPTION =
  "'text' for prose and markdown documents, 'code' for source files. A code canvas is shown in a code editor with a live Preview tab; a text canvas is shown as formatted, editable rich text.";

const TITLE_DESCRIPTION =
  'Short human title, shown in the panel header and used to name the file on download. Plain words, no file extension.';

const CONTENT_DESCRIPTION = `The complete document. For 'text', GitHub-flavored markdown — headings, lists, tables, LaTeX in $...$ — with NO surrounding code fence. For 'code', the raw file contents only: no fences, no commentary, no "here is the code" line. Never include the title as a heading; the panel already shows it.`;

const LANGUAGE_DESCRIPTION =
  "Language of a 'code' document, lowercase ('html', 'python', 'typescript', 'sql'). Drives syntax highlighting and the download extension. A single self-contained 'html' file is the default when the user wants something they can see running.";

/**
 * The declarations, in Gemini's dialect (uppercase schema types).
 *
 * `enabled` is the composer's Canvas chip. When it is off the tools are not
 * declared at all, which is deliberate and matches Gemini: Canvas is a mode the
 * user opts into per message, not a capability the model exercises whenever it
 * judges the output document-shaped. A model that can see `create_canvas` will
 * use it, and a user who typed "explain closures" does not want a card.
 */
export const canvasChatTools = (
  enabled: boolean,
): { functionDeclarations: any[] }[] => {
  if (!enabled) return [];
  return [{
    functionDeclarations: [
      {
        name: CREATE_CANVAS,
        description: CREATE_DESCRIPTION,
        parameters: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: ['text', 'code'], description: TYPE_DESCRIPTION },
            title: { type: 'STRING', description: TITLE_DESCRIPTION },
            content: { type: 'STRING', description: CONTENT_DESCRIPTION },
            language: { type: 'STRING', description: LANGUAGE_DESCRIPTION },
          },
          required: ['type', 'title', 'content'],
        },
      },
      {
        name: UPDATE_CANVAS,
        description: UPDATE_DESCRIPTION,
        parameters: {
          type: 'OBJECT',
          properties: {
            doc_id: {
              type: 'STRING',
              description:
                'Which document to revise, as returned by an earlier call. Omit it when the conversation has only one canvas, or to mean the one most recently touched.',
            },
            updates: {
              type: 'ARRAY',
              description:
                'Targeted edits, applied in order. The preferred form for every revision that is not a structural rewrite.',
              items: {
                type: 'OBJECT',
                properties: {
                  find: {
                    type: 'STRING',
                    description:
                      'Exact text from the current document, long enough to appear only once. Copied verbatim, not paraphrased.',
                  },
                  replace: {
                    type: 'STRING',
                    description: 'What it becomes. An empty string deletes the matched text.',
                  },
                  all: {
                    type: 'BOOLEAN',
                    description:
                      'Set only when the anchor is meant to match repeatedly — a renamed variable, a recurring phrase.',
                  },
                },
                required: ['find', 'replace'],
              },
            },
            content: {
              type: 'STRING',
              description: `Complete replacement document, for structural rewrites only. ${CONTENT_DESCRIPTION}`,
            },
            title: {
              type: 'STRING',
              description: 'New title, when the user asked to rename it. Omit to keep the current one.',
            },
            language: {
              type: 'STRING',
              description:
                'New language for a code document, when a rewrite changed it. Omit unless it actually changed — it renames the downloaded file and decides whether the Preview tab can run.',
            },
          },
          required: [],
        },
      },
    ],
  }];
};

/** The names this turn declared, so the executor can refuse anything else. */
export const canvasToolNames = (): Set<string> => new Set([CREATE_CANVAS, UPDATE_CANVAS]);

export const isCanvasToolCall = (name: string | undefined): boolean =>
  name === CREATE_CANVAS || name === UPDATE_CANVAS;

/**
 * The instruction block appended to the system prompt when Canvas is on.
 *
 * This is the "dynamically constructed system prompt" half of the feature, and
 * it exists to fix the two things tool descriptions cannot reach.
 *
 * The first is turn choreography. The card renders at the character offset where
 * the tool call happened — `CanvasRef.index`, mirroring how Gemini's wire format
 * puts a placeholder token inside the reply text rather than after it. So a model
 * that writes one line, calls the tool, and stops produces the layout Gemini has:
 * a sentence, then the card. A model that dumps four paragraphs first buries the
 * card, and one that says nothing at all produces a bare card with no lead-in.
 * Neither is expressible as a parameter, so it is said here.
 *
 * The second is the restating problem. Left alone, a model calls the tool and
 * then writes the document again into the reply, because that is what it does
 * with content it just produced. The result is the whole thing twice on screen.
 *
 * The third is the CLAIM WITHOUT A CALL, and it is the one weaker models fail:
 * "if I ask it to write something with the canvas tool used, it says 'I have
 * written…' i mean it says it has done it but the canvas doesnt appear at all. and
 * if I follow up saying it then it correctly appears". The turn is well formed
 * except that step 2 never happened — the model narrated the shape of a Canvas
 * turn without calling anything. A stronger model gets there from the tool
 * descriptions alone; a smaller one needs the rule stated as a rule, in the
 * imperative, near the top, which is what the "Non-negotiable" line below is.
 *
 * The fourth is EDIT SCOPE: "i asked it to make the bird red instead of yellow, it
 * would change the background, the pillars, and also the bird". `updates` already
 * makes a small change expressible as a small change, but a model handed both
 * `updates` and `content` will reach for `content` unless told plainly not to, and
 * a full rewrite of a document it is regenerating from memory drifts on every
 * detail it was not asked about.
 *
 * The report is the EVIDENCE for that rule, not its wording. This block ships to
 * every user and every turn, so it is phrased over the general case — one value,
 * one label, one line — rather than around the case that surfaced it. A prompt
 * carrying somebody's bird teaches the model that the rule is about birds.
 *
 * ## Why it also describes the document and the preview
 *
 * The block used to be turn choreography alone, on the theory that the tool
 * descriptions covered the rest. They cover the CALL; they cannot cover what the
 * document should be, and a model with no instruction there falls back to chat
 * habits — placeholders for the user to fill in, "…rest unchanged", a page that
 * imports three files that do not exist, a title that changes on every revision
 * (which loses the export filename and reads as a different document in the
 * thread).
 *
 * The preview section is the same argument with a harder edge: this runtime has
 * properties the model cannot infer. Only HTML previews, so anything else the user
 * wanted to *try* arrives as unrunnable code. And the frame withholds
 * `allow-same-origin`, so storage is an in-memory stand-in that does not survive a
 * reload — a document written to resume from a saved score works on the second run
 * and looks broken on the first. Saying so is cheaper than every model rediscovering
 * it, and the alternative was measured: a game whose first line read storage died
 * before it could attach a single listener.
 */
export const CANVAS_INSTRUCTIONS = `## Canvas

Canvas is on for this message. You can put a document into a side panel beside the conversation with the ${CREATE_CANVAS} and ${UPDATE_CANVAS} tools, and the user can read it there, edit it by hand, step through its versions and export it.

What belongs in a canvas: something the user will keep, work on or run — an essay, a report, a spec, a letter, a page or app they can try, a file of code. As a rule of thumb, more than about ten lines, and content they own rather than an answer they read once.

What does not: a direct answer, an explanation, a short snippet, a list, a plan for the conversation, or anything the discussion itself is about. Creating a document changes what is on screen, so an unnecessary one interrupts rather than helps. When you are unsure, answer in the conversation.

How a Canvas turn is shaped:
1. One or two sentences of your own, in the reply — what you are about to make, or what you changed and why. Not a summary of the content.
2. The tool call.
3. Nothing more, or at most one short line inviting the next step ("Tell me if you want it shorter.").

Non-negotiable: step 2 is a real tool call, and it is what creates the document. Writing the document into your reply does not create it, and neither does saying you made it. If your reply is going to contain "I've written", "I've created", "I've updated", "here it is" or anything else that claims a document exists, the ${CREATE_CANVAS} or ${UPDATE_CANVAS} call MUST be part of this same turn. A turn that claims a document and calls nothing shows the user an empty promise — they see your sentence and no document anywhere.

The document card appears in the thread exactly where you made the call, so anything you write before it sits above the card and anything after sits below. Keep step 1 short for that reason.

Rules:
- NEVER repeat the document's text in your reply. The user is reading it in the panel; saying it twice is the single worst failure mode here.
- Never put the document in a fenced code block in the reply as a substitute for calling the tool. If the tool is available, the document goes through the tool.
- One canvas call per turn. Do not create two documents in one message, and do not create then immediately update.
- A follow-up about a document that already exists is an ${UPDATE_CANVAS}, never a second ${CREATE_CANVAS} — that is what keeps the version history and the user's place in the panel.
- CHANGE ONLY WHAT WAS ASKED FOR, and scale the edit to the request: a change to one value, colour, label, string, function or line is one or two \`updates\` entries, not a new document. Everything the user did not raise stays byte-identical — do not restyle, rename, reformat, reorder, retune values, or add features, comments or polish nobody asked for. Rewriting a whole document for a narrow request is the most common way this feature loses the user's work: everything they were happy with changes at the same time, and none of it was asked for.
- Reach for \`content\` only when the change genuinely is the whole document: a reorganisation, a rewrite, a change of language or framework. If you cannot say which parts move, it is not one of those.
- If the user asks a question ABOUT the document rather than for a change to it, just answer. Not every turn while Canvas is on needs a tool call.
- The panel is editable, so the user may have changed the document since you wrote it. The current contents are what is quoted back to you, not what you last sent; anchor edits against that.

Writing the document itself:
- Give it a real title and keep that title stable across revisions. The title is how the user finds the document in the thread and it becomes the filename when they export it, so renaming it on a small edit loses them.
- Write the whole thing. No "[add your details here]", no "…rest unchanged", no notes to yourself, no sections left for the user to finish. What you send is what they have.
- Prose is Markdown and the panel renders it: headings, lists, tables, emphasis, links and fenced code all work inside the document.
- Code is ONE complete file that runs exactly as sent. No elided regions, no imports of files that do not exist, no dependency the document cannot fetch for itself. If a page needs styling and behaviour, inline them.
- Match the document to what was asked for and stop there: the length, the depth and the feature set are the user's to extend on the next turn.
- No inline citation markers in the document — no bracketed source ids trailing a sentence. The panel has no chips to turn them into, so they read as debris in the middle of the user's own text. Name a source in the prose where it matters, or list sources at the end.

The preview:
- A code document written as HTML runs live in the panel; any other language is shown as code only. So when the user asks for something they can try — a game, a tool, a demo — write it as a single HTML page.
- That preview runs in a sandbox with no access to the app around it, and browser storage there is a stand-in that does not survive a reload. A document may use storage, but it must work on a first run with none of it present, and it must not depend on anything persisting.
- Nothing in the preview can reach the network on the user's behalf beyond what the page itself loads. Prefer self-contained pages over ones that need an external service to be interesting.`;

/**
 * What the model is told about the documents this conversation already holds.
 *
 * Without this, `update_canvas` is unusable on a reloaded chat: ids were handed
 * out in tool results that live in a transcript the model may no longer be able
 * to see in full, and a model that cannot name a document creates a second one.
 * Titles and ids only — the content arrives with the message history.
 */
export const canvasContextBlock = (
  docs: Array<{ docId: string; title: string; kind: string; language?: string }>,
): string => {
  if (!docs.length) return '';
  const lines = docs.map((doc) => {
    const kind = doc.kind === 'code' ? `code${doc.language ? `, ${doc.language}` : ''}` : 'text';
    return `- ${doc.docId} — "${doc.title}" (${kind})`;
  });
  return `Canvas documents already in this conversation, newest last:\n${lines.join('\n')}\n\nTo revise one, call ${UPDATE_CANVAS} with its id.`;
};

/**
 * Coerce a tool call's arguments into an object.
 *
 * Providers disagree on whether arguments arrive parsed or as a JSON string, and
 * the same model can send either across a retry. `readQueryArgument` in
 * `@willow/personal` solves this for one scalar; Canvas takes several fields, so
 * the normalisation happens once, here, on the whole object.
 */
const asObject = (args: unknown): Record<string, unknown> => {
  if (typeof args === 'string') {
    const text = args.trim();
    if (!text.startsWith('{')) return {};
    try {
      return asObject(JSON.parse(text));
    } catch {
      return {};
    }
  }
  return args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
};

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

export interface CreateCanvasArgs {
  kind: 'text' | 'code';
  title: string;
  content: string;
  language?: string;
}

/**
 * Read a `create_canvas` call, or say why it is unusable.
 *
 * `type` is defaulted rather than required-on-pain-of-error: a model that sends
 * a title, content and no type has clearly asked for a document, and refusing
 * that costs a round trip to learn nothing. Content is the one field with no
 * sane default — an empty canvas is a bug the user has to look at.
 *
 * The `code`-fence strip is not defensive tidying. Models fence code by reflex,
 * and a leading ```` ```html ```` inside a code canvas is not a formatting nit:
 * it lands in the Preview iframe as literal text and breaks the running page.
 */
/*
 * Callers must test `parsed.ok === false`, not `!parsed.ok`.
 *
 * The repo compiles without `strictNullChecks` (see tsconfig.base.json), and with
 * it off TypeScript does not narrow a boolean-literal discriminant through a
 * truthiness test — `!parsed.ok` leaves the union intact and reading
 * `parsed.error` is then a compile error. An explicit `=== false` narrows fine.
 */
export const readCreateCanvasArgs = (
  args: unknown,
): { ok: true; value: CreateCanvasArgs } | { ok: false; error: string } => {
  const raw = asObject(args);
  const content = asString(raw.content);
  if (!content.trim()) {
    return { ok: false, error: 'No content was provided. Call again with the complete document in `content`.' };
  }
  const declared = asString(raw.type).toLowerCase();
  const language = asString(raw.language).toLowerCase().trim();
  const kind: 'text' | 'code' = declared === 'code' || (declared !== 'text' && !!language) ? 'code' : 'text';
  const title = asString(raw.title).trim() || (kind === 'code' ? 'Untitled code' : 'Untitled document');
  return {
    ok: true,
    value: {
      kind,
      title,
      content: kind === 'code'
        ? stripCanvasCodeFence(content)
        : stripCanvasCitationMarkers(content),
      ...(kind === 'code' && language ? { language } : {}),
    },
  };
};

export interface UpdateCanvasArgs {
  docId?: string;
  title?: string;
  language?: string;
  content?: string;
  updates?: CanvasEdit[];
}

/**
 * Read an `update_canvas` call.
 *
 * A call carrying neither `updates` nor `content` nor `title` is rejected: it is
 * the shape a model produces when it means "I have finished thinking about the
 * document", and applying it would append an identical version to the history,
 * which shows up as a Previous/Next step that changes nothing on screen.
 */
export const readUpdateCanvasArgs = (
  args: unknown,
): { ok: true; value: UpdateCanvasArgs } | { ok: false; error: string } => {
  const raw = asObject(args);
  const docId = asString(raw.doc_id ?? raw.docId).trim();
  const title = asString(raw.title).trim();
  const language = asString(raw.language).toLowerCase().trim();
  const content = asString(raw.content);
  const updates: CanvasEdit[] = (Array.isArray(raw.updates) ? raw.updates : [])
    .map((entry: any) => {
      const object = asObject(entry);
      return {
        find: asString(object.find ?? object.pattern ?? object.old_string),
        /* Stripped on the way in, like `content` below: a grounded model writes
           citation markers into the text it is inserting too, and an edit is how
           they would otherwise get into a document that started clean. `find` is
           NOT stripped — it has to match the document as it stands. */
        replace: stripCanvasCitationMarkers(asString(object.replace ?? object.replacement ?? object.new_string)),
        all: object.all === true || object.multiple === true,
      };
    })
    .filter((edit) => edit.find.length > 0);

  if (!updates.length && !content.trim() && !title && !language) {
    return {
      ok: false,
      error: 'Nothing to change. Pass `updates` with the edits to make, `content` for a full rewrite, or `title` to rename.',
    };
  }
  if (updates.length && content.trim()) {
    return {
      ok: false,
      error: 'Pass either `updates` or `content`, not both. Use `updates` unless the whole document is being restructured.',
    };
  }
  return {
    ok: true,
    value: {
      ...(docId ? { docId } : {}),
      ...(title ? { title } : {}),
      ...(language ? { language } : {}),
      ...(content.trim() ? { content: stripCanvasCitationMarkers(content) } : {}),
      ...(updates.length ? { updates } : {}),
    },
  };
};

/**
 * Strip a grounded model's inline citation markers out of a document.
 *
 * After a search, Gemini's models write markers into their own output —
 * `[1.1.9]`, `[1.1.2, 1.1.9, 1.3.4]` — naming the retrieved chunks a sentence came
 * from. In the REPLY those are handled: the chat renderer has the grounding
 * offsets and draws source chips. A canvas document has neither. It is a plain
 * string handed to a Markdown renderer, so the markers land in the user's essay
 * as literal text, mid-sentence, in every paragraph.
 *
 * ## What it matches, and what it must not
 *
 * Only bracket groups made ENTIRELY of ids with at least THREE numeric parts —
 * `1.1.9`, `1.3.4` — which is the shape the markers arrive in. `[1]`, `[1.5]`,
 * `[note]`, `[TODO]`, `arr[1]` and a Markdown link's `[label]` all survive. Two
 * parts is deliberately excluded: "see section [1.5]" is a cross-reference a user
 * may have written, and destroying real text to tidy a marker is the worse error.
 *
 * The line-start exemption is the case that would otherwise be destroyed: Keep a
 * Changelog writes `## [1.1.9] - 2026-01-01`, and a version heading is the whole
 * point of that line. A citation marker never opens a line — it trails the clause
 * it cites — so anchoring the strip to "not at the start of a line" keeps both.
 *
 * Leading whitespace goes with the marker and trailing punctuation stays, so
 * `…statements [1.1.2, 1.1.9].` closes up as `…statements.` rather than leaving a
 * gap before the full stop.
 */
const CITATION_MARKER = /[ \t]*\[\d+\.\d+\.\d+(?:\s*,\s*\d+\.\d+\.\d+)*\]/g;
/** The same group, anchored — a marker in this position is being kept, not stripped. */
const LEADING_MARKER = /^\[\d+\.\d+\.\d+(?:\s*,\s*\d+\.\d+\.\d+)*\]/;

export const stripCanvasCitationMarkers = (content: string): string => (
  content
    .split('\n')
    .map((line) => {
      /* Skip the line's Markdown furniture — heading hashes, list bullets, quote
         marks, ordered-list numbers — then keep a bracket group that opens what is
         left. That is a changelog's version heading, not a citation: a marker
         trails the clause it cites and never leads the line. */
      const head = /^[ \t>#*\-+.\d)]*/.exec(line);
      const at = head ? head[0].length : 0;
      if (at >= line.length) return line;
      const rest = line.slice(at);
      const leading = LEADING_MARKER.exec(rest);
      const keep = leading ? leading[0].length : 0;
      return line.slice(0, at) + rest.slice(0, keep) + rest.slice(keep).replace(CITATION_MARKER, '');
    })
    .join('\n')
);

/**
 * Peel one wrapping code fence off a code document.
 *
 * Only a fence that wraps the WHOLE thing is removed. A file that happens to
 * contain a fence — a markdown template inside a Python string, a README
 * generator — keeps it, which is why this checks the last line as well as the
 * first instead of stripping every ``` it sees.
 */
export const stripCanvasCodeFence = (content: string): string => {
  const text = content.trim();
  if (!text.startsWith('```')) return content;
  const firstBreak = text.indexOf('\n');
  if (firstBreak === -1) return content;
  // Anything on the opening line after the backticks is a language tag, not code.
  if (/[^`\w+#.-]/.test(text.slice(3, firstBreak).trim())) return content;
  const lastFence = text.lastIndexOf('```');
  if (lastFence <= firstBreak) return content;
  if (text.slice(lastFence + 3).trim()) return content;
  return text.slice(firstBreak + 1, lastFence).replace(/\n$/, '');
};

export interface CanvasEditFailure {
  find: string;
  reason: 'not-found' | 'ambiguous';
  /** How many times the anchor occurred, for the ambiguous case. */
  count?: number;
}

/**
 * Apply targeted edits to a document.
 *
 * Two decisions here are the whole reason this is a named function with tests
 * rather than a `reduce` at the call site.
 *
 * **An ambiguous anchor is a failure, not a first-match.** `find: "return null"`
 * in a file with four of them would silently edit whichever came first, and the
 * user's evidence would be a document that changed in the wrong place with no
 * error anywhere. Reporting the count back gets a retry with a longer anchor,
 * which is the outcome that was wanted.
 *
 * **Edits are spliced by index, never through `String.replace`.** A string
 * pattern still gives the replacement `$&`, `$1` and `$\`` their special
 * meanings, so a document containing `$&` — a shell script, a jQuery snippet, a
 * price table — would be corrupted by its own contents. `slice`/`slice` cannot
 * do that, and `split().join()` is safe for the same reason.
 *
 * Partial success is real and deliberate: three good edits and one bad anchor
 * applies the three. The alternative is asking the model to re-send all four,
 * which usually rewrites the three it had right.
 */
export const applyCanvasUpdates = (
  content: string,
  edits: CanvasEdit[],
): { content: string; applied: number; failures: CanvasEditFailure[] } => {
  let next = content;
  let applied = 0;
  const failures: CanvasEditFailure[] = [];

  for (const edit of edits) {
    const count = next.split(edit.find).length - 1;
    if (count === 0) {
      failures.push({ find: edit.find, reason: 'not-found' });
      continue;
    }
    if (count > 1 && !edit.all) {
      failures.push({ find: edit.find, reason: 'ambiguous', count });
      continue;
    }
    if (edit.all) {
      next = next.split(edit.find).join(edit.replace);
    } else {
      const at = next.indexOf(edit.find);
      next = next.slice(0, at) + edit.replace + next.slice(at + edit.find.length);
    }
    applied += 1;
  }

  return { content: next, applied, failures };
};

/**
 * What the model is told after an edit attempt.
 *
 * Failures are quoted back with their anchor truncated, because the useful
 * information is *which* anchor missed — a model told only "1 edit failed"
 * re-sends all of them. The instruction to re-anchor rather than rewrite is
 * explicit for the same reason: the default recovery from a failed edit is a
 * full-content call, which throws away the version history's readability.
 */
export const describeCanvasEditResult = (
  applied: number,
  failures: CanvasEditFailure[],
): string => {
  if (!failures.length) return `Applied ${applied} edit${applied === 1 ? '' : 's'}.`;
  const details = failures.map((failure) => {
    const anchor = failure.find.length > 60 ? `${failure.find.slice(0, 60)}…` : failure.find;
    return failure.reason === 'ambiguous'
      ? `- ${JSON.stringify(anchor)} occurs ${failure.count} times; include more surrounding text, or set "all": true if every occurrence should change.`
      : `- ${JSON.stringify(anchor)} was not found; copy the text exactly as it appears in the current document.`;
  });
  const head = applied
    ? `Applied ${applied} edit${applied === 1 ? '' : 's'}. ${failures.length} failed:`
    : `No edits were applied. ${failures.length} failed:`;
  return `${head}\n${details.join('\n')}\n\nRetry only the failed edits with better anchors. Do not resend the whole document.`;
};




