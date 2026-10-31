# Frontend

> Reescrito el 2026-10-30. La versión anterior listaba rutas eliminadas (`/accounts`),
> componentes inexistentes (`MainLayout`, `AccountsManager`, `BottomNav`) y archivos del
> asistente que ya no existen.

## Stack

| Pieza | Versión / uso |
|---|---|
| React | 18, SPA con Vite |
| TypeScript | strict, `tsc --noEmit` en CI |
| Router | React Router, rutas declaradas en `App.tsx` e `InstitutionalRoutes.tsx` |
| Datos | TanStack Query v5 (`useQuery` en 23 archivos, `useMutation` en 18) |
| Estilos | CSS propio con tokens GNOME/Adwaita en `index.css` |
| Gráficos | Recharts (donas, barras) y treemap propio |
| Tests | Vitest (unit) + Playwright (e2e) |

## Rutas

### App autenticada (`App.tsx`)

| Ruta | Componente | Notas |
|---|---|---|
| `/login` | `LoginPage` | Password, Google, Telegram |
| `/` | `Dashboard` | KPIs, tendencia, categorías |
| `/expenses` | `ExpensesPage` | Lista, filtros, bulk, CSV |
| `/budget` | `BudgetPage` | Plan 50/30/20 y límites por categoría |
| `/cat-dashboard` | `CategoryDashboard` | Treemap y drilldown |
| `/clasificacion` | `ClasificacionPage` | Categorías y tags |
| `/categories/:id` | `ClasificacionPage` | Detalle de categoría |
| `/tags`, `/categories` | redirect a `/clasificacion` | Compatibilidad |
| `/installments` | `InstallmentsPage` | Cuotas |
| `/investments` | `InvestmentsPage` | Portfolio |
| `/import-jobs/:jobId` | `ImportJobPreview` | Preview y confirmación de import |
| `/notifications` | `NotificationsPage` | Bandeja |
| `/guide`, `/guide/:topic` | `GuidePage` | 9 guías |
| `/changes`, `/changes/:version` | `ChangesPage` | What's New |
| `/x/:slug` | `AdminPage` | Panel admin (sin gate de rol en cliente) |
| `*` | `Dashboard` | **No hay 404** ([#520](https://github.com/cheloim/perExp/issues/520)) |

### Institucionales / públicas (`InstitutionalRoutes.tsx`)

`/privacy`, `/tos`, `/guide/*`, `/changes/*`, `/novedades` y `LandingPage` como fallback.
`LandingPage` también se sirve según el hostname.

### Quick view (Mini App de Telegram)

`pages/quick/` contiene las vistas compactas que se abren dentro de Telegram.

## Estado

Solo tres contextos globales:

| Contexto | Responsabilidad |
|---|---|
| `ThemeContext` | Claro/oscuro y preferencia |
| `NotificationsContext` | SSE + contador de no leídas |
| `UploadProgressContext` | Progreso de subida de archivos |

No hay store global (Redux/Zustand): **el estado del servidor es de TanStack Query** y el
estado de UI es local o vive en la URL. `docs/guides/state-management.md` describe un
endpoint `PUT /auth/me/preference` que **no existe**; está pendiente de corrección (#532).

## Capa de API

| Archivo | Estado |
|---|---|
| `api/client.ts` (1.086 líneas, 188 exports) | **En uso** por 41 archivos. Es la capa real. |
| `api/client-generated.ts` (22.563 líneas) | **Muerto:** cero importadores. Se sigue generando con orval en CI. |
| `types/index.ts` | Tipos manuales en uso |
| `types/generated/` | Tipos de orval, sin consumidores |

Hay que elegir uno. Trackeado en [#534](https://github.com/cheloim/perExp/issues/534).

## Componentes clave

### Layout y navegación
- `Sidebar.tsx`, `SidebarIcons.tsx`, `MobileNav.tsx`, `MobileHeader.tsx`
- `UserPanel.tsx` — panel lateral con preferencias, Telegram y logout
- `ImpersonationBanner.tsx`, `ImpersonationRequestModal.tsx`
- `WhatsNewModal.tsx`, `OnboardingWalkthrough.tsx`

### Gastos
- `ExpensesPage.tsx` — lista, filtros, selección múltiple, export
- `ExpenseModals.tsx` — alta/edición, creación de categoría inline
- `ExpenseDetailModal.tsx`, `TransactionDetailModal.tsx`, `DetailModal.tsx`
- `QuickEditPopover.tsx`, `BulkActionBar.tsx`, `BulkTagPicker.tsx`
- `ImportUploadButton.tsx`, `UploadProgressBanner.tsx`, `AutoDetectedBanner.tsx`

### Asistente
- `components/assistant/Assistant.tsx` — entrada
- `AssistantShell.tsx` — UI del chat y scroll
- `useThread.ts` — persistencia del hilo (hoy sobrevive al logout)
- `useAssistantChat.ts`, `streamTo.ts` — streaming SSE
- `configs.ts`, `domainOf.ts` — configuración por dominio
- `Bubble.tsx` — burbuja de mensaje

### Primitivas (`components/ui/`)
`CurrencyInput`, `EmptyState`, `Popover`, `Select`, `Skeleton`, `Sparkline`.
Ver `Design-System.md` para estado y requisitos.

## Convenciones

- **Un archivo por página grande**, pero con umbral: ninguna página nueva debería superar
  ~600 líneas sin extraer subcomponentes.
- **No `style={{}}`** en pantallas nuevas; usar tokens.
- **Todo click en `<button>` o `<Link>`.**
- **Un solo formato de moneda** (`formatMoney` a crear; hoy `formatCurrency` duplica el
  símbolo en USD).
- **Nombres de archivo:** `PascalCase.tsx` para componentes, `camelCase.ts` para utilidades.
- **Tests junto al archivo** (`*.test.tsx`) y e2e en `e2e/`.

## Comandos

```bash
cd src/frontend

npm run dev          # Vite
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # Prettier
npm test             # Vitest
npm run test:e2e     # Playwright
npm run generate:api # orval desde docs/specs/openapi.yaml
```

## Deuda conocida

| Tema | Issue |
|---|---|
| ARS/USD mezclados en totales | [#508](https://github.com/cheloim/perExp/issues/508) |
| Tres definiciones de "gasto" | [#509](https://github.com/cheloim/perExp/issues/509) |
| Drilldowns que pierden filtros | [#510](https://github.com/cheloim/perExp/issues/510) |
| Carga/error/vacío indistinguibles | [#511](https://github.com/cheloim/perExp/issues/511) |
| Accesibilidad estructural | [#517](https://github.com/cheloim/perExp/issues/517) |
| Contraste AA | [#518](https://github.com/cheloim/perExp/issues/518) |
| Design system incompleto | [#520](https://github.com/cheloim/perExp/issues/520) |
