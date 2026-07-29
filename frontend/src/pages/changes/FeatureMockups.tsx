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

/* ─── Programados Mockup ────────────────────────────── */

export function ProgramadosMockup() {
  return (
    <div className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 rounded-2xl p-5 border border-green-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
          <SymbolicIcon name="installments" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Programados</p>
          <p className="text-xs text-[var(--text-secondary)]">Cuotas + Recurrentes</p>
        </div>
      </div>
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-center">
            <p className="text-[10px] text-[var(--text-secondary)]">Este mes</p>
            <p className="text-sm font-bold text-green-500">5</p>
          </div>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-center">
            <p className="text-[10px] text-[var(--text-secondary)]">Pendiente</p>
            <p className="text-sm font-bold text-blue-500">$450K</p>
          </div>
          <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-2 text-center">
            <p className="text-[10px] text-[var(--text-secondary)]">Recurrentes</p>
            <p className="text-sm font-bold text-purple-500">$37K</p>
          </div>
        </div>
        <div className="space-y-1">
          {[
            { icon: "📺", name: "Netflix", amount: "$5,000", color: "bg-purple-500/10" },
            { icon: "📱", name: "iPhone 15", amount: "$173K", color: "bg-blue-500/10" },
            { icon: "💪", name: "Gym", amount: "$8,000", color: "bg-green-500/10" },
          ].map((item) => (
            <div
              key={item.name}
              className={`flex items-center justify-between px-3 py-2 rounded-lg ${item.color}`}
            >
              <span className="text-xs text-[var(--text-primary)]">
                {item.icon} {item.name}
              </span>
              <span className="text-xs font-medium text-[var(--text-primary)]">{item.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Subscriptions Mockup ──────────────────────────── */

export function SubscriptionsMockup() {
  return (
    <div className="bg-gradient-to-br from-purple-500/10 to-pink-500/10 rounded-2xl p-5 border border-purple-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
          <SymbolicIcon name="sparkles" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Suscripciones</p>
          <p className="text-xs text-[var(--text-secondary)]">Gestión inteligente</p>
        </div>
      </div>
      <div className="space-y-2">
        {[
          { name: "Netflix", amount: "$5,000", status: "Activo", color: "text-green-500" },
          { name: "Spotify", amount: "$2,500", status: "Activo", color: "text-green-500" },
          { name: "Gym", amount: "$8,000", status: "Pausado", color: "text-amber-500" },
        ].map((sub) => (
          <div
            key={sub.name}
            className="flex items-center justify-between bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg px-3 py-2"
          >
            <span className="text-xs text-[var(--text-primary)]">{sub.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[var(--text-primary)]">{sub.amount}</span>
              <span className={`text-[10px] font-medium ${sub.color}`}>{sub.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Trend Chart Mockup ────────────────────────────── */

export function TrendChartMockup() {
  return (
    <div className="bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-2xl p-5 border border-blue-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
          <SymbolicIcon name="chart-bar" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Tendencia Mensual</p>
          <p className="text-xs text-[var(--text-secondary)]">Gráfico mejorado</p>
        </div>
      </div>
      <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-4">
        <div className="flex items-end gap-1 h-20">
          {[40, 55, 45, 70, 60, 80].map((h, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t ${i === 5 ? "bg-green-500" : i === 4 ? "bg-yellow-500" : "bg-blue-500"}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between mt-2">
          {["Feb", "Mar", "Abr", "May", "Jun", "Jul"].map((m) => (
            <span key={m} className="text-[10px] text-[var(--text-secondary)]">
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Email Validation Mockup ───────────────────────── */

export function EmailValidationMockup() {
  return (
    <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-2xl p-5 border border-amber-500/20">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
          <SymbolicIcon name="settings" size={20} />
        </div>
        <div>
          <p className="font-semibold text-sm text-[var(--text-primary)]">Validación de Email</p>
          <p className="text-xs text-[var(--text-secondary)]">DNS + Dominios bloqueados</p>
        </div>
      </div>
      <div className="space-y-2">
        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3">
          <p className="text-xs text-[var(--text-secondary)] mb-1">Email válido</p>
          <p className="text-xs text-green-500 font-medium">✓ usuario@gmail.com</p>
        </div>
        <div className="bg-[var(--bg-primary)] border border-red-500/30 rounded-lg p-3">
          <p className="text-xs text-[var(--text-secondary)] mb-1">Email inválido</p>
          <p className="text-xs text-red-500 font-medium">✗ test@test.com (dominio bloqueado)</p>
        </div>
      </div>
    </div>
  );
}
