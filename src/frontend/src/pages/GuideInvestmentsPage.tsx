import SymbolicIcon from "../components/SymbolicIcon";

function Section({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
          <SymbolicIcon name={icon} size={20} className="text-[var(--color-primary)]" />
        </div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
      </div>
      <div className="space-y-4 text-[var(--text-secondary)] leading-relaxed">{children}</div>
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

export default function GuideInvestmentsPage() {
  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] bg-[var(--color-surface)]">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <a
            href="/guide"
            className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline mb-6"
          >
            ← Volver a la guía
          </a>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center">
              <SymbolicIcon
                name="arrow-up-right"
                size={26}
                className="text-[var(--color-primary)]"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">Guía de Inversiones</h1>
              <p className="text-[var(--text-secondary)]">
                Todo lo que necesitás saber para trackear tus inversiones y tu portfolio
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Quick Nav */}
        <nav className="mb-8 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)]">
          <p className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide mb-2">
            En esta guía
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "que-es", label: "Qué es" },
              { id: "agregar-manual", label: "Agregar manualmente" },
              { id: "sync-iol", label: "Sync IOL" },
              { id: "sync-ppi", label: "Sync PPI" },
              { id: "refresh-precios", label: "Refresh de precios" },
              { id: "tipo-cambio", label: "Tipo de cambio USD/ARS" },
              { id: "portfolio", label: "Portfolio" },
              { id: "consejos", label: "Consejos" },
            ].map((nav) => (
              <a
                key={nav.id}
                href={`#${nav.id}`}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-[var(--color-base-alt)] text-[var(--text-secondary)] hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)] transition-colors"
              >
                {nav.label}
              </a>
            ))}
          </div>
        </nav>

        {/* Section 1: What is Investments tracking */}
        <Section id="que-es" icon="arrow-up-right" title="¿Qué es el seguimiento de inversiones?">
          <p>
            El módulo de inversiones te permite{" "}
            <strong>ver todas tus inversiones en un solo lugar</strong>, tanto las que cargás
            manualmente como las que se sincronizan automáticamente desde tu broker.
          </p>
          <p>
            Podés trackear acciones, bonos, Cedears, plazos fijos, fondos comunes y más. El sistema
            calcula automáticamente tus ganancias y pérdidas en tiempo real.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Tenés 100 Cedears de AAPL comprados a $15.000 c/u. El
              sistema muestra el precio actual de Yahoo Finance, calcula tu ganancia/pérdida, y te
              muestra la composición de tu portfolio por activo y por broker.
            </p>
          </div>
          <p>Hay dos formas de cargar inversiones:</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              <strong>Manual</strong> — Cargás vos mismo el ticker, cantidad y costo
            </li>
            <li>
              <strong>Automática (Sync)</strong> — Conectás tu broker (IOL o PPI) y el sistema
              importa tu portfolio
            </li>
          </ul>
        </Section>

        {/* Section 2: Add investments manually */}
        <Section id="agregar-manual" icon="arrow-up-right" title="Agregar inversiones manualmente">
          <p>
            Si tu broker no tiene sync automático o preferís cargar vos mismo, podés agregar
            inversiones de forma manual.
          </p>
          <Steps
            items={[
              'Entrá a "Inversiones" en el menú lateral',
              'Hacé click en "+ Agregar inversión"',
              "Completá el ticker del activo (ej: AAPL, AL30, GGAL)",
              "Seleccioná el broker donde tenés la posición (o elegí 'Sin broker')",
              "Ingresá la cantidad de acciones/títulos que tenés",
              "Ingresá el costo total de compra (en ARS o USD, el sistema calcula el costo unitario)",
              "Guardá — el sistema empieza a trackear el precio automáticamente",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              Campos requeridos:
            </p>
            <ul className="text-xs text-[var(--text-secondary)] space-y-1 ml-3 list-disc">
              <li>
                <strong>Ticker</strong> — Símbolo del activo (obligatorio)
              </li>
              <li>
                <strong>Cantidad</strong> — Número de títulos (obligatorio)
              </li>
              <li>
                <strong>Costo total</strong> — Cuanto pagaste en total (obligatorio)
              </li>
              <li>
                <strong>Broker</strong> — Opcional, para agrupar por broker
              </li>
            </ul>
          </div>
        </Section>

        {/* Section 3: IOL sync */}
        <Section id="sync-iol" icon="sparkles" title="Sincronización con IOL (Invertir Online)">
          <p>
            Si usás Invertir Online como broker, podés conectar tu cuenta para que el sistema
            importe automáticamente tu portfolio. No tenés que cargar nada manualmente.
          </p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">Cómo funciona OAuth2:</p>
          <Steps
            items={[
              'En "Inversiones", hacé click en "Conectar broker" y seleccioná IOL',
              "El sistema te redirige a la página de IOL para autorizar la conexión",
              "Iniciás sesión en IOL y autorizás a la app a leer tu portfolio",
              "Volvés automáticamente a la app con la conexión activa",
              "El sistema importa todas tus posiciones actuales",
              "Cada 15 minutos durante el horario de mercado, el portfolio se actualiza solo",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              ¿Qué datos se sincronizan?
            </p>
            <ul className="text-xs text-[var(--text-secondary)] space-y-1 ml-3 list-disc">
              <li>Todas tus posiciones actuales (ticker, cantidad, costo de compra)</li>
              <li>El sistema calcula automáticamente el costo promedio</li>
              <li>Las posiciones nuevas aparecen en tu portfolio sin que hagas nada</li>
            </ul>
          </div>
          <div className="mt-3 p-4 rounded-xl bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20">
            <p className="text-sm">
              <strong>⚠️ Seguridad:</strong> La app solo tiene permiso de lectura. No puede hacer
              operaciones ni modificar tu cuenta de IOL. Podés revocar el acceso desde la
              configuración de IOL en cualquier momento.
            </p>
          </div>
        </Section>

        {/* Section 4: PPI sync */}
        <Section
          id="sync-ppi"
          icon="sparkles"
          title="Sincronización con PPI (Portfolio Personal Inversiones)"
        >
          <p>
            Si usás PPI como broker, la conexión se hace mediante API key. Es un proceso diferente
            al de IOL pero igual de simple.
          </p>
          <Steps
            items={[
              'En "Inversiones", hacé click en "Conectar broker" y seleccioná PPI',
              "Ingresá tu API key de PPI (la generás desde la configuración de tu cuenta PPI)",
              "El sistema valida la key y conecta tu cuenta",
              "Se importan todas tus posiciones actuales automáticamente",
              "La sincronización se ejecuta cada 15 minutos en horario de mercado",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              ¿Dónde obtengo la API key?
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Entrá a tu cuenta en PPI → Configuración → API Keys → Generar nueva key. Copiá la key
              y pegala en la app. Guardala en un lugar seguro, no la compartas.
            </p>
          </div>
        </Section>

        {/* Section 5: Price refresh */}
        <Section id="refresh-precios" icon="arrow-up-right" title="Actualización de precios">
          <p>
            Los precios de tus inversiones se actualizan automáticamente usando{" "}
            <strong>Yahoo Finance</strong> como fuente de datos.
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🕐 Frecuencia de actualización
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cada <strong>15 minutos</strong> durante el horario de mercado abierto (NYSE:
                10:30-17:00 ET, BYMA: 11:00-17:00 ART). Fuera de horario, los precios se mantienen
                al último cierre.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🌐 Activos soportados
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Acciones argentinas (GGAL, YPF, etc.), Cedears (AAPL, TSLA, etc.), bonos (AL30,
                GD30), ETFs, y acciones de mercados internacionales. Si Yahoo Finance lo tiene, lo
                podemos trackear.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                💱 Conversión automática
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Los precios en USD se convierten a ARS usando el tipo de cambio actual (ver sección
                siguiente) para mostrar todo en una misma moneda en el portfolio.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 6: USD/ARS rate */}
        <Section id="tipo-cambio" icon="arrow-up-right" title="Tipo de cambio USD/ARS">
          <p>
            Para mostrar todas tus inversiones en una moneda común, el sistema necesita saber el
            tipo de cambio USD/ARS. Se obtiene de dos fuentes:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border-2 border-[var(--color-primary)]/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--color-primary)]">BNA</span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Banco Nación</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Tipo de cambio oficial del Banco Nación. Se actualiza varias veces al día. Es la
                referencia para el dólar oficial.
              </p>
            </div>
            <div className="p-4 rounded-xl border-2 border-[var(--color-warning)]/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[var(--color-warning)]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--color-warning)]">ADR</span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">ADR implícito</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Tipo de cambio implícito calculado a partir de los precios de acciones argentinas
                que cotizan en NYSE como ADRs. Refleja el dólar "de mercado".
              </p>
            </div>
          </div>
          <p className="mt-3 text-sm">
            El sistema usa el tipo de cambio ADR implícito como referencia principal para la
            conversión de moneda en tu portfolio, ya que refleja mejor el valor real de mercado.
          </p>
        </Section>

        {/* Section 7: Portfolio view */}
        <Section id="portfolio" icon="chart-bar" title="Vista del portfolio">
          <p>
            La vista de portfolio te muestra toda la información de tus inversiones de un vistazo:
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📋 Listado de holdings
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cada posición muestra: ticker, nombre del activo, cantidad, precio actual, valor de
                mercado, costo de compra, y ganancia/pérdida tanto en monto como en porcentaje.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📊 Ganancias y pérdidas
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cada posición muestra con color verde (ganancia) o rojo (pérdida) el resultado. Al
                fondo del listado, el total consolidado de todo tu portfolio.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🥧 Composición por activo
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Gráfico de torta que muestra qué porcentaje de tu portfolio está en cada activo. Te
                ayuda a ver si estás diversificado o concentrado en un solo activo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🏦 Filtro por broker
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Podés filtrar el portfolio por broker para ver las posiciones de IOL, PPI, o las que
                cargaste manualmente por separado.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 8: Tips */}
        <Section id="consejos" icon="sparkles" title="Consejos para trackear inversiones">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usá sync automático si podés
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Conectar IOL o PPI te ahorra tiempo y evita errores de carga manual. Las posiciones
                nuevas se importan solas y los costos se calculan automáticamente.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Cargá manualmente para casos especiales
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si tenés inversiones en brokers que no tienen sync (o en otro tipo de activo como
                plazo fijo o FCI), cargalos manualmente. Es rápido y te da la vista completa.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Revisá la composición del portfolio
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si el 80% de tu portfolio está en un solo activo, es momento de diversificar. La
                vista de composición te ayuda a detectar concentración excesiva.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Los precios se actualizan solos
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                No tenés que refrescar nada. Los precios se actualizan cada 15 minutos en horario de
                mercado. Fuera de horario, se mantiene el último cierre.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">💡 Combiná fuentes</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Podés tener posiciones de IOL sincronizadas, posiciones de PPI sincronizadas, y
                además cargar algunas manualmente. Todo se ve unificado en el portfolio.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
