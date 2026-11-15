/**
 * In-memory handoff for the partial token between the OAuth callback and the
 * MFA / forced-password-change forms.
 *
 * It deliberately does not use localStorage, sessionStorage, the URL or the
 * router history: the token is short-lived and must not survive a reload or be
 * readable by another tab. If the user reloads, they start the login again.
 */
export type PartialAuthPurpose = "mfa" | "password_change";

type PendingPartialToken = { token: string; purpose: PartialAuthPurpose };

let pending: PendingPartialToken | null = null;

export function setPartialAuthToken(token: string, purpose: PartialAuthPurpose): void {
  pending = { token, purpose };
}

/** Consume the token only if it is for the expected step; one read only. */
export function takePartialAuthToken(purpose: PartialAuthPurpose): string | null {
  if (!pending || pending.purpose !== purpose) return null;
  const token = pending.token;
  pending = null;
  return token;
}

export function clearPartialAuthToken(): void {
  pending = null;
}
