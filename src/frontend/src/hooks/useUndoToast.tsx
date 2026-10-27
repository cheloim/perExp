import { useCallback } from "react";
import { hapticSuccess } from "../services/telegramWebApp";
import { pushToast, showToast, type ToastPosition } from "../utils/toast";

/**
 * Undo-style toasts and plain info toasts.
 *
 * Rendering lives in `ToastViewport`, mounted once in `App`; this hook only
 * pushes into the shared store in `utils/toast`.
 */
export function useUndoToast() {
  const show = useCallback(
    (message: string, onConfirm: () => void, onUndo?: () => void, duration = 5000) => {
      pushToast({
        message,
        kind: "undo",
        position: "bottom-center",
        duration,
        // Dismissing with "Deshacer" clears the countdown, so onConfirm never
        // runs: the action is undone, not merely delayed.
        onConfirm,
        onUndo,
      });
      hapticSuccess();
    },
    [],
  );

  const showInfo = useCallback(
    (message: string, duration = 4000, position: ToastPosition = "bottom-center") => {
      showToast(message, "info", duration, position);
    },
    [],
  );

  return { show, showInfo };
}
