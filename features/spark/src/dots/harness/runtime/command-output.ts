/**
 * What a command printed, as the bot reads it: shared by approved commands (computer-access.ts) and commands the
 * user allowed for good, which run straight from the tool (computer-tools.ts).
 */
import type { DotCommandOutput } from './computer-bridge';

const MAX_OUTPUT_CHARS = 12_000;

export const clipOutput = (text: string, max = MAX_OUTPUT_CHARS): string => {
  const value = text.replace(/\s+$/, '');
  if (value.length <= max) return value;
  const half = Math.floor(max / 2);
  return `${value.slice(0, half)}\n[… ${(value.length - max).toLocaleString('en-US')} characters cut …]\n${value.slice(-half)}`;
};

/** What a finished command did, outcome first: once it ages, only the first line stays in view. */
export const describeOutput = (output: DotCommandOutput, timeoutSeconds: number): string => {
  const outcome = output.signal === 'TIMEOUT'
    ? `timed out after ${timeoutSeconds} seconds and was stopped.`
    : output.code === null
      ? `was stopped${output.signal ? ` (${output.signal})` : ''}.`
      : `exited with code ${output.code}.`;
  const parts = [outcome];
  if (output.stdout.trim()) parts.push(`Output:\n${clipOutput(output.stdout)}`);
  if (output.stderr.trim()) parts.push(`Errors:\n${clipOutput(output.stderr)}`);
  if (!output.stdout.trim() && !output.stderr.trim()) parts.push('It printed nothing.');
  return parts.join('\n');
};
