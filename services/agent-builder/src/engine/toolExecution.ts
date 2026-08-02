export interface ToolExecutionOptions<T> {
  signal: AbortSignal;
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  execute: (signal: AbortSignal, attempt: number) => Promise<T>;
  onAttempt?: (attempt: number, maxAttempts: number) => Promise<void> | void;
  onRetry?: (attempt: number, error: Error, delayMs: number) => Promise<void> | void;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('tool execution aborted');
}

function retryable(error: Error): boolean {
  const message = error.message.toLowerCase();
  return error.name === 'TimeoutError' ||
    message.includes('timed out') || message.includes('timeout') ||
    message.includes('network') || message.includes('fetch failed') ||
    message.includes('econnreset') || message.includes('econnrefused') ||
    message.includes('socket') || message.includes('transport') ||
    /http (429|5\d\d)/.test(message);
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

async function raceExecution<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export async function runToolWithPolicy<T>(options: ToolExecutionOptions<T>): Promise<{ value: T; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(6, options.maxRetries + 1));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal.aborted) throw abortError(options.signal);
    await options.onAttempt?.(attempt, maxAttempts);
    // Attempt bookkeeping may yield to storage/event listeners. Cancellation
    // during that boundary must prevent the external tool from starting.
    if (options.signal.aborted) throw abortError(options.signal);
    const timeoutController = new AbortController();
    const timeoutMs = Math.max(100, options.timeoutMs);
    const timer = setTimeout(() => timeoutController.abort(new Error(`tool execution timed out after ${timeoutMs}ms`)), timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutController.signal]);
    try {
      const value = await raceExecution(options.execute(signal, attempt), signal);
      clearTimeout(timer);
      return { value, attempts: attempt };
    } catch (cause) {
      clearTimeout(timer);
      const error = cause instanceof Error ? cause : new Error(String(cause));
      Object.assign(error, { toolAttempts: attempt });
      if (options.signal.aborted) throw abortError(options.signal);
      if (attempt >= maxAttempts || !retryable(error)) throw error;
      const delayMs = Math.min(60_000, Math.max(0, options.retryBackoffMs) * 2 ** (attempt - 1));
      await options.onRetry?.(attempt, error, delayMs);
      await abortableDelay(delayMs, options.signal);
    }
  }
  throw new Error('tool execution exhausted attempts');
}
