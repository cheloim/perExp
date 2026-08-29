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

export default function GuideSmartImportPage() {
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
              <SymbolicIcon
                name="arrow-up-right"
                size={26}
                className="text-[var(--color-primary)]"
              />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">
                Guía de Importación Inteligente
              </h1>
              <p className="text-[var(--text-secondary)]">
                Importá tus resúmenes bancarios con IA y cargá cientos de gastos en segundos
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
              { id: "formatos", label: "Formatos" },
              { id: "como-funciona", label: "Cómo funciona" },
              { id: "pasos", label: "Paso a paso" },
              { id: "tarjetas", label: "Mapeo de tarjetas" },
              { id: "duplicados", label: "Duplicados" },
              { id: "consejos", label: "Consejos" },
              { id: "errores", label: "Errores comunes" },
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

        {/* Section 1: What is Smart Import */}
        <Section id="que-es" icon="arrow-up-right" title="¿Qué es la Importación Inteligente?">
          <p>
            La Importación Inteligente es una función que te permite{" "}
            <strong>cargar cientos de gastos de una sola vez</strong> subiendo el resumen de tu
            tarjeta de crédito o cuenta bancaria en formato PDF, CSV o Excel.
          </p>
          <p>
            En lugar de cargar gasto por gasto manualmente, el sistema{" "}
            <strong>lee el documento automáticamente</strong>, detecta cada transacción, la
            clasifica por categoría y te presenta una vista previa para revisar antes de confirmar.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Ejemplo:</strong> Subís el resumen de tu Visa del mes con 85 movimientos.
              En menos de un minuto tenés todos los gastos categorizados y listos para confirmar.
            </p>
          </div>
        </Section>

        {/* Section 2: Supported formats */}
        <Section id="formatos" icon="arrow-up-right" title="Formatos soportados">
          <p>
            El sistema acepta tres tipos de archivo, cada uno con un nivel diferente de precisión:
          </p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📄 PDF con texto seleccionable
              </p>
              <p className="text-xs">
                El sistema usa <strong>inteligencia artificial</strong> para leer el resumen.
                Funciona con la mayoría de los bancos y tarjetas de Argentina. La precisión depende
                de la calidad del PDF.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📊 CSV (recomendado)
              </p>
              <p className="text-xs">
                Formato <strong>determinístico</strong>: el sistema lee las columnas directamente.
                Máxima precisión. Si tu banco ofrece exportar a CSV, usalo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                📗 XLSX (Excel)
              </p>
              <p className="text-xs">
                También es <strong>determinístico</strong>. Funciona igual que CSV pero con archivos
                de Excel. Ideal si descargás los movimientos desde la app de tu banco.
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
            <p className="text-xs">
              <strong>⚠️ Nota:</strong> Los PDFs escaneados (imagen) no funcionan. El PDF debe tener
              texto seleccionable para que la IA pueda leerlo.
            </p>
          </div>
        </Section>

        {/* Section 3: How it works */}
        <Section id="como-funciona" icon="arrow-up-right" title="¿Cómo funciona?">
          <p>El proceso tiene 3 etapas claras:</p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                1️⃣ Subir y parsear
              </p>
              <p className="text-xs">
                Subís el archivo. El sistema lo lee con IA (PDF) o lo procesa directamente
                (CSV/XLSX). Extrae cada transacción con fecha, descripción y monto.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                2️⃣ Revisar y mapear
              </p>
              <p className="text-xs">
                El sistema te muestra todas las transacciones detectadas. Podés asignar cada una a
                una tarjeta registrada, revisar categorías y corregir errores antes de guardar.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">3️⃣ Confirmar</p>
              <p className="text-xs">
                Revisás el resumen final con el total de gastos y la cantidad de transacciones. Si
                todo está bien, confirmás y los gastos se guardan en tu base de datos.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 4: Step by step */}
        <Section id="pasos" icon="arrow-up-right" title="Paso a paso">
          <Steps
            items={[
              'Entrá a "Importar" en el menú lateral o desde el dashboard',
              "Seleccioná el tipo de archivo: PDF, CSV o XLSX",
              'Hacé click en "Subir archivo" y elegí el resumen de tu banco o tarjeta',
              "Esperá mientras el sistema procesa el archivo (puede tardar unos segundos)",
              "Revisá la lista de transacciones detectadas: fecha, descripción, monto y categoría",
              "Asigná cada transacción a la tarjeta correcta si tenés más de una registrada",
              "Verificá que las categorías sean correctas; podés editarlas si es necesario",
              'Hacé click en "Confirmar importación" para guardar todos los gastos',
            ]}
          />
        </Section>

        {/* Section 5: Card mapping */}
        <Section id="tarjetas" icon="arrow-up-right" title="Mapeo de tarjetas">
          <p>
            Si tenés más de una tarjeta registrada, el sistema te pide{" "}
            <strong>asignar cada transacción a una tarjeta</strong> antes de confirmar.
          </p>
          <p>
            Esto es importante para que los gastos queden correctamente asociados al resumen de la
            tarjeta correspondiente, especialmente si importás resúmenes de diferentes bancos o
            franquicias.
          </p>
          <div className="p-4 rounded-xl bg-[var(--color-primary)]/5 border border-[var(--color-primary)]/20">
            <p className="text-sm">
              <strong>💡 Consejo:</strong> Si solo tenés una tarjeta registrada, el sistema la
              asigna automáticamente. No tenés que hacer nada extra.
            </p>
          </div>
        </Section>

        {/* Section 6: Duplicate detection */}
        <Section id="duplicados" icon="arrow-up-right" title="Detección de duplicados">
          <p>
            El sistema tiene una <strong>protección de 2 capas</strong> para evitar que se carguen
            gastos repetidos:
          </p>

          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                🔍 Capa 1: Comparación exacta
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Compara fecha + monto + descripción con tus gastos existentes. Si ya cargaste ese
                gasto antes (por Telegram, manual o por otra importación), lo detecta y lo marca.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)] mb-1">
                🧠 Capa 2: Detección inteligente
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Si dos transacciones tienen la misma fecha y un monto muy similar (posibles cargos
                duplicados del comercio), el sistema te avisa para que decidas si son iguales o no.
              </p>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[var(--color-success)]/10 border border-[var(--color-success)]/20">
            <p className="text-xs">
              <strong>✅ Tranquilo:</strong> Los duplicados detectados se muestran en la vista
              previa antes de confirmar. Vos decidís si los guardás o los descartás.
            </p>
          </div>
        </Section>

        {/* Section 7: Tips */}
        <Section id="consejos" icon="sparkles" title="Consejos para mejores resultados">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Usá PDFs con texto seleccionable
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Abrí el PDF en tu computadora y probá seleccionar texto con el mouse. Si podés
                copiar y pegar el texto, el sistema puede leerlo. Si no, es una imagen escaneada y
                no funcionará.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Revisá antes de confirmar
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Siempre revisá la lista de transacciones antes de confirmar. La IA puede cometer
                errores en la categorización, especialmente con comercios nuevos o nombres poco
                claros.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Preferí CSV o XLSX cuando sea posible
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Los formatos CSV y XLSX son determinísticos: el sistema lee las columnas
                directamente sin necesidad de IA. La precisión es prácticamente del 100%. Si tu
                banco permite exportar en estos formatos, usalos.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                💡 Importá meses completos
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Es mejor importar el resumen completo del mes que ir importando de a poco. Así
                aprovechás la detección de duplicados y tenés un panorama completo de tus gastos.
              </p>
            </div>
          </div>
        </Section>

        {/* Section 8: Common errors */}
        <Section id="errores" icon="arrow-up-right" title="Errores comunes">
          <div className="space-y-3">
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                ❌ "PDF sin texto detectado"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El PDF es una imagen escaneada, no tiene texto seleccionable. Solución: pedile a tu
                banco el resumen en formato digital o descargalo desde la web/app en vez de
                escanearlo.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                ❌ "Formato no reconocido"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El archivo CSV/XLSX tiene un formato que el sistema no conoce. Solución: verificá
                que el archivo tenga columnas de fecha, descripción y monto. Si es un banco
                argentino, probá exportar de otra forma.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                ❌ "No se detectaron transacciones"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El archivo está vacío o el sistema no pudo leer las transacciones. Solución: abrí el
                archivo y verificá que tenga datos. Si es PDF, probá copiar el texto manualmente
                para confirmar que es seleccionable.
              </p>
            </div>
            <div className="p-3 rounded-lg border border-[var(--border-color)]">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                ❌ "Tarjeta no registrada"
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                El resumen es de una tarjeta que no tenés registrada en el sistema. Solución: andá a
                "Cuentas", creá la tarjeta primero, y después volvé a importar el archivo.
              </p>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
