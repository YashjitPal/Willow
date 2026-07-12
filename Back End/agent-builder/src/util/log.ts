/** Minimal leveled logger. Set AGENT_BUILDER_LOG=debug|info|warn|error|silent. */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

const envLevel = (process.env.AGENT_BUILDER_LOG || 'info') as Level;
const threshold = LEVELS[envLevel] ?? LEVELS.info;

function fmt(scope: string, msg: string): string {
  return `[${new Date().toISOString()}] [${scope}] ${msg}`;
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, ...rest: unknown[]) => {
      if (threshold <= LEVELS.debug) console.debug(fmt(scope, msg), ...rest);
    },
    info: (msg: string, ...rest: unknown[]) => {
      if (threshold <= LEVELS.info) console.info(fmt(scope, msg), ...rest);
    },
    warn: (msg: string, ...rest: unknown[]) => {
      if (threshold <= LEVELS.warn) console.warn(fmt(scope, msg), ...rest);
    },
    error: (msg: string, ...rest: unknown[]) => {
      if (threshold <= LEVELS.error) console.error(fmt(scope, msg), ...rest);
    },
  };
}
