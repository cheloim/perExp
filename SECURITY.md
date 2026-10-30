# Política de seguridad

## Reportar una vulnerabilidad

**No abras un issue público.** El repositorio es público y un issue describe la superficie
antes de que esté corregida.

Usá una de estas vías:

1. [Private vulnerability reporting](https://github.com/cheloim/perExp/security/advisories/new)
   (recomendado).
2. Si no tenés acceso, contactá al mantenedor por el canal indicado en el perfil del repo.

Incluí:

- Componente y versión/commit afectado.
- Condiciones para reproducirlo.
- Impacto observado (confidencialidad, integridad, disponibilidad).
- Una prueba de concepto mínima, si la tenés.

## Qué esperar

| Etapa | Plazo objetivo |
|---|---|
| Acuse de recibo | 72 horas |
| Evaluación inicial y severidad | 7 días |
| Corrección o mitigación | Según severidad: crítica < 7 días, alta < 30 días |
| Divulgación | Coordinada, después del fix |

## Alcance

**En alcance:** API, frontend, bots, autenticación, aislamiento entre usuarios y grupos,
cifrado de campos, importación de archivos, integraciones LLM.

**Fuera de alcance:** ataques que requieren acceso físico al dispositivo del usuario,
ingeniería social, denegación de servicio volumétrica contra la infraestructura, y
vulnerabilidades en dependencias sin un camino de explotación en este producto.

## Prácticas del proyecto

- Los secretos van en Podman secrets, nunca en el repositorio.
- Los campos con PII se cifran a nivel de aplicación; ver `docs/Security.md`.
- El contrato de API se valida en CI.
- Las dependencias se actualizan con Dependabot (mensual, agrupado).

## Advisories abiertos

El estado se consulta en
<https://github.com/cheloim/perExp/security/advisories>. No se replica el detalle en
documentos versionados mientras el fix no esté desplegado.
