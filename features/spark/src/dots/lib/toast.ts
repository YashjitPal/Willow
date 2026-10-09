import type { ReactNode } from 'react';

interface ToastOptions {
  id?: string;
  duration?: number;
  action?: { label: ReactNode; onClick: () => void };
}

let nextId = 0;

/**
 * The `toast` calls the Codex bot components make. Spark has no toast host, and
 * the mocked services Willow runs them against never fail, so these only log.
 */
export const toast = {
  success(content: ReactNode, options: ToastOptions = {}) {
    console.info('[dots]', content);
    return options.id ?? `dots-toast-${++nextId}`;
  },
  error(content: ReactNode, options: ToastOptions = {}) {
    console.warn('[dots]', content);
    return options.id ?? `dots-toast-${++nextId}`;
  },
  dismiss(_id?: string | number) {},
};
