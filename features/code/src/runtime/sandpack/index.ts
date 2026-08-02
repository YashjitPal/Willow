// Barrel export for Sandpack integration
// Replaces ~/lib/bolt exports

export { sandpackStore } from './sandpack-store';
export { 
  StreamingMessageParser, 
  parseAIResponse, 
  parseResponseForDisplay, 
  type ChatSegment,
  type ParsedAction 
} from './message-parser';
export { SANDPACK_SYSTEM_PROMPT, BOLT_SYSTEM_PROMPT } from './system-prompt';
export { 
  BASE_TEMPLATE, 
  SANDPACK_DEPENDENCIES,
  type SandpackFile,
  type SandpackFiles 
} from './sandpack-types';

// Backward compatibility exports (mapping old names to new)
export { sandpackStore as workbenchStore } from './sandpack-store';
