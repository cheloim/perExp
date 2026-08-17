# API Design Rules

## CRUD Path Patterns

Every resource router follows the same path convention:

| Method   | Path         | Action          | Status Code |
|----------|--------------|-----------------|-------------|
| `GET`    | `""`         | List all        | 200         |
| `POST`   | `""`         | Create one      | 201         |
| `PUT`    | `"/{id}"`    | Update one      | 200         |
| `DELETE` | `"/{id}"`    | Delete one      | 204         |

Custom action endpoints use descriptive sub-paths:

```python
@router.post("/bulk-delete")       # POST /expenses/bulk-delete
@router.get("/uncategorized-count") # GET /expenses/uncategorized-count
@router.post("/sync-holders")      # POST /cards/sync-holders
```

Router prefix always matches the plural resource name:

```python
router = APIRouter(prefix="/cards", tags=["cards"])
router = APIRouter(prefix="/expenses", tags=["expenses"])
router = APIRouter(prefix="/accounts", tags=["accounts"])
```

## Status Codes

| Code  | When to use                                            |
|-------|--------------------------------------------------------|
| 200   | Default success (GET, PUT, POST actions)               |
| 201   | Resource created (`POST ""` endpoints)                 |
| 204   | Resource deleted (`DELETE "/{id}"` endpoints)          |
| 400   | Business validation error (e.g. "has associated expenses") |
| 401   | Invalid or missing auth token                          |
| 403   | Valid token but insufficient permissions (admin block, inactive user) |
| 404   | Resource not found or doesn't belong to user           |
| 409   | Duplicate resource (unique constraint, already linked) |
| 422   | Pydantic schema validation failure (auto by FastAPI)   |
| 423   | Account locked due to failed login attempts            |
| 429   | Rate limit exceeded                                    |

## Dependency Injection Pattern

Every protected endpoint uses the same two dependencies:

```python
@router.get("", response_model=list[CardResponse])
def list_cards(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ...
```

- `Depends(get_db)` — SQLAlchemy session from `app.database`
- `Depends(get_current_user)` — JWT-validated `User` from `app.services.auth`

Admin-only endpoints chain an extra dependency:

```python
from app.services.auth import get_current_admin

@router.get("/admin/users")
def list_users(admin: User = Depends(get_current_admin)):
    ...
```

## Error Format

Errors use `HTTPException` with a `detail` that is either a **string** or a **structured dict**:

```python
# Simple string
raise HTTPException(status_code=404, detail="Card not found")

# Structured dict (for duplicate detection, client needs the existing ID)
raise HTTPException(
    status_code=409,
    detail={
        "message": "Ya existe una tarjeta con esos datos",
        "existing_id": existing.id,
        "existing_card_name": existing.card_name,
    },
)

# Structured dict (for validation hints)
raise HTTPException(
    status_code=400,
    detail={
        "error": "account_required",
        "message": "Los ingresos requieren una cuenta destino.",
    },
)
```

Rate limit errors include `Retry-After` header:

```python
raise HTTPException(
    status_code=429,
    detail=f"Demasiados intentos. Intentá de nuevo en {retry_after} segundos",
    headers={"Retry-After": str(retry_after)},
)
```

## Schema Naming Convention

Schemas live in `app/schemas.py` or inline in the router file. Naming follows this pattern:

| Suffix       | Purpose                          | Example                  |
|--------------|----------------------------------|--------------------------|
| `{Entity}Create`  | Input for creating a resource | `CardCreate`, `ExpenseCreate` |
| `{Entity}Update`  | Input for partial update (all fields optional) | `CardUpdate`, `ExpenseUpdate` |
| `{Entity}Response`| Output returned to client     | `CardResponse`, `ExpenseResponse` |
| `{Entity}Simple`  | Lightweight nested reference  | `CardSimple`, `AccountSimple` |

Schemas use `from_attributes = True` for ORM compatibility:

```python
class CardResponse(BaseModel):
    id: int
    card_name: str
    # ...
    model_config = {"from_attributes": True}
```

Inline schemas (defined in the router file) use the older `class Config` style:

```python
class CardResponse(BaseModel):
    # ...
    class Config:
        from_attributes = True
```

## Update Pattern

Update endpoints accept partial data. Use `model_dump(exclude_none=True)` to only apply provided fields:

```python
@router.put("/{card_id}", response_model=CardResponse)
def update_card(card_id: int, card: CardUpdate, ...):
    db_card = db.query(Card).filter(Card.id == card_id, ...).first()
    if not db_card:
        raise HTTPException(status_code=404, detail="Card not found")

    update_data = card.model_dump(exclude_none=True)
    for key, value in update_data.items():
        if isinstance(value, str):
            value = value.strip()
        setattr(db_card, key, value)

    # Update HMAC fields if encrypted field changed
    if "card_name" in update_data:
        db_card.card_name_hmac = compute_hmac(db_card.card_name.lower())

    db.commit()
    db.refresh(db_card)
    return db_card
```

Key rules:
- `exclude_none=True` ensures only explicitly sent fields are updated
- String values are `.strip()`-ped before saving
- HMAC columns are recomputed when their parent encrypted field changes

## Family Group Scoping

Most data queries scope results to the user's family group:

```python
from app.routers.groups import get_group_user_ids

uid_list = get_group_user_ids(current_user.id, db)
expenses = db.query(Expense).filter(Expense.user_id.in_(uid_list)).all()
```

`get_group_user_ids()` returns a list of all accepted member user IDs in the group, or `[user_id]` if the user has no group.

Update and delete operations are always scoped to `current_user.id` only (not the full group):

```python
db.query(Card).filter(Card.id == card_id, Card.user_id == current_user.id).first()
```

## Pagination & Filtering

Expenses endpoint supports pagination via `skip`/`limit` query params:

```python
@router.get("", response_model=list[ExpenseResponse])
def get_expenses(
    skip: int = 0,
    limit: int = 200,
    ...
):
    return q.order_by(desc(Expense.date)).offset(skip).limit(limit).all()
```

Filtering is done via query parameters:

| Param         | Type    | Filter logic                                   |
|---------------|---------|-------------------------------------------------|
| `month`       | `str`   | `"YYYY-MM"` — date range filter                 |
| `date_from`   | `date`  | Expenses on or after this date                  |
| `date_to`     | `date`  | Expenses on or before this date                 |
| `category_id` | `int`   | Exact category match                            |
| `category_ids`| `str`   | Comma-separated category IDs                    |
| `uncategorized`| `bool` | Only expenses with `category_id IS NULL`        |
| `bank`        | `str`   | Case-insensitive substring match on card bank   |
| `person`      | `str`   | Case-insensitive substring match on card holder |
| `card`        | `str`   | Case-insensitive substring match on card name   |
| `card_type`   | `str`   | Exact match: `"credito"` or `"debito"`          |
| `installment` | `bool`  | `True` = only installments, `False` = only non  |
| `account_id`  | `int`   | Exact account match                             |
| `account`     | `str`   | Case-insensitive substring match on account name|

Encrypted fields (bank, person, card, account) require application-level filtering — load all matching records from DB, then filter in Python using decrypted values.
