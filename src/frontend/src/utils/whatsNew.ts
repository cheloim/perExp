export const WHATS_NEW_LOCAL_KEY = "whats_new_dont_remind_version";

interface WhatsNewUser {
  onboarding_completed?: boolean;
  whats_new_dismissed_version?: string | null;
}

interface WhatsNewGate {
  pathname: string;
  user: WhatsNewUser | null | undefined;
  latestVersion: string;
  localDismissedVersion: string | null;
}

/**
 * Whether the release modal should be scheduled on this render.
 *
 * The user is required: the first render always happens before `/auth/me`
 * answers, and scheduling the modal then is what made a dismissed release
 * reappear on every new device. The server dismissal wins over the local one,
 * so a device that never saw the modal catches up on the next load.
 */
export function shouldShowWhatsNew({
  pathname,
  user,
  latestVersion,
  localDismissedVersion,
}: WhatsNewGate): boolean {
  if (pathname !== "/") return false;
  if (!user || !user.onboarding_completed) return false;
  if (user.whats_new_dismissed_version === latestVersion) return false;
  if (localDismissedVersion === latestVersion) return false;
  return true;
}
