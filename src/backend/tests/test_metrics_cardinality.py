"""Business metrics must not grow with the number of users (#526c)."""

from app import metrics


def test_no_business_metric_uses_user_id_as_a_label():
    gauges = [
        metrics.EXPENSES_TOTAL,
        metrics.INVESTMENTS_TOTAL,
        metrics.RECURRING_EXPENSES_TOTAL,
        metrics.ACCOUNTS_TOTAL,
        metrics.CARDS_TOTAL,
        metrics.BUDGET_GROUPS_TOTAL,
    ]
    for metric in gauges:
        assert "user_id" not in metric._labelnames

    assert "user_id" not in metrics.EXPENSES_CREATED._labelnames
