import axios from 'axios'
import type {
  Account,
  Card,
  AuthToken,
  User,
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
  Notification,
  FamilyGroup,
  ScheduledExpense,
  ImportJob,
} from '../types'

const TOKEN_KEY = 'auth_token'

export const getStoredToken = () => localStorage.getItem(TOKEN_KEY)
export const storeToken = (token: string) => localStorage.setItem(TOKEN_KEY, token)
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = getStoredToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      clearToken()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  },
)

// Auth
export const login = (email: string, password: string) =>
  api.post<AuthToken>('/auth/login', { email, password }).then((r) => r.data)

export const register = (full_name: string, email: string, password: string) =>
  api.post<AuthToken>('/auth/register', { full_name, email, password }).then((r) => r.data)

export const oauthLogin = (provider: string, idTokenOrCode: string) =>
  api.post<AuthToken>('/auth/oauth', { provider, id_token: idTokenOrCode }).then((r) => r.data)

export const oauthCallback = (provider: string, code: string) =>
  api.post<AuthToken>('/auth/oauth/callback', { provider, code }).then((r) => r.data)

export const getMe = () =>
  api.get<User>('/auth/me').then((r) => r.data)

export const changePassword = (current_password: string, new_password: string) =>
  api.put('/auth/password', { current_password, new_password })

export const getTelegramKey = () =>
  api.get<{ telegram_key: string }>('/auth/me/telegram-key').then((r) => r.data)

export const regenerateTelegramKey = () =>
  api.post<{ telegram_key: string }>('/auth/me/telegram-key/regenerate').then((r) => r.data)

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
  card_last4_old?: string
  bank?: string
}) =>
  api.get<DashboardSummary>('/dashboard/summary', { params }).then((r) => r.data)

export const getInstallmentsDashboard = () =>
  api.get<InstallmentGroup[]>('/dashboard/installments').then((r) => r.data)

export const getInstallmentsMonthlyLoad = () =>
  api.get<{ month: string; total: number; count: number; is_past: boolean; is_current: boolean }[]>('/dashboard/installments/monthly-load').then((r) => r.data)

export const getScheduledSummary = () =>
  api.get<{
    installments: {
      id: number
      description: string
      amount: number
      currency: string
      scheduled_date: string
      installment_number: number
      installment_total: number
      category_name: string | null
      category_color: string | null
      card: string
      bank: string
    }[]
    manual: {
      id: number
      description: string
      amount: number
      currency: string
      scheduled_date: string
      category_name: string | null
      category_color: string | null
      card: string
      bank: string
    }[]
  }>('/dashboard/scheduled-summary').then((r) => r.data)

export const getAccountExpenses = (month?: string) =>
  api.get<{
    id: number
    date: string
    description: string
    amount: number
    currency: string
    category_id: number | null
    category_name: string | null
    category_color: string | null
    card: string
    bank: string
    person: string
  }[]>('/dashboard/account-expenses', { params: month ? { month } : undefined }).then((r) => r.data)

export const getScheduledExpenses = async (params?: {
  status?: string
  installment_group_id?: string
}): Promise<ScheduledExpense[]> => {
  const { data } = await api.get('/scheduled-expenses', { params })
  return data
}

export const executeScheduledExpense = async (id: number) => {
  const { data } = await api.post(`/scheduled-expenses/${id}/execute`)
  return data
}

export const updateScheduledExpense = async (id: number, payload: Partial<ScheduledExpense>) => {
  const { data } = await api.put(`/scheduled-expenses/${id}`, payload)
  return data
}

export const cancelScheduledExpense = async (id: number) => {
  const { data } = await api.delete(`/scheduled-expenses/${id}`)
  return data
}

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

export const getCardCategoryBreakdown = (params?: { month?: string; bank?: string }) =>
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

export const getUsdRate = () =>
  api.get<{ rate: number; date: string; source: string }>('/investments/usd-rate').then((r) => r.data)

export const refreshManualPrices = () =>
  api.post<{ updated: number }>('/investments/refresh-manual-prices').then((r) => r.data)

export const getManualCashBalances = () =>
  api.get<Record<string, { ars: number | null; usd: number | null }>>('/investments/manual-cash-balances').then((r) => r.data)

export const putManualCashBalance = (broker: string, ars: number | null, usd: number | null) =>
  api.put(`/investments/manual-cash-balances/${encodeURIComponent(broker)}`, { ars, usd }).then((r) => r.data)

export const deleteManualCashBalance = (broker: string) =>
  api.delete(`/investments/manual-cash-balances/${encodeURIComponent(broker)}`).then((r) => r.data)

export const getCashBalances = () =>
  api.get<{
    iol: { ars: number | null; usd: number | null; configured: boolean; error?: string }
    ppi: { ars: number | null; usd: number | null; configured: boolean; error?: string; _raw_keys?: string[] }
  }>('/investments/cash-balances').then((r) => r.data)

export const getTopMerchants = (params?: { month?: string; person?: string; bank?: string; limit?: number }) =>
  api.get<TopMerchant[]>('/dashboard/top-merchants', { params }).then((r) => r.data)

// Notifications
export const getNotifications = () =>
  api.get<Notification[]>('/notifications').then((r) => r.data)
export const getUnreadCount = () =>
  api.get<{ count: number }>('/notifications/unread-count').then((r) => r.data)
export const markNotificationRead = (id: number) =>
  api.put(`/notifications/${id}/read`).then((r) => r.data)
export const acceptGroupInvitation = (id: number) =>
  api.post(`/notifications/${id}/accept`).then((r) => r.data)
export const rejectGroupInvitation = (id: number) =>
  api.post(`/notifications/${id}/reject`).then((r) => r.data)
export const deleteNotification = (id: number) =>
  api.delete(`/notifications/${id}`).then((r) => r.data)

// Family Group
export const getMyGroup = () =>
  api.get<FamilyGroup | null>('/groups/me').then((r) => r.data)
export const inviteToGroup = (inviteCode: string) =>
  api.post('/groups/invite', { invite_code: inviteCode }).then((r) => r.data)
export const getMyInviteCode = () =>
  api.get<{ invite_code: string }>('/groups/my-invite-code').then((r) => r.data)
export const generateInviteCode = () =>
  api.post<{ invite_code: string }>('/groups/generate-invite-code').then((r) => r.data)
export const leaveGroup = () =>
  api.delete('/groups/leave').then((r) => r.data)

// Accounts
export const getAccounts = () =>
  api.get<Account[]>('/accounts').then((r) => r.data)
export const createAccount = (data: { name: string; type: string }) =>
  api.post<Account>('/accounts', data).then((r) => r.data)
export const updateAccount = (id: number, data: { name?: string; type?: string }) =>
  api.put<Account>(`/accounts/${id}`, data).then((r) => r.data)
export const deleteAccount = (id: number) =>
  api.delete(`/accounts/${id}`).then((r) => r.data)

// Cards
export const getCards = () =>
  api.get<Card[]>('/cards').then((r) => r.data)
export const createCard = (data: { name: string; bank?: string; card_type?: string }) =>
  api.post<Card>('/cards', data).then((r) => r.data)
export const updateCard = (id: number, data: { name?: string; bank?: string; card_type?: string }) =>
  api.put<Card>(`/cards/${id}`, data).then((r) => r.data)
export const deleteCard = (id: number) =>
  api.delete(`/cards/${id}`).then((r) => r.data)

// Import Jobs
export async function createImportJob(file: File, signal?: AbortSignal): Promise<ImportJob> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await api.post('/import-jobs', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    signal  // Pass abort signal to axios
  })
  return res.data
}

export async function listImportJobs(status?: string): Promise<ImportJob[]> {
  const res = await api.get('/import-jobs', { params: { status } })
  return res.data
}

export async function getImportJob(jobId: number): Promise<ImportJob> {
  const res = await api.get(`/import-jobs/${jobId}`)
  return res.data
}

export async function confirmImportJob(jobId: number, rows: SmartImportRow[]): Promise<{ imported: number; skipped: number; scheduled: number }> {
  const res = await api.post(`/import-jobs/${jobId}/confirm`, { rows })
  return res.data
}

export async function deleteImportJob(jobId: number): Promise<void> {
  await api.delete(`/import-jobs/${jobId}`)
}

export async function updateImportPreview(jobId: number, previewData: any): Promise<void> {
  await api.put(`/import-jobs/${jobId}/preview`, previewData)
}
