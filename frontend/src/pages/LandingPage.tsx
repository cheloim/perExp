export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      {/* Hero */}
      <section className="relative overflow-hidden py-20 px-4">
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/5 to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--color-primary)] text-white font-bold text-2xl shadow-lg mb-6">
            O
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-[var(--text-primary)] tracking-tight mb-4">
            oikonomia
          </h1>
          <p className="text-lg md:text-xl text-[var(--text-secondary)] max-w-2xl mx-auto mb-8">
            Tu planificador financiero personal. Organizá tus gastos, analizá tus hábitos y tomá mejores decisiones con inteligencia artificial.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="https://platform.oikonomia.ar/register"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-[var(--color-primary)] text-white font-medium hover:opacity-90 transition shadow-lg"
            >
              Comenzá ahora — es gratis
            </a>
            <a
              href="https://platform.oikonomia.ar/login"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] font-medium hover:bg-[var(--color-base-alt)] transition"
            >
              Ya tengo cuenta
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] text-center mb-12">
            Todo lo que necesitás para tus finanzas
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <FeatureCard
              icon="📊"
              title="Gastos con IA"
              description="Categorización automática con inteligencia artificial. Mandale un mensaje por Telegram y listo."
            />
            <FeatureCard
              icon="📈"
              title="Reportes inteligentes"
              description="Análisis mensual, tendencias de gasto y proyecciones para los próximos meses."
            />
            <FeatureCard
              icon="💳"
              title="Tarjetas y cuentas"
              description="Organizá todas tus tarjetas de crédito, débito y cuentas en un solo lugar."
            />
            <FeatureCard
              icon="🏦"
              title="Inversiones"
              description="Seguimiento de FCI, plazos fijos y cauciones en tiempo real."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 px-4 bg-[var(--color-base-alt)]">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-[var(--text-primary)] text-center mb-12">
            ¿Cómo funciona?
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <Step number={1} title="Registrate" description="Creá tu cuenta en segundos. Sin tarjeta de crédito, sin compromiso." />
            <Step number={2} title="Registrá gastos" description="Escribile al bot de Telegram o cargá gastos desde la web. La IA se encarga del resto." />
            <Step number={3} title="Analizá" description="Revisá reportes, tendencias y proyecciones para tomar mejores decisiones." />
          </div>
        </div>
      </section>

      {/* Privacy + Footer */}
      <footer className="py-12 px-4 border-t border-[var(--border-color)]">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-[var(--color-primary)] text-white font-bold text-sm mb-4">
            O
          </div>
          <p className="text-sm text-[var(--text-secondary)] mb-4">
            © {new Date().getFullYear()} oikonomia. Todos los derechos reservados.
          </p>
          <div className="flex justify-center gap-6 text-sm">
            <a href="/privacy" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition">
              Privacidad
            </a>
            <a href="https://platform.oikonomia.ar" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition">
              Plataforma
            </a>
            <a href="mailto:contacto@oikonomia.ar" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition">
              Contacto
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="p-6 rounded-xl border border-[var(--border-color)] bg-[var(--color-surface)] hover:shadow-md transition">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );
}

function Step({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div className="text-center">
      <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-[var(--color-primary)] text-white font-bold text-sm mb-4">
        {number}
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h3>
      <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{description}</p>
    </div>
  );
}
