import { useState, useRef, useEffect, useMemo, useCallback, memo } from "react";
import { getDashboardAITrends } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatAIResponse } from "../utils/formatText";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  error?: boolean;
}

interface Session {
  id: string;
  ts: number;
  lastMessageTs?: number;
  messages: ChatMessage[];
  summary?: string;
}

const SESSIONS_KEY = "ai_assistant_sessions";
const ACTIVE_KEY = "ai_assistant_active";
const MAX_INPUT_LENGTH = 2000;
/** Sentinel user-prompt posted when the user hits "Analizar gastos del mes". */
const ANALYZE_PROMPT = "✨ Analizar gastos del mes";

const SUGGESTIONS = [
  "¿Cuánto llevo gastado este mes?",
  "Compará con el mes pasado",
  "¿Dónde puedo recortar?",
  "¿Cómo voy contra el presupuesto?",
];

function loadSessions(): Session[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveSessions(s: Session[]) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(s.slice(-30)));
  } catch {}
}
function loadActiveId(): string {
  return localStorage.getItem(ACTIVE_KEY) || "";
}
function saveActiveId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}
function newSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const streamTo = async (
  url: string,
  body: object,
  onChunk: (full: string) => void,
  signal?: AbortSignal,
): Promise<string> => {
  const token = localStorage.getItem("auth_token");
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "",
    full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (raw === "[DONE]") break;
      try {
        const { text } = JSON.parse(raw) as { text: string };
        if (text) {
          full += text;
          onChunk(full);
        }
      } catch {}
    }
  }
  return full;
};

function ThinkingDots() {
  const [d, setD] = useState(".");
  useEffect(() => {
    const id = setInterval(() => setD((p) => (p.length >= 3 ? "." : p + ".")), 400);
    return () => clearInterval(id);
  }, []);
  return <span className="text-[var(--text-tertiary)] text-sm">{d}</span>;
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

/**
 * Dev-only render counter for `Bubble`.
 *
 * Lets e2e/assistant-perf.spec.ts assert that a streaming chunk renders ONE
 * bubble instead of all of them — a deterministic count rather than a timing
 * assertion, which would just flake in CI. `import.meta.env.DEV` is statically
 * false in a production build, so this compiles away and never ships.
 */
const countBubbleRender = () => {
  if (!import.meta.env.DEV) return;
  const w = window as unknown as { __BUBBLE_RENDERS__?: number };
  w.__BUBBLE_RENDERS__ = (w.__BUBBLE_RENDERS__ ?? 0) + 1;
};

/**
 * One chat bubble. Memoized so that a streaming update to the LAST message
 * does not re-run formatAIResponse on every message already on screen.
 *
 * The memo is effective because the streaming reducer copies the array but
 * keeps the untouched message objects identical (`u = [...prev]` then replaces
 * only the tail), so `msg` and `streaming` both compare equal for every bubble
 * except the one receiving the chunk. e2e/assistant-perf.spec.ts asserts the
 * resulting call count stays flat as history grows.
 */
const Bubble = memo(({ msg, streaming }: { msg: ChatMessage; streaming: boolean }) => {
  countBubbleRender();
  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] px-4 py-3 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
          msg.role === "user"
            ? "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)] rounded-br-sm"
            : msg.error
              ? "bg-danger/10 border border-danger/30 text-danger rounded-bl-sm"
              : "bg-[var(--color-base-alt)] text-[var(--text-primary)] rounded-bl-sm"
        }`}
      >
        {msg.role === "assistant" && msg.text && !msg.error
          ? formatAIResponse(msg.text)
          : msg.text || (streaming ? <ThinkingDots /> : "")}
      </div>
    </div>
  );
});

function SessionCard({
  session,
  expanded,
  onToggle,
  onDelete,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const userMsgs = session.messages.filter((m) => m.role === "user");
  const preview = userMsgs[0]?.text ?? "(sin mensajes)";
  const dateStr = new Date(session.ts).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  return (
    <div
      className={`rounded-md border overflow-hidden relative ${
        expanded
          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
          : "border-[var(--border-color)] bg-[var(--color-base-alt)]"
      }`}
    >
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-base-alt)]/80 transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0 pr-8">
          <p className="text-sm text-[var(--text-primary)] truncate">{preview}</p>
          <p className="text-xs text-[var(--text-tertiary)]">
            {dateStr} · {userMsgs.length} preguntas
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDeleteConfirm(true);
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--color-danger)] text-sm transition-colors"
          >
            <TrashIcon />
          </button>
          <span className="text-[var(--text-tertiary)] text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-surface)]">
          {session.summary && (
            <div className="px-3 py-2 bg-[var(--color-primary)]/8 border-b border-[var(--border-color)]">
              <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-1">
                Resumen
              </p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                {session.summary}
              </p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 overflow-y-auto flex-1 min-h-0">
            {session.messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] px-2.5 py-2 rounded-md text-xs leading-normal whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-base-alt)] text-[var(--text-primary)]"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={deleteConfirm}
        title="Eliminar sesión"
        message="¿Estás seguro de que quieres eliminar esta sesión? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={() => {
          setDeleteConfirm(false);
          onDelete();
        }}
        onCancel={() => setDeleteConfirm(false)}
        variant="danger"
      />
    </div>
  );
}

export default function AIAssistant({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveId();
    const all = loadSessions();
    if (saved && all.find((s) => s.id === saved)) return saved;
    const id = newSessionId();
    const s: Session = { id, ts: Date.now(), messages: [] };
    saveSessions([...all, s]);
    saveActiveId(id);
    return id;
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Escape is owned by the global handler in App.tsx; the trap only manages Tab.
  const trapRef = useFocusTrap(open);

  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);
  const lastMessage = messages[messages.length - 1];
  const hasError = !!lastMessage?.error;

  // Auto-grow the textarea, capped so the composer never eats the thread.
  const resizeTextarea = useCallback(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  // Abort any in-flight stream when the assistant closes or unmounts.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Handle keyboard visibility on mobile
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;

    const update = () => {
      if (trapRef.current && window.innerWidth < 640) {
        trapRef.current.style.top = `${vp.offsetTop}px`;
      }
    };

    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
    };
  }, [trapRef]);

  const updateSession = useCallback((id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? updater(s) : s));
      saveSessions(next);
      return next;
    });
  }, []);

  const setMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    updateSession(activeId, (s) => ({
      ...s,
      messages: updater(s.messages),
      lastMessageTs: Date.now(),
    }));
  };

  const summarizeSession = useCallback(
    async (sessionId: string, sessionMessages: ChatMessage[]) => {
      if (sessionMessages.length === 0) return;
      setSummarizing(true);
      try {
        let summary = "";
        await streamTo("/api/analysis/summarize", { messages: sessionMessages }, (full) => {
          summary = full;
        });
        if (summary) updateSession(sessionId, (s) => ({ ...s, summary }));
      } catch {
      } finally {
        setSummarizing(false);
      }
    },
    [updateSession],
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  /**
   * Open-time instrumentation (issue #415 asks for a measurable number).
   *
   * `ai-assistant:open-start` is marked in the click handler's render pass;
   * `ai-assistant:open-end` fires on the first paint after the card is in the
   * DOM. The resulting `ai-assistant:open` measure is what the e2e perf budget
   * asserts against and what the perf doc reports.
   */
  useEffect(() => {
    if (!open) return;
    const done = () => {
      performance.mark("ai-assistant:open-end");
      const entries = performance.measure("ai-assistant:open", "ai-assistant:open-start");
      // Surfaced on window so the e2e perf spec can read the real number.
      (window as unknown as Record<string, unknown>).__AI_ASSISTANT_OPEN_MS__ = entries.duration;
    };
    // Double rAF: the first frame commits the DOM, the second confirms paint.
    const raf2 = requestAnimationFrame(() => requestAnimationFrame(done));
    return () => cancelAnimationFrame(raf2);
  }, [open]);

  useEffect(() => {
    const checkInactivity = () => {
      const session = sessions.find((s) => s.id === activeId);
      if (!session || session.messages.length === 0) return;
      const lastTs = session.lastMessageTs ?? session.ts;
      const hoursSinceLastMessage = (Date.now() - lastTs) / (1000 * 60 * 60);
      if (hoursSinceLastMessage > 2) {
        const curSession = sessions.find((s) => s.id === activeId);
        if (curSession && curSession.messages.length > 0 && !curSession.summary) {
          summarizeSession(activeId, curSession.messages);
        }
        const id = newSessionId();
        const s: Session = { id, ts: Date.now(), messages: [] };
        setSessions((prev) => {
          const next = [...prev, s];
          saveSessions(next);
          return next;
        });
        setActiveId(id);
        saveActiveId(id);
        setShowHistory(false);
      }
    };
    const interval = setInterval(checkInactivity, 60_000);
    return () => clearInterval(interval);
  }, [sessions, activeId, summarizeSession]);

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) => {
      const u = [...prev];
      const last = u[u.length - 1];
      if (last?.role === "assistant" && !last.text) {
        u[u.length - 1] = { role: "assistant", text: "Respuesta cancelada." };
      }
      return u;
    });
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || streaming) return;
    if (overrideText === undefined) setInput("");
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamTo(
        "/api/analysis/stream",
        { month: currentMonth, question: text, debug_mode: debugMode },
        (full) =>
          setMessages((prev) => {
            const u = [...prev];
            u[u.length - 1] = { role: "assistant", text: full };
            return u;
          }),
        controller.signal,
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = {
          role: "assistant",
          text: "No pude procesar la consulta. Revisá tu conexión e intentá de nuevo.",
          error: true,
        };
        return u;
      });
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  /**
   * Re-run the last user prompt. Pops the failed assistant bubble AND the
   * user message that produced it so sendMessage can re-append both — otherwise
   * the retry would duplicate the user bubble.
   */
  const retryLastMessage = () => {
    const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
    if (lastUserIdx === -1) return;
    const text = messages[lastUserIdx].text;
    setMessages((prev) => prev.slice(0, lastUserIdx));
    // The month-analysis button posts a sentinel prompt; retry must re-run it
    // rather than shipping the sentinel text to the LLM.
    if (text === ANALYZE_PROMPT) void analyzeMonth();
    else void sendMessage(text);
  };

  const analyzeMonth = async () => {
    if (streaming) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: ANALYZE_PROMPT },
      { role: "assistant", text: "" },
    ]);
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const data = await getDashboardAITrends({ month: currentMonth });
      // No cancelable at the fetch layer; drop the result if the user hit stop.
      if (controller.signal.aborted) return;

      const trendIcon = data.trend === "up" ? "↑" : data.trend === "down" ? "↓" : "→";
      const trendLabel =
        data.trend === "up"
          ? "Tendencia alcista"
          : data.trend === "down"
            ? "Tendencia bajista"
            : "Estable";

      let responseText = `${trendIcon} ${trendLabel}\n\n${data.trend_explanation}`;
      if (data.top_rising_category) responseText += `\n\n↑ Subió: ${data.top_rising_category}`;
      if (data.top_falling_category) responseText += `\n\n↓ Bajó: ${data.top_falling_category}`;
      if (data.recommendation) responseText += `\n\n💡 ${data.recommendation}`;
      if (data.alert) responseText += `\n\n⚠ ${data.alert}`;

      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", text: responseText };
        return u;
      });
    } catch (err) {
      console.error("analyzeMonth error:", err);
      const errorMessage = err instanceof Error ? err.message : "Error desconocido";
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = {
          role: "assistant",
          text: `No pude analizar el mes: ${errorMessage}`,
          error: true,
        };
        return u;
      });
    } finally {
      abortRef.current = null;
      setStreaming(false);
    }
  };

  const startNewSession = () => {
    const curSession = sessions.find((s) => s.id === activeId);
    if (curSession && curSession.messages.length > 0 && !curSession.summary) {
      summarizeSession(activeId, curSession.messages);
    }
    const id = newSessionId();
    const s: Session = { id, ts: Date.now(), messages: [] };
    setSessions((prev) => {
      const next = [...prev, s];
      saveSessions(next);
      return next;
    });
    setActiveId(id);
    saveActiveId(id);
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const deleteSession = () => {
    const id = deleteConfirm;
    if (!id) return;
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      saveSessions(next);
      return next;
    });
    if (id === activeId) {
      const remaining = sessions.filter((s) => s.id !== id);
      if (remaining.length > 0) {
        setActiveId(remaining[remaining.length - 1].id);
        saveActiveId(remaining[remaining.length - 1].id);
      } else {
        startNewSession();
      }
    }
    setDeleteConfirm(null);
  };

  // ── Shared JSX fragments ────────────────────────────────────────────────────

  const headerJsx = (
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
        <span className="text-base font-semibold text-primary">Asistente de Gastos</span>
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
            onClick={() => summarizeSession(activeId, messages)}
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
          onClick={() => onToggle?.()}
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
  );

  const toolbarJsx = (
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
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Nueva
        </button>
      )}
    </div>
  );

  const historyJsx = (
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
  );

  const messageListJsx = (
    // Single scroll container for the thread — the render wrapper below must NOT
    // also scroll or we get two nested scrollers fighting over the same space.
    <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0 overflow-y-auto">
      {/* ── Idle: prominent suggestions before the user has asked anything ── */}
      {messages.length === 0 && !streaming && (
        <div className="flex-1 flex flex-col justify-center items-start gap-4 py-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
              Empezá por acá
            </p>
            <div className="flex flex-col gap-2">
              {SUGGESTIONS.map((s) => (
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
          <button onClick={analyzeMonth} className="gnome-btn-primary-strong text-sm">
            ✨ Analizar gastos del mes
          </button>
        </div>
      )}

      {messages.length === 0 && streaming && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--text-tertiary)]"
            aria-hidden="true"
          >
            <path
              d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2v10z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          <p className="text-sm text-[var(--text-secondary)]">
            Preguntame sobre tus gastos del mes
          </p>
          <p className="text-xs text-[var(--text-tertiary)]">
            Ej: ¿Dónde gasté más? ¿Cómo reduzco mis gastos en comida?
          </p>
        </div>
      )}

      {/* Inner list is NOT a scroll container; messageListJsx owns scrolling. */}
      <div className="space-y-3">
        {messages.map((msg, i) => (
          <Bubble
            key={`${activeId}-${i}`}
            msg={msg}
            streaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
          />
        ))}

        {/* ── Error: retry affordance ── */}
        {hasError && !streaming && (
          <div className="flex gap-2 pl-1">
            <button onClick={() => retryLastMessage()} className="gnome-btn-secondary text-sm">
              Reintentar
            </button>
            <button onClick={startNewSession} className="gnome-btn-secondary text-sm">
              Nueva consulta
            </button>
          </div>
        )}

        {/* ── Follow-up suggestions after an answer ── */}
        {!streaming && !hasError && lastMessage?.role === "assistant" && lastMessage.text && (
          <div
            className="flex flex-wrap gap-2 pt-1"
            role="group"
            aria-label="Sugerencias de seguimiento"
          >
            {[
              "Compará con el mes pasado",
              "¿Dónde más puedo recortar?",
              "Detallame por categoría",
            ].map((s) => (
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
  );

  const inputBarJsx = (
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

      <div className="flex items-end gap-2 bg-[var(--color-base-alt)] border border-transparent focus-within:border-[var(--color-primary)] focus-within:bg-[var(--color-surface)] rounded-2xl px-3.5 py-2.5 transition-colors">
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
              sendMessage();
            }}
            rows={1}
            maxLength={MAX_INPUT_LENGTH}
            aria-label="Preguntá sobre tus gastos"
            placeholder="Preguntá sobre tus gastos..."
            className="w-full bg-transparent border-0 outline-none resize-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] leading-relaxed py-0.5"
          />
          <p className="text-[10px] text-[var(--text-tertiary)] mt-1 hidden sm:block">
            <kbd className="px-1 py-px rounded bg-[var(--color-base)] border border-[var(--border-color)] text-[var(--text-secondary)]">
              Enter
            </kbd>{" "}
            envía ·{" "}
            <kbd className="px-1 py-px rounded bg-[var(--color-base)] border border-[var(--border-color)] text-[var(--text-secondary)]">
              Shift
            </kbd>
            +
            <kbd className="px-1 py-px rounded bg-[var(--color-base)] border border-[var(--border-color)] text-[var(--text-secondary)]">
              Enter
            </kbd>{" "}
            salto de línea
          </p>
        </div>

        <button
          onClick={streaming ? stopStreaming : () => void sendMessage()}
          disabled={!streaming && !input.trim()}
          aria-label={streaming ? "Cancelar respuesta" : "Enviar mensaje"}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition-all flex-shrink-0 disabled:opacity-40 ${
            streaming
              ? "bg-danger text-white hover:brightness-110"
              : "bg-[var(--color-primary-strong)] text-[var(--color-on-primary-strong)] hover:brightness-110 active:scale-95"
          }`}
        >
          {streaming ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2.5" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M2 8l12-6-3 6 3 6-12-6z" fill="currentColor" />
            </svg>
          )}
        </button>
      </div>

      <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[var(--text-tertiary)] px-1">
        <span role="status" aria-live="polite">
          {streaming ? "Analizando tus gastos…" : ""}
        </span>
        <span className="ml-auto tabular-nums">
          {input.length} / {MAX_INPUT_LENGTH}
        </span>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 animate-modal-backdrop bg-black/60"
        onClick={() => onToggle?.()}
      >
        <div
          ref={trapRef}
          role="dialog"
          aria-modal="true"
          aria-label="Asistente de Gastos"
          className="relative flex flex-col bg-[var(--color-surface)] border border-[var(--border-color)] rounded-none sm:rounded-2xl shadow-gnome-lg animate-modal-content w-full h-full sm:w-auto sm:h-auto sm:max-w-2xl sm:max-h-[78vh] sm:min-h-[520px] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Sheet grip — the GNOME bottom-sheet language the user approved on D3 */}
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
            <span className="w-9 h-1 rounded-full bg-[var(--border-color)]" />
          </div>

          {headerJsx}
          {toolbarJsx}
          {/* Wrapper is a flex column, not a scroller — messageListJsx scrolls. */}
          <div className="flex-1 flex flex-col min-h-0">
            {showHistory ? historyJsx : messageListJsx}
          </div>
          {!showHistory && inputBarJsx}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title="Eliminar sesión"
        message="¿Estás seguro de que quieres eliminar esta sesión? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={deleteSession}
        onCancel={() => setDeleteConfirm(null)}
        variant="danger"
      />
    </>
  );
}
