export interface ImportNotificationData {
  job_id: number;
  filename?: string;
  row_count?: number;
}

export interface GroupInvitationData {
  member_id: number;
  inviter_name?: string;
  group_id?: number;
}

export interface BaseNotification {
  id: number;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}

export interface ImportNotification extends BaseNotification {
  type: "import_ready" | "import_failed";
  data: ImportNotificationData;
}

export interface GroupInvitationNotification extends BaseNotification {
  type: "group_invitation";
  data: GroupInvitationData;
}

export interface GenericNotification extends BaseNotification {
  type: string;
  data: Record<string, unknown>;
}

export type Notification = ImportNotification | GroupInvitationNotification | GenericNotification;

export interface GroupMember {
  id: number;
  user_id: number;
  full_name: string;
  email: string;
  role: string;
  status: string;
  joined_at: string;
}

export interface FamilyGroup {
  id: number;
  name: string;
  members: GroupMember[];
}

export interface AuthToken {
  access_token: string;
  token_type: string;
}

export interface User {
  id: number;
  dni?: string | null;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  provider?: string | null;
  avatar_url?: string | null;
}

export interface Category {
  id: number;
  name: string;
  color: string;
  keywords: string;
  parent_id?: number | null;
}

export interface Account {
  id: number;
  name: string;
  type: string;
  user_id: number;
  created_at: string;
}

export interface Card {
  id: number;
  card_name: string;
  bank: string;
  holder: string;
  card_type: string;
  closing_day: number | null;
  user_id: number;
  created_at: string;
}

export interface Expense {
  id: number;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  // Derived from card_rel (computed by backend)
  card: string;
  bank: string;
  person: string;
  notes: string;
  transaction_id?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  installment_group_id?: string | null;
  // Structured fields
  account_id?: number | null;
  card_id?: number | null;
  account_rel?: Account | null;
  card_rel?: Card | null;
}

export interface ExpenseCreate {
  date: string;
  description: string;
  amount: number;
  currency?: string;
  category_id?: number | null;
  notes?: string;
  transaction_id?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  installment_group_id?: string | null;
  account_id?: number | null;
  card_id?: number | null;
}

export interface CategorySummary {
  category_id: number | null;
  category_name: string;
  category_color: string;
  parent_id?: number | null;
  parent_name?: string | null;
  parent_color?: string | null;
  total: number;
  count: number;
  previous_total?: number;
}

export interface PeriodSummary {
  period: string;
  total: number;
  count: number;
}

export interface CurrencySummary {
  currency: string;
  total: number;
  count: number;
}

export interface CardBySummary {
  card: string;
  bank: string;
  person: string;
  total: number;
  count: number;
}

export interface CardConsumption {
  card: string;
  bank: string;
  total_amount: number;
  count: number;
  currency: string;
  last_used: string | null;
}

export interface DashboardSummary {
  total_expenses: number;
  total_amount: number;
  total_by_account: number;
  by_category: CategorySummary[];
  by_income: CategorySummary[];
  by_period: PeriodSummary[];
  by_currency: CurrencySummary[];
  by_card: CardBySummary[];
  recent_expenses: Expense[];
  trend_data: {
    history: { month: string; total: number; count: number }[];
    future_installments: Record<string, number>;
  };
}

export interface InstallmentGroup {
  installment_group_id: string;
  description: string;
  installment_total: number;
  installments_paid: number;
  remaining_installments: number;
  total_amount: number;
  installment_amount: number;
  next_date: string | null;
  next_dates: string[];
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  bank: string;
  person: string;
  currency: string;
  card: string;
  card_id: number | null;
}

export interface ScheduledExpense {
  id: number;
  installment_group_id: string;
  installment_number: number;
  installment_total: number;
  scheduled_date: string;
  amount: number;
  currency: string;
  description: string;
  status: "PENDING" | "EXECUTED" | "CANCELLED";
  category_id: number | null;
  card_id?: number | null;
  card_rel?: Card | null;
}

export interface CardSummary {
  id?: number;
  holder: string;
  bank: string;
  card_name: string;
  card_type: string;
  account_id?: number | null;
  total_amount: number;
  count: number;
  currency: string;
  last_used: string | null;
  monthly?: { month: string; total: number }[];
}

export interface SmartImportRow {
  date: string;
  description: string;
  amount: number;
  currency: string;
  card_header: string;
  transaction_id: string | null;
  installment_number: number | null;
  installment_total: number | null;
  installment_group_id: string | null;
  suggested_category: string | null;
  is_duplicate?: boolean;
  is_auto_generated?: boolean;
  is_scheduled?: boolean;
}

export interface DetectedCard {
  card_header: string;
  detected_bank: string;
  detected_card: string;
  card_type: string;
  matched_card_id: number | null;
  matched_card_name: string | null;
  transaction_count: number;
}

export interface CardsMappingEntry {
  card_id?: number;
  bank?: string;
  card_name?: string;
  card_type?: string;
  holder?: string;
}

export interface CardsMapping {
  [card_header: string]: CardsMappingEntry;
}

export interface ImportSummary {
  card_type: string;
  bank: string;
  closing_date: string | null;
  due_date: string | null;
  total_ars: number | null;
  total_usd: number | null;
  future_charges_ars: number | null;
  future_charges_usd: number | null;
}

export interface SmartImportPreview {
  rows: SmartImportRow[];
  raw_count: number;
  summary: ImportSummary;
  has_missing_data: boolean;
  detected_cards?: DetectedCard[];
}

export interface FileImportResult {
  filename: string;
  rows: SmartImportRow[];
  raw_count: number;
  summary: ImportSummary;
  has_missing_data: boolean;
  detected_cards?: DetectedCard[];
  cards_mapping?: CardsMapping;
  customNamingSaved?: boolean;
}

export interface AnalysisHistory {
  id: number;
  created_at: string;
  month: string | null;
  question: string | null;
  result_text: string;
  expense_count: number;
  total_amount: number;
}

export interface AITrendsProjection {
  month: string;
  projected_amount: number;
  installments_amount: number;
  note: string;
}

export interface AIMonthlyHistory {
  month: string;
  total: number;
  count: number;
  by_cat: Record<string, number>;
}

export interface Investment {
  id: number;
  ticker: string;
  name: string;
  type: string;
  broker: string;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  currency: string;
  notes: string;
  updated_at: string | null;
  cost_basis: number;
  current_value: number | null;
  pnl: number | null;
  pnl_pct: number | null;
  user_name?: string | null;
}

export interface InvestmentCreate {
  ticker?: string;
  name: string;
  type?: string;
  broker?: string;
  quantity?: number;
  avg_cost?: number;
  current_price?: number | null;
  currency?: string;
  notes?: string;
}

export interface TopMerchant {
  description: string;
  total_amount: number;
  count: number;
  category_name: string | null;
  category_color: string | null;
}

export interface AITrendsResponse {
  trend: "up" | "down" | "stable";
  trend_pct: number;
  trend_explanation: string;
  top_rising_category: string | null;
  top_falling_category: string | null;
  projection: AITrendsProjection[];
  alert: string | null;
  recommendation: string;
  monthly_history: AIMonthlyHistory[];
  future_installments: Record<string, number>;
}

export interface ImportJob {
  id: number;
  filename: string;
  status: "PROCESSING" | "QUEUED" | "READY_PREVIEW" | "COMPLETED" | "FAILED";
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  preview_data: SmartImportPreview | null;
}

export interface UploadProgress {
  id: string; // UUID generado localmente
  filename: string;
  status: "uploading" | "queued" | "processing" | "ready" | "failed";
  jobId?: number; // Solo disponible después del upload
  error?: string;
  abortController?: AbortController; // Para cancelar upload
  progress?: number; // 0-100 for uploading
  startedAt?: number; // timestamp
}
