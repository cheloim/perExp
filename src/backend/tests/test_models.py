"""Tests for model relationships — verify all relationships resolve correctly after models split.

Phase 2 task 2.1b: Ensures the models package split didn't break any SQLAlchemy relationships.
"""

import pytest


class TestRelationshipResolution:
    """Every relationship() call must resolve to a valid mapped class."""

    def test_user_model_exists(self):
        from app.models import User

        assert User.__tablename__ == "users"

    def test_group_members_relationship(self):
        from app.models import Group

        # Group.members relationship should resolve
        rel = Group.__mapper__.relationships["members"]
        assert rel.mapper.class_.__name__ == "GroupMember"

    def test_expense_category_relationship(self):
        from app.models import Expense

        rel = Expense.__mapper__.relationships["category"]
        assert rel.mapper.class_.__name__ == "Category"

    def test_expense_tags_relationship(self):
        from app.models import Expense

        rel = Expense.__mapper__.relationships["tags"]
        assert rel.mapper.class_.__name__ == "Tag"

    def test_tag_expenses_relationship(self):
        from app.models import Tag

        rel = Tag.__mapper__.relationships["expenses"]
        assert rel.mapper.class_.__name__ == "Expense"

    def test_expense_account_rel(self):
        from app.models import Expense

        rel = Expense.__mapper__.relationships["account_rel"]
        assert rel.mapper.class_.__name__ == "Account"

    def test_expense_card_rel(self):
        from app.models import Expense

        rel = Expense.__mapper__.relationships["card_rel"]
        assert rel.mapper.class_.__name__ == "Card"

    def test_expense_recurring_expense(self):
        from app.models import Expense

        rel = Expense.__mapper__.relationships["recurring_expense"]
        assert rel.mapper.class_.__name__ == "RecurringExpense"

    def test_card_linked_account(self):
        from app.models import Card

        rel = Card.__mapper__.relationships["linked_account"]
        assert rel.mapper.class_.__name__ == "Account"

    def test_category_expenses_back_populates(self):
        from app.models import Category

        rel = Category.__mapper__.relationships["expenses"]
        assert rel.mapper.class_.__name__ == "Expense"

    def test_category_budgets_back_populates(self):
        from app.models import Category

        rel = Category.__mapper__.relationships["budgets"]
        assert rel.mapper.class_.__name__ == "Budget"

    def test_category_children_self_referential(self):
        from app.models import Category

        rel = Category.__mapper__.relationships["children"]
        assert rel.mapper.class_.__name__ == "Category"

    def test_category_parent_self_referential(self):
        from app.models import Category

        rel = Category.__mapper__.relationships["parent"]
        assert rel.mapper.class_.__name__ == "Category"

    def test_budget_category(self):
        from app.models import Budget

        rel = Budget.__mapper__.relationships["category"]
        assert rel.mapper.class_.__name__ == "Category"

    def test_scheduled_expense_relationships(self):
        from app.models import ScheduledExpense

        for rel_name in ["category", "executed_expense", "template_expense", "card_rel", "account_rel"]:
            rel = ScheduledExpense.__mapper__.relationships[rel_name]
            assert rel.mapper.class_ is not None, f"ScheduledExpense.{rel_name} failed to resolve"

    def test_recurring_expense_relationships(self):
        from app.models import RecurringExpense

        for rel_name in ["user", "category", "card", "account", "tag"]:
            rel = RecurringExpense.__mapper__.relationships[rel_name]
            assert rel.mapper.class_ is not None, f"RecurringExpense.{rel_name} failed to resolve"

    def test_impersonation_session_relationships(self):
        from app.models import ImpersonationSession

        rel_admin = ImpersonationSession.__mapper__.relationships["admin"]
        assert rel_admin.mapper.class_.__name__ == "User"

        rel_target = ImpersonationSession.__mapper__.relationships["target_user"]
        assert rel_target.mapper.class_.__name__ == "User"

        rel_msgs = ImpersonationSession.__mapper__.relationships["messages"]
        assert rel_msgs.mapper.class_.__name__ == "ImpersonationMessage"

    def test_impersonation_message_relationships(self):
        from app.models import ImpersonationMessage

        rel_session = ImpersonationMessage.__mapper__.relationships["session"]
        assert rel_session.mapper.class_.__name__ == "ImpersonationSession"

        rel_sender = ImpersonationMessage.__mapper__.relationships["sender"]
        assert rel_sender.mapper.class_.__name__ == "User"

    def test_category_suggestion_relationships(self):
        from app.models import CategorySuggestion

        rel_expense = CategorySuggestion.__mapper__.relationships["expense"]
        assert rel_expense.mapper.class_.__name__ == "Expense"

        rel_cat = CategorySuggestion.__mapper__.relationships["suggested_category"]
        assert rel_cat.mapper.class_.__name__ == "Category"

    def test_merchant_preference_relationships(self):
        from app.models import MerchantPreference

        rel_user = MerchantPreference.__mapper__.relationships["user"]
        assert rel_user.mapper.class_.__name__ == "User"

        rel_cat = MerchantPreference.__mapper__.relationships["category"]
        assert rel_cat.mapper.class_.__name__ == "Category"

    def test_tag_relationships(self):
        from app.models import Tag

        for rel_name in ["expenses", "card_rel", "account_rel", "category_rel"]:
            rel = Tag.__mapper__.relationships[rel_name]
            assert rel.mapper.class_ is not None, f"Tag.{rel_name} failed to resolve"

    def test_card_closing_card_rel(self):
        from app.models import CardClosing

        rel = CardClosing.__mapper__.relationships["card_rel"]
        assert rel.mapper.class_.__name__ == "Card"


class TestTableCount:
    """Verify all27 tables are registered after models split."""

    def test_all_tables_registered(self):
        from app.database import Base

        tables = set(Base.metadata.tables.keys())
        expected_count = 27
        assert len(tables) == expected_count, f"Expected {expected_count} tables, got {len(tables)}: {sorted(tables)}"

    def test_specific_critical_tables(self):
        from app.database import Base

        critical = ["users", "expenses", "cards", "accounts", "categories", "notifications"]
        tables = set(Base.metadata.tables.keys())
        for table in critical:
            assert table in tables, f"Critical table '{table}' missing"