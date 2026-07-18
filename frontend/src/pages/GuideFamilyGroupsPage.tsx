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

export default function GuideFamilyGroupsPage() {
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
              <SymbolicIcon name="users" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">Grupos Familiares</h1>
              <p className="text-[var(--text-secondary)]">
                Compartí gastos, tarjetas y presupuestos con tu familia
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
              { id: "crear-grupo", label: "Crear grupo" },
              { id: "invitar", label: "Invitar miembros" },
              { id: "aceptar", label: "Aceptar invitación" },
              { id: "compartido", label: "Qué se comparte" },
              { id: "privacidad", label: "Privacidad" },
              { id: "holder", label: "Campo Holder" },
              { id: "limites", label: "Límites" },
              { id: "telegram", label: "Telegram" },
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

        {/* Section 1: What are Family Groups */}
        <Section id="que-es" icon="users" title="¿Qué son los Grupos Familiares?">
          <p>
            Los Grupos Familiares te permiten <strong>compartir el seguimiento de gastos</strong>{" "}
            con las personas que viven en tu hogar. En lugar de que cada uno lleve sus finanzas por
            separado, todos ven el mismo conjunto de datos compartidos.
          </p>
          <p>
            Es ideal para parejas, familias con hijos, o cualquier grupo de personas que comparten
            gastos del hogar.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Vos y tu pareja registran gastos del supermercado con
              distintas tarjetas. Ambos ven todos los gastos y los presupuestos se actualizan en
              tiempo real para los dos.
            </p>
          </div>
        </Section>

        {/* Section 2: How to create a group */}
        <Section id="crear-grupo" icon="users" title="Cómo crear un grupo">
          <Steps
            items={[
              'Ir a "Configuración" desde el menú lateral',
              'Buscar la sección "Grupo Familiar"',
              'Hacé click en "Crear grupo familiar"',
              'Elegí un nombre para el grupo (ej: "Mi familia")',
              "El sistema genera automáticamente un código de invitación de 8 caracteres",
            ]}
          />
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> El código de invitación es único para tu grupo. Compartilo con los
            miembros que quieras invitar.
          </p>
        </Section>

        {/* Section 3: How to invite members */}
        <Section id="invitar" icon="users" title="Cómo invitar miembros">
          <p>
            Una vez creado el grupo, recibís un{" "}
            <strong>código de invitación de 8 caracteres</strong> (ej: "A3K9M2X7"). Este código es
            el que necesitás compartir con tu familia.
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                Opción 1: Compartir el código
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Copiá el código y mandalo por WhatsApp, Telegram, o en persona. Cada miembro lo usa
                para unirse.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                Opción 2: Nuevo código
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si necesitás generar un nuevo código (por ejemplo, si el anterior se compartió de
                más), podés hacerlo desde la configuración del grupo.
              </p>
            </div>
          </div>
          <div className="mt-3 p-4 rounded-xl bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
            <p className="text-sm">
              <strong>⚠️ Importante:</strong> El código permite que cualquiera con acceso se una a
              tu grupo. Compartilo solo con personas de confianza.
            </p>
          </div>
        </Section>

        {/* Section 4: How to accept invitations */}
        <Section id="aceptar" icon="users" title="Cómo aceptar una invitación">
          <Steps
            items={[
              "Recibís el código de invitación de 8 caracteres del administrador del grupo",
              'En la app, ir a "Configuración" → "Grupo Familiar"',
              'Hacé click en "Unirse a un grupo"',
              "Ingresá el código de 8 caracteres",
              "¡Listo! Ya sos parte del grupo familiar",
            ]}
          />
          <p className="mt-3 text-sm">
            También podés recibir una <strong>notificación en la app</strong> si el administrador te
            envía la invitación directamente.
          </p>
        </Section>

        {/* Section 5: What is shared */}
        <Section id="compartido" icon="users" title="¿Qué se comparte en el grupo?">
          <p>
            Cuando te unís a un grupo familiar, ciertos datos se comparten entre todos los miembros:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl border-2 border-[var(--color-success)]/30">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                ✅ Se comparte
              </p>
              <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                <li>• Gastos registrados</li>
                <li>• Tarjetas del grupo</li>
                <li>• Inversiones</li>
                <li>• Presupuestos</li>
                <li>• Categorías de gasto</li>
              </ul>
            </div>
            <div className="p-4 rounded-xl border-2 border-[var(--color-danger)]/30">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                ❌ No se comparte
              </p>
              <ul className="text-xs text-[var(--text-secondary)] space-y-1">
                <li>• Datos de cuenta personal</li>
                <li>• Configuración privada</li>
                <li>• Credenciales de login</li>
              </ul>
            </div>
          </div>
        </Section>

        {/* Section 6: Privacy and permissions */}
        <Section id="privacidad" icon="users" title="Privacidad y permisos">
          <p>
            Cada miembro del grupo ve <strong>todos los datos compartidos</strong>. No hay
            distinción entre "quién registró qué" en la vista general: todos los gastos, tarjetas y
            presupuestos son visibles para todos.
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                👤 Administrador
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Quien creó el grupo. Puede invitar/eliminar miembros y administrar la configuración
                del grupo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">👥 Miembro</p>
              <p className="text-xs text-[var(--text-secondary)]">
                Puede registrar gastos, ver datos compartidos y usar el bot de Telegram con el
                grupo.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 7: Holder field */}
        <Section id="holder" icon="card" title="El campo Holder: seguimiento por persona">
          <p>
            El campo <strong>holder</strong> (titular) en las tarjetas te permite saber{" "}
            <strong>quién está usando cada tarjeta</strong>. Es clave para el seguimiento familiar.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm mb-2">
              <strong>💡 Ejemplo práctico:</strong>
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              Tenés una tarjeta Visa Banco X. Tu pareja tiene otra tarjeta del mismo banco.
              <br />
              <br />
              • Tarjeta 1: Visa Banco X — holder: "Juan"
              <br />• Tarjeta 2: Visa Banco X — holder: "María"
              <br />
              <br />
              Así podés filtrar gastos por persona, aunque usen la misma marca y banco.
            </p>
          </div>
          <Steps
            items={[
              'Al crear una tarjeta, completá el campo "Titular" (holder)',
              'Usá el primer nombre o un apodo reconocible (ej: "Juan", "María", "Hijo mayor")',
              "Los gastos registrados con esa tarjeta se asocian automáticamente al titular",
              "Podés filtrar gastos por titular en los reportes",
            ]}
          />
        </Section>

        {/* Section 8: Limitations */}
        <Section id="limites" icon="users" title="Límites del grupo familiar">
          <div className="p-4 rounded-xl border border-[var(--border-color)]">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-[var(--color-warning)]/10 flex items-center justify-center">
                <span className="text-lg font-bold text-[var(--color-warning)]">5</span>
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Máximo 5 miembros por grupo
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Esto incluye al administrador que creó el grupo
                </p>
              </div>
            </div>
          </div>
          <p className="mt-3">Otros límites a tener en cuenta:</p>
          <ul className="list-disc ml-5 space-y-1">
            <li>Cada usuario puede pertenecer a un solo grupo familiar a la vez</li>
            <li>Para cambiar de grupo, primero debés abandonar el actual</li>
            <li>
              Si eliminás el grupo, los datos compartidos permanecen en cada cuenta individual
            </li>
          </ul>
        </Section>

        {/* Section 9: Telegram */}
        <Section id="telegram" icon="bot" title="Telegram y grupos familiares">
          <p>
            El bot de Telegram funciona con el grupo familiar. Cuando cualquier miembro registra un
            gasto por Telegram, <strong>se guarda en el grupo compartido</strong>.
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">¿Cómo funciona?</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Si tu cuenta está vinculada a un grupo familiar, cada gasto que registres por el bot
              (ej: "supermercado 15000") se guarda en el grupo. Tu pareja también puede usar el
              mismo bot y los gastos se suman al mismo lugar.
            </p>
          </div>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">Ejemplo:</p>
            <p className="text-xs text-[var(--text-secondary)]">
              Juan (Telegram): "supermercado 12000" → Guardado en grupo "Familia Pérez"
              <br />
              María (Telegram): "farmacia 3500" → Guardado en grupo "Familia Pérez"
              <br />
              <br />
              Ambos ven los dos gastos en la app.
            </p>
          </div>
        </Section>

        {/* Section 10: Tips */}
        <Section id="consejos" icon="sparkles" title="Consejos para usarlo en familia">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Configurá los holders al crear tarjetas
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Desde el principio, asigná un titular a cada tarjeta. Esto te da visibilidad de
                quién gasta qué, sin necesidad de preguntar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Definan presupuestos juntos
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Sentense juntos a configurar los presupuestos mensuales. Si ambos están de acuerdo
                en los límites, es más fácil cumplirlos.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usen Telegram los dos
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Que ambos miembros usen el bot de Telegram para registrar gastos al momento. Es más
                fácil recordar un gasto recién hecho que buscarlo después.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Revisen juntos cada semana
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Dediquen 10 minutos por semana a revisar los gastos juntos. Detectan desvíos a
                tiempo y ajustan el presupuesto si es necesario.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Un titular por tarjeta, no por gasto
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El holder se asigna a la tarjeta, no al gasto. Si tu pareja usa tu tarjeta
                ocasionalmente, el gasto igual se asocia al titular de esa tarjeta. Tengan tarjetas
                separadas para mejor seguimiento.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
