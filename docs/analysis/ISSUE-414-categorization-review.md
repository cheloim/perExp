# Issue 414 — Detector de gastos mal categorizados

**Status:** Implementado (fases 1 y 2). El piloto forward-only se cerró como *Not Doing* (#470).
**Date:** 2026-10-24 (actualizado 2026-10-29)
**Related:** issue #414, issue #466 (UI interna, implementada), issue #470 (piloto, Not Doing), PR #453 (causa raíz del matcher)

## Summary

Detectar gastos que **ya tienen categoría** pero parecen mal categorizados, guardarlos
como revisiones internas (`categorization_reviews`) y dejar que un analista las resuelva.
Nada de esto llega al usuario final, al chat ni al flujo de `/suggestions`.

---

## 1. El caso que disparó todo: YENNY TORTUGAS

> En la categoría *Electricidad & Gas* figura un consumo de **$55,479.67** de
> **"YENNY TORTUGAS OPEN MALL"** el 13/10. Esto es una librería/shopping y no un
> servicio público; tu gasto real recurrente de servicios fue únicamente Edenor.

**Causa raíz (ya corregida en PR #453):** el matcher por keywords hacía *substring*,
así que `"gas"` matcheaba dentro de `"TORTUGAS"` y clasificaba la compra como
Electricidad & Gas. Desde #453 el matching es por palabra completa (`gas` ya no
matchea `gaseosa` ni `tortugas`), con tier 3 = palabra completa, 2 = prefijo
(largo ≥ 4), 1 = substring (largo ≥ 4).

Eso arregla la regla para gastos **nuevos**, pero deja el daño histórico y no cubre
otros patrones. Por eso existe este detector: re-marcar lo que ya quedó mal
categorizado y vigilar lo que entra de ahora en adelante. El caso queda como
fixture de regresión (`test_tortugas_does_not_match_gas`,
`test_yenny_tortugas_en_electricidad_se_marca`).

---

## 2. Fuentes de datos y criterios

**No existe MCC en el modelo de datos.** Lo que sí tenemos:

| Fuente                           | Campo                       | Uso en el detector |
| -------------------------------- | --------------------------- | ------------------ |
| Descripción (cifrada en reposo)  | `expenses.description`      | matching por keywords, clave de comercio |
| Clave de comercio normalizada    | `_normalize_merchant_key`   | historial del comercio, preferencias |
| Monto                            | `expenses.amount`           | outlier dentro de la categoría |
| Fecha                            | `expenses.date`             | ventana de contexto |
| Categoría actual                 | `expenses.category_id`      | sujeto de la revisión |
| Keywords de la categoría         | `categories.keywords`       | `category_keyword_miss`, `keyword_conflict` |
| Historial del usuario            | últimos 365 días, tope 5000 gastos | cobertura de keywords, mayoría por comercio |
| Preferencias por comercio        | `merchant_preferences`      | ya la usa el flujo de sugerencias |
| Recurrencia / ingresos           | `recurring_expense_id`, `is_income` | exclusiones |

Criterios de exclusión: gastos sin categoría, ingresos, y ruido de pagos
(`_should_skip`: "su pago en pesos", "pago mínimo", etc.).

---

## 3. Señales y scoring

Pesos iniciales en `app/services/categorization_review.py` (se recalibran con los
resultados del piloto):

| Señal                 | Peso            | Condición |
| --------------------- | --------------- | --------- |
| `keyword_conflict`    | 0.50 (tier 3) / 0.35 (tier 2) | el matcher determinístico prefiere otra categoría hoja |
| `category_keyword_miss` | 0.30 | el comercio no pega con ninguna keyword de su categoría y es nuevo en ella |
| ↳ + historial         | +0.15 | la categoría tiene ≥ 5 gastos propios |
| ↳ + cobertura         | +0.15 | ≥ 60% de los gastos de la categoría sí matchean sus keywords |
| ↳ + ajuste            | +0.10 | ≥ 12 gastos y ≥ 80% de cobertura |
| `history_conflict`    | 0.40 / 0.45 | el mismo comercio (exacto o fuzzy ≥ 0.88) vive ≥ 80% en otra categoría |
| `amount_outlier`      | 0.10 | z robusto (MAD) > 6 contra la distribución de la categoría. **Nunca dispara sola** |
| `llm_second_opinion`  | +0.20 / −0.20 | el LLM confirma el desvío / dice que está bien (confianza ≥ 0.6) |

- Se persiste con `score >= 0.50`; `>= 0.70` se considera alta confianza.
- El contexto se construye **excluyendo el lote bajo análisis**: lo que importa es el
  comportamiento previo del usuario, no el propio lote.
- `detector_version` hace idempotente el escaneo
  (`UniqueConstraint(expense_id, detector_version)`).

### LLM como segunda opinión

Una sola llamada por lote de 25 gastos (`feature="categorization_review"`), sólo
para los candidatos que las reglas ya marcaron. Pide `is_mismatch`,
`suggested_category_id`, `confidence` y `reason`. Lo que el modelo invente
(`expense_id`, categoría inexistente) se descarta entrada por entrada; si el lote
falla, las reglas siguen valiendo. Tapa el caso donde las reglas marcan pero no
saben qué categoría proponer — el caso YENNY, por ejemplo, termina con
`Accesorios` en vez de quedar sin sugerencia.

---

## 4. Decisiones tomadas

1. **Forward-only.** No se reprocesa el histórico. El job diario mira
   `expenses.created_at` de los últimos 7 días (filas nuevas, aunque la transacción
   sea vieja por una importación). El AC original pedía un piloto sobre 3 meses de
   datos; se acordó reemplazarlo por un piloto hacia adelante (ver §5).
2. **Tabla propia, no `category_suggestions`.** Esa tabla es para gastos **sin
   categoría**, alimenta el banner del usuario y tiene `expense_id` único. Meter
   revisiones ahí las filtraría hacia el usuario.
3. **Sin UI al principio.** La revisión se hace por API admin o CLI durante la fase 1.
   La UI interna llegó después, en #466 (ver
   `docs/analysis/ISSUE-466-categorization-review-ui.md`).
4. **Feature flag `categorization_review_enabled`**, apagado por defecto. Se activa
   con el panel de flags existente (global o por usuario).
5. **Sin notificaciones ni chat.** A diferencia de `suggest_uncategorized`, este job
   no crea nada visible.

---

## 5. Piloto (forward-only)

1. Deploy con `categorization_review_enabled` en `false`.
2. Activar la flag para el usuario piloto.
3. Acumular revisiones durante **30 días o hasta 100 revisiones**, lo que pase
   primero (extensible a 90 días si el volumen es bajo).
4. Etiquetar a mano 30–50 revisiones y calcular precisión
   (`accepted / (accepted + rejected)` lo mide también `summary`).
5. Reportar: volumen cada 1000 transacciones, precisión por señal, falsos
   positivos típicos, aporte del LLM y costo.

Herramientas:

```bash
# desde src/backend
python -m scripts.categorization_review scan --user-id 3 --dry-run
python -m scripts.categorization_review scan --user-id 3
python -m scripts.categorization_review report
python -m scripts.categorization_review list --status pending --min-score 0.5
python -m scripts.categorization_review show 12
python -m scripts.categorization_review accept 12 --category-id 17
python -m scripts.categorization_review reject 12
python -m scripts.categorization_review investigate 12
```

**Resultados del piloto:** **no se ejecutó**. La recolección de evidencia se evaluó como
inviable en el corto plazo (volumen insuficiente en la ventana forward-only y etiquetado
manual de 30–50 casos sin equipo dedicado), así que #470 se cerró como *Not Doing* el
2026-10-29. Consecuencia explícita: **el detector no tiene precisión medida** y sigue
siendo una herramienta interna, detrás de `categorization_review_enabled`, sin exposición
al usuario final. La UI de #466 se construyó igual porque es la herramienta que haría
posible ese etiquetado si se retoma; `summary` ahora separa `manual_precision` de
`observed_precision` para que una decisión futura no se apoye en aceptaciones masivas.

---

## 6. Evaluación del banner "IA sugirió categorías"

Hoy (`src/frontend/src/pages/ExpensesPage.tsx`) es un **banner + chips inline**, no
un modal: título "✨ IA sugirió categorías para N gastos", acciones "Aplicar todas
(≥70%)" y "Descartar todas", y por fila un chip con la sugerencia y aceptar/rechazar.

Qué funciona: aceptar por fila es explícito y reversible; el umbral evita aplicar
adivinanzas.

Qué falta para el flujo que pide el issue:

- El umbral 0.7 está hardcodeado; convendría configurable (60–90%) como setting.
- No hay "descartar y enviar a investigación": hoy descartar pierde la evidencia.
- No se muestra el porqué de la sugerencia (keywords, historial).
- Es un flujo para gastos **sin categoría**; las revisiones de mala categorización
  son otro problema y no deberían mezclarse ahí.

**Propuesta (fase 2, condicionada a precisión ≥ 0.8 en el piloto):**
umbral configurable, evidencia visible en el chip, acción "no es un error" que
mande la sugerencia a investigación, y un flujo separado para mal categorizados.
Hasta validar el detector, **no se muestran sugerencias al usuario final ni en el
chat** (criterio de aceptación del issue).

**Estado (2026-10-29):** el flujo separado para mal categorizados se implementó en
#466 como tab interno de admin (`Categorización`), no en el banner del usuario. El
umbral configurable y la evidencia visible quedaron ahí, aplicados a las revisiones
internas. El banner de `ExpensesPage` no se tocó. Con el piloto cerrado como *Not
Doing*, nada de esto se expone al usuario final.

---

## 7. Riesgos

| Riesgo | Mitigación |
| ------ | ---------- |
| Falsos positivos de `category_keyword_miss` (proveedor nuevo en categoría válida) | revisión interna, LLM como segunda opinión, umbrales calibrados con el piloto |
| Costo LLM | sólo candidatos, batches de 25, tope 50 por usuario por corrida, flag apagado por defecto |
| Privacidad | descripciones cifradas; los logs del detector usan IDs, no descripciones |
| Ventana de historial costosa | se lee una vez por usuario y acota a 5000 gastos |

## 8. Criterios de aceptación — estado

| Criterio | Estado |
| -------- | ------ |
| Fuentes y criterios documentados | ✅ §2 |
| Proceso que marca y persiste sugerencias (transacción, categoría actual, sugerida, score, evidencia) | ✅ `CategorizationReview` + job diario + CLI |
| API/interna para listar y actualizar estados | ✅ `/admin/categorization-reviews` |
| Tests de reglas/estimadores | ✅ `test_categorization_review*.py`, regresión YENNY |
| Piloto con resultados y ejemplos | ❌ No se ejecuta (*Not Doing*, #470) |
| Nada de sugerencias en el chat hasta validar | ✅ sin cambios en `/suggestions` ni chat |
| Evaluación documentada del modal | ✅ §6 |
| UI interna de revisión (#466) | ✅ tab `Categorización` + bulk/CSV/scan forward-only |
