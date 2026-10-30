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
  summary?: string;
  features: ChangeFeature[];
  previous?: string;
}

export const LATEST_VERSION = "v1.6";

export const CHANGES: ChangeVersion[] = [
  {
    version: "v1.6",
    date: "30 de Octubre, 2026",
    title: "Captura inteligente, asistente renovado y una app más clara",
    summary:
      "Capturá gastos por voz o escaneando un comprobante, hablá con un asistente que analiza hasta doce meses y trabajá más rápido con notificaciones, búsqueda y presupuesto rediseñados.",
    previous: "v1.5",
    features: [
      {
        title: "🎙️ Captura por voz y foto",
        icon: "sparkles",
        color: "#3584e4",
        description:
          "Dictá tu gasto desde el asistente con el botón de micrófono, o escaneá un comprobante desde el modal de gasto para completar monto, descripción, fecha y moneda. El bot de Telegram también acepta audios y fotos.",
      },
      {
        title: "🤖 Asistente renovado",
        icon: "bot",
        color: "#8b5cf6",
        description:
          "Nuevo panel centrado, un solo hilo y un selector de ventana de 3, 6 o 12 meses. Las sugerencias se envían con un toque, las respuestas se leen como markdown y Limpiar pide confirmación.",
      },
      {
        title: "🔔 Notificaciones en la barra lateral",
        icon: "bell",
        color: "#e5a50a",
        description:
          "Notificaciones tiene su lugar en la barra lateral y su propia página. El texto se muestra completo, se borra con un clic y cada aviso te lleva al lugar correcto.",
      },
      {
        title: "🔎 Gastos más rápidos",
        icon: "search",
        color: "#2ec27e",
        description:
          "Buscá por descripción, nota o categoría con contador en vivo y Escape para limpiar. Los filtros también mueven las estadísticas, la selección masiva queda siempre disponible y categoría/cuenta se editan en la fila.",
      },
      {
        title: "📊 Presupuesto y Dashboard rediseñados",
        icon: "chart-bar",
        color: "#e66100",
        description:
          "Presupuesto con edición por fila, barra de ritmo diario y panel de ayuda. El Dashboard suma comparación contra el mismo día del mes anterior, proyección de cierre, leyendas unificadas y opción de ocultar cuentas vacías.",
      },
      {
        title: "📱 Mini App y accesibilidad",
        icon: "smartphone",
        color: "#9141ac",
        description:
          "La Mini App gana paridad visual en QuickBudget y un resumen mensual comparativo. En toda la app: diseño alineado a GNOME 50, foco visible, teclado y contraste corregidos, y más ancho útil en pantallas grandes.",
      },
    ],
  },
  {
    version: "v1.5",
    date: "24 de Septiembre, 2026",
    title: "Sistema de Tags, Cuentas como Tags y Dashboard Enriquecido",
    previous: "v1.4",
    features: [
      {
        title: "📂 Clasificación Unificada",
        icon: "tag",
        color: "#3584e4",
        description:
          "Nuevo sistema para organizar tus gastos: categorías, cuentas y etiquetas personalizadas en una sola página con búsqueda y edición rápida.",
      },
      {
        title: "🏦 Cuentas Flexibles",
        icon: "bank",
        color: "#2ec27e",
        description:
          "Tus tarjetas y cuentas ya no son obligatorias. Ahora son métodos de pago opcionales que podés crear, editar y reorganizar libremente. Los gastos viejos se migraron automáticamente.",
      },
      {
        title: "📊 Gastos: columna Cuenta",
        icon: "list",
        color: "#e5a50a",
        description:
          "Nueva columna 'Cuenta' en el listado de gastos con chip de color. Filtros separados para cuenta y etiqueta. Los ingresos ahora aparecen en verde.",
      },
      {
        title: "🧩 Modal renovado: Cuenta + Etiquetas",
        icon: "sparkles",
        color: "#8b5cf6",
        description:
          "Al crear o editar un gasto, elegí la cuenta (single-select) y agregá etiquetas personalizadas por separado. También en el Mini App de Telegram.",
      },
      {
        title: "🍩 Dashboard con detalle por cuenta",
        icon: "chart-donut",
        color: "#e5a50a",
        description:
          "Gastos por Cuenta y por Categoría ahora muestran montos del mes, sparklines de tendencia y total. Carga de Cuotas con KPI y sparkline del mes actual.",
      },
      {
        title: "⌨️ UX: Escape, title-case, acciones hover",
        icon: "settings",
        color: "#9141ac",
        description:
          "Escape cierra los diálogos de categoría y tags. Descripciones en title-case. Acciones de fila aparecen en hover. Iconos SVG simbólicos reemplazan emojis en toda la app.",
      },
    ],
  },
  {
    version: "v1.4",
    date: "6 de Septiembre, 2026",
    title: "Reportes del Bot, Edición de Gastos y Quick View",
    previous: "v1.3",
    features: [
      {
        title: "🤖 Reportes Inline del Bot",
        icon: "chart-bar",
        color: "#3584e4",
        description:
          "Nuevos comandos /presupuesto, /gastos, /cuotas, /suscripciones y /ayuda. Consultá tu estado financiero directamente en el chat de Telegram.",
      },
      {
        title: "✏️ Edición de Gastos (48h)",
        icon: "list",
        color: "#2ec27e",
        description:
          "Comando /editar para modificar gastos de las últimas 48 horas. Elegí el campo, ingresá el nuevo valor y confirmá con diff visual. Registro de auditoría incluido.",
      },
      {
        title: "📸 Imágenes de Reportes",
        icon: "chart-donut",
        color: "#e5a50a",
        description:
          "Botón en cada reporte del bot para generar una imagen PNG renderizada con Playwright. Budget status, resumen semanal/mensual y cuotas próximas.",
      },
      {
        title: "📱 Quick View Mini App",
        icon: "smartphone",
        color: "#8b5cf6",
        description:
          "La Mini App de Telegram ahora arranca con una vista liviana: KPIs, categorías con color real, gastos recientes, presupuesto y próximos pagos. Botón para cambiar a la plataforma completa.",
      },
      {
        title: "💱 Soporte Multi-Moneda",
        icon: "sparkles",
        color: "#2ec27e",
        description:
          "Los reportes del bot, imágenes PNG y Quick View ahora distinguen correctamente entre gastos en ARS y USD. Totales separados y formato por moneda.",
      },
      {
        title: "🔔 Notificaciones de Cuotas y Suscripciones",
        icon: "bell",
        color: "#e5a50a",
        description:
          "Avisos por Telegram e in-app antes del vencimiento de tus cuotas y cobros recurrentes, y confirmación cuando una cuota se registra. Canal configurable por usuario.",
      },
    ],
  },
  {
    version: "v1.3",
    date: "31 de Agosto, 2026",
    title: "Telegram Mini App e Inicio de Sesión con Telegram",
    previous: "v1.2",
    features: [
      {
        title: "Telegram Mini App",
        icon: "telegram",
        color: "#3584e4",
        description:
          "Abrí toda la app de Oikonomia desde dentro de Telegram, sin salir del chat. Registrá gastos, revisá reportes y gestioná tus finanzas en una Mini App completa con tu tema y colores.",
      },
      {
        title: "Inicio de Sesión con Telegram",
        icon: "telegram",
        color: "#2ec27e",
        description:
          "Iniciá sesión con un solo toque usando tu cuenta de Telegram. Disponible tanto en la Mini App como en la web con el Login Widget.",
      },
      {
        title: "Detección de Tarjetas Mejorada",
        icon: "list",
        color: "#e5a50a",
        description:
          "El bot ahora reconoce mejor las notificaciones de tu banco. Detección accent-insensible, nuevos patrones Santander, y coincidencia fuzzy entre variantes de la misma tarjeta.",
      },
      {
        title: "Suscripciones Más Inteligentes",
        icon: "sparkles",
        color: "#8b5cf6",
        description:
          "Las suscripciones detectadas automáticamente ya no reaparecen después de ser eliminadas. Coincidencia fuzzy entre variantes de merchant (ej: MAKRO / MAKRO PILAR).",
      },
      {
        title: "Mejoras Visuales",
        icon: "chart-bar",
        color: "#3584e4",
        description:
          "Fechas agrupadas inteligentes en gastos: al ordenar por fecha, los headers de agrupación muestran la fecha; al ordenar por otro campo, se muestra en cada fila. Modal de detalle simplificado.",
      },
    ],
  },
  {
    version: "v1.2",
    date: "29 de Julio, 2026",
    title: "Gastos Programados y Mejoras Visuales",
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
      {
        title: "FABs Consolidados en Mobile",
        icon: "sparkles",
        color: "#3584e4",
        description:
          "En mobile, ahora hay un solo botón flotante por pantalla. En páginas con su propio botón de crear gasto, el FAB abre directamente el asistente IA. En el resto, un speed-dial despliega ambas acciones.",
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
