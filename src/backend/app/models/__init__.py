"""Models package — re-exports all models for backward compatibility.

All models are organized by domain in separate modules:
- base.py: User, Group, GroupMember
- financial.py: Account, Card, Expense, Tag, ExpenseTag, CardClosing
- categories.py: Category
- budgets.py: Budget, BudgetGroup, BudgetEvent
- investments.py: Investment, Setting
- imports.py: ImportJob, ScheduledExpense, RecurringExpense
- ai.py: AnalysisHistory, CategorySuggestion, MerchantPreference
- notifications.py: Notification
- admin.py: AuditLog, ImpersonationSession, ImpersonationMessage, PlatformLog, MonthlyReport

Import from this module for backward compatibility:
    from app.models import User, Expense, Card
"""

# Core
from app.models.base import Group, GroupMember, User

# Financial
from app.models.financial import Account, Card, CardClosing, Expense, ExpenseTag, Tag

# Categories
from app.models.categories import Category

# Budgets
from app.models.budgets import Budget, BudgetEvent, BudgetGroup

# Investments
from app.models.investments import Investment, Setting

# Imports & Scheduling
from app.models.imports import ImportJob, RecurringExpense, ScheduledExpense

# AI
from app.models.ai import AnalysisHistory, CategorySuggestion, MerchantPreference

# Notifications
from app.models.notifications import Notification

# Admin
from app.models.admin import (
    AuditLog,
    ImpersonationMessage,
    ImpersonationSession,
    MonthlyReport,
    PlatformLog,
)

__all__ = [
    "User",
    "Group",
    "GroupMember",
    "Account",
    "Card",
    "CardClosing",
    "Expense",
    "ExpenseTag",
    "Tag",
    "Category",
    "Budget",
    "BudgetEvent",
    "BudgetGroup",
    "Investment",
    "Setting",
    "ImportJob",
    "RecurringExpense",
    "ScheduledExpense",
    "AnalysisHistory",
    "CategorySuggestion",
    "MerchantPreference",
    "Notification",
    "AuditLog",
    "ImpersonationSession",
    "ImpersonationMessage",
    "MonthlyReport",
    "PlatformLog",
]