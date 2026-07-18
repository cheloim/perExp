import { useCallback, useEffect, useState } from "react";
import { Joyride, STATUS, type EventData, type Step, type TooltipRenderProps } from "react-joyride";
import { getMe, markOnboardingCompleted } from "../api/client";
import SymbolicIcon, { type IconName } from "./SymbolicIcon";

interface TourStepConfig {
  target?: string;
  title: string;
  content: string;
  icon: IconName;
  color: string;
  placement?: "right" | "left" | "bottom" | "top";
  before?: () => Promise<void>;
  after?: () => void;
}

function getTourSteps(openPanel: (open: boolean) => void): TourStepConfig[] {
  return [
    {
      title: "Bienvenido a Oikonomia",
      content:
        "Tu asistente de finanzas personales con inteligencia artificial.\nTe voy a mostrar las secciones principales.",
      icon: "sparkles",
      color: "#3584e4",
    },
    {
      target: '[data-tour="sidebar-home"]',
      title: "Panel de control",
      content: "Acá vas a ver un resumen de tus finanzas: gastos del mes, categorías y tendencias.",
      icon: "home",
      color: "#3584e4",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-accounts"]',
      title: "Cuentas y tarjetas",
      content:
        "Agregá tus tarjetas de crédito, débito y cuentas bancarias. Es lo primero que deberías hacer.",
      icon: "card",
      color: "#2ec27e",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-expenses"]',
      title: "Tus gastos",
      content:
        "Todos tus gastos aparecen acá. La inteligencia artificial los categoriza automáticamente.",
      icon: "list",
      color: "#e5a50a",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-budget"]',
      title: "Presupuestos",
      content:
        "Organizá tus gastos por categoría con límites mensuales. Recibí alertas cuando te acercás al límite y creá eventos temporales para vacaciones o viajes.",
      icon: "chart-bar",
      color: "#2ec27e",
      placement: "right",
    },
    {
      target: '[data-tour="userpanel-telegram"]',
      title: "Bot de Telegram",
      content:
        "Podés agregar gastos desde acá o mucho más rápido usando el bot de Telegram. Escribile como le contarías a un amigo.",
      icon: "bot",
      color: "#3584e4",
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
      icon: "upload",
      color: "#c64600",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-notifications"]',
      title: "Notificaciones",
      content:
        "Acá recibís alertas de gastos sin categorizar, reportes listos y sugerencias de la IA.",
      icon: "bell",
      color: "#9141ac",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-guide"]',
      title: "Guía de usuario",
      content:
        "Si necesitás ayuda en cualquier momento, entrá a la Guía para ver todos los detalles de cada sección.",
      icon: "book",
      color: "#3584e4",
      placement: "right",
    },
    {
      target: '[data-tour="sidebar-account"]',
      title: "Mi cuenta",
      content:
        "Configurá tu perfil, tema, contraseña, MFA y opciones de IA desde tu panel de usuario.",
      icon: "user",
      color: "#77767b",
      placement: "right",
    },
  ];
}

function StepIcon({ icon, color }: { icon: IconName; color: string }) {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        backgroundColor: color + "18",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color,
      }}
    >
      <SymbolicIcon name={icon} size={24} />
    </div>
  );
}

function ProgressDots({
  total,
  current,
  onDotClick,
}: {
  total: number;
  current: number;
  onDotClick?: (index: number) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          onClick={() => onDotClick?.(i)}
          style={{
            width: i === current ? 20 : 8,
            height: 8,
            borderRadius: 4,
            backgroundColor:
              i === current ? "#3584e4" : i < current ? "#62a0ea" : "rgba(0,0,0,0.15)",
            transition: "all 0.25s ease",
            border: "none",
            cursor: onDotClick ? "pointer" : "default",
            padding: 0,
          }}
          aria-label={`Step ${i + 1}`}
        />
      ))}
    </div>
  );
}

function CustomTooltip({
  continuous,
  index,
  isLastStep,
  primaryProps,
  skipProps,
  step,
  tooltipProps,
}: TooltipRenderProps) {
  const stepData = step.data as unknown as TourStepConfig;
  const totalSteps = (step.data as unknown as { _total?: number })?._total || 9;

  const isWelcome = !step.target;

  return (
    <div
      {...tooltipProps}
      style={{
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 500,
        maxWidth: "90vw",
        borderRadius: 20,
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.1)",
        border: "1px solid rgba(0,0,0,0.06)",
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        background: "#ffffff",
        zIndex: 10001,
      }}
    >
      {/* Header with icon */}
      <div
        style={{
          padding: isWelcome ? "36px 36px 20px" : "28px 28px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: isWelcome ? "center" : "flex-start",
          gap: 16,
        }}
      >
        {isWelcome && (
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "linear-gradient(135deg, #3584e4, #1c71d8)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 20px rgba(53,132,228,0.35)",
            }}
          >
            <SymbolicIcon name="sparkles" size={32} />
          </div>
        )}
        {!isWelcome && stepData && <StepIcon icon={stepData.icon} color={stepData.color} />}
        {step.title && (
          <h4
            style={{
              margin: 0,
              fontSize: isWelcome ? 22 : 18,
              fontWeight: isWelcome ? 700 : 650,
              color: "#1c1b1f",
              lineHeight: 1.3,
              textAlign: isWelcome ? "center" : "left",
              letterSpacing: "-0.02em",
            }}
          >
            {step.title}
          </h4>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          padding: isWelcome ? "0 36px 16px" : "12px 28px 8px",
          fontSize: 15,
          lineHeight: 1.65,
          color: "#504e55",
          textAlign: isWelcome ? "center" : "left",
          whiteSpace: "pre-line",
        }}
      >
        {step.content}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "20px 28px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderTop: "1px solid rgba(0,0,0,0.06)",
          marginTop: 12,
        }}
      >
        {/* Clickable progress dots */}
        <ProgressDots
          total={totalSteps}
          current={index}
          onDotClick={(i) => {
            // Navigate to step by clicking dots
            const data = (primaryProps as any).data;
            if (data?.onClick) data.onClick(i);
          }}
        />

        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!isWelcome && (
            <button
              {...skipProps}
              style={{
                background: "none",
                border: "none",
                color: "#77767b",
                fontSize: 13,
                fontWeight: 500,
                padding: "8px 12px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              {skipProps.title}
            </button>
          )}
          {continuous && (
            <button
              {...primaryProps}
              style={{
                background: isWelcome ? "linear-gradient(135deg, #3584e4, #1c71d8)" : "#3584e4",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "10px 24px",
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: isWelcome ? "0 2px 8px rgba(53,132,228,0.3)" : "none",
              }}
            >
              {isLastStep ? "Entendido" : isWelcome ? "Comenzar" : primaryProps.title}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingWalkthrough({
  onOpenPanel,
}: {
  onOpenPanel: (open: boolean) => void;
}) {
  const [run, setRun] = useState(false);
  const [totalSteps, setTotalSteps] = useState(0);

  const tourConfigs = getTourSteps(onOpenPanel);

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
          if (!cancelled) {
            setTotalSteps(tourConfigs.length);
            setRun(true);
          }
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

  const steps = tourConfigs.map((cfg) => ({
    ...(cfg.target ? { target: cfg.target } : { target: "body" }),
    title: cfg.title,
    content: cfg.content,
    ...(cfg.placement ? { placement: cfg.placement } : {}),
    data: { ...cfg, _total: totalSteps } as unknown,
    ...(cfg.before ? { before: cfg.before } : {}),
    ...(cfg.after ? { after: cfg.after } : {}),
  })) as Step[];

  return (
    <Joyride
      run={run}
      steps={steps}
      onEvent={handleEvent}
      continuous
      tooltipComponent={CustomTooltip}
      locale={{
        back: "Atrás",
        close: "Cerrar",
        last: "Entendido",
        next: "Siguiente",
        open: "Abrir",
        skip: "Saltar",
      }}
      options={{
        primaryColor: "#3584e4",
        textColor: "#1c1b1f",
        backgroundColor: "#ffffff",
        overlayColor: "rgba(0, 0, 0, 0.4)",
        showProgress: false,
        spotlightPadding: 12,
        spotlightRadius: 10,
        offset: 14,
        zIndex: 100,
      }}
      styles={{
        tooltip: {
          borderRadius: 16,
          padding: 0,
          fontSize: 14,
          lineHeight: 1.5,
        },
        tooltipContainer: {
          borderRadius: 16,
          border: "none",
          boxShadow: "none",
          padding: 0,
          backgroundColor: "transparent",
        },
        tooltipContent: {
          padding: 0,
          marginBottom: 0,
        },
        tooltipFooter: {
          marginTop: 0,
          paddingTop: 0,
        },
        buttonClose: {
          display: "none",
        },
        buttonPrimary: {
          display: "none",
        },
        buttonSkip: {
          display: "none",
        },
        buttonBack: {
          display: "none",
        },
      }}
    />
  );
}
