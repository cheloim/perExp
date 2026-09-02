import { useState } from "react";
import SymbolicIcon from "./SymbolicIcon";
import { CHANGES, LATEST_VERSION } from "../data/changes";

// Set this to false to hide the "What's New" modal for all users
// Re-enable by setting to true when you want to show it
const SHOW_WHATS_NEW = true;

interface WhatsNewModalProps {
  onClose: (dontRemind?: boolean) => void;
}

function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const latestVersion = CHANGES[0];
  const [dontRemind, setDontRemind] = useState(false);

  if (!SHOW_WHATS_NEW) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="card w-full max-w-lg max-h-[calc(100dvh-2rem)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-[var(--color-primary)] to-[#62a0ea] p-6 text-white shrink-0">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center">
              <SymbolicIcon name="sparkles" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold">¡Novedades!</h2>
              <p className="text-sm text-white/80">
                {latestVersion.version} — {latestVersion.title}
              </p>
            </div>
          </div>
        </div>

        {/* Features (scrollable) */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {latestVersion.features.map((feature, i) => (
            <div key={i} className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: feature.color + "15" }}
              >
                <SymbolicIcon name={feature.icon} size={18} />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{feature.title}</p>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{feature.description}</p>
              </div>
            </div>
          ))}

          <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
            <a
              href={`/changes/${LATEST_VERSION}`}
              className="text-sm text-[var(--color-primary)] hover:underline font-medium"
            >
              Ver cambios →
            </a>
          </div>
        </div>

        {/* Footer (always visible) */}
        <div className="px-6 pb-6 pt-2 space-y-3 shrink-0">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dontRemind}
              onChange={(e) => setDontRemind(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--border-color)]"
            />
            <span className="text-xs text-[var(--text-tertiary)]">No recordarme esta versión</span>
          </label>
          <button
            onClick={() => onClose(dontRemind)}
            className="w-full px-4 py-2.5 bg-[var(--color-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

export default WhatsNewModal;
export { SHOW_WHATS_NEW };
