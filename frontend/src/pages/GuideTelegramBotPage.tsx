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

export default function GuideTelegramBotPage() {
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
              <SymbolicIcon name="telegram" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Guía del Bot de Telegram
              </h1>
              <p className="text-[var(--text-secondary)]">
                Registrá gastos, recibí alertas y controlá tus finanzas desde Telegram
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
              { id: "vincular", label: "Vincular cuenta" },
              { id: "registrar", label: "Registrar gastos" },
              { id: "notificaciones", label: "Notificaciones bancarias" },
              { id: "cuotas", label: "Cuotas" },
              { id: "alertas", label: "Alertas de presupuesto" },
              { id: "eventos", label: "Eventos temporales" },
              { id: "comandos", label: "Comandos" },
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

        {/* Section 1: What is the Telegram Bot */}
        <Section id="que-es" icon="telegram" title="¿Qué es el bot de Telegram?">
          <p>
            <strong>@NikoFin_bot</strong> es tu asistente de finanzas personales en Telegram. Te
            permite <strong>registrar gastos en segundos</strong> escribiendo de forma natural, como
            si se lo contaras a un amigo.
          </p>
          <p>
            No necesitás abrir la app ni navegar menús. Desde Telegram podés cargar gastos, recibir
            alertas de presupuesto y hasta reenviar notificaciones de tu banco para que se registren
            automáticamente.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Le escribís "farmacity 3200" y el bot te responde con el
              gasto parseado, te pide el medio de pago y lo guarda. Todo en menos de 10 segundos.
            </p>
          </div>
        </Section>

        {/* Section 2: Link account */}
        <Section id="vincular" icon="bot" title="Cómo vincular tu cuenta">
          <p>
            Para que el bot sepa quién sos, necesitás vincular tu cuenta de la app con Telegram. Se
            hace una sola vez.
          </p>
          <Steps
            items={[
              "Abrí Telegram y buscá @NikoFin_bot",
              "Escribí /start para iniciar la conversación",
              "El bot te va a pedir una clave de 12 caracteres",
              "En la app web, andá a Configuración → Telegram Bot y copiá la clave",
              "Pegá la clave en el chat de Telegram",
              "¡Listo! El bot te confirma tu nombre y ya podés registrar gastos",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Importante:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              La clave de un solo uso. Después de vincular, se invalida automáticamente. Si
              necesitás reconectar, desde la app podés generar una nueva clave.
            </p>
          </div>
        </Section>

        {/* Section 3: Log expenses */}
        <Section id="registrar" icon="bot" title="Cómo registrar gastos">
          <p>
            Escribile al bot de forma natural. No hace falta usar comandos especiales ni seguir un
            formato rígido.
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-2">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              Ejemplos que funcionan:
            </p>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">• "farmacity 3200"</p>
              <p className="text-xs text-[var(--text-secondary)]">• "uber 3200 ayer"</p>
              <p className="text-xs text-[var(--text-secondary)]">
                • "almuerzo con Pedro 8500 pesos"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">• "Netflix USD 5"</p>
              <p className="text-xs text-[var(--text-secondary)]">
                • "cargué nafta 15000 el viernes"
              </p>
            </div>
          </div>
          <p>
            El bot usa inteligencia artificial para entender tu mensaje: detecta el monto, la
            descripción, la fecha y hasta la categoría automáticamente.
          </p>
          <Steps
            items={[
              "Escribís el gasto en lenguaje natural",
              "El bot te muestra el gasto parseado (monto, descripción, categoría)",
              "Te pide que elijas el medio de pago (tarjeta, efectivo, etc.)",
              "Confirmás y el gasto se guarda",
            ]}
          />
        </Section>

        {/* Section 4: Bank notifications */}
        <Section id="notificaciones" icon="bot" title="Notificaciones bancarias">
          <p>
            Si tu banco te manda notificaciones por SMS o push cuando usás la tarjeta, podés
            <strong> reenviarlas directamente al bot</strong>. Las detecta automáticamente y extrae
            el monto, la tarjeta y el comercio.
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-2">
            <p className="text-xs font-semibold text-[var(--text-primary)]">
              Tipos de notificaciones que el bot reconoce:
            </p>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                • "Compra aprobada Visa ****4521 $15.200 Supermercado"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • "Débito Mastercard ****1234 $8.500 Netflix"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • "Consumo confirmado $12.000 en Farmacity"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • "Transferencia saliente $50.000"
              </p>
            </div>
          </div>
          <p>
            El bot detecta automáticamente la franquicia (Visa, Mastercard, etc.) y el banco. Si
            reconoce tu tarjeta, te muestra toda la info junta para que solo confirmes.
          </p>
        </Section>

        {/* Section 5: Installments */}
        <Section id="cuotas" icon="bot" title="Seguimiento de cuotas">
          <p>
            Si pagaste algo en cuotas, el bot te pregunta automáticamente después de registrar el
            gasto. Solo tenés que indicar cuántas cuotas y el sistema se encarga del resto.
          </p>
          <Steps
            items={[
              'Registrás el gasto normalmente (ej: "compré un celular 120000")',
              'El bot te pregunta: "¿Lo pagaste en cuotas?"',
              'Seleccionás "Sí" y escribís la cantidad de cuotas (2 a 60)',
              "El sistema crea los gastos mensuales automáticamente",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Ejemplo:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Comprás un celular en 12 cuotas de $10.000. El bot crea 12 gastos de $10.000, uno por
              mes, para que veas el impacto real en tu presupuesto mes a mes.
            </p>
          </div>
        </Section>

        {/* Section 6: Budget alerts */}
        <Section id="alertas" icon="bell" title="Alertas de presupuesto">
          <p>
            El bot está conectado con tu sistema de presupuestos. Cuando un gasto te hace superar un
            límite, recibís una alerta directa en Telegram.
          </p>
          <div className="space-y-2">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🟡 Al superar el 80% de una categoría
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Te avisa que te estás acercando al límite para que puedas ajustar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🔴 Al superar el 100% del presupuesto
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Alerta inmediata: te pasaste del presupuesto de esa categoría.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                📅 Revisión diaria automática
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cada mañana el bot revisa todos tus grupos y categorías y te manda un resumen si hay
                alertas pendientes.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 7: Temporal events */}
        <Section id="eventos" icon="bot" title="Eventos temporales">
          <p>
            Si tenés un evento temporal configurado (vacaciones, un viaje, un casamiento), el bot te
            pregunta si un gasto pertenece a ese evento cuando la fecha coincide.
          </p>
          <Steps
            items={[
              "Registrás un gasto normalmente",
              'Si hay un evento activo en esas fechas, el bot te pregunta: "¿Este gasto pertenece a un evento temporal?"',
              'Elegís el evento o seleccionás "No vincular"',
              "El gasto se vincula al evento y se descuenta de su presupuesto",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Ejemplo:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Tenés el evento "Vacaciones Europa" del 1 al 15 de julio. Si el 5 de julio le escribís
              "hotel 85000", el bot te pregunta si pertenece a Vacaciones Europa para vincularlo
              automáticamente.
            </p>
          </div>
        </Section>

        {/* Section 8: Commands */}
        <Section id="comandos" icon="telegram" title="Comandos disponibles">
          <div className="space-y-2">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">/start</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Inicia la conversación. Si ya estás vinculado, te muestra un resumen. Si no, te pide
                la clave de vinculación.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">/help</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Muestra ejemplos de cómo registrar gastos y usar el bot.
              </p>
            </div>
          </div>
          <p className="mt-2 text-sm">
            <strong>Tip:</strong> También podés escribir "ayuda" en cualquier momento y el bot te
            muestra los ejemplos.
          </p>
        </Section>

        {/* Section 9: Tips */}
        <Section id="consejos" icon="sparkles" title="Consejos para mejor uso">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">💡 Sé natural</p>
              <p className="text-xs text-[var(--text-secondary)]">
                No necesitás memorizar comandos. Escribí como le hablarías a alguien: "gasté 5000 en
                el supermercado ayer" funciona perfecto.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Reenviá notificaciones bancarias
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si tu banco te manda SMS o push notifications, reenvialas al bot. Detecta el monto,
                la tarjeta y el comercio automáticamente. Es la forma más rápida de registrar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usalo para registro rápido
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El bot es ideal para registrar gastos en el momento, cuando no tenés tiempo de abrir
                la app. Después podés revisar todo en la web.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Mencioná la fecha si no es hoy
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si el gasto fue ayer, la semana pasada o una fecha específica, mencionalo: "uber
                3200 ayer" o "cena el viernes 15000". El bot entiende fechas relativas y absolutas.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Revisá las alertas
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cuando el bot te mande una alerta de presupuesto, tómala como una señal para revisar
                tus gastos en la app y ajustar si es necesario.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
