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

export default function GuideRecurringPage() {
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
              <SymbolicIcon name="list" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Guía de Gastos Recurrentes
              </h1>
              <p className="text-[var(--text-secondary)]">
                Gestiona tus suscripciones y gastos periódicos en un solo lugar
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
              { id: "deteccion", label: "Detección automática" },
              { id: "ver", label: "Ver gastos recurrentes" },
              { id: "pausar", label: "Pausar/Reanudar" },
              { id: "editar", label: "Editar" },
              { id: "eliminar", label: "Eliminar" },
              { id: "alertas", label: "Alertas" },
              { id: "telegram", label: "Telegram" },
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

        {/* Section 1: What are recurring expenses */}
        <Section id="que-es" icon="list" title="¿Qué son los gastos recurrentes?">
          <p>
            Los gastos recurrentes son <strong>pagos periódicos</strong> que realizás todos los
            meses (o con otra frecuencia). Ejemplos: Netflix, Spotify, alquiler, servicios públicos,
            gimnasio, etc.
          </p>
          <p>
            A diferencia de las <strong>cuotas</strong> (que tienen un número finito de pagos), los
            gastos recurrentes son <strong>indefinidos</strong> — continúan hasta que los cancelás.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Si pagás Netflix $5.000 todos los 15 del mes, la app lo
              detecta automáticamente y te avisa antes de cada cobro.
            </p>
          </div>
        </Section>

        {/* Section 2: Auto-detection */}
        <Section id="deteccion" icon="sparkles" title="Detección automática">
          <p>
            La app analiza tu historial de gastos y detecta automáticamente patrones recurrentes.
            Esto funciona así:
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                1️⃣ Análisis de historial
              </p>
              <p className="text-xs">
                Un tarea diaria revisa tus gastos de los últimos 90 días buscando patrones.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                2️⃣ Criterios de detección
              </p>
              <p className="text-xs">
                Se detecta un gasto recurrente si hay <strong>2+ ocurrencias</strong> del mismo
                comercio con un monto similar (tolerancia de 10%).
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                3️⃣ Creación automática
              </p>
              <p className="text-xs">
                Se crea un registro de gasto recurrente con el comercio, monto promedio, categoría y
                fecha estimada del próximo cobro.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 3: View recurring expenses */}
        <Section id="ver" icon="list" title="Ver gastos recurrentes">
          <p>
            Todos tus gastos recurrentes se muestran en la página <strong>Programados</strong>,
            junto a tus cuotas pendientes.
          </p>
          <Steps
            items={[
              'Hacé click en "Programados" en el menú lateral',
              'Seleccioná la pestaña "Recurrentes" para ver solo gastos recurrentes',
              "Cada entrada muestra: descripción, monto, categoría y fecha del próximo cobro",
              'Usá la pestaña "Todos" para ver cuotas y gastos recurrentes juntos',
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Tarjetas KPI:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              En la parte superior verás: cantidad de gastos recurrentes activos, monto total
              mensual estimado, y carga del mes actual.
            </p>
          </div>
        </Section>

        {/* Section 4: Pause/Resume */}
        <Section id="pausar" icon="list" title="Pausar y reanudar">
          <p>
            Si querés dejar de pagar temporalmente una suscripción (por ejemplo, durante unas
            vacaciones), podés pausarla:
          </p>
          <Steps
            items={[
              "Entrá a Programados en el menú lateral",
              'Seleccioná la pestaña "Recurrentes"',
              "Hacé click en el gasto que querés pausar",
              'Hacé click en "Pausar"',
              "El gasto se marca como pausado y no se ejecuta automáticamente",
            ]}
          />
          <p className="mt-3 text-sm">
            <strong>Para reanudar:</strong> Hacé click en el gasto pausado y seleccioná "Reanudar".
            El gasto vuelve a estar activo y se ejecutará en la próxima fecha programada.
          </p>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">💡 Tip:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Podés ocultar los gastos pausados haciendo click en "Ocultar pausados" en la barra de
              herramientas.
            </p>
          </div>
        </Section>

        {/* Section 5: Edit */}
        <Section id="editar" icon="list" title="Editar un gasto recurrente">
          <p>Podés modificar varios campos de un gasto recurrente:</p>
          <Steps
            items={[
              "Hacé click en el gasto recurrente que querés editar",
              'Hacé click en "Editar"',
              "Modificá el monto (ej: si cambió el precio de Netflix)",
              "Modificá la fecha del próximo cobro si es necesario",
              "Cambiá la categoría o el medio de pago",
              "Guardá los cambios",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              Campos editables:
            </p>
            <ul className="list-disc ml-5 space-y-1 text-xs text-[var(--text-secondary)]">
              <li>
                <strong>Monto:</strong> El valor que se cobra cada período
              </li>
              <li>
                <strong>Fecha próximo cobro:</strong> Cuándo se espera el próximo pago
              </li>
              <li>
                <strong>Frecuencia:</strong> Mensual, semanal o anual
              </li>
              <li>
                <strong>Días de alerta:</strong> Cuántos días antes querés recibir el aviso
              </li>
              <li>
                <strong>Categoría:</strong> La categoría del gasto
              </li>
            </ul>
          </div>
        </Section>

        {/* Section 6: Delete */}
        <Section id="eliminar" icon="trash" title="Eliminar un gasto recurrente">
          <p>
            Si cancelaste una suscripción y no querés que aparezca más, podés eliminarla
            permanentemente:
          </p>
          <Steps
            items={[
              "Hacé click en el gasto recurrente",
              'Hacé click en "Eliminar"',
              "Confirmá la eliminación",
              "El gasto se elimina permanentemente del sistema",
            ]}
          />
          <div className="mt-3 p-4 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
            <p className="text-sm">
              <strong>⚠️ Importante:</strong> Esta acción es irreversible. Si solo querés dejar de
              recibir alertas temporalmente, usá "Pausar" en lugar de "Eliminar".
            </p>
          </div>
        </Section>

        {/* Section 7: Alerts */}
        <Section id="alertas" icon="bell" title="Alertas de cobro">
          <p>
            La app te avisa antes de cada cobro recurrente para que no te sorprendas con un débito
            inesperado.
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📅 Alerta predeterminada: 3 días antes
              </p>
              <p className="text-xs">
                Por defecto, recibís una notificación 3 días antes de cada cobro. Podés cambiar esto
                editando el gasto recurrente.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🔔 Notificación por Telegram
              </p>
              <p className="text-xs">
                Recibirás un mensaje como: "Tu pago de Netflix ($5.000) vence en 3 días"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📱 Notificación en la app
              </p>
              <p className="text-xs">
                También verás una notificación en el ícono de campana de la aplicación.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 8: Telegram */}
        <Section id="telegram" icon="telegram" title="Gestión desde Telegram">
          <p>
            Podés gestionar tus gastos recurrentes directamente desde Telegram usando comandos
            simples:
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                /suscripciones
              </p>
              <p className="text-xs">
                Lista todos tus gastos recurrentes activos con monto, categoría y fecha del próximo
                cobro.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">/pausar</p>
              <p className="text-xs">
                Pausa un gasto recurrente. El bot te muestra la lista y elegís cuál pausar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">/cancelar</p>
              <p className="text-xs">
                Elimina permanentemente un gasto recurrente. El bot te pide confirmación antes de
                eliminar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">/ver</p>
              <p className="text-xs">
                Muestra el detalle de un gasto recurrente específico (monto, categoría, historial de
                pagos).
              </p>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">💡 Tip:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              También podés escribirle al bot en lenguaje natural: "¿Cuándo vence Netflix?" o "Pausá
              Spotify".
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
