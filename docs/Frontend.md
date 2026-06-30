# Frontend

## Overview

NikoFin's frontend is a React 18 SPA built with TypeScript, Vite, and TanStack Query v5. It follows GNOME HIG-inspired design with CSS variables for theming.

## Routes

| Path                  | Component         | Description                    |
| --------------------- | ----------------- | ------------------------------ |
| `/login`              | LoginPage         | Email/password + OAuth login   |
| `/reset-password`     | ResetPasswordPage | Password reset with token      |
| `/`                   | Dashboard         | Main summary page              |
| `/accounts`           | AccountsPage      | Account + card management      |
| `/expenses`           | ExpensesPage      | Expense list with filters      |
| `/cat-dashboard`      | CategoryDashboard | Category treemap visualization |
| `/installments`       | InstallmentsPage  | Installment groups view        |
| `/investments`        | InvestmentsPage   | Investment portfolio           |
| `/import-jobs/:jobId` | ImportJobPreview  | Import preview + confirmation  |
| `/categories`         | CategoriesPage    | Category configuration         |

## Key Components

### Layout

- **App.tsx**: Root component with routing, bottom nav, sidebar
- **MainLayout.tsx**: Page wrapper with sidebar + content area
- **Sidebar**: Collapsible navigation with icons
- **BottomNav**: Mobile bottom navigation bar

### Expense Management

- **ExpenseModals.tsx**: Create/edit expense modal with category creation
- **ExpenseDetailModal.tsx**: View expense details (uses shared DetailModal)
- **ExpensesPage.tsx**: Expense list with filters (date, category, card, account, person)

### Card & Account Management

- **AccountsManager.tsx**: Account creation form with type selection
- **CardsManager.tsx**: Card creation/management UI
- **CardAccountModal.tsx**: Shared modal for creating cards/accounts
- **UserPanel.tsx**: User settings panel with Accounts tab (click-to-edit rows)

### Import

- **ImportUploadButton.tsx**: File upload with progress tracking
- **ImportJobPreview.tsx**: Transaction preview with card mapping, duplicate flags

### Dashboard

- **Dashboard.tsx**: Main dashboard with totals, trends, transactions
- **CategoryTreemap.tsx**: Recharts treemap for category visualization

### AI

- **AIAssistant.tsx**: Expense analysis chat (SSE streaming)
- **InvestmentsAssistant.tsx**: Investment analysis chat

### Investments

- **InvestmentsPage.tsx**: Portfolio table with IOL/PPI sync
- **InvestmentDetailModal.tsx**: View/edit investment details

### Shared

- **DetailModal.tsx**: Modal shell with GNOME HIG styling, focus trap, mobile bottom sheet
- **TransactionDetailModal.tsx**: Import transaction detail view
- **ConfirmDialog.tsx**: Confirmation dialog component
- **NotificationsPanel.tsx**: Notification bell panel with SSE
- **InvitationDisclaimer.tsx**: Group invitation disclaimer modal

### UI Components (`components/ui/`)

- **Select.tsx**: Custom select with search
- **AutocompleteInput.tsx**: Autocomplete input
- **CurrencyInput.tsx**: Currency-formatted input
- **Popover.tsx**: Popover dropdown
- **Skeleton.tsx**: Loading skeleton
- **EmptyState.tsx**: Empty state placeholder
- **Sparkline.tsx**: Mini sparkline chart
- **SpinButton.tsx**: Numeric spin button

## State Management

### Server State (TanStack Query)

All API data is managed via TanStack Query v5:

```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ["expenses", filters],
  queryFn: () => getExpenses(filters),
});
```

**Query invalidation** after mutations:

```typescript
queryClient.invalidateQueries({ queryKey: ["expenses"] });
queryClient.invalidateQueries({ queryKey: ["dashboard"] });
```

### Client State (React Context)

| Context                 | Purpose                            |
| ----------------------- | ---------------------------------- |
| `ThemeContext`          | Light/dark mode toggle             |
| `NotificationsContext`  | SSE connection, notification state |
| `UploadProgressContext` | Active upload tracking             |
| `FamilyGroupContext`    | Current group, members             |
| `PanelWidthContext`     | Sidebar width state                |

### Local State (useState/useReducer)

Component-specific state (modals, forms, filters) uses local state.

## Styling

### CSS Variables

Theming via CSS custom properties:

```css
:root {
  --color-primary: #3584e4;
  --color-surface: #ffffff;
  --color-base-alt: #f6f5f4;
  --text-primary: #242424;
  --text-secondary: #77767b;
  --text-tertiary: #929292;
  --border-color: #e0e0e0;
}
```

### GNOME HIG-Inspired Design

- Rounded corners (8px-12px)
- Subtle shadows (`shadow-gnome-lg`)
- 44px minimum touch targets
- Consistent spacing (gap-3, space-y-6)
- Primary color for interactive elements

### Responsive Layout

- Mobile: Bottom navigation, stacked layout
- Desktop: Sidebar navigation, side-by-side layout
- `visualViewport` API for keyboard handling
- `viewport-fit=cover` for mobile browsers

## API Client

**File**: `api/client.ts`

All API calls use axios with interceptors:

```typescript
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:8001",
});

// Auth interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
```

**Key functions**:

- `getExpenses(filters)`, `createExpense(data)`, `updateExpense(id, data)`
- `getCards()`, `createCard(data)`, `updateCard(id, data)`
- `getAccounts()`, `createAccount(data)`
- `createImportJob(file, signal, onUploadProgress)`
- `confirmImportJob(jobId, rows, cardsMapping)`
- `getDashboard(filters)`
- `analysisChat(question, month)` (SSE)
- `investmentsAssistantChat(question)` (SSE)

## TypeScript Types

**File**: `types/index.ts`

Key interfaces:

- `Expense`, `Card`, `Account`, `Category`
- `Investment`, `ImportJob`, `SmartImportRow`
- `Notification`, `FamilyGroup`, `GroupMember`
- `UploadProgress`, `DashboardSummary`
- `SmartImportPreview`, `CardsMapping`

## Workers

### Notifications SharedWorker

**File**: `workers/notifications.worker.ts`

- Maintains single SSE connection across all tabs
- Uses `BroadcastChannel` for cross-tab communication
- Exponential backoff reconnection
- Handles token expiry

## Hooks

| Hook                            | Purpose                        |
| ------------------------------- | ------------------------------ |
| `useExpenseFilters`             | URL-based expense filter state |
| `useFocusTrap`                  | Modal focus trap               |
| `useModal` / `useModalWithData` | Modal open/close state         |
| `useNotifications`              | SSE notification context       |
| `useUndoToast`                  | Undo toast for deletions       |

## Utils

| File             | Purpose                        |
| ---------------- | ------------------------------ |
| `format.tsx`     | Currency formatting (ARS/USD)  |
| `formatText.tsx` | Text formatting utilities      |
| `toast.ts`       | Toast event system (showToast) |
