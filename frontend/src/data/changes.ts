import type { IconName } from "../components/SymbolicIcon";

export interface ChangeFeature {
  title: string;
  icon: IconName;
  color: string;
  description: string;
}

export interface ChangeVersion {
  version: string;
  date: string;
  title: string;
  features: ChangeFeature[];
  previous?: string;
}

export const LATEST_VERSION = "v1.2";

export const CHANGES: ChangeVersion[] = [
  {
    version: "v1.2",
    date: "29 de Julio, 2026",
    title: "Programados y Mejoras de UX",
    previous: "v1.1",
    features: [
      {
        title: "Página de Programados",
        icon: "installments",
        color: "#2ec27e",
        description:
          "Unificamos cuotas y gastos recurrentes en una sola página. Ahora podés ver todos tus compromisos de pago en un solo lugar, con filtros para separar cuotas de suscripciones.",
      },
      {
        title: "Gestión de Suscripciones",
        icon: "sparkles",
        color: "#8b5cf6",
        description:
          "La IA detecta automáticamente tus gastos recurrentes. Podés pausar, editar o eliminar suscripciones directamente desde la página de Programados.",
      },
      {
        title: "Mejoras en el Gráfico de Tendencia",
        icon: "chart-bar",
        color: "#3584e4",
        description:
          "El gráfico de tendencia mensual ahora muestra una línea de tendencia y está más prominente en la página.",
      },
      {
        title: "Validación de Email",
        icon: "settings",
        color: "#e5a50a",
        description:
          "Ahora validamos que los emails sean reales al registrarse. Bloqueamos dominios falsos y verificamos que el dominio exista.",
      },
    ],
  },
  {
    version: "v1.1",
    date: "28 de Julio, 2026",
    title: "Encriptación y Seguridad",
    previous: "v1.0",
    features: [
      {
        title: "Encriptación de Datos",
        icon: "settings",
        color: "#8b5cf6",
        description:
          "Todos los datos sensibles están protegidos con encriptación AES-128. Nombres, tarjetas, gastos e inversiones están seguros incluso ante accesos no autorizados a la base de datos.",
      },
      {
        title: "Búsqueda Inteligente",
        icon: "chart-bar",
        color: "#3584e4",
        description:
          "Buscá por categoría, banco, persona o descripción. Los tokens de búsqueda funcionan incluso con datos encriptados.",
      },
      {
        title: "Seguridad del Bot de Telegram",
        icon: "telegram",
        color: "#2ec27e",
        description:
          "El bot ahora utiliza verificación HMAC para búsquedas O(1). Las identificaciones de chat están protegidas con hashes criptográficos.",
      },
      {
        title: "Migración Segura",
        icon: "settings",
        color: "#e5a50a",
        description:
          "Scripts de migración con dry-run, verificación y rollback automático. La base de datos está protegida durante cada actualización.",
      },
    ],
  },
  {
    version: "v1.0",
    date: "15 de Julio, 2026",
    title: "Lanzamiento Inicial",
    features: [
      {
        title: "Dashboard Inteligente",
        icon: "chart-bar",
        color: "#3584e4",
        description:
          "Vista completa de tus finanzas con gráficos interactivos, KPIs y comparativas mensuales.",
      },
      {
        title: "Registro de Gastos",
        icon: "list",
        color: "#2ec27e",
        description:
          "Registrá gastos desde la web o Telegram con parseo inteligente y categorización automática.",
      },
      {
        title: "Bot de Telegram",
        icon: "telegram",
        color: "#3584e4",
        description:
          "Mandá mensajes naturales como 'gasté 1500 en farmacity' y registrá gastos al instante.",
      },
      {
        title: "Categorización con IA",
        icon: "sparkles",
        color: "#e5a50a",
        description:
          "La inteligencia artificial categoriza tus gastos automáticamente basándose en la descripción y tu historial.",
      },
      {
        title: "Presupuestos por Categoría",
        icon: "chart-bar",
        color: "#8b5cf6",
        description:
          "Distribuí tu ingreso en Necesidades, Gustos y Ahorro. Recibí alertas cuando te acercás al límite.",
      },
      {
        title: "Reportes Mensuales",
        icon: "chart-donut",
        color: "#2ec27e",
        description:
          "Reportes automáticos con gráficos de categorías, tendencias y análisis de la IA.",
      },
    ],
  },
];

export function getVersion(version: string): ChangeVersion | undefined {
  return CHANGES.find((v) => v.version === version);
}

export function getLatestVersion(): ChangeVersion {
  return CHANGES[0];
}
