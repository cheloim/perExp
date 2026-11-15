from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.models import User
from app.schemas.fx import FxRateResponse
from app.services.auth import get_current_user
from app.services.fx import FxUnavailableError, get_usd_rate

router = APIRouter(prefix="/fx", tags=["fx"])


@router.get(
    "/usd-rate",
    response_model=FxRateResponse,
    summary="Get the USD/ARS exchange rate",
    description=(
        "Returns the USD/ARS rate. `purpose=budget` uses BNA official only "
        "(falling back to the last BNA value, with a warning); `purpose=display` "
        "may fall back to ADR-implied or BCRA. Historical dates land with #508b."
    ),
)
def usd_rate(
    purpose: Literal["budget", "display"] = Query(
        "budget",
        description="budget = BNA only; display = BNA -> ADR-implied -> BCRA",
    ),
    date: str | None = Query(
        None,
        description="ISO date. Only today is supported until #508b.",
    ),
    current_user: User = Depends(get_current_user),
):
    try:
        return get_usd_rate(purpose=purpose, date_str=date)
    except FxUnavailableError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
