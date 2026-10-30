# Documentación de Oikonomia

Este directorio es la fuente de conocimiento del proyecto. **Regla número uno: un tema,
un documento canónico.** Si dos documentos describen lo mismo, uno de los dos está de más.

## Matriz de autoridad

| Tema | Documento canónico | Dueño | Verificado |
|---|---|---|---|
| Arquitectura del sistema | `specs/architecture/system-overview.md` | Backend | 2026-10-30 |
| Stack y versiones | `specs/architecture/tech-stack.md` | Backend | pendiente (ver #532) |
| Modelo de datos | `Data-Model.md` | Backend | 2026-10-30 |
| Contrato de API | `specs/openapi.yaml` | Backend | automático (gate CI) |
| Reglas de diseño de API | `specs/architecture/api-design-rules.md` | Backend | 2026-08-29 |
| Autenticación y sesiones | `Authentication.md` | Backend | 2026-10-30 |
| Seguridad y cifrado | `Security.md` | Backend | 2026-10-30 |
| Claves y rotación | `Key-Management.md` | Backend | 2026-10-30 |
| Migraciones de esquema | `Migrations.md` | Backend | 2026-10-30 |
| Configuración y entorno | `Configuration.md` | Backend | 2026-10-30 |
| Frontend: rutas, estado, API | `Frontend.md` | Frontend | 2026-10-30 |
| Design system | `Design-System.md` | Frontend | 2026-10-30 |
| Accesibilidad | `Accessibility.md` | Frontend | 2026-10-30 |
| Asistente IA | `Asistente-IA-*.md` | Frontend | 2026-10-25 |
| Integración LLM | `AI-Integration.md` | Backend | 2026-10-30 |
| Bot de Telegram | `Telegram-Bot.md` | Backend | 2026-10-30 |
| Importación inteligente | `Smart-Import.md` | Backend | 2026-06-29 |
| Presupuestos | `Budgets.md` | Backend | 2026-10-15 |
| Inversiones | `Investments.md` | Backend | 2026-06-29 |
| Grupos familiares | `Family-Groups.md` | Backend | 2026-06-29 |
| Cache | `Cache.md` | Backend | 2026-10-12 |
| Deploy y operación | `Deployment.md` | Infra | 2026-10-24 |
| Observabilidad | `Monitoring.md` | Infra | 2026-10-04 |
| Roadmap | `Roadmap.md` | Producto | automático |
| Decisiones de arquitectura | `adr/` | Arquitectura | ver #533 |
| Incidentes y restauración | `runbooks/` | Infra | ver #533 |

> Los documentos marcados con fecha **2026-06-29** o **2026-08-29** están pendientes de
> revisión. El listado completo, con veredicto y evidencia del desvío, está en
> `analysis/audit-2026-10/index.html`.

## Qué no se documenta acá

- **Contrato de API:** vive en `specs/openapi.yaml`. `API-Reference.md` es solo un índice
  que apunta a Swagger/Redoc. No se mantiene a mano.
- **Modelo de datos:** se deriva de `src/backend/app/models/`. `Data-Model.md` explica las
  relaciones y las decisiones; las columnas se leen del código.
- **Planes ya ejecutados:** van a `archive/`, no quedan mezclados con documentación viva.

## Cómo mantener esto

1. Si cambiás un endpoint, actualizá `specs/openapi.yaml` y regenerá el cliente
   (`npm run generate:api`).
2. Si cambiás un tema con documento canónico, actualizá ese documento y su fecha de
   verificación en esta matriz.
3. Si agregás un feature, agregá su spec en `specs/features/` y su entrada acá.
4. Si un documento deja de ser cierto, **se corrige o se archiva**, no se deja.

El gate de CI que valida paths y estados está trackeado en
[#531](https://github.com/cheloim/perExp/issues/531).

## Estructura

```
docs/
├── README.md                 ← este archivo (matriz de autoridad)
├── Home.md                   ← hub para la wiki
├── *-*.md                    ← documentación por dominio
├── adr/                      ← decisiones de arquitectura (pendiente, #533)
├── analysis/                 ← auditorías y análisis puntuales
├── archive/                  ← documentos históricos, no vigentes
├── guides/                   ← guías operativas
├── runbooks/                 ← respuesta a incidentes (pendiente, #533)
├── specs/
│   ├── openapi.yaml          ← contrato curado (fuente de verdad de la API)
│   ├── architecture/         ← diseño técnico
│   └── features/             ← specs por feature
└── migrations/               ← migraciones históricas
```
