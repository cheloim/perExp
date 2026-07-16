import { useEffect, useState } from "react";
import { Joyride, STATUS, type EventData, type Step } from "react-joyride";

const ONBOARDING_KEY = "onboarding_completed";

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

  useEffect(() => {
    try {
      const completed = localStorage.getItem(ONBOARDING_KEY);
      if (completed === "true") return;

      if (window.innerWidth < 768) {
        localStorage.setItem(ONBOARDING_KEY, "true");
        return;
      }

      const timer = setTimeout(() => setRun(true), 800);
      return () => clearTimeout(timer);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const handleEvent = (data: EventData) => {
    if (data.status === STATUS.FINISHED || data.status === STATUS.SKIPPED) {
      try {
        localStorage.setItem(ONBOARDING_KEY, "true");
      } catch {
        // ignore
      }
      setRun(false);
    }
  };

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
        spotlightPadding: 8,
        spotlightRadius: 8,
        width: 340,
      }}
      styles={{
        tooltip: { borderRadius: 12, padding: 16 },
        tooltipContainer: {
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 10px 20px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.04)",
        },
        buttonPrimary: {
          backgroundColor: "#3584e4",
          color: "#ffffff",
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 14,
          fontWeight: 500,
          border: "none",
        },
        buttonSkip: { color: "#5e5c64", fontSize: 13 },
        buttonBack: { color: "#5e5c64", fontSize: 13 },
      }}
    />
  );
}
