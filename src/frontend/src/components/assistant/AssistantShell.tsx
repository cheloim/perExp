import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ConfirmDialog } from "../ConfirmDialog";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import {
  clampDockedWidth,
  dockedWidthMax,
  DOCKED_WIDTH_DEFAULT,
  DOCKED_WIDTH_MIN,
  type AssistantMode,
} from "./layoutMode";
import { Bubble } from "./Bubble";
import { domainOf } from "./domainOf";
import { routeDomain } from "./routeDomain";
import { RemoteError } from "./streamTo";
import { useAssistantChat } from "./useAssistantChat";
import { useThread } from "./useThread";
import type { AssistantConfig, AssistantDomain, Message } from "./types";
import { useVoiceInput } from "../../hooks/useVoiceInput";

const MAX_INPUT_LENGTH = 2000;

export function AssistantShell({
  configs,
  initialDomain,
  open,
  onToggle,
  buildContext,
  mode = "modal",
  onModeChange,
  width = DOCKED_WIDTH_DEFAULT,
  onWidthChange,
}: {
  configs: Record<AssistantDomain, AssistantConfig>;
  initialDomain: AssistantDomain;
  open: boolean;
  onToggle: () => void;
  /** Supplies the extra request context a domain needs (e.g. the portfolio snapshot). */
  buildContext?: () => string;
  /** Floating modal (default) or a side panel that shares the width with the page. */
  mode?: AssistantMode;
  /** Switches between the two layouts. Omit only where docking has no owner. */
  onModeChange?: (mode: AssistantMode) => void;
  /** Width of the docked panel, in px. */
  width?: number;
  onWidthChange?: (width: number) => void;
}) {
  const docked = mode === "docked";
  // The stored preference can be wider than this viewport allows; render the
  // effective width and keep the preference untouched for when the screen grows.
  const panelWidth = clampDockedWidth(width);
  // A docked panel is not modal: the whole point is reading the page next to
  // the conversation, so focus must be free to leave the panel.
  const trapRef = useFocusTrap(open && !docked, onToggle);
  const { messages, updateThread, clearThread } = useThread();

  // Chrome and endpoint follow the domain of the last message, not the route,
  // so a thread can cross between spending and investments without the window
  // changing personality when the user navigates.
  const domain = domainOf({ messages }, initialDomain);
  const config = configs[domain];

  const { streaming, error, send, cancel } = useAssistantChat();

  const [input, setInput] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  /**
   * The data window the spending assistant analyses. Not persisted: the shell
   * stays mounted while the drawer is closed, so the choice survives within a
   * session, and a preference that must survive a reload belongs server-side.
   */
  const [months, setMonths] = useState<number>(12);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  /**
   * Synchronous re-entrancy guard. `streaming` is React state and does not
   * update until the next render, so two triggers in the same tick (Enter
   * keydown plus the form submit, for instance) would both pass the guard and
   * append two bubbles.
   */
  const busyRef = useRef(false);

  /**
   * Drag-to-resize state for the docked panel. The listeners live on `window`
   * (not the handle) so the pointer can outrun the 8px grip without the drag
   * dying; `stopResizeRef` lets an unmount release them too.
   */
  const [resizing, setResizing] = useState(false);
  const stopResizeRef = useRef<(() => void) | null>(null);

  useEffect(() => () => stopResizeRef.current?.(), []);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!onWidthChange || event.button !== 0) return;
      event.preventDefault();
      const move = (ev: PointerEvent) =>
        onWidthChange(clampDockedWidth(window.innerWidth - ev.clientX));
      const stop = () => {
        setResizing(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        stopResizeRef.current = null;
      };
      stopResizeRef.current?.();
      stopResizeRef.current = stop;
      setResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    },
    [onWidthChange],
  );

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!onWidthChange) return;
      // The grip sits on the left edge: ArrowLeft widens the panel.
      const step = event.shiftKey ? 64 : 16;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = clampDockedWidth(panelWidth + step);
      else if (event.key === "ArrowRight") next = clampDockedWidth(panelWidth - step);
      else if (event.key === "Home") next = DOCKED_WIDTH_MIN;
      else if (event.key === "End") next = dockedWidthMax();
      if (next === null) return;
      event.preventDefault();
      onWidthChange(next);
    },
    [onWidthChange, panelWidth],
  );

  const handleTranscript = useCallback((text: string) => {
    setInput((current) => (current ? `${current} ${text}` : text).slice(0, MAX_INPUT_LENGTH));
    inputRef.current?.focus();
  }, []);
  const voiceInput = useVoiceInput({ onTranscript: handleTranscript });
  const cancelVoiceInput = voiceInput.cancel;

  const lastMessage = messages[messages.length - 1];
  const hasError = lastMessage?.error === true;
  const isLocalhost =
    typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);

  useEffect(() => {
    if (!open) cancelVoiceInput();
  }, [open, cancelVoiceInput]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(id);
  }, [open]);

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
    // Two nested frames: the measure has to close after paint. Both ids are
    // kept so an unmount between the frames cancels the work instead of
    // running it against a dead component.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(done);
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [open]);

  const writeLast = useCallback(
    (full: string) => {
      updateThread((msgs) => {
        if (msgs.length === 0) return msgs;
        const next = [...msgs];
        next[next.length - 1] = { ...next[next.length - 1], text: full };
        return next;
      });
    },
    [updateThread],
  );

  const appendPair = useCallback(
    (text: string, domain: AssistantDomain) => {
      updateThread((msgs) => [
        ...msgs,
        { role: "user", text, domain },
        { role: "assistant", text: "", domain },
      ]);
    },
    [updateThread],
  );

  const sendMessage = useCallback(
    async (overrideText?: string, historyOverride?: Message[]) => {
      const text = (overrideText ?? input).trim();
      if (!text || streaming || busyRef.current) return;
      if (overrideText === undefined) setInput("");
      busyRef.current = true;

      // The words decide which endpoint answers, not the route: a cartera
      // question asked in a spending thread goes to the investments model.
      const target = configs[routeDomain(text, config.domain)];
      appendPair(text, target.domain);

      // A retry passes its own window: the thread as it stood before the failed
      // turn. `messages` is the array captured before the pair above landed.
      const history = historyOverride ?? messages;
      try {
        await send(
          target,
          {
            question: text,
            history,
            months,
            debugMode,
            context: buildContext ? buildContext() : undefined,
          },
          writeLast,
        ).catch((err: unknown) => {
          writeLast("");
          // The server's own failure text is worth showing; a transport
          // failure is not, so the connection copy stands for all of them.
          const detail =
            err instanceof RemoteError
              ? err.message
              : "No pude procesar la consulta. Revisá tu conexión e intentá de nuevo.";
          updateThread((msgs) => {
            if (msgs.length === 0) return msgs;
            const next = [...msgs];
            next[next.length - 1] = {
              ...next[next.length - 1],
              text: detail,
              error: true,
            };
            return next;
          });
        });
      } finally {
        busyRef.current = false;
      }
    },
    [
      input,
      streaming,
      config,
      configs,
      appendPair,
      messages,
      send,
      writeLast,
      updateThread,
      debugMode,
      buildContext,
      months,
    ],
  );

  const runAnalyze = useCallback(() => {
    const slot = config.analyzeSlot;
    if (!slot || streaming || busyRef.current) return;
    busyRef.current = true;
    appendPair(slot.prompt, config.domain);
    void slot
      .run()
      .then((full) => writeLast(full))
      .catch((err: unknown) => {
        // Mirror the chat error path so the bubble gets `error: true` and the
        // Reintentar affordance (and the sentinel retry branch) becomes reachable.
        const detail = err instanceof Error ? err.message : "Error desconocido";
        updateThread((msgs) => {
          if (msgs.length === 0) return msgs;
          const next = [...msgs];
          next[next.length - 1] = {
            ...next[next.length - 1],
            text: `No pude analizar el mes: ${detail}`,
            error: true,
          };
          return next;
        });
      })
      .finally(() => {
        busyRef.current = false;
      });
  }, [config, streaming, appendPair, writeLast, updateThread]);

  /**
   * Re-run the last user prompt. Pops the failed assistant bubble AND the user
   * message that produced it so the replay can re-append both — otherwise the
   * retry would duplicate the user bubble.
   *
   * The replay's window is the thread as it stood before the failed turn. The
   * array in state is read after the pop, but the render this callback closed
   * over is not: sending it would put the failed question in the history AND
   * in the new turn, twice.
   */
  const retryLastMessage = useCallback(() => {
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const text = messages[lastUserIdx].text;
    const history = messages.slice(0, lastUserIdx);
    updateThread((msgs) => msgs.slice(0, lastUserIdx));
    if (config.analyzeSlot && text === config.analyzeSlot.prompt) {
      runAnalyze();
      return;
    }
    void sendMessage(text, history);
  }, [messages, updateThread, config.analyzeSlot, sendMessage, runAnalyze]);

  /**
   * Wipe the thread. The one destructive affordance in the window, so it goes
   * through the shared ConfirmDialog — the same modal the old delete flow used.
   * A stream still running would write into the cleared thread, so it is
   * cancelled first.
   */
  const handleClearThread = useCallback(() => {
    cancel();
    clearThread();
    setInput("");
    setClearConfirm(false);
    inputRef.current?.focus();
  }, [cancel, clearThread]);

  if (!open) return null;

  // The window the next question is analysed in. Spending only: the
  // investments endpoint takes no period.
  const periodSelector = config.domain === "spending" && (
    <div
      role="group"
      aria-label="Período de análisis"
      className={`flex items-center gap-1 ${docked ? "" : "ml-1"}`}
    >
      <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">Período</span>
      {[3, 6, 12].map((m) => (
        <button
          key={m}
          onClick={() => setMonths(m)}
          aria-pressed={months === m}
          title={`Analizar los últimos ${m} meses`}
          className={`text-xs px-2 py-1 rounded-full border transition-colors ${
            months === m
              ? "bg-[var(--color-primary-strong)]/15 border-[var(--color-primary)] text-[var(--accent-color)]"
              : "border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)]"
          }`}
        >
          {m}m
        </button>
      ))}
    </div>
  );

  const streamingStatus = streaming && (
    <span className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
      respondiendo
    </span>
  );

  const headerActions = (
    <>
      {onModeChange && (
        <button
          onClick={() => onModeChange(docked ? "modal" : "docked")}
          aria-pressed={docked}
          className={`hidden md:flex items-center justify-center w-8 h-8 rounded-full transition-all ${
            docked
              ? "bg-[var(--color-primary-strong)]/15 text-[var(--accent-color)]"
              : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
          }`}
          title={docked ? "Volver a ventana flotante" : "Acoplar a la derecha"}
          aria-label={docked ? "Volver a ventana flotante" : "Acoplar a la derecha"}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <line x1="15" y1="4" x2="15" y2="20" />
          </svg>
        </button>
      )}
      {messages.length > 0 && (
        <button
          onClick={() => setClearConfirm(true)}
          aria-label="Limpiar"
          className={`flex items-center gap-1.5 gnome-btn-secondary-round text-sm whitespace-nowrap ${
            docked ? "w-8 h-8 min-h-0 px-0 justify-center" : ""
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
          <span className={docked ? "sr-only" : undefined}>Limpiar</span>
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
    </>
  );

  const panel = (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal={docked ? false : true}
      aria-label={config.title}
      className={
        docked
          ? "relative flex h-full w-full flex-col overflow-hidden border-[var(--border-color)] bg-[var(--color-surface)] md:border-l"
          : "relative flex flex-col bg-[var(--color-surface)] border border-[var(--border-color)] rounded-none sm:rounded-2xl shadow-gnome-lg animate-modal-content w-full h-full sm:w-[76%] sm:h-[78%] overflow-hidden"
      }
      onClick={(e) => e.stopPropagation()}
    >
      {docked && (
        /* Drag grip on the shared edge. Keyboard users get the same control
           through the arrow keys; double click restores the default width. */
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho del asistente"
          aria-valuenow={panelWidth}
          aria-valuemin={DOCKED_WIDTH_MIN}
          aria-valuemax={dockedWidthMax()}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={handleResizeKeyDown}
          onDoubleClick={() => onWidthChange?.(DOCKED_WIDTH_DEFAULT)}
          title="Arrastrá para ajustar el ancho · doble clic para restablecer"
          className={`absolute inset-y-0 left-0 z-10 hidden w-2 cursor-col-resize touch-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)] md:block ${
            resizing
              ? "bg-[var(--color-primary)]/50"
              : "bg-transparent hover:bg-[var(--color-primary)]/25"
          }`}
        />
      )}
      {/* Sheet grip — the GNOME bottom-sheet language approved on D3 */}
      <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
        <span className="w-9 h-1 rounded-full bg-[var(--border-color)]" />
      </div>

      <div
        className={`px-4 py-3 border-b border-[var(--border-color)] flex-shrink-0 ${
          docked ? "flex flex-col gap-2" : "flex items-center justify-between"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-secondary flex-shrink-0">
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
          <span className="text-base font-semibold text-primary truncate min-w-0">
            {config.title}
          </span>
          {!docked && periodSelector}
          {!docked && streamingStatus}
          {docked && (
            <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">{headerActions}</div>
          )}
        </div>
        {docked && (config.domain === "spending" || streaming) && (
          <div className="flex items-center gap-3 pl-7">
            {periodSelector}
            {streamingStatus}
          </div>
        )}
        {!docked && <div className="flex items-center gap-1.5 flex-shrink-0">{headerActions}</div>}
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* Single scroll container for the thread — the wrapper above must NOT
                also scroll or we get two nested scrollers fighting over the same space. */}
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
                        setInput("");
                        void sendMessage(s);
                        // Sending empties the thread, which unmounts this
                        // very button. Without returning the focus the
                        // keyboard user is dropped on <body>.
                        inputRef.current?.focus();
                      }}
                      className="text-left text-sm px-3.5 py-2.5 rounded-xl bg-[var(--color-primary-strong)]/8 hover:bg-[var(--color-primary-strong)]/15 text-[var(--accent-color)] transition-colors"
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
                key={i}
                msg={msg}
                streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
              />
            ))}

            {hasError && !streaming && (
              <div className="flex gap-2 pl-1">
                <button onClick={retryLastMessage} className="gnome-btn-secondary text-sm">
                  Reintentar
                </button>
                <button
                  onClick={() => setClearConfirm(true)}
                  className="gnome-btn-secondary text-sm"
                >
                  Limpiar conversación
                </button>
              </div>
            )}

            {!streaming && !hasError && lastMessage?.role === "assistant" && lastMessage.text && (
              <div
                className="flex flex-wrap gap-2 pt-1"
                role="group"
                aria-label="Sugerencias de seguimiento"
              >
                {config.followUps.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput("");
                      void sendMessage(s);
                      // Same as the seed chips: the reply unmounts this
                      // group, so hand the focus back to the composer.
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
      </div>

      <div className="px-4 py-3 border-t border-[var(--border-color)] flex-shrink-0 bg-[var(--color-surface)]">
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

          {voiceInput.supported && (
            <>
              <button
                type="button"
                aria-label="Grabar mensaje de voz"
                aria-pressed={voiceInput.state === "recording"}
                aria-live="polite"
                disabled={
                  streaming ||
                  ["requesting", "recording", "transcribing"].includes(voiceInput.state)
                }
                onClick={() => void voiceInput.start()}
                className="flex items-center justify-center w-9 h-9 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--color-surface)] disabled:opacity-40 flex-shrink-0"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
                </svg>
              </button>
              {voiceInput.state === "recording" && (
                <>
                  <span
                    className="flex items-center gap-1 text-xs text-danger whitespace-nowrap"
                    role="status"
                    aria-live="polite"
                  >
                    <span
                      className="w-2 h-2 rounded-full bg-danger animate-pulse"
                      aria-hidden="true"
                    />
                    Grabando {voiceInput.elapsed}s
                  </span>
                  <button
                    type="button"
                    onClick={voiceInput.stop}
                    className="text-xs text-[var(--accent-color)] underline whitespace-nowrap"
                  >
                    Terminar
                  </button>
                  <button
                    type="button"
                    onClick={voiceInput.cancel}
                    className="text-xs text-secondary underline whitespace-nowrap"
                  >
                    Cancelar
                  </button>
                </>
              )}
              {voiceInput.state === "transcribing" && (
                <span className="text-xs text-[var(--text-tertiary)]" aria-live="polite">
                  Transcribiendo…
                </span>
              )}
              {voiceInput.state === "requesting" && (
                <span className="text-xs text-[var(--text-tertiary)]" aria-live="polite">
                  Esperando permiso del micrófono…
                </span>
              )}
            </>
          )}

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
          {voiceInput.error && (
            <span className="text-danger" role="status" aria-live="polite">
              {voiceInput.error}
            </span>
          )}
        </div>
        {voiceInput.supported && (
          <p className="mt-1 px-1 text-[10px] text-[var(--text-tertiary)]">
            Se procesa con IA; no se guarda.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {docked ? (
        /* Docked: a real flex column on desktop so the page gives up width
           instead of being covered. On phones it falls back to full screen. */
        <aside
          data-testid="assistant-docked"
          style={{ "--assistant-docked-width": `${panelWidth}px` } as CSSProperties}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-shrink-0 md:static md:inset-auto md:h-full md:w-[var(--assistant-docked-width)]"
        >
          {panel}
        </aside>
      ) : (
        <div
          data-testid="assistant-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 animate-modal-backdrop bg-black/60"
          onClick={onToggle}
        >
          {panel}
        </div>
      )}

      <ConfirmDialog
        isOpen={clearConfirm}
        title="Limpiar conversación"
        message="Esto borra los mensajes de esta conversación. No se puede deshacer."
        confirmLabel="Limpiar"
        cancelLabel="Cancelar"
        onConfirm={handleClearThread}
        onCancel={() => setClearConfirm(false)}
        variant="danger"
      />
    </>
  );
}
