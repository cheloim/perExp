export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      {/* Hero */}
      <section className="relative overflow-hidden py-20 md:py-32 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/8 via-transparent to-[var(--color-primary)]/3 pointer-events-none animate-gradient" />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="animate-fade-in-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-primary)] animate-pulse" />
                Planeamiento financiero con IA
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-[var(--text-primary)] tracking-tight mb-6 leading-tight">
                Organizá tus finanzas
                <span className="text-[var(--color-primary)]"> sin esfuerzo</span>
              </h1>
              <p className="text-lg text-[var(--text-secondary)] mb-8 leading-relaxed max-w-lg">
                Registra gastos con un mensaje, analiza tus hábitos y toma mejores decisiones. Todo
                con inteligencia artificial y desde tu celular.
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
              <div className="flex items-center gap-6 mt-8 text-sm text-[var(--text-tertiary)]">
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Sin tarjeta de crédito
                </div>
                <div className="flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Datos seguros
                </div>
              </div>
            </div>

            {/* Dashboard Mockup */}
            <div className="animate-fade-in-up delay-300 hidden md:block">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Todo lo que necesitás
            </h2>
            <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
              Herramientas diseñadas para que tomes el control de tus finanzas personales.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <FeatureCard
              icon="🤖"
              title="Categorización con IA"
              description="Mandale un mensaje por Telegram y la inteligencia artificial categoriza tu gasto automáticamente. Sin formularios, sin complicaciones."
              delay="delay-100"
            />
            <FeatureCard
              icon="📊"
              title="Reportes inteligentes"
              description="Análisis mensual con tendencias, proyecciones y comparativas. Sabés exactamente a dónde va tu dinero."
              delay="delay-200"
            />
            <FeatureCard
              icon="💳"
              title="Tarjetas y cuentas"
              description="Organizá todas tus tarjetas de crédito, débito y cuentas bancarias en un solo lugar."
              delay="delay-300"
            />
            <FeatureCard
              icon="🏦"
              title="Inversiones"
              description="Seguimiento de FCI, plazos fijos y cauciones con actualización de precios en tiempo real."
              delay="delay-400"
            />
          </div>
        </div>
      </section>

      {/* How it works - with Telegram mockup */}
      <section className="py-20 px-4 bg-[var(--color-base-alt)]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              ¿Cómo funciona?
            </h2>
            <p className="text-lg text-[var(--text-secondary)]">
              Tres pasos simples para empezar a controlar tus finanzas.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <Step
                number={1}
                title="Registrate"
                description="Creá tu cuenta en segundos con tu email o Google. Sin tarjeta de crédito, sin compromiso."
                delay="delay-100"
              />
              <Step
                number={2}
                title="Mandá un mensaje"
                description="Escribile al bot de Telegram como le contarías a un amigo. La IA hace el resto."
                delay="delay-300"
              />
              <Step
                number={3}
                title="Analizá y ahorrá"
                description="Revisá reportes, tendencias y proyecciones para tomar mejores decisiones."
                delay="delay-500"
              />
            </div>
            <div className="animate-fade-in-up delay-200">
              <TelegramMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Reporting */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="animate-fade-in-up">
              <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
                Reportes que te ayudan a decidir
              </h2>
              <p className="text-lg text-[var(--text-secondary)] mb-6 leading-relaxed">
                Visualizá tus gastos por categoría, mes y tarjeta. Analizá tendencias y compará
                meses anteriores para saber exactamente a dónde va tu dinero.
              </p>
              <ul className="space-y-3 text-[var(--text-secondary)]">
                <li className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  <span>Gráficos de gastos por categoría y mes</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                    />
                  </svg>
                  <span>Tendencias y proyecciones de gasto</span>
                </li>
                <li className="flex items-start gap-3">
                  <svg
                    className="w-5 h-5 text-[var(--color-primary)] mt-0.5 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                    />
                  </svg>
                  <span>Reportes mensuales con análisis de IA</span>
                </li>
              </ul>
            </div>
            <div className="animate-fade-in-up delay-200">
              <DashboardMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="animate-fade-in-up">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-green-500/10 mb-6">
              <svg
                className="w-7 h-7 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              Tus datos están seguros
            </h2>
            <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto mb-8">
              Cifrado de extremo a extremo, servidores seguros y control total sobre tus datos.
            </p>
            <div className="grid sm:grid-cols-3 gap-6 text-left">
              <SecurityItem
                icon="🔒"
                title="Cifrado"
                description="Tus contraseñas están encriptadas con bcrypt. Las sesiones usan JWT."
              />
              <SecurityItem
                icon="🛡️"
                title="Privacidad"
                description="Datos financieros 100% voluntarios. Usá la app sin cargar ningún dato."
              />
              <SecurityItem
                icon="🗑️"
                title="Eliminación"
                description="Eliminá tu cuenta y todos tus datos en cualquier momento."
              />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-4 bg-[var(--color-base-alt)]">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-[var(--text-primary)] text-center mb-12">
            Preguntas frecuentes
          </h2>
          <div className="space-y-4">
            <FaqItem
              question="¿Es gratis?"
              answer="Sí, oikonomia es completamente gratis. No hay planes premium ni funciones bloqueadas."
            />
            <FaqItem
              question="¿Mis datos están seguros?"
              answer="Sí. Tus contraseñas están encriptadas, las sesiones usan JWT y podés eliminar tu cuenta en cualquier momento. Los datos financieros son 100% voluntarios."
            />
            <FaqItem
              question="¿Necesito saber de finanzas?"
              answer="Para nada. La IA se encarga de categorizar y analizar vos solo registrás los gastos."
            />
            <FaqItem
              question="¿Puedo usarlo desde el celular?"
              answer="Sí, la app web funciona perfectamente desde el celular. También tenés el bot de Telegram para registrar gastos rápido."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center animate-fade-in-up">
          <h2 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
            ¿Listo para tomar el control?
          </h2>
          <p className="text-lg text-[var(--text-secondary)] mb-8">
            Uní miles de personas que ya están organizando sus finanzas con oikonomia.
          </p>
          <a
            href="https://platform.oikonomia.ar/register"
            className="inline-flex items-center justify-center px-10 py-4 rounded-xl bg-[var(--color-primary)] text-white font-semibold text-lg hover:brightness-110 transition shadow-lg shadow-[var(--color-primary)]/25"
          >
            Empezá ahora — es gratis
          </a>
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
                <span className="font-semibold text-[var(--text-primary)]">oikonomia</span>
              </div>
              <p className="text-sm text-[var(--text-tertiary)] leading-relaxed">
                Tu planificador financiero personal con inteligencia artificial.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text-primary)] mb-3">Producto</h4>
              <ul className="space-y-2 text-sm text-[var(--text-tertiary)]">
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
              <h4 className="font-semibold text-[var(--text-primary)] mb-3">Legal</h4>
              <ul className="space-y-2 text-sm text-[var(--text-tertiary)]">
                <li>
                  <a href="/privacy" className="hover:text-[var(--text-primary)] transition">
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
          <div className="pt-8 border-t border-[var(--border-color)] text-center text-sm text-[var(--text-tertiary)]">
            © {new Date().getFullYear()} oikonomia. Todos los derechos reservados.
          </div>
        </div>
      </footer>
    </div>
  );
}

function DashboardMockup() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-r from-[var(--color-primary)]/20 to-purple-500/20 rounded-3xl blur-2xl opacity-50" />
      <div className="relative bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--border-color)] p-6 max-w-sm mx-auto">
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-xs">
            O
          </div>
          <span className="font-semibold text-sm text-[var(--text-primary)]">oikonomia</span>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="p-3 rounded-xl bg-[var(--color-base-alt)]">
            <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
              Este mes
            </div>
            <div className="text-xl font-bold text-[var(--text-primary)] animate-count-up">
              $45.230
            </div>
          </div>
          <div className="p-3 rounded-xl bg-[var(--color-base-alt)]">
            <div className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">
              Transacciones
            </div>
            <div className="text-xl font-bold text-[var(--text-primary)] animate-count-up delay-200">
              28
            </div>
          </div>
        </div>
        <div className="h-28 bg-[var(--color-base-alt)] rounded-xl p-3 flex items-end gap-1.5">
          {[35, 55, 40, 70, 50, 65, 45].map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm animate-bar-grow"
              style={{
                height: `${h}%`,
                backgroundColor: i === 4 ? "var(--color-primary)" : "var(--color-base)",
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
        <div className="flex gap-2 mt-4">
          <div className="flex-1 p-2 rounded-lg bg-[var(--color-base-alt)] text-center">
            <div className="text-[10px] text-[var(--text-tertiary)]">Alimentación</div>
            <div className="text-xs font-semibold text-[var(--text-primary)]">$18.500</div>
          </div>
          <div className="flex-1 p-2 rounded-lg bg-[var(--color-base-alt)] text-center">
            <div className="text-[10px] text-[var(--text-tertiary)]">Transporte</div>
            <div className="text-xs font-semibold text-[var(--text-primary)]">$8.200</div>
          </div>
          <div className="flex-1 p-2 rounded-lg bg-[var(--color-base-alt)] text-center">
            <div className="text-[10px] text-[var(--text-tertiary)]">Otros</div>
            <div className="text-xs font-semibold text-[var(--text-primary)]">$18.530</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TelegramMockup() {
  return (
    <div className="max-w-xs mx-auto">
      <div className="bg-[#1a1a2e] rounded-2xl shadow-2xl p-4 border border-[#2a2a3e]">
        <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-[#2a2a3e]">
          <div className="w-9 h-9 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm">
            N
          </div>
          <div>
            <div className="text-white text-sm font-medium">NikoFin</div>
            <div className="text-[10px] text-green-400">● en línea</div>
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex justify-end">
            <div className="bg-[var(--color-primary)] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-[85%]">
              <span className="text-white text-sm">mastercard galicia almacen 5999</span>
            </div>
          </div>
          <div className="flex justify-start">
            <div className="bg-[#2a2a3e] rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%]">
              <div className="text-white text-sm leading-relaxed">
                <span className="text-green-400">✅</span> ¡Listo! Guardé el gasto.
                <br />
                <br />
                💰 $5.999
                <br />
                💳 Galicia Mastercard
                <br />
                📅 12 de julio de 2026
                <br />
                <br />
                <span className="text-[var(--color-primary)]">🍽️ Alimentación</span>
                <br />
                <span className="text-[var(--text-tertiary)]">└ 📂 Almacén/Kiosco</span>
              </div>
            </div>
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
  delay,
}: {
  icon: string;
  title: string;
  description: string;
  delay?: string;
}) {
  return (
    <div
      className={`p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:shadow-lg hover:border-[var(--color-primary)]/20 transition-all duration-300 animate-fade-in-up ${delay || ""}`}
    >
      <div className="w-12 h-12 rounded-xl bg-[var(--color-primary)]/10 flex items-center justify-center text-2xl mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );
}

function Step({
  number,
  title,
  description,
  delay,
}: {
  number: number;
  title: string;
  description: string;
  delay?: string;
}) {
  return (
    <div className={`flex gap-4 animate-fade-in-up ${delay || ""}`}>
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--color-primary)] text-white flex items-center justify-center font-bold text-sm">
        {number}
      </div>
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function SecurityItem({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--border-color)]">
      <div className="text-2xl mb-2">{icon}</div>
      <h4 className="font-semibold text-[var(--text-primary)] mb-1">{title}</h4>
      <p className="text-sm text-[var(--text-secondary)]">{description}</p>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  return (
    <div className="p-5 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)]">
      <h3 className="font-semibold text-[var(--text-primary)] mb-2">{question}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{answer}</p>
    </div>
  );
}
