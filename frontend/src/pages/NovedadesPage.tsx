import { Link } from "react-router-dom";
import { CHANGES } from "../data/changes";
import SymbolicIcon from "../components/SymbolicIcon";

export default function NovedadesPage() {
  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <header className="border-b border-[var(--border-color)] px-4 py-6">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-4"
          >
            <SymbolicIcon name="arrow-up-right" size={16} className="rotate-180" />
            Volver al inicio
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <SymbolicIcon name="sparkles" size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--text-primary)]">Novedades</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Historial de cambios y mejoras de Oikonomia
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Version list */}
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="space-y-4">
          {CHANGES.map((version) => (
            <Link key={version.version} to={`/changes/${version.version}`} className="block group">
              <div className="card p-5 hover:border-[var(--color-primary)]/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-semibold">
                        {version.version}
                      </span>
                      <span className="text-xs text-[var(--text-secondary)]">{version.date}</span>
                    </div>
                    <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1.5 group-hover:text-[var(--color-primary)] transition-colors">
                      {version.title}
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {version.features.slice(0, 3).map((f, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]"
                        >
                          <SymbolicIcon name={f.icon} size={12} />
                          {f.title}
                        </span>
                      ))}
                      {version.features.length > 3 && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]">
                          +{version.features.length - 3} más
                        </span>
                      )}
                    </div>
                  </div>
                  <SymbolicIcon
                    name="arrow-up-right"
                    size={20}
                    className="text-[var(--text-secondary)] group-hover:text-[var(--color-primary)] transition-colors flex-shrink-0 mt-1"
                  />
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Guide link */}
        <div className="mt-8 pt-6 border-t border-[var(--border-color)] text-center">
          <Link
            to="/guide"
            className="inline-flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline"
          >
            <SymbolicIcon name="list" size={16} />
            Ver guía de usuario completa
          </Link>
        </div>
      </main>
    </div>
  );
}
