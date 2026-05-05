export interface Category {
  id: number
  name: string
  color: string
  keywords: string
  parent_id?: number | null
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
  card: string
  bank: string
  person: string
  notes: string
  transaction_id?: string | null
  installment_number?: number | null
  installment_total?: number | null
  installment_group_id?: string | null
  card_last4?: string
}

export interface ExpenseCreate {
  date: string
  description: string
  amount: number
  currency?: string
  category_id?: number | null
  card?: string
  bank?: string
  person?: string
  notes?: string
  transaction_id?: string | null
  installment_number?: number | null
  installment_total?: number | null
  installment_group_id?: string | null
  card_last4?: string
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
  category_id: number | null
  category_name: string | null
  category_color: string | null
  bank: string
  person: string
  currency: string
  card_last4: string
  card: string
}

export interface CardSummary {
  holder: string
  bank: string
  last4: string
  card_name: string
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
  card_last4?: string
  transaction_id: string | null
  installment_number: number | null
  installment_total: number | null
  installment_group_id: string | null
  suggested_category: string | null
  is_duplicate?: boolean
  is_auto_generated?: boolean
}

export interface ImportSummary {
  card_last4: string
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
