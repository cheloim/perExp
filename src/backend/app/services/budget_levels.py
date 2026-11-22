"""Alert-level normalization and persistence for budgets and groups (#569)."""

import json

from fastapi import HTTPException

DEFAULT_ALERT_LEVELS = [0.75, 0.90, 1.0]


def normalize_levels(levels: list[float] | None) -> list[float] | None:
    """Validate and normalize alert levels. Returns None when not provided."""
    if levels is None:
        return None
    if not 1 <= len(levels) <= 5:
        raise HTTPException(400, "alert_thresholds must contain 1-5 levels")
    cleaned = sorted({float(v) for v in levels})
    if any(v <= 0 or v > 2 for v in cleaned):
        raise HTTPException(400, "alert_thresholds levels must be in (0, 2]")
    return cleaned


def levels_to_db(levels: list[float] | None) -> str | None:
    return json.dumps(levels) if levels is not None else None


def levels_from_db(raw: str | None, fallback: float = 0.80) -> list[float]:
    if raw:
        try:
            parsed = json.loads(raw)
            levels = sorted({float(v) for v in parsed if float(v) > 0})
            if levels:
                return levels
        except (ValueError, TypeError):
            pass
    return [float(fallback)] if fallback and fallback > 0 else list(DEFAULT_ALERT_LEVELS)
