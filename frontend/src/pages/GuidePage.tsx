import { useEffect, useState } from "react";
import SymbolicIcon from "../components/SymbolicIcon";

const SECTIONS = [
  { id: "registro", label: "Registro y acceso", icon: "key" as const },
  { id: "dashboard", label: "Dashboard", icon: "chart-bar" as const },
  { id: "cuentas", label: "Cuentas y tarjetas", icon: "card" as const },
  { id: "gastos", label: "Registrar gastos", icon: "list" as const },
  { id: "categorias", label: "Categorías", icon: "settings" as const },
  { id: "analiticas", label: "Analíticas", icon: "chart-donut" as const },
  { id: "cuotas", label: "Cuotas", icon: "chart-bar" as const },
  { id: "programados", label: "Gastos programados", icon: "list" as const },
  { id: "inversiones", label: "Inversiones", icon: "arrow-up-right" as const },
  { id: "reportes", label: "Reportes mensuales", icon: "chart-donut" as const },
  { id: "importar", label: "Importar datos", icon: "arrow-up-right" as const },
  { id: "telegram", label: "Bot de Telegram", icon: "telegram" as const },
  { id: "ia", label: "Asistente IA", icon: "sparkles" as const },
  { id: "familia", label: "Grupo familiar", icon: "users" as const },
  { id: "config", label: "Configuración", icon: "settings" as const },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set(["registro"]));

  const toggleChapter = (id: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] bg-[var(--color-surface)]">
        <div className="max-w-6xl mx-auto py-8 px-4">
          <a
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline mb-6"
          >
            ← Volver al inicio
          </a>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <SymbolicIcon name="book" size={22} className="text-[var(--color-primary)]" />
            </div>
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Manual de usuario</h1>
          </div>
          <p className="text-[var(--text-secondary)] ml-[52px]">
            Guía completa con todas las acciones disponibles en la plataforma.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto flex gap-8 px-4 py-8">
        {/* Sidebar TOC */}
        <nav className="hidden lg:block w-52 flex-shrink-0">
          <div className="sticky top-8 space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (!expandedChapters.has(s.id)) toggleChapter(s.id);
                  setTimeout(
                    () => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }),
                    50,
                  );
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeSection === s.id
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                    : "text-[var(--text-secondary)] hover:bg-[var(--color-base-alt)] hover:text-[var(--text-primary)]"
                }`}
              >
                <SymbolicIcon
                  name={s.icon}
                  size={16}
                  className={activeSection === s.id ? "text-[var(--color-primary)]" : ""}
                />
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Mobile TOC */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-surface)] border-t border-[var(--border-color)] px-4 py-2 overflow-x-auto scrollbar-none">
          <div className="flex gap-1.5 min-w-max">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  if (!expandedChapters.has(s.id)) toggleChapter(s.id);
                  setTimeout(
                    () => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" }),
                    50,
                  );
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  activeSection === s.id
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--text-secondary)] bg-[var(--color-base-alt)]"
                }`}
              >
                <SymbolicIcon name={s.icon} size={12} />
                {s.label}
              </a>
            ))}
          </div>
        </div>

        {/* Content */}
        <main className="flex-1 min-w-0 max-w-3xl pb-20 lg:pb-0">
          <Chapter
            id="registro"
            title="Registro y acceso"
            icon="key"
            subtitle="Creá tu cuenta y entrá a la plataforma."
            expanded={expandedChapters.has("registro")}
            onToggle={() => toggleChapter("registro")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Crear una cuenta</h4>
            <Steps
              items={[
                "Entrá a platform.oikonomia.ar/register",
                "Completá tu nombre completo y email",
                "Elegí una contraseña segura (8+ caracteres, mayúscula, minúscula, número y símbolo)",
                'Hacé click en "Registrarse"',
                "Revisá tu email y hacé click en el link de verificación (expira en 24 horas)",
              ]}
            />
            <Callout type="tip">
              También podés registrarte con tu cuenta de Google haciendo click en \"Continuar con
              Google\".
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Iniciar sesión</h4>
            <Steps
              items={[
                "Entrá a platform.oikonomia.ar/login",
                "Ingresá tu email y contraseña",
                "Si tenés MFA activado, ingresá el código de tu app de autenticación",
                'Hacé click en "Iniciar sesión"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Recuperar contraseña
            </h4>
            <Steps
              items={[
                'En la pantalla de login, hacé click en "¿Olvidaste tu contraseña?"',
                "Ingresá tu email",
                "Revisá tu email (el link expira en 15 minutos)",
                "Ingresá tu nueva contraseña",
              ]}
            />
          </Chapter>

          <Chapter
            id="dashboard"
            title="Dashboard"
            icon="chart-bar"
            subtitle="Tu panel de control principal."
            expanded={expandedChapters.has("dashboard")}
            onToggle={() => toggleChapter("dashboard")}
          >
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              El dashboard muestra un resumen de tus finanzas del mes actual. Es lo primero que ves
              al iniciar sesión.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Tarjetas KPI</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">Cuatro indicadores clave:</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <MiniStat label="Total gastado" value="$45.230" />
              <MiniStat label="Deuda tarjetas" value="$128.500" />
              <MiniStat label="Cuotas este mes" value="$18.700" />
              <MiniStat label="vs Mes anterior" value="↓ 8%" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] mb-4">
              Hacé click en cualquier tarjeta para ir a la sección correspondiente.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Gráfico de categorías</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Un gráfico de torta muestra la distribución de gastos por categoría. Hacé click en una
              porción para filtrar la lista de transacciones.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">
              Lista de transacciones
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Muestra los últimos gastos. Usá los botones de días (3d, 5d, 7d, 10d) para filtrar por
              recencia. Hacé click en \"Ver todos\" para ir a la página completa de gastos.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Métodos de pago</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Resumen de gastos por tarjeta/cuenta. Hacé click para ir a la página de Cuentas.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Gastos programados</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Muestra cuotas pendientes y gastos manuales programados. El gráfico de barras muestra
              la carga mensual de cuotas.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Nuevo gasto rápido</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              El botón \"+ Nuevo gasto\" en la parte superior abre el formulario para crear un gasto
              directamente desde el dashboard.
            </p>
          </Chapter>

          <Chapter
            id="cuentas"
            title="Cuentas y tarjetas"
            icon="card"
            subtitle="Organizá todos tus medios de pago."
            expanded={expandedChapters.has("cuentas")}
            onToggle={() => toggleChapter("cuentas")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Crear una tarjeta</h4>
            <Steps
              items={[
                "Entrá a Cuentas en el menú lateral",
                'Hacé click en "+ Crear tarjeta o cuenta"',
                'Seleccioná el tipo: "Tarjeta"',
                "Elegí si es Crédito o Débito",
                "Ingresá el banco (ej: Galicia, Santander)",
                'Ingresá un nombre para identificarla (ej: "Visa del trabajo")',
                "Si es débito, podés vincularla a una caja de ahorro existente",
                'Hacé click en "Crear"',
              ]}
            />
            <Callout type="info">
              Las tarjetas aparecen como un carrusel visual con el logo del banco, los últimos 4
              dígitos y el total del mes.
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Crear una cuenta</h4>
            <Steps
              items={[
                'Hacé click en "+ Crear tarjeta o cuenta"',
                "Seleccioná el tipo: Efectivo, Cuenta Corriente, Caja de Ahorro, MercadoPago u Otro",
                'Ingresá un nombre (ej: "Efectivo billetera", "Mercado Pago")',
                'Hacé click en "Crear"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Vincular tarjeta de débito con cuenta
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si tenés una caja de ahorro en un banco y la tarjeta de débito correspondiente, podés
              vincularlas para que los gastos con débito se resten automáticamente del saldo de la
              cuenta.
            </p>
            <Steps
              items={[
                "Editá la tarjeta de débito",
                'En "Cuenta vinculada", seleccioná la caja de ahorro correspondiente',
                "Guardá los cambios",
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Ver evolución por cuenta
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              En la página de Cuentas, cada tarjeta muestra un gráfico de líneas con la evolución de
              gastos de los últimos 6 meses. Hacé click en una tarjeta para ver detalles: total,
              transacciones, promedio y últimos 5 gastos.
            </p>
          </Chapter>

          <Chapter
            id="gastos"
            title="Registrar gastos"
            icon="list"
            subtitle="Tres formas de registrar tus gastos."
            expanded={expandedChapters.has("gastos")}
            onToggle={() => toggleChapter("gastos")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">
              Método 1: Bot de Telegram (recomendado)
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              La forma más rápida. Escribile al bot como le contarías a un amigo:
            </p>
            <div className="space-y-2 mb-4">
              <CodeBlock label="Gasto simple" code="mastercard galicia almacen 5999" />
              <CodeBlock
                label="Gasto en cuotas"
                code="visa santander cuotas 3 supermercado 12000"
              />
              <CodeBlock label="Gasto en efectivo" code="efectivo almuerzo 2500" />
              <CodeBlock label="Con fecha específica" code="nafta shell viernes 15000" />
            </div>
            <Callout type="tip">
              El bot detecta automáticamente la tarjeta, el banco y la categoría. Si la categoría no
              es correcta, podés cambiarla después desde la app.
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Método 2: Formulario web
            </h4>
            <Steps
              items={[
                'Hacé click en "+ Nuevo gasto" (dashboard o página de gastos)',
                "Seleccioná el medio de pago: Tarjeta o Efectivo/Transferencia",
                "Elegí la fecha (por defecto: hoy)",
                "Ingresá el monto",
                'Ingresá una descripción (ej: "almacén", "Netflix")',
                "La IA sugiere una categoría automáticamente — aceptala o cambiala",
                'Si es compra en cuotas, expandí "Más opciones" e ingresá el número de cuotas',
                'Hacé click en "Guardar"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Método 3: Importación CSV
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Subí un archivo PDF, CSV o XLSX con tus movimientos bancarios. La app procesa el
              archivo y categoriza los gastos automáticamente.
            </p>
            <Steps
              items={[
                'Hacé click en "Importar" en la barra lateral',
                "Seleccioná el archivo (PDF, CSV, XLSX o XLS)",
                "Esperá a que el procesamiento termine (puede tardar unos segundos)",
                "Revisá la vista previa: verificá las transacciones detectadas",
                "Mapeá la tarjeta detectada con una tarjeta existente (o creá una nueva)",
                'Hacé click en "Importar" para confirmar',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Editar un gasto</h4>
            <Steps
              items={[
                "Entrá a Gastos en el menú lateral",
                "Hacé click en el gasto que querés editar",
                "Hacé click en el ícono de lápiz (editar)",
                "Modificá los campos que necesites",
                'Hacé click en "Guardar"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Eliminar gastos</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              <strong>Un gasto:</strong> Hacé click en el ícono de basura junto al gasto y confirmá.
            </p>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              <strong>Varios gastos:</strong>
            </p>
            <Steps
              items={[
                'Hacé click en "Seleccionar" en la barra de herramientas',
                "Seleccioná los gastos que querés eliminar (checkbox de cada fila)",
                'Hacé click en "Eliminar" en el panel lateral',
                "Confirmá la eliminación",
              ]}
            />
            <Callout type="info">
              Después de eliminar, aparece un toast con opción de deshacer (5 segundos).
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Operaciones masivas
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">En modo selección, podés:</p>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1 mb-3">
              <li>
                <strong>Cambiar categoría</strong> de múltiples gastos a la vez
              </li>
              <li>
                <strong>Cambiar método de pago</strong> de múltiples gastos
              </li>
              <li>
                <strong>Eliminar</strong> múltiples gastos
              </li>
            </ul>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Filtros y búsqueda
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              La página de gastos tiene filtros avanzados:
            </p>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1">
              <li>
                <strong>Categoría</strong> — filtrá por categoría específica o \"Sin categoría\"
              </li>
              <li>
                <strong>Cuenta</strong> — filtrá por tarjeta o cuenta
              </li>
              <li>
                <strong>Fecha</strong> — desde/hasta con selects de fecha
              </li>
              <li>
                <strong>Búsqueda</strong> — texto libre en descripciones (búsqueda debounced)
              </li>
              <li>
                <strong>CSV</strong> — exportá los gastos filtrados como archivo CSV
              </li>
            </ul>
          </Chapter>

          <Chapter
            id="categorias"
            title="Categorías"
            icon="settings"
            subtitle="Organizá tus gastos con categorías jerárquicas."
            expanded={expandedChapters.has("categorias")}
            onToggle={() => toggleChapter("categorias")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">
              Estructura de categorías
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Las categorías son jerárquicas: una <strong>categoría padre</strong> (ej:
              \"Alimentación\") agrupa <strong>subcategorías\"</strong> (ej: \"Supermercado\",
              \"Café/Bar\", \"Restaurante\"). Las subcategorías pueden tener{" "}
              <strong>palabras clave</strong> para auto-categorización.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Aplicar estructura base
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si es tu primera vez, hacé click en \"Aplicar estructura base\" para crear
              automáticamente las categorías predefinidas (Alimentación, Transporte, Servicios,
              Entretenimiento, etc.).
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Crear una categoría padre
            </h4>
            <Steps
              items={[
                "Entrá a Config. Categorías",
                'En la pestaña "Categorías Padre", hacé click en "+ Categoría padre"',
                'Ingresá el nombre (ej: "Mascotas")',
                "Elegí un color",
                'Hacé click en "Guardar"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Crear una subcategoría
            </h4>
            <Steps
              items={[
                'En la pestaña "Subcategorías", hacé click en "+ Subcategoría"',
                "Seleccioná la categoría padre",
                'Ingresá el nombre (ej: "Veterinaria")',
                "Elegí un color",
                'Agregá palabras clave separadas por comas (ej: "veterinario, mascota, perro, gato")',
                'Hacé click en "Guardar"',
              ]}
            />
            <Callout type="tip">
              Las palabras clave se usan para la auto-categorización. Cuando registrás un gasto con
              una descripción que contiene una palabra clave, la categoría se asigna
              automáticamente.
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Recategorizar gastos
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Si tenés gastos sin categoría, hacé click en \"Recategorizar sin categoría\" para que
              la IA sugiera categorías basándose en las descripciones.
            </p>
          </Chapter>

          <Chapter
            id="analiticas"
            title="Analíticas de categorías"
            icon="chart-donut"
            subtitle="Entendé en qué gastás."
            expanded={expandedChapters.has("analiticas")}
            onToggle={() => toggleChapter("analiticas")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Treemap de categorías</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Un gráfico de rectángulos proporcionales muestra cuánto gastás en cada categoría.
              Cuanto más grande el rectángulo, más gastaste. Hacé click en un rectángulo para ver
              detalles: total, cantidad de transacciones, porcentaje del total y comparación con el
              mes anterior.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Gráfico de tendencias
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Muestra la evolución de gastos por categoría en el tiempo. Usá los botones 3m, 6m, 12m
              para cambiar la ventana de tiempo. Hacé click en las leyendas para mostrar/ocultar
              categorías.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Top comercios</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Lista los comercios donde más gastás, ordenados por monto o frecuencia. Hacé click en
              un comercio para ver todos los gastos asociados.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Filtro por persona
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Si tenés grupo familiar, podés filtrar las analíticas por miembro para ver solo los
              gastos de una persona.
            </p>
          </Chapter>

          <Chapter
            id="cuotas"
            title="Cuotas"
            icon="chart-bar"
            subtitle="Seguimiento de compras en cuotas."
            expanded={expandedChapters.has("cuotas")}
            onToggle={() => toggleChapter("cuotas")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">
              Crear un gasto en cuotas
            </h4>
            <Steps
              items={[
                'Al crear un gasto, expandí "Más opciones"',
                'Marcá "Compra en cuotas"',
                "Ingresá el número de cuota actual (ej: 1) y el total (ej: 3)",
                "Guardá el gasto",
              ]}
            />
            <p className="text-sm text-[var(--text-secondary)] mt-2 mb-3">
              La app crea automáticamente las cuotas pendientes. La primera cuota se guarda como
              gasto normal; las demás se programan como gastos futuros.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Ver cuotas pendientes
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              En la página de Cuotas, cada grupo de cuotas muestra: descripción, total, cuotas
              pagadas/restantes, monto por cuota y fechas. El gráfico de barras muestra la carga
              mensual de cuotas.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Ejecutar una cuota manualmente
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si querés registrar una cuota antes de la fecha, hacé click en \"Gestionar\" en el
              grupo y luego en \"Ejecutar ahora\" en la cuota pendiente.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Cancelar una cuota
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              En el grupo de cuotas, hacé click en \"Gestionar\" y luego en \"Cancelar\" en la cuota
              pendiente. La cuota se marca como cancelada y no se ejecuta.
            </p>
          </Chapter>

          <Chapter
            id="programados"
            title="Gastos programados"
            icon="list"
            subtitle="Gastos futuros que se ejecutan automáticamente."
            expanded={expandedChapters.has("programados")}
            onToggle={() => toggleChapter("programados")}
          >
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Los gastos programados son cuotas pendientes de compras en cuotas. Se ejecutan
              automáticamente cuando llega la fecha.
            </p>
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Flujo automático</h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1 mb-3">
              <li>Cada día a las 02:00 UTC, un proceso revisa cuotas con fecha ≤ hoy</li>
              <li>Las cuotas vencidas se convierten en gastos reales automáticamente</li>
              <li>Se mantiene el registro de cuotas pagadas y pendientes</li>
            </ul>
            <h4 className="font-semibold text-[var(--text-primary)] mt-4 mb-2">
              Acciones manuales
            </h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1">
              <li>
                <strong>Ejecutar ahora:</strong> Registrar una cuota antes de la fecha programada
              </li>
              <li>
                <strong>Cancelar:</strong> Marcar una cuota como cancelada (no se ejecutará)
              </li>
              <li>
                <strong>Editar:</strong> Modificar fecha, monto, descripción o categoría de una
                cuota pendiente
              </li>
            </ul>
          </Chapter>

          <Chapter
            id="inversiones"
            title="Inversiones"
            icon="arrow-up-right"
            subtitle="Seguimiento de FCI, plazos fijos y más."
            expanded={expandedChapters.has("inversiones")}
            onToggle={() => toggleChapter("inversiones")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Agregar una inversión</h4>
            <Steps
              items={[
                "Entrá a Inversiones en el menú lateral",
                'Hacé click en "+ Nueva inversión"',
                "Seleccioná el broker (IOL, PPI u otro)",
                "Elegí el tipo: Acción, Cedear, Bono, Letra, ON, FCI, Caución, Plazo Fijo u Otro",
                "Ingresá el símbolo (la app busca el precio automáticamente)",
                "Ingresá cantidad, precio promedio y precio actual",
                'Hacé click en "Crear"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Sincronizar con brokers
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si configuraste credenciales de IOL o PPI, hacé click en \"Sincronizar\" para
              actualizar precios y posiciones automáticamente.
            </p>
            <Steps
              items={[
                'Hacé click en "Config" en la barra de herramientas',
                "Ingresá tu usuario y contraseña de IOL (o API key de PPI)",
                'Hacé click en "Guardar"',
                'Hacé click en "Sincronizar"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Toggle ARS/USD</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              El botón \"ARS\"/\"USD\" en la barra de herramientas convierte todos los valores entre
              pesos y dólares.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Detalle de inversión
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Hacé click en una inversión para ver: cantidad, precio promedio, precio actual,
              valuación, costo y P&L. Si tenés la misma inversión en varios brokers, se muestra el
              desglose por broker.
            </p>
          </Chapter>

          <Chapter
            id="reportes"
            title="Reportes mensuales"
            icon="chart-donut"
            subtitle="Análisis completo de tu mes."
            expanded={expandedChapters.has("reportes")}
            onToggle={() => toggleChapter("reportes")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Generar un reporte</h4>
            <Steps
              items={[
                "Entrá a tu panel de usuario (click en tu nombre en la barra lateral)",
                'Andá a la pestaña "Reportes"',
                'Hacé click en "Generar reporte"',
                "Seleccioná el mes",
                "Esperá a que se genere (puede tardar unos segundos)",
                "Hacé click en el reporte para descargarlo como imagen PNG",
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Qué incluye el reporte
            </h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1 mb-3">
              <li>Resumen del mes: total de gastos, ingresos, tasa de ahorro</li>
              <li>Top 5 categorías con porcentajes</li>
              <li>Comparación con el mes anterior (MoM)</li>
              <li>Historial de tendencia de 6 meses</li>
              <li>Análisis de patrones: gastos por día de semana, fin de semana vs día hábil</li>
              <li>Desglose por método de pago</li>
              <li>Cuotas futuras próximas</li>
              <li>Análisis de IA con observaciones, alertas y recomendaciones</li>
            </ul>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Reporte automático
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              El primer día de cada mes se genera automáticamente un reporte del mes anterior.
              Recibís una notificación cuando está listo.
            </p>
          </Chapter>

          <Chapter
            id="importar"
            title="Importar datos"
            icon="arrow-up-right"
            subtitle="Subí extractos bancarios."
            expanded={expandedChapters.has("importar")}
            onToggle={() => toggleChapter("importar")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Formatos soportados</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              PDF, CSV, XLSX y XLS (tamaño máximo: 10MB).
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Proceso de importación
            </h4>
            <Steps
              items={[
                'Hacé click en "Importar" en la barra lateral',
                "Seleccioná uno o varios archivos",
                "Los archivos se suben y procesan en segundo plano",
                "Cuando termine, recibís una notificación",
                "Hacé click en la notificación para ver la vista previa",
                "Revisá las transacciones detectadas",
                "Mapeá la tarjeta detectada con una tarjeta existente (o creá una nueva)",
                'Hacé click en "Importar" para confirmar',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Vista previa</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              En la vista previa verás: todas las transacciones detectadas, badges de \"Duplicado\"
              para transacciones repetidas, badges de \"Cuota\" para cuotas generadas
              automáticamente, y el total de la importación.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Mapeo de tarjeta</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              La IA detecta automáticamente qué tarjeta usaste. Si no la reconoce, seleccioná
              manualmente una tarjeta existente o elegí \"Otro (crear nueva)\" para crear una nueva.
            </p>
          </Chapter>

          <Chapter
            id="telegram"
            title="Bot de Telegram"
            icon="telegram"
            subtitle="Registrá gastos desde tu celular."
            expanded={expandedChapters.has("telegram")}
            onToggle={() => toggleChapter("telegram")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Conectar el bot</h4>
            <Steps
              items={[
                "Entrá a tu panel de usuario → Configuración → Bot de Telegram",
                "Copiá tu clave de conexión (12 caracteres)",
                "Abrí Telegram y buscá @NikoFinBot",
                'Hacé click en "/start" y pegá tu clave',
                "El bot te confirma que está conectado",
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Enviar gastos</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Escribile al bot como le contarías a un amigo:
            </p>
            <div className="space-y-2 mb-4">
              <CodeBlock label="Gasto simple" code="mastercard galicia almacen 5999" />
              <CodeBlock
                label="Gasto en cuotas"
                code="visa santander cuotas 3 supermercado 12000"
              />
              <CodeBlock label="Efectivo" code="efectivo almuerzo 2500" />
              <CodeBlock label="Con fecha" code="nafta shell viernes 15000" />
              <CodeBlock label="USD" code="Netflix USD 5" />
            </div>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Formato de confirmación
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              El bot responde con una confirmación:
            </p>
            <ChatMockup />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Detección de tarjeta en el texto
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si incluís el nombre de la tarjeta y el banco en tu mensaje (ej: \"visa santander
              verduleria 5999\"), el bot detecta automáticamente la tarjeta y no pregunta por el
              medio de pago.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Notificaciones bancarias
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si copiás y pegás una notificación de tu banco (SMS, email o push), el bot la detecta
              automáticamente, extrae el monto, la tarjeta y la fecha, y registra el gasto.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Resumen semanal</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              Si lo activás en Configuración, cada lunes recibís un resumen de tu semana anterior
              directamente en Telegram con totales por categoría y un análisis de IA.
            </p>
          </Chapter>

          <Chapter
            id="ia"
            title="Asistente IA"
            icon="sparkles"
            subtitle="Chat inteligente para analizar tus gastos."
            expanded={expandedChapters.has("ia")}
            onToggle={() => toggleChapter("ia")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Abrir el asistente</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Hacé click en el botón de chat (ícono de burbuja) en la esquina inferior derecha. El
              asistente se abre como panel lateral.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Analizar el mes</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Si no hay nada en el chat, aparece un botón \"Analizar gastos del mes\". Hacelo click
              para obtener un análisis completo con tendencias, categorías crecientes/decrescientes,
              alertas y recomendaciones.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Hacer preguntas</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Podés preguntarle cosas como:
            </p>
            <div className="space-y-2 mb-4">
              <CodeBlock label="" code="¿Cuánto gasté en comida este mes?" />
              <CodeBlock label="" code="¿Cuáles son mis categorías con más gasto?" />
              <CodeBlock label="" code="¿Cómo voy vs el mes pasado?" />
              <CodeBlock label="" code="¿Qué gastos puedo reducir?" />
            </div>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Historial de sesiones
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Cada conversación se guarda como sesión. Podés ver sesiones anteriores en la pestaña
              \"Historial\". La app guarda hasta 30 sesiones. Después de 2 horas de inactividad, se
              crea una sesión nueva automáticamente.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Asistente de inversiones
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              En la página de Inversiones, el botón de chat cambia a un asistente especializado en
              inversiones. Hacé preguntas sobre tu portafolio, precios, P&L y tendencias.
            </p>
          </Chapter>

          <Chapter
            id="familia"
            title="Grupo familiar"
            icon="users"
            subtitle="Compartí la cuenta con tu familia."
            expanded={expandedChapters.has("familia")}
            onToggle={() => toggleChapter("familia")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Crear un grupo</h4>
            <Steps
              items={[
                "Entrá a tu panel de usuario → Configuración",
                'En "Grupo familiar", hacé click en "Crear grupo e invitar"',
                "Se genera un código de invitación único",
                "Compartí ese código con tu familia",
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Unirse a un grupo
            </h4>
            <Steps
              items={[
                "Entrá a tu panel de usuario → Configuración",
                'En "Grupo familiar", ingresá el código que te pasaron',
                'Hacé click en "Invitar familiar"',
                "El otro miembro recibe una notificación para aceptar",
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Aceptar/rechazar invitación
            </h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Cuando alguien te invita, recibís una notificación con botones \"Aceptar\" y
              \"Rechazar\". Al aceptar, aparece un disclaimer explicando que tus gastos serán
              visibles para el grupo.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Qué se comparte</h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1 mb-3">
              <li>Datos de gastos en el dashboard y reportes</li>
              <li>Análisis de categorías</li>
              <li>Estadísticas generales</li>
            </ul>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Salir del grupo</h4>
            <p className="text-sm text-[var(--text-secondary)]">
              En Configuración → Grupo familiar, hacé click en \"Salir del grupo\". Tus datos se
              separan del grupo pero se mantienen en tu cuenta.
            </p>
            <Callout type="info">
              Máximo 5 miembros por grupo. Cada miembro puede tener su propio bot de Telegram
              conectado.
            </Callout>
          </Chapter>

          <Chapter
            id="config"
            title="Configuración y seguridad"
            icon="settings"
            subtitle="Personalizá tu experiencia y protegé tu cuenta."
            expanded={expandedChapters.has("config")}
            onToggle={() => toggleChapter("config")}
          >
            <h4 className="font-semibold text-[var(--text-primary)] mb-2">Tema</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              Cambiá entre tema claro y oscuro desde el botón de tema en tu panel de usuario. Se
              adapta automáticamente al tema de tu sistema operativo.
            </p>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Cambiar contraseña
            </h4>
            <Steps
              items={[
                "Entrá a tu panel de usuario → Configuración",
                'En "Cambiar contraseña", ingresá tu contraseña actual',
                "Ingresá la nueva contraseña (8+ caracteres, mayúscula, minúscula, número, símbolo)",
                "Confirmá la nueva contraseña",
                'Hacé click en "Cambiar contraseña"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Autenticación de dos factores (MFA)
            </h4>
            <Steps
              items={[
                'En Configuración, hacé click en "Habilitar MFA"',
                "Escaneá el código QR con tu app de autenticación (Google Authenticator, Authy, etc.)",
                "Ingresá el código de 6 dígitos",
                'Hacé click en "Verificar y habilitar"',
              ]}
            />
            <Callout type="warning">
              Si perdés acceso a tu app de autenticación, necesitás contactar al administrador para
              deshabilitar MFA.
            </Callout>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Configuración de IA
            </h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1 mb-3">
              <li>
                <strong>Sugerencias IA:</strong> Activa/desactiva la categorización automática con
                inteligencia artificial
              </li>
              <li>
                <strong>Resumen semanal:</strong> Activa/desactiva el envío de reportes por Telegram
                cada lunes
              </li>
            </ul>

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">Eliminar cuenta</h4>
            <p className="text-sm text-[var(--text-secondary)] mb-3">
              La eliminación de cuenta es irreversible y elimina todos tus datos.
            </p>
            <Steps
              items={[
                'En Configuración, hacé click en "Zona de peligro"',
                'Hacé click en "Eliminar cuenta"',
                "Confirmá tu intención",
                "Ingresá tu email para verificar",
                "Ingresá tu contraseña",
                'Hacé click en "Eliminar cuenta"',
              ]}
            />

            <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
              Gestión de notificaciones
            </h4>
            <ul className="list-disc list-inside text-sm text-[var(--text-secondary)] space-y-1">
              <li>Hacé click en la campana para ver notificaciones</li>
              <li>\"Marcar todo leído\" para marcar todas como leídas</li>
              <li>\"Limpiar leídas\" para eliminar notificaciones leídas</li>
              <li>Hacé click en una notificación para ir a la sección correspondiente</li>
            </ul>
          </Chapter>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper Components                                                  */
/* ------------------------------------------------------------------ */

function Chapter({
  id,
  title,
  icon,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  subtitle: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-4 scroll-mt-8">
      <button
        onClick={onToggle}
        className="w-full text-left p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/20 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
            <SymbolicIcon name={icon} size={20} className="text-[var(--color-primary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
            <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>
          </div>
          <SymbolicIcon
            name="chevron"
            size={16}
            className={`text-[var(--text-secondary)] transition-transform duration-200 flex-shrink-0 ${expanded ? "rotate-90" : ""}`}
          />
        </div>
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${expanded ? "max-h-[5000px] mt-3" : "max-h-0"}`}
      >
        <div className="p-5 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] space-y-4 text-sm text-[var(--text-secondary)] leading-relaxed">
          {children}
        </div>
      </div>
    </section>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] flex items-center justify-center text-xs font-bold">
            {i + 1}
          </span>
          <span className="text-sm text-[var(--text-secondary)] pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({
  type,
  children,
}: {
  type: "tip" | "info" | "warning";
  children: React.ReactNode;
}) {
  const styles = {
    tip: "bg-[var(--gnome-green-1)]/15 border-[var(--gnome-green-4)]/30",
    info: "bg-[var(--gnome-blue-1)]/15 border-[var(--color-primary)]/30",
    warning: "bg-[var(--gnome-yellow-1)]/15 border-[var(--gnome-yellow-4)]/30",
  };
  const icons = { tip: "check" as const, info: "eye" as const, warning: "sparkles" as const };
  return (
    <div className={`p-4 rounded-lg border text-sm ${styles[type]}`}>
      <div className="flex items-start gap-3">
        <SymbolicIcon name={icons[type]} size={14} className="mt-0.5 flex-shrink-0 opacity-70" />
        <div>{children}</div>
      </div>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-base-alt)] p-3">
      {label && (
        <div className="text-[10px] text-[var(--text-secondary)] font-medium uppercase tracking-wide mb-1">
          {label}
        </div>
      )}
      <code className="text-sm text-[var(--text-primary)] font-mono">{code}</code>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-xl bg-[var(--color-surface)] border border-[var(--border-color)]">
      <div className="text-[10px] text-[var(--text-secondary)] font-medium uppercase">{label}</div>
      <div className="text-lg font-bold text-[var(--text-primary)] mt-1">{value}</div>
    </div>
  );
}

function ChatMockup() {
  return (
    <div className="bg-[#1a1a2e] rounded-xl p-3 border border-[#2a2a3e] max-w-[280px]">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#2a2a3e]">
        <div className="w-6 h-6 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center text-[10px] font-bold">
          N
        </div>
        <div className="text-white text-xs font-medium">NikoFin</div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-end">
          <div className="bg-[var(--color-primary)] rounded-xl rounded-tr-sm px-3 py-1.5 max-w-[85%]">
            <span className="text-white text-xs">mastercard galicia almacen 5999</span>
          </div>
        </div>
        <div className="flex justify-start">
          <div className="bg-[#2a2a3e] rounded-xl rounded-tl-sm px-3 py-1.5 max-w-[85%]">
            <div className="text-white text-xs leading-relaxed">
              ✅ ¡Listo! Guardé el gasto.
              <br />
              💰 $5.999
              <br />
              💳 Galicia Mastercard
              <br />
              🍽️ Alimentación
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
