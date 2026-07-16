import { useCallback, useEffect, useState } from "react";
import { Joyride, STATUS, type EventData, type Step } from "react-joyride";
import { getMe, markOnboardingCompleted } from "../api/client";

function buildTourSteps(openPanel: (open: boolean) => void): Step[] {
  return [
    {
      target: '[data-tour="sidebar-home"]',
      title: "Bienvenido a Oikonomia",
      content: "Este es tu panel de control. Acá vas a ver un resumen de tus finanzas.",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-accounts"]',
      title: "Cuentas y tarjetas",
      content:
        "Acá agregás tus tarjetas de crédito, débito y cuentas bancarias. Es lo primero que deberías hacer.",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-expenses"]',
      title: "Tus gastos",
      content:
        "Todos tus gastos aparecen acá. La inteligencia artificial los categoriza automáticamente.",
      placement: "right",
    },
    {
      target: '[data-tour="userpanel-telegram"]',
      title: "Bot de Telegram",
      content:
        "Podés agregar gastos desde acá o mucho más rápido usando el bot de Telegram. Escribile como le contarías a un amigo.",
      placement: "left",
      before: async () => {
        openPanel(true);
        await new Promise((r) => setTimeout(r, 350));
      },
      after: () => {
        openPanel(false);
      },
    },
    {
      target: '[data-tour="sidebar-import"]',
      title: "Importar datos",
      content:
        "Subí extractos bancarios en PDF, CSV o XLSX. La app los procesa y categoriza automáticamente.",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-notifications"]',
      title: "Notificaciones",
      content:
        "Acá recibís alertas de gastos sin categorizar, reportes listos y sugerencias de la IA.",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-guide"]',
      title: "Guía de usuario",
      content:
        "Si necesitás ayuda en cualquier momento, entrá a la Guía para ver todos los detalles de cada sección.",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-account"]',
      title: "Mi cuenta",
      content:
        "Configurá tu perfil, tema, contraseña, MFA y opciones de IA desde tu panel de usuario.",
      placement: "right",
    },
  ];
}

export default function OnboardingWalkthrough({
  onOpenPanel,
}: {
  onOpenPanel: (open: boolean) => void;
}) {
  const [run, setRun] = useState(false);
  const tourSteps = buildTourSteps(onOpenPanel);

  // Check DB flag on mount
  useEffect(() => {
    let cancelled = false;

    const checkOnboarding = async () => {
      try {
        if (window.innerWidth < 768) return;

        const user = await getMe();
        if (cancelled) return;

        if (user.onboarding_completed) return;

        const timer = setTimeout(() => {
          if (!cancelled) setRun(true);
        }, 800);
        return () => clearTimeout(timer);
      } catch {
        // Not logged in or API error — skip tour
      }
    };

    checkOnboarding();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEvent = useCallback((data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      setRun(false);
      // Persist to DB (fire and forget)
      markOnboardingCompleted().catch(() => {
        // API error — tour won't show again anyway if user skips
      });
    }
  }, []);

  if (!run) return null;

  return (
    <Joyride
      run={run}
      steps={tourSteps}
      onEvent={handleEvent}
      continuous
      locale={{
        back: "Atrás",
        close: "Cerrar",
        last: "Entendido",
        next: "Siguiente",
        open: "Abrir",
        skip: "Saltar tour",
      }}
      options={{
        primaryColor: "#3584e4",
        textColor: "#1c1b1f",
        backgroundColor: "#ffffff",
        overlayColor: "rgba(0, 0, 0, 0.4)",
        showProgress: true,
        spotlightPadding: 12,
        spotlightRadius: 10,
        width: 320,
        offset: 14,
        zIndex: 100,
      }}
      styles={{
        tooltip: {
          borderRadius: 14,
          padding: 20,
          fontSize: 14,
          lineHeight: 1.5,
        },
        tooltipContainer: {
          borderRadius: 14,
          border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 12px 28px rgba(0,0,0,0.12), 0 4px 10px rgba(0,0,0,0.06)",
        },
        tooltipTitle: {
          fontSize: 16,
          fontWeight: 600,
          marginBottom: 8,
        },
        tooltipContent: {
          padding: 0,
          marginBottom: 0,
        },
        tooltipFooter: {
          marginTop: 16,
          paddingTop: 14,
          borderTop: "1px solid rgba(0,0,0,0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        },
        buttonClose: {
          color: "#71717a",
          fontSize: 12,
          padding: "6px 8px",
          borderRadius: 6,
          position: "absolute",
          top: 8,
          right: 8,
        },
        buttonPrimary: {
          backgroundColor: "#3584e4",
          color: "#ffffff",
          borderRadius: 8,
          padding: "10px 20px",
          fontSize: 14,
          fontWeight: 500,
          border: "none",
          minHeight: 40,
        },
        buttonSkip: {
          color: "#5e5c64",
          fontSize: 13,
          padding: "10px 12px",
        },
        buttonBack: {
          color: "#5e5c64",
          fontSize: 13,
          padding: "10px 12px",
        },
      }}
    />
  );
}
