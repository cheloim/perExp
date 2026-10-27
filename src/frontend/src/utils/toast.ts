/**
 * Toasts.
 *
 * A single module-level store, not a window event: the event version was
 * listened to by every mounted `useUndoToast()` instance, so a toast rendered
 * once per listener — on /expenses it came up twice.
 *
 * The countdown pauses while the pointer is over the toast. A notification
 * that closes itself before it can be read is exactly the "no tiene fuerza"
 * from #455.
 */

export type ToastKind = "info" | "success" | "error" | "undo";
export type ToastPosition = "bottom-center" | "top-right";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastRecord {
  id: number;
  /** The headline. */
  message: string;
  /** The detail — shown when present. */
  body?: string;
  action?: ToastAction;
  onUndo?: () => void;
  onConfirm?: () => void;
  kind: ToastKind;
  position: ToastPosition;
  /** Milliseconds before it closes on its own. */
  duration: number;
}

let nextId = 0;
let toasts: ToastRecord[] = [];
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToasts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getToasts(): ToastRecord[] {
  return toasts;
}

function remove(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function schedule(toast: ToastRecord) {
  const timer = setTimeout(() => {
    timers.delete(toast.id);
    const onConfirm = toast.onConfirm;
    remove(toast.id);
    onConfirm?.();
  }, toast.duration);
  timers.set(toast.id, timer);
}

/** Show a toast and return its id. */
export function pushToast(t: Omit<ToastRecord, "id">): number {
  const id = ++nextId;
  const toast: ToastRecord = { ...t, id };
  toasts = [...toasts, toast];
  emit();
  schedule(toast);
  return id;
}

export function dismissToast(id: number) {
  remove(id);
}

/** Stop the countdown — the user is reading. */
export function pauseToast(id: number) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

/** Restart the countdown after `duration` from now. */
export function resumeToast(id: number) {
  if (timers.has(id)) return;
  const toast = toasts.find((t) => t.id === id);
  if (toast) schedule(toast);
}

/**
 * Fire a toast from anywhere.
 *
 * The signature is positional and unchanged — `extra` is the only addition.
 */
export function showToast(
  message: string,
  type: "info" | "success" | "error" = "info",
  duration = 4000,
  position: ToastPosition = "bottom-center",
  extra?: { body?: string; action?: ToastAction },
) {
  pushToast({
    message,
    body: extra?.body,
    action: extra?.action,
    kind: type,
    duration,
    position,
  });
}
