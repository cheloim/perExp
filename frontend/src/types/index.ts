export interface Notification {
  id: number
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  read: boolean
  created_at: string
}

export interface GroupMember {
  id: number
  user_id: number
  full_name: string
  dni: string
  role: string
  status: string
  joined_at: string
}

export interface FamilyGroup {
  id: number
  name: string
  members: GroupMember[]
}

export interface AuthToken {
  access_token: string
  token_type: string
}

export interface User {
  id: number
  dni?: string | null
  full_name: string
  email: string
  is_active: boolean
  created_at: string
  provider?: string | null
  avatar_url?: string | null
}

export interface Category {
  id: number
  name: string
  color: string
  keywords: string
  parent_id?: number | null
}

export interface Account {
  id: number
  name: string
  type: string
  user_id: number
  created_at: string
}

export interface Card {
  id: number
  name: string
  bank: string
  holder: string
  card_type: string
  user_id: number
  created_at: string
}

export interface Expense {
  id: number
  date: string
  description: string
  amount: number
  currency: string
  category_id: number | null
  category_name: string | null
  category_color: string | null
  // Legacy fields
  card: string
  bank: string
  person: string
  notes: string
  transaction_id?: string | null
  installment_number?: number | null
  installment_total?: number | null
  installment_group_id?: string | null
  // New structured fields
  account_id?: number | null
  card_id?: number | null
  account_rel?: Account | null
  card_rel?: Card | null
}

export interface ExpenseCreate {
  date: string
  description: string
  amount: number
  currency?: string
  category_id?: number | null
  // Legacy fields
  card?: string
  bank?: string
  person?: string
  notes?: string
  transaction_id?: string | null
  installment_number?: number | null
  installment_total?: number | null
  installment_group_id?: string | null
  // New structured fields
  account_id?: number | null
  card_id?: number | null
}

export interface CategorySummary {
  category_id: number | null
  category_name: string
  category_color: string
  parent_id?: number | null
  parent_name?: string | null
  parent_color?: string | null
  total: number
  count: number
  previous_total?: number
}

export interface PeriodSummary {
  period: string
  total: number
  count: number
}

export interface CurrencySummary {
  currency: string
  total: number
  count: number
}

export interface CardBySummary {
  card: string
  bank: string
  person: string
  total: number
  count: number
}

export interface CardConsumption {
  card: string
  bank: string
  total_amount: number
  count: number
  currency: string
  last_used: string | null
}

export interface DashboardSummary {
  total_expenses: number
  total_amount: number
  total_by_account: number
  by_category: CategorySummary[]
  by_period: PeriodSummary[]
  by_currency: CurrencySummary[]
  by_card: CardBySummary[]
  recent_expenses: Expense[]
  trend_data: {
    history: { month: string; total: number; count: number }[]
    future_installments: Record<string, number>
  }
}

export interface InstallmentGroup {
  installment_group_id: string
  description: string
  installment_total: number
  installments_paid: number
  remaining_installments: number
  total_amount: number
  installment_amount: number
  next_date: string | null
  next_dates: string[]
  category_id: number | null
  category_name: string | null
  category_color: string | null
  bank: string
  person: string
  currency: string
  card: string
}

export interface ScheduledExpense {
  id: number
  installment_group_id: string
  installment_number: number
  installment_total: number
  scheduled_date: string
  amount: number
  currency: string
  description: string
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED'
  category_id: number | null
  card: string
  bank: string
  person: string
}

export interface CardSummary {
  holder: string
  bank: string
  card_name: string
  card_type: string
  total_amount: number
  count: number
  currency: string
  last_used: string | null
  monthly?: { month: string; total: number }[]
}

export interface ImportPreviewRow {
  date: string
  description: string
  amount: number
  suggested_category: string | null
  is_duplicate?: boolean
}

export interface ImportPreview {
  rows: ImportPreviewRow[]
  columns: string[]
  date_col: string
  desc_col: string
  amount_col: string
  card_col: string
  bank_col: string
  person_col: string
}

export interface ColumnMapping {
  date_col: string
  desc_col: string
  amount_col: string
  card_col?: string
  bank_col?: string
  person_col?: string
}

export interface SmartImportRow {
  date: string
  description: string
  amount: number
  currency: string
  card: string
  bank: string
  person: string
  transaction_id: string | null
  installment_number: number | null
  installment_total: number | null
  installment_group_id: string | null
  suggested_category: string | null
  is_duplicate?: boolean
  is_auto_generated?: boolean
}

export interface ImportSummary {
  card_type: string
  bank: string
  closing_date: string | null
  due_date: string | null
  total_ars: number | null
  total_usd: number | null
  future_charges_ars: number | null
  future_charges_usd: number | null
}

export interface SmartImportPreview {
  rows: SmartImportRow[]
  raw_count: number
  summary: ImportSummary
  has_missing_data: boolean
}

export interface FileImportResult {
  filename: string
  rows: SmartImportRow[]
  raw_count: number
  summary: ImportSummary
  has_missing_data: boolean
}

export interface AnalysisHistory {
  id: number
  created_at: string
  month: string | null
  question: string | null
  result_text: string
  expense_count: number
  total_amount: number
}

export interface AITrendsProjection {
  month: string
  projected_amount: number
  installments_amount: number
  note: string
}

export interface AIMonthlyHistory {
  month: string
  total: number
  count: number
  by_cat: Record<string, number>
}

export interface Investment {
  id: number
  ticker: string
  name: string
  type: string
  broker: string
  quantity: number
  avg_cost: number
  current_price: number | null
  currency: string
  notes: string
  updated_at: string | null
  cost_basis: number
  current_value: number | null
  pnl: number | null
  pnl_pct: number | null
}

export interface InvestmentCreate {
  ticker?: string
  name: string
  type?: string
  broker?: string
  quantity?: number
  avg_cost?: number
  current_price?: number | null
  currency?: string
  notes?: string
}

export interface TopMerchant {
  description: string
  total_amount: number
  count: number
  category_name: string | null
  category_color: string | null
}

export interface AITrendsResponse {
  trend: 'up' | 'down' | 'stable'
  trend_pct: number
  trend_explanation: string
  top_rising_category: string | null
  top_falling_category: string | null
  projection: AITrendsProjection[]
  alert: string | null
  recommendation: string
  monthly_history: AIMonthlyHistory[]
  future_installments: Record<string, number>
}
