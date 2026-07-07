import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getInvestments } from "../api/client";
import type { Investment } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { formatAIResponse } from "../utils/formatText";

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Storage ──────────────────────────────────────────────────────────────────

const SESSIONS_KEY = "inv_assistant_sessions";
const ACTIVE_KEY = "inv_assistant_active";

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
  } catch {
    /* ignore */
  }
}
function loadActiveId(): string {
  return localStorage.getItem(ACTIVE_KEY) || "";
}
function saveActiveId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}
function newSessionId() {
  // nosec js/insecure-randomness - session ID for UI state only, not a security token
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// ── Portfolio context ─────────────────────────────────────────────────────────

function buildPortfolioContext(investments: Investment[]): string {
  if (!investments.length) return "";
  const fmt = (n: number) =>
    n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ars = investments.filter((i) => i.currency === "ARS");
  const usd = investments.filter((i) => i.currency === "USD");
  const arsV = ars.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0);
  const usdV = usd.reduce((s, i) => s + (i.current_value ?? i.cost_basis), 0);
  const arsC = ars.reduce((s, i) => s + i.cost_basis, 0);
  const usdC = usd.reduce((s, i) => s + i.cost_basis, 0);
  const lines = [
    "=== CARTERA ACTUAL ===",
    `ARS: $${fmt(arsV)} (costo $${fmt(arsC)}, P&L $${fmt(arsV - arsC)})`,
    `USD: u$s${fmt(usdV)} (costo u$s${fmt(usdC)}, P&L u$s${fmt(usdV - usdC)})`,
    "POSICIONES:",
    ...investments.map((inv) => {
      const v = inv.current_value ?? inv.cost_basis;
      const pnl =
        inv.pnl !== null
          ? ` P&L ${inv.currency === "USD" ? "u$s" : "$"}${fmt(inv.pnl)}${
              inv.pnl_pct !== null
                ? ` (${inv.pnl_pct >= 0 ? "+" : ""}${inv.pnl_pct.toFixed(2)}%)`
                : ""
            }`
          : "";
      return `- [${inv.ticker || inv.name}] ${inv.type} ${inv.broker} ${inv.quantity}u avg ${
        inv.currency === "USD" ? "u$s" : "$"
      }${fmt(inv.avg_cost)} actual ${
        inv.current_price !== null
          ? (inv.currency === "USD" ? "u$s" : "$") + fmt(inv.current_price)
          : "sin precio"
      } valor ${inv.currency === "USD" ? "u$s" : "$"}${fmt(v)}${pnl}`;
    }),
    "=== FIN CARTERA ===",
  ];
  return lines.join("\n");
}

// ── Streaming helper ──────────────────────────────────────────────────────────

async function streamTo(url: string, body: object, onChunk: (t: string) => void): Promise<string> {
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
      } catch {
        /* skip */
      }
    }
  }
  return full;
}

// ── SVG Icons ──────────────────────────────────────────────────────────────────

function ChatBubbleIcon() {
  return (
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChartIcon() {
  return (
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
  );
}

function BoltIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
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

function SummaryIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ThinkingDots() {
  const [d, setD] = useState(".");
  useEffect(() => {
    const id = setInterval(() => setD((p) => (p.length >= 3 ? "." : p + ".")), 400);
    return () => clearInterval(id);
  }, []);
  return <span className="text-tertiary text-sm">{d}</span>;
}

function MessageList({
  messages,
  streaming,
  endRef,
}: {
  messages: ChatMessage[];
  streaming: boolean;
  endRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
          <span className="text-tertiary">
            <ChatBubbleIcon />
          </span>
          <p className="text-sm text-secondary">Preguntame sobre tus inversiones</p>
          <p className="text-xs text-tertiary">
            Ej: ¿Cómo están mis CEDEARs? ¿Qué bonos convienen hoy?
          </p>
        </div>
      )}
      {messages.map((msg, i) => (
        <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div
            className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-normal whitespace-pre-wrap ${
              msg.role === "user"
                ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                : "bg-[var(--color-base-alt)] text-primary"
            }`}
          >
            {msg.role === "assistant" && msg.text
              ? formatAIResponse(msg.text)
              : msg.text || (streaming && i === messages.length - 1 ? <ThinkingDots /> : "")}
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

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

  return (
    <div className="bg-[var(--color-base-container)] border border-[var(--border-color)] rounded-md overflow-hidden">
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-[var(--color-base-alt)] transition-colors"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-primary truncate">{preview}</p>
          <p className="text-xs text-tertiary">
            {dateStr} · {userMsgs.length} preguntas
          </p>
        </div>
        <div className="flex items-center gap-2 ml-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-tertiary hover:text-[var(--color-danger)] text-sm transition-colors"
          >
            <TrashIcon />
          </button>
          <span className="text-tertiary text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-[var(--border-color)] bg-[var(--color-surface)]">
          {session.summary && (
            <div className="px-3 py-2 bg-[var(--color-primary)]/10 border-b border-[var(--border-color)]">
              <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-1 flex items-center gap-1">
                <SummaryIcon /> Resumen
              </p>
              <p className="text-xs text-primary leading-relaxed">{session.summary}</p>
            </div>
          )}
          <div className="px-3 py-2 space-y-2 overflow-y-auto flex-1 min-h-0">
            {session.messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] px-2 py-1.5 rounded-md text-xs leading-normal whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-[var(--color-primary)] text-[var(--color-on-primary)]"
                      : "bg-[var(--color-base-alt)] text-primary"
                  }`}
                >
                  {m.role === "assistant" && m.text ? formatAIResponse(m.text) : m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function InvestmentsAssistant() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [activeId, setActiveId] = useState<string>(() => {
    const saved = loadActiveId();
    const all = loadSessions();
    if (saved && all.find((s) => s.id === saved)) return saved;
    const id = newSessionId();
    const newS: Session = { id, ts: Date.now(), messages: [] };
    saveSessions([...all, newS]);
    saveActiveId(id);
    return id;
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Handle keyboard visibility on mobile
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;

    const update = () => {
      if (panelRef.current && window.innerWidth < 640) {
        panelRef.current.style.height = `${vp.height}px`;
        panelRef.current.style.top = `${vp.offsetTop}px`;
      }
    };

    vp.addEventListener("resize", update);
    vp.addEventListener("scroll", update);
    return () => {
      vp.removeEventListener("resize", update);
      vp.removeEventListener("scroll", update);
    };
  }, []);

  const { data: investments = [] } = useQuery({
    queryKey: ["investments"],
    queryFn: () => getInvestments(),
    staleTime: 60_000,
  });

  const activeSession = sessions.find((s) => s.id === activeId);
  const messages = useMemo(() => activeSession?.messages ?? [], [activeSession]);

  const updateSession = (id: string, updater: (s: Session) => Session) => {
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? updater(s) : s));
      saveSessions(next);
      return next;
    });
  };

  const setMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    updateSession(activeId, (s) => ({ ...s, messages: updater(s.messages) }));
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

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }, { role: "assistant", text: "" }]);
    setStreaming(true);
    const context = buildPortfolioContext(investments);
    try {
      await streamTo("/api/investments/chat/stream", { question: text, context }, (full) =>
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
      /* ignore */
    } finally {
      setSummarizing(false);
    }
  };

  const startNewSession = async () => {
    const curSession = sessions.find((s) => s.id === activeId);
    if (curSession && curSession.messages.length > 0 && !curSession.summary) {
      summarizeSession(activeId, curSession.messages);
    }
    const id = newSessionId();
    const newS: Session = { id, ts: Date.now(), messages: [] };
    setSessions((prev) => {
      const next = [...prev, newS];
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
          <ChartIcon />
        </span>
        <span className="text-base font-semibold text-primary">Asistente</span>
      </div>
      <div className="flex items-center gap-1.5">
        {messages.length > 0 && (
          <button
            onClick={() => summarizeSession(activeId, messages)}
            disabled={summarizing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            title="Generar resumen de la sesión"
          >
            {summarizing ? <span className="animate-spin inline-block">↻</span> : "Resumir"}
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
            <path d="M18 6 6 18M6 6l12 12" />
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
        <button
          onClick={startNewSession}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium bg-[var(--color-base-alt)] text-secondary hover:bg-[var(--color-base)] transition-all"
        >
          <NewChatIcon /> Nueva
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
            />
          ))
      )}
    </div>
  );

  const inputBarJsx = (iRef: React.RefObject<HTMLInputElement>) => (
    <div className="px-4 py-3 border-t border-[var(--border-color)] flex-shrink-0 bg-[var(--color-surface)]">
      {activeSession?.summary && (
        <div className="mb-2 px-3 py-2 bg-[var(--color-primary)]/10 border border-[var(--border-color)] rounded-lg">
          <p className="text-[10px] font-semibold text-[var(--color-primary)] uppercase tracking-wider mb-0.5 flex items-center gap-1">
            <SummaryIcon /> Resumen
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
          placeholder="Preguntá sobre tus inversiones..."
          disabled={streaming}
          className="flex-1 input text-sm"
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || streaming}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:brightness-110 active:scale-95 disabled:opacity-40 transition-all flex-shrink-0"
        >
          <SendIcon />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Assistant button - right side, bottom */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="fixed right-4 bottom-[calc(3.5rem+var(--browser-bottom-inset,0px))] md:bottom-6 z-50 w-10 h-10 bg-[var(--color-primary)] hover:brightness-110 rounded-full shadow-lg flex items-center justify-center text-[var(--color-on-primary)] transition-all duration-200"
          title="Abrir Asistente de Inversiones"
        >
          <BoltIcon />
        </button>
      )}

      {/* Side panel - floating above content */}
      {!isCollapsed && !isExpanded && (
        <div
          ref={panelRef}
          className="fixed inset-x-0 top-0 sm:inset-auto sm:right-0 sm:top-0 h-full sm:h-full bg-[var(--color-surface)] border-t sm:border-t-0 sm:border-l border-[var(--border-color)] shadow-lg z-50 flex flex-col w-full sm:w-96 overflow-hidden rounded-t-lg sm:rounded-none"
        >
          {headerJsx}
          {toolbarJsx}
          <div className="flex-1 overflow-y-auto min-h-0">
            {showHistory ? (
              historyJsx
            ) : (
              <MessageList messages={messages} streaming={streaming} endRef={chatEndRef} />
            )}
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
              {showHistory ? (
                historyJsx
              ) : (
                <MessageList messages={messages} streaming={streaming} endRef={chatEndRef} />
              )}
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
