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

export default function GuideCategoriesPage() {
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
              <SymbolicIcon name="settings" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">Guía de Categorías</h1>
              <p className="text-[var(--text-secondary)]">
                Organizá tus gastos con una jerarquía de categorías personalizable
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
              { id: "que-es", label: "Qué son" },
              { id: "jerarquia", label: "Jerarquía" },
              { id: "predeterminadas", label: "Predeterminadas" },
              { id: "crear", label: "Crear categorías" },
              { id: "colores", label: "Colores" },
              { id: "auto-categorizacion", label: "Auto-categorización" },
              { id: "grupos", label: "Grupos de presupuesto" },
              { id: "consejos", label: "Consejos" },
              { id: "gestionar", label: "Gestionar" },
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

        {/* Section 1: What are categories */}
        <Section id="que-es" icon="settings" title="¿Qué son las categorías?">
          <p>
            Las categorías son una <strong>clasificación jerárquica</strong> que te permite
            organizar tus gastos en grupos lógicos. En lugar de tener una lista plana de gastos, las
            categorías te dan una vista estructurada de en qué va tu dinero.
          </p>
          <p>
            Cada gasto que registrás se asigna a una categoría. Esto permite generar reportes
            precisos, activar auto-categorización por palabras clave y vincular presupuestos a
            subcategorías específicas.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> En vez de ver "Gasté $500.000 este mes", podés ver "En
              Alimentación gasté $120.000, en Transporte $45.000, en Ocio $80.000..."
            </p>
          </div>
        </Section>

        {/* Section 2: Hierarchy */}
        <Section id="jerarquia" icon="settings" title="¿Cómo funciona la jerarquía?">
          <p>
            Las categorías soportan hasta <strong>3 niveles de profundidad</strong>: categoría
            principal → subcategoría → sub-subcategoría. Esto te permite organizar desde lo general
            hasta lo específico.
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs">📁</span>
              <span className="text-xs font-semibold text-[var(--text-primary)]">Alimentación</span>
              <span className="text-xs text-[var(--text-secondary)]">(nivel 1)</span>
            </div>
            <div className="flex items-center gap-2 ml-6">
              <span className="text-xs">📂</span>
              <span className="text-xs">Supermercado</span>
              <span className="text-xs text-[var(--text-secondary)]">(nivel 2)</span>
            </div>
            <div className="flex items-center gap-2 ml-12">
              <span className="text-xs">📄</span>
              <span className="text-xs">Carnicería</span>
              <span className="text-xs text-[var(--text-secondary)]">(nivel 3)</span>
            </div>
            <div className="flex items-center gap-2 ml-6">
              <span className="text-xs">📂</span>
              <span className="text-xs">Restaurantes</span>
              <span className="text-xs text-[var(--text-secondary)]">(nivel 2)</span>
            </div>
            <div className="flex items-center gap-2 ml-6">
              <span className="text-xs">📂</span>
              <span className="text-xs">Delivery</span>
              <span className="text-xs text-[var(--text-secondary)]">(nivel 2)</span>
            </div>
          </div>
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> Los gastos se registran en el nivel más específico posible. Los
            totales se suman automáticamente hacia arriba en la jerarquía.
          </p>
        </Section>

        {/* Section 3: Default categories */}
        <Section id="predeterminadas" icon="settings" title="Categorías predeterminadas">
          <p>
            Al crear tu cuenta, el sistema incluye un set de categorías pre-configuradas que cubren
            los gastos más comunes. No necesitás crearlas desde cero.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                🍽️ Alimentación
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Supermercado, Restaurantes, Delivery, Cafeterías
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">🚗 Transporte</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Combustible, Uber/Taxi, Subte/Colectivo, Estacionamiento
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">🏠 Hogar</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Alquiler, Expensas, Servicios, Limpieza
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">🎭 Ocio</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Streaming, Salidas, Videojuegos, Hobbies
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">💊 Salud</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Farmacia, Obra social, Consultas, Gimnasio
              </p>
            </div>
            <div className="p-4 rounded-xl border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">👕 Ropa</p>
              <p className="text-xs text-[var(--text-secondary)]">Ropa, Calzado, Accesorios</p>
            </div>
          </div>
          <p className="mt-3 text-sm">
            Podés usar las predeterminadas tal cual, renombrarlas o crear las tuyas propias.
          </p>
        </Section>

        {/* Section 4: Creating custom categories */}
        <Section id="crear" icon="settings" title="Crear categorías personalizadas">
          <p>
            Si las predeterminadas no se ajustan a tu estilo de vida, podés crear categorías y
            subcategorías custom con nombre, color y palabras clave.
          </p>
          <Steps
            items={[
              'Entrá a "Categorías" en el menú lateral',
              'Hacé click en "+ Nueva categoría"',
              "Elegí un nombre descriptivo (ej: Mascotas, Educación, Ahorro)",
              "Seleccioná un color para identificarla en los gráficos",
              "Opcionalmente agregá palabras clave para auto-categorización",
              "Guardá y empezá a usarla en tus gastos",
            ]}
          />
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              Campos disponibles:
            </p>
            <div className="space-y-1">
              <p className="text-xs text-[var(--text-secondary)]">
                • <strong>Nombre</strong> — Nombre de la categoría (obligatorio)
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • <strong>Categoría padre</strong> — Para crear subcategorías (opcional)
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • <strong>Color</strong> — Color para gráficos e identificación visual
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                • <strong>Palabras clave</strong> — Para auto-categorización (separadas por coma)
              </p>
            </div>
          </div>
        </Section>

        {/* Section 5: Colors */}
        <Section id="colores" icon="chart-donut" title="Colores de categorías">
          <p>
            Cada categoría tiene un color asignado que se usa en los gráficos de torta, barras y
            dashboards. Elegir colores distintos te permite identificar rápidamente dónde va tu
            dinero.
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-2">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-2">
              Colores sugeridos:
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { name: "Alimentación", color: "#22c55e" },
                { name: "Transporte", color: "#3b82f6" },
                { name: "Hogar", color: "#f59e0b" },
                { name: "Ocio", color: "#a855f7" },
                { name: "Salud", color: "#ef4444" },
                { name: "Ropa", color: "#ec4899" },
              ].map((cat) => (
                <span
                  key={cat.name}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  {cat.name}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> Usá colores contrastantes entre categorías principales para que
            los gráficos sean fáciles de leer.
          </p>
        </Section>

        {/* Section 6: Auto-categorization */}
        <Section id="auto-categorizacion" icon="sparkles" title="Auto-categorización">
          <p>
            El sistema puede categorizar gastos automáticamente usando{" "}
            <strong>palabras clave</strong> que definís en cada categoría y{" "}
            <strong>sugerencias de IA</strong> basadas en el historial.
          </p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🔑 Palabras clave
              </p>
              <p className="text-xs">
                Asigná palabras clave a cada categoría. Cuando un gasto contenga alguna de esas
                palabras, se asigna automáticamente. Ejemplo: "carne, verdura, fideo" →
                Supermercado.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🤖 Sugerencias de IA
              </p>
              <p className="text-xs">
                La IA analiza patrones en tus gastos y sugiere categorías cuando registás algo
                nuevo. Si el botón "Sugerir" aparece, podés aceptar o rechazar la sugerencia.
              </p>
            </div>
          </div>

          <div className="mt-3 p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Si configuraste la palabra clave "uber" en Transporte, al
              escribir "uber 5000" en Telegram, el sistema asigna automáticamente la categoría
              Transporte sin que tengas que elegirla.
            </p>
          </div>
        </Section>

        {/* Section 7: Budget groups */}
        <Section id="grupos" icon="settings" title="Grupos de presupuesto">
          <p>
            Cada categoría puede asignarse a un <strong>grupo de presupuesto</strong>: Necesidades o
            Gustos. Esto permite que el sistema calcule cuánto estás gastando en cada grupo respecto
            a tu ingreso.
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
            Al crear o editar una categoría, elegís a qué grupo pertenece. Esto afecta los
            dashboards y las alertas de presupuesto.
          </p>
        </Section>

        {/* Section 8: Best practices */}
        <Section id="consejos" icon="sparkles" title="Mejores prácticas">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Mantené la estructura simple
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                No crees 50 categorías. Empezá con 6-8 principales y agregá subcategorías solo
                cuando necesités más detalle.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usá subcategorías para detalle
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                En vez de crear "Supermercado", "Carnicería", "Verdulería" como categorías
                principales, ponelas como subcategorías de "Alimentación".
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Asigná colores distintos
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cada categoría principal debería tener un color único para que los gráficos sean
                fáciles de interpretar de un vistazo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Definí palabras clave desde el inicio
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Al crear una categoría, agregá las palabras clave comunes. Esto ahorra tiempo al
                registrar gastos y mejora la auto-categorización.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 9: Managing categories */}
        <Section id="gestionar" icon="settings" title="Gestionar categorías">
          <p>
            Podés editar, eliminar o fusionar categorías en cualquier momento desde la sección
            "Categorías" del menú lateral.
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">✏️ Editar</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Cambiá el nombre, color, palabras clave o categoría padre. Los gastos existentes se
                actualizan automáticamente.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">🗑️ Eliminar</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Eliminá categorías que no uses. Los gastos asignados quedan sin categoría y podés
                reasignarlos después.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">🔀 Fusionar</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si tenés categorías duplicadas (ej: "Comida" y "Alimentación"), fusionalas para
                mover todos los gastos a una sola.
              </p>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">⚠️ Importante:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Eliminar una categoría padre elimina también sus subcategorías. Reasigná los gastos
              antes de eliminar si querés conservarlos.
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
