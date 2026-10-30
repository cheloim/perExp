# Issue 466 — UI interna de revisión de categorización

**Status:** Implementado
**Date:** 2026-10-29
**Related:** issue #466, issue #414 (detector/API/CLI), issue #470 (piloto, *Not Doing*),
PR del feature en `feat/categorization-review-ui`.

---

## 1. Qué se construyó

Un tab **Categorización** en el panel de admin (`/x/:slug`), junto a
Usuarios / Logs / Reportes / Sistema / Métricas. Es la interface de revisión de las
revisiones que genera el detector de #414.

- **Resumen**: pendientes, aceptadas, rechazadas, `manual_precision`, conteo por señal
  y última corrida del job diario (`categorization-review-scan-daily`, leída de
  `/admin/system/tasks`).
- **Filtros**: estado, usuario, rango de score, señal, rango de fechas del gasto y
  búsqueda por comercio.
- **Tabla**: fecha, comercio, monto, categoría actual → sugerida, score, estado.
- **Detalle expandible**: evidencia completa (keywords de la categoría, merchant key,
  señales con sus pesos y detalles, veredicto del LLM). Si el detector no propuso
  categoría, aparece un selector con las categorías **del dueño del gasto**.
- **Acciones por fila**: aceptar, rechazar (con confirmación), investigar.
- **Acciones masivas**: aceptar todo lo pendiente con score ≥ umbral (máx. 50 por vez).
- **Exportar CSV** de la lista filtrada (hasta 200 filas).
- **Escanear ahora** para un usuario, forward-only.

Nada de esto se muestra al usuario final, al chat ni al banner de `ExpensesPage`.

## 2. Decisiones

1. **Forward-only, sin tocar el pasado.** El botón de escaneo manda sólo
   `{ user_id, use_llm }`; nunca `since`. Usa la ventana del job (últimos 7 días sobre
   `created_at`). Los filtros de fecha son de lectura: no disparan escaneos ni
   modifican gastos. Las acciones sólo actúan sobre `pending`; ninguna revisión
   resuelta se reabre.
2. **Cambios aditivos en el backend.** Los filtros nuevos son opcionales (`None` por
   defecto): sin ellos la respuesta es idéntica a la anterior. El detalle agrega
   `available_categories` con default `[]`. `summary` conserva `observed_precision` y
   agrega `manual_precision` y `bulk_accepted`.
3. **Búsqueda por comercio reusa `expense_matches`.** `expenses.description` está
   cifrada, así que no hay `LIKE`: se descifra en memoria, se filtra después de los
   filtros SQL y antes de paginar (mismo helper canónico que `GET /expenses`).
4. **Bulk no valida al detector.** `accept_review(..., bulk=True)` marca
   `bulk_applied` y `manual_precision` excluye esas filas. Sin esto, "aceptar todo lo
   que supere el umbral" produciría la métrica que justifica la propia función.
5. **Sin archivo gigante.** `AdminPage.tsx` ya tenía 1692 líneas y cinco tabs. El tab
   vive en `pages/admin/CategorizationReviewTab.tsx` (contenedor) y
   `pages/admin/ReviewEvidence.tsx` (detalle). De paso, la cadena de ternarios del
   label de tabs pasó a un `Record<Tab, string>`.

## 3. Archivos

| Archivo | Cambio |
| ------- | ------ |
| `src/frontend/src/pages/admin/CategorizationReviewTab.tsx` | nuevo: resumen, filtros, tabla, acciones, bulk, CSV, scan |
| `src/frontend/src/pages/admin/ReviewEvidence.tsx` | nuevo: detalle expandible + selector de categoría |
| `src/frontend/src/utils/csv.ts` | nuevo: `toCsv` / `downloadCsv` |
| `src/frontend/src/pages/AdminPage.tsx` | tab nuevo + `TAB_LABELS` |
| `src/frontend/src/api/client.ts`, `src/frontend/src/types/index.ts` | tipos y llamadas |
| `src/backend/app/routers/admin_categorization.py` | filtros, `available_categories`, `bulk-accept` |
| `src/backend/app/services/categorization_review.py` | `bulk` en `accept_review`, precisión manual |
| `src/backend/app/models/ai.py` | columna `bulk_applied` |
| `src/backend/alembic/versions/000000000002_*.py` | migración de `bulk_applied` |
| docs (`openapi.yaml`, API-Reference, Data-Model, spec) | contrato y documentación |

## 4. Verificación

- Backend: `tests/test_categorization_review_api.py` (28 tests), suite completa 648
  tests, `test_openapi_contract.py` en verde tras actualizar el contrato curado.
- Frontend: `csv.test.ts` (4), `ReviewEvidence.test.tsx` (7),
  `CategorizationReviewTab.test.tsx` (12), `AdminPage.test.tsx` (2), suite completa
  153 tests.
- Estáticos: `tsc --noEmit`, ESLint, Prettier, Ruff (check + format) y MyPy.
- Manual: pendiente de deploy; el tab es desktop-only como el resto del panel.

## 5. Qué quedó afuera

- Ordenamiento por columnas y paginación configurable.
- Export PDF y programación de export.
- Recalibración de pesos: el piloto (#470) se cerró como *Not Doing*, así que los
  pesos siguen siendo los iniciales. La UI deja la puerta abierta a etiquetar a mano
  si se retoma la validación.
- Cualquier exposición al usuario final: sigue fuera de alcance por diseño.

## 6. Nota sobre #470

El piloto forward-only se cerró como *Not Doing* porque la evidencia era difícil de
recolectar (volumen y etiquetado manual). Eso **no** valida el detector: queda interno
y detrás de `categorization_review_enabled`, sin superficie para el usuario. La
consecuencia está registrada en `docs/analysis/ISSUE-414-categorization-review.md`.
