import { Component, type ReactNode, lazy } from "react";
import { preload } from "react-dom";
import { getCharacterFrameUrl } from "../orbit/character-frame";
import type { CharacterEditorProps } from "./character-editor";
import { EditorPlaceholder } from "./editor-placeholder";

let editorChunk: Promise<{ default: typeof import("./character-editor").CharacterEditor }> | null = null;
function loadCharacterEditor() {
  editorChunk ??= import("./character-editor").then((module) => ({ default: module.CharacterEditor }));
  return editorChunk;
}

const CharacterEditorChunk = lazy(loadCharacterEditor);

/** Starts loading the editor and the orbit runtime before the editor opens. */
export function prefetchCharacterEditor() {
  if (typeof document === "undefined") return;
  const frameUrl = getCharacterFrameUrl();
  loadCharacterEditor().catch(() => {});
  for (const extension of ["mjs", "wasm", "data"]) {
    preload(new URL(`../runtime/orbit-characters.${extension}`, new URL(frameUrl, document.baseURI)).href, { as: "fetch", crossOrigin: "anonymous" });
  }
}

class EditorChunkBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Suspends to the nearest `Suspense` while the editor chunk loads. */
export function LazyCharacterEditor(props: CharacterEditorProps) {
  return (
    <EditorChunkBoundary fallback={<EditorPlaceholder title={props.title} footer={props.footer} onCreatePet={props.onCreatePet} error />}>
      <CharacterEditorChunk {...props} />
    </EditorChunkBoundary>
  );
}
