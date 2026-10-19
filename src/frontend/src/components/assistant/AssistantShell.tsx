import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { Bubble } from "./Bubble";
import { SessionCard } from "./SessionCard";
import { domainOf } from "./domainOf";
import { routeDomain } from "./routeDomain";
import { useAssistantChat } from "./useAssistantChat";
import { useAssistantSessions } from "./useAssistantSessions";
import { useSummarize } from "./useSummarize";
import { SHARED_STORAGE } from "./types";
import type { AssistantConfig, AssistantDomain, Message } from "./types";

const MAX_INPUT_LENGTH = 2000;

export function AssistantShell({
  configs,
  initialDomain,
  open,
  onToggle,
  buildContext,
}: {
  configs: Record<AssistantDomain, AssistantConfig>;
  initialDomain: AssistantDomain;
  open: boolean;
  onToggle: () => void;
  /** Supplies the extra request context a domain needs (e.g. the portfolio snapshot). */
  buildContext?: () => string;
}) {
  const trapRef = useFocusTrap(open, onToggle);
  const store = useAssistantSessions(SHARED_STORAGE);
  const {
    sessions,
    activeId,
    activeSession,
    createSession,
    updateSession,
    deleteSession,
    maybeRotate,
  } = store;

  // Chrome and endpoint follow the domain of the last message, not the route,
  // so a thread can cross between spending and investments without the window
  // changing personality when the user navigates.
  const domain = domainOf(activeSession, initialDomain);
  const config = configs[domain];

  const { streaming, error, send, cancel } = useAssistantChat();
  const { summarizing, summarize } = useSummarize();

  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  /**
   * Synchronous re-entrancy guard. `streaming` is React state and does not
   * update until the next render, so two triggers in the same tick (Enter
   * keydown plus the form submit, for instance) would both pass the guard and
   * append two bubbles.
   */
  const busyRef = useRef(false);

  /** Always current, so streaming callbacks never write into a stale session. */
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Memoized so the callbacks below keep a stable identity between renders and
  // never close over a fresh empty array.
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);
  const lastMessage = messages[messages.length - 1];
  const hasError = lastMessage?.error === true;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const isLocalhost =
    typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  useEffect(() => {
    if (!open) return;
    // Evaluate idle rotation on open too, not only when a message is sent, or a
    // stale thread is shown until the first send and then jumps mid-interaction.
    maybeRotate(config.rotateAfterIdleMinutes);
    const id = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(id);
  }, [open, maybeRotate, config.rotateAfterIdleMinutes]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, open]);

  // Open-time instrumentation: `open-start` is marked by the owner's toggle, and
  // the first painted frame closes the measurement.
  useEffect(() => {
    if (!open) return;
    const done = () => {
      try {
        performance.mark("ai-assistant:open-end");
        const m = performance.measure(
          "ai-assistant:open",
          "ai-assistant:open-start",
          "ai-assistant:open-end",
        );
        (window as unknown as Record<string, number>).__AI_ASSISTANT_OPEN_MS__ = m.duration;
      } catch {
        /* start mark missing — not an open we instrumented */
      } finally {
        // Release both ends and the measure once the duration is published: an
        // unreleased entry grows the performance buffer by one per open, forever.
        performance.clearMarks("ai-assistant:open-start");
        performance.clearMarks("ai-assistant:open-end");
        performance.clearMeasures("ai-assistant:open");
      }
    };
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(done));
    return () => cancelAnimationFrame(raf2);
  }, [open]);

  const writeLast = useCallback(
    (full: string) => {
      const id = activeIdRef.current;
      updateSession(id, (s) => {
        const next = [...s.messages];
        if (next.length === 0) return s;
        next[next.length - 1] = { ...next[next.length - 1], text: full };
        return { ...s, messages: next };
      });
    },
    [updateSession],
  );

  const appendPair = useCallback(
    (sessionId: string, text: string, domain: AssistantDomain) => {
      updateSession(sessionId, (s) => ({
        ...s,
        lastMessageTs: Date.now(),
        messages: [
          ...s.messages,
          { role: "user", text, domain },
          { role: "assistant", text: "", domain },
        ] as Message[],
      }));
    },
    [updateSession],
  );

  /**
   * Summarize a session before it is left behind, so the history tab and the
   * "Resumen" panel keep working for new sessions the way they did before the
   * unification. Fire-and-forget: the user is already moving on.
   *
   * Declared before the send paths so they can name it in their dependency
   * arrays without hitting the temporal dead zone.
   */
  const summarizeById = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      if (!target || target.messages.length === 0 || target.summary) return;
      void summarize(target.messages, () => {}).then((full) => {
        if (full) updateSession(id, (s) => ({ ...s, summary: full }));
      });
    },
    [sessions, summarize, updateSession],
  );

  const sendMessage = useCallback(
    async (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || streaming || busyRef.current) return;
      if (overrideText === undefined) setInput("");
      busyRef.current = true;

      const previousId = activeIdRef.current;
      const sessionId = maybeRotate(config.rotateAfterIdleMinutes);
      if (sessionId !== previousId) summarizeById(previousId);

      // The words decide which endpoint answers, not the route: a cartera
      // question asked in a spending thread goes to the investments model.
      const target = configs[routeDomain(text, config.domain)];
      appendPair(sessionId, text, target.domain);

      // A rotated session starts clean. `messages` is the array captured before
      // the rotation — the thread that was just left behind — and must not
      // travel with the first message of the new one.
      const history = sessionId === previousId ? messages : [];
      try {
        await send(
          target,
          {
            question: text,
            history,
            month: currentMonth,
            debugMode,
            context: buildContext ? buildContext() : undefined,
          },
          writeLast,
        ).catch(() => {
          writeLast("");
          updateSession(activeIdRef.current, (s) => {
            const next = [...s.messages];
            if (next.length === 0) return s;
            next[next.length - 1] = {
              ...next[next.length - 1],
              text: "No pude procesar la consulta. Revisá tu conexión e intentá de nuevo.",
              error: true,
            };
            return { ...s, messages: next };
          });
        });
      } finally {
        busyRef.current = false;
      }
    },
    [
      input,
      streaming,
      maybeRotate,
      config,
      configs,
      summarizeById,
      appendPair,
      messages,
      send,
      writeLast,
      updateSession,
      debugMode,
      currentMonth,
      buildContext,
    ],
  );

  /**
   * Summarize the current session. The stream goes into a transient preview and
   * is committed to `Session.summary` — never into the last message, which is
   * the user's actual reply and must not be overwritten.
   */
  const runSummarize = useCallback(async () => {
    const full = await summarize(messages, () => {});
    if (full) {
      updateSession(activeIdRef.current, (s) => ({ ...s, summary: full }));
    }
  }, [messages, summarize, updateSession]);

  const runAnalyze = useCallback(() => {
    const slot = config.analyzeSlot;
    if (!slot || streaming || busyRef.current) return;
    busyRef.current = true;
    const previousId = activeIdRef.current;
    const sessionId = maybeRotate(config.rotateAfterIdleMinutes);
    if (sessionId !== previousId) summarizeById(previousId);
    appendPair(sessionId, slot.prompt, config.domain);
    void slot
      .run()
      .then((full) => writeLast(full))
      .catch((err: unknown) => {
        // Mirror the chat error path so the bubble gets `error: true` and the
        // Reintentar affordance (and the sentinel retry branch) becomes reachable.
        const detail = err instanceof Error ? err.message : "Error desconocido";
        updateSession(activeIdRef.current, (s) => {
          const next = [...s.messages];
          if (next.length === 0) return s;
          next[next.length - 1] = {
            ...next[next.length - 1],
            text: `No pude analizar el mes: ${detail}`,
            error: true,
          };
          return { ...s, messages: next };
        });
      })
      .finally(() => {
        busyRef.current = false;
      });
  }, [config, streaming, maybeRotate, summarizeById, appendPair, writeLast, updateSession]);

  /**
   * Re-run the last user prompt. Pops the failed assistant bubble AND the user
   * message that produced it so the replay can re-append both — otherwise the
   * retry would duplicate the user bubble.
   */
  const retryLastMessage = useCallback(() => {
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const text = messages[lastUserIdx].text;
    updateSession(activeIdRef.current, (s) => ({
      ...s,
      messages: s.messages.slice(0, lastUserIdx),
    }));
    if (config.analyzeSlot && text === config.analyzeSlot.prompt) {
      runAnalyze();
      return;
    }
    void sendMessage(text);
  }, [messages, updateSession, config.analyzeSlot, sendMessage, runAnalyze]);

  const startNewSession = useCallback(() => {
    summarizeById(activeIdRef.current);
    createSession();
    setShowHistory(false);
  }, [summarizeById, createSession]);

  const handleDeleteSession = useCallback(() => {
    if (deleteConfirm) deleteSession(deleteConfirm);
    setDeleteConfirm(null);
  }, [deleteConfirm, deleteSession]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 animate-modal-backdrop bg-black/60"
        onClick={onToggle}
      >
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-label={config.title}
          className="relative flex flex-col bg-[var(--color-surface)] border border-[var(--border-color)] rounded-none sm:rounded-2xl shadow-gnome-lg animate-modal-content w-full h-full sm:w-[76%] sm:h-[78%] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sheet grip — the GNOME bottom-sheet language approved on D3 */}
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
            <span className="w-9 h-1 rounded-full bg-[var(--border-color)]" />
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-secondary">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              <span className="text-base font-semibold text-primary">{config.title}</span>
              {streaming && (
                <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"
                    aria-hidden="true"
                  />
                  respondiendo
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {messages.length > 0 && (
                <button
                  onClick={() => void runSummarize()}
                  disabled={summarizing}
                  className="gnome-btn-secondary-round text-sm"
                >
                  {summarizing ? <span className="animate-spin inline-block">↻</span> : "Resumir"}
                </button>
              )}
              {isLocalhost && (
                <button
                  onClick={() => setDebugMode(!debugMode)}
                  className={`flex items-center justify-center w-8 h-8 rounded-full transition-all ${
                    debugMode
                      ? "bg-[var(--gnome-orange-1)]/20 text-[var(--gnome-orange-4)]"
                      : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
                  }`}
                  title={debugMode ? "Debug mode ON" : "Activar debug mode"}
                  aria-pressed={debugMode}
                >
                  {debugMode ? "🔓" : "🔒"}
                </button>
              )}
              <button
                onClick={onToggle}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] transition-all"
                title="Cerrar"
                aria-label="Cerrar asistente"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-color)] flex-shrink-0">
            <div className="flex gap-2">
              <button
                onClick={() => setShowHistory(false)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  !showHistory
                    ? "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)]"
                    : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
                }`}
                aria-pressed={!showHistory}
              >
                Chat
              </button>
              <button
                onClick={() => setShowHistory(true)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                  showHistory
                    ? "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)]"
                    : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
                }`}
                aria-pressed={showHistory}
              >
                Historial{" "}
                {sessions.filter((s) => s.id !== activeId).length > 0 && (
                  <span className="ml-1 opacity-70">
                    ({sessions.filter((s) => s.id !== activeId).length})
                  </span>
                )}
              </button>
            </div>
            {!showHistory && (
              <button onClick={startNewSession} className="gnome-btn-secondary-round text-sm">
                Nueva
              </button>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            {showHistory ? (
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {sessions.length === 0 ? (
                  <p className="text-sm text-secondary text-center py-8">Sin historial aún</p>
                ) : (
                  [...sessions]
                    .reverse()
                    .filter((s) => s.id !== activeId)
                    .map((s) => (
                      <SessionCard
                        key={s.id}
                        session={s}
                        expanded={expandedId === s.id}
                        onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                        onDelete={() => setDeleteConfirm(s.id)}
                      />
                    ))
                )}
              </div>
            ) : (
              // Single scroll container for the thread — the wrapper above must NOT
              // also scroll or we get two nested scrollers fighting over the same space.
              <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0 overflow-y-auto">
                {messages.length === 0 && !streaming && (
                  <div className="flex-1 flex flex-col justify-center items-start gap-4 py-6">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                        Empezá por acá
                      </p>
                      <div className="flex flex-col gap-2">
                        {config.suggestions.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setInput(s);
                              inputRef.current?.focus();
                            }}
                            className="text-left text-sm px-3.5 py-2.5 rounded-xl bg-[var(--color-primary-strong)]/8 hover:bg-[var(--color-primary-strong)]/15 text-[var(--color-primary-strong)] transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    {config.analyzeSlot && (
                      <button onClick={runAnalyze} className="gnome-btn-primary-strong text-sm">
                        {config.analyzeSlot.label}
                      </button>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {messages.map((msg, i) => (
                    <Bubble
                      key={`${activeId}-${i}`}
                      msg={msg}
                      streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
                    />
                  ))}

                  {hasError && !streaming && (
                    <div className="flex gap-2 pl-1">
                      <button onClick={retryLastMessage} className="gnome-btn-secondary text-sm">
                        Reintentar
                      </button>
                      <button onClick={startNewSession} className="gnome-btn-secondary text-sm">
                        Nueva consulta
                      </button>
                    </div>
                  )}

                  {!streaming &&
                    !hasError &&
                    lastMessage?.role === "assistant" &&
                    lastMessage.text && (
                      <div
                        className="flex flex-wrap gap-2 pt-1"
                        role="group"
                        aria-label="Sugerencias de seguimiento"
                      >
                        {config.followUps.map((s) => (
                          <button
                            key={s}
                            onClick={() => {
                              setInput(s);
                              inputRef.current?.focus();
                            }}
                            className="text-xs px-2.5 py-1.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] transition-colors"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}

                  <div ref={chatEndRef} />
                </div>
              </div>
            )}
          </div>

          {!showHistory && (
            <div className="px-4 py-3 border-t border-[var(--border-color)] flex-shrink-0 bg-[var(--color-surface)]">
              {activeSession?.summary && (
                <div className="mb-2 px-3 py-2 bg-[var(--color-primary)]/10 border border-[var(--border-color)] rounded-lg">
                  <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-0.5">
                    Resumen
                  </p>
                  <p className="text-xs text-primary leading-relaxed line-clamp-3">
                    {activeSession.summary}
                  </p>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendMessage();
                }}
                className="flex items-end gap-2 bg-[var(--color-base-alt)] border border-transparent focus-within:border-[var(--color-primary)] focus-within:bg-[var(--color-surface)] rounded-2xl px-3.5 py-2.5 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey) return;
                      // Guard against IME composition (CJK input)
                      if (e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      void sendMessage();
                    }}
                    rows={1}
                    maxLength={MAX_INPUT_LENGTH}
                    aria-label={config.placeholder.replace("...", "")}
                    placeholder={config.placeholder}
                    className="w-full bg-transparent border-0 outline-none resize-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] leading-relaxed py-0.5"
                  />
                </div>

                <button
                  type="submit"
                  onClick={
                    streaming
                      ? (e) => {
                          e.preventDefault();
                          cancel();
                          writeLast("Respuesta cancelada.");
                        }
                      : undefined
                  }
                  disabled={!streaming && !input.trim()}
                  aria-label={streaming ? "Cancelar respuesta" : "Enviar mensaje"}
                  className={`flex items-center justify-center w-9 h-9 rounded-full transition-all flex-shrink-0 disabled:opacity-40 ${
                    streaming
                      ? "bg-danger text-white hover:brightness-110"
                      : "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)] hover:brightness-110 active:scale-95"
                  }`}
                >
                  {streaming ? (
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <rect x="6" y="6" width="12" height="12" rx="2.5" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M2 8l12-6-3 6 3 6-12-6z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              </form>

              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-tertiary)] px-1">
                <span role="status" aria-live="polite">
                  {streaming ? config.analyzingLabel : ""}
                </span>
                <span className="ml-auto tabular-nums">
                  {input.length} / {MAX_INPUT_LENGTH}
                </span>
                {error && <span className="text-danger">{error}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title="Eliminar sesión"
        message="¿Estás seguro de que quieres eliminar esta sesión? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={handleDeleteSession}
        onCancel={() => setDeleteConfirm(null)}
        variant="danger"
      />
    </>
  );
}
