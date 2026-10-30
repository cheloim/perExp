"""Detection of expenses that look miscategorized (issue #414).

Internal, review-only pipeline: nothing here reaches the end user, the chat or
the `/suggestions` flow. Every finding becomes a `CategorizationReview` that an
analyst resolves through the admin API or the CLI.

The detector is rules-first and precision-first:

* ``keyword_conflict``       — the deterministic matcher prefers another category
* ``category_keyword_miss``  — the merchant fits no keyword of its own category
* ``history_conflict``       — the same merchant was categorized elsewhere before
* ``amount_outlier``         — the amount is far outside the category distribution
* ``llm_second_opinion``     — the LLM only *reviews* the rule candidates

Forward-only by design: callers pass a ``since`` bound and the scan never walks
the pre-existing dataset (see ``scan_user``).
"""

from __future__ import annotations

import logging
import statistics
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import CategorizationReview, Category, Expense, User
from app.services.categorization import (
    _fuzzy_preference_key,
    _normalize_merchant_key,
    _should_skip,
    best_keyword_match,
    match_keyword_tier,
)
from app.services.llm import LLMMessage, get_client

logger = logging.getLogger(__name__)

FEATURE = "categorization_review"
DETECTOR_VERSION = "2026-10.1"

# ── Scoring ──────────────────────────────────────────────────────────
# Initial weights; they get calibrated with the pilot data recorded in
# docs/analysis/ISSUE-414-categorization-review.md.

WEIGHT_KEYWORD_CONFLICT = {3: 0.50, 2: 0.35}
WEIGHT_CATEGORY_MISS = 0.30
WEIGHT_CATEGORY_MISS_HISTORY = 0.15  # category has enough own history
WEIGHT_CATEGORY_MISS_COVERAGE = 0.15  # category is keyword-covered
WEIGHT_CATEGORY_MISS_TIGHT = 0.10  # well covered AND plenty of history
WEIGHT_HISTORY_CONFLICT = 0.40
WEIGHT_HISTORY_CONFLICT_STRONG = 0.45
WEIGHT_AMOUNT_OUTLIER = 0.10
WEIGHT_LLM_MISMATCH = 0.20
WEIGHT_LLM_AGREEMENT = -0.20

PERSIST_SCORE = 0.50
HIGH_CONFIDENCE_SCORE = 0.70

MIN_CATEGORY_HISTORY = 5
MIN_CATEGORY_HISTORY_TIGHT = 12
MIN_MERCHANT_SUPPORT = 3
MIN_MERCHANT_SUPPORT_STRONG = 6
MIN_MERCHANT_SHARE = 0.8
MIN_CATEGORY_COVERAGE = 0.6
MIN_CATEGORY_COVERAGE_TIGHT = 0.8
MIN_AMOUNT_SAMPLES = 8
OUTLIER_MAD_Z = 6.0

# ── Scan bounds ──────────────────────────────────────────────────────

SCAN_LOOKBACK_DAYS = 7  # new rows only: the scan is forward-only
HISTORY_LOOKBACK_DAYS = 365
MAX_HISTORY_EXPENSES = 5000
MAX_EXPENSES_PER_USER = 200
MAX_LLM_CANDIDATES = 50
LLM_BATCH_SIZE = 25

STATUSES = ("pending", "accepted", "rejected", "investigated")


# ── Errors ───────────────────────────────────────────────────────────


class ReviewError(Exception):
    """Base error for review resolution."""


class ReviewNotFoundError(ReviewError):
    """The review does not exist."""


class StaleReviewError(ReviewError):
    """The expense was recategorized after the review was created."""


class MissingCategoryError(ReviewError):
    """Accepting needs a category and none was given or suggested."""


# ── Data ─────────────────────────────────────────────────────────────


@dataclass
class CategoryStats:
    """How one category behaves for one user (history window only)."""

    total: int = 0
    keyword_covered: int = 0
    amounts: list[float] = field(default_factory=list)
    merchants: Counter = field(default_factory=Counter)

    @property
    def coverage(self) -> float:
        return self.keyword_covered / self.total if self.total else 0.0


@dataclass
class UserContext:
    """Everything the detector needs to score one user's expenses."""

    categories: list[Category]
    stats: dict[int, CategoryStats] = field(default_factory=dict)
    merchant_categories: dict[str, Counter] = field(default_factory=dict)

    @property
    def category_by_id(self) -> dict[int, Category]:
        return {c.id: c for c in self.categories}  # type: ignore[misc]


@dataclass
class ReviewCandidate:
    """One expense that looks miscategorized, before it is persisted."""

    expense_id: int
    user_id: int
    current_category_id: int
    suggested_category_id: int | None
    score: float
    source: str
    reason: str
    evidence: dict


@dataclass(frozen=True)
class LLMOpinion:
    """The LLM's verdict on one expense."""

    is_mismatch: bool | None
    suggested_category_id: int | None
    confidence: float
    reason: str


# ── Context building ─────────────────────────────────────────────────


def _keyword_hits(desc_lower: str, category: Category) -> list[tuple[str, int]]:
    """Keywords of ``category`` that match the description, with their tier."""
    if not category.keywords:
        return []
    hits = []
    for raw_kw in category.keywords.split(","):
        kw = raw_kw.strip().lower()
        if not kw:
            continue
        tier = match_keyword_tier(desc_lower, kw)
        if tier:
            hits.append((kw, tier))
    return hits


def build_user_context(
    db: Session,
    user_id: int,
    lookback_days: int = HISTORY_LOOKBACK_DAYS,
    max_expenses: int = MAX_HISTORY_EXPENSES,
    exclude_expense_ids: set[int] | None = None,
) -> UserContext:
    """Collect category and merchant history stats for the detector.

    ``exclude_expense_ids`` keeps the expenses under analysis out of their own
    history: what matters is the user's prior behavior, not the batch being
    judged. Descriptions are encrypted at rest, so the window is read once per
    scan and processed in memory (bounded by ``max_expenses``).
    """
    categories = db.query(Category).filter(Category.user_id == user_id).all()
    ctx = UserContext(categories=categories)
    for cat in categories:
        ctx.stats[cat.id] = CategoryStats()

    cutoff = datetime.utcnow() - timedelta(days=lookback_days)
    expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id == user_id,
            Expense.category_id.isnot(None),
            Expense.created_at >= cutoff,
        )
        .order_by(Expense.created_at.desc())
        .limit(max_expenses)
        .all()
    )

    exclude = exclude_expense_ids or set()
    cat_by_id = ctx.category_by_id
    for exp in expenses:
        if exp.id in exclude:
            continue
        stats = ctx.stats.get(exp.category_id)
        cat = cat_by_id.get(exp.category_id)
        if stats is None or cat is None:
            continue
        desc_lower = (exp.description or "").lower()
        stats.total += 1
        if _keyword_hits(desc_lower, cat):
            stats.keyword_covered += 1
        if exp.amount is not None:
            stats.amounts.append(float(exp.amount))
        merchant_key = _normalize_merchant_key(exp.description or "")
        if merchant_key:
            stats.merchants[merchant_key] += 1
            ctx.merchant_categories.setdefault(merchant_key, Counter())[exp.category_id] += 1

    return ctx


# ── Signals ──────────────────────────────────────────────────────────


def _merchant_counts(merchant_key: str, ctx: UserContext) -> Counter:
    """Category counts for a merchant, exact key first then fuzzy."""
    if not merchant_key:
        return Counter()
    counts = ctx.merchant_categories.get(merchant_key)
    if counts:
        return counts

    fuzzy_key = _fuzzy_preference_key(merchant_key)
    if not fuzzy_key:
        return Counter()
    merged: Counter = Counter()
    for other_key, other_counts in ctx.merchant_categories.items():
        other_fuzzy = _fuzzy_preference_key(other_key)
        if not other_fuzzy or abs(len(fuzzy_key) - len(other_fuzzy)) > 2:
            continue
        from difflib import SequenceMatcher

        if SequenceMatcher(None, fuzzy_key, other_fuzzy).ratio() < 0.88:
            continue
        merged.update(other_counts)
    return merged


def _merchant_seen_in_category(merchant_key: str, category_id: int, stats: CategoryStats) -> bool:
    if not merchant_key:
        return False
    if stats.merchants.get(merchant_key):
        return True
    fuzzy_key = _fuzzy_preference_key(merchant_key)
    if not fuzzy_key:
        return False
    from difflib import SequenceMatcher

    for other_key, count in stats.merchants.items():
        if not count:
            continue
        other_fuzzy = _fuzzy_preference_key(other_key)
        if not other_fuzzy or abs(len(fuzzy_key) - len(other_fuzzy)) > 2:
            continue
        if SequenceMatcher(None, fuzzy_key, other_fuzzy).ratio() >= 0.88:
            return True
    return False


def _amount_outlier(amount: float | None, stats: CategoryStats) -> float | None:
    """Robust z-score (MAD) of the amount inside its own category."""
    if amount is None or amount <= 0 or len(stats.amounts) < MIN_AMOUNT_SAMPLES:
        return None
    median = statistics.median(stats.amounts)
    mad = statistics.median(abs(a - median) for a in stats.amounts)
    if mad <= 0:
        return None
    z = 0.6745 * (amount - median) / mad
    return z if z > OUTLIER_MAD_Z else None


def detect_expense(expense: Expense, ctx: UserContext) -> ReviewCandidate | None:
    """Score one categorized expense. Pure: no queries, no LLM.

    Returns ``None`` when no signal fires, otherwise a candidate whose ``score``
    is the capped sum of the signal weights.
    """
    if expense.category_id is None or expense.is_income:
        return None
    description = expense.description or ""
    if _should_skip(description):
        return None

    cat = ctx.category_by_id.get(expense.category_id)
    if cat is None:
        return None

    desc_lower = description.lower()
    merchant_key = _normalize_merchant_key(description)
    stats = ctx.stats.get(expense.category_id) or CategoryStats()

    signals: dict[str, dict] = {}
    reasons: list[str] = []
    suggested_category_id: int | None = None
    score = 0.0

    # 1. The deterministic matcher prefers another category.
    match = best_keyword_match(description, ctx.categories)
    if match and match.category_id != expense.category_id:
        weight = WEIGHT_KEYWORD_CONFLICT.get(match.tier)
        if weight:
            score += weight
            suggested_category_id = match.category_id
            signals["keyword_conflict"] = {
                "weight": weight,
                "keyword": match.keyword,
                "tier": match.tier,
                "matched_category_id": match.category_id,
            }
            reasons.append(f'la palabra clave "{match.keyword}" apunta a otra categoría')

    # 2. The merchant fits no keyword of its own category.
    merchant_seen = _merchant_seen_in_category(merchant_key, expense.category_id, stats)
    if cat.keywords and not _keyword_hits(desc_lower, cat) and not merchant_seen:
        weight = WEIGHT_CATEGORY_MISS
        weight += WEIGHT_CATEGORY_MISS_HISTORY if stats.total >= MIN_CATEGORY_HISTORY else 0.0
        weight += WEIGHT_CATEGORY_MISS_COVERAGE if stats.coverage >= MIN_CATEGORY_COVERAGE else 0.0
        if stats.total >= MIN_CATEGORY_HISTORY_TIGHT and (
            stats.coverage >= MIN_CATEGORY_COVERAGE_TIGHT
        ):
            weight += WEIGHT_CATEGORY_MISS_TIGHT
        score += weight
        signals["category_keyword_miss"] = {
            "weight": weight,
            "category_total": stats.total,
            "category_coverage": round(stats.coverage, 2),
            "merchant_seen_in_category": False,
        }
        reasons.append(f'el comercio no coincide con ninguna palabra clave de "{cat.name}"')

    # 3. The same merchant lived in another category before.
    counts = _merchant_counts(merchant_key, ctx)
    support = sum(counts.values())
    if support >= MIN_MERCHANT_SUPPORT:
        other = {cid: n for cid, n in counts.items() if cid != expense.category_id}
        if other:
            best_cat_id, best_count = max(other.items(), key=lambda kv: kv[1])
            share = best_count / support
            if share >= MIN_MERCHANT_SHARE:
                weight = (
                    WEIGHT_HISTORY_CONFLICT_STRONG
                    if support >= MIN_MERCHANT_SUPPORT_STRONG
                    else WEIGHT_HISTORY_CONFLICT
                )
                score += weight
                if suggested_category_id is None:
                    suggested_category_id = best_cat_id
                signals["history_conflict"] = {
                    "weight": weight,
                    "support": support,
                    "majority_category_id": best_cat_id,
                    "share": round(share, 2),
                }
                reasons.append("este comercio fue categorizado distinto en gastos anteriores")

    # 4. The amount is far outside the category distribution.
    z = _amount_outlier(expense.amount, stats)
    if z is not None:
        score += WEIGHT_AMOUNT_OUTLIER
        signals["amount_outlier"] = {
            "weight": WEIGHT_AMOUNT_OUTLIER,
            "mad_z": round(z, 2),
            "category_median": round(statistics.median(stats.amounts), 2),
        }
        reasons.append("el monto es atípico para la categoría")

    if not signals:
        return None

    score = min(score, 1.0)
    return ReviewCandidate(
        expense_id=expense.id,
        user_id=expense.user_id,
        current_category_id=expense.category_id,
        suggested_category_id=suggested_category_id,
        score=round(score, 2),
        source="rules",
        reason="; ".join(reasons),
        evidence={
            "detector_version": DETECTOR_VERSION,
            "merchant_key": merchant_key,
            "current_category": {
                "id": cat.id,
                "name": cat.name,
                "keywords": cat.keywords,
            },
            "signals": signals,
        },
    )


# ── LLM second opinion ───────────────────────────────────────────────


def _llm_client():
    return get_client()


def _format_categories(categories: list[Category]) -> str:
    parent_ids = {c.parent_id for c in categories if c.parent_id is not None}
    lines = []
    for cat in categories:
        if cat.id in parent_ids:
            continue
        parent = next((p for p in categories if p.id == cat.parent_id), None)
        name = f"{parent.name} > {cat.name}" if parent else cat.name
        kw = f" [{cat.keywords}]" if cat.keywords else ""
        lines.append(f"- ID:{cat.id} {name}{kw}")
    return "\n".join(lines)


def _format_expenses(expenses: list[Expense], cat_by_id: dict[int, Category]) -> str:
    lines = []
    for exp in expenses:
        amount = f"${exp.amount:,.2f}" if exp.amount is not None else "no especificado"
        day = exp.date.isoformat() if exp.date else "sin fecha"
        cat = cat_by_id.get(exp.category_id)
        current = cat.name if cat else "?"
        lines.append(
            f"- expense_id={exp.id} | {day} | {amount} | "
            f"categoría actual: {current} | {exp.description}"
        )
    return "\n".join(lines)


def _validate_opinions(
    data: object,
    expenses: list[Expense],
    categories: list[Category],
) -> dict[int, LLMOpinion]:
    """Keep only the entries we can trust; one bad entry never spoils the batch."""
    if not isinstance(data, list):
        raise ValueError(f"Respuesta del modelo no es una lista: {type(data).__name__}")

    sent_ids = {exp.id for exp in expenses}
    parent_ids = {c.parent_id for c in categories if c.parent_id is not None}
    valid_cat_ids = {c.id for c in categories if c.id not in parent_ids}

    out: dict[int, LLMOpinion] = {}
    for raw in data:
        if not isinstance(raw, dict):
            logger.warning("[AI-REVIEW] Entrada descartada (no es un objeto): %r", raw)
            continue
        try:
            expense_id = int(raw.get("expense_id"))
        except (TypeError, ValueError):
            logger.warning("[AI-REVIEW] Entrada descartada (expense_id inválido): %r", raw)
            continue
        if expense_id not in sent_ids:
            logger.warning("[AI-REVIEW] Entrada descartada (expense_id inventado): %s", expense_id)
            continue

        is_mismatch = raw.get("is_mismatch")
        if not isinstance(is_mismatch, bool):
            logger.warning("[AI-REVIEW] Entrada descartada (is_mismatch inválido): %r", raw)
            continue

        suggested_raw = raw.get("suggested_category_id")
        suggested_id: int | None = None
        if suggested_raw is not None:
            try:
                suggested_id = int(suggested_raw)
            except (TypeError, ValueError):
                logger.warning("[AI-REVIEW] suggested_category_id inválido: %r", raw)
                continue
            if suggested_id not in valid_cat_ids:
                logger.warning(
                    "[AI-REVIEW] Entrada descartada (category_id inválido): %s", suggested_id
                )
                continue

        try:
            confidence = float(raw.get("confidence"))
        except (TypeError, ValueError):
            logger.warning("[AI-REVIEW] Entrada descartada (confidence inválido): %r", raw)
            continue
        if not 0.0 <= confidence <= 1.0:
            logger.warning("[AI-REVIEW] Entrada descartada (confidence fuera de [0,1])")
            continue

        reason = str(raw.get("reason") or "").strip()[:500]
        if expense_id in out:
            logger.warning("[AI-REVIEW] Entrada descartada (expense_id duplicado): %s", expense_id)
            continue
        out[expense_id] = LLMOpinion(
            is_mismatch=is_mismatch,
            suggested_category_id=suggested_id,
            confidence=confidence,
            reason=reason,
        )
    return out


def llm_second_opinion(
    db: Session,
    user: User,
    categories: list[Category],
    expenses: list[Expense],
) -> dict[int, LLMOpinion]:
    """Ask the LLM to review rule candidates, in batches. Never raises.

    Returns a map expense_id → LLMOpinion. Expenses the model skipped or answered
    badly are simply absent.
    """
    if not expenses or not categories:
        return {}

    from app.prompts import CATEGORY_REVIEW_PROMPT

    cat_by_id = {c.id: c for c in categories}
    out: dict[int, LLMOpinion] = {}
    for start in range(0, len(expenses), LLM_BATCH_SIZE):
        batch = expenses[start : start + LLM_BATCH_SIZE]
        prompt = CATEGORY_REVIEW_PROMPT.format(
            categories=_format_categories(categories),
            expenses=_format_expenses(batch, cat_by_id),
        )
        try:
            data = _llm_client().complete_json(
                [LLMMessage(role="user", text=prompt)],
                feature=FEATURE,
                temperature=0.2,
            )
            out.update(_validate_opinions(data, batch, categories))
        except Exception as e:
            logger.warning("[AI-REVIEW] Lote falló (%s) — %s gastos sin veredicto", e, len(batch))
    return out


def apply_opinions(
    candidates: list[ReviewCandidate],
    opinions: dict[int, LLMOpinion],
    categories: list[Category],
) -> None:
    """Fold the LLM verdicts into the rule candidates, in place."""
    cat_by_id = {c.id: c for c in categories}
    for candidate in candidates:
        opinion = opinions.get(candidate.expense_id)
        if opinion is None:
            continue
        candidate.source = "rules+llm"
        candidate.evidence["llm"] = {
            "is_mismatch": opinion.is_mismatch,
            "confidence": opinion.confidence,
            "suggested_category_id": opinion.suggested_category_id,
            "reason": opinion.reason,
        }
        if opinion.is_mismatch:
            candidate.score = round(min(candidate.score + WEIGHT_LLM_MISMATCH, 1.0), 2)
            if opinion.suggested_category_id is not None:
                candidate.suggested_category_id = opinion.suggested_category_id
                name = cat_by_id.get(opinion.suggested_category_id)
                if name is not None:
                    candidate.evidence["suggested_category"] = {
                        "id": name.id,
                        "name": name.name,
                    }
            if opinion.reason:
                candidate.reason = (
                    f"{candidate.reason}; {opinion.reason}" if candidate.reason else opinion.reason
                )
        elif opinion.confidence >= 0.6:
            candidate.score = round(max(candidate.score + WEIGHT_LLM_AGREEMENT, 0.0), 2)


# ── Orchestration ────────────────────────────────────────────────────


def analyze_expenses(
    db: Session,
    user: User,
    expenses: list[Expense],
    use_llm: bool = True,
) -> list[ReviewCandidate]:
    """Detect miscategorizations in ``expenses`` and keep the persistent ones."""
    if not expenses:
        return []
    ctx = build_user_context(
        db,
        user.id,
        exclude_expense_ids={exp.id for exp in expenses},  # type: ignore[misc]
    )
    candidates = [c for exp in expenses if (c := detect_expense(exp, ctx)) is not None]

    if use_llm and candidates:
        by_id = {exp.id: exp for exp in expenses}
        top = sorted(candidates, key=lambda c: c.score, reverse=True)[:MAX_LLM_CANDIDATES]
        opinions = llm_second_opinion(db, user, ctx.categories, [by_id[c.expense_id] for c in top])
        apply_opinions(top, opinions, ctx.categories)

    return [c for c in candidates if c.score >= PERSIST_SCORE]


def persist_reviews(db: Session, candidates: list[ReviewCandidate]) -> int:
    """Store the candidates that are not already reviewed. Returns new rows."""
    if not candidates:
        return 0
    existing = {
        row[0]
        for row in db.query(CategorizationReview.expense_id).filter(
            CategorizationReview.expense_id.in_([c.expense_id for c in candidates]),
            CategorizationReview.detector_version == DETECTOR_VERSION,
        )
    }
    created = 0
    for candidate in candidates:
        if candidate.expense_id in existing:
            continue
        db.add(
            CategorizationReview(
                expense_id=candidate.expense_id,
                user_id=candidate.user_id,
                current_category_id=candidate.current_category_id,
                suggested_category_id=candidate.suggested_category_id,
                score=candidate.score,
                source=candidate.source,
                reason=candidate.reason,
                evidence=_dump_evidence(candidate.evidence),
                detector_version=DETECTOR_VERSION,
                status="pending",
            )
        )
        created += 1
    db.commit()
    return created


def _dump_evidence(evidence: dict) -> str:
    import json

    try:
        return json.dumps(evidence, ensure_ascii=False, default=str)
    except (TypeError, ValueError):  # pragma: no cover — defensive
        return "{}"


def scan_user(
    db: Session,
    user: User,
    since: datetime | None = None,
    use_llm: bool = True,
    persist: bool = True,
    max_expenses: int = MAX_EXPENSES_PER_USER,
) -> dict:
    """Review the expenses one user created since ``since`` (forward-only)."""
    since = since or (datetime.utcnow() - timedelta(days=SCAN_LOOKBACK_DAYS))
    expenses = (
        db.query(Expense)
        .filter(
            Expense.user_id == user.id,
            Expense.created_at >= since,
            Expense.category_id.isnot(None),
        )
        .order_by(Expense.created_at.desc())
        .limit(max_expenses)
        .all()
    )
    candidates = analyze_expenses(db, user, expenses, use_llm=use_llm)
    created = persist_reviews(db, candidates) if persist else 0
    return {
        "user_id": user.id,
        "scanned": len(expenses),
        "candidates": len(candidates),
        "persisted": created,
    }


def scan_users(
    db: Session,
    user_ids: list[int] | None = None,
    since: datetime | None = None,
    use_llm: bool = True,
    persist: bool = True,
) -> dict:
    """Review new expenses of the given users (all active users by default)."""
    query = db.query(User).filter(User.is_active == True)  # noqa: E712
    if user_ids:
        query = query.filter(User.id.in_(user_ids))
    users = query.all()

    runs = [scan_user(db, user, since=since, use_llm=use_llm, persist=persist) for user in users]
    return {
        "users": len(runs),
        "scanned": sum(r["scanned"] for r in runs),
        "candidates": sum(r["candidates"] for r in runs),
        "persisted": sum(r["persisted"] for r in runs),
        "runs": runs,
    }


# ── Resolution ───────────────────────────────────────────────────────


def get_review(db: Session, review_id: int) -> CategorizationReview:
    review = db.query(CategorizationReview).filter(CategorizationReview.id == review_id).first()
    if review is None:
        raise ReviewNotFoundError(f"Revisión {review_id} no encontrada")
    return review


def _apply_category(db: Session, expense: Expense, category_id: int, user_id: int) -> None:
    """Apply the category and teach the merchant preference, like /suggestions does."""
    from datetime import datetime as _dt

    from app.models import MerchantPreference
    from app.services.tag_sync import sync_category_tag

    expense.category_id = category_id
    sync_category_tag(db, expense, category_id)

    merchant_key = _normalize_merchant_key(expense.description or "")
    if not merchant_key:
        return
    pref = (
        db.query(MerchantPreference)
        .filter(
            MerchantPreference.user_id == user_id,
            MerchantPreference.merchant_key == merchant_key,
        )
        .first()
    )
    if pref:
        pref.category_id = category_id
        pref.usage_count += 1
        pref.confidence = min(1.0, pref.confidence + 0.1)
        pref.last_used_at = _dt.utcnow()
    else:
        db.add(
            MerchantPreference(
                user_id=user_id,
                merchant_key=merchant_key,
                category_id=category_id,
                confidence=1.0,
                usage_count=1,
            )
        )


def accept_review(
    db: Session,
    review_id: int,
    category_id: int | None = None,
    reviewer_id: int | None = None,
    bulk: bool = False,
) -> CategorizationReview:
    """Apply the suggested (or given) category to the expense."""
    review = get_review(db, review_id)
    expense = db.query(Expense).filter(Expense.id == review.expense_id).first()
    if expense is None:
        raise ReviewNotFoundError(f"Gasto {review.expense_id} no encontrado")
    if expense.category_id != review.current_category_id:
        raise StaleReviewError("El gasto cambió de categoría después de la revisión")

    target = category_id if category_id is not None else review.suggested_category_id
    if target is None:
        raise MissingCategoryError("La revisión no tiene categoría sugerida")

    category = (
        db.query(Category).filter(Category.id == target, Category.user_id == review.user_id).first()
    )
    if category is None:
        raise MissingCategoryError(f"La categoría {target} no existe para este usuario")

    _apply_category(db, expense, target, review.user_id)
    review.status = "accepted"
    review.suggested_category_id = target
    review.reviewed_by = reviewer_id
    review.reviewed_at = datetime.utcnow()
    review.bulk_applied = bulk
    db.commit()
    return review


def reject_review(
    db: Session, review_id: int, reviewer_id: int | None = None
) -> CategorizationReview:
    """Mark the review as a false positive; the expense keeps its category."""
    review = get_review(db, review_id)
    review.status = "rejected"
    review.reviewed_by = reviewer_id
    review.reviewed_at = datetime.utcnow()
    db.commit()
    return review


def investigate_review(
    db: Session, review_id: int, reviewer_id: int | None = None
) -> CategorizationReview:
    """Mark the review as looked at without changing anything."""
    review = get_review(db, review_id)
    review.status = "investigated"
    review.reviewed_by = reviewer_id
    review.reviewed_at = datetime.utcnow()
    db.commit()
    return review


# ── Reporting ────────────────────────────────────────────────────────


def summary(db: Session, user_id: int | None = None) -> dict:
    """Counts by status/signal plus the observed precision of the detector."""
    import json

    query = db.query(CategorizationReview)
    if user_id is not None:
        query = query.filter(CategorizationReview.user_id == user_id)
    rows = query.all()

    by_status: Counter = Counter()
    by_signal: Counter = Counter()
    by_source: Counter = Counter()
    for row in rows:
        by_status[row.status] += 1
        by_source[row.source] += 1
        try:
            evidence = json.loads(row.evidence or "{}")
        except ValueError:
            evidence = {}
        for signal in evidence.get("signals") or {}:
            by_signal[signal] += 1

    resolved = by_status["accepted"] + by_status["rejected"]
    bulk_accepted = sum(1 for row in rows if row.status == "accepted" and row.bulk_applied)
    manual_accepted = by_status["accepted"] - bulk_accepted
    resolved_manual = manual_accepted + by_status["rejected"]
    return {
        "total": len(rows),
        "by_status": dict(by_status),
        "by_signal": dict(by_signal),
        "by_source": dict(by_source),
        "observed_precision": (round(by_status["accepted"] / resolved, 2) if resolved else None),
        "manual_precision": (
            round(manual_accepted / resolved_manual, 2) if resolved_manual else None
        ),
        "bulk_accepted": bulk_accepted,
    }
