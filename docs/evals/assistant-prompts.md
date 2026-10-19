# Evaluación de calidad — prompts del asistente

Set de casos para revisión humana. **No es un gate de merge**: no se ejecuta en CI
y no bloquea nada. Sirve para mirar los dos prompts de frente cuando cambian y
decidir si el tono y el foco siguen bien.

- **Dueño de la revisión**: quien cambió el prompt, más una segunda persona.
- **Cuándo**: cada vez que se toca `ANALYSIS_SYSTEM_PROMPT` o
  `INVESTMENTS_SYSTEM_PROMPT` en `src/backend/app/prompts.py`.
- **Cómo**: pegar cada caso contra el endpoint que corresponde con un usuario real
  y leer la respuesta. Marcar ✅ / ⚠️ / ❌ en la última columna.

Los casos cubren tres grupos: **dominio propio**, **dominio cruzado** (lo atiende
el router) y **fuera de ambos dominios** (se rechaza, sin frase armada).

---

## 1. Asistente de Gastos (`/api/analysis/stream`)

| # | Grupo | Pregunta | Qué tiene que pasar | |
|---|-------|----------|---------------------|---|
| G1 | Propio | ¿Cuánto llevo gastado este mes? | Usa los números del usuario, no generalidades. | |
| G2 | Propio | ¿Dónde puedo recortar? | Sugerencias concretas sobre sus categorías reales. | |
| G3 | Propio | Compará con el mes pasado | Compara períodos; si falta un mes, lo dice. | |
| G4 | Propio | ¿Cómo voy contra el presupuesto? | Habla del presupuesto 50/30/20 si está configurado. | |
| G5 | Propio | (sin pregunta — botón "Analizar gastos del mes") | Resumen + categorías + insights + sugerencias + prioridades. | |
| G6 | Seguimiento | "¿Y en diciembre?" tras un análisis | Entiende el pronombre **porque viaja el hilo**. Es el caso que prueba C1. | |
| G7 | Cruzado | ¿Cómo viene mi cartera? | El router lo manda al endpoint de inversiones. Si aún así cae acá, rechaza sin frase armada. | |
| G8 | Cruzado | Compré CEDEARs de SPY, ¿qué opinás? | Idem G7. | |
| G9 | Ajeno | Pasame una receta de ñoquis | Rechaza **en sus propias palabras**, breve, y ofrece volver a los gastos. | |
| G10 | Ajeno | ¿Quién gana las elecciones? | Idem G9. Sin muletilla fija. | |
| G11 | Ajeno | ¿Cómo hago un `for` en Python? | Idem G9. No responde programación. | |
| G12 | Ajeno | Contame un chiste | Rechaza con naturalidad; no suena a mensaje de error. | |

## 2. Asistente de Inversiones (`/api/investments/chat/stream`)

| # | Grupo | Pregunta | Qué tiene que pasar | |
|---|-------|----------|---------------------|---|
| I1 | Propio | ¿Cómo viene mi cartera? | Lee el snapshot de posiciones que manda el front. | |
| I2 | Propio | ¿Dónde estoy más expuesto? | Concentración por activo / moneda / broker. | |
| I3 | Propio | ¿Cómo voy contra la inflación? | Comparación en pesos, con la reticencia que corresponde. | |
| I4 | Propio | Explicame qué es un CEDEAR | Domina ratio de conversión y CCL. | |
| I5 | Propio | ¿Qué pasa si la Fed baja tasas? | Contexto de mercado, sin prometer rendimientos. | |
| I6 | Seguimiento | "¿Y el mes anterior?" tras un análisis | Entiende el pronombre **porque viaja el hilo**. Prueba C1. | |
| G7 | Cruzado | ¿Cuánto gasté en el super? | El router lo manda al endpoint de gastos. | |
| I7 | Ajeno | Pasame una receta de ñoquis | Rechaza en sus propias palabras y ofrece volver a la cartera. | |
| I8 | Ajeno | ¿Qué teléfono me conviene comprar? | Idem I7 (tecnología de consumo ≠ tecnología bursátil). | |
| I9 | Límite | Dame un portafolio que garantice 20% anual | Aclara que no garantiza rendimientos ni asesora formalmente. | |
| I10 | Límite | Comprá X por mí | No ejecuta operaciones; lo aclara. | |

## 3. Lo que NO debe aparecer en ninguna respuesta

Fijas estas tres y el cambio de C3 está roto, sin importar qué tan buena sea la
respuesta:

1. La frase literal *"Solo puedo ayudarte con el análisis de tus gastos y finanzas personales."*
2. La frase literal *"Solo puedo ayudarte con temas de inversiones y mercados financieros."*
3. Cualquier rechazo que se repita palabra por palabra entre G9–G12 / I7–I8.

Un rechazo que se lee igual dos veces seguidas es el bug original con otro nombre.

---

## Registro de revisiones

| Fecha | Prompt tocado | Casos mirados | Resultado | Revisó |
|-------|---------------|---------------|-----------|--------|
| 2026-10-19 | Ambos (canned refusal → palabras propias) | G9–G12, I7–I8, sección 3 | pendiente | pendiente |
