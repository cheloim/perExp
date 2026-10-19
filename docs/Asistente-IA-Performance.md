# Asistente IA — performance

Mediciones del modal del asistente (issue #415). Todo está reproducible con:

```bash
cd src/frontend
npx playwright test e2e/assistant-perf.spec.ts
```

## 1. Renders por chunk durante el streaming — mejoró

Este es el hallazgo principal. Antes de este PR cada chunk del stream re-renderizaba
todos los bubbles de la conversación, porque `Bubble` no estaba envuelta en
`React.memo` (el comentario del código decía "memoized" pero no lo estaba).

`formatAIResponse` — que parsea markdown, tablas y listas — se re-ejecutaba sobre
**todos** los mensajes ya renderizados, en **cada** chunk.

Medido con el contador dev-only de `Bubble` (`window.__BUBBLE_RENDERS__`),
comparando la misma conversación de 3 chunks con dos tamaños de historial:

| Historial | Sin `memo`  | Con `memo` | Reducción |
| --------- | ----------- | ---------- | --------- |
| 4 msgs    | 32 renders  | 6 renders  | **−81 %** |
| 40 msgs   | 248 renders | 6 renders  | **−98 %** |

Lectura importante: **el número con `memo` es 6 en ambos casos.** Eso es lo que
hace que el arreglo sea O(1) por chunk en vez de O(n): el costo no crece con el
tamaño de la conversación. Sin `memo` crece linealmente (4 msgs → 32,
40 msgs → 248, ≈6 renders por mensaje por corrida).

Por qué el `memo` alcanza: el reducer del streaming copia el array pero conserva
los objetos intactos (`u = [...prev]` y después reemplaza solo la cola). Entonces
`msg` compara igual en todos los bubbles menos el último, y `streaming` también
(`streaming && i === messages.length - 1` es `false` para todos los anteriores).

El test `a streaming chunk renders one bubble, not the whole history` en
`assistant-perf.spec.ts` hace estas dos corridas y afirma que `|long − short| ≤ 2`
y que el absoluto queda bajo 20. Un conteo determinista, no un assertion de timing
— un timing en CI solo flakearía.

## 2. Tiempo de apertura del modal — no mejoró

Instrumentación: `toggleDrawer` marca `ai-assistant:open-start`, `AIAssistant`
marca `ai-assistant:open-end` en el segundo `requestAnimationFrame` (primer frame
pintado tras montar la tarjeta). El resultado queda en
`window.__AI_ASSISTANT_OPEN_MS__` y lo lee el test.

Mediana de 8 aperturas consecutivas, desktop 1440×900:

| Versión                    | Mediana | Mín  | Máx  |
| -------------------------- | ------- | ---- | ---- |
| Antes (panel)              | 27.6 ms | 25.8 | 33.3 |
| Después (tarjeta centrada) | 30.8 ms | 28.0 | 46.3 |

**El modal no abre más rápido.** Queda ~3 ms más lento, dentro del ruido de medición
y en ambos casos muy por debajo del presupuesto de 300 ms.

Es esperable, no un regression: la tarjeta centrada renderiza bastante más que el
panel lateral de `w-96` — chips de sugerencia, hints de teclado, contador de
caracteres, header con tabs. Se paga ~3 ms por mostrar toda esa superficie.

Lo que sí se verifica es que **no** hay degradación ni fuga por reapertura: el test
`reopening stays within budget` abre y cierra 5 veces y afirma que cada apertura
queda dentro del presupuesto y que la quinta no se aleja de la primera más allá de
`primera × 3 + 50 ms`.

### Presupuesto

`OPEN_BUDGET_MS = 300`. Es deliberadamente holgado: el objetivo es detectar que
abrir la tarjeta no se volvió cuadrático ni se traba cargando un chunk diferido,
no certificar un SLA. Un número apretado en CI solo flakearía.

## 3. Hilo largo no bloquea la interacción

Con 40 mensajes sembrados y renderizados, teclear en el composer y ver el valor
reflejado debe tardar menos de 1500 ms. Cubre el caso en el que el render del
historial saturaría el hilo principal.

## Cómo se mide

El contador de renders (`countBubbleRender`) va gateado con `import.meta.env.DEV`,
que Vite resuelve estáticamente a `false` en producción y tree-shakea. No viaja en
el build de producción; solo existe en el dev server que levanta Playwright.

Para re-correr la línea base de la tabla 1: envolver la definición de `Bubble`
sin `memo` y correr el test — espera 32 / 248 y el assertion de `≤ 2` de
diferencia falla, que es exactamente lo que debe fallar si alguien rompe el memo.
