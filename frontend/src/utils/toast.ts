// Simple toast event system
// Dispatch 'show-toast' event from anywhere to show a toast

export interface ToastEvent {
  message: string;
  type?: "info" | "success" | "error";
  duration?: number;
}

let toastId = 0;

export function showToast(
  message: string,
  type: "info" | "success" | "error" = "info",
  duration = 4000,
) {
  const event = new CustomEvent<ToastEvent>("show-toast", {
    detail: { message, type, duration },
  });
  window.dispatchEvent(event);
}
