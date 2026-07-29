import React, { useEffect, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import 'katex/contrib/mhchem';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import 'katex/dist/katex.min.css';
import { MaterialSymbol } from './MaterialSymbol';

const STYLE_ID = 'streaming-markdown-styles';
const STREAM_FADE_MS = 400;

const STYLE_CSS = [
  '@keyframes smd-fade-in-text {',
  '  from { opacity: 0; }',
  '  to { opacity: 1; }',
  '}',
  '@keyframes smd-media-drift {',
  '  0%, 100% { transform: translate3d(-8%, -5%, 0) scale(1); }',
  '  50% { transform: translate3d(8%, 7%, 0) scale(1.08); }',
  '}',
  '.smd-root {',
  '  display: flex;',
  '  min-width: 0;',
  '  max-width: 100%;',
  '  flex-direction: column;',
  '  gap: 16px;',
  '  color: rgb(227, 227, 227);',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 17px;',
  '  font-weight: 400;',
  '  line-height: 24px;',
  '  overflow-wrap: break-word;',
  '  text-rendering: auto;',
  '  white-space: pre-wrap;',
  '  word-break: auto-phrase;',
  '}',
  '.smd-root > :first-child { margin-top: 0 !important; }',
  '.smd-root > :last-child { margin-bottom: 0 !important; }',
  '.smd-root p { margin: 0; white-space: pre-wrap; }',
  '.smd-streaming {',
  '  --animation-duration: 400ms;',
  '  --fade-animation-function: ease-out;',
  '}',
  '.smd-streaming .smd-w,',
  '.smd-streaming .smd-h,',
  '.smd-streaming .smd-code-block,',
  '.smd-streaming .smd-svg-preview-block,',
  '.smd-streaming .smd-table-block,',
  '.smd-streaming .smd-media-gallery,',
  '.smd-streaming .smd-math-display {',
  '  animation-duration: var(--animation-duration);',
  '  animation-fill-mode: forwards;',
  '  animation-iteration-count: 1;',
  '  animation-name: smd-fade-in-text;',
  '  animation-timing-function: var(--fade-animation-function);',
  '}',
  '.smd-streaming .smd-settled { animation: none; }',
  '.smd-heading {',
  '  color: rgb(227, 227, 227);',
  '  padding: 0;',
  '  white-space: pre-wrap;',
  '}',
  '.smd-heading-1 { font-size: 28px; font-weight: 350; line-height: 36px; margin: 24px 0 0; }',
  '.smd-heading-2 { font-size: 24px; font-weight: 380; line-height: 28px; margin: 24px 0 0; }',
  '.smd-heading-3, .smd-heading-4, .smd-heading-5, .smd-heading-6 { font-size: 20px; font-weight: 470; line-height: 24px; margin: 24px 0 -8px; }',
  '.smd-heading-1 + .smd-heading-2 { margin-top: 8px; }',
  '.smd-heading-2 + .smd-heading-3,',
  '.smd-heading-3 + .smd-heading-4,',
  '.smd-heading-4 + .smd-heading-5,',
  '.smd-heading-5 + .smd-heading-6 { margin-top: 0; }',
  '.smd-link {',
  '  color: rgb(230, 230, 230);',
  '  text-decoration-line: underline;',
  '  text-decoration-style: dotted;',
  '  text-decoration-thickness: 1.36px;',
  '  text-decoration-color: rgb(230, 230, 230);',
  '  text-underline-offset: 3.91px;',
  '}',
  '.smd-link:hover { color: #ffffff; text-decoration-color: #ffffff; }',
  '.smd-inline-code {',
  '  display: inline;',
  '  border-radius: 9999px;',
  '  background: rgb(23, 23, 23);',
  '  color: rgba(255, 255, 255, 0.55);',
  '  font-family: "Google Sans Code", ui-monospace, SFMono-Regular, Consolas, monospace;',
  '  font-size: 15px;',
  '  font-weight: 400;',
  '  line-height: 20px;',
  '  padding: 4px 6px;',
  '  white-space: break-spaces;',
  '}',
  '.smd-list {',
  '  display: block;',
  '  margin: 0;',
  '  padding: 0 0 0 3.36px;',
  '  list-style: none;',
  '}',
  '.smd-list-ordered { padding-left: 4px; }',
  '.smd-list > li {',
  '  position: relative;',
  '  margin: 0;',
  '  padding: 0 0 0 36px;',
  '  list-style: none;',
  '}',
  '.smd-list > li + li { margin-top: 12px; }',
  '.smd-list-unordered > li::before {',
  '  position: absolute;',
  '  top: 7.5px;',
  '  left: 0;',
  '  width: 9px;',
  '  height: 9px;',
  '  background: currentColor;',
  '  content: "";',
  '  -webkit-mask-image: url("data:image/svg+xml,%3Csvg width=%229%22 height=%229%22 viewBox=%220 0 9 9%22 fill=%22none%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ccircle cx=%224.2998%22 cy=%224.30005%22 r=%223.65%22 stroke=%22currentColor%22 stroke-width=%221.3%22/%3E%3C/svg%3E");',
  '  mask-image: url("data:image/svg+xml,%3Csvg width=%229%22 height=%229%22 viewBox=%220 0 9 9%22 fill=%22none%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ccircle cx=%224.2998%22 cy=%224.30005%22 r=%223.65%22 stroke=%22currentColor%22 stroke-width=%221.3%22/%3E%3C/svg%3E");',
  '  -webkit-mask-repeat: no-repeat;',
  '  mask-repeat: no-repeat;',
  '  -webkit-mask-size: contain;',
  '  mask-size: contain;',
  '}',
  '.smd-list-ordered > li { counter-increment: smd-list-item; }',
  '.smd-list-ordered > li::before {',
  '  position: absolute;',
  '  top: 0;',
  '  left: 0;',
  '  width: 24px;',
  '  height: 24px;',
  '  content: counter(smd-list-item) ".";',
  '}',
  '.smd-list .smd-list-ordered > li::before { content: counter(smd-list-item, lower-alpha) "."; }',
  '.smd-list .smd-list-ordered .smd-list-ordered > li::before { content: counter(smd-list-item, lower-roman) "."; }',
  '.smd-list-content {',
  '  display: flex;',
  '  min-width: 0;',
  '  flex-direction: column;',
  '  gap: 0;',
  '}',
  '.smd-list-content > .smd-paragraph { padding-left: 4px; }',
  '.smd-list-content > .smd-list { margin-top: 12px; }',
  '.smd-task-item::before { display: none !important; }',
  '.smd-task-box {',
  '  position: absolute;',
  '  top: 3px;',
  '  left: 0;',
  '  display: inline-flex;',
  '  width: 18px;',
  '  height: 18px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 1px solid rgba(227, 227, 227, 0.55);',
  '  border-radius: 4px;',
  '  color: rgb(23, 23, 23);',
  '}',
  '.smd-task-box[data-checked="true"] { background: rgb(227, 227, 227); }',
  '.smd-blockquote { display: block; margin: 0; padding: 0; border: 0; color: inherit; }',
  '.smd-hr {',
  '  width: 100%;',
  '  height: 1px;',
  '  margin: 8px 0;',
  '  border: 0;',
  '  background: rgba(255, 255, 255, 0.12);',
  '}',
  '.smd-math-inline {',
  '  display: inline;',
  '  vertical-align: baseline;',
  '}',
  '.smd-math-display {',
  '  width: 100%;',
  '  max-width: 100%;',
  '  overflow: auto;',
  '  padding: 0;',
  '  text-align: start;',
  '}',
  '.smd-math-display .katex-display { margin: 24px 0; text-align: center; }',
  '.smd-math-display .katex { font-size: 24px; line-height: 1.2; }',
  '.smd-math-error {',
  '  color: #ffb4ab;',
  '  font-family: "Google Sans Code", ui-monospace, monospace;',
  '  font-size: 15px;',
  '}',
  '.smd-code-block {',
  '  position: relative;',
  '  min-width: 0;',
  '  margin: 16px -16px 0;',
  '  overflow: clip;',
  '  border-radius: 40px;',
  '  background: rgb(23, 23, 23);',
  '  padding: 26px 0 32px 32px;',
  '}',
  '.smd-code-header {',
  '  position: sticky;',
  '  top: 0;',
  '  z-index: 2;',
  '  display: flex;',
  '  width: 100%;',
  '  height: 36px;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  background: rgb(23, 23, 23);',
  '  padding: 0 11px 0 0;',
  '  color: rgb(255, 255, 255);',
  '}',
  '.smd-code-language {',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 15px;',
  '  font-weight: 540;',
  '  line-height: 20px;',
  '}',
  '.smd-code-buttons { display: flex; width: 72px; height: 36px; }',
  '.smd-icon-button {',
  '  display: inline-flex;',
  '  width: 36px;',
  '  height: 36px;',
  '  flex: 0 0 36px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: transparent;',
  '  color: rgb(255, 255, 255);',
  '  cursor: pointer;',
  '  padding: 6px;',
  '}',
  '.smd-icon-button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-icon-button:focus-visible { outline: 2px solid rgba(138, 180, 248, 0.9); outline-offset: 1px; }',
  '.smd-code-scroll { width: 100%; overflow: auto; }',
  '.smd-code-pre {',
  '  width: 100%;',
  '  margin: 0;',
  '  padding: 0;',
  '  overflow: visible;',
  '  background: transparent;',
  '  white-space: pre;',
  '}',
  '.smd-code-pre code {',
  '  display: block;',
  '  min-width: max-content;',
  '  padding: 16px 32px 0 0;',
  '  background: transparent;',
  '  color: rgb(255, 255, 255);',
  '  font-family: "Google Sans Code", ui-monospace, SFMono-Regular, Consolas, monospace;',
  '  font-size: 14px;',
  '  font-weight: 400;',
  '  line-height: 21px;',
  '  tab-size: 4;',
  '}',
  '.smd-code-block .hljs { color: rgb(255, 255, 255); background: transparent; }',
  '.smd-code-block .hljs-comment, .smd-code-block .hljs-quote { color: rgb(128, 128, 128); }',
  '.smd-code-block .hljs-keyword, .smd-code-block .hljs-selector-id, .smd-code-block .hljs-selector-class { color: rgb(150, 157, 255); }',
  '.smd-code-block .hljs-string, .smd-code-block .hljs-regexp, .smd-code-block .hljs-addition, .smd-code-block .hljs-template-tag { color: rgb(96, 214, 115); }',
  '.smd-code-block .hljs-number, .smd-code-block .hljs-literal, .smd-code-block .hljs-attr, .smd-code-block .hljs-variable, .smd-code-block .hljs-template-variable { color: rgb(255, 150, 218); }',
  '.smd-code-block .hljs-title, .smd-code-block .hljs-title.function_, .smd-code-block .hljs-section { color: rgb(255, 219, 15); }',
  '.smd-code-block .hljs-name, .smd-code-block .hljs-selector-tag { color: rgb(79, 160, 255); }',
  '.smd-code-block .hljs-meta, .smd-code-block .hljs-built_in, .smd-code-block .hljs-builtin-name, .smd-code-block .hljs-deletion { color: rgb(255, 90, 89); }',
  '.smd-code-block .hljs-meta .hljs-keyword { color: rgb(255, 90, 89); font-weight: 700; }',
  '.smd-svg-preview-block {',
  '  width: 100%;',
  '  min-width: 0;',
  '  overflow: hidden;',
  '  box-sizing: border-box;',
  '  border: 0.8px solid rgb(68, 71, 70);',
  '  border-radius: 12px;',
  '  background: transparent;',
  '  color: rgb(196, 199, 197);',
  '}',
  '.smd-svg-preview-toolbar {',
  '  display: flex;',
  '  width: 100%;',
  '  height: 56px;',
  '  box-sizing: border-box;',
  '  align-items: center;',
  '  justify-content: space-between;',
  '  background: rgb(30, 31, 32);',
  '  padding: 8px 8px 8px 16px;',
  '}',
  '.smd-svg-preview-label {',
  '  color: rgb(196, 199, 197);',
  '  font-family: "Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif;',
  '  font-size: 14px;',
  '  font-weight: 500;',
  '  line-height: 24px;',
  '}',
  '.smd-svg-preview-actions { display: flex; height: 40px; gap: 4px; }',
  '.smd-svg-preview-button {',
  '  display: inline-flex;',
  '  width: 40px;',
  '  height: 40px;',
  '  flex: 0 0 40px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: transparent;',
  '  color: rgb(196, 199, 197);',
  '  cursor: pointer;',
  '  padding: 8px;',
  '}',
  '.smd-svg-preview-button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-svg-preview-button:focus-visible { outline: 2px solid rgba(138, 180, 248, 0.9); outline-offset: 1px; }',
  '.smd-svg-preview-canvas { width: 100%; height: 400px; background: rgb(19, 19, 20); }',
  '.smd-svg-preview-frame { display: block; width: 100%; height: 100%; border: 0; background: transparent; }',
  '.smd-table-block { position: relative; width: 100%; min-width: 0; }',
  '.smd-table-content { overflow: auto; padding: 8px 0; }',
  '.smd-table-block.has-scrollbar .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '}',
  '.smd-table-block.has-scrollbar.is-at-scroll-start .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, #000, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '  mask-image: linear-gradient(90deg, #000, #000 calc(100% - 48px), rgba(0, 0, 0, 0.2));',
  '}',
  '.smd-table-block.has-scrollbar.is-at-scroll-end .smd-table-content {',
  '  -webkit-mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000);',
  '  mask-image: linear-gradient(90deg, rgba(0, 0, 0, 0.2), #000 48px, #000);',
  '}',
  '.smd-table { width: 100%; min-width: max-content; border-collapse: separate; border-spacing: 0; }',
  '.smd-table th, .smd-table td {',
  '  position: relative;',
  '  width: 173px;',
  '  min-width: 173px;',
  '  max-width: 320px;',
  '  vertical-align: top;',
  '  color: rgb(227, 227, 227);',
  '  font: inherit;',
  '  font-weight: 400;',
  '  text-align: left;',
  '  white-space: normal;',
  '}',
  '.smd-table th { padding: 12px 12px 16px; }',
  '.smd-table td { padding: 16px 12px; }',
  '.smd-table th:first-child { padding-left: 0; }',
  '.smd-table th:last-child { padding-right: 0; }',
  '.smd-table td:first-child { padding-left: 0; }',
  '.smd-table td:last-child { padding-right: 0; }',
  '.smd-table thead th::after,',
  '.smd-table tbody tr:not(:last-child) > td::after {',
  '  position: absolute;',
  '  right: 12px;',
  '  bottom: 0;',
  '  left: 12px;',
  '  height: 1px;',
  '  background: rgba(255, 255, 255, 0.12);',
  '  content: "";',
  '}',
  '.smd-table tr > :first-child::after { left: 0; }',
  '.smd-table tr > :last-child::after { right: 0; }',
  '.smd-table-footer {',
  '  position: relative;',
  '  display: flex;',
  '  height: 20px;',
  '  align-items: center;',
  '  justify-content: flex-start;',
  '  margin-top: 10px;',
  '}',
  '.smd-table-menu-trigger {',
  '  display: inline-flex;',
  '  width: 32px;',
  '  height: 20px;',
  '  align-items: center;',
  '  justify-content: center;',
  '  border: 0;',
  '  border-radius: 9999px;',
  '  background: rgb(23, 23, 23);',
  '  color: rgb(230, 230, 230);',
  '  cursor: pointer;',
  '  padding: 0;',
  '}',
  '.smd-table-menu-trigger:hover { background: rgb(42, 42, 42); }',
  '.smd-table-menu {',
  '  position: absolute;',
  '  top: 28px;',
  '  left: 0;',
  '  z-index: 20;',
  '  width: 188px;',
  '  height: 96px;',
  '  box-sizing: border-box;',
  '  overflow: hidden;',
  '  border: 0;',
  '  border-radius: 20px;',
  '  background: rgb(31, 31, 31);',
  '  box-shadow: none;',
  '  padding: 8px;',
  '}',
  '.smd-table-menu button {',
  '  display: flex;',
  '  width: 100%;',
  '  height: 40px;',
  '  align-items: center;',
  '  gap: 8px;',
  '  border: 0;',
  '  border-radius: 12px;',
  '  background: transparent;',
  '  color: rgb(230, 230, 230);',
  '  cursor: pointer;',
  '  font: inherit;',
  '  font-size: 13px;',
  '  line-height: 17px;',
  '  padding: 0 8px;',
  '  text-align: left;',
  '}',
  '.smd-table-menu button:hover { background: rgba(255, 255, 255, 0.08); }',
  '.smd-media-gallery {',
  '  display: grid;',
  '  width: 100%;',
  '  grid-template-columns: repeat(2, minmax(0, 1fr));',
  '  gap: 8px;',
  '}',
  '.smd-media-gallery[data-count="1"] { grid-template-columns: minmax(0, 1fr); }',
  '.smd-media-card {',
  '  display: block;',
  '  width: 100%;',
  '  min-width: 0;',
  '  border: 0;',
  '  background: transparent;',
  '  color: inherit;',
  '  cursor: pointer;',
  '  padding: 0;',
  '  text-align: left;',
  '}',
  '.smd-media-frame {',
  '  position: relative;',
  '  width: 100%;',
  '  aspect-ratio: var(--smd-media-ratio, 4 / 3);',
  '  min-height: 148px;',
  '  overflow: hidden;',
  '  border: 1px solid rgba(255, 255, 255, 0.07);',
  '  border-radius: 16px;',
  '  background: rgb(23, 23, 23);',
  '}',
  '.smd-media-card:hover .smd-media-frame { border-color: rgba(255, 255, 255, 0.18); }',
  '.smd-media-frame img, .smd-media-frame video {',
  '  position: absolute;',
  '  inset: 0;',
  '  width: 100%;',
  '  height: 100%;',
  '  object-fit: cover;',
  '}',
  '.smd-media-loading {',
  '  position: absolute;',
  '  inset: 0;',
  '  overflow: hidden;',
  '  background: radial-gradient(circle at 28% 25%, #b4bac7 0, #767d8c 30%, #1b1e25 67%, #0d0f14 100%);',
  '}',
  '.smd-media-loading::before, .smd-media-loading::after {',
  '  position: absolute;',
  '  width: 72%;',
  '  height: 72%;',
  '  border-radius: 50%;',
  '  filter: blur(18px);',
  '  content: "";',
  '  animation: smd-media-drift 8s ease-in-out infinite;',
  '}',
  '.smd-media-loading::before { top: -25%; left: -15%; background: rgba(235, 239, 247, 0.5); }',
  '.smd-media-loading::after { right: -18%; bottom: -25%; background: rgba(10, 12, 17, 0.88); animation-delay: -4s; }',
  '.smd-media-error {',
  '  position: absolute;',
  '  inset: 0;',
  '  display: flex;',
  '  flex-direction: column;',
  '  align-items: flex-start;',
  '  justify-content: flex-start;',
  '  gap: 8px;',
  '  background: linear-gradient(180deg, #232323, #171717);',
  '  color: rgb(227, 227, 227);',
  '  padding: 18px;',
  '}',
  '.smd-media-error-title { font-size: 15px; font-weight: 540; }',
  '.smd-media-error-detail { color: rgb(196, 199, 197); font-size: 13px; line-height: 18px; }',
  '.smd-inline-image {',
  '  display: inline-block;',
  '  max-width: 100%;',
  '  max-height: 360px;',
  '  border-radius: 12px;',
  '  object-fit: cover;',
  '  vertical-align: middle;',
  '}',
  '.smd-footnotes {',
  '  display: flex;',
  '  flex-direction: column;',
  '  gap: 12px;',
  '  border-top: 1px solid rgba(255, 255, 255, 0.12);',
  '  color: rgb(196, 199, 197);',
  '  font-size: 14px;',
  '  line-height: 20px;',
  '  padding-top: 16px;',
  '}',
  '.smd-footnotes ol { margin: 0; padding-left: 24px; }',
  '.smd-footnote-ref { font-size: 12px; line-height: 1; vertical-align: super; }',
  '.smd-scroll { scrollbar-width: auto; scrollbar-color: auto; }',
  '.smd-scroll::-webkit-scrollbar, .smd-scroll::-webkit-scrollbar-corner { width: 12px; height: 12px; background: transparent; }',
  '.smd-scroll::-webkit-scrollbar-track { background: transparent; }',
  '.smd-scroll::-webkit-scrollbar-thumb { min-width: 48px; min-height: 48px; border: 2px solid transparent; border-radius: 9999px; background: transparent; background-clip: content-box; }',
  '.smd-scroll:hover::-webkit-scrollbar-thumb { background-color: #333537; background-clip: content-box; }',
  '.smd-scroll::-webkit-scrollbar-thumb:hover, .smd-scroll::-webkit-scrollbar-thumb:active { background-color: #444746; background-clip: content-box; }',
  '.smd-scroll::-webkit-scrollbar-button { width: 0; height: 0; }',
  '@media (max-width: 640px) {',
  '  .smd-code-block { margin: 8px 0 0; border-radius: 28px; padding: 20px 0 24px 20px; }',
  '  .smd-code-pre code { padding-right: 20px; }',
  '  .smd-media-gallery { grid-template-columns: minmax(0, 1fr); }',
  '  .smd-table-block { width: 100%; }',
  '  .smd-table th, .smd-table td { min-width: 132px; }',
  '}',
  '@media (prefers-reduced-motion: reduce) {',
  '  .smd-streaming .smd-w, .smd-streaming .smd-h, .smd-streaming .smd-code-block,',
  '  .smd-streaming .smd-table-block, .smd-streaming .smd-media-gallery, .smd-streaming .smd-math-display { animation: none !important; }',
  '  .smd-media-loading::before, .smd-media-loading::after { animation: none !important; }',
  '}',
].join('\n');

function useInjectStyles() {
  useInsertionEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
    const element = document.createElement('style');
    element.id = STYLE_ID;
    element.textContent = STYLE_CSS;
    document.head.appendChild(element);
  }, []);
}

interface WordProps {
  children: string;
  variant: 'w' | 'h';
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
  settled?: boolean;
  weight: number;
  width: number;
  roundness: number;
}

const Word = React.memo(
  function Word({
    children,
    variant,
    strong,
    em,
    strike,
    settled,
    weight,
    width,
    roundness,
  }: WordProps) {
    const settledAtMount = useRef(settled).current;
    const effectiveWeight = strong ? Math.max(540, weight) : weight;
    const variation =
      '"ROND" ' + roundness +
      ', "slnt" ' + (em ? -10 : 0) +
      ', "wdth" ' + width +
      ', "wght" ' + effectiveWeight;

    return (
      <span
        className={'smd-' + variant + (settledAtMount ? ' smd-settled' : '')}
        style={{
          fontVariationSettings: variation,
          fontWeight: effectiveWeight,
          textDecoration: strike ? 'line-through' : undefined,
        }}
      >
        {children}
      </span>
    );
  },
  (previous, next) =>
    previous.children === next.children &&
    previous.variant === next.variant &&
    previous.strong === next.strong &&
    previous.em === next.em &&
    previous.strike === next.strike &&
    previous.weight === next.weight &&
    previous.width === next.width &&
    previous.roundness === next.roundness
);

const InlineCode = React.memo(
  function InlineCode({
    value,
    settled,
  }: {
    value: string;
    settled?: boolean;
  }) {
    const settledAtMount = useRef(settled).current;
    return (
      <code className={'smd-inline-code smd-w' + (settledAtMount ? ' smd-settled' : '')}>
        {value}
      </code>
    );
  },
  (previous, next) => previous.value === next.value
);

const MathExpression = React.memo(
  function MathExpression({
    value,
    display,
    settled,
  }: {
    value: string;
    display?: boolean;
    settled?: boolean;
  }) {
    const settledAtMount = useRef(settled).current;
    const rendered = useMemo(() => {
      try {
        return katex.renderToString(value, {
          displayMode: Boolean(display),
          output: 'htmlAndMathml',
          strict: 'ignore',
          throwOnError: false,
          trust: false,
        });
      } catch {
        return '';
      }
    }, [display, value]);

    const className =
      (display ? 'smd-math-display' : 'smd-math-inline smd-w') +
      (settledAtMount ? ' smd-settled' : '');
    const Tag = display ? 'div' : 'span';

    if (!rendered) {
      return <Tag className={className + ' smd-math-error'}>{value}</Tag>;
    }

    return <Tag className={className} dangerouslySetInnerHTML={{ __html: rendered }} />;
  },
  (previous, next) => previous.value === next.value && previous.display === next.display
);

function offsetOf(node: any, fallback = 0): number {
  return node?.position?.start?.offset ?? fallback;
}

function endOffsetOf(node: any, fallback = 0): number {
  return node?.position?.end?.offset ?? fallback;
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function safeHref(value: string | undefined): string {
  const href = String(value ?? '').trim();
  if (!href) return '';
  if (/^(https?:|mailto:|tel:|blob:|data:image\/|data:video\/|\/|#)/i.test(href)) return href;
  return '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function copyToClipboard(value: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Use the compatibility fallback below.
    }
  }
  if (typeof document === 'undefined') return;
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function downloadText(filename: string, value: string, type: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([value], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const LANGUAGE_ALIASES: Record<string, string> = {
  csharp: 'csharp',
  cs: 'csharp',
  cxx: 'cpp',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  svg: 'xml',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
};

const LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Shell',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  kotlin: 'Kotlin',
  markdown: 'Markdown',
  md: 'Markdown',
  php: 'PHP',
  plaintext: 'Code',
  python: 'Python',
  py: 'Python',
  ruby: 'Ruby',
  rust: 'Rust',
  sql: 'SQL',
  svg: 'SVG',
  swift: 'Swift',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
};

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  bash: 'sh',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'js',
  json: 'json',
  jsx: 'jsx',
  kotlin: 'kt',
  markdown: 'md',
  php: 'php',
  python: 'py',
  ruby: 'rb',
  rust: 'rs',
  sql: 'sql',
  svg: 'svg',
  swift: 'swift',
  tsx: 'tsx',
  typescript: 'ts',
  xml: 'xml',
  yaml: 'yml',
};

function sourceLanguage(rawLanguage: string): string {
  return rawLanguage.trim().split(/\s+/)[0].replace(/^language-/, '').toLowerCase();
}

function highlightLanguage(rawLanguage: string): string {
  const source = sourceLanguage(rawLanguage);
  return LANGUAGE_ALIASES[source] || source;
}

function displayLanguage(rawLanguage: string): string {
  const source = sourceLanguage(rawLanguage);
  return LANGUAGE_LABELS[source] || (source ? source.toUpperCase() : 'Code');
}

function highlightedCode(value: string, rawLanguage: string): string {
  const language = highlightLanguage(rawLanguage);
  if (!language || language === 'text' || language === 'txt' || language === 'plaintext') {
    return escapeHtml(value);
  }
  try {
    if (hljs.getLanguage(language)) {
      return hljs.highlight(value, { language, ignoreIllegals: true }).value;
    }
  } catch {
    // Fall through to safely escaped plain code.
  }
  return escapeHtml(value);
}

function svgPreviewDocument(source: string): string {
  const svg = source
    .replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/^\s*<!doctype\s+svg[\s\S]*?>\s*/i, '');

  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; media-src data: blob:; font-src data:; style-src \'unsafe-inline\';">',
    '<style>',
    'html,body{width:100%;min-height:100%;margin:0;background:#131314;}',
    'html{overflow:auto;scrollbar-color:#747775 transparent;scrollbar-width:thin;}',
    'body{overflow:visible;}',
    'svg{display:block;width:100% !important;height:auto !important;max-width:none !important;max-height:none !important;}',
    '::-webkit-scrollbar{width:10px;height:10px;background:transparent;}',
    '::-webkit-scrollbar-track{background:transparent;}',
    '::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:9999px;background:#747775;background-clip:content-box;}',
    '::-webkit-scrollbar-corner{background:transparent;}',
    '</style></head><body>',
    svg,
    '</body></html>',
  ].join('');
}

const SvgPreview = React.memo(function SvgPreview({
  source,
  settled,
}: {
  source: string;
  settled?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const documentSource = useMemo(() => svgPreviewDocument(source), [source]);

  const handleCopy = async () => {
    await copyToClipboard(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className={'smd-svg-preview-block' + (settled ? ' smd-settled' : '')}>
      <div className="smd-svg-preview-toolbar">
        <span className="smd-svg-preview-label">SVG</span>
        <div className="smd-svg-preview-actions">
          <button
            type="button"
            className="smd-svg-preview-button"
            aria-label={copied ? 'SVG copied' : 'Copy SVG'}
            title={copied ? 'Copied' : 'Copy SVG'}
            onClick={() => void handleCopy()}
          >
            <MaterialSymbol
              family="google-symbols"
              name={copied ? 'check' : 'content_copy'}
              size={16}
              weight={400}
              roundness={0}
            />
          </button>
          <button
            type="button"
            className="smd-svg-preview-button"
            aria-label="Download SVG"
            title="Download SVG"
            onClick={() => downloadText('image.svg', source, 'image/svg+xml;charset=utf-8')}
          >
            <MaterialSymbol family="google-symbols" name="download" size={16} weight={400} roundness={0} />
          </button>
        </div>
      </div>
      <div className="smd-svg-preview-canvas">
        <iframe
          className="smd-svg-preview-frame"
          title="SVG preview"
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={documentSource}
        />
      </div>
    </div>
  );
});

const CodeBlock = React.memo(
  function CodeBlock({
    value,
    language,
    settled,
  }: {
    value: string;
    language: string;
    settled?: boolean;
  }) {
    const [copied, setCopied] = useState(false);
    const settledAtMount = useRef(settled).current;
    const source = value.replace(/\n$/, '');
    const html = useMemo(() => highlightedCode(source, language), [language, source]);
    const normalized = highlightLanguage(language);
    const extension = LANGUAGE_EXTENSIONS[sourceLanguage(language)] || LANGUAGE_EXTENSIONS[normalized] || 'txt';
    const isSvg = sourceLanguage(language) === 'svg' || /^\s*<svg(?:\s|>)/i.test(source);
    const hasCompleteSvg = isSvg && /<\/svg>\s*$/i.test(source);

    const handleCopy = async () => {
      await copyToClipboard(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };

    if (isSvg) {
      return hasCompleteSvg ? <SvgPreview source={source} settled={settledAtMount} /> : null;
    }

    return (
      <div className={'smd-code-block' + (settledAtMount ? ' smd-settled' : '')}>
        <div className="smd-code-header">
          <span
            className="smd-code-language"
            style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 540' }}
          >
            {displayLanguage(language)}
          </span>
          <div className="smd-code-buttons">
            <button
              type="button"
              className="smd-icon-button"
              aria-label="Download code"
              title="Download code"
              onClick={() => downloadText('code.' + extension, source, 'text/plain;charset=utf-8')}
            >
              <MaterialSymbol family="luminous" name="arrow_circle_down" size={24} weight={300} roundness={100} />
            </button>
            <button
              type="button"
              className="smd-icon-button"
              aria-label={copied ? 'Code copied' : 'Copy code'}
              title={copied ? 'Copied' : 'Copy code'}
              onClick={() => void handleCopy()}
            >
              <MaterialSymbol
                family="luminous"
                name={copied ? 'check' : 'content_copy'}
                size={24}
                weight={300}
                roundness={100}
              />
            </button>
          </div>
        </div>
        <div className="smd-code-scroll smd-scroll">
          <pre className="smd-code-pre">
            <code
              className={'hljs' + (normalized ? ' language-' + normalized : '')}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </pre>
        </div>
      </div>
    );
  },
  (previous, next) => previous.value === next.value && previous.language === next.language
);

interface DefinitionRecord {
  url: string;
  title?: string;
}

interface RenderContext {
  source: string;
  settledBefore: number;
  mediaItems?: any[];
  definitions: Map<string, DefinitionRecord>;
  footnoteNumbers: Map<string, number>;
  variant: 'w' | 'h';
  weight: number;
  width: number;
  roundness: number;
  strong?: boolean;
  em?: boolean;
  strike?: boolean;
}

function renderAnimatedText(value: string, start: number, context: RenderContext): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const expression = /\S+/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = expression.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const absoluteOffset = start + match.index;
    nodes.push(
      <Word
        key={absoluteOffset}
        variant={context.variant}
        settled={absoluteOffset < context.settledBefore}
        strong={context.strong}
        em={context.em}
        strike={context.strike}
        weight={context.weight}
        width={context.width}
        roundness={context.roundness}
      >
        {match[0]}
      </Word>
    );
    cursor = match.index + match[0].length;
  }

  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function definitionFor(node: any, context: RenderContext): DefinitionRecord | undefined {
  return context.definitions.get(normalizeIdentifier(node?.identifier || node?.label));
}

function resolveMediaItem(url: string, mediaItems?: any[]) {
  const globalItems =
    typeof window !== 'undefined' && Array.isArray((window as any).canvasMediaItems)
      ? (window as any).canvasMediaItems
      : [];
  const allItems = [...(mediaItems || []), ...globalItems];
  if (!url.startsWith('media-id:')) {
    return { item: undefined, url, loading: false };
  }
  const id = url.slice('media-id:'.length);
  const item = allItems.find((candidate: any) => String(candidate?.id) === id);
  return {
    item,
    url: item?.url || '',
    loading: !item || item.status === 'generating' || (!item.url && item.status !== 'failed'),
  };
}

function ratioToCss(value: unknown): string {
  const ratio = String(value || '4:3');
  const match = ratio.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!match) return '4 / 3';
  return match[1] + ' / ' + match[2];
}

interface MediaDescriptor {
  key: string;
  start: number;
  url: string;
  alt: string;
  title?: string;
  href?: string;
}

function MediaCard({
  descriptor,
  mediaItems,
}: {
  descriptor: MediaDescriptor;
  mediaItems?: any[];
}) {
  const resolved = resolveMediaItem(descriptor.url, mediaItems);
  const item = resolved.item;
  const failed = item?.status === 'failed';
  const ratio = ratioToCss(item?.ratio);
  const destination = safeHref(descriptor.href || resolved.url);

  const open = () => {
    if (item && typeof window !== 'undefined' && typeof (window as any).openCanvasItemInFullscreen === 'function') {
      (window as any).openCanvasItemInFullscreen(item);
      return;
    }
    if (destination && typeof window !== 'undefined') {
      window.open(destination, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <button
      type="button"
      className="smd-media-card"
      aria-label={descriptor.alt || descriptor.title || 'Open media'}
      onClick={open}
    >
      <span
        className="smd-media-frame"
        style={{ '--smd-media-ratio': ratio } as React.CSSProperties}
      >
        {failed ? (
          <span className="smd-media-error">
            <MaterialSymbol family="luminous" name="warning" size={20} weight={300} roundness={100} />
            <span className="smd-media-error-title">Failed</span>
            <span className="smd-media-error-detail">
              {item?.error || 'This media could not be generated.'}
            </span>
          </span>
        ) : resolved.loading ? (
          <span className="smd-media-loading" aria-label="Generating media" />
        ) : item?.kind === 'video' ? (
          <video src={resolved.url} autoPlay loop muted playsInline />
        ) : (
          <img
            src={safeHref(resolved.url)}
            alt={descriptor.alt}
            title={descriptor.title}
            loading="lazy"
            decoding="async"
          />
        )}
      </span>
    </button>
  );
}

const MediaGallery = React.memo(
  function MediaGallery({
    items,
    mediaItems,
    settled,
  }: {
    items: MediaDescriptor[];
    mediaItems?: any[];
    settled?: boolean;
  }) {
    const settledAtMount = useRef(settled).current;
    return (
      <div
        className={'smd-media-gallery' + (settledAtMount ? ' smd-settled' : '')}
        data-count={String(items.length)}
      >
        {items.map((item) => (
          <MediaCard key={item.key} descriptor={item} mediaItems={mediaItems} />
        ))}
      </div>
    );
  },
  (previous, next) => previous.items === next.items && previous.mediaItems === next.mediaItems
);

function renderInlineImage(node: any, context: RenderContext): React.ReactNode {
  const definition = node.type === 'imageReference' ? definitionFor(node, context) : undefined;
  const rawUrl = node.url || definition?.url || '';
  const resolved = resolveMediaItem(rawUrl, context.mediaItems);
  if (resolved.loading) {
    return <span className="smd-math-error">Generating image…</span>;
  }
  const src = safeHref(resolved.url);
  if (!src) return renderAnimatedText(node.alt || '', offsetOf(node), context);
  return (
    <img
      key={offsetOf(node)}
      className="smd-inline-image"
      src={src}
      alt={node.alt || ''}
      title={node.title || definition?.title}
      loading="lazy"
      decoding="async"
    />
  );
}

function renderInlineNode(node: any, context: RenderContext, index: number): React.ReactNode {
  const start = offsetOf(node, index);
  const key = node.type + '-' + start + '-' + index;

  switch (node.type) {
    case 'text':
      return renderAnimatedText(node.value || '', start, context);
    case 'strong':
      return (
        <b
          key={key}
          className="smd-strong"
          style={{
            fontVariationSettings:
              '"ROND" ' + context.roundness +
              ', "slnt" ' + (context.em ? -10 : 0) +
              ', "wdth" ' + context.width +
              ', "wght" ' + Math.max(540, context.weight),
          }}
        >
          {renderInlineNodes(node.children || [], { ...context, strong: true })}
        </b>
      );
    case 'emphasis':
      return (
        <i
          key={key}
          className="smd-emphasis"
          style={{
            fontStyle: 'normal',
            fontVariationSettings:
              '"ROND" ' + context.roundness +
              ', "slnt" -10' +
              ', "wdth" ' + context.width +
              ', "wght" ' + context.weight,
          }}
        >
          {renderInlineNodes(node.children || [], { ...context, em: true })}
        </i>
      );
    case 'delete':
      return (
        <React.Fragment key={key}>
          {renderAnimatedText('~~', start, context)}
          {renderInlineNodes(node.children || [], context)}
          {renderAnimatedText(
            '~~',
            Math.max(start + 2, endOffsetOf(node, start + 4) - 2),
            context
          )}
        </React.Fragment>
      );
    case 'inlineCode':
      return (
        <InlineCode
          key={key}
          value={node.value || ''}
          settled={start < context.settledBefore}
        />
      );
    case 'inlineMath':
      return (
        <MathExpression
          key={key}
          value={node.value || ''}
          settled={start < context.settledBefore}
        />
      );
    case 'link': {
      const href = safeHref(node.url);
      const children = renderInlineNodes(node.children || [], context);
      return href ? (
        <a
          key={key}
          className="smd-link"
          href={href}
          title={node.title}
          target={href.startsWith('#') ? undefined : '_blank'}
          rel={href.startsWith('#') ? undefined : 'noopener noreferrer'}
        >
          {children}
        </a>
      ) : (
        <React.Fragment key={key}>{children}</React.Fragment>
      );
    }
    case 'linkReference': {
      const definition = definitionFor(node, context);
      const href = safeHref(definition?.url);
      const children = renderInlineNodes(node.children || [], context);
      return href ? (
        <a
          key={key}
          className="smd-link"
          href={href}
          title={definition?.title}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      ) : (
        <React.Fragment key={key}>{children}</React.Fragment>
      );
    }
    case 'image':
    case 'imageReference':
      return renderInlineImage(node, context);
    case 'break':
      return <br key={key} />;
    case 'html':
      return (
        <React.Fragment key={key}>
          {renderAnimatedText(node.value || '', start, context)}
        </React.Fragment>
      );
    case 'footnoteReference': {
      const identifier = normalizeIdentifier(node.identifier);
      const number = context.footnoteNumbers.get(identifier) || 1;
      return (
        <sup key={key} className="smd-footnote-ref">
          <a className="smd-link" href={'#smd-footnote-' + identifier}>{number}</a>
        </sup>
      );
    }
    default:
      if (Array.isArray(node.children)) {
        return (
          <React.Fragment key={key}>
            {renderInlineNodes(node.children, context)}
          </React.Fragment>
        );
      }
      if (typeof node.value === 'string') {
        return (
          <React.Fragment key={key}>
            {renderAnimatedText(node.value, start, context)}
          </React.Fragment>
        );
      }
      return null;
  }
}

function renderInlineNodes(nodes: any[], context: RenderContext): React.ReactNode[] {
  return nodes.map((node, index) => renderInlineNode(node, context, index));
}

function nodeText(node: any): string {
  if (!node) return '';
  if (typeof node.value === 'string') return node.value;
  if (node.type === 'image' || node.type === 'imageReference') return node.alt || '';
  if (!Array.isArray(node.children)) return '';
  return node.children.map(nodeText).join('');
}

function TableBlock({
  node,
  context,
}: {
  node: any;
  context: RenderContext;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({
    hasScrollbar: false,
    atStart: true,
    atEnd: true,
  });
  const settledAtMount = useRef(offsetOf(node) < context.settledBefore).current;
  const rows = node.children || [];
  const alignments = node.align || [];
  const plainRows = rows.map((row: any) => (row.children || []).map((cell: any) => nodeText(cell)));
  const tsv = plainRows.map((row: string[]) => row.join('\t')).join('\n');

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const update = () => {
      const hasScrollbar = element.scrollWidth > element.clientWidth + 1;
      const atStart = !hasScrollbar || element.scrollLeft <= 1;
      const atEnd =
        !hasScrollbar || element.scrollLeft >= element.scrollWidth - element.clientWidth - 1;
      setScrollState((previous) =>
        previous.hasScrollbar === hasScrollbar &&
        previous.atStart === atStart &&
        previous.atEnd === atEnd
          ? previous
          : { hasScrollbar, atStart, atEnd }
      );
    };

    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener('resize', update);

    return () => {
      element.removeEventListener('scroll', update);
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [node]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const copy = async () => {
    await copyToClipboard(tsv);
    setCopied(true);
    setMenuOpen(false);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const exportToSheets = () => {
    // A browser-only client cannot create a populated Google Sheet without a
    // signed-in Sheets API grant. Match Gemini's entry point while placing the
    // tab-separated table on the clipboard so it can be pasted immediately.
    void copyToClipboard(tsv);
    window.open('https://sheets.new', '_blank', 'noopener,noreferrer');
    setMenuOpen(false);
  };

  return (
    <div
      className={
        'smd-table-block' +
        (settledAtMount ? ' smd-settled' : '') +
        (scrollState.hasScrollbar ? ' has-scrollbar' : '') +
        (scrollState.atStart ? ' is-at-scroll-start' : '') +
        (scrollState.atEnd ? ' is-at-scroll-end' : '')
      }
    >
      <div ref={scrollRef} className="smd-table-content smd-scroll">
        <table className="smd-table">
          {rows.length > 0 && (
            <thead>
              <tr>
                {(rows[0].children || []).map((cell: any, columnIndex: number) => (
                  <th
                    key={offsetOf(cell, columnIndex)}
                    style={{ textAlign: alignments[columnIndex] || 'left' }}
                  >
                    {renderInlineNodes(cell.children || [], context)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          {rows.length > 1 && (
            <tbody>
              {rows.slice(1).map((row: any, rowIndex: number) => (
                <tr key={offsetOf(row, rowIndex)}>
                  {(row.children || []).map((cell: any, columnIndex: number) => (
                    <td
                      key={offsetOf(cell, columnIndex)}
                      style={{ textAlign: alignments[columnIndex] || 'left' }}
                    >
                      {renderInlineNodes(cell.children || [], context)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      <div className="smd-table-footer" ref={menuRef}>
        <button
          type="button"
          className="smd-table-menu-trigger"
          aria-label="More options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MaterialSymbol family="luminous" name="more_horiz" size={24} weight={300} roundness={100} />
        </button>
        {menuOpen && (
          <div className="smd-table-menu" role="menu">
            <button type="button" role="menuitem" onClick={exportToSheets}>
              <MaterialSymbol family="luminous" name="share_1" size={20} weight={300} roundness={100} />
              Export to Sheets
            </button>
            <button type="button" role="menuitem" onClick={() => void copy()}>
              <MaterialSymbol family="luminous" name={copied ? 'check' : 'copy'} size={20} weight={300} roundness={100} />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const HEADING_METRICS: Record<number, { weight: number; width: number; roundness: number }> = {
  1: { weight: 350, width: 100, roundness: 20 },
  2: { weight: 380, width: 100, roundness: 20 },
  3: { weight: 470, width: 94, roundness: 20 },
  4: { weight: 470, width: 94, roundness: 20 },
  5: { weight: 470, width: 94, roundness: 20 },
  6: { weight: 470, width: 94, roundness: 20 },
};

function isWhitespaceText(node: any): boolean {
  return node?.type === 'text' && !/\S/.test(node.value || '');
}

function isDisplayDelimitedMath(node: any, context: RenderContext): boolean {
  if (node?.type !== 'inlineMath') return false;
  const raw = context.source
    .slice(offsetOf(node), endOffsetOf(node, context.source.length))
    .trim();
  return (
    (raw.startsWith('$$') && raw.endsWith('$$')) ||
    (raw.startsWith('\\[') && raw.endsWith('\\]'))
  );
}

function renderParagraphNode(node: any, context: RenderContext, key: string): React.ReactNode {
  const children = node.children || [];
  const blocks: React.ReactNode[] = [];
  let inlineNodes: any[] = [];
  let skipLeadingWhitespace = false;

  const flushInline = () => {
    while (inlineNodes.length && isWhitespaceText(inlineNodes[inlineNodes.length - 1])) {
      inlineNodes.pop();
    }
    if (!inlineNodes.length) return;
    const paragraphStart = offsetOf(inlineNodes[0], offsetOf(node));
    blocks.push(
      <p key={'paragraph-' + paragraphStart} className="smd-paragraph">
        {renderInlineNodes(inlineNodes, context)}
      </p>
    );
    inlineNodes = [];
  };

  children.forEach((child: any, childIndex: number) => {
    if (isDisplayDelimitedMath(child, context)) {
      flushInline();
      const mathStart = offsetOf(child, offsetOf(node) + childIndex);
      blocks.push(
        <MathExpression
          key={'display-math-' + mathStart}
          value={child.value || ''}
          display
          settled={mathStart < context.settledBefore}
        />
      );
      skipLeadingWhitespace = true;
      return;
    }

    if (skipLeadingWhitespace && isWhitespaceText(child)) return;
    skipLeadingWhitespace = false;
    inlineNodes.push(child);
  });

  flushInline();
  if (blocks.length === 1) return blocks[0];
  return <React.Fragment key={key}>{blocks}</React.Fragment>;
}

function renderBlockNode(node: any, context: RenderContext, index: number): React.ReactNode {
  const start = offsetOf(node, index);
  const key = node.type + '-' + start + '-' + index;

  switch (node.type) {
    case 'paragraph': {
      return renderParagraphNode(node, context, key);
    }
    case 'heading': {
      const depth = Math.min(6, Math.max(1, node.depth || 1));
      const Tag = ('h' + depth) as React.ElementType;
      const metrics = HEADING_METRICS[depth];
      const headingContext: RenderContext = {
        ...context,
        variant: 'h',
        weight: metrics.weight,
        width: metrics.width,
        roundness: metrics.roundness,
      };
      return (
        <Tag
          key={key}
          className={'smd-heading smd-heading-' + depth}
          style={{
            fontVariationSettings:
              '"ROND" ' + metrics.roundness +
              ', "slnt" 0, "wdth" ' + metrics.width +
              ', "wght" ' + metrics.weight,
          }}
        >
          {renderInlineNodes(node.children || [], headingContext)}
        </Tag>
      );
    }
    case 'list': {
      const ordered = Boolean(node.ordered);
      const Tag = ordered ? 'ol' : 'ul';
      const startNumber = ordered ? Math.max(1, node.start || 1) : 1;
      return (
        <Tag
          key={key}
          className={'smd-list ' + (ordered ? 'smd-list-ordered' : 'smd-list-unordered')}
          style={ordered ? { counterReset: 'smd-list-item ' + (startNumber - 1) } : undefined}
        >
          {(node.children || []).map((item: any, itemIndex: number) => {
            const checked = typeof item.checked === 'boolean' ? item.checked : undefined;
            const itemStart = offsetOf(item, itemIndex);
            const firstChild = item.children?.[0];
            const taskSource = checked === undefined
              ? ''
              : context.source.slice(itemStart, endOffsetOf(firstChild, itemStart + 8));
            const taskMatch = checked === undefined ? null : /\[[ xX]\]/.exec(taskSource);
            const taskMarker = checked === undefined
              ? ''
              : taskMatch?.[0] || (checked ? '[x]' : '[ ]');
            const taskMarkerStart = itemStart + (taskMatch?.index || 0);
            return (
              <li key={itemStart}>
                <div className="smd-list-content">
                  {(item.children || []).map((child: any, childIndex: number) => {
                    if (checked !== undefined && childIndex === 0 && child.type === 'paragraph') {
                      return (
                        <p key={'task-' + offsetOf(child)} className="smd-paragraph">
                          {renderAnimatedText(taskMarker + ' ', taskMarkerStart, context)}
                          {renderInlineNodes(child.children || [], context)}
                        </p>
                      );
                    }
                    return renderBlockNode(child, context, childIndex);
                  })}
                </div>
              </li>
            );
          })}
        </Tag>
      );
    }
    case 'blockquote':
      return (
        <blockquote key={key} className="smd-blockquote">
          {(node.children || []).map((child: any, childIndex: number) =>
            renderBlockNode(child, context, childIndex)
          )}
        </blockquote>
      );
    case 'code':
      return (
        <CodeBlock
          key={key}
          value={node.value || ''}
          language={node.lang || ''}
          settled={start < context.settledBefore}
        />
      );
    case 'math':
      return (
        <MathExpression
          key={key}
          value={node.value || ''}
          display
          settled={start < context.settledBefore}
        />
      );
    case 'table':
      return <TableBlock key={key} node={node} context={context} />;
    case 'thematicBreak':
      return null;
    case 'html':
      return <p key={key}>{renderAnimatedText(node.value || '', start, context)}</p>;
    case 'definition':
    case 'footnoteDefinition':
      return null;
    default:
      if (Array.isArray(node.children)) {
        return (
          <div key={key}>
            {node.children.map((child: any, childIndex: number) =>
              renderBlockNode(child, context, childIndex)
            )}
          </div>
        );
      }
      if (typeof node.value === 'string') {
        return <p key={key}>{renderAnimatedText(node.value, start, context)}</p>;
      }
      return null;
  }
}

function descriptorFromImage(
  node: any,
  context: RenderContext,
  href?: string
): MediaDescriptor | null {
  const definition = node.type === 'imageReference' ? definitionFor(node, context) : undefined;
  const url = node.url || definition?.url || '';
  if (!url) return null;
  const start = offsetOf(node);
  return {
    key: node.type + '-' + start,
    start,
    url,
    alt: node.alt || '',
    title: node.title || definition?.title,
    href,
  };
}

function standaloneMedia(node: any, context: RenderContext): MediaDescriptor[] | null {
  if (node.type !== 'paragraph') return null;
  const meaningful = (node.children || []).filter(
    (child: any) => child.type !== 'text' || /\S/.test(child.value || '')
  );
  if (meaningful.length === 0) return null;
  const media: MediaDescriptor[] = [];

  for (const child of meaningful) {
    if (child.type === 'image' || child.type === 'imageReference') {
      const descriptor = descriptorFromImage(child, context);
      if (!descriptor) return null;
      media.push(descriptor);
      continue;
    }
    if (child.type === 'link' || child.type === 'linkReference') {
      const linkDefinition = child.type === 'linkReference' ? definitionFor(child, context) : undefined;
      const href = safeHref(child.url || linkDefinition?.url);
      const linkChildren = (child.children || []).filter(
        (grandchild: any) => grandchild.type !== 'text' || /\S/.test(grandchild.value || '')
      );
      if (!href || linkChildren.length === 0) return null;
      for (const grandchild of linkChildren) {
        if (grandchild.type !== 'image' && grandchild.type !== 'imageReference') return null;
        const descriptor = descriptorFromImage(grandchild, context, href);
        if (!descriptor) return null;
        media.push(descriptor);
      }
      continue;
    }
    return null;
  }

  return media.length ? media : null;
}

function collectDefinitions(tree: any): Map<string, DefinitionRecord> {
  const definitions = new Map<string, DefinitionRecord>();
  for (const child of tree.children || []) {
    if (child.type !== 'definition') continue;
    definitions.set(normalizeIdentifier(child.identifier || child.label), {
      url: child.url || '',
      title: child.title,
    });
  }
  return definitions;
}

function collectFootnoteNumbers(node: any, numbers = new Map<string, number>()): Map<string, number> {
  if (node?.type === 'footnoteReference') {
    const identifier = normalizeIdentifier(node.identifier);
    if (!numbers.has(identifier)) numbers.set(identifier, numbers.size + 1);
  }
  for (const child of node?.children || []) collectFootnoteNumbers(child, numbers);
  return numbers;
}

function renderFootnotes(tree: any, context: RenderContext): React.ReactNode | null {
  const definitions = (tree.children || []).filter((child: any) => child.type === 'footnoteDefinition');
  if (!definitions.length) return null;
  return (
    <section className="smd-footnotes" aria-label="Footnotes">
      <ol>
        {definitions.map((definition: any, index: number) => {
          const identifier = normalizeIdentifier(definition.identifier);
          return (
            <li key={identifier || index} id={'smd-footnote-' + identifier}>
              {(definition.children || []).map((child: any, childIndex: number) =>
                renderBlockNode(child, context, childIndex)
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function renderRoot(tree: any, context: RenderContext): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  let pendingMedia: MediaDescriptor[] = [];

  const flushMedia = () => {
    if (!pendingMedia.length) return;
    const items = pendingMedia;
    pendingMedia = [];
    rendered.push(
      <MediaGallery
        key={'media-' + items[0].start}
        items={items}
        mediaItems={context.mediaItems}
        settled={items[0].start < context.settledBefore}
      />
    );
  };

  (tree.children || []).forEach((node: any, index: number) => {
    if (node.type === 'definition' || node.type === 'footnoteDefinition') return;
    const media = standaloneMedia(node, context);
    if (media) {
      pendingMedia.push(...media);
      return;
    }
    flushMedia();
    rendered.push(renderBlockNode(node, context, index));
  });

  flushMedia();
  const footnotes = renderFootnotes(tree, context);
  if (footnotes) rendered.push(footnotes);
  return rendered;
}

const TICK = String.fromCharCode(96);
const FENCE = TICK.repeat(3);

function occurrences(value: string, token: string): number {
  return value.split(token).length - 1;
}

function isEscapedAt(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

const CURRENCY_AMOUNT = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?(?:[kKmMbB])?/;
const CURRENCY_RATE_UNIT = /^\/(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?|secs?|mins?|hrs?|wks?|mos?|qtrs?|yrs?)\b/i;

function isCurrencyDollar(source: string, index: number): boolean {
  if (source[index] !== '$' || isEscapedAt(source, index) || source[index + 1] === '$') return false;

  // A currency marker starts at a textual boundary. This prevents a closing
  // math delimiter such as the second "$" in "$x$" from being reclassified.
  const previous = source[index - 1] || '';
  if (previous && /[A-Za-z0-9_$)\]}]/.test(previous)) return false;

  const amount = source.slice(index + 1).match(CURRENCY_AMOUNT)?.[0];
  if (!amount) return false;

  const amountEnd = index + 1 + amount.length;
  const immediate = source[amountEnd] || '';
  if (immediate === '$') return false;

  const rate = source.slice(amountEnd).match(CURRENCY_RATE_UNIT)?.[0];
  if (rate) return source[amountEnd + rate.length] !== '$';

  if (!immediate || /[,.;:!?)\]}]/.test(immediate)) return true;
  if (source.startsWith('**', amountEnd) || source.startsWith('__', amountEnd) || source.startsWith('~~', amountEnd)) {
    return true;
  }

  if (/\s/.test(immediate)) {
    let cursor = amountEnd;
    while (/\s/.test(source[cursor] || '')) cursor += 1;
    const next = source[cursor] || '';
    if (!next) return true;

    const spacedRate = source.slice(cursor).match(CURRENCY_RATE_UNIT)?.[0];
    if (spacedRate) return source[cursor + spacedRate.length] !== '$';

    // Operators and TeX commands identify numeric math such as "$3 + 4$".
    if (/[+\-=*^_]/.test(next) || next === '\\' || next === '$') return false;
    if (next === '/' && !spacedRate) return false;
    return true;
  }

  // A directly adjacent variable is math (for example "$2x$"). Currency
  // suffixes were consumed by CURRENCY_AMOUNT above.
  return false;
}

function mathDollarDelimiterCounts(source: string): { display: number; inline: number } {
  let display = 0;
  let inline = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '$' || isEscapedAt(source, index) || isCurrencyDollar(source, index)) continue;
    if (source[index + 1] === '$' && !isEscapedAt(source, index + 1)) {
      display += 1;
      index += 1;
    } else {
      inline += 1;
    }
  }

  return { display, inline };
}

function hasDanglingAsterisk(source: string): boolean {
  let open = false;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '*' || isEscapedAt(source, index)) continue;

    const previous = source[index - 1] || '';
    const next = source[index + 1] || '';
    const canOpen = !!next && !/\s/.test(next);
    const canClose = !!previous && !/\s/.test(previous);

    if (open && canClose) open = false;
    else if (canOpen) open = true;
  }

  return open;
}

function closeDangling(source: string): string {
  if (!source) return source;
  if (occurrences(source, FENCE) % 2 === 1) return source;

  const tail = source.slice(source.lastIndexOf('\n') + 1);
  let suffix = '';
  if (occurrences(tail, TICK) % 2 === 1) suffix += TICK;

  const withoutCode = tail.replace(new RegExp(TICK + '[^' + TICK + ']*' + TICK, 'g'), '');
  if (occurrences(withoutCode, '**') % 2 === 1) suffix += '**';
  if (occurrences(withoutCode, '__') % 2 === 1) suffix += '__';

  const withoutStrong = withoutCode.replace(/\*\*/g, '').replace(/__/g, '');
  if (hasDanglingAsterisk(withoutStrong)) suffix += '*';
  if (occurrences(withoutStrong, '_') % 2 === 1) suffix += '_';
  if (occurrences(withoutCode, '~~') % 2 === 1) suffix += '~~';

  const dollarDelimiters = mathDollarDelimiterCounts(withoutCode);
  if (dollarDelimiters.display % 2 === 1) suffix += '$$';
  else if (dollarDelimiters.inline % 2 === 1) suffix += '$';

  return suffix ? source + suffix : source;
}

interface NormalizedMathSource {
  source: string;
  boundaries: number[];
}

function normalizeLatexDelimiters(source: string): NormalizedMathSource {
  let normalized = '';
  const boundaries = [0];
  let codeDelimiter = 0;

  const append = (value: string, consumedFrom: number, consumedTo: number) => {
    for (let index = 0; index < value.length; index += 1) {
      normalized += value[index];
      const progress = (index + 1) / value.length;
      boundaries.push(Math.round(consumedFrom + (consumedTo - consumedFrom) * progress));
    }
  };

  for (let index = 0; index < source.length;) {
    if (source[index] === '`') {
      let run = 1;
      while (source[index + run] === '`') run += 1;
      if (codeDelimiter === 0) codeDelimiter = run;
      else if (codeDelimiter === run) codeDelimiter = 0;
      append(source.slice(index, index + run), index, index + run);
      index += run;
      continue;
    }

    const escapedByBackslash = isEscapedAt(source, index);
    if (codeDelimiter === 0 && source[index] === '$' && isCurrencyDollar(source, index)) {
      append('\\', index, index);
      append('$', index, index + 1);
      index += 1;
      continue;
    }
    if (
      codeDelimiter === 0 &&
      !escapedByBackslash &&
      source[index] === '\\' &&
      (source[index + 1] === '(' || source[index + 1] === ')')
    ) {
      append('$', index, index + 2);
      index += 2;
      continue;
    }
    if (
      codeDelimiter === 0 &&
      !escapedByBackslash &&
      source[index] === '\\' &&
      (source[index + 1] === '[' || source[index + 1] === ']')
    ) {
      append('$$', index, index + 2);
      index += 2;
      continue;
    }

    append(source[index], index, index + 1);
    index += 1;
  }

  return { source: normalized, boundaries };
}

function remapTreeOffsets(node: any, boundaries: number[], sourceLength: number): void {
  const mapOffset = (offset: unknown) => {
    if (typeof offset !== 'number') return offset;
    const bounded = Math.max(0, Math.min(boundaries.length - 1, offset));
    return Math.min(sourceLength, boundaries[bounded] ?? sourceLength);
  };

  if (node?.position?.start) node.position.start.offset = mapOffset(node.position.start.offset);
  if (node?.position?.end) node.position.end.offset = mapOffset(node.position.end.offset);
  for (const child of node?.children || []) remapTreeOffsets(child, boundaries, sourceLength);
}

const MARKDOWN_PROCESSOR = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .freeze();

export interface StreamingMarkdownProps {
  text: string;
  isStreaming: boolean;
  animate?: boolean;
  className?: string;
  mediaItems?: any[];
}

export const StreamingMarkdown: React.FC<StreamingMarkdownProps> = React.memo(
  function StreamingMarkdown({
    text,
    isStreaming,
    animate = true,
    className = '',
    mediaItems,
  }) {
    useInjectStyles();

    const shown = text;
    const shouldAnimateStream = animate && isStreaming;
    const [keepTailAnimation, setKeepTailAnimation] = useState(shouldAnimateStream);

    useEffect(() => {
      if (shouldAnimateStream) {
        if (!keepTailAnimation) setKeepTailAnimation(true);
        return;
      }
      if (!keepTailAnimation) return;
      const timeoutId = window.setTimeout(() => setKeepTailAnimation(false), STREAM_FADE_MS);
      return () => window.clearTimeout(timeoutId);
    }, [keepTailAnimation, shouldAnimateStream]);

    const animationEnabled = shouldAnimateStream || keepTailAnimation;
    const tree = useMemo(() => {
      try {
        const closed = isStreaming ? closeDangling(shown) : shown;
        const normalized = normalizeLatexDelimiters(closed);
        const parsed = MARKDOWN_PROCESSOR.parse(normalized.source) as any;
        remapTreeOffsets(parsed, normalized.boundaries, shown.length);
        return parsed;
      } catch {
        return {
          type: 'root',
          children: [{
            type: 'paragraph',
            children: [{ type: 'text', value: shown, position: { start: { offset: 0 } } }],
            position: { start: { offset: 0 } },
          }],
        };
      }
    }, [isStreaming, shown]);

    const committedLength = useRef(0);
    useEffect(() => {
      committedLength.current = shown.length;
    }, [shown]);
    const settledBefore = committedLength.current;

    const definitions = useMemo(() => collectDefinitions(tree), [tree]);
    const footnoteNumbers = useMemo(() => collectFootnoteNumbers(tree), [tree]);
    const context: RenderContext = {
      source: shown,
      settledBefore,
      mediaItems,
      definitions,
      footnoteNumbers,
      variant: 'w',
      weight: 400,
      width: 92,
      roundness: 0,
    };
    const rendered = renderRoot(tree, context);

    return (
      <div
        className={
          'smd-root ' +
          (animationEnabled ? 'smd-streaming ' : 'smd-static ') +
          className
        }
        data-streaming={animationEnabled ? 'true' : undefined}
        style={{ fontVariationSettings: '"ROND" 0, "slnt" 0, "wdth" 92, "wght" 400' }}
      >
        {rendered}
      </div>
    );
  }
);

export default StreamingMarkdown;
