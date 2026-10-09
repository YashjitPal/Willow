import { RunId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ChangedFilesCard, ChangedFilesTree } from "./ChangedFilesTree";

// Willow's agent tabs draw this card as the Codex app's end-of-turn summary (TurnDiffCard).
describe("ChangedFilesCard", () => {
  it("names one changed file in the singular, with its stats and View changes", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        runId={RunId.make("run-1")}
        files={[{ path: "README.md", kind: "modified", additions: 2, deletions: 1 }]}
        allDirectoriesExpanded
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain('data-changed-files-state="list"');
    expect(markup).toContain("View changes");
    expect(markup).toContain("+2");
    expect(markup).toContain("-1");
    expect(markup).toContain("1 file changed");
    expect(markup).not.toContain("1 files changed");
  });

  it("lists three files and keeps the rest behind Show more", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        runId={RunId.make("run-1")}
        files={[
          { path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 },
          { path: "apps/web/src/App.test.tsx", kind: "modified", additions: 30, deletions: 2 },
          {
            path: "packages/shared/src/git.ts",
            kind: "modified",
            additions: 15,
            deletions: 4,
          },
          { path: "README.md", kind: "modified", additions: 3, deletions: 0 },
        ]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain("4 files changed");
    expect(markup).toContain("App.tsx");
    expect(markup).toContain("App.test.tsx");
    expect(markup).toContain("git.ts");
    expect(markup).not.toContain(">README.md<");
    expect(markup).toContain("Show 1 more file");
  });

  it("shows a file's name and its folder apart", () => {
    const markup = renderToStaticMarkup(
      <ChangedFilesCard
        runId={RunId.make("run-1")}
        files={[{ path: "apps/web/src/App.tsx", kind: "modified", additions: 120, deletions: 20 }]}
        allDirectoriesExpanded={false}
        resolvedTheme="light"
        onToggleAllDirectories={() => {}}
        onOpenTurnDiff={() => {}}
      />,
    );

    expect(markup).toContain("1 file changed");
    expect(markup).toContain(">App.tsx<");
    expect(markup).toContain(">apps/web/src<");
    expect(markup).not.toContain("Show 1 more");
  });
});

describe("ChangedFilesTree", () => {
  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src"],
      hiddenLabels: ["index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: ["apps/server/src"],
      hiddenLabels: ["git", "provider", "GitCore.ts", "CodexAdapter.ts"],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: ["README.md", "packages"],
      hiddenLabels: ["shared/src", "contracts/src", "git.ts", "orchestration.ts"],
    },
  ])(
    "renders $name collapsed on the first render when collapse-all is active",
    ({ files, visibleLabels, hiddenLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          runId={RunId.make("turn-1")}
          files={files}
          allDirectoriesExpanded={false}
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
      for (const label of hiddenLabels) {
        expect(markup).not.toContain(label);
      }
    },
  );

  it.each([
    {
      name: "a compacted single-chain directory",
      files: [
        { path: "apps/web/src/index.ts", kind: "modified", additions: 2, deletions: 1 },
        { path: "apps/web/src/main.ts", kind: "modified", additions: 3, deletions: 0 },
      ],
      visibleLabels: ["apps/web/src", "index.ts", "main.ts"],
    },
    {
      name: "a branch point after a compacted prefix",
      files: [
        {
          path: "apps/server/src/git/Layers/GitCore.ts",
          kind: "modified",
          additions: 4,
          deletions: 3,
        },
        {
          path: "apps/server/src/provider/Layers/CodexAdapter.ts",
          kind: "modified",
          additions: 7,
          deletions: 2,
        },
      ],
      visibleLabels: [
        "apps/server/src",
        "git/Layers",
        "provider/Layers",
        "GitCore.ts",
        "CodexAdapter.ts",
      ],
    },
    {
      name: "mixed root files and nested compacted directories",
      files: [
        { path: "README.md", kind: "modified", additions: 1, deletions: 0 },
        { path: "packages/shared/src/git.ts", kind: "modified", additions: 8, deletions: 2 },
        {
          path: "packages/contracts/src/orchestration.ts",
          kind: "modified",
          additions: 13,
          deletions: 3,
        },
      ],
      visibleLabels: [
        "README.md",
        "packages",
        "shared/src",
        "contracts/src",
        "git.ts",
        "orchestration.ts",
      ],
    },
  ])(
    "renders $name expanded on the first render when expand-all is active",
    ({ files, visibleLabels }) => {
      const markup = renderToStaticMarkup(
        <ChangedFilesTree
          runId={RunId.make("turn-1")}
          files={files}
          allDirectoriesExpanded
          resolvedTheme="light"
          onOpenTurnDiff={() => {}}
        />,
      );

      for (const label of visibleLabels) {
        expect(markup).toContain(label);
      }
    },
  );
});
