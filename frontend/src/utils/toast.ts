// Simple toast event system
// Dispatch 'show-toast' event from anywhere to show a toast

export interface ToastEvent {
  message: string;
  type?: "info" | "success" | "error";
  duration?: number;
  position?: "bottom-center" | "top-right";
}

export function showToast(
  message: string,
  type: "info" | "success" | "error" = "info",
  duration = 4000,
  position: "bottom-center" | "top-right" = "bottom-center",
) {
  const event = new CustomEvent<ToastEvent>("show-toast", {
    detail: { message, type, duration, position },
  });
  window.dispatchEvent(event);
}
