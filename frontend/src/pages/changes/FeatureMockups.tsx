/** CSS mockup components for the Changes page. */
import SymbolicIcon from "../../components/SymbolicIcon";

/* ─── Encryption Mockup ─────────────────────────────── */

export function EncryptionMockup() {
  return (
    <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-2xl p-5 border border-purple-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
          <SymbolicIcon name="settings" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Datos Encriptados</p>
          <p className="text-xs text-[var(--text-secondary)]">AES-128-CBC</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-xs text-green-500 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Protegido
        </div>
      </div>
      <div className="space-y-2">
        <div className="bg-black/10 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-[var(--text-secondary)] font-mono">full_name</span>
          </div>
          <p className="font-mono text-xs text-[var(--text-secondary)] truncate">
            gAAAAABqZ3hSv0gHxZmNxFADfs_HF_wmK_pYkSqBHGdvZig15w...
          </p>
        </div>
        <div className="bg-black/10 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-[var(--text-secondary)] font-mono">description</span>
          </div>
          <p className="font-mono text-xs text-[var(--text-secondary)] truncate">
            gAAAAABqZ3jJ-1GzGpLcQ3aZhNOdG5EN0V2hRzbqNolmyIfMrp...
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Search Mockup ──────────────────────────────────── */

export function SearchMockup() {
  return (
    <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-2xl p-5 border border-blue-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
          <SymbolicIcon name="chart-bar" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">
            Búsqueda en Datos Encriptados
          </p>
          <p className="text-xs text-[var(--text-secondary)]">Tokens de búsqueda</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="relative">
          <SymbolicIcon
            name="chart-bar"
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
          />
          <div className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--text-secondary)]">
            farmacia
          </div>
        </div>
        <div className="space-y-1.5">
          {["FARMACITY", "DR. AHUMADA", "FARMACIA DEL PUEBLO"].map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
            >
              <span className="text-xs text-[var(--text-primary)]">{name}</span>
              <span className="ml-auto text-[10px] text-green-500 font-medium">Match</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Telegram HMAC Mockup ───────────────────────────── */

export function TelegramHMACMockup() {
  return (
    <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-2xl p-5 border border-green-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
          <SymbolicIcon name="telegram" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Verificación HMAC</p>
          <p className="text-xs text-[var(--text-secondary)]">Búsqueda O(1)</p>
        </div>
      </div>
      <div className="space-y-3">
        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
              <SymbolicIcon name="telegram" size={12} />
            </div>
            <span className="text-xs font-medium text-[var(--text-primary)]">NikoFin Bot</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">gasté 1500 en farmacity</p>
        </div>
        <div className="flex items-center gap-2 px-2">
          <div className="flex-1 h-px bg-[var(--border-color)]" />
          <span className="text-[10px] text-[var(--text-secondary)] font-mono">
            HMAC: 932bc11f...
          </span>
          <div className="flex-1 h-px bg-[var(--border-color)]" />
        </div>
        <div className="bg-[var(--bg-primary)] border border-green-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <SymbolicIcon name="settings" size={14} />
            <span className="text-xs text-green-500 font-medium">Usuario verificado</span>
            <span className="ml-auto text-[10px] text-[var(--text-secondary)]">0.1ms</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Migration Mockup ───────────────────────────────── */

export function MigrationMockup() {
  return (
    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-2xl p-5 border border-amber-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
          <SymbolicIcon name="settings" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Migración Segura</p>
          <p className="text-xs text-[var(--text-secondary)]">Dry-run + Verificación</p>
        </div>
      </div>
      <div className="space-y-2">
        {[
          { label: "Backup", status: "✓", color: "text-green-500" },
          { label: "Dry-run", status: "✓ PASS", color: "text-green-500" },
          { label: "Migrar", status: "✓", color: "text-green-500" },
          { label: "Verificar", status: "✓ PASS", color: "text-green-500" },
        ].map((step) => (
          <div
            key={step.label}
            className="flex items-center gap-2 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
          >
            <span className="text-xs text-[var(--text-primary)]">{step.label}</span>
            <span className={`ml-auto text-xs font-medium ${step.color}`}>{step.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
