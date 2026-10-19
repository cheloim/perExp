# Asistente IA — accesibilidad

Contrato de accesibilidad del modal del asistente (issue #415). Todo lo listado
acá está cubierto por pruebas automatizadas en `src/frontend/e2e/assistant-a11y.spec.ts`;
si cambiás el componente y esas pruebas siguen verdes, este documento sigue siendo
cierto.

## Semántica

| Propiedad    | Valor                 |
| ------------ | --------------------- |
| `role`       | `dialog`              |
| `aria-modal` | `true`                |
| `aria-label` | `Asistente de Gastos` |

El diálogo es un modal real: el resto de la página queda fuera del orden de tabulación
y el foco queda atrapado dentro.

## Superficie de controles

| Elemento                   | Cómo se nombra                                             |
| -------------------------- | ---------------------------------------------------------- |
| Textarea                   | `aria-label="Preguntá sobre tus gastos"`                   |
| Botón enviar               | `aria-label="Enviar mensaje"`                              |
| Botón cancelar (streaming) | `aria-label="Cancelar respuesta"`                          |
| Botón cerrar               | `aria-label="Cerrar asistente"`                            |
| Chat / Historial           | `aria-pressed`                                             |
| Debug (solo localhost)     | `aria-pressed`                                             |
| Estado de carga            | `role="status"` + `aria-live="polite"`                     |
| Sugerencias de seguimiento | `role="group"` + `aria-label="Sugerencias de seguimiento"` |

Los chips de sugerencia del estado idle son botones estándar: alcanzables con Tab y
operables con Enter o Space.

## Teclado

| Tecla         | Acción                               |
| ------------- | ------------------------------------ |
| `Enter`       | Envía el mensaje                     |
| `Shift+Enter` | Salto de línea                       |
| `Escape`      | Cierra el diálogo                    |
| `Tab`         | Cicla dentro del diálogo, nunca sale |
| `Shift+Tab`   | Cicla hacia atrás, nunca sale        |

`Enter` está protegido con `e.nativeEvent.isComposing`, así que la composición de
IME (chino, japonés, coreano) no envía el texto a medio escribir.

El `Escape` lo maneja el handler global de `App.tsx`, no el focus trap. Es
deliberado: si ambos lo manejaran se dispararían dos toggles sobre el mismo
keydown.

### Trampa de foco

`useFocusTrap` (`src/hooks/useFocusTrap.ts`) envuelve el `Tab` en los dos bordes y
además **recupera el foco si está fuera del diálogo**. Ese segundo caso importa:
al abrir, el foco queda todavía en el disparador que abrió el modal hasta que el
autofocus del composer corre (~100 ms después), y en ese intervalo un `Tab` o
`Shift+Tab` se escapaba del modal sin que las guardas de los bordes se activaran
(comparaban contra `first`/`last`, no contra "¿estoy adentro?").

Es un fix del hook compartido, así que aplica a los otros consumidores:
`DetailModal`, `ConfirmDialog`, `ExpenseModals` y las dos instancias de
`ClasificacionPage`.

El test cubre el caso de forma determinista: siembra el foco en un elemento
exterior (no en `document.body`, que hace que el navegador caiga dentro por
casualidad) **después** de esperar a que el autofocus ya haya corrido, y verifica
que la primera tecla trae el foco de vuelta. Sin el fix los dos tests fallan en
ambos viewports.

## Contraste

El par `--color-primary` / `--color-on-primary` del design system no llega al
piso de 4.5:1 de WCAG AA — `#3584e4` con texto blanco da 3.76:1. En modo oscuro
es peor: `#62a0ea` con blanco da 2.72:1.

El asistente usa los tokens `--color-primary-strong` / `--color-on-primary-strong`,
que son la variante AA:

| Tema   | Fuente    | Fondo             | Ratio  |
| ------ | --------- | ----------------- | ------ |
| Claro  | `#ffffff` | `#1c71d8`         | 4.77:1 |
| Claro  | `#1c71d8` | `#ffffff`         | 4.77:1 |
| Oscuro | `#1c1b1f` | `#62a0ea`         | 6.27:1 |
| Oscuro | `#62a0ea` | superficie oscura | 5.93:1 |

Los tokens `--color-primary` originales siguen existiendo y **no fueron tocados**.
Tiene 20+ call sites en el resto de la app (`.gnome-btn-primary` y otros), y
cambiarlos en un solo PR las repintaría todas sin revisión visual. Migrarlos es
trabajo aparte.

### Deuda conocida

`axe-core` limpia el diálogo del asistente en ambos temas. El resto de la app
**no** está auditado y muy probablemente reproduce el mismo fallo de contraste
del token primario. Abrir un issue de seguimiento para auditar las pantallas
principales con la misma herramienta.

## Auditoría automatizada

```bash
cd src/frontend
npx playwright test e2e/assistant-a11y.spec.ts   # axe-core
```

### axe-core

Las reglas que se aplican: `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, sobre el
subárbol `[role="dialog"]`, en estado idle y en estado streaming.

La misma suite cubre la navegación por teclado: foco atrapado dentro del
diálogo, `Tab` / `Shift+Tab` que nunca salen del modal, chips operables por
teclado y la región `aria-live` que anuncia el streaming.

## Lo que estas pruebas NO cubren

- **Zoom al 200%.** No hay prueba de reflow.
- **Movimiento reducido.** No hay preferencia `prefers-reduced-motion` en las
  animaciones del modal.
