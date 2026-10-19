# Asistente IA — unificación de gastos e inversiones

Estado: **Etapa 1 implementada y en `main`** (rama `feature/assistant-unification`).
Pendiente: Etapa 2 (UX y backend, "mantener el foco").

## Etapa 1 — resultado medido

|                        | Antes                                                 | Después                          |
| ---------------------- | ----------------------------------------------------- | -------------------------------- |
| Líneas de producto     | 1799 (`AIAssistant` 983 + `InvestmentsAssistant` 816) | 1312 (módulo `assistant/`, −27%) |
| Líneas de test         | ~30 (`AIAssistant.test.tsx`, inversiones sin ninguno) | 1027, 7 archivos                 |
| Tests unitarios        | 24                                                    | 70                               |
| Tests e2e              | 39 passed / 1 skipped                                 | 57 passed / 1 skipped            |
| Implementaciones de UI | 2                                                     | **1**                            |
| Bugs compartibles      | se arreglaban en una copia y no en la otra            | se arreglan una vez              |

`Bubble` sigue memoizado y los renders por chunk siguen en **6**, tanto con 4
como con 40 mensajes en pantalla (O(1) por chunk, medido en
`e2e/assistant-perf.spec.ts`).

Tres bugs reales aparecieron al cablear la unificación, cada uno con su test:

1. `updateSession` re-parseaba `localStorage` en cada escritura, así que **todos**
   los objetos de mensaje se recreaban por chunk y el memo de `Bubble` no hacía
   nada: 24 renders con 4 mensajes contra 32 con 40. Ahora el estado en memoria
   es la fuente de verdad y el storage es un efecto secundario.
2. `sendMessage` no tenía guarda síncrona de reentrada: Enter (keydown) y el
   submit del formulario podían disparar dos envios en el mismo tick y dejar dos
   burbujas.
3. El seed de e2e escribía solo las claves legacy; con un store compartido, una
   segunda corrida heredaba el `activeId` de la primera y le apendeaba a ese hilo.

## Intención y por qué

Hoy hay **dos asistentes** que son copia casi exacta:

|                              | `AIAssistant.tsx`               | `InvestmentsAssistant.tsx`            |
| ---------------------------- | ------------------------------- | ------------------------------------- |
| Líneas                       | 983                             | 816                                   |
| Render                       | 1 modo: tarjeta centrada        | 3 modos: FAB → panel `w-96` → overlay |
| Endpoint                     | `POST /api/analysis/stream`     | `POST /api/investments/chat/stream`   |
| Payload                      | `{month, question, debug_mode}` | `{question, context}`                 |
| Storage                      | `ai_assistant_*`                | `inv_assistant_*`                     |
| Cancelar (`AbortController`) | sí                              | **no**                                |
| `useFocusTrap`               | sí                              | **no**                                |
| Contraste AA                 | sí                              | **no** (3.76:1)                       |
| `React.memo(Bubble)`         | sí                              | no                                    |

Similitud medida: 389 líneas idénticas, 43,2%.

El costo ya se pagó: los cuatro bugs corregidos en #415 quedaron **vivos** en la copia
de inversiones. Cada cambio se paga dos veces y se olvida una.

El objetivo es una sola implementación de UI, dos configuraciones finas, y que el
usuario deje de pagar por nuestra arquitectura.

## Metas

1. Una sola implementación de UI del asistente. Los envoltorios por dominio quedan
   en ~40 líneas cada uno.
2. Que los bugs se arreglen una vez y sirvan para los dos.
3. **Un solo hilo** que no se corta al cambiar de pantalla.
4. **Un cambio de dominio nunca cierra la conversación.** Reiniciar es acción
   manual del usuario, nunca consecuencia de la ruta.
5. El asistente deja de rebotar: nunca recita un rechazo enlatado.
6. Mantener el foco por dominio: el asistente sigue siendo especialista, no un
   generalista.

## No-metas

- Fusionar los dos endpoints o las dos claves LLM (`INVESTMENTS_LLM_API_KEY` permite
  facturar inversiones aparte; fusionar rompería eso).
- Un asistente generalista que sepa de todo por igual.
- Bot de Telegram ni webhook de WhatsApp: **no usan estos prompts**
  (verificado por `grep` en `src/backend`).
- Nuevas features de asistente (voz, adjuntos, herramientas).

## Anti-metas

- Un `config` con `if`s adentro del archivo compartido. Si dos dominios divergen en
  comportamiento, la divergencia va a envoltorios, no a condicionales dentro de la
  pieza común.
- Un router con LLM desde el principio si las reglas alcanzan.
- "Mejoras de UX" que obliguen al usuario a administrar sesiones según el dominio.

## Restricciones verificadas en el código

1. **El backend es stateless.** `/analysis/stream` recibe
   `{month, question, debug_mode}`; `/investments/chat/stream` recibe
   `{question, context}`. Ninguno recibe turnos previos. El único endpoint que sí
   recibe `messages` es `/analysis/summarize`, y solo para resumir. Hoy el asistente
   no recuerda nada, ni dentro de una misma pantalla.
2. **Los muros son simétricos.** `ANALYSIS_SYSTEM_PROMPT` (`app/prompts.py:87`) y
   `INVESTMENTS_SYSTEM_PROMPT` (`routers/investments.py:1042`) se rechazan mutuamente
   con la misma fórmula y el mismo "No hagas excepciones bajo ninguna circunstancia".
3. **Claves LLM separadas.** `LLM_API_KEY` para gastos;
   `INVESTMENTS_LLM_API_KEY` con fallback para inversiones.
4. **El contexto se arma en lugares distintos.** Gastos server-side desde la DB
   (`analysis.py:95-110`); inversiones client-side (`buildPortfolioContext`,
   `InvestmentsAssistant.tsx:58`).
5. **El asistente vive en `MainLayout`, fuera de los `<Routes>`.** Por eso hoy mira la
   URL a mano (`location.pathname === "/investments"`). Es chrome de la app.
6. **No hay ningún test de backend** para estos prompts ni endpoints.
7. **`src/frontend/src/pages/AnalysisPage.tsx` está muerta** — no la importa nadie.
   Era la única otra consumidora de `/api/analysis/stream`.
8. **Los endpoints de chat no están en OpenAPI** (`docs/specs/openapi.yaml`), así que
   cambiar su contrato no dispara codegen ni regeneración del cliente.
9. **`docs/specs/features/analysis.spec.yaml` documenta hoy el comportamiento
   stateless** ("Is conversation context maintained between queries? → No"). Ese spec
   hay que actualizarlo.
10. **Ya existe control manual de sesión**: nueva conversación y borrar. Son las
    herramientas de control del usuario; el dominio no debe dispararlas.

## Decisiones tomadas

### 1. Mantener el foco

Cada respuesta sale de un prompt especializado. No se construye un generalista.
Lo que cambia es que **deja de rebotar**: ante una pregunta de otro dominio responde
o deriva con naturalidad, nunca recita una frase fija.

### 2. Un solo hilo

Una conversación visible que sigue al cambiar de pantalla. Los mensajes se
etiquetan por dominio para la UI; **el hilo en sí no tiene dominio**.

### 3. El foco es pegajoso

No se re-elige desde cero en cada mensaje. Resolución, en orden:

1. señal clara de un dominio en el mensaje → ese dominio, y **queda como foco**;
2. sin señal → se mantiene el foco anterior;
3. sin foco anterior (conversación nueva) → la ruta.

Consecuencia: el router solo tiene que **detectar cambio de tema**, no clasificar
cada mensaje. Los seguimientos sin señal ("¿y el mes pasado?") heredan el foco
correcto, que una clasificación independiente acertaría al azar.

**Cambiar de pantalla no cambia el foco por sí solo.** Solo lo siembra cuando arranca
una conversación nueva. Si navegar cambiara la personalidad en medio de una charla,
volvería el problema original.

### 4. Router por reglas

Vocabulario determinístico (cartera, CEDEAR, Merval, bono, FCI, rendimiento /
gasto, tarjeta, presupuesto, cuota). Gratis y testeable. Un router con LLM queda
para después, solo si las reglas fallan seguido.

### 5. Historial completo al backend

Se mandan todos los turnos, no los filtrados por dominio: es lo que permite las
referencias ("y de eso, ¿qué conviene?"). **El foco lo da el system prompt, no el
recorte del historial.**

### 6. Un componente, no dos envoltorios

El chrome (título, placeholder, sugerencias, slot de análisis) y el endpoint siguen
el **dominio del último mensaje**, no la ruta. Por eso no puede haber un envoltorio
elegido por ruta: sería el mismatch de ver tu conversación de gastos bajo el título
"Asistente de Inversiones".

Estructura: `Assistant` (el componente único que `App` renderiza una vez) +
`AssistantShell` (UI) + `ASSISTANT_CONFIGS: Record<AssistantDomain, AssistantConfig>`
(dispatch por dato, no por `if`) + los hooks compartidos. Los dos puntos de entrada
(speed dial y FAB) abren **el mismo hilo** con un dominio inicial distinto.

Esto sigue cumpliendo el anti-metas de "config con `if`s adentro": la divergencia va
a datos, no a condicionales.

### 7. Geometría única: 76% × 78%

La del mockup D3 aprobado (`width: 76%; height: 78%`). El código quedó en
`sm:max-w-2xl` (672px) × `sm:max-h-[78vh]`: más angosto de lo aprobado. Al unificar
se corrige — los dos asistentes pasan a 76% × 78%.

### 8. Sesiones sin dominio, no un hilo eterno

"Un solo hilo" significa que **la sesión no está atada a un dominio**: navegar o
cambiar de tema no crea una sesión nueva. **No** significa una conversación infinita.
Se conservan el botón de nueva conversación, el tab de Historial, las sesiones
pasadas y la rotación por inactividad. Las consultas de meses anteriores siguen
visibles y consultables igual que hoy.

### 9. Migración del historial

Los dos stores (`ai_assistant_*`, `inv_assistant_*`) se unen en una sola lista de
sesiones, con los mensajes etiquetados por dominio. Orden: por la fecha del primer
mensaje de cada sesión. No se pierde nada.

### 10. Fuera de alcance: rechazar sin frase enlatada

Ante un tema que no es ni gastos ni inversiones (recetas, política, programación), el
asistente **se niega, con sus propias palabras**: no responde el tema, pero tampoco
recita una frase fija. Este es el criterio de aceptación de la reescritura de prompts
y la rúbrica del set de evaluación.

### 11. La revisión de prompts no bloquea el merge

El set de preguntas de evaluación y las respuestas antes/después se le pasan al
maintainer antes del merge, pero no es gate.

## Arquitectura propuesta

### Etapa 1 — refactor del frontend, cero cambio de producto

Nuevo `src/frontend/src/components/assistant/`:

- `types.ts` — `AssistantConfig`, `Message`, `Session`
- `AssistantShell.tsx` — modal centrado (76% × 78%), composer, burbujas, tabs,
  los 4 estados
- `useAssistantSessions.ts` — `loadSessions` / `saveSessions` / `loadActiveId`
- `useStreamingChat.ts` — `streamTo` + `AbortController` + retry real + ruteo del
  sentinel de análisis
- `useSummarize.ts` — resumen de sesión (endpoint ya compartido)

Envoltorios: `SpendingAssistant.tsx` y `InvestmentsAssistant.tsx`.

Soporte: `App.tsx` deja de tener el `if` por ruta (pasa a dato); el estado del
drawer se unifica; la instrumentación de performance se conserva (`open-start` en el
toggle, `open-end` en el shell); se borra `AnalysisPage.tsx`; se elimina el
corrimiento de layout `mr-0 sm:mr-[${panelWidth}px]` que deja de usarse.

### Etapa 2 — UX y backend

- Reescribir los dos prompts: sacar el rechazo enlatado, conservar el encuadre de
  dominio, responder o derivar.
- Los dos endpoints aceptan `messages` (turnos previos).
- Router de dominio por reglas, con la resolución pegajosa de arriba.
- Tests de backend (hoy no existen): un pytest con el cliente `genai` mockeado que
  capture el `system_instruction` enviado y afirme que el texto de rechazo ya no está.
- Evaluación de calidad: set fijo de preguntas por dominio (dentro y fuera de
  alcance), antes y después, con revisión humana. Ningún test unitario detecta que
  el asistente empeoró.
- Actualizar `docs/specs/features/analysis.spec.yaml` (hoy documenta el stateless).

## Dejado al builder

- Forma concreta de `AssistantConfig` y de los hooks.
- Cómo se porta el componente con la instrumentación de performance sin romper
  `assistant-perf.spec.ts`.
- Estructura exacta de los mensajes etiquetados por dominio.
- Elegir la librería o implementación propia para el router de reglas.

## Llamadas tomadas sin consultarte (revisalas)

1. **Rotación por inactividad como config.** Hoy `AIAssistant` rota la sesión después
   de 2h sin mensajes (`AIAssistant.tsx:415`), resume y arranca una nueva en
   silencio. Inversiones no la tiene. Se pasa a `rotateAfterIdleMinutes` en la config:
   gastos 120, inversiones 0. Comportamiento idéntico al actual en los dos, dentro de
   una etapa que prometía cero cambio de producto.
2. **El chrome sigue el foco pegajoso, no la ruta.** Título, placeholder y sugerencias
   reflejan el foco de la conversación. Si siguieran la ruta, navegar te cambiaría la
   personalidad en medio de una charla, que es justo lo que dijimos que no.
   **Dos puntos de entrada, un solo hilo.**
3. **Inversiones recibe sugerencias.** Paridad con el "mismo UI/UX" que pediste.
4. **Mismo presupuesto de performance:** `OPEN_BUDGET_MS = 300` para los dos.
5. **Router por reglas de vocabulario**, no LLM (propuesto y no objetado).

## Fuera de alcance de estas dos etapas

- **Historial consultable por el asistente** (que recuerde meses anteriores). Tiene
  sentido y es barato: la rotación ya genera un resumen por sesión con
  `/analysis/summarize`, que es exactamente el material necesario. Pero es alcance
  aparte.
