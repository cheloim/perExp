export default function GuidePage() {
  return (
    <div className="min-h-screen bg-[var(--color-base)]">
      <div className="max-w-3xl mx-auto py-10 px-4">
        <a
          href="/"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-primary)] hover:underline mb-8"
        >
          ← Volver al inicio
        </a>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Guía de usuario</h1>
        <p className="text-sm text-[var(--text-secondary)] mb-10">
          Todo lo que necesitás para empezar a usar Oikonomia.
        </p>

        <Section title="Primeros pasos">
          <p>
            Después de registrarte con tu email o Google, vas a llegar al <strong>Dashboard</strong>
            . Ahí ves un resumen de tus gastos, tarjetas y cuentas.
          </p>
          <p>
            Lo primero que te recomendamos es agregar al menos una{" "}
            <strong>tarjeta o cuenta bancaria</strong> desde la sección Cuentas. Así cuando
            registres gastos van a estar vinculados a un medio de pago.
          </p>
          <ul>
            <li>
              Entrá a <strong>Cuentas</strong> en el menú lateral
            </li>
            <li>Hacé click en "Agregar cuenta"</li>
            <li>Elegí el tipo (tarjeta de crédito, débito, efectivo, banco digital)</li>
            <li>Completá los datos y guardá</li>
          </ul>
        </Section>

        <Section title="Bot de Telegram">
          <p>
            La forma más rápida de registrar gastos es usando el <strong>bot de Telegram</strong>.
            Escribile como le contarías a un amigo y la inteligencia artificial se encarga del
            resto.
          </p>
          <p>
            <strong>Encontrá el bot:</strong> Buscá <code>@NikoFinBot</code> en Telegram o usá el
            link que aparece en tu panel de configuración.
          </p>
          <p>
            <strong>Formato del mensaje:</strong>
          </p>
          <ul>
            <li>
              <code>mastercard galicia almacen 5999</code> — gasto simple con tarjeta y monto
            </li>
            <li>
              <code>visa santander cuotas 3 supermercado 12000</code> — gasto en cuotas
            </li>
            <li>
              <code>efectivo almuerzo 2500</code> — gasto en efectivo
            </li>
          </ul>
          <p>
            El bot te confirma el gasto con la categoría asignada, el monto, la tarjeta y la fecha.
            Si la categoría no es correcta, podés cambiarla después desde la app.
          </p>
          <p>
            <strong>Notificaciones bancarias:</strong> Si copiás y pegás una notificación de tu
            banco (SMS, email o push), el bot la detecta automáticamente y registra el gasto.
          </p>
        </Section>

        <Section title="Dashboard">
          <p>El dashboard es tu panel de control. Muestra un resumen del mes actual:</p>
          <ul>
            <li>
              <strong>Gasto total del mes</strong> — suma de todos los gastos registrados
            </li>
            <li>
              <strong>Promedio diario</strong> — cuánto gastás por día en promedio
            </li>
            <li>
              <strong>Gráfico de categorías</strong> — distribución de gastos por rubro
            </li>
            <li>
              <strong>Tendencia mensual</strong> — comparación con el mes anterior
            </li>
          </ul>
          <p>
            Si tenés la IA activada, el dashboard también muestra{" "}
            <strong>sugerencias de categorías</strong> para gastos sin clasificar y{" "}
            <strong>tendencias inteligentes</strong> con análisis de patrones.
          </p>
        </Section>

        <Section title="Cuentas y tarjetas">
          <p>
            En <strong>Cuentas</strong> podés gestionar todos tus medios de pago:
          </p>
          <ul>
            <li>
              <strong>Tarjetas de crédito</strong> — Visa, Mastercard, Naranja, etc.
            </li>
            <li>
              <strong>Tarjetas de débito</strong> — vinculadas a cuentas bancarias
            </li>
            <li>
              <strong>Efectivo</strong> — plata física
            </li>
            <li>
              <strong>Bancos digitales</strong> — Mercado Pago, Brubank, Ualá, etc.
            </li>
          </ul>
          <p>
            <strong>Vincular tarjeta con cuenta:</strong> Si tenés una caja de ahorro en un banco y
            la tarjeta de débito correspondiente, podés vincularlas para que los gastos con débito
            se resten automáticamente del saldo de la cuenta.
          </p>
          <p>
            <strong>Nombre personalizado:</strong> Podés ponerle un nombre a cada tarjeta para
            identificarla más fácil (ej: "Visa del trabajo", "Mastercard personal").
          </p>
        </Section>

        <Section title="Gastos">
          <p>Los gastos se pueden registrar de tres formas:</p>
          <ul>
            <li>
              <strong>Bot de Telegram</strong> — la más rápida, desde el celular
            </li>
            <li>
              <strong>Formulario web</strong> — desde la pestaña Gastos, click en "+ Agregar gasto"
            </li>
            <li>
              <strong>Importación CSV</strong> — subí un archivo con tus movimientos bancarios
            </li>
          </ul>
          <p>
            <strong>Categorización con IA:</strong> Cuando registrás un gasto, la inteligencia
            artificial lo categoriza automáticamente. Si la categoría no es la correcta, podés
            cambiarla haciendo click en el gasto y seleccionando otra categoría.
          </p>
          <p>
            <strong>Sugerencias de categorías:</strong> Si tenés gastos sin categorizar, la app te
            muestra sugerencias inteligentes. Aceptalas con un click o ignoralas.
          </p>
          <p>
            <strong>Gastos en cuotas:</strong> Cuando registrás un gasto en cuotas, la app lo divide
            automáticamente y lo trackea mes a mes. Los gastos en cuotas aparecen en la sección
            Cuotas.
          </p>
        </Section>

        <Section title="Reportes">
          <p>La sección de reportes te ayuda a entender tus hábitos de gasto:</p>
          <ul>
            <li>
              <strong>Reporte mensual</strong> — desglose por categoría con gráficos de barras y
              donut
            </li>
            <li>
              <strong>Tendencias</strong> — cómo cambiaron tus gastos mes a mes
            </li>
            <li>
              <strong>Proyecciones</strong> — estimación de gasto futuro basada en tu historial
            </li>
            <li>
              <strong>Comparativas</strong> — compará dos meses lado a lado
            </li>
          </ul>
          <p>
            <strong>Resumen semanal por Telegram:</strong> Si lo activás en Configuración, cada
            lunes recibís un resumen de tu semana anterior directamente en Telegram con los totales
            por categoría.
          </p>
        </Section>

        <Section title="Inversiones">
          <p>Si tenés inversiones, podés seguirlas desde la sección Inversiones:</p>
          <ul>
            <li>
              <strong>FCI (Fondos Comunes de Inversión)</strong> — seguimiento de precio y
              rentabilidad
            </li>
            <li>
              <strong>Plazos fijos</strong> — tracking de vencimientos y tasas
            </li>
            <li>
              <strong>Cauciones</strong> — operaciones a plazo fijo con el mercado
            </li>
          </ul>
          <p>
            Los precios se actualizan automáticamente. Podés agregar inversiones manualmente o
            importar datos.
          </p>
        </Section>

        <Section title="Configuración">
          <p>Accedé a tu configuración haciendo click en tu usuario en la barra lateral.</p>
          <ul>
            <li>
              <strong>Tema:</strong> claro u oscuro (se adapta automáticamente a tu sistema)
            </li>
            <li>
              <strong>Autenticación de dos factores (MFA):</strong>增加了安全层，requiere un código
              de tu app de autenticación al iniciar sesión
            </li>
            <li>
              <strong>Cambiar contraseña:</strong> desde el panel de configuración
            </li>
            <li>
              <strong>IA y sugerencias:</strong> activá o desactivá la categorización automática y
              las sugerencias inteligentes
            </li>
            <li>
              <strong>Resumen semanal:</strong> activá el envío de reportes por Telegram
            </li>
            <li>
              <strong>Grupo familiar:</strong> compartí la cuenta con tu familia para ver gastos
              conjuntos
            </li>
          </ul>
        </Section>

        <Section title="Privacidad y seguridad">
          <p>Tu seguridad es nuestra prioridad:</p>
          <ul>
            <li>
              <strong>Contraseñas encriptadas</strong> — usamos bcrypt, nunca almacenamos
              contraseñas en texto plano
            </li>
            <li>
              <strong>Sesiones JWT</strong> — tokens seguros que expiran automáticamente
            </li>
            <li>
              <strong>Datos voluntarios</strong> — podés usar la app sin cargar ningún dato
              financiero
            </li>
            <li>
              <strong>Eliminación total</strong> — eliminá tu cuenta y todos tus datos en cualquier
              momento desde Configuración
            </li>
            <li>
              <strong>Código abierto</strong> — nuestro código está publicado en GitHub para que
              cualquiera pueda auditarlo
            </li>
          </ul>
        </Section>

        <Section title="Preguntas frecuentes">
          <dl className="space-y-4">
            <div>
              <dt className="font-semibold text-[var(--text-primary)]">
                ¿Puedo usar Oikonomia desde el celular?
              </dt>
              <dd className="text-sm text-[var(--text-secondary)] mt-1">
                Sí, la app web funciona perfectamente desde el celular. También tenés el bot de
                Telegram para registrar gastos rápido.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--text-primary)]">
                ¿Necesito saber de finanzas?
              </dt>
              <dd className="text-sm text-[var(--text-secondary)] mt-1">
                Para nada. La IA se encarga de categorizar y analizar; vos solo registrás los
                gastos.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--text-primary)]">
                ¿Qué pasa si registro un gasto mal?
              </dt>
              <dd className="text-sm text-[var(--text-secondary)] mt-1">
                Podés editarlo o eliminarlo desde la pestaña Gastos. Hacé click en el gasto para ver
                los detalles y modificarlo.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-[var(--text-primary)]">
                ¿Puedo importar datos de mi banco?
              </dt>
              <dd className="text-sm text-[var(--text-secondary)] mt-1">
                Sí, podés importar archivos CSV desde el botón de importación en la barra lateral.
                La app procesa el archivo y categoriza los gastos automáticamente.
              </dd>
            </div>
          </dl>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-xl font-bold text-[var(--text-primary)] mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-[var(--text-secondary)] leading-relaxed">
        {children}
      </div>
    </section>
  );
}
