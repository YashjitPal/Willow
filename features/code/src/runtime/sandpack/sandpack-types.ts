// TypeScript types for the preview system

export interface SandpackFile {
  code: string;
  hidden?: boolean;
  active?: boolean;
  readOnly?: boolean;
}

export type SandpackFiles = Record<string, SandpackFile | string>;

export interface ParsedAction {
  type: 'file' | 'shell' | 'start';
  filePath?: string;
  content?: string;
}

export interface ChatSegment {
  type: 'text' | 'file-indicator' | 'shell-indicator' | 'start-indicator';
  content: string;
  filePath?: string;
}

// Base template files - empty by default, AI generates content
export const BASE_TEMPLATE: SandpackFiles = {};

// Dependencies reference (for documentation)
export const SANDPACK_DEPENDENCIES: Record<string, string> = {
  'react': '^18.2.0',
  'react-dom': '^18.2.0',
};

export const SANDPACK_DEV_DEPENDENCIES: Record<string, string> = {
  '@types/react': '^18.2.0',
  '@types/react-dom': '^18.2.0',
};
