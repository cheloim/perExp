import axios from 'axios'
import type {
  Category,
  Expense,
  ExpenseCreate,
  DashboardSummary,
  InstallmentGroup,
  CardSummary,
  ImportPreview,
  ColumnMapping,
  SmartImportPreview,
  SmartImportRow,
  AnalysisHistory,
  AITrendsResponse,
  Investment,
  InvestmentCreate,
  TopMerchant,
} from '../types'

const api = axios.create({ baseURL: 'http://localhost:8000' })

// Categories
export const getCategories = () =>
  api.get<Category[]>('/categories').then((r) => r.data)

export const createCategory = (data: Omit<Category, 'id'>) =>
  api.post<Category>('/categories', data).then((r) => r.data)

export const updateCategory = (id: number, data: Omit<Category, 'id'>) =>
  api.put<Category>(`/categories/${id}`, data).then((r) => r.data)

export const deleteCategory = (id: number) =>
  api.delete(`/categories/${id}`).then((r) => r.data)

// Expenses
export const getExpenses = (params?: {
  category_id?: number
  uncategorized?: boolean
  month?: string
  bank?: string
  person?: string
  card?: string
  search?: string
  date_from?: string
  date_to?: string
  limit?: number
  offset?: number
}) => api.get<Expense[]>('/expenses', { params }).then((r) => r.data)

export const getDistinctValues = () =>
  api.get<{ banks: string[]; persons: string[]; cards: string[] }>('/expenses/distinct-values').then((r) => r.data)

export const getCardOptions = () =>
  api.get<{ persons: string[]; by_person: Record<string, Record<string, string[]>> }>('/expenses/card-options').then((r) => r.data)

export const checkDuplicate = (params: {
  date: string
  amount: number
  description: string
  transaction_id?: string | null
}) =>
  api
    .get<{ duplicate: boolean; existing_id?: number; existing_date?: string; existing_description?: string; existing_amount?: number }>(
      '/expenses/check-duplicate',
      { params },
    )
    .then((r) => r.data)

export const createExpense = (data: ExpenseCreate) =>
  api.post<Expense>('/expenses', data).then((r) => r.data)

export const updateExpense = (id: number, data: Partial<ExpenseCreate>) =>
  api.put<Expense>(`/expenses/${id}`, data).then((r) => r.data)

export const deleteExpense = (id: number) =>
  api.delete(`/expenses/${id}`).then((r) => r.data)

// Dashboard
export const getDashboard = (params?: {
  month?: string
  group_by?: 'week' | 'month' | 'year'
  search?: string
  person?: string
  category_id?: number
  card_last4?: string
  bank?: string
}) =>
  api.get<DashboardSummary>('/dashboard/summary', { params }).then((r) => r.data)

export const getInstallmentsDashboard = () =>
  api.get<InstallmentGroup[]>('/dashboard/installments').then((r) => r.data)

export const getInstallmentsMonthlyLoad = () =>
  api.get<{ month: string; total: number; count: number }[]>('/dashboard/installments/monthly-load').then((r) => r.data)

export const getCardSummary = () =>
  api.get<CardSummary[]>('/dashboard/card-summary').then((r) => r.data)

// Import — manual (column mapping)
export const importPreview = (file: File, mapping?: Partial<ColumnMapping>) => {
  const formData = new FormData()
  formData.append('file', file)
  if (mapping?.date_col)   formData.append('date_col',   mapping.date_col)
  if (mapping?.desc_col)   formData.append('desc_col',   mapping.desc_col)
  if (mapping?.amount_col) formData.append('amount_col', mapping.amount_col)
  if (mapping?.card_col)   formData.append('card_col',   mapping.card_col)
  if (mapping?.bank_col)   formData.append('bank_col',   mapping.bank_col)
  if (mapping?.person_col) formData.append('person_col', mapping.person_col)
  return api.post<ImportPreview>('/import/preview', formData).then((r) => r.data)
}

export const importConfirm = (file: File, mapping: ColumnMapping) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('date_col',   mapping.date_col)
  formData.append('desc_col',   mapping.desc_col)
  formData.append('amount_col', mapping.amount_col)
  if (mapping.card_col)   formData.append('card_col',   mapping.card_col)
  if (mapping.bank_col)   formData.append('bank_col',   mapping.bank_col)
  if (mapping.person_col) formData.append('person_col', mapping.person_col)
  return api
    .post<{ imported: number; skipped: number }>('/import/confirm', formData)
    .then((r) => r.data)
}

// Import — smart (LLM, supports PDF)
export const importSmart = (file: File) => {
  const formData = new FormData()
  formData.append('file', file)
  return api.post<SmartImportPreview>('/import/smart', formData).then((r) => r.data)
}

export const importRowsConfirm = (rows: SmartImportRow[]) =>
  api
    .post<{ imported: number; skipped: number }>('/import/rows-confirm', { rows })
    .then((r) => r.data)

// Analysis history
export const getAnalysisHistory = () =>
  api.get<AnalysisHistory[]>('/analysis/history').then((r) => r.data)

export const deleteAnalysisHistory = (id: number) =>
  api.delete(`/analysis/history/${id}`).then((r) => r.data)

export const getDashboardAITrends = (params?: { month?: string }) =>
  api.get<AITrendsResponse>('/dashboard/ai-trends', { params }).then((r) => r.data)

export const deleteAllExpenses = () =>
  api.delete<{ deleted: number }>('/expenses/all').then((r) => r.data)

export const getCategoryTrend = (months = 4) =>
  api.get<{ rows: Record<string, number | string>[]; categories: { name: string; color: string }[] }>(
    '/dashboard/category-trend', { params: { months } }
  ).then((r) => r.data)

export const getCardCategoryBreakdown = (params?: { month?: string; card_last4?: string; bank?: string }) =>
  api.get<{ rows: Record<string, number | string>[]; categories: { name: string; color: string }[] }>(
    '/dashboard/card-category-breakdown', { params }
  ).then((r) => r.data)

export const bulkUpdateCategory = (ids: number[], category_id: number | null) =>
  api.post<{ updated: number }>('/expenses/bulk-category', { ids, category_id }).then((r) => r.data)

export const recategorizeExpenses = (only_uncategorized = false) =>
  api.post<{ updated: number; total: number }>('/expenses/recategorize', { only_uncategorized }).then((r) => r.data)

export const applyBaseHierarchy = () =>
  api.post<{ created: number; updated: number }>('/categories/apply-base-hierarchy').then((r) => r.data)

// Investments
export const getInvestments = (broker?: string) =>
  api.get<Investment[]>('/investments', { params: broker ? { broker } : {} }).then((r) => r.data)

export const createInvestment = (data: InvestmentCreate) =>
  api.post<Investment>('/investments', data).then((r) => r.data)

export const updateInvestment = (id: number, data: InvestmentCreate) =>
  api.put<Investment>(`/investments/${id}`, data).then((r) => r.data)

export const updateInvestmentPrice = (id: number, current_price: number | null) =>
  api.patch<Investment>(`/investments/${id}/price`, { current_price }).then((r) => r.data)

export const deleteInvestment = (id: number) =>
  api.delete(`/investments/${id}`).then((r) => r.data)

export const getSettings = () =>
  api.get<Record<string, string>>('/settings').then((r) => r.data)

export const putSetting = (key: string, value: string) =>
  api.put(`/settings/${key}`, { value }).then((r) => r.data)

export const syncIOL = () =>
  api.post<{ broker: string; created: number; updated: number; total: number }>('/investments/sync/iol').then((r) => r.data)

export const syncPPI = () =>
  api.post<{ broker: string; created: number; updated: number }>('/investments/sync/ppi').then((r) => r.data)

export const deduplicateInvestments = () =>
  api.post<{ removed: number }>('/investments/deduplicate').then((r) => r.data)

export const getTopMerchants = (params?: { month?: string; person?: string; bank?: string; card_last4?: string; limit?: number }) =>
  api.get<TopMerchant[]>('/dashboard/top-merchants', { params }).then((r) => r.data)
