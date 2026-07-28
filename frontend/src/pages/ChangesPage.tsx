import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { CHANGES, getVersion, getLatestVersion } from "../data/changes";
import SymbolicIcon from "../components/SymbolicIcon";
import {
  EncryptionMockup,
  SearchMockup,
  TelegramHMACMockup,
  MigrationMockup,
} from "./changes/FeatureMockups";

const FEATURE_MOCKUPS: Record<string, React.FC> = {
  "Encriptación de Datos": EncryptionMockup,
  "Búsqueda Inteligente": SearchMockup,
  "Seguridad del Bot de Telegram": TelegramHMACMockup,
  "Migración Segura": MigrationMockup,
};

export default function ChangesPage() {
  const { version } = useParams<{ version: string }>();
  const navigate = useNavigate();
  const current = version ? getVersion(version) : getLatestVersion();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (!current) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Versión no encontrada</h1>
          <Link to="/novedades" className="text-[var(--color-primary)]">
            Ver todas las novedades
          </Link>
        </div>
      </div>
    );
  }

  const prevVersion = current.previous ? getVersion(current.previous) : undefined;
  const nextVersion = CHANGES.find((v) => v.previous === current.version);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Mobile header */}
      <div className="lg:hidden sticky top-0 z-30 bg-[var(--bg-primary)] border-b border-[var(--border-color)] px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-lg hover:bg-[var(--bg-secondary)]"
        >
          <SymbolicIcon name="list" size={20} />
        </button>
        <h1 className="font-semibold text-[var(--text-primary)]">
          {current.version} — {current.title}
        </h1>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
            fixed lg:sticky top-0 left-0 z-40 lg:z-auto
            w-72 h-screen lg:h-auto
            bg-[var(--bg-primary)] lg:bg-transparent
            border-r border-[var(--border-color)] lg:border-0
            overflow-y-auto
            transition-transform duration-200
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          <div className="p-6 lg:pt-8">
            {/* Back link */}
            <Link
              to="/"
              className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] mb-6"
            >
              <SymbolicIcon name="arrow-up-right" size={16} className="rotate-180" />
              Volver al inicio
            </Link>

            {/* Title */}
            <h2 className="text-lg font-bold text-[var(--text-primary)] mb-1">Novedades</h2>
            <p className="text-sm text-[var(--text-secondary)] mb-6">
              Historial de cambios de Oikonomia
            </p>

            {/* Version list */}
            <nav className="space-y-1">
              {CHANGES.map((v) => (
                <button
                  key={v.version}
                  onClick={() => {
                    navigate(`/changes/${v.version}`);
                    setSidebarOpen(false);
                  }}
                  className={`
                    w-full text-left px-3 py-2.5 rounded-lg transition-colors
                    ${
                      v.version === current.version
                        ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                    }
                  `}
                >
                  <div className="text-sm">{v.version}</div>
                  <div className="text-xs opacity-70">{v.date}</div>
                </button>
              ))}
            </nav>

            {/* Guide link */}
            <div className="mt-6 pt-6 border-t border-[var(--border-color)]">
              <Link
                to="/guide"
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <SymbolicIcon name="list" size={16} />
                Guía de usuario
              </Link>
            </div>
          </div>
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Content */}
        <main className="flex-1 min-w-0 px-4 lg:px-12 py-8 lg:py-12">
          {/* Breadcrumb */}
          <div className="mb-6">
            <Link
              to="/novedades"
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              ← Novedades
            </Link>
          </div>

          {/* Version header */}
          <div className="mb-10">
            <div className="flex items-center gap-3 mb-3">
              <span className="px-3 py-1 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-semibold">
                {current.version}
              </span>
              <span className="text-sm text-[var(--text-secondary)]">{current.date}</span>
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold text-[var(--text-primary)] mb-3">
              {current.title}
            </h1>
            <p className="text-[var(--text-secondary)] max-w-2xl">
              {current.version === "v1.1"
                ? "Protección de datos con encriptación de nivel bancario, búsqueda inteligente y mejoras de seguridad en todo el sistema."
                : "La primera versión de Oikonomia con todas las herramientas que necesitás para tus finanzas personales."}
            </p>
          </div>

          {/* Features */}
          <div className="space-y-8 max-w-3xl">
            {current.features.map((feature, i) => {
              const MockupComponent = FEATURE_MOCKUPS[feature.title];
              return (
                <div key={i} className="group">
                  <div className="flex items-start gap-4 mb-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: feature.color + "18" }}
                    >
                      <SymbolicIcon name={feature.icon} size={22} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                        {feature.title}
                      </h3>
                      <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                  {MockupComponent && (
                    <div className="ml-0 lg:ml-15">
                      <MockupComponent />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Navigation */}
          <div className="mt-16 pt-8 border-t border-[var(--border-color)] flex flex-col sm:flex-row justify-between gap-4">
            {prevVersion ? (
              <Link
                to={`/changes/${prevVersion.version}`}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>←</span>
                <span>
                  {prevVersion.version} — {prevVersion.title}
                </span>
              </Link>
            ) : (
              <div />
            )}
            {nextVersion ? (
              <Link
                to={`/changes/${nextVersion.version}`}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <span>
                  {nextVersion.version} — {nextVersion.title}
                </span>
                <span>→</span>
              </Link>
            ) : (
              <div />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
