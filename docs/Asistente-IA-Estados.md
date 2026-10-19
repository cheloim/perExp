# Asistente IA — especificación de estados

Comportamiento del modal del asistente por estado (issue #415). Cada estado está
cubierto por `src/frontend/e2e/assistant-composer.spec.ts`; si cambiás el
componente y esa suite sigue verde, este documento sigue siendo cierto.

Fuente de verdad en código: `src/frontend/src/components/AIAssistant.tsx`.

## 1 · Idle (conversación vacía)

Condición: `messages.length === 0 && !streaming`.

- Estado vacío con sugerencias destacadas — cuatro chips de arranque
  (`SUGGESTIONS`). Al activarlos (click, `Enter` o `Space`) **pueblan el composer
  y devuelven el foco al textarea**, no envían.
- Botón primario **✨ Analizar gastos del mes**. Dispara `analyzeMonth`, que usa
  el endpoint de tendencias del dashboard en vez de mandarle un prompt al LLM.
- Composer enfocado automáticamente (~100 ms después de abrir).
- Botón Enviar **deshabilitado** con el input vacío.

## 2 · Loading / streaming

Condición: `streaming === true`.

- El botón de enviar se transforma en **Cancelar respuesta** (rojo) y aborta la
  llamada vía `AbortController`.
- Región `role="status"` + `aria-live="polite"` con el texto
  **"Analizando tus gastos…"** mientras dura el stream; queda vacía al terminar.
  Los tests usan ese elemento como señal de "settled", porque el botón de envío
  vuelve a estar deshabilitado apenas termina (input vacío) y no sirve como
  indicador.
- El bubble del asistente que se está escribiendo muestra _thinking dots_
  (`<ThinkingDots />`) hasta que llega el primer chunk.
- Con conversación vacía y streaming activo se muestra un placeholder dedicado
  ("Preguntame sobre tus gastos del mes") en lugar de la lista.
- Cancelar reescribe el último bubble como **"Respuesta cancelada."** y devuelve
  el composer a usable. La respuesta parcial que haya llegado se descarta.

Si la llamada no es cancelable en la capa fetch (`analyzeMonth`), el resultado se
descarta al completarse si la señal de aborto ya se disparó.

## 3 · Suggestions (respuesta completa)

Condición: `!streaming && !hasError && lastMessage?.role === "assistant" && lastMessage.text`.

- Aparece el grupo `role="group"` + `aria-label="Sugerencias de seguimiento"`
  con tres chips de follow-up.
- Mismo contrato que las sugerencias de idle: **pueblan el composer, no envían**.
- Se ocultan mientras hay streaming activo o si la última respuesta es un error.

## 4 · Error

Condición: `hasError && !streaming` (el último bubble tiene `error: true`).

- **Reintentar** — re-ejecuta el prompt real del usuario. Antes de reenviar
  descarta el bubble fallido _y_ el mensaje de usuario que lo produjo, para no
  duplicar el bubble. Si el prompt era el sentinel de "Analizar gastos del mes",
  re-ejecuta `analyzeMonth` en vez de mandarle el sentinel al LLM.
- **Nueva consulta** — limpia el hilo para empezar de cero.

## Transiciones del composer

| Evento                  | Resultado                                        |
| ----------------------- | ------------------------------------------------ |
| `Enter`                 | Envía                                            |
| `Shift+Enter`           | Salto de línea, no envía                         |
| Teclado IME componiendo | No envía (`e.nativeEvent.isComposing`)           |
| Input vacío             | Enviar deshabilitado                             |
| Input lleno             | Enviar habilitado                                |
| En streaming            | Enviar se reemplaza por Cancelar                 |
| Texto supera 2000 chars | Se trunca (`maxLength`), contador muestra límite |

El textarea crece automáticamente hasta 120 px y luego scrollea, para que el
composer nunca se coma el hilo de la conversación.

## Nota de implementación

El componente **no usa máquina de estados explícita** — los estados se derivan de
tres valores (`messages`, `streaming`, `hasError`). Esta especificación documenta
las combinaciones observables. Si esto crece, conviene extraer un reducer
verdadero; por ahora mantener la tabla en sincronía con las condiciones del JSX.
