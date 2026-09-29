export default function TermsPage() {
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
          Términos y Condiciones
        </h1>
        <p className="text-sm text-[var(--text-tertiary)] mb-8">Última actualización: julio 2026</p>
        <div className="space-y-6 text-[var(--text-secondary)]">
          <Section title="1. Aceptación de los términos">
            <p>
              Al crear una cuenta o utilizar oikonomia, aceptás estos Términos y Condiciones. Si no
              estás de acuerdo con alguno de los términos, no utilices el servicio.
            </p>
          </Section>

          <Section title="2. Descripción del servicio">
            <p>
              oikonomia es una aplicación de finanzas personales que permite registrar gastos e
              ingresos, gestionar tarjetas y cuentas bancarias, realizar seguimiento de inversiones,
              y obtener análisis e informes generados con inteligencia artificial.
            </p>
            <p className="mt-2">
              El servicio se ofrece a través de una aplicación web, un bot de Telegram y un bot de
              WhatsApp. Todas las funcionalidades son gratuitas sin planes premium ni funciones
              bloqueadas.
            </p>
          </Section>

          <Section title="3. Cuenta del usuario">
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                Para utilizar oikonomia debés crear una cuenta con un email válido y una contraseña
                segura.
              </li>
              <li>
                Sos responsable de mantener la confidencialidad de tu contraseña y de toda la
                actividad que ocurra bajo tu cuenta.
              </li>
              <li>
                Podés vincular tu cuenta con Google para iniciar sesión. Al hacerlo, autorizás a
                oikonomia a acceder a tu nombre y email de perfil.
              </li>
              <li>
                Podés vincular tu cuenta con Telegram o WhatsApp para registrar gastos desde esos
                canales.
              </li>
              <li>
                Debés tener al menos 16 años para crear una cuenta.
              </li>
            </ul>
          </Section>

          <Section title="4. Uso aceptable">
            <p>Al utilizar oikonomia, te comprometés a:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Utilizar el servicio solo para fines personales o familiares legítimos.</li>
              <li>No intentar acceder a cuentas de otros usuarios.</li>
              <li>No utilizar el servicio para actividades ilegales.</li>
              <li>No sobrecargar, dañar o interferir con el funcionamiento del servicio.</li>
              <li>No intentar obtener acceso no autorizado a los sistemas de oikonomia.</li>
            </ul>
            <p className="mt-2">
              Nos reservamos el derecho de suspender o eliminar cuentas que violen estas
              condiciones.
            </p>
          </Section>

          <Section title="5. Datos financieros y privacidad">
            <p>
              Tus datos financieros (gastos, ingresos, tarjetas, inversiones) son 100% voluntarios.
              Podés utilizar oikonomia solo con tu cuenta sin cargar ningún dato financiero.
            </p>
            <p className="mt-2">
              El tratamiento de tus datos personales se rige por nuestra{" "}
              <a
                href="/privacy"
                className="text-[var(--color-primary)] hover:underline"
              >
                Política de Privacidad
              </a>
              .
            </p>
          </Section>

          <Section title="6. Propiedad intelectual">
            <p>
              El código fuente de oikonomia está licenciado bajo la{" "}
              <a
                href="https://www.gnu.org/licenses/gpl-3.0.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--color-primary)] hover:underline"
              >
                Licencia Pública General de GNU v3 (GPLv3)
              </a>
              . Cualquiera puede auditar, modificar y redistribuir el código bajo los términos de
              esta licencia.
            </p>
            <p className="mt-2">
              La marca "oikonomia", el logotipo y los contenidos visuales de la aplicación están
              protegidos por derechos de autor y no están incluidos en la licencia GPLv3.
            </p>
          </Section>

          <Section title="7. Servicios de terceros">
            <p>oikonomia utiliza los siguientes servicios de terceros:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>Google:</strong> autenticación OAuth.
              </li>
              <li>
                <strong>Telegram:</strong> bot para registro de gastos y notificaciones.
              </li>
              <li>
                <strong>WhatsApp:</strong> bot para registro de gastos.
              </li>
              <li>
                <strong>Google Gemini:</strong> procesamiento de lenguaje natural para categorización
                y análisis.
              </li>
              <li>
                <strong>Resend:</strong> envío de emails transaccionales.
              </li>
              <li>
                <strong>Linode:</strong> alojamiento de la infraestructura del servidor.
              </li>
            </ul>
            <p className="mt-2">
              El uso de estos servicios está sujeto a sus propios términos y condiciones.
            </p>
          </Section>

          <Section title="8. Limitación de responsabilidad">
            <p>
              oikonomia se ofrece "tal cual" y "según disponibilidad". No garantizamos que el
              servicio sea ininterrumpido, seguro o libre de errores.
            </p>
            <p className="mt-2">
              oikonomia no es un asesor financiero. Los análisis e informes generados con IA son
              informativos y no constituyen asesoramiento financiero profesional. Las decisiones
              financieras que tomes basándote en la información de oikonomia son de tu exclusiva
              responsabilidad.
            </p>
            <p className="mt-2">
              En ningún caso oikonomia será responsable por daños indirectos, incidentales,
              especiales o consecuentes derivados del uso o la imposibilidad de usar el servicio.
            </p>
          </Section>

          <Section title="9. Eliminación de cuenta">
            <p>
              Podés eliminar tu cuenta y todos tus datos en cualquier momento desde la sección de
              Configuración de la aplicación. La eliminación es permanente e irreversible.
            </p>
            <p className="mt-2">
              Si eliminás tu cuenta a través de WhatsApp, tus datos serán eliminados de conformidad
              con los requisitos de Meta. Podés solicitar la eliminación desde la configuración de
              tu cuenta de WhatsApp.
            </p>
          </Section>

          <Section title="10. Modificaciones">
            <p>
              Nos reservamos el derecho de modificar estos términos en cualquier momento. Los cambios
              se publicarán en esta página con la fecha de última actualización. El uso continuado
              del servicio después de la publicación de cambios constituye tu aceptación de los
              mismos.
            </p>
          </Section>

          <Section title="11. Ley aplicable">
            <p>
              Estos términos se rigen por las leyes de la República Argentina. Cualquier disputa
              derivada de estos términos será sometida a la jurisdicción de los tribunales
              competentes de la Ciudad Autónoma de Buenos Aires.
            </p>
          </Section>

          <Section title="12. Contacto">
            <p>
              Si tenés preguntas sobre estos términos y condiciones, contactanos a{" "}
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
