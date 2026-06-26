import { useState, useRef, useEffect } from "react";
import { getDashboardAITrends } from "../api/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatAIResponse } from "../utils/formatText";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
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

async function streamTo(
  url: string,
  body: object,
  onChunk: (full: string) => void,
): Promise<string> {
  const token = localStorage.getItem("auth_token");
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
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
}

function AnalyzeButton({ onClick }: { onClick: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-6 py-3 bg-[var(--color-primary)] text-white rounded-full hover:brightness-110 shadow-gnome transition-all font-medium"
      >
        <span>✨</span>
        <span>Analizar gastos del mes</span>
      </button>
      <p className="text-xs text-tertiary">Obtené un resumen de tus gastos del mes</p>
    </div>
  );
}

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

function SessionCard({
  session,
  expanded,
  onToggle,
  onDelete,
  isActive,
}: {
  session: Session;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  isActive: boolean;
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
        isActive
          ? "border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5"
          : "border-[var(--border-color)] bg-[var(--color-base-alt)]"
      }`}
    >
      {isActive && (
        <span className="absolute top-1.5 right-7 text-[9px] font-bold px-1.5 py-0.5 bg-[var(--color-primary)] text-white rounded-full z-10">
          activa
        </span>
      )}
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

export default function AIAssistant({ open }: { open: boolean; onToggle?: () => void }) {
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
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const isLocalhost =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = activeSession?.messages ?? [];

  const updateSession = (id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? updater(s) : s));
      saveSessions(next);
      return next;
    });
  };

  const setMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    updateSession(activeId, (s) => ({
      ...s,
      messages: updater(s.messages),
      lastMessageTs: Date.now(),
    }));
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (!isCollapsed) setTimeout(() => inputRef.current?.focus(), 100);
  }, [isCollapsed]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isExpanded) {
        setIsExpanded(false);
      } else if (!isCollapsed) {
        setIsCollapsed(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isCollapsed, isExpanded]);

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
  }, [sessions, activeId]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);
    setStreaming(true);
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
      );
    } catch {
      setMessages((prev) => {
        const u = [...prev];
        u[u.length - 1] = { role: "assistant", text: "Error al procesar la consulta." };
        return u;
      });
    } finally {
      setStreaming(false);
    }
  };

  const summarizeSession = async (sessionId: string, sessionMessages: ChatMessage[]) => {
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
  };

  const analyzeMonth = async () => {
    if (streaming) return;
    setMessages((prev) => [
      ...prev,
      { role: "user", text: "✨ Analizar gastos del mes" },
      { role: "assistant", text: "" },
    ]);
    setStreaming(true);
    try {
      const data = await getDashboardAITrends({ month: currentMonth });

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
          text: `Error al procesar la consulta: ${errorMessage}`,
        };
        return u;
      });
    } finally {
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
  };

  const confirmDelete = (id: string) => {
    setDeleteConfirm(id);
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
          >
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
        </span>
        <span className="text-base font-semibold text-primary">Asistente de Gastos</span>
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
          >
            {debugMode ? "🔓" : "🔒"}
          </button>
        )}
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] transition-all"
            title="Expandir a modal"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>
        )}
        {isExpanded && (
          <button
            onClick={() => setIsExpanded(false)}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] transition-all"
            title="Contraer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
            </svg>
          </button>
        )}
        <button
          onClick={() => {
            setIsCollapsed(true);
            setIsExpanded(false);
          }}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] transition-all"
          title="Cerrar"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
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
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setShowHistory(true)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
            showHistory
              ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
              : "bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)]"
          }`}
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
              onDelete={() => confirmDelete(s.id)}
              isActive={false}
            />
          ))
      )}
    </div>
  );

  const messageListJsx = (
    <div className="flex-1 flex flex-col px-5 py-4 space-y-3 min-h-0 overflow-y-auto">
      {messages.length === 0 && !streaming && <AnalyzeButton onClick={analyzeMonth} />}
      {messages.length === 0 && streaming && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-2">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            className="text-[var(--text-tertiary)]"
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
      <div className="flex-1 space-y-3 overflow-y-auto min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] px-4 py-3 rounded-lg text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--color-primary)] text-white rounded-br-lg"
                  : "bg-[var(--color-base-alt)] text-[var(--text-primary)] rounded-bl-lg"
              }`}
            >
              {msg.role === "assistant" && msg.text
                ? formatAIResponse(msg.text)
                : msg.text ||
                  (streaming && i === messages.length - 1 && msg.role === "assistant" ? (
                    <ThinkingDots />
                  ) : (
                    ""
                  ))}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] pl-2">
            <span className="animate-pulse">●</span>
            <span>Analizando...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
    </div>
  );

  const inputBarJsx = (iRef: React.RefObject<HTMLInputElement>) => (
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
      <div className="flex items-center gap-2">
        <input
          ref={iRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Preguntá sobre tus gastos..."
          disabled={streaming}
          className="flex-1 input text-sm"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all flex-shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M2 8l12-6-3 6 3 6-12-6z" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <>
      {/* Floating button - collapsed state */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="fixed right-4 bottom-20 md:bottom-6 z-50 w-10 h-10 bg-[var(--color-primary)] hover:brightness-110 rounded-full shadow-lg flex items-center justify-center text-[var(--color-on-primary)] transition-all duration-200"
          title="Abrir Asistente de Gastos"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      )}

      {/* Side panel - floating above content */}
      {!isCollapsed && !isExpanded && (
        <div className="fixed inset-x-0 bottom-0 sm:inset-auto sm:right-0 sm:top-0 h-[60dvh] sm:h-full bg-[var(--color-surface)] border-t sm:border-t-0 sm:border-l border-[var(--border-color)] shadow-lg z-50 flex flex-col w-full sm:w-96 overflow-hidden rounded-t-lg sm:rounded-none">
          {headerJsx}
          {toolbarJsx}
          <div className="flex-1 overflow-y-auto min-h-0">
            {showHistory ? historyJsx : messageListJsx}
          </div>
          {!showHistory && inputBarJsx(inputRef)}
        </div>
      )}

      {/* Modal overlay - expanded mode, GNOME 50 bottom-sheet on mobile */}
      {isExpanded && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsExpanded(false)} />
          <div className="relative bg-[var(--color-surface)] border border-[var(--border-color)] rounded-t-lg sm:rounded-lg shadow-xl flex flex-col w-full sm:max-w-2xl max-h-[90dvh] sm:max-h-[85vh] overflow-hidden">
            {headerJsx}
            {toolbarJsx}
            <div className="flex-1 overflow-y-auto min-h-0">
              {showHistory ? historyJsx : messageListJsx}
            </div>
            {!showHistory && inputBarJsx(inputRef)}
          </div>
        </div>
      )}

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
