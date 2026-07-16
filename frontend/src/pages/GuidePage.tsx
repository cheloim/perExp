import { useEffect, useState } from "react";
import SymbolicIcon from "../components/SymbolicIcon";

const SECTIONS = [
  { id: "primeros-pasos", label: "Primeros pasos", icon: "check" as const },
  { id: "bot-telegram", label: "Bot de Telegram", icon: "telegram" as const },
  { id: "dashboard", label: "Dashboard", icon: "chart-bar" as const },
  { id: "cuentas", label: "Cuentas y tarjetas", icon: "card" as const },
  { id: "gastos", label: "Gastos", icon: "list" as const },
  { id: "reportes", label: "Reportes", icon: "chart-donut" as const },
  { id: "inversiones", label: "Inversiones", icon: "arrow-up-right" as const },
  { id: "configuracion", label: "Configuración", icon: "settings" as const },
  { id: "privacidad", label: "Privacidad", icon: "shield" as const },
  { id: "faq", label: "Preguntas frecuentes", icon: "bot" as const },
];

export default function GuidePage() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
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
            <h1 className="text-3xl font-bold text-[var(--text-primary)]">Guía de usuario</h1>
          </div>
          <p className="text-[var(--text-secondary)] ml-[52px]">
            Todo lo que necesitás para empezar a usar Oikonomia.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto flex gap-8 px-4 py-8">
        {/* Sidebar TOC — desktop */}
        <nav className="hidden lg:block w-52 flex-shrink-0">
          <div className="sticky top-8 space-y-0.5">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
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

        {/* Mobile TOC — horizontal pills */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[var(--color-surface)] border-t border-[var(--border-color)] px-4 py-2 overflow-x-auto scrollbar-none">
          <div className="flex gap-1.5 min-w-max">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth" });
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
          {/* Primeros pasos */}
          <section id="primeros-pasos" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="check"
              title="Primeros pasos"
              subtitle="En 3 pasos estás listo para usar Oikonomia."
            />
            <div className="grid sm:grid-cols-3 gap-4 mt-6">
              <StepCard
                number={1}
                title="Registrate"
                description="Creá tu cuenta con email o Google en segundos."
              />
              <StepCard
                number={2}
                title="Agregá una tarjeta"
                description="Entrá a Cuentas y agregá tu primera tarjeta o cuenta bancaria."
              />
              <StepCard
                number={3}
                title="Primer gasto"
                description="Mandale un mensaje al bot de Telegram o agregalo desde la web."
              />
            </div>
          </section>

          {/* Bot de Telegram */}
          <section id="bot-telegram" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="telegram"
              title="Bot de Telegram"
              subtitle="La forma más rápida de registrar gastos."
            />
            <div className="mt-6 grid md:grid-cols-2 gap-6">
              <div>
                <Callout type="info">
                  Buscá <strong>@NikoFinBot</strong> en Telegram o usá el link que aparece en
                  Configuración → Bot de Telegram.
                </Callout>
                <h4 className="font-semibold text-[var(--text-primary)] mt-6 mb-2">
                  Formato del mensaje
                </h4>
                <p className="text-sm text-[var(--text-secondary)] mb-3">
                  Escribile como le contarías a un amigo:
                </p>
                <div className="space-y-2">
                  <CodeExample
                    message="mastercard galicia almacen 5999"
                    label="Gasto simple con tarjeta"
                  />
                  <CodeExample
                    message="visa santander cuotas 3 supermercado 12000"
                    label="Gasto en cuotas"
                  />
                  <CodeExample message="efectivo almuerzo 2500" label="Gasto en efectivo" />
                </div>
              </div>
              <ChatMockup />
            </div>
            <Callout type="tip" className="mt-4">
              <strong>Notificaciones bancarias:</strong> Si copiás y pegás una notificación de tu
              banco (SMS, email o push), el bot la detecta automáticamente y registra el gasto.
            </Callout>
          </section>

          {/* Dashboard */}
          <section id="dashboard" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="chart-bar"
              title="Dashboard"
              subtitle="Tu panel de control con resumen del mes."
            />
            <div className="mt-6">
              <DashboardMockup />
              <div className="grid sm:grid-cols-2 gap-4 mt-6">
                <InfoCard
                  icon="chart-bar"
                  title="Gasto total del mes"
                  description="Suma de todos los gastos registrados en el mes actual."
                />
                <InfoCard
                  icon="chart-donut"
                  title="Gráfico de categorías"
                  description="Distribución de gastos por rubro para ver dónde va tu dinero."
                />
                <InfoCard
                  icon="sparkles"
                  title="Tendencias con IA"
                  description="Análisis de patrones y comparación con meses anteriores."
                />
                <InfoCard
                  icon="chart-bar"
                  title="Promedio diario"
                  description="Cuánto gastás por día en promedio este mes."
                />
              </div>
            </div>
          </section>

          {/* Cuentas y tarjetas */}
          <section id="cuentas" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="card"
              title="Cuentas y tarjetas"
              subtitle="Organizá todos tus medios de pago."
            />
            <div className="mt-6 grid md:grid-cols-2 gap-6 items-start">
              <CardMockup />
              <div>
                <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Tarjetas de crédito</strong> — Visa, Mastercard, Naranja, etc.
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Tarjetas de débito</strong> — vinculadas a cuentas bancarias
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Efectivo</strong> — plata física
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Bancos digitales</strong> — Mercado Pago, Brubank, Ualá
                    </span>
                  </li>
                </ul>
                <Callout type="tip" className="mt-4">
                  <strong>Vincular tarjeta con cuenta:</strong> Si tenés una caja de ahorro y la
                  tarjeta de débito correspondiente, vincularlas para que los gastos se resten
                  automáticamente del saldo.
                </Callout>
              </div>
            </div>
          </section>

          {/* Gastos */}
          <section id="gastos" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="list"
              title="Gastos"
              subtitle="Registrá y categorizá tus gastos."
            />
            <div className="mt-6">
              <ExpenseListMockup />
              <div className="grid sm:grid-cols-3 gap-4 mt-6">
                <MethodCard
                  icon="telegram"
                  title="Bot de Telegram"
                  description="La más rápida, desde el celular."
                />
                <MethodCard
                  icon="list"
                  title="Formulario web"
                  description="Desde la pestaña Gastos, click en + Agregar."
                />
                <MethodCard
                  icon="arrow-up-right"
                  title="Importación CSV"
                  description="Subí un archivo con tus movimientos."
                />
              </div>
              <Callout type="tip" className="mt-4">
                <strong>Categorización con IA:</strong> Cuando registrás un gasto, la inteligencia
                artificial lo categoriza automáticamente. Si no es correcta, podés cambiarla con un
                click.
              </Callout>
            </div>
          </section>

          {/* Reportes */}
          <section id="reportes" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="chart-donut"
              title="Reportes"
              subtitle="Entendé tus hábitos de gasto."
            />
            <div className="mt-6 grid md:grid-cols-2 gap-6 items-center">
              <ChartMockup />
              <div>
                <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Reporte mensual</strong> — desglose por categoría con gráficos
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Tendencias</strong> — cómo cambiaron tus gastos mes a mes
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Proyecciones</strong> — estimación de gasto futuro
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="check"
                      size={16}
                      className="text-[var(--gnome-green-5)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Comparativas</strong> — compará dos meses lado a lado
                    </span>
                  </li>
                </ul>
                <Callout type="info" className="mt-4">
                  <strong>Resumen semanal:</strong> Si lo activás en Configuración, cada lunes
                  recibís un resumen por Telegram con los totales por categoría.
                </Callout>
              </div>
            </div>
          </section>

          {/* Inversiones */}
          <section id="inversiones" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="arrow-up-right"
              title="Inversiones"
              subtitle="Seguimiento de FCI, plazos fijos y cauciones."
            />
            <div className="mt-6 grid sm:grid-cols-3 gap-4">
              <InvestmentCard type="FCI" name="Fondo Común" amount="$125.000" trend="+3.2%" />
              <InvestmentCard type="Plazo Fijo" name="30 días" amount="$50.000" trend="45%" />
              <InvestmentCard type="Caución" name="7 días" amount="$20.000" trend="38%" />
            </div>
            <p className="text-sm text-[var(--text-secondary)] mt-4">
              Los precios se actualizan automáticamente. Podés agregar inversiones manualmente o
              importar datos.
            </p>
          </section>

          {/* Configuración */}
          <section id="configuracion" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="settings"
              title="Configuración"
              subtitle="Personalizá tu experiencia."
            />
            <div className="mt-6 grid md:grid-cols-2 gap-6 items-start">
              <SettingsMockup />
              <div>
                <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="moon"
                      size={16}
                      className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Tema:</strong> claro u oscuro (se adapta a tu sistema)
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="lock"
                      size={16}
                      className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>MFA:</strong> autenticación de dos factores para mayor seguridad
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="sparkles"
                      size={16}
                      className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>IA:</strong> activá o desactivá la categorización automática
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="telegram"
                      size={16}
                      className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Resumen semanal:</strong> reportes por Telegram
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <SymbolicIcon
                      name="users"
                      size={16}
                      className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    />
                    <span>
                      <strong>Grupo familiar:</strong> compartí la cuenta con tu familia
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Privacidad */}
          <section id="privacidad" className="mb-14 scroll-mt-8">
            <SectionHeader
              icon="shield"
              title="Privacidad y seguridad"
              subtitle="Tus datos están protegidos."
            />
            <div className="mt-6">
              <div className="grid sm:grid-cols-2 gap-4">
                <SecurityCard
                  icon="lock"
                  title="Contraseñas encriptadas"
                  description="Usamos bcrypt, nunca almacenamos contraseñas en texto plano."
                />
                <SecurityCard
                  icon="key"
                  title="Sesiones JWT"
                  description="Tokens seguros que expiran automáticamente."
                />
                <SecurityCard
                  icon="eye"
                  title="Datos voluntarios"
                  description="Podés usar la app sin cargar ningún dato financiero."
                />
                <SecurityCard
                  icon="trash"
                  title="Eliminación total"
                  description="Eliminá tu cuenta y todos tus datos en cualquier momento."
                />
              </div>
              <Callout type="info" className="mt-4">
                <strong>Código abierto:</strong> Nuestro código está publicado en GitHub para que
                cualquiera pueda auditarlo.
              </Callout>
            </div>
          </section>

          {/* FAQ */}
          <section id="faq" className="mb-14 scroll-mt-8">
            <SectionHeader icon="bot" title="Preguntas frecuentes" subtitle="Resolvé tus dudas." />
            <div className="mt-6 space-y-3">
              <FaqItem
                question="¿Puedo usar Oikonomia desde el celular?"
                answer="Sí, la app web funciona perfectamente desde el celular. También tenés el bot de Telegram para registrar gastos rápido."
              />
              <FaqItem
                question="¿Necesito saber de finanzas?"
                answer="Para nada. La IA se encarga de categorizar y analizar; vos solo registrás los gastos."
              />
              <FaqItem
                question="¿Qué pasa si registro un gasto mal?"
                answer="Podés editarlo o eliminarlo desde la pestaña Gastos. Hacé click en el gasto para ver los detalles y modificarlo."
              />
              <FaqItem
                question="¿Puedo importar datos de mi banco?"
                answer="Sí, podés importar archivos CSV desde el botón de importación en la barra lateral. La app procesa el archivo y categoriza los gastos automáticamente."
              />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function SectionHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center flex-shrink-0">
        <SymbolicIcon name={icon} size={20} className="text-[var(--color-primary)]" />
      </div>
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)]">{title}</h2>
        <p className="text-sm text-[var(--text-secondary)]">{subtitle}</p>
      </div>
    </div>
  );
}

function StepCard({
  number,
  title,
  description,
}: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface)]">
      <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm mb-3">
        {number}
      </div>
      <h3 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function Callout({
  type,
  children,
  className = "",
}: {
  type: "tip" | "info" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    tip: "bg-[var(--gnome-green-1)]/15 border-[var(--gnome-green-4)]/30 text-[var(--gnome-green-5)]",
    info: "bg-[var(--gnome-blue-1)]/15 border-[var(--color-primary)]/30 text-[var(--text-primary)]",
    warning:
      "bg-[var(--gnome-yellow-1)]/15 border-[var(--gnome-yellow-4)]/30 text-[var(--text-primary)]",
  };
  const icons = { tip: "check" as const, info: "eye" as const, warning: "sparkles" as const };
  return (
    <div className={`p-4 rounded-xl border text-sm leading-relaxed ${styles[type]} ${className}`}>
      <div className="flex items-start gap-2">
        <SymbolicIcon name={icons[type]} size={16} className="mt-0.5 flex-shrink-0 opacity-70" />
        <div>{children}</div>
      </div>
    </div>
  );
}

function CodeExample({ message, label }: { message: string; label: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-base-alt)] p-3">
      <div className="text-[10px] text-[var(--text-secondary)] font-medium uppercase tracking-wide mb-1">
        {label}
      </div>
      <code className="text-sm text-[var(--text-primary)] font-mono">{message}</code>
    </div>
  );
}

function InfoCard({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)]">
      <SymbolicIcon name={icon} size={18} className="text-[var(--color-primary)] mb-2" />
      <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function MethodCard({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] text-center">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center mx-auto mb-2">
        <SymbolicIcon name={icon} size={20} className="text-[var(--color-primary)]" />
      </div>
      <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function SecurityCard({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--border-color)]">
      <div className="w-9 h-9 rounded-lg bg-[var(--gnome-green-1)]/20 flex items-center justify-center mb-2">
        <SymbolicIcon name={icon} size={18} className="text-[var(--gnome-green-5)]" />
      </div>
      <h4 className="font-semibold text-sm text-[var(--text-primary)] mb-1">{title}</h4>
      <p className="text-xs text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/20 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-sm text-[var(--text-primary)]">{question}</h3>
        <SymbolicIcon
          name="chevron"
          size={14}
          className={`text-[var(--text-secondary)] transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`}
        />
      </div>
      <div
        className={`overflow-hidden transition-all duration-300 ${open ? "max-h-40 mt-3" : "max-h-0"}`}
      >
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{answer}</p>
      </div>
    </button>
  );
}

function InvestmentCard({
  type,
  name,
  amount,
  trend,
}: {
  type: string;
  name: string;
  amount: string;
  trend: string;
}) {
  const isPositive = trend.startsWith("+") || trend.startsWith("4") || trend.startsWith("3");
  return (
    <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)]">
      <div className="text-[10px] text-[var(--text-secondary)] font-medium uppercase tracking-wide">
        {type}
      </div>
      <div className="font-semibold text-[var(--text-primary)] text-sm mt-1">{name}</div>
      <div className="flex items-center justify-between mt-2">
        <span className="font-bold text-[var(--text-primary)]">{amount}</span>
        <span
          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isPositive
              ? "bg-[var(--gnome-green-1)]/30 text-[var(--gnome-green-5)]"
              : "bg-[var(--gnome-red-1)]/30 text-[var(--gnome-red-3)]"
          }`}
        >
          {trend}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mockups                                                            */
/* ------------------------------------------------------------------ */

function ChatMockup() {
  return (
    <div className="bg-[#1a1a2e] rounded-2xl shadow-2xl p-4 border border-[#2a2a3e]">
      <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[#2a2a3e]">
        <div className="w-8 h-8 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xs">
          N
        </div>
        <div>
          <div className="text-white text-sm font-medium">NikoFin</div>
          <div className="text-[10px] text-[var(--gnome-green-3)]">● en línea</div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="flex justify-end">
          <div className="bg-[var(--color-primary)] rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
            <span className="text-white text-xs">mastercard galicia almacen 5999</span>
          </div>
        </div>
        <div className="flex justify-start">
          <div className="bg-[#2a2a3e] rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
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

function DashboardMockup() {
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] p-5 max-w-sm mx-auto">
      <div className="grid grid-cols-3 gap-2 mb-4">
        <MiniStat label="Gasto" value="$5.999" />
        <MiniStat label="Mes" value="$45.230" />
        <MiniStat label="Trans." value="28" />
      </div>
      <div className="space-y-2">
        <BarRow name="Alimentación" pct={41} color="bg-[var(--color-primary)]" value="$18.500" />
        <BarRow name="Transporte" pct={18} color="bg-[var(--gnome-blue-4)]" value="$8.200" />
        <BarRow name="Servicios" pct={15} color="bg-[var(--gnome-yellow-4)]" value="$6.800" />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-xl bg-[var(--color-base-alt)] text-center">
      <div className="text-[8px] text-[var(--text-secondary)] font-medium uppercase">{label}</div>
      <div className="text-xs font-bold text-[var(--text-primary)]">{value}</div>
    </div>
  );
}

function BarRow({
  name,
  pct,
  color,
  value,
}: {
  name: string;
  pct: number;
  color: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-[var(--text-secondary)]">{name}</span>
      <div className="flex items-center gap-2">
        <div className="w-16 h-1.5 rounded-full bg-[var(--color-base-alt)] overflow-hidden">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[var(--text-primary)] font-medium w-12 text-right">{value}</span>
      </div>
    </div>
  );
}

function CardMockup() {
  return (
    <div className="bg-gradient-to-br from-[var(--gnome-blue-5)] to-[var(--gnome-blue-7)] rounded-2xl p-5 text-white shadow-xl max-w-xs mx-auto">
      <div className="flex items-center justify-between mb-6">
        <span className="text-xs font-medium opacity-70">CRÉDITO</span>
        <span className="text-xs font-medium opacity-70">VISA</span>
      </div>
      <div className="text-lg font-mono tracking-wider mb-4">•••• •••• •••• 4521</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] opacity-60 uppercase">Titular</div>
          <div className="text-sm font-medium">Juan Pérez</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] opacity-60 uppercase">Banco</div>
          <div className="text-sm font-medium">Galicia</div>
        </div>
      </div>
    </div>
  );
}

function ExpenseListMockup() {
  const expenses = [
    { desc: "Almacén", cat: "Alimentación", amount: "$5.999", color: "bg-[var(--color-primary)]" },
    { desc: "Uber", cat: "Transporte", amount: "$2.300", color: "bg-[var(--gnome-blue-4)]" },
    { desc: "Netflix", cat: "Servicios", amount: "$3.800", color: "bg-[var(--gnome-yellow-4)]" },
  ];
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden max-w-sm mx-auto">
      {expenses.map((e, i) => (
        <div
          key={i}
          className={`flex items-center justify-between p-4 ${i < expenses.length - 1 ? "border-b border-[var(--border-color)]" : ""}`}
        >
          <div className="flex items-center gap-3">
            <div className={`w-2 h-8 rounded-full ${e.color}`} />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">{e.desc}</div>
              <div className="text-[10px] text-[var(--text-secondary)]">{e.cat}</div>
            </div>
          </div>
          <span className="text-sm font-bold text-[var(--text-primary)]">{e.amount}</span>
        </div>
      ))}
    </div>
  );
}

function ChartMockup() {
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] p-5 max-w-xs mx-auto">
      <div className="text-sm font-semibold text-[var(--text-primary)] mb-4">Resumen mensual</div>
      <div className="flex items-center gap-4 mb-4">
        <div className="relative w-16 h-16 flex-shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="var(--color-base-alt)"
              strokeWidth="5"
            />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="5"
              strokeDasharray="66 88"
              strokeDashoffset="0"
            />
            <circle
              cx="18"
              cy="18"
              r="14"
              fill="none"
              stroke="var(--gnome-blue-4)"
              strokeWidth="5"
              strokeDasharray="22 88"
              strokeDashoffset="-66"
            />
          </svg>
        </div>
        <div className="flex-1 space-y-1.5">
          <LegendDot color="bg-[var(--color-primary)]" name="Alimentación" pct={38} />
          <LegendDot color="bg-[var(--gnome-blue-4)]" name="Transporte" pct={18} />
          <LegendDot color="bg-[var(--gnome-yellow-4)]" name="Servicios" pct={15} />
        </div>
      </div>
      <div className="h-20 bg-[var(--color-base-alt)] rounded-lg p-2 flex items-end gap-1">
        {[30, 45, 35, 55, 40, 60, 50, 65, 45, 70, 55, 80].map((h, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${h}%`,
              backgroundColor: i >= 9 ? "var(--color-primary)" : "var(--color-base)",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function LegendDot({ color, name, pct }: { color: string; name: string; pct: number }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5">
        <div className={`w-2 h-2 rounded-full ${color}`} />
        <span className="text-[var(--text-secondary)]">{name}</span>
      </div>
      <span className="text-[var(--text-primary)] font-medium">{pct}%</span>
    </div>
  );
}

function SettingsMockup() {
  const toggles = [
    { label: "Tema oscuro", checked: false },
    { label: "MFA activado", checked: true },
    { label: "Categorización IA", checked: true },
    { label: "Resumen semanal", checked: false },
  ];
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden max-w-xs mx-auto">
      {toggles.map((t, i) => (
        <div
          key={i}
          className={`flex items-center justify-between p-4 ${i < toggles.length - 1 ? "border-b border-[var(--border-color)]" : ""}`}
        >
          <span className="text-sm text-[var(--text-primary)]">{t.label}</span>
          <div
            className={`w-9 h-5 rounded-full relative transition-colors ${t.checked ? "bg-[var(--color-primary)]" : "bg-[var(--color-base-alt)]"}`}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${t.checked ? "left-[18px]" : "left-0.5"}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
