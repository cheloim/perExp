import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getImpersonationMessages,
  sendImpersonationMessage,
  endImpersonation,
} from "../api/client";

interface ImpersonationBannerProps {
  sessionId: number;
  targetUserName: string;
  expiresAt: string;
  onEnd: () => void;
}

export default function ImpersonationBanner({
  sessionId,
  targetUserName,
  expiresAt,
  onEnd,
}: ImpersonationBannerProps) {
  const queryClient = useQueryClient();
  const [chatOpen, setChatOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [remaining, setRemaining] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCountRef = useRef(0);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining("Expirada");
        clearInterval(interval);
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  // Poll messages
  const { data: messagesData } = useQuery({
    queryKey: ["impersonation-messages", sessionId],
    queryFn: () => getImpersonationMessages(sessionId),
    refetchInterval: chatOpen ? 3000 : false,
    enabled: chatOpen,
  });

  const messages = messagesData?.messages ?? [];

  // Play sound on new message
  useEffect(() => {
    if (messages.length > prevCountRef.current && prevCountRef.current > 0) {
      try {
        if (!audioRef.current) {
          audioRef.current = new Audio("data:audio/wav;base64,UklGRl9vT19teleAUTBQRWZteleQAA==");
        }
        audioRef.current.play().catch(() => {});
      } catch {}
    }
    prevCountRef.current = messages.length;
  }, [messages.length]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMut = useMutation({
    mutationFn: (msg: string) => sendImpersonationMessage(sessionId, msg),
    onSuccess: () => {
      setMessage("");
      queryClient.invalidateQueries({ queryKey: ["impersonation-messages", sessionId] });
    },
  });

  const endMut = useMutation({
    mutationFn: () => endImpersonation(sessionId),
    onSuccess: () => {
      sessionStorage.removeItem("impersonation_token");
      sessionStorage.removeItem("impersonation_session_id");
      onEnd();
    },
  });

  const handleSend = () => {
    if (!message.trim()) return;
    sendMut.mutate(message.trim());
  };

  return (
    <>
      {/* Banner */}
      <div className="fixed top-0 left-0 right-0 z-[100] bg-red-600 text-white px-4 py-2 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
          <span className="text-sm font-medium">
            Viewing as <strong>{targetUserName}</strong> · Expires in {remaining}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="text-sm px-3 py-1 rounded bg-white/20 hover:bg-white/30 flex items-center gap-1"
          >
            Chat
            {messages.length > 0 && !chatOpen && (
              <span className="bg-white text-red-600 text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {messages.length > 9 ? "9+" : messages.length}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              if (confirm("¿Finalizar sesión de impersonación?")) endMut.mutate();
            }}
            className="text-sm px-3 py-1 rounded bg-white text-red-600 hover:bg-white/90 font-medium"
          >
            End Session
          </button>
        </div>
      </div>

      {/* Chat Widget */}
      {chatOpen && (
        <div
          className="fixed bottom-4 right-4 z-[101] w-[350px] bg-[var(--bg-secondary)] rounded-lg shadow-xl border border-[var(--border)] flex flex-col"
          style={{ height: "400px" }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-sm font-medium text-primary">Chat · {targetUserName}</span>
            <button onClick={() => setChatOpen(false)} className="text-tertiary hover:text-primary">
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {messages.length === 0 ? (
              <p className="text-xs text-tertiary text-center mt-8">Sin mensajes</p>
            ) : (
              messages.map((m: any) => (
                <div key={m.id} className="text-xs">
                  <span className="font-medium text-primary">{m.sender_name}: </span>
                  <span className="text-secondary">{m.message}</span>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="border-t border-[var(--border)] p-2 flex gap-2">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Mensaje..."
              className="gnome-input text-xs flex-1"
            />
            <button
              onClick={handleSend}
              disabled={!message.trim() || sendMut.isPending}
              className="gnome-btn-primary-round text-xs px-3"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
