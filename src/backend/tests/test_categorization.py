"""Tests for the deterministic tiers of the categorization service.

Covers keyword matching in auto_categorize (ranked scoring with word limits,
order independence) and the exact + fuzzy merchant preference matching in
check_user_preference. No LLM involved.
"""

import os
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-that-is-at-least-32-chars-long-for-testing")

from app.services.categorization import auto_categorize, best_keyword_match, check_user_preference

# ── Helpers ──────────────────────────────────────────────────────────


def _cat(cat_id, keywords, parent_id=None):
    """Lightweight stand-in for Category — auto_categorize needs no DB."""
    return SimpleNamespace(id=cat_id, keywords=keywords, parent_id=parent_id)


def _create_user(db, email="cat@example.com"):
    from app.models import User
    from app.services.auth import get_password_hash

    user = User(
        email=email,
        full_name="Test User",
        hashed_password=get_password_hash("testpassword"),
        email_verified=True,
    )
    db.add(user)
    db.flush()
    return user


def _create_category(db, user, name, keywords=""):
    from app.models import Category

    cat = Category(name=name, keywords=keywords, user_id=user.id)
    db.add(cat)
    db.flush()
    return cat


def _create_pref(db, user, category, merchant_key, usage_count=1, confidence=1.0):
    from app.models import MerchantPreference

    pref = MerchantPreference(
        user_id=user.id,
        merchant_key=merchant_key,
        category_id=category.id,
        confidence=confidence,
        usage_count=usage_count,
    )
    db.add(pref)
    db.flush()
    return pref


# ── auto_categorize: falsos positivos ────────────────────────────────


def test_gaseosa_does_not_match_gas():
    assert auto_categorize("GASEOSA COCA COLA", [_cat(1, "gas")]) is None


def test_tortugas_does_not_match_gas():
    """Regresión del caso YENNY TORTUGAS (issue #414): 'gas' dentro de otra palabra."""
    assert auto_categorize("YENNY TORTUGAS OPEN MALL", [_cat(1, "gas")]) is None


def test_best_keyword_match_exposes_the_winning_tier():
    match = best_keyword_match("SUPERMERCADO COTO", [_cat(1, "coto"), _cat(2, "supe")])
    assert match.category_id == 1
    assert match.keyword == "coto"
    assert match.tier == 3


def test_pantalon_does_not_match_pan():
    assert auto_categorize("PANTALÓN DE JEAN", [_cat(1, "pan")]) is None


def test_barcelona_does_not_match_bar():
    assert auto_categorize("BARCELONA CAFE", [_cat(1, "bar")]) is None


def test_short_keyword_still_matches_as_whole_word():
    assert auto_categorize("BAR NOCTURNO PALERMO", [_cat(1, "bar")]) == 1


# ── auto_categorize: matches positivos ───────────────────────────────


def test_word_prefix_panader_matches_panaderia():
    assert auto_categorize("PANADERIA EL SOL", [_cat(1, "panader")]) == 1


def test_result_is_order_independent():
    generic = _cat(1, "super")
    specific = _cat(2, "supermercado")
    desc = "SUPERMERCADO COTO"
    assert auto_categorize(desc, [generic, specific]) == 2
    assert auto_categorize(desc, [specific, generic]) == 2


def test_most_specific_keyword_wins_not_first_in_list():
    cats = [_cat(1, "comida, panader"), _cat(2, "panaderia")]
    assert auto_categorize("PANADERIA EL SOL", cats) == 2


def test_tie_broken_by_longer_keyword():
    short = _cat(1, "coto")
    longer = _cat(2, "supermercado")
    desc = "SUPERMERCADO COTO"
    assert auto_categorize(desc, [short, longer]) == 2
    assert auto_categorize(desc, [longer, short]) == 2


def test_full_tie_broken_by_lowest_category_id():
    cats = [_cat(7, "coto"), _cat(3, "coto")]
    assert auto_categorize("COTO SUPERMERCADO", cats) == 3
    assert auto_categorize("COTO SUPERMERCADO", list(reversed(cats))) == 3


def test_parent_categories_are_ignored():
    parent = _cat(1, "coto")
    child = _cat(2, "supermercado", parent_id=1)
    assert auto_categorize("COTO SUPERMERCADO", [parent, child]) == 2


def test_no_usable_keywords_returns_none():
    assert auto_categorize("GASEOSA COCA COLA", [_cat(1, ""), _cat(2, " , ")]) is None


# ── check_user_preference: match exacto ──────────────────────────────


def test_exact_match_returns_category(db, test_user):
    cat = _create_category(db, test_user, "Suscripciones")
    _create_pref(db, test_user, cat, "NETFLIX")
    assert check_user_preference("Netflix", test_user.id, db) == cat.id


def test_exact_match_wins_over_fuzzy(db, test_user):
    exact_cat = _create_category(db, test_user, "Suscripciones")
    fuzzy_cat = _create_category(db, test_user, "Streaming")
    _create_pref(db, test_user, exact_cat, "NETFLIX.COM", usage_count=1)
    _create_pref(db, test_user, fuzzy_cat, "NETFLIX 03/06", usage_count=9)
    assert check_user_preference("NETFLIX.COM", test_user.id, db) == exact_cat.id


def test_low_confidence_exact_match_returns_none(db, test_user):
    cat = _create_category(db, test_user, "Suscripciones")
    _create_pref(db, test_user, cat, "NETFLIX", confidence=0.2, usage_count=9)
    assert check_user_preference("NETFLIX", test_user.id, db) is None


# ── check_user_preference: match difuso ──────────────────────────────


def test_fuzzy_matches_bank_suffix_variants(db, test_user):
    cat = _create_category(db, test_user, "Suscripciones")
    _create_pref(db, test_user, cat, "NETFLIX 03/06", usage_count=3)
    assert check_user_preference("NETFLIX.COM", test_user.id, db) == cat.id


def test_fuzzy_below_threshold_does_not_match(db, test_user):
    cat = _create_category(db, test_user, "Gastronomía")
    _create_pref(db, test_user, cat, "LA ESQUINA DEL PASTEL", usage_count=5)
    assert check_user_preference("BURGER", test_user.id, db) is None


def test_fuzzy_ignores_low_usage_preferences(db, test_user):
    cat = _create_category(db, test_user, "Suscripciones")
    _create_pref(db, test_user, cat, "NETFLIX 03/06", usage_count=1)
    assert check_user_preference("NETFLIX.COM", test_user.id, db) is None


def test_fuzzy_ignores_other_users_preferences(db, test_user):
    other = _create_user(db, "other-cat@example.com")
    cat = _create_category(db, other, "Suscripciones")
    _create_pref(db, other, cat, "NETFLIX 03/06", usage_count=9)
    assert check_user_preference("NETFLIX.COM", test_user.id, db) is None


def test_fuzzy_prefers_higher_ratio_over_usage_count(db, test_user):
    best_ratio = _create_category(db, test_user, "Uno")
    most_used = _create_category(db, test_user, "Dos")
    _create_pref(db, test_user, best_ratio, "NETFLIX", usage_count=2)
    _create_pref(db, test_user, most_used, "NETFLIX1", usage_count=99)
    assert check_user_preference("NETFLIX.COM", test_user.id, db) == best_ratio.id


def test_fuzzy_tie_broken_by_usage_count(db, test_user):
    low_usage = _create_category(db, test_user, "Uno")
    high_usage = _create_category(db, test_user, "Dos")
    _create_pref(db, test_user, low_usage, "NETFLIX.COM", usage_count=2)
    _create_pref(db, test_user, high_usage, "NETFLIX.ORG", usage_count=8)
    assert check_user_preference("NETFLIX", test_user.id, db) == high_usage.id
