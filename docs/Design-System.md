# Design System

La app usa una estética inspirada en GNOME/Adwaita. Los tokens viven en
`src/frontend/src/index.css`; este documento explica **cuándo usar qué**, qué estados
tiene cada primitiva y qué deuda queda.

## Principio

Un solo lenguaje visual para toda la app. Si una pantalla necesita un color, un tamaño o un
espaciado nuevo, se agrega como token y se documenta acá. No se inventa en el componente.

## Tokens

Todos están definidos en `:root` (`index.css:91`) y se adaptan con `prefers-color-scheme`.

| Grupo        | Prefijo                                                                   | Uso                                   |
| ------------ | ------------------------------------------------------------------------- | ------------------------------------- |
| Superficie   | `--bg`, `--surface`, `--surface-2`, `--color-base`, `--color-surface`     | Fondos por nivel                      |
| Texto        | `--text-primary`, `--text-secondary`, `--text-tertiary`                   | Jerarquía de lectura                  |
| Bordes       | `--border`, `--border-strong`, `--border-color`                           | Separadores y contenedores            |
| Acento       | `--accent`, `--accent-hover`, `--color-primary`, `--color-primary-strong` | Acciones primarias y foco             |
| Estado       | `--color-success`, `--color-warning`, `--color-danger`, `--color-error`   | Puntos, barras e íconos (nunca texto) |
| Estado texto | `--color-success-text`, `--color-warning-text`, `--color-danger-text`     | Texto sobre cualquier superficie      |
| Paleta       | `--gnome-{red,green,yellow,blue,purple,orange}-1..7`                      | Solo para gráficos y categorías       |

### Regla de contraste

El texto debe cumplir **WCAG 2.2 AA**:

- Texto normal: **≥ 4,5:1**
- Texto grande (≥ 24 px, o ≥ 18,66 px bold): **≥ 3:1**
- Componentes de UI y foco: **≥ 3:1**

Los estados semánticos usan la variante `*-text` para texto y la variante sin sufijo para
puntos, barras e íconos:

```tsx
<span className="text-[var(--color-danger-text)]">Excedido</span>
<span style={{ backgroundColor: "var(--color-danger)" }} aria-hidden="true" />
```

`src/frontend/src/utils/contrast.test.ts` verifica cada token de texto contra
`--color-surface`, `--color-base`, `--color-base-container` y `--color-sidebar`, en tema
claro y oscuro. Si un token nuevo no pasa 4,5:1, el test falla.

> `--color-success`, `--color-warning` y `--color-danger` **no** son seguros como texto:
> usalos solo como relleno o ícono, siempre acompañados de texto. El texto va con
> `--color-*-text`.

### Tipografía

| Rol                        | Tamaño mínimo | Clase                        |
| -------------------------- | ------------- | ---------------------------- |
| Monto principal / KPI      | 18 px         | `text-lg` o mayor            |
| Monto en tabla o lista     | 14 px         | `text-sm`, `Money size="md"` |
| Dato financiero y metadata | 12 px         | `text-xs`, `adw-caption`     |
| Etiqueta de sección        | 12 px         | `text-xs uppercase`          |

Nunca por debajo de **12 px** en un dato que el usuario tenga que leer, y nunca por debajo
de **14 px** en un monto. `adw-dim-label` aplica opacidad parcial: queda prohibido por
debajo de 14 px y no se usa en montos ni estados.

El gate `config/scripts/validate_css_classes.py` cuenta `text-[<12px]` y
`adw-dim-label` chico por archivo. Las pantallas núcleo (`Dashboard`, `ExpensesPage`,
`BudgetPage`, `AdminPage`) están en cero; el resto queda en
`config/css_class_baseline.json` y esa lista **solo achica**.

### Estados de presupuesto

Los cuatro cortes se distinguen **sin color**: cada uno tiene etiqueta, ícono y color.
`budgetStatusForPct()` en `BudgetPage.tsx` es la única fuente de verdad.

| Rango   | Etiqueta | Ícono       | Color de texto         |
| ------- | -------- | ----------- | ---------------------- |
| ≥ 100 % | Excedido | `warning`   | `--color-danger-text`  |
| ≥ 90 %  | Alerta   | `bell`      | `--color-warning-text` |
| ≥ 80 %  | Cuidado  | `eye`       | `--color-warning-text` |
| ≥ 60 %  | Normal   | `chart-bar` | `--color-warning-text` |
| < 60 %  | Bien     | `check`     | `--color-success-text` |

`BudgetStatusBadge` renderiza siempre ícono + texto. La tabla “Todo lo presupuestado”
usa la misma idea con `budgetStatusFromBackend()` y un texto para lectores de pantalla.

## Primitivas existentes

`src/frontend/src/components/ui/`

| Componente      | Estados                                                                     | Ejemplo / nota                                                                                           |
| --------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `CurrencyInput` | vacío, escribiendo, blur, focus                                             | `<CurrencyInput value={amount} onChange={setAmount} />`; acepta `id` y usa `inputMode="decimal"`.        |
| `Dialog`        | cerrado, abierto, Escape, backdrop, foco atrapado                           | `<Dialog isOpen={open} onClose={close} title="Editar gasto">…</Dialog>`                                  |
| `EmptyState`    | con/sin acción, `symbolic`, `illustration`                                  | `<EmptyState icon="cash" title="Sin gastos" action={{ label: "Cargar", onClick }} />`                    |
| `Field`         | default, help, error, required                                              | `<Field label="Monto" error={errors.monto}><input /></Field>`; cablea `aria-invalid`/`aria-describedby`. |
| `Money`         | ARS, USD, negativo, `sm`/`md`/`lg`                                          | `<Money amount={1234.5} />` → `$ 1.234,50`; `MoneyTotals` nunca suma monedas distintas.                  |
| `PageState`     | `loading`, `error`, `empty`, `success`                                      | `<PageState state="loading" skeleton={<SkeletonCard />} />`                                              |
| `Popover`       | cerrado, abierto, `align=left/center/right`                                 | `<Popover isOpen={open} content={<Menu />} onClose={close}><button /></Popover>`                         |
| `QueryState`    | loading, error, empty, success, error con datos previos                     | `<QueryState isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch}>{data}</QueryState>`        |
| `Select`        | cerrado, abierto, búsqueda, grupos, disabled, valor custom                  | `<Select value={value} onChange={setValue} options={options} />`; ver deuda #517.                        |
| `Skeleton`      | `default`, `text`, `circle`; `SkeletonCard`, `SkeletonRow`, `SkeletonChart` | `<Skeleton className="h-4 w-1/3" variant="text" />`; `aria-hidden`, decorativo.                          |
| `Sparkline`     | con datos (≥2 puntos), sin datos (no renderiza), con/sin `label`            | `<Sparkline data={[1, 3, 2]} label="Tendencia de octubre" />`                                            |
| `Table`         | estática, ordenable, caption visible/oculta, scope fila/columna             | `<Table caption="Gastos"><TableHead>…</TableHead></Table>`                                               |
| `formatMoney`   | ARS, USD, negativo, totales multi-moneda                                    | Utilidad en `utils/money.ts`; notación única `$ 1.234,50` / `U$S 1.234,50`.                              |

### `Field`

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

### `Dialog`

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

### `Money`

```tsx
<Money amount={1234.5} />            {/* $ 1.234,50 */}
<Money amount={7} currency="USD" />  {/* U$S 7,00 */}
<Money amount={-123} />              {/* -$ 123,00 */}
<MoneyTotals items={totals} />       {/* $ 30.000,00 + U$S 7,00 */}
```

No formatea por su cuenta: delega en `formatMoney`/`formatMoneyTotals` de
`src/frontend/src/utils/money.ts`. `size` sólo cambia el tamaño tipográfico.

### `PageState`

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

### `Table`

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

### `QueryState` y `Skeleton`

`QueryState` cubre los cuatro estados de una lectura y conserva datos previos cuando la
refetch falla (`QueryErrorBanner` + retry). `Skeleton`, `SkeletonCard`, `SkeletonRow` y
`SkeletonChart` son los placeholders: `aria-hidden` cuando son decorativos y
`aria-label="Cargando..."` en los bloques que representan una región.

### `EmptyState`

`symbolic` (default) para espacios secundarios; `illustration` para el primer vacío de
una vista principal. La acción es opcional y el título funciona como nombre accesible.

## Primitivas que faltan

| Primitiva | Reemplaza a               | Requisito                                  |
| --------- | ------------------------- | ------------------------------------------ |
| `Badge`   | Estados con color + texto | Variante accesible (color + ícono + texto) |

## Reglas de composición

1. **Nada de `style={{}}`** nuevo en pantallas núcleo. Si falta un valor, se agrega al
   token set. Las excepciones actuales están en el baseline del lint.
2. **Nada de `var(--` anidado.** `text-[var(--text-[var(--text-secondary)])]` no es CSS
   válido. El gate también rechaza `var(--token)` sin fallback cuando el token no existe.
   La deuda existente vive en `config/css_class_baseline.json` y solo achica.
3. **Un solo `<h1>` por pantalla** y jerarquía sin saltos.
4. **Todo elemento clickeable es `<button>` o `<Link>`.** Nunca `div`/`span`/`tr` con
   `onClick`.
5. **Estados distinguibles sin color:** ícono + texto + color.
6. **Espaciado en múltiplos de 4 px**, usando las utilidades existentes.
7. **Montos ≥ 14 px y datos ≥ 12 px.** El gate falla si aparece un `text-[<12px]` nuevo.

## Verificación

```bash
cd src/frontend
npx vitest run src/utils/contrast.test.ts src/pages/BudgetPage.status.test.tsx
npx tsc --noEmit
npx prettier --check src/

cd ../..
python config/scripts/validate_css_classes.py
```

Si el lint marca deuda nueva, se corrige. Si se resuelve deuda existente, se baja el
número en `config/css_class_baseline.json` (`--write-baseline` lo regenera desde cero).

## Cómo agregar un componente

1. Verificá que no exista algo equivalente en `components/ui/`.
2. Definí estados: default, hover, focus-visible, disabled, loading, error.
3. Documentá acá con una fila en la tabla y un ejemplo.
4. Agregá un test de accesibilidad (rol, nombre accesible, teclado).
5. Si introduce un token nuevo, justificá por qué no alcanza uno existente y sumalo al
   test de contraste.
