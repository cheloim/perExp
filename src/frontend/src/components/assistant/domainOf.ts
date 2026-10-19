import type { AssistantDomain, Session } from "./types";

/**
 * Which domain's chrome and endpoint the assistant should use right now.
 *
 * The thread has no domain; the last message does. The route only seeds a
 * brand-new conversation, so navigating mid-thread never swaps the persona.
 */
export function domainOf(
  session: Session | undefined,
  initialDomain: AssistantDomain,
): AssistantDomain {
  const messages = session?.messages;
  const last = messages && messages[messages.length - 1];
  return last?.domain ?? initialDomain;
}
