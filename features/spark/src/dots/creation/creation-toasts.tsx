import type { ReactNode } from "react";
import { toast } from "../lib/toast";

interface ToastAction {
  label: ReactNode;
  onClick: () => void;
}

interface DangerOptions {
  errorAnalytics?: { toastId: string };
  duration?: number;
  primaryAction?: ToastAction;
}

export interface ToastHandle {
  close: () => void;
}

/** The `YPt` toast service calls made by the creation area. */
export const creationToasts = {
  success(content: ReactNode): ToastHandle {
    const id = toast.success(content);
    return { close: () => toast.dismiss(id) };
  },
  danger(content: ReactNode, options: DangerOptions = {}): ToastHandle {
    const id = toast.error(content, {
      id: options.errorAnalytics?.toastId,
      duration: options.duration === 0 ? Number.POSITIVE_INFINITY : options.duration,
      action: options.primaryAction == null ? undefined : { label: options.primaryAction.label, onClick: options.primaryAction.onClick },
    });
    return { close: () => toast.dismiss(id) };
  },
};
