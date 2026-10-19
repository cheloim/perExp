# Asistente unificado — Etapa 1 (refactor del frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two near-duplicate assistant components with one domain-aware `Assistant`, sharing one session store and one UI, at the approved 76% × 78% centered modal.

**Architecture:** One `Assistant` component rendered once by `App`. Chrome and endpoint follow the **domain of the last message**, not the route, so a mixed thread reads correctly on any screen. Domain differences live in `ASSISTANT_CONFIGS: Record<AssistantDomain, AssistantConfig>` and are dispatched by data, never by `if`. The two legacy filesystem stores merge into one domain-agnostic session list.

**Tech Stack:** React 18 + TypeScript, Vite, react-router-dom, Vitest + Testing Library, Playwright (projects `desktop-chromium` 1440×900, `mobile-chromium` Pixel 7).

**Spec:** `docs/Asistente-IA-Unificacion.md`

## Global Constraints

- Modal geometry: `width: 76%; height: 78%` from `sm:` up (approved D3), `w-full h-full` below. Not `max-w-2xl`.
- `openBudgetMs = 300` for both domains.
- Spending behaviour is **unchanged** in this stage: same endpoint, payload, storage keys, suggestions, `ANALYZE_PROMPT` sentinel value, 2h session rotation.
- Investments keeps its current lifecycle: `rotateAfterIdleMinutes = 0` (it has no rotation today).
- Spanish copy stays as-is.
- Legacy `ai_assistant_*` / `inv_assistant_*` data must survive the migration — no silent deletion.
- `window.__AI_ASSISTANT_OPEN_MS__` keeps its shape; the `open-start` mark fires in the open trigger and `open-end` in the shell.
- `useFocusTrap` (`src/frontend/src/hooks/useFocusTrap.ts`) is consumed as-is; do not fork it.
- `Bubble` stays wrapped in `React.memo` with its dev-only render counter.

## Review Focus

1. **Legacy localStorage migration** — two stores of up to 30 sessions each merging into one; a wrong ordering rule or a dropped session silently destroys user data. → Task 1.
2. **Retry must resend the real prompt**, including the `ANALYZE_PROMPT` sentinel, which routes to a different code path than a normal message. → Task 2.
3. **Autofocus timing** — the composer takes focus 100 ms after open and steals it back; a test that focuses elsewhere without first awaiting `toBeFocused()` passes for the wrong reason. → Task 5.
4. **Escape must persist the closed state** — the #415 bug where Escape bypassed `toggleDrawer` and the drawer reopened on reload. The unified store must not reintroduce it. → Task 5.
5. **Perf instrumentation spans `App.tsx` and the shell** — moving the `open-start` mark breaks `assistant-perf.spec.ts` if the two halves stop bracketing one operation. → Task 6.

---

### Task 1: Types, legacy migration, session store

**Files:**
- Create: `src/frontend/src/components/assistant/types.ts`
- Create: `src/frontend/src/components/assistant/migrateLegacySessions.ts`
- Create: `src/frontend/src/components/assistant/useAssistantSessions.ts`
- Test: `src/frontend/src/components/assistant/useAssistantSessions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks rely on these exact names):

```ts
// types.ts
export type Role = "user" | "assistant";
export type AssistantDomain = "spending" | "investments";
export type Message = {
  role: Role;
  text: string;
  domain?: AssistantDomain; // absent on legacy messages
};
export type Session = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
};
export type StorageKeys = { sessions: string; active: string };

export type StreamArgs = {
  question: string;
  history: Message[];
  month?: string | null;
  debugMode?: boolean;
  context?: string;
};

export type AssistantConfig = {
  domain: AssistantDomain;
  title: string;
  triggerLabel: string;
  placeholder: string;
  suggestions: string[];
  storage: StorageKeys;
  streamUrl: string;
  buildBody: (args: StreamArgs) => Record<string, unknown>;
  buildContext?: () => string;
  analyzeSlot?: { label: string; prompt: string };
  rotateAfterIdleMinutes: number;
  openBudgetMs: number;
};

// migrateLegacySessions.ts
export function migrateLegacySessions(
  target: StorageKeys,
  sources: Record<AssistantDomain, StorageKeys>,
): void;

// useAssistantSessions.ts
export function useAssistantSessions(
  storage: StorageKeys,
  rotateAfterIdleMinutes: number,
): {
  sessions: Session[];
  activeId: string;
  activeSession: Session | undefined;
  createSession: () => string;
  setActiveId: (id: string) => void;
  updateSession: (id: string, fn: (s: Session) => Session) => void;
  deleteSession: (id: string) => void;
  maybeRotate: () => void;
};
```

- [ ] **Step 1: Write the failing tests for `migrateLegacySessions`**

```ts
describe("migrateLegacySessions", () => {
  it("merges both legacy stores into one session list ordered by first message", ...)
  it("tags every migrated message with its source domain", ...)
  it("is idempotent: running twice does not duplicate sessions", ...)
  it("preserves every session from both sources", ...)
});
```

Source keys are exactly `ai_assistant_sessions` / `ai_assistant_active` and
`inv_assistant_sessions` / `inv_assistant_active`; the target keys are the new
shared pair.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd src/frontend && npx vitest run src/components/assistant/useAssistantSessions.test.ts`
Expected: FAIL with `migrateLegacySessions is not defined`

- [ ] **Step 3: Implement `migrateLegacySessions`**

Order by the first message timestamp of each session ascending; set `domain` on
every message from its source store; write to `target.sessions`; leave the source
keys in place so a rollback is possible.

- [ ] **Step 4: Run the tests to verify they pass**

- [ ] **Step 5: Write the failing tests for `useAssistantSessions`**

```ts
describe("useAssistantSessions", () => {
  it("creates a session and makes it active", ...)
  it("persists sessions to the configured storage keys", ...)
  it("rotates to a fresh session after rotateAfterIdleMinutes of inactivity", ...)
  it("never rotates when rotateAfterIdleMinutes is 0", ...)
  it("caps retained sessions at 30", ...)
});
```

- [ ] **Step 6: Run to verify they fail**, **Step 7: implement `useAssistantSessions`**, **Step 8: run to verify they pass**

Run: `cd src/frontend && npx vitest run src/components/assistant/useAssistantSessions.test.ts`
Expected: FAIL, then PASS.

Rotation is evaluated inside `maybeRotate()`; the hook sets no timer of its own.

- [ ] **Step 9: Commit**

```bash
git add src/frontend/src/components/assistant/
git commit -m "feat(chat): shared domain-agnostic assistant session store (#417)"
```

---

### Task 2: Streaming chat hook

**Files:**
- Create: `src/frontend/src/components/assistant/useAssistantChat.ts`
- Test: `src/frontend/src/components/assistant/useAssistantChat.test.ts`

**Interfaces:**
- Consumes: `Message`, `StreamArgs`, `AssistantConfig` from `types.ts` (Task 1).
- Produces:

```ts
export function useAssistantChat(config: AssistantConfig): {
  streaming: boolean;
  error: string | null;
  send: (args: StreamArgs, onChunk: (full: string) => void) => Promise<string>;
  cancel: () => void;
  retry: () => Promise<string>;
};
```

- [ ] **Step 1: Write the failing tests**

```ts
describe("useAssistantChat", () => {
  it("posts config.buildBody(args) to config.streamUrl and accumulates chunks", ...)
  it("cancels an in-flight stream via AbortController and reports no error", ...)
  it("surfaces an HTTP error", ...)
  it("includes the whole history so the model sees prior turns", ...)
  it("retry re-sends the original prompt text, not cleared input", ...)
  it("retry re-sends the ANALYZE_PROMPT sentinel unchanged", ...)
});
```

`fetch` is mocked; assertions are on the request body.

- [ ] **Step 2: Run to verify they fail**

Run: `cd src/frontend && npx vitest run src/components/assistant/useAssistantChat.test.ts`
Expected: FAIL with `useAssistantChat is not defined`

- [ ] **Step 3: Implement `useAssistantChat`**

Take the `streamTo` primitive from `AIAssistant.tsx:55-100` (the variant with
`AbortSignal`). The hook stores the last `StreamArgs` it was given so `retry`
resends that exact object — never a value read back from input state.

- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit**

```bash
git add src/frontend/src/components/assistant/useAssistantChat.*
git commit -m "feat(chat): shared streaming hook with abort and real retry (#417)"
```

---

### Task 3: Summarize hook

**Files:**
- Create: `src/frontend/src/components/assistant/useSummarize.ts`
- Test: `src/frontend/src/components/assistant/useSummarize.test.ts`

**Interfaces:**
- Consumes: `Message`.
- Produces:

```ts
export function useSummarize(): {
  summarizing: boolean;
  summarize: (messages: Message[], onChunk: (full: string) => void) => Promise<string>;
};
```

- [ ] **Step 1: Write the failing test** — `summarize` POSTs `{ messages }` to `/api/analysis/summarize` and streams the result. Both domains already share this endpoint (`AIAssistant.tsx:369`, `InvestmentsAssistant.tsx:526`).
- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/components/assistant/useSummarize.test.ts`
- [ ] **Step 3: Implement `useSummarize`** — same `streamTo` primitive as Task 2.
- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Commit** — `feat(chat): shared session summarization hook (#417)`

---

### Task 4: Domain configs

**Files:**
- Create: `src/frontend/src/components/assistant/configs.ts`
- Test: `src/frontend/src/components/assistant/configs.test.ts`

**Interfaces:**
- Consumes: `AssistantDomain`, `StorageKeys`, `StreamArgs`, `AssistantConfig` from `types.ts` (Task 1).
- Produces:

```ts
export const ASSISTANT_CONFIGS: Record<AssistantDomain, AssistantConfig>;
```

- [ ] **Step 1: Write the failing tests** pinning the exact values from the spec:

```ts
describe("ASSISTANT_CONFIGS.spending", () => {
  it("targets /api/analysis/stream with { month, question, debug_mode }", ...)
  it("uses ai_assistant_sessions / ai_assistant_active", ...)
  it("keeps the ANALYZE_PROMPT sentinel '✨ Analizar gastos del mes' and its slot", ...)
  it("rotates sessions after 120 minutes", ...)
  it("has a 300ms open budget", ...)
});
describe("ASSISTANT_CONFIGS.investments", () => {
  it("targets /api/investments/chat/stream with { question, context }", ...)
  it("uses inv_assistant_sessions / inv_assistant_active", ...)
  it("has no analyze slot", ...)
  it("never rotates sessions", ...)
  it("has suggestions so both assistants share the same UI/UX", ...)
  it("has a 300ms open budget", ...)
});
```

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement the two configs** — copy values verbatim from `AIAssistant.tsx:21-33` and `InvestmentsAssistant.tsx:25-27`.
- [ ] **Step 4: Run to verify it passes**, then **Step 5: Commit** — `feat(chat): domain configs for spending and investments (#417)`

---

### Task 5: AssistantShell

**Files:**
- Create: `src/frontend/src/components/assistant/AssistantShell.tsx`
- Test: `src/frontend/src/components/assistant/AssistantShell.test.tsx`

**Interfaces:**
- Consumes: `AssistantConfig`, hooks from Tasks 1-3, `useFocusTrap`.
- Produces:

```ts
export function AssistantShell(props: {
  config: AssistantConfig;
  open: boolean;
  onToggle: () => void;
}): JSX.Element;
```

`AssistantShell` renders **one domain's** chrome. Task 6 decides which config it
receives; this task does not.

- [ ] **Step 1: Write the failing component tests**

```ts
describe("AssistantShell", () => {
  it("renders the dialog at 76% x 78% on desktop and full-bleed on mobile", ...)
  it("autofocuses the composer 100ms after open", ...)
  it("traps focus and never lets Tab or Shift+Tab escape", ...)
  it("escape closes the dialog and persists the closed state", ...)
  it("streams into the last bubble without re-rendering earlier bubbles", ...)
  it("shows the analyze slot only when config.analyzeSlot is present", ...)
  it("names the dialog from config.title for assistive tech", ...)
});
```

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement `AssistantShell`** — move the render tree from `AIAssistant.tsx:600-980`, parameterised by `config`. Geometry `w-[76%] h-[78%]` from `sm:` up. Keep `Bubble` in `React.memo` with its dev render counter.
- [ ] **Step 4: Run to verify it passes**
- [ ] **Step 5: Commit** — `feat(chat): shared assistant shell at the approved 76% x 78% (#417)`

---

### Task 6: Assistant component and App rewiring

**Files:**
- Create: `src/frontend/src/components/assistant/Assistant.tsx`
- Create: `src/frontend/src/components/assistant/domainOf.test.ts`
- Modify: `src/frontend/src/App.tsx`
- Delete: `src/frontend/src/components/AIAssistant.tsx`
- Delete: `src/frontend/src/components/AIAssistant.test.tsx`
- Delete: `src/frontend/src/components/InvestmentsAssistant.tsx`
- Delete: `src/frontend/src/pages/AnalysisPage.tsx`
- Test: `src/frontend/src/components/assistant/Assistant.test.tsx`

**Interfaces:**
- Consumes: `AssistantShell`, `ASSISTANT_CONFIGS`, `useAssistantSessions`, `useAssistantChat`.
- Produces:

```ts
export function domainOf(
  session: Session | undefined,
  initialDomain: AssistantDomain,
): AssistantDomain;

export default function Assistant(props: {
  open: boolean;
  onToggle: () => void;
  initialDomain: AssistantDomain;
}): JSX.Element;
```

- [ ] **Step 1: Write the failing tests for `domainOf`**

```ts
describe("domainOf", () => {
  it("returns initialDomain when the session is empty", ...)
  it("returns the domain of the last message when present", ...)
  it("falls back to initialDomain for legacy messages with no domain", ...)
});
```

- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Implement `domainOf`** — one expression:

```ts
session?.messages.at(-1)?.domain ?? initialDomain
```

- [ ] **Step 4: Write the failing tests for `Assistant`**

```ts
describe("Assistant", () => {
  it("renders one instance with spending chrome on an empty spending session", ...)
  it("switches chrome and endpoint after a message tagged investments", ...)
  it("does not change chrome when the route changes mid-conversation", ...)
});
```

- [ ] **Step 5: Run to verify they fail**
- [ ] **Step 6: Implement `Assistant` and rewire `App.tsx`**

`App` renders `<Assistant />` **once**; both triggers open it with a different
`initialDomain` (speed dial → `spending`, investments FAB → `investments`). Keep the
`open-start` mark in the open trigger and `open-end` in the shell. Delete the dead
`AnalysisPage.tsx` (verified: no importer).

- [ ] **Step 7: Run the existing e2e suite**

Run: `cd src/frontend && npx playwright test`
Expected: `assistant-open`, `assistant-composer`, `assistant-a11y`, `assistant-perf` green.
Update any assertion pinned to the old `max-w-2xl` geometry.

- [ ] **Step 8: Commit** — `refactor(chat): one assistant component, chrome follows the thread (#417)`

---

### Task 7: Investments e2e suite

**Files:**
- Create: `src/frontend/e2e/investments-assistant.spec.ts`

- [ ] **Step 1: Write the failing e2e spec** — the coverage the spending assistant already has: one-click open, Escape, `aria-modal`, Enter/Shift+Enter, char cap, cancel, error + retry, axe audit, open-time budget.
- [ ] **Step 2: Run to verify it fails**
- [ ] **Step 3: Verify it passes** — `npx playwright test e2e/investments-assistant.spec.ts`
- [ ] **Step 4: Commit** — `test(chat): e2e coverage for the investments assistant (#417)`

---

### Task 8: Docs and spec updates

**Files:**
- Modify: `docs/Asistente-IA-Unificacion.md`
- Modify: `docs/Frontend.md`
- Modify: `docs/specs/features/analysis.spec.yaml`
- Modify: `docs/specs/features/investments.spec.yaml`

- [ ] **Step 1: Update the docs** to describe one component + domain configs, and record the measured duplicate ratio (target: wrapper similarity under 20%).
- [ ] **Step 2: Run `npx prettier --write docs/`** and the full verification suite.
- [ ] **Step 3: Commit** — `docs(chat): record the assistant unification (#417)`
