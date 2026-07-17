import { useEffect, useState } from "react";
import SymbolicIcon from "../components/SymbolicIcon";
import useReveal from "../hooks/useReveal";

const TELEGRAM_DEMOS = [
  {
    user: "mastercard galicia almacen 5999",
    reply:
      "✅ ¡Listo! Guardé el gasto.\n\n💰 $5.999\n💳 Galicia Mastercard\n📅 12 de julio de 2026\n\n🍽️ Alimentación\n└ 📂 Almacén/Kiosco",
  },
  {
    user: "visa santander cuotas 3 supermercado 12000",
    reply:
      "✅ ¡Listo! Guardé el gasto.\n\n💰 $12.000 (3 cuotas de $4.000)\n💳 Santander Visa\n📅 12 de julio de 2026\n\n🛒 Supermercado\n└ 📂 Compras del hogar",
  },
  {
    user: "🏦 Notificación detectada",
    reply:
      "🔍 Detecté una notificación de tu banco.\n\n💰 $3.200\n💳 Galicia Mastercard\n📅 12 de julio de 2026\n\n☕ Café y snacks\n└ 📂 Café/Bar",
  },
];

export default function LandingPage() {
  const hero = useReveal();
  const features = useReveal(0.1);
  const steps = useReveal(0.1);
  const reporting = useReveal(0.1);
  const openSource = useReveal(0.1);
  const security = useReveal(0.1);
  const faq = useReveal(0.1);
  const cta = useReveal(0.1);

  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      {/* Hero */}
      <section className="relative overflow-hidden py-16 md:py-32 px-4">
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div
              ref={hero.ref}
              className={`transition-all duration-700 ${hero.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--gnome-blue-1)]/30 text-[var(--color-primary)] text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                Planeamiento financiero con IA
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[var(--text-primary)] tracking-tight mb-6 leading-[1.1]">
                Organizá tus finanzas
                <span className="text-[var(--color-primary)]">
                  {" "}
                  sin esfuerzo
                </span>
              </h1>
              <p className="text-lg text-[var(--text-secondary)] mb-8 leading-relaxed max-w-lg">
                Registra gastos con un mensaje, analizá tus hábitos y tomá
                mejores decisiones. Todo con inteligencia artificial y desde tu
                celular.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <a
                  href="https://platform.oikonomia.ar/register"
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl bg-[var(--color-primary)] text-white font-semibold hover:brightness-110 transition shadow-lg shadow-[var(--color-primary)]/25"
                >
                  Comenzá gratis
                </a>
                <a
                  href="https://platform.oikonomia.ar/login"
                  className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl border-2 border-[var(--border-color)] text-[var(--text-primary)] font-semibold hover:bg-[var(--color-base-alt)] transition"
                >
                  Ya tengo cuenta
                </a>
              </div>
              <div className="flex items-center gap-6 mt-8 text-sm text-[var(--text-secondary)]">
                <span className="flex items-center gap-1.5">
                  <SymbolicIcon
                    name="check"
                    size={14}
                    className="text-[var(--gnome-green-5)]"
                  />
                  Sin tarjeta de crédito
                </span>
                <span className="flex items-center gap-1.5">
                  <SymbolicIcon
                    name="check"
                    size={14}
                    className="text-[var(--gnome-green-5)]"
                  />
                  Datos seguros
                </span>
              </div>
            </div>
            <div
              ref={hero.ref}
              className={`transition-all duration-700 delay-200 ${hero.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
            >
              <AppWindowMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Por qué oikonomia */}
      <section className="py-12 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div
            ref={features.ref}
            className={`text-center mb-14 transition-all duration-700 ${features.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
          >
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              ¿Por qué Oikonomia?
            </h2>
            <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
              Herramientas diseñadas para que tomes el control de tus finanzas
              personales.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            <FeatureCard
              icon="sparkles"
              title="Categorización con IA"
              description="Mandá un mensaje por Telegram y la inteligencia artificial categoriza tu gasto automáticamente."
            />
            <FeatureCard
              icon="chart-bar"
              title="Reportes inteligentes"
              description="Análisis mensual con tendencias, proyecciones y comparativas para saber a dónde va tu dinero."
            />
            <FeatureCard
              icon="card"
              title="Tarjetas y cuentas"
              description="Organizá todas tus tarjetas de crédito, débito y cuentas bancarias en un solo lugar."
            />
            <FeatureCard
              icon="bank"
              title="Inversiones"
              description="Seguimiento de FCI, plazos fijos y cauciones con actualización de precios en tiempo real."
            />
            <FeatureCard
              icon="bot"
              title="Bot de Telegram"
              description="Registrá gastos desde Telegram como le contarías a un amigo. Sin formularios, sin complicaciones."
            />
            <FeatureCard
              icon="shield"
              title="Privacidad primero"
              description="Código abierto, sin tracking ni analytics. Tus datos son 100% tuyos y voluntarios."
            />
          </div>
        </div>
      </section>

      {/* Cómo registrar tus gastos */}
      <section className="py-16 md:py-24 px-4 bg-[var(--color-base-alt)]">
        <div className="max-w-5xl mx-auto">
          <div
            ref={steps.ref}
            className={`text-center mb-14 transition-all duration-700 ${steps.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
          >
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              ¿Cómo registrar tus gastos?
            </h2>
            <p className="text-lg text-[var(--text-secondary)]">
              Dos formas, una preferida.
            </p>
          </div>
          <div
            ref={steps.ref}
            className={`grid md:grid-cols-2 gap-6 md:gap-8 items-stretch transition-all duration-700 delay-200 ${steps.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
          >
            <MethodCard
              icon="settings"
              title="Desde la web"
              description="Cargá gastos desde el formulario con categoría, tarjeta y notas. Ideal para gastos detallados."
            >
              <ExpenseFormMockup />
            </MethodCard>
            <MethodCard
              icon="bot"
              title="Desde Telegram"
              description="Escribile al bot como le contarías a un amigo. La IA categoriza y el bot confirma al instante."
              highlight
            >
              <TelegramCarousel />
            </MethodCard>
          </div>
        </div>
      </section>

      {/* Reportes */}
      <section className="py-12 md:py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div
              ref={reporting.ref}
              className={`transition-all duration-700 ${reporting.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
            >
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
                Reportes que te ayudan a decidir
              </h2>
              <p className="text-lg text-[var(--text-secondary)] mb-6 leading-relaxed">
                Visualizá tus gastos por categoría, mes y tarjeta. Analizá
                tendencias y compará meses anteriores para saber exactamente a
                dónde va tu dinero.
              </p>
              <ul className="space-y-3 text-[var(--text-secondary)]">
                <li className="flex items-start gap-3">
                  <SymbolicIcon
                    name="chart-bar"
                    size={18}
                    className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                  />
                  <span>Gráficos de gastos por categoría y mes</span>
                </li>
                <li className="flex items-start gap-3">
                  <SymbolicIcon
                    name="chart-donut"
                    size={18}
                    className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                  />
                  <span>Tendencias y proyecciones de gasto</span>
                </li>
                <li className="flex items-start gap-3">
                  <SymbolicIcon
                    name="sparkles"
                    size={18}
                    className="text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                  />
                  <span>Reportes mensuales con análisis de IA</span>
                </li>
              </ul>
            </div>
            <div
              ref={reporting.ref}
              className={`transition-all duration-700 delay-200 ${reporting.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
            >
              <ReportMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Código abierto */}
      <section className="py-16 md:py-24 px-4 bg-[var(--color-base-alt)]">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-10 md:gap-16 items-center">
            <div
              ref={openSource.ref}
              className={`transition-all duration-700 ${openSource.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} md:order-last`}
            >
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
                Código abierto y auditable
              </h2>
              <p className="text-lg text-[var(--text-secondary)] mb-6 leading-relaxed">
                Nuestro código está publicado en GitHub. Cualquiera puede
                auditar cómo procesamos tus datos, qué algoritmos usamos y cómo
                protegemos tu información.
              </p>
              <a
                href="https://github.com/cheloim/perExp"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border-2 border-[var(--border-color)] text-[var(--text-primary)] font-semibold hover:bg-[var(--color-base-alt)] transition"
              >
                <SymbolicIcon name="github" size={18} />
                Ver código fuente en GitHub
              </a>
            </div>
            <div
              ref={openSource.ref}
              className={`transition-all duration-700 delay-200 ${openSource.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"} md:order-first`}
            >
              <AboutWindowMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Seguridad */}
      <section className="py-12 md:py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div
            ref={security.ref}
            className={`transition-all duration-700 ${security.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
          >
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Tus datos están seguros
            </h2>
            <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto mb-10">
              Cifrado de extremo a extremo, servidores seguros y control total
              sobre tus datos.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              <SecurityItem
                icon="lock"
                title="Cifrado"
                description="Tus contraseñas están encriptadas con bcrypt. Las sesiones usan JWT."
              />
              <SecurityItem
                icon="eye"
                title="Privacidad"
                description="Datos financieros 100% voluntarios. Usá la app sin cargar ningún dato."
              />
              <SecurityItem
                icon="trash"
                title="Eliminación"
                description="Eliminá tu cuenta y todos tus datos en cualquier momento."
              />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 md:py-24 px-4 bg-[var(--color-base-alt)]">
        <div
          ref={faq.ref}
          className={`max-w-3xl mx-auto transition-all duration-700 ${faq.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <h2 className="text-3xl font-bold text-[var(--text-primary)] text-center mb-12">
            Preguntas frecuentes
          </h2>
          <div className="space-y-3">
            <FaqItem
              question="¿Es gratis?"
              answer="Sí, Oikonomia es completamente gratis. No hay planes premium ni funciones bloqueadas."
            />
            <FaqItem
              question="¿Mis datos están seguros?"
              answer="Sí. Tus contraseñas están encriptadas, las sesiones usan JWT y podés eliminar tu cuenta en cualquier momento. Los datos financieros son 100% voluntarios."
            />
            <FaqItem
              question="¿Necesito saber de finanzas?"
              answer="Para nada. La IA se encarga de categorizar y analizar; vos solo registrás los gastos."
            />
            <FaqItem
              question="¿Puedo usarlo desde el celular?"
              answer="Sí, la app web funciona perfectamente desde el celular. También tenés el bot de Telegram para registrar gastos rápido."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-24 px-4">
        <div
          ref={cta.ref}
          className={`max-w-2xl mx-auto text-center transition-all duration-700 ${cta.visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
            ¿Listo para tomar el control?
          </h2>
          <p className="text-lg text-[var(--text-secondary)] mb-8">
            Uní miles de personas que ya están organizando sus finanzas con
            Oikonomia.
          </p>
          <a
            href="https://platform.oikonomia.ar/register"
            className="inline-flex items-center justify-center px-10 py-4 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-lg hover:brightness-110 transition shadow-lg shadow-[var(--color-primary)]/25"
          >
            Empezá ahora — es gratis
          </a>
          <p className="mt-4 text-sm text-[var(--text-secondary)]">
            ¿Tenés dudas?{" "}
            <a
              href="/guide"
              className="text-[var(--color-primary)] hover:underline font-medium"
            >
              Mirá la guía de usuario
            </a>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-4 border-t border-[var(--border-color)]">
        <div className="max-w-4xl mx-auto">
          <div className="grid sm:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm">
                  O
                </div>
                <span className="font-semibold text-[var(--text-primary)]">
                  Oikonomia
                </span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                Tu planificador financiero personal con inteligencia artificial.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-3">
                Producto
              </h4>
              <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                <li>
                  <a
                    href="https://platform.oikonomia.ar"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Plataforma
                  </a>
                </li>
                <li>
                  <a
                    href="/guide"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Guía de usuario
                  </a>
                </li>
                <li>
                  <a
                    href="https://platform.oikonomia.ar/login"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Iniciar sesión
                  </a>
                </li>
                <li>
                  <a
                    href="https://platform.oikonomia.ar/register"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Registrarse
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-3">
                Legal
              </h4>
              <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                <li>
                  <a
                    href="/privacy"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Política de Privacidad
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:contacto@oikonomia.ar"
                    className="hover:text-[var(--text-primary)] transition"
                  >
                    Contacto
                  </a>
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-[var(--border-color)] text-center text-sm text-[var(--text-secondary)]">
            © {new Date().getFullYear()} Oikonomia. Todos los derechos
            reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mockups & subcomponents                                           */
/* ------------------------------------------------------------------ */

function AppWindowMockup() {
  return (
    <div className="relative">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden max-w-sm mx-auto">
        {/* Headerbar — libadwaita style */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)]">
          <div className="w-3 h-3 rounded-full bg-[var(--color-danger)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--gnome-yellow-4)]" />
          <div className="w-3 h-3 rounded-full bg-[var(--gnome-green-4)]" />
          <span
            className="ml-2 text-xs font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            Oikonomia
          </span>
        </div>
        {/* Content */}
        <div className="p-3 space-y-3">
          {/* KPI Row - matches real Dashboard layout */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl border border-[var(--border-color)]">
              <p
                className="text-[8px] uppercase tracking-wider mb-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Total gastado
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: "var(--color-primary)" }}
              >
                $187.450
              </p>
              <p
                className="text-[9px] mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                42 transacciones
              </p>
            </div>
            <div className="p-2.5 rounded-xl border border-[var(--border-color)]">
              <p
                className="text-[8px] uppercase tracking-wider mb-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Deuda tarjetas
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: "var(--color-danger)" }}
              >
                $321.800
              </p>
              <p
                className="text-[9px] mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                8 cuotas pendientes
              </p>
            </div>
            <div className="p-2.5 rounded-xl border border-[var(--border-color)]">
              <p
                className="text-[8px] uppercase tracking-wider mb-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Cuotas este mes
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: "var(--color-primary)" }}
              >
                $54.200
              </p>
              <p
                className="text-[9px] mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                6 cuotas
              </p>
            </div>
            <div className="p-2.5 rounded-xl border border-[var(--border-color)]">
              <p
                className="text-[8px] uppercase tracking-wider mb-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                vs Mes anterior
              </p>
              <p
                className="text-sm font-bold"
                style={{ color: "var(--gnome-green-5)" }}
              >
                ↓ 12.3%
              </p>
              <p
                className="text-[9px] mt-0.5"
                style={{ color: "var(--text-secondary)" }}
              >
                Gastaste menos
              </p>
            </div>
          </div>
          {/* Category section - matches real "Gastos por Categoría" */}
          <div className="rounded-xl border border-[var(--border-color)] p-2.5">
            <p
              className="text-[10px] font-semibold mb-2"
              style={{ color: "var(--color-primary)" }}
            >
              Gastos por Categoría
            </p>
            <div className="flex gap-3">
              {/* Mini donut */}
              <div className="flex-shrink-0">
                <svg
                  width="64"
                  height="64"
                  viewBox="0 0 36 36"
                  className="-rotate-90"
                >
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
                    strokeDasharray="33.17 87.96"
                    strokeDashoffset="0"
                    className="origin-center animate-donut-draw"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="var(--gnome-blue-4)"
                    strokeWidth="5"
                    strokeDasharray="22.59 87.96"
                    strokeDashoffset="-33.17"
                    className="origin-center animate-donut-draw delay-200"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="var(--gnome-yellow-4)"
                    strokeWidth="5"
                    strokeDasharray="15.83 87.96"
                    strokeDashoffset="-55.76"
                    className="origin-center animate-donut-draw delay-300"
                  />
                  <circle
                    cx="18"
                    cy="18"
                    r="14"
                    fill="none"
                    stroke="var(--gnome-gray-2)"
                    strokeWidth="5"
                    strokeDasharray="16.37 87.96"
                    strokeDashoffset="-71.59"
                    className="origin-center animate-donut-draw delay-300"
                  />
                </svg>
              </div>
              {/* Category bars */}
              <div className="flex-1 space-y-1.5">
                {[
                  {
                    name: "Alimentación",
                    pct: 38,
                    color: "var(--color-primary)",
                    amt: "$71.230",
                    var: "↓5%",
                    varColor: "var(--gnome-green-5)",
                  },
                  {
                    name: "Transporte",
                    pct: 18,
                    color: "var(--gnome-blue-4)",
                    amt: "$33.740",
                    var: "↑12%",
                    varColor: "var(--color-danger)",
                  },
                  {
                    name: "Servicios",
                    pct: 15,
                    color: "var(--gnome-yellow-4)",
                    amt: "$28.120",
                    var: "→0%",
                    varColor: "var(--text-secondary)",
                  },
                  {
                    name: "Salud",
                    pct: 12,
                    color: "var(--gnome-green-4)",
                    amt: "$22.490",
                    var: "↓8%",
                    varColor: "var(--gnome-green-5)",
                  },
                ].map((cat) => (
                  <div key={cat.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span
                          className="text-[9px] font-medium"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {cat.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[8px] font-medium"
                          style={{ color: cat.varColor }}
                        >
                          {cat.var}
                        </span>
                        <span
                          className="text-[9px] font-semibold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {cat.amt}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full animate-bar-grow"
                        style={{
                          width: `${cat.pct}%`,
                          backgroundColor: cat.color,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportMockup() {
  return (
    <div className="relative">
      <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] p-4 max-w-sm mx-auto">
        {/* Header — matches real Dashboard card header */}
        <div className="flex items-center justify-between mb-3">
          <p
            className="text-sm font-semibold"
            style={{ color: "var(--color-primary)" }}
          >
            Gastos por Categoría
          </p>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Ver detalle →
          </span>
        </div>
        {/* Two-column layout: donut + bars — matches real Dashboard */}
        <div className="grid grid-cols-2 gap-3">
          {/* Donut chart */}
          <div className="flex items-center justify-center">
            <svg
              width="100"
              height="100"
              viewBox="0 0 36 36"
              className="-rotate-90"
            >
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
                strokeDasharray="33.17 87.96"
                strokeDashoffset="0"
                className="origin-center animate-donut-draw"
              />
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="var(--gnome-blue-4)"
                strokeWidth="5"
                strokeDasharray="22.59 87.96"
                strokeDashoffset="-33.17"
                className="origin-center animate-donut-draw delay-200"
              />
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="var(--gnome-yellow-4)"
                strokeWidth="5"
                strokeDasharray="15.83 87.96"
                strokeDashoffset="-55.76"
                className="origin-center animate-donut-draw delay-300"
              />
              <circle
                cx="18"
                cy="18"
                r="14"
                fill="none"
                stroke="var(--gnome-green-4)"
                strokeWidth="5"
                strokeDasharray="10.08 87.96"
                strokeDashoffset="-71.59"
                className="origin-center animate-donut-draw delay-300"
              />
            </svg>
          </div>
          {/* Category bars — matches real Dashboard bars */}
          <div className="space-y-1.5">
            {[
              {
                name: "Alimentación",
                pct: 38,
                color: "var(--color-primary)",
                amt: "$71.230",
                var: "↓5%",
                varColor: "var(--gnome-green-5)",
              },
              {
                name: "Transporte",
                pct: 18,
                color: "var(--gnome-blue-4)",
                amt: "$33.740",
                var: "↑12%",
                varColor: "var(--color-danger)",
              },
              {
                name: "Servicios",
                pct: 15,
                color: "var(--gnome-yellow-4)",
                amt: "$28.120",
                var: "→0%",
                varColor: "var(--text-secondary)",
              },
              {
                name: "Salud",
                pct: 12,
                color: "var(--gnome-green-4)",
                amt: "$22.490",
                var: "↓8%",
                varColor: "var(--gnome-green-5)",
              },
              {
                name: "Otros",
                pct: 17,
                color: "var(--gnome-gray-2)",
                amt: "$31.870",
                var: "",
                varColor: "",
              },
            ].map((cat) => (
              <div
                key={cat.name}
                className="rounded-lg p-1.5 hover:bg-[var(--color-base-alt)] transition-colors cursor-pointer"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                    <span
                      className="text-[9px] font-medium"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {cat.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {cat.var && (
                      <span
                        className="text-[8px] font-medium"
                        style={{ color: cat.varColor }}
                      >
                        {cat.var}
                      </span>
                    )}
                    <span
                      className="text-[9px] font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {cat.amt}
                    </span>
                  </div>
                </div>
                <div className="h-1.5 bg-[var(--color-base-alt)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full animate-bar-grow"
                    style={{ width: `${cat.pct}%`, backgroundColor: cat.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function TelegramCarousel() {
  const [active, setActive] = useState(0);
  const [typing, setTyping] = useState(true);
  const [userText, setUserText] = useState("");
  const [showReply, setShowReply] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyping(false);
      setUserText(TELEGRAM_DEMOS[0].user);
      setShowReply(true);
      return;
    }

    const demo = TELEGRAM_DEMOS[active];
    setUserText("");
    setShowReply(false);
    setTyping(true);

    let i = 0;
    const typeInterval = setInterval(() => {
      i++;
      setUserText(demo.user.slice(0, i));
      if (i >= demo.user.length) {
        clearInterval(typeInterval);
        setTimeout(() => {
          setShowReply(true);
          setTyping(false);
        }, 400);
      }
    }, 35);

    const nextTimeout = setTimeout(() => {
      setActive((prev) => (prev + 1) % TELEGRAM_DEMOS.length);
    }, 6000);

    return () => {
      clearInterval(typeInterval);
      clearTimeout(nextTimeout);
    };
  }, [active]);

  return (
    <div className="max-w-xs mx-auto">
      <div className="bg-[var(--gnome-gray-5)] rounded-2xl shadow-2xl p-4 border border-[var(--gnome-gray-4)]">
        <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[var(--gnome-gray-4)]">
          <div className="w-9 h-9 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm">
            N
          </div>
          <div>
            <div className="text-white text-sm font-medium">NikoFin</div>
            <div className="text-[10px] text-[var(--gnome-green-2)]">
              ● en línea
            </div>
          </div>
        </div>
        <div className="space-y-3 min-h-[140px]">
          <div className="flex justify-end">
            <div className="bg-[var(--color-primary)] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%]">
              <span className="text-white text-sm">
                {userText}
                {typing && (
                  <span className="inline-block w-0.5 h-4 bg-white ml-0.5 animate-blink align-text-bottom" />
                )}
              </span>
            </div>
          </div>
          {showReply && (
            <div className="flex justify-start animate-fade-in">
              <div className="bg-[var(--gnome-gray-4)] rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
                <div className="text-white text-sm leading-relaxed whitespace-pre-line">
                  {TELEGRAM_DEMOS[active].reply}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-center gap-1.5 mt-4">
          {TELEGRAM_DEMOS.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${i === active ? "bg-[var(--color-primary)] w-5" : "bg-[var(--gnome-gray-3)]"}`}
              aria-label={`Demo ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutWindowMockup() {
  return (
    <div className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] overflow-hidden max-w-sm mx-auto">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border-color)]">
        <div className="w-3 h-3 rounded-full bg-[var(--color-danger)]" />
        <div className="w-3 h-3 rounded-full bg-[var(--gnome-yellow-4)]" />
        <div className="w-3 h-3 rounded-full bg-[var(--gnome-green-4)]" />
      </div>
      <div className="p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-2xl mx-auto mb-4">
          O
        </div>
        <div className="text-lg font-bold text-[var(--text-primary)]">
          Oikonomia
        </div>
        <div className="text-xs text-[var(--text-primary)] mb-4">
          Versión 1.0 · GPLv3
        </div>
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex items-center justify-center gap-2">
            <SymbolicIcon
              name="check"
              size={14}
              className="text-[var(--gnome-green-5)]"
            />
            <span>Código abierto y revisable</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <SymbolicIcon
              name="check"
              size={14}
              className="text-[var(--gnome-green-5)]"
            />
            <span>Sin tracking ni analytics</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <SymbolicIcon
              name="check"
              size={14}
              className="text-[var(--gnome-green-5)]"
            />
            <span>Datos 100% voluntarios</span>
          </div>
          <div className="flex items-center justify-center gap-2">
            <SymbolicIcon
              name="check"
              size={14}
              className="text-[var(--gnome-green-5)]"
            />
            <span>Eliminación en cualquier momento</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
}) {
  return (
    <div className="p-5 rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:shadow-md hover:border-[var(--color-primary)]/20 transition-all duration-200">
      <div className="w-10 h-10 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center mb-3">
        <SymbolicIcon
          name={icon}
          size={20}
          className="text-[var(--color-primary)]"
        />
      </div>
      <h3
        className="text-base font-bold mb-1.5"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h3>
      <p
        className="text-sm leading-relaxed"
        style={{ color: "var(--text-secondary)" }}
      >
        {description}
      </p>
    </div>
  );
}

function MethodCard({
  icon,
  title,
  description,
  highlight,
  children,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`relative flex flex-col p-6 rounded-2xl border transition-all duration-200 ${
        highlight
          ? "border-[var(--color-primary)]/30 bg-[var(--color-surface)] shadow-lg shadow-[var(--color-primary)]/5"
          : "border-[var(--border-color)] bg-[var(--color-surface)]"
      }`}
    >
      {highlight && (
        <div className="absolute -top-3 left-6 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-primary)] text-white text-xs font-semibold shadow-md">
          <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          Más fácil
        </div>
      )}
      <div className="flex items-start gap-4 mb-4">
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
            highlight
              ? "bg-[var(--color-primary)]/15"
              : "bg-[var(--color-base-alt)]"
          }`}
        >
          <SymbolicIcon
            name={icon}
            size={22}
            className={
              highlight
                ? "text-[var(--color-primary)]"
                : "text-[var(--text-secondary)]"
            }
          />
        </div>
        <div>
          <h3
            className="text-lg font-bold mb-1"
            style={{ color: "var(--text-primary)" }}
          >
            {title}
          </h3>
          <p
            className="text-sm leading-relaxed"
            style={{ color: "var(--text-secondary)" }}
          >
            {description}
          </p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center mt-2">
        {children}
      </div>
    </div>
  );
}

function ExpenseFormMockup() {
  return (
    <div className="w-full max-w-[280px] mx-auto">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-lg border border-[var(--border-color)] overflow-hidden">
        {/* Titlebar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[var(--color-danger)]" />
            <div className="w-2 h-2 rounded-full bg-[var(--gnome-yellow-4)]" />
            <div className="w-2 h-2 rounded-full bg-[var(--gnome-green-4)]" />
          </div>
          <span className="text-[10px] font-medium text-[var(--text-secondary)]">
            Nuevo gasto
          </span>
          <span className="text-[10px] text-[var(--text-secondary)]">✕</span>
        </div>
        {/* Form content */}
        <div className="p-3 space-y-2.5">
          {/* Payment toggle */}
          <div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
              Medio de pago
            </div>
            <div className="flex rounded-md border border-[var(--border-color)] overflow-hidden">
              <div className="flex-1 text-center py-1.5 text-[10px] font-medium bg-[var(--color-primary)] text-white">
                💳 Tarjeta
              </div>
              <div className="flex-1 text-center py-1.5 text-[10px] text-[var(--text-secondary)] bg-[var(--color-base-alt)]">
                💵 Efectivo
              </div>
            </div>
          </div>
          {/* Date */}
          <div>
            <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
              Fecha <span className="text-[var(--color-danger)]">*</span>
            </div>
            <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center">
              <span className="text-[10px] text-[var(--text-secondary)]">
                16/07/2026
              </span>
            </div>
          </div>
          {/* Amount + Currency */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="col-span-2">
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Monto <span className="text-[var(--color-danger)]">*</span>
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center">
                <span className="text-[10px] text-[var(--text-primary)] font-medium">
                  15.200
                </span>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Moneda
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-primary)]">
                  ARS $
                </span>
                <span className="text-[8px] text-[var(--text-secondary)]">
                  ▾
                </span>
              </div>
            </div>
          </div>
          {/* Description + Category */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Descripción{" "}
                <span className="text-[var(--color-danger)]">*</span>
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center">
                <span className="text-[10px] text-[var(--text-primary)]">
                  Supermercado Coto
                </span>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Categoría
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-primary)]">
                  Alimentación
                </span>
                <span className="text-[8px] text-[var(--text-secondary)]">
                  ▾
                </span>
              </div>
            </div>
          </div>
          {/* Bank + Card */}
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Banco
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-primary)]">
                  Galicia
                </span>
                <span className="text-[8px] text-[var(--text-secondary)]">
                  ▾
                </span>
              </div>
            </div>
            <div>
              <div className="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider mb-1">
                Tarjeta
              </div>
              <div className="w-full h-7 rounded-md border border-[var(--border-color)] bg-[var(--color-base-alt)] px-2 flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-primary)]">
                  Visa
                </span>
                <span className="text-[8px] text-[var(--text-secondary)]">
                  ▾
                </span>
              </div>
            </div>
          </div>
          {/* Buttons */}
          <div className="flex gap-1.5 pt-1">
            <div className="flex-1 h-7 rounded-md border border-[var(--border-color)] flex items-center justify-center">
              <span className="text-[10px] text-[var(--text-secondary)]">
                Cancelar
              </span>
            </div>
            <div className="flex-1 h-7 rounded-md bg-[var(--color-primary)] flex items-center justify-center">
              <span className="text-[10px] text-white font-medium">
                Guardar
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SecurityItem({
  icon,
  title,
  description,
}: {
  icon: React.ComponentProps<typeof SymbolicIcon>["name"];
  title: string;
  description: string;
}) {
  return (
    <div className="p-5 rounded-2xl bg-[var(--color-surface)] border border-[var(--border-color)]">
      <div className="w-10 h-10 rounded-xl bg-[var(--gnome-green-1)]/20 flex items-center justify-center mb-3">
        <SymbolicIcon
          name={icon}
          size={20}
          className="text-[var(--gnome-green-5)]"
        />
      </div>
      <h4
        className="font-semibold mb-1"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h4>
      <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
        {description}
      </p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left p-5 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:border-[var(--color-primary)]/20 transition-colors"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--text-primary)]">{question}</h3>
        <SymbolicIcon
          name="chevron"
          size={16}
          className={`text-[var(--text-secondary)] transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`}
        />
      </div>
      <div
        className={`overflow-hidden transition-all duration-300 ${open ? "max-h-40 mt-3" : "max-h-0"}`}
      >
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
          {answer}
        </p>
      </div>
    </button>
  );
}
