export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[var(--color-base)] py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition mb-8"
        >
          ← Volver a oikonomia
        </a>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
          Política de Privacidad
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mb-8">Última actualización: julio 2026</p>
        <div className="space-y-6 text-[var(--text-secondary)]">
          <Section title="1. Datos que recopilamos">
            <p>Para utilizar oikonomia, recopilamos la siguiente información:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Cuenta (obligatorio):</strong> nombre, dirección de email y contraseña
                (encriptada).
              </li>
              <li>
                <strong>Gastos e ingresos (voluntario):</strong> descripción, monto, fecha,
                categoría y medio de pago. Solo se registran si vos los cargás activamente.
              </li>
              <li>
                <strong>Tarjetas y cuentas (voluntario):</strong> nombre de la tarjeta, banco y tipo
                (crédito/débito). Solo se registran si vos los creás activamente.
              </li>
              <li>
                <strong>Inversiones (voluntario):</strong> tipo de inversión, monto y fecha. Solo se
                registran si vos las cargás activamente.
              </li>
              <li>
                <strong>Datos de autenticación:</strong> si utilizás Google para iniciar sesión,
                recibimos tu email y nombre de perfil de Google.
              </li>
            </ul>
            <p className="mt-2 text-sm">
              Los datos financieros son enteramente voluntarios. Podés usar oikonomia solo con tu
              cuenta sin cargar ningún dato financiero.
            </p>
          </Section>
          <Section title="2. Cómo usamos tus datos">
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Procesar y categorizar tus gastos con inteligencia artificial.</li>
              <li>Generar reportes y análisis financieros personalizados.</li>
              <li>Enviarte notificaciones por Telegram (solo si lo configurás).</li>
              <li>Enviarte emails de verificación, recuperación de contraseña y reportes.</li>
              <li>Mejorar la experiencia del producto.</li>
            </ul>
          </Section>
          <Section title="3. Almacenamiento y seguridad">
            <p>
              Tus datos se almacenan en servidores seguros ubicados en Estados Unidos. Utilizamos
              cifrado en tránsito (TLS) y en reposo. Las contraseñas se almacenan con bcrypt (hash
              unidireccional). Las sesiones utilizan JWT con expiración configurable.
            </p>
          </Section>
          <Section title="4. Servicios de terceros">
            <p>Utilizamos los siguientes servicios para operar oikonomia:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Google:</strong> autenticación OAuth (inicio de sesión con Google).
              </li>
              <li>
                <strong>Resend:</strong> envío de emails transaccionales.
              </li>
              <li>
                <strong>Telegram:</strong> bot para registro rápido de gastos y notificaciones.
              </li>
              <li>
                <strong>Google Gemini:</strong> procesamiento de lenguaje natural para
                categorización de gastos.
              </li>
              <li>
                <strong>Linode:</strong> alojamiento de la infraestructura del servidor.
              </li>
            </ul>
          </Section>
          <Section title="5. Tus derechos">
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Acceso:</strong> podés solicitar una copia de todos tus datos.
              </li>
              <li>
                <strong>Eliminación:</strong> podés solicitar la eliminación completa de tu cuenta y
                datos.
              </li>
              <li>
                <strong>Exportación:</strong> podés exportar tus gastos en formato CSV.
              </li>
              <li>
                <strong>Rectificación:</strong> podés modificar o eliminar cualquier gasto en
                cualquier momento.
              </li>
            </ul>
          </Section>
          <Section title="6. Cookies y tracking">
            <p>
              oikonomia no utiliza cookies de rastreo ni publicidad. La única cookie utilizada es
              para mantener tu sesión de inicio (JWT en localStorage).
            </p>
          </Section>
          <Section title="7. Cambios en esta política">
            <p>
              Nos reservamos el derecho de actualizar esta política de privacidad. Los cambios se
              publicarán en esta página con la fecha de última actualización.
            </p>
          </Section>
          <Section title="8. Contacto">
            <p>
              Si tenés preguntas sobre esta política de privacidad o sobre el tratamiento de tus
              datos, contactanos a{" "}
              <a
                href="mailto:contacto@oikonomia.ar"
                className="text-[var(--color-primary)] hover:underline"
              >
                contacto@oikonomia.ar
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">{title}</h2>
      {children}
    </div>
  );
}
