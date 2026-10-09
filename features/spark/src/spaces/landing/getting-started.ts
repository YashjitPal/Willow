import { useState } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { useLocation, useNavigate } from "react-router-dom";
import { usePageDocumentsStore } from "../editor/state/page-documents-store";
import { createPageId, emptyParagraph, text, type PageBlock, type PageInline, type PageMark } from "../editor/state/page-document";
import { openPage } from "../navigation";
import { mutationRoundTrip, usePageListEntries, usePagesEnabled, useSpacesStore } from "../state";
import { starterBodyGuideMessage } from "./getting-started-guide";

/** `st`: earlier titles of the guide, still recognized as the user's only Page. */
const legacyGuideTitles = ["Welcome to Space", "🚀 Getting started with pages", "Getting started with pages"];

/** `x9t`: the interactive demos the guide embeds. */
const welcomeDemos = {
  savings: "page-asset:welcome-savings-v1",
  solar: "page-asset:welcome-solar-v1",
  piano: "page-asset:welcome-piano-v1",
};

/** `it` */
export function gettingStartedPageTitle(intl: IntlShape) {
  return intl.formatMessage({
    id: "space.gettingStartedPages.pageTitle",
    defaultMessage: "Your guide to pages",
    description: "Title of the introductory Getting Started Page",
  });
}

/** `p9t`: Markdown image that embeds a visualization. */
function visualizationMarkdown(assetId: string, title: string) {
  return `![${title.replace(/\s+/gu, " ").replace(/[\\`*_[\]<>]/gu, "\\$&")}](visualize:${assetId})`;
}

/** `at`: the guide's starter Markdown. */
function starterMarkdown(intl: IntlShape) {
  return intl.formatMessage(starterBodyGuideMessage, {
    savings: visualizationMarkdown(
      welcomeDemos.savings,
      intl.formatMessage({
        id: "space.welcome.demo.savingsAlt",
        defaultMessage: "Savings growth calculator",
        description: "Accessible title for the embedded interactive savings calculator in the Welcome Page",
      }),
    ),
    solar: visualizationMarkdown(
      welcomeDemos.solar,
      intl.formatMessage({
        id: "space.welcome.demo.solarAlt",
        defaultMessage: "Solar system explorer",
        description: "Accessible title for the embedded interactive solar system in the Welcome Page",
      }),
    ),
    piano: visualizationMarkdown(
      welcomeDemos.piano,
      intl.formatMessage({
        id: "space.welcome.demo.pianoAlt",
        defaultMessage: "Mini Piano",
        description: "Accessible title for the embedded playable piano in the Welcome Page",
      }),
    ),
  });
}

function parseInline(source: string): PageInline[] {
  const runs: PageInline[] = [];
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`/gu;
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) runs.push(text(source.slice(last, index)));
    const [, bold, italic, code] = match;
    const [value, mark]: [string, PageMark] = bold != null ? [bold, "bold"] : italic != null ? [italic, "italic"] : [code ?? "", "code"];
    runs.push(text(value, [mark]));
    last = index + match[0].length;
  }
  if (last < source.length) runs.push(text(source.slice(last)));
  return runs;
}

function unescapeMarkdown(value: string) {
  return value.replace(/\\(.)/gu, "$1");
}

/** Projects the starter Markdown onto the Page document; each checklist item is followed by an empty line, as in `at`. */
function starterBlocks(markdown: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  for (const chunk of markdown.split(/\n{2,}/u)) {
    const id = createPageId("block");
    const callout = /^> \[!CALLOUT\] (\S+)\n((?:>.*\n?)*)$/u.exec(chunk);
    const fence = /^```(\S*)\n([\s\S]*?)\n```$/u.exec(chunk);
    const visualization = /^!\[(.*)\]\(visualize:(.+)\)$/u.exec(chunk);
    if (callout) {
      const body = callout[2]
        .split("\n")
        .map((line) => line.replace(/^> ?/u, ""))
        .join("\n")
        .trim();
      blocks.push({ id, type: "callout", emoji: callout[1], content: parseInline(body) });
    } else if (fence) {
      blocks.push({ id, type: "code_block", lang: fence[1] || null, text: fence[2] });
    } else if (visualization) {
      blocks.push({ id, type: "page_visualization", fileId: visualization[2], title: unescapeMarkdown(visualization[1]), status: "ready" });
    } else if (chunk === "---") {
      blocks.push({ id, type: "horizontal_rule" });
    } else if (chunk.startsWith("## ")) {
      blocks.push({ id, type: "heading", level: 2, content: parseInline(chunk.slice(3)) });
    } else if (chunk.startsWith("- [ ] ")) {
      blocks.push({ id, type: "list", task: true, items: [{ id: createPageId("item"), content: parseInline(chunk.slice(6)), checked: false }] });
      blocks.push(emptyParagraph());
    } else if (chunk.trim()) {
      blocks.push({ id, type: "paragraph", content: parseInline(chunk) });
    }
  }
  return blocks;
}

/**
 * `vt` / `ut` / `dt` / `lt` (state-7c58121ceae9 chunk): whether to offer the welcome card, and opening the guide,
 * which creates it as a Personal Page on first use.
 */
export function useGettingStartedCard() {
  const intl = useIntl();
  const navigate = useNavigate();
  const location = useLocation();
  const pagesEnabled = usePagesEnabled();
  const entries = usePageListEntries();
  const [opening, setOpening] = useState(false);

  const title = gettingStartedPageTitle(intl);
  const firstTitle = entries?.[0]?.page.title;
  const visible =
    pagesEnabled &&
    entries != null &&
    (entries.length === 0 ||
      (entries.length === 1 && (firstTitle === title || firstTitle === "Your guide to pages" || legacyGuideTitles.some((legacy) => firstTitle === legacy))));

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const store = useSpacesStore.getState();
      const existing = store.welcomePageId == null ? undefined : store.pages[store.welcomePageId];
      let pageId = existing != null && existing.deleted_at == null ? existing.page_id : null;
      if (pageId == null) {
        await mutationRoundTrip();
        const page = useSpacesStore.getState().createPage({ title });
        usePageDocumentsStore.getState().setBlocks(page.page_id, starterBlocks(starterMarkdown(intl)));
        useSpacesStore.setState({ welcomePageId: page.page_id });
        pageId = page.page_id;
      }
      openPage(navigate, location, pageId);
    } finally {
      setOpening(false);
    }
  };

  return { visible: visible || opening, opening, open };
}
