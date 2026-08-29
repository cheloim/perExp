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

export default function GuideAIAnalysisPage() {
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
              <SymbolicIcon name="sparkles" size={26} className="text-[var(--color-primary)]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Guía de Análisis con IA
              </h1>
              <p className="text-[var(--text-secondary)]">
                Todo lo que necesitás saber para entender tus gastos con la ayuda de la inteligencia
                artificial
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
              { id: "como-acceder", label: "Cómo acceder" },
              { id: "preguntas", label: "Qué podés preguntar" },
              { id: "ejemplos", label: "Ejemplos" },
              { id: "analisis", label: "Entender el análisis" },
              { id: "mensual", label: "Análisis mensual" },
              { id: "telegram", label: "Reporte Telegram" },
              { id: "consejos", label: "Consejos" },
              { id: "limitaciones", label: "Limitaciones" },
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

        {/* Section 1: What is the AI Assistant */}
        <Section id="que-es" icon="sparkles" title="¿Qué es el Asistente de IA?">
          <p>
            El Asistente de IA es un <strong>chat inteligente</strong> que analiza tus gastos y te
            responde preguntas en lenguaje natural. Podés preguntarle cosas como "¿Cuánto gasté en
            supermercado este mes?" o "¿En qué me estoy gastando más?" y te da una respuesta clara
            con datos reales.
          </p>
          <p>
            No es un chatbot genérico — conoce{" "}
            <strong>tus gastos, tus categorías y tus hábitos</strong>. Mientras más gastos tengas
            registrados, más útiles y precisas serán sus respuestas.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 En resumen:</strong> Es como tener un analista financiero personal que
              revisa todos tus gastos y te da insights accionables, disponible 24/7.
            </p>
          </div>
        </Section>

        {/* Section 2: How to access */}
        <Section id="como-acceder" icon="sparkles" title="¿Cómo acceder al asistente?">
          <Steps
            items={[
              "Abrí la aplicación en tu navegador",
              'En la barra lateral izquierda, hacé click en el botón "Asistente IA" (ícono de sparkles ✨)',
              "Se abre un panel lateral (drawer) con el chat",
              "Escribí tu pregunta en el campo de texto y presioná Enter o hacé click en enviar",
              "El asistente procesa tu pregunta y te responde con datos de tus gastos",
            ]}
          />
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> Podés abrir el asistente desde cualquier página de la app. El
            drawer se superpone sin perder la página en la que estás.
          </p>
        </Section>

        {/* Section 3: What questions can you ask */}
        <Section id="preguntas" icon="sparkles" title="¿Qué podés preguntarle?">
          <p>
            El asistente entiende preguntas en <strong>español</strong> sobre una amplia variedad de
            temas relacionados con tus finanzas. Acá van las categorías de preguntas más útiles:
          </p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                💰 Gastos por categoría
              </p>
              <p className="text-xs">
                "¿Cuánto gasté en supermercado este mes?", "¿Cuánto me gasté en restaurantes en
                junio?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📊 Tendencias y comparaciones
              </p>
              <p className="text-xs">
                "¿Cómo vienen mis gastos este mes comparado con el anterior?", "¿En qué categoría
                aumento más mi gasto?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🔍 Detalles y desgloses
              </p>
              <p className="text-xs">
                "¿Cuáles fueron mis gastos más grandes este mes?", "¿Cuánto gasté por día esta
                semana?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                💳 Gastos por tarjeta
              </p>
              <p className="text-xs">
                "¿Cuánto gasté con la Visa del Banco Nación?", "¿Qué tarjeta usé más este mes?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📅 Períodos específicos
              </p>
              <p className="text-xs">
                "¿Cuánto gasté la semana pasada?", "¿Cuál fue mi gasto total en marzo?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                💡 Consejos y recomendaciones
              </p>
              <p className="text-xs">
                "¿Dónde podría ahorrar?", "Dame consejos para reducir mis gastos en entretenimiento"
              </p>
            </div>
          </div>
        </Section>

        {/* Section 4: Example questions and answers */}
        <Section id="ejemplos" icon="sparkles" title="Ejemplos de conversación">
          <p>Acá van algunos ejemplos reales de cómo podés interactuar con el asistente:</p>

          <div className="space-y-4">
            <div className="p-4 rounded-xl border border-[var(--border-color)] space-y-3">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Ejemplo 1: Consulta rápida
              </p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--color-primary)]">
                    V
                  </span>
                  <p className="text-xs">"¿Cuánto gasté en supermercado este mes?"</p>
                </div>
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center text-[10px]">
                    🤖
                  </span>
                  <p className="text-xs">
                    "Este mes gastaste <strong>$67.500</strong> en supermercado, lo cual representa
                    un 84% de tu presupuesto de $80.000. Vas bien encaminado, te quedan $12.500
                    disponibles."
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border-color)] space-y-3">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Ejemplo 2: Comparación
              </p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--color-primary)]">
                    V
                  </span>
                  <p className="text-xs">"¿Cómo vienen mis gastos comparado con el mes pasado?"</p>
                </div>
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center text-[10px]">
                    🤖
                  </span>
                  <p className="text-xs">
                    "Este mes llevás gastados <strong>$145.000</strong> contra $168.000 del mes
                    pasado a la misma fecha. Bajaste un 13%. Las categorías que más bajaron fueron
                    delivery (-45%) y ropa (-30%)."
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-[var(--border-color)] space-y-3">
              <p className="text-xs font-semibold text-[var(--text-primary)]">Ejemplo 3: Consejo</p>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-[10px] font-bold text-[var(--color-primary)]">
                    V
                  </span>
                  <p className="text-xs">"¿Dónde podría ahorrar?"</p>
                </div>
                <div className="flex gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--color-success)]/10 flex items-center justify-center text-[10px]">
                    🤖
                  </span>
                  <p className="text-xs">
                    "Basado en tus gastos, te sugiero enfocarte en: 1) <strong>Delivery</strong>:
                    gastaste $18.000 este mes, podrías ahorrar $8.000 cocinando más. 2)
                    <strong>Streaming</strong>: tenés 4 servicios, podríasCancelar uno que uses poco
                    y ahorrar $3.000/mes."
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Section 5: Understanding the analysis */}
        <Section id="analisis" icon="chart-bar" title="Entender el análisis">
          <p>
            Cuando el asistente analiza tus gastos, puede incluir diferentes tipos de información:
          </p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">📈 Tendencias</p>
              <p className="text-xs">
                Patrones en tus gastos: "Tus gastos en delivery aumentaron un 30% en las últimas 3
                semanas." Esto te ayuda a detectar hábitos antes de que se conviertan en problemas.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">💡 Insights</p>
              <p className="text-xs">
                Observaciones útiles: "Los martes y viernes son tus días de mayor gasto." O "El 60%
                de tu gasto en entretenimiento es en un solo lugar."
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                🎯 Recomendaciones
              </p>
              <p className="text-xs">
                Sugerencias accionables: "Si reducís un 20% tus gastos en delivery, podrías ahorrar
                $15.000 al mes." Las recomendaciones se basan en tus datos reales, no en genéricos.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">⚠️ Alertas</p>
              <p className="text-xs">
                Advertencias: "Tu gasto en ropa ya superó el presupuesto en un 15%." El asistente te
                avisa cuando algo se sale de lo normal.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 6: Monthly analysis */}
        <Section id="mensual" icon="chart-bar" title="Análisis mensual automático">
          <p>
            Al final de cada mes, el sistema genera un <strong>análisis automático</strong> de tus
            gastos que incluye:
          </p>
          <ul className="list-disc ml-5 space-y-1">
            <li>Resumen total de gastos del mes</li>
            <li>Comparación con el mes anterior</li>
            <li>Top 5 categorías con más gasto</li>
            <li>Categorías que superaron el presupuesto</li>
            <li>Categorías donde ahorraste</li>
            <li>Tendencia general (subiste, bajaste o mantuviste)</li>
          </ul>
          <p className="mt-3">
            Este análisis aparece en tu panel de la app y también podés consultarlo preguntándole al
            asistente: "¿Cómo fue mi mes de junio?"
          </p>
          <div className="mt-3 p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Tip:</strong> Pedile al asistente un resumen del mes cuando quieras, no
              tenés que esperar al cierre. Escribí "resumen del mes" o "cómo me fue este mes".
            </p>
          </div>
        </Section>

        {/* Section 7: Weekly Telegram report */}
        <Section id="telegram" icon="telegram" title="Reporte semanal por Telegram">
          <p>
            Si tenés conectado el bot de Telegram, cada <strong>domingo a las 10:00 AM</strong> vas
            a recibir un reporte automático con:
          </p>
          <div className="p-3 rounded-lg border border-[var(--border-color)] space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-xs">Total gastado en la semana</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-xs">Desglose por categoría</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-xs">Comparación con la semana anterior</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-xs">Alertas de presupuesto si corresponde</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]" />
              <span className="text-xs">Un consejo personalizado de ahorro</span>
            </div>
          </div>
          <div className="mt-3 p-3 rounded-lg border border-[var(--border-color)]">
            <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
              Ejemplo de reporte:
            </p>
            <p className="text-xs text-[var(--text-secondary)]">
              📊 <strong>Resumen semanal</strong>
              <br />
              💰 Total: $42.300 (↓15% vs semana pasada)
              <br />
              🛒 Supermercado: $18.000
              <br />
              🍔 Delivery: $12.500
              <br />
              🚗 Transporte: $8.800
              <br />
              🎬 Entretenimiento: $3.000
              <br />
              💡 <em>"Bajaste el gasto en delivery, ¡seguí así!"</em>
            </p>
          </div>
          <p className="mt-3 text-sm">
            <strong>Tip:</strong> Si no estás recibiendo los reportes, asegurate de tener el bot de
            Telegram vinculado a tu cuenta.
          </p>
        </Section>

        {/* Section 8: Tips for better insights */}
        <Section id="consejos" icon="sparkles" title="Consejos para mejores resultados">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Sé específico en tus preguntas
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                En vez de "¿cómo van mis gastos?", preguntá "¿cuánto gasté en supermercado la
                primera semana de julio?". Mientras más específica la pregunta, mejor la respuesta.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Hacé preguntas de seguimiento
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si el asistente te dice que gastaste mucho en delivery, preguntale "¿cuánto gasté en
                delivery los últimos 3 meses?" para ver la tendencia. El chat mantiene el contexto.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usalo para planificar
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Pedile "¿cuánto necesito para el mes que viene basado en mis gastos actuales?" o
                "¿cuánto debería presupuestar para vacaciones según mi historial?"
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Registrá tus gastos consistentemente
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El asistente solo puede analizar los gastos que registraste. Cuantos más gastos
                tengas, más precisos serán los análisis y recomendaciones.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Preguntá por comparaciones
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Las comparaciones son muy útiles: "¿este mes gasté más o menos que el pasado?", "¿en
                qué categoría cambié más?". Te dan perspectiva sobre tus hábitos.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 9: Limitations */}
        <Section id="limitaciones" icon="sparkles" title="Limitaciones del asistente">
          <p>
            El asistente de IA es muy útil, pero tiene algunas limitaciones que es importante
            conocer:
          </p>
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                📋 Solo conoce tus gastos registrados
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si no registraste un gasto en efectivo, el asistente no lo sabe. Los análisis son
                tan buenos como los datos que le das.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🔮 No puede predecir el futuro
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Te puede mostrar tendencias y proyecciones basadas en datos pasados, pero no sabe
                qué va a pasar. Si preguntás "¿cuánto voy a gastar el mes que viene?", te dará una
                estimación, no una certeza.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                🏦 No tiene acceso a tus cuentas bancarias
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El asistente solo ve lo que registrás en la app. No puede consultar saldos,
                movimientos bancarios ni estados de tarjeta.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💬 Las respuestas son sugerencias
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Los consejos y recomendaciones son orientativos. Cada situación financiera es única,
                y el asistente no reemplaza el asesoramiento profesional para decisiones grandes.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
