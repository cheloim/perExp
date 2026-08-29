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

export default function GuideBudgetingPage() {
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
              <SymbolicIcon name="chart-bar" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Guía de Presupuestos
              </h1>
              <p className="text-[var(--text-secondary)]">
                Todo lo que necesitás saber para controlar tus gastos con presupuestos
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
              { id: "beneficios", label: "Beneficios" },
              { id: "como-funciona", label: "Cómo funciona" },
              { id: "primeros-pasos", label: "Primeros pasos" },
              { id: "grupos", label: "Grupos" },
              { id: "categorias", label: "Categorías" },
              { id: "eventos", label: "Eventos temporales" },
              { id: "telegram", label: "Telegram" },
              { id: "alertas", label: "Alertas" },
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

        {/* Section 1: What is budgeting */}
        <Section id="que-es" icon="chart-bar" title="¿Qué son los presupuestos?">
          <p>
            Los presupuestos son <strong>límites de gasto mensual</strong> que asignás a cada
            categoría de tus gastos. En lugar de revisar tus gastos al final del mes y darte cuenta
            de que te pasaste, el sistema te avisa <strong>mientras estás gastando</strong>.
          </p>
          <p>
            Es como tener un semáforo para cada categoría: 🟢 cuando vas bien, 🟡 cuando te acercás
            al límite, y 🔴 cuando te pasaste.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Si asignás $80.000 a "Supermercado" y ya gastaste
              $72.000, verás una barra amarilla al 90% y una alerta de "Cuidado, te acercás al
              límite".
            </p>
          </div>
        </Section>

        {/* Section 2: Benefits */}
        <Section id="beneficios" icon="sparkles" title="¿Para qué sirve?">
          <p>
            Los presupuestos no son para limitarte, sino para darte{" "}
            <strong>visibilidad y control</strong>:
          </p>
          <ul className="list-disc ml-5 space-y-2">
            <li>
              <strong>Sorpresas al final del mes</strong> — Sabés exactamente cuánto te queda en
              cada categoría
            </li>
            <li>
              <strong>Decisiones informadas</strong> — Antes de gastar, sabés si podés o no
            </li>
            <li>
              <strong>Hábitos más sanos</strong> — La app te avisa cuando te acercás al límite
            </li>
            <li>
              <strong>Metas de ahorro</strong> — Asigná un porcentaje a ahorro y seguí el progreso
            </li>
            <li>
              <strong>Eventos especiales</strong> — Creá presupuestos temporales para vacaciones o
              viajes
            </li>
          </ul>
        </Section>

        {/* Section 3: How it works */}
        <Section id="como-funciona" icon="sparkles" title="¿Cómo funciona?">
          <p>El sistema tiene 3 capas que trabajan juntas:</p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                1️⃣ Grupos (60/40)
              </p>
              <p className="text-xs">
                Tu ingreso se divide en Necesidades (60%) y Gustos (40%). Cada categoría pertenece a
                un grupo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                2️⃣ Categorías con límite
              </p>
              <p className="text-xs">
                Cada subcategoría puede tener un presupuesto mensual. Ejemplo: Supermercado $80.000,
                Restaurantes $15.000.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                3️⃣ Seguimiento automático
              </p>
              <p className="text-xs">
                Cada gasto que registrás se descuenta automáticamente del presupuesto de su
                categoría.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 4: Getting started */}
        <Section id="primeros-pasos" icon="chart-bar" title="Primeros pasos">
          <Steps
            items={[
              'Entrá a "Presupuesto" en el menú lateral',
              "La app te pide tu ingreso mensual para calcular los grupos",
              "Asigna el 60% a Necesidades y el 40% a Gustos",
              "Hacé click en 'Configurar presupuestos' para asignar montos por categoría",
              "Guardá y empezá a controlar tus gastos",
            ]}
          />
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> Empezá con pocas categorías. Después vas agregando más según
            necesités.
          </p>
        </Section>

        {/* Section 5: Groups */}
        <Section id="grupos" icon="chart-bar" title="Grupos de presupuesto">
          <p>
            Los grupos son la forma en que organizás tu ingreso. Cada grupo representa un porcentaje
            de tu ingreso mensual:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border-2 border-[var(--color-primary)]/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--color-primary)]">60%</span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Necesidades</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Gastos esenciales: Alimentación, Transporte, Salud, Hogar, Servicios
              </p>
            </div>
            <div className="p-4 rounded-xl border-2 border-[var(--color-warning)]/30">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-[var(--color-warning)]/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-[var(--color-warning)]">40%</span>
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">Gustos</p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Entretenimiento: Ropa, Streaming, Salidas, Restaurantes, Viajes
              </p>
            </div>
          </div>

          <p className="mt-3 text-sm">
            Podés ajustar los porcentajes haciendo click en "Editar grupos" en la página de
            presupuesto.
          </p>
        </Section>

        {/* Section 6: Categories */}
        <Section id="categorias" icon="chart-bar" title="Categorías con presupuesto">
          <p>
            Cada subcategoría puede tener su propio límite mensual. Por ejemplo, dentro de
            "Alimentación":
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-success)]" />
              <span className="text-xs">🟢 Supermercado — $45.000 / $80.000 (56%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-warning)]" />
              <span className="text-xs">🟡 Delivery — $8.000 / $10.000 (80%)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />
              <span className="text-xs">🔴 Restaurantes — $18.000 / $15.000 (120%)</span>
            </div>
          </div>
          <p className="mt-3 text-sm">
            La barra cambia de color según el porcentaje: verde (bien), amarillo (cuidado), rojo
            (alerta).
          </p>
        </Section>

        {/* Section 7: Temporal events */}
        <Section id="eventos" icon="chart-bar" title="Eventos temporales">
          <p>
            Los eventos temporales son presupuestos para un período específico: vacaciones, un
            viaje, un casamiento, etc.
          </p>
          <Steps
            items={[
              'Hacé click en "+ Nuevo evento" en la página de presupuesto',
              "Completá nombre, fechas de inicio y fin, y presupuesto total",
              "Cuando registres gastos durante el evento, el bot te preguntará si pertenecen al evento",
              "El progreso del evento se actualiza automáticamente con cada gasto vinculado",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Ejemplo:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              "Vacaciones Europa" — 01/07 al 15/07 — $500.000
              <br />
              Los gastos de hotel, vuelos y comida durante esas fechas se vinculan al evento
              automáticamente.
            </p>
          </div>
        </Section>

        {/* Section 8: Telegram */}
        <Section id="telegram" icon="telegram" title="Telegram y presupuestos">
          <p>
            El bot de Telegram está integrado con el sistema de presupuestos. Cuando guardás un
            gasto:
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              Si el gasto cae dentro de un evento temporal, el bot te pregunta si pertenece a él
            </li>
            <li>Si la categoría supera el umbral de alerta, el bot te envía una notificación</li>
            <li>Si un grupo supera el 80%, recibís una alerta diaria</li>
          </ul>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Ejemplo:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Vos: "supermercado 12000"
              <br />
              Bot: "✅ Guardé el gasto. 💰 $12.000..."
              <br />
              Bot: "📅 ¿Este gasto pertenece a un evento temporal?"
              <br />
              Bot: [Vacaciones] [No vincular]
            </p>
          </div>
        </Section>

        {/* Section 9: Alerts */}
        <Section id="alertas" icon="bell" title="Alertas y notificaciones">
          <p>El sistema envía alertas automáticas en tres situaciones:</p>
          <div className="space-y-2">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🟡 Al guardar un gasto que supera el 80%
              </p>
              <p className="text-xs text-[var(--text-secondary)]">Alerta inmediata por Telegram</p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🔴 Al superar el 100% del presupuesto
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Alerta inmediata por Telegram + notificación en la app
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                📅 Diariamente a las 10:00 UTC
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Revisión automática de todos los grupos y categorías
              </p>
            </div>
          </div>
        </Section>

        {/* Section 10: Tips */}
        <Section id="consejos" icon="sparkles" title="Consejos para empezar">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Empezá con pocas categorías
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                No intentes presupuestar todo de una vez. Empezá con las categorías donde más
                gastás.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Revisá semanalmente
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                No esperes al final del mes. Revisá tu progreso cada semana para ajustar a tiempo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usá el bot de Telegram
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Registrar gastos por Telegram es más rápido. El bot te avisa si te pasás del límite.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 No te castigues por pasarte
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si te pasás de un presupuesto, analizá por qué y ajustá el mes que viene. El
                presupuesto es una guía, no una prisión.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
