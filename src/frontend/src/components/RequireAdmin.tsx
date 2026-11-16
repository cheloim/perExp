import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { getMe, getStoredToken } from "../api/client";

function Forbidden() {
  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="card p-8 max-w-md w-full text-center">
        <div className="text-4xl mb-3">🔒</div>
        <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Acceso denegado</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          Esta sección es sólo para administradores.
        </p>
        <a href="/" className="gnome-btn-primary-round inline-block px-6 py-2">
          Volver al inicio
        </a>
      </div>
    </div>
  );
}

export default function RequireAdmin({ children }: { children: React.ReactNode }) {
  const hasToken = Boolean(getStoredToken());
  const {
    data: user,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: getMe,
    enabled: hasToken,
    staleTime: 60_000,
  });

  if (!hasToken) return <Navigate to="/login" replace />;
  if (isLoading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <p className="text-sm text-[var(--text-secondary)]">Verificando permisos...</p>
      </div>
    );
  }
  if (isError || !user?.is_admin) return <Forbidden />;
  return <>{children}</>;
}
