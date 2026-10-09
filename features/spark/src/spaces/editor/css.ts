import type { CSSProperties } from "react";

/** `editor.module` (`t_19` / `t_1` in the page chunks). */
export const pageCss = {
  PageContent: "_PageContent_1vjxe_2",
  PageDocument: "_PageDocument_1vjxe_2",
  PageReadingWidthMeasure: "_PageReadingWidthMeasure_1vjxe_2",
  PageReadingColumn: "_PageReadingColumn_1vjxe_2",
  PageControlFrame: "_PageControlFrame_1vjxe_2",
  PageDisclosureControl: "_PageDisclosureControl_1vjxe_2",
  PageDocumentTheme: "_PageDocumentTheme_1vjxe_2",
  PagePreview: "_PagePreview_1vjxe_2",
  PageTitle: "_PageTitle_1vjxe_2",
} as const;

/** `writing-block-editor-styles` module (`root` is `_editor_rqm7c_8`). */
export const writingBlockCss = {
  root: "_editor_rqm7c_8",
  page: "_page_rqm7c_834",
  content: "_content_rqm7c_912",
  tableFloatingUi: "_tableFloatingUi_rqm7c_135",
} as const;

/** Table controls module (`JB` in the page content chunk). */
export const tableControlsCss = {
  backdrop: "_backdrop_1up4f_2",
  axis: "_axis_1up4f_2",
  label: "_label_1up4f_2",
  resize: "_resize_1up4f_2",
  add: "_add_1up4f_2",
  toolbar: "_toolbar_1up4f_2",
} as const;

/** Inline mention pill module (`I7` in app-shared), used by task mention chips. */
export const mentionCss = {
  Mention: "_Mention_rqv78_2",
  Label: "_Label_rqv78_2",
  IconContainer: "_IconContainer_rqv78_2",
  Icon: "_Icon_rqv78_2",
} as const;

/** `writing-block-theme`: CSS variables set on every writing-block editor root. */
export const writingBlockTheme = {
  "--oai-wb-spacing": "var(--spacing,0.25rem)",
  "--oai-wb-text-primary": "var(--wb-text-primary,var(--color-token-text-primary,var(--text-primary,#0d0d0d)))",
  "--oai-wb-text-secondary": "var(--wb-text-secondary,var(--color-token-text-secondary,var(--text-secondary,#5d5d5d)))",
  "--oai-wb-text-tertiary": "var(--wb-text-tertiary,var(--color-token-text-tertiary,var(--text-tertiary,#8f8f8f)))",
  "--oai-wb-surface-primary": "var(--wb-surface-primary,var(--color-token-main-surface-primary,var(--main-surface-primary,#fff)))",
  "--oai-wb-surface-secondary": "var(--wb-surface-secondary,var(--color-token-bg-tertiary,var(--main-surface-secondary,#f5f5f5)))",
  "--oai-wb-interactive-secondary-hover": "var(--wb-interactive-secondary-hover,var(--color-token-interactive-bg-secondary-hover,var(--oai-wb-surface-secondary)))",
  "--oai-wb-border": "var(--wb-border,var(--color-token-border,var(--border-light,rgb(0 0 0/8%))))",
  "--oai-wb-border-hover": "var(--wb-border-hover,var(--color-token-border-default,var(--border-medium,rgb(0 0 0/12%))))",
  "--oai-wb-divider": "var(--wb-divider,var(--color-token-border-light,var(--border-light,rgb(0 0 0/5%))))",
  "--oai-wb-focus": "var(--wb-focus,var(--color-token-focus-border,var(--border-strong,#5b9dd9)))",
  "--oai-wb-control-border": "var(--wb-control-border,var(--interactive-border-focus,var(--oai-wb-focus)))",
  "--oai-wb-entity-accent": "var(--wb-entity-accent,var(--theme-entity-accent,var(--oai-wb-accent)))",
  "--oai-wb-accent": "var(--wb-accent,var(--interactive-label-accent-default,#0285ff))",
  "--oai-wb-on-accent": "var(--wb-on-accent,var(--bg-primary,#fff))",
  "--oai-wb-interactive-background": "var(--wb-interactive-background,var(--interactive-bg-accent-default,color-mix(in srgb,#0285ff 12%,transparent)))",
  "--oai-wb-selection": "var(--wb-selection,var(--theme-user-selection-bg,var(--selection,#93c5fd)))",
  "--oai-wb-radius": "var(--wb-radius,1.5rem)",
  "--oai-wb-radius-sm": "var(--wb-radius-sm,0.5rem)",
  "--oai-wb-shadow": "var(--wb-shadow,0 4px 80px rgb(0 0 0/2%))",
  "--oai-wb-shadow-lg": "var(--wb-shadow-lg,0 10px 30px rgb(0 0 0/12%))",
  "--oai-wb-font-sans": "var(--wb-font-sans,var(--font-sans,sans-serif))",
  "--oai-wb-font-mono": "var(--wb-font-mono,var(--font-mono,monospace))",
  "--oai-wb-font-size": "var(--wb-font-size,0.875rem)",
  "--oai-wb-shimmer-dark-contrast": "var(--wb-shimmer-dark-contrast,var(--oai-wb-text-tertiary))",
  "--oai-wb-shimmer-dark-secondary": "var(--wb-shimmer-dark-secondary,var(--oai-wb-text-tertiary))",
} as CSSProperties;

/** Ring glyph shown beside a bot's block attribution (`V4` in app-initial). */
export const dotAttributionIconSrc =
  "data:image/svg+xml,%3csvg%20width='1024'%20height='1024'%20viewBox='102%20102%20820%20820'%20fill='%23BAC1D3'%20xmlns='http://www.w3.org/2000/svg'%3e%3cpath%20d='M512%20102C738.437%20102%20922%20285.563%20922%20512C922%20738.437%20738.437%20922%20512%20922C285.563%20922%20102%20738.437%20102%20512C102%20285.563%20285.563%20102%20512%20102ZM512%20349.796C422.417%20349.796%20349.796%20422.417%20349.796%20512C349.796%20601.583%20422.417%20674.204%20512%20674.204C601.583%20674.204%20674.204%20601.583%20674.204%20512C674.204%20422.417%20601.583%20349.796%20512%20349.796Z'/%3e%3c/svg%3e";
