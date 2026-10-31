# Design System

La app usa una estética inspirada en GNOME/Adwaita. Los tokens viven en
`src/frontend/src/index.css`; este documento explica **cuándo usar qué** y qué falta.

## Principio

Un solo lenguaje visual para toda la app. Si una pantalla necesita un color, un tamaño o un
espaciado nuevo, se agrega como token y se documenta acá. No se inventa en el componente.

## Tokens

Todos están definidos en `:root` (`index.css:91`) y se adaptan con `prefers-color-scheme`.

| Grupo | Prefijo | Uso |
|---|---|---|
| Superficie | `--bg`, `--surface`, `--surface-2` | Fondos por nivel |
| Texto | `--text`, `--text-secondary`, `--text-tertiary` | Jerarquía de lectura |
| Bordes | `--border`, `--border-strong` | Separadores y contenedores |
| Acento | `--accent`, `--accent-hover` | Acciones primarias y foco |
| Estado | `--color-success`, `--color-warning`, `--color-error` | Feedback semántico |
| Paleta | `--gnome-{red,green,yellow,blue,purple,orange}-1..7` | Solo para gráficos y categorías |

### Regla de contraste

El texto debe cumplir **WCAG 2.2 AA**:

- Texto normal: **≥ 4,5:1**
- Texto grande (≥ 24 px, o ≥ 18,66 px bold): **≥ 3:1**
- Componentes de UI y foco: **≥ 3:1**

> Estado actual: `--color-warning` (#e8a100) da 2,20:1 y `--color-success` (#26a269) da
> 3,09:1 sobre sus fondos. No cumplen. Está trackeado en
> [#518](https://github.com/cheloim/perExp/issues/518). Mientras tanto, no uses esos
> colores como **único** portador de significado: acompañá con ícono y texto.

### Tipografía

| Rol | Tamaño mínimo | Clase |
|---|---|---|
| Monto principal | 24 px | — |
| Dato financiero en tabla | 14 px | `adw-body` |
| Metadato / fecha | 12 px | `adw-caption` |
| Etiqueta de sección | 11 px uppercase | `adw-caption` + `uppercase` |

Nunca por debajo de **12 px** en un dato que el usuario tenga que leer. Hoy hay 263 usos de
9-11 px; es deuda activa ([#520](https://github.com/cheloim/perExp/issues/520)).

> `adw-dim-label` aplica 55 % de opacidad. Sobre fondos claros deja el texto en 2,1-3,1:1.
> Usalo solo en texto decorativo, nunca en montos ni estados.

## Primitivas existentes

`src/frontend/src/components/ui/`

| Componente | Estado | Nota |
|---|---|---|
| `CurrencyInput` | ✅ | Entrada de montos con separadores. |
| `EmptyState` | ✅ | Estado vacío con acción. |
| `Popover` | ✅ | Posicionamiento y cierre por Escape. |
| `Select` | ⚠️ | No expone `role=combobox` ni `aria-activedescendant`; `allowCustomValue` por defecto permite valores inválidos ([#517](https://github.com/cheloim/perExp/issues/517)). |
| `Skeleton` | ⚠️ | Existe y **no se usa**. Adoptarlo es parte de [#511](https://github.com/cheloim/perExp/issues/511). |
| `Sparkline` | ⚠️ | `aria-hidden="true"`, sin alternativa textual ([#519](https://github.com/cheloim/perExp/issues/519)). |

## Primitivas que faltan

Estas se repiten copiadas en las pantallas y deberían extraerse:

| Primitiva | Reemplaza a | Requisito |
|---|---|---|
| `Field` | ~72 `<label>` sueltos, 60 sin `htmlFor` | `id`, `label`, `error`, `aria-invalid`, `aria-describedby` |
| `Dialog` | 6 modales con implementaciones distintas | `role="dialog"`, focus trap, restauración de foco, Escape |
| `PageState` | loading/error/empty ad hoc en cada página | `isLoading`, `isError`, `isEmpty`, retry |
| `Money` | `formatCurrency` + prefijos manuales | Una sola notación por moneda |
| `Badge` | Estados con color + texto | Variante accesible (color + ícono + texto) |
| `Table` | Tablas densas del admin | `aria-sort`, columnas configurables, densidad |

## Reglas de composición

1. **Nada de `style={{}}`** en pantallas nuevas. Si falta un valor, se agrega al token set.
2. **Nada de `className` con `var(--` anidado.** Hay 20 casos inválidos en `AdminPage`
   (`text-[var(--text-[var(--text-secondary)])]`) que rompen el color.
3. **Un solo `<h1>` por pantalla** y jerarquía sin saltos.
4. **Todo elemento clickeable es `<button>` o `<Link>`.** Nunca `div`/`span`/`tr` con
   `onClick`.
5. **Estados distinguibles sin color:** ícono + texto + color.
6. **Espaciado en múltiplos de 4 px**, usando las utilidades existentes.

## Cómo agregar un componente

1. Verificá que no exista algo equivalente en `components/ui/`.
2. Definí estados: default, hover, focus-visible, disabled, loading, error.
3. Documentá acá con una fila en la tabla.
4. Agregá un test de accesibilidad (rol, nombre accesible, teclado).
5. Si introduce un token nuevo, justificá por qué no alcanza uno existente.
