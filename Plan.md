On going
--------
    - Cambi UI en pop-up eliminar gasto/expense.
    - mejorar visaulizacion de categorias.
    - Forzar el uso de letras Negras y fondo azul cuando esta seleccionada el item sombreado al hacer hover sobre el item y cambiar el color en el hover.
    - Cambios generales para interacciones con los distintos sitios.

To do
-----
    - Agregar opcion para comparar (item por item) mes corriente y hasta 2 meses atras en consumos.
    - Cambio UX en Installments. Completados deben estar ocultos por default.
    - Ajustar UI Main dashboard para soporte Pasivos.
    - Agentic en Telegram: Adaptar el cambio de UX de token (Pushed back)
    - Agentic en telegram: UI Change for Token Telegram
    - I+D & pos aplicación de graficos orientados a finanzas.
    - Implementacion de presupuestos flexibes (no rigidos)
    - Graficos de ROI +  Tickers en panel de Inversiones. (Pushed back)
    - Cambios UX en el item de Haberes.

Done
----
    - Agregar opcion gastos programados.
    - Agregar opcion para importar CSV/XSLX, reportes mensuales.
    - Rework Login+Store Personal Data (Urgent)
    - Cambios generales UX/UI tarjetas.
    - Cambiar stilo del sitio (GNOME Adwaita restyling con dark mode)
    - Reconfiguracion inversiones Post Multiusuario/grupos familiares
    - soporte grupo familiar
    - Adaptar sitio de consumo de tarjetas a Finanzas personales
    - Pasar actual main dashboard -> Credit Card dashboard
    - Cambiar dashboard para mostrar información de finanzas personales en vez de tarjeta.
    - soporte multiusuario
    - Permitir crear expenses en cuotas (Installments)
    - Ajustar sitio Installments
        - Cambiar nombre a Consumo en cuotas
        - Agregrar grafico de cuotas pasdas/futuras
        - Cambiar forma de agrupacion en Installments
    - Ajustar en consumos la multiplicidad de tarjetas. Usar el Card_ID para agrupar
    - Carga manual Inversiones
        - Opcion de agregar Saldo de cuenta comitente en broker manual
        - Al filtrar por broker usar ese dato en la carga.
        - Al Usar broker manual permitir la carga a traves del drop-down list.
        - Actualizacion de precios de tickers manuales a traves de IOL, Fallback PPI
        - Actualizacion dinamica de precios, near real time
    - Actualizar el precio de todas las acciones independientemente del broker
    - deduplicacion de expenses a traves de tarjetas de credito.
    - Re-organize box IA Main dashboard
    - Obtencion automatico del precio actual para determinar Ganancia/perdida de tickers manuales
    - Ganancias/Perdidas en inversiones.
    - modularizar aplicacion
    - Permitir el ingreso manual de tickers
    - Re armar en categorias y sub-categorias.
    - Mover card de tarjetas a continuación de los gastos.
    - Lectura y analisis de PDF de bancos.
    - Capacidad de crear cuotas futuras sin deduplicación. (Testing)
    - Mostrar información de inversiones.
    - Ajustar PPI Investment

## GNOME 50 Styling Standards

### CSS Variables para Charts (ya aplicadas)
```css
/* Light mode */
--chart-grid: #e4e4e7;
--chart-text: #9a9996;
--chart-tooltip-bg: #ffffff;
--chart-tooltip-border: #e4e4e7;
--chart-tooltip-text: #1c1b1f;

/* Dark mode */
--chart-grid: #5e5c64;
--chart-text: #c0bfbc;
--chart-tooltip-bg: #383838;
--chart-tooltip-border: #5e5c64;
--chart-tooltip-text: #ffffff;
```

### Recharts: Colores y Variables Correctas
| Elemento | Variable CSS |
|----------|-------------|
| Grid | `stroke="var(--chart-grid)"` |
| Ticks/XAxis/YAxis text | `fill: 'var(--chart-text)'` |
| Tooltip background | `backgroundColor: 'var(--chart-tooltip-bg)'` |
| Tooltip border | `borderColor: 'var(--chart-tooltip-border)'` |
| Tooltip text | `color: 'var(--chart-tooltip-text)'` |
| Tooltip item | `itemStyle: { color: 'var(--chart-tooltip-text)' }` |

### Archivos con Recharts (requieren revisión)
- `InstallmentsPage.tsx` - ✅ Corregido
- `AccountsPage.tsx` - ⚠️ Tooltip revisar
- `Dashboard.tsx` - ⚠️ Tooltip revisar
- `CategoryDashboard.tsx` - ✅ Corregido
- `CardEvolutionChart.tsx` - ✅ Corregido

### GNOME 50 Component Specs
| Component | Spec |
|-----------|------|
| Button | `px-4 py-2`, `text-sm`, `rounded` (6px) |
| Modal/Dialog | `rounded-2xl` (12px), `p-6` (24px), `max-width: 400px (alert) / 600px (action)` |
| Pills/Badges | `rounded-full` |

### Complete GNOME 50 Color Palette (YA APLICADO)

**Escalas de color completas:**
- Red: 1-7
- Green: 1-7
- Yellow: 1-7
- Blue: 1-7
- Purple: 1-7
- Orange: 1-7
- Brown: 1-7
- Gray: 1-7

**Variables nuevas agregadas:**
- `--font-family`: Stack GNOME (`Inter, Cantarell, Ubuntu, system-ui`)
- `--shadow-sm`, `--shadow-md`
- `--focus-ring`
- Color scales completas en `tailwind.config.js`

### Estado de Títulos
- Los títulos **NO** están en azul
- Usan `text-primary` → `#1c1b1f` (light) / `#ffffff` (dark)
- El azul GNOME es `--color-primary` → `#3584e4` / `#62a0ea`

### Fix Crítico Aplicado: Tailwind textColor vs backgroundColor

**Problema:** `text-primary` mapeaba a `--color-primary` (azul) en lugar de `--text-primary` (texto)

**Solución:** Separar `textColor` y `backgroundColor` en `tailwind.config.js`:
```js
textColor: {
  primary: 'var(--text-primary)',   // Texto oscuro/claro
  secondary: 'var(--text-secondary)',
  ...
},
backgroundColor: {
  primary: 'var(--color-primary)',  // Azul GNOME
  ...
}
```

**Resultado:**
- `text-primary` → texto oscuro/claro ✅
- `bg-primary` → azul GNOME ✅
- `btn-primary` sigue funcionando (usa `color: var(--color-on-primary)` en CSS)
