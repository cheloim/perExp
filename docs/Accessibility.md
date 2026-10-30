# Accesibilidad

Objetivo: **WCAG 2.2 nivel AA** en las pantallas núcleo. No es un proyecto aparte: es un
criterio de aceptación de cada feature.

## Estado actual

| Área | Estado | Issue |
|---|---|---|
| Superficies clickeables | `div`/`tr` con `onClick`, inoperables por teclado | [#517](https://github.com/cheloim/perExp/issues/517) |
| Formularios | 60 de 72 `<label>` sin `htmlFor`; cero `aria-invalid` | [#517](https://github.com/cheloim/perExp/issues/517) |
| Diálogos | Sin `role="dialog"` ni focus trap consistente; el foco no se restaura | [#517](https://github.com/cheloim/perExp/issues/517) |
| Contraste | warning 2,20:1; success 3,09:1; texto atenuado 2,1-3,1:1 | [#518](https://github.com/cheloim/perExp/issues/518) |
| Gráficos | Donas, treemap y sparkline sin alternativa textual | [#519](https://github.com/cheloim/perExp/issues/519) |
| Asistente IA | Sin `role="log"` ni anuncio de respuestas; autoscroll forzado | [#519](https://github.com/cheloim/perExp/issues/519) |
| Tipografía | 263 usos de 9-11 px en datos financieros | [#520](https://github.com/cheloim/perExp/issues/520) |
| Asistente (contrato propio) | ✅ Cubierto por `e2e/assistant-a11y.spec.ts` | — |

## Reglas obligatorias

### Semántica

- Toda acción es `<button>`; toda navegación es `<Link>` o `<a>`.
- Un `div` con `onClick` es un bug, no un atajo.
- Si una fila de tabla abre un detalle, el detalle tiene un botón accesible dentro.

### Formularios

- Cada control tiene `<label for>` o `aria-label`.
- El error se asocia con `aria-describedby` y el campo lleva `aria-invalid="true"`.
- El error se anuncia con `role="alert"` o `aria-live="assertive"`.
- Los required se marcan con `required` o `aria-required`, no solo con un asterisco visual.

### Diálogos

- `role="dialog"` + `aria-modal="true"` + `aria-labelledby`.
- Focus trap al abrir; Escape cierra; el foco vuelve al disparador.
- Contenido cerrado no debe ser tabulable: usar `inert`, `hidden` o desmontar.
- Si hay cambios sin guardar, cerrar pide confirmación.

### Teclado

- Orden de tabulación igual al orden visual.
- `:focus-visible` siempre visible, con contraste ≥ 3:1.
- Nada depende de hover.
- Atajos documentados y sin colisión con los del navegador.

### Gráficos y datos visuales

- Cada gráfico tiene un resumen textual y una tabla equivalente.
- La leyenda es navegable y cada ítem es un control real.
- El color nunca es el único canal: patrón o etiqueta además del tono.

### Movimiento

- Respetar `prefers-reduced-motion`: sin animaciones de scroll ni transiciones largas.
- Nada parpadea más de 3 veces por segundo.

## Cómo verificar

```bash
cd src/frontend

# Contrato del asistente
npx playwright test e2e/assistant-a11y.spec.ts

# Análisis estático de las pantallas (cuando se agregue axe)
npx playwright test e2e/a11y.spec.ts
```

Checklist manual antes de cerrar una feature:

1. Recorrer el flujo completo solo con Tab, Enter, Espacio y Escape.
2. Probar con un lector de pantalla (VoiceOver, NVDA u Orca).
3. Zoom al 200 % sin pérdida de contenido.
4. Revisar contraste con la paleta real, no con el color "de diseño".
5. Probar en tema claro y oscuro.

## Criterio de aceptación

Una feature no se considera terminada si:

- [ ] Introduce un `div` clickeable.
- [ ] Deja un control sin nombre accesible.
- [ ] Muestra un error solo por color.
- [ ] Agrega texto por debajo de 12 px en datos.
- [ ] Rompe la navegación por teclado de la pantalla donde vive.
