# Design System

La app usa una estética inspirada en GNOME/Adwaita. Los tokens viven en
`src/frontend/src/index.css`; este documento explica **cuándo usar qué** y qué falta.

## Principio

Un solo lenguaje visual para toda la app. Si una pantalla necesita un color, un tamaño o un
espaciado nuevo, se agrega como token y se documenta acá. No se inventa en el componente.

## Tokens

Todos están definidos en `:root` (`index.css:91`) y se adaptan con `prefers-color-scheme`.

| Grupo      | Prefijo                                               | Uso                             |
| ---------- | ----------------------------------------------------- | ------------------------------- |
| Superficie | `--bg`, `--surface`, `--surface-2`                    | Fondos por nivel                |
| Texto      | `--text`, `--text-secondary`, `--text-tertiary`       | Jerarquía de lectura            |
| Bordes     | `--border`, `--border-strong`                         | Separadores y contenedores      |
| Acento     | `--accent`, `--accent-hover`                          | Acciones primarias y foco       |
| Estado     | `--color-success`, `--color-warning`, `--color-error` | Feedback semántico              |
| Paleta     | `--gnome-{red,green,yellow,blue,purple,orange}-1..7`  | Solo para gráficos y categorías |

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

| Rol                      | Tamaño mínimo   | Clase                       |
| ------------------------ | --------------- | --------------------------- |
| Monto principal          | 24 px           | —                           |
| Dato financiero en tabla | 14 px           | `adw-body`                  |
| Metadato / fecha         | 12 px           | `adw-caption`               |
| Etiqueta de sección      | 11 px uppercase | `adw-caption` + `uppercase` |

Nunca por debajo de **12 px** en un dato que el usuario tenga que leer. Hoy hay 263 usos de
9-11 px; es deuda activa ([#520](https://github.com/cheloim/perExp/issues/520)).

> `adw-dim-label` aplica 55 % de opacidad. Sobre fondos claros deja el texto en 2,1-3,1:1.
> Usalo solo en texto decorativo, nunca en montos ni estados.

## Primitivas existentes

`src/frontend/src/components/ui/`

| Componente      | Estado | Nota                                                                                                                                                                   |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CurrencyInput` | ✅     | Entrada de montos con separadores.                                                                                                                                     |
| `Dialog`        | ✅     | `role="dialog"`, `aria-modal`, título accesible, focus trap, Escape, restauración de foco e `inert` en el fondo. Reutiliza `useFocusTrap`.                             |
| `EmptyState`    | ✅     | Estado vacío con acción.                                                                                                                                               |
| `Field`         | ✅     | `label`/`htmlFor`, help, error con `aria-invalid`/`aria-describedby`/`aria-errormessage`.                                                                              |
| `Money`         | ✅     | Componente visual sobre `formatMoney`; `MoneyTotals` sobre `formatMoneyTotals`.                                                                                        |
| `PageState`     | ✅     | Contrato explícito `loading` / `error` / `empty` / `success`; delega en `QueryState`.                                                                                  |
| `Popover`       | ✅     | Posicionamiento y cierre por Escape.                                                                                                                                   |
| `QueryState`    | ✅     | Los cuatro estados de una query con datos previos y retry.                                                                                                             |
| `Select`        | ⚠️     | No expone `role=combobox` ni `aria-activedescendant`; `allowCustomValue` por defecto permite valores inválidos ([#517](https://github.com/cheloim/perExp/issues/517)). |
| `Skeleton`      | ✅     | Base de `QueryState` y `PageState`; también se usa directo en las pantallas.                                                                                           |
| `Sparkline`     | ⚠️     | `aria-hidden="true"`, sin alternativa textual ([#519](https://github.com/cheloim/perExp/issues/519)).                                                                  |
| `Table`         | ✅     | `caption` accesible, `scope` por defecto y helper de `aria-sort`. Sin migrar pantallas.                                                                                |
| `formatMoney`   | ✅     | `utils/money.ts`. Notación única: `$ 1.234,50` / `U$S 1.234,50`; `formatMoneyTotals` nunca suma monedas.                                                               |

### Primitivas de #571

Las cinco primitivas compartidas viven en `src/frontend/src/components/ui/`. No
reemplazan estilos ni comportamiento de las tablas y modales existentes: las pantallas
se migran en #572/#573.

#### `Field`

Asocia la etiqueta, el help y el error a un único control. Conserva el `id` y el
`aria-describedby` que ya traiga el control.

```tsx
<Field label="Monto" help="En pesos argentinos" error={errors.monto} required>
  <input inputMode="decimal" />
</Field>
```

- `label` es obligatorio; el `id` se genera si el control no tiene uno.
- `error` setea `aria-invalid`, `aria-errormessage` y agrega el id del error a
  `aria-describedby`.
- `help` se mantiene visible y también se anuncia por `aria-describedby`.
- El control debe aceptar `id`, `required` y atributos `aria-*`.

#### `Dialog`

```tsx
<Dialog
  isOpen={open}
  onClose={() => setOpen(false)}
  title="Editar gasto"
  description="Ajustá los datos del movimiento."
  footer={<button type="button">Guardar</button>}
>
  <input aria-label="Comercio" />
</Dialog>
```

- `role="dialog"` con `aria-modal="true"` y `aria-labelledby` al título.
- El foco entra al diálogo al abrir, queda atrapado y vuelve al disparador al cerrar.
- Escape y click en el backdrop llaman a `onClose`.
- Mientras está abierto, los demás hijos de `body` reciben `inert`.
- Es un portal a `body`; asumí un diálogo a la vez.

#### `Money`

```tsx
<Money amount={1234.5} />            {/* $ 1.234,50 */}
<Money amount={7} currency="USD" />  {/* U$S 7,00 */}
<Money amount={-123} />              {/* -$ 123,00 */}
<MoneyTotals items={totals} />       {/* $ 30.000,00 + U$S 7,00 */}
```

No formatea por su cuenta: delega en `formatMoney`/`formatMoneyTotals` de
`src/frontend/src/utils/money.ts`. `size` sólo cambia el tamaño tipográfico.

#### `PageState`

```tsx
{
  query.isLoading && (
    <PageState state="loading" skeleton={<SkeletonCard lines={4} />} />
  );
}
{
  query.isError && <PageState state="error" onRetry={query.refetch} />;
}
{
  query.isEmpty && <PageState state="empty" emptyTitle="Sin gastos" />;
}
<PageState state="success">{content}</PageState>;
```

Cada estado es excluyente en el tipo: `loading` no acepta `children`, `success` los
exige. `loading` marca `aria-busy="true"` y los otros tres delegan en `QueryState`, por
lo que heredan `role="alert"`, retry y `EmptyState`.

#### `Table`

```tsx
<Table caption="Gastos de octubre">
  <TableHead>
    <TableRow>
      <TableHeaderCell>Fecha</TableHeaderCell>
      <TableHeaderCell sort={sort} onSort={toggleSort}>
        Monto
      </TableHeaderCell>
    </TableRow>
  </TableHead>
  <TableBody>
    <TableRow>
      <TableHeaderCell scope="row">Total</TableHeaderCell>
      <TableCell>$ 1.000,00</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

- `caption` es el nombre accesible de la tabla; `captionHidden` lo oculta visualmente
  sin sacarlo del árbol de accesibilidad.
- `TableHeaderCell` usa `scope="col"` por defecto; `scope="row"` para encabezados de
  fila.
- `sort` se traduce directo a `aria-sort` y `onSort` envuelve el contenido en un
  `<button>` dentro del `<th>`. Sin `onSort`, el header es estático y no anuncia estado.

## Primitivas que faltan

| Primitiva | Reemplaza a               | Requisito                                  |
| --------- | ------------------------- | ------------------------------------------ |
| `Badge`   | Estados con color + texto | Variante accesible (color + ícono + texto) |

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
