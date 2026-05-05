from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import create_engine, Column, Integer, String, Float, Date, ForeignKey, Text, DateTime, desc, func
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session, relationship
from pydantic import BaseModel, computed_field, field_validator, field_serializer
from typing import Optional, List, Any
from datetime import date, datetime
import pandas as pd
import io
import json
import os
import hashlib
import calendar as cal_module
import re
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

# ─── Database ────────────────────────────────────────────────────────────────

DATABASE_URL = "sqlite:///./expenses.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ─── Models ──────────────────────────────────────────────────────────────────

class Category(Base):
    __tablename__ = "categories"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    color = Column(String, default="#6366f1")
    keywords = Column(Text, default="")
    parent_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    expenses = relationship("Expense", back_populates="category")


class Expense(Base):
    __tablename__ = "expenses"
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    description = Column(String, nullable=False)
    amount = Column(Float, nullable=False)
    category_id = Column(Integer, ForeignKey("categories.id"), nullable=True)
    card = Column(String, default="")
    bank = Column(String, default="")
    person = Column(String, default="")
    notes = Column(Text, default="")
    transaction_id = Column(String, nullable=True, index=True)
    currency = Column(String, default="ARS")
    installment_number = Column(Integer, nullable=True)
    installment_total = Column(Integer, nullable=True)
    installment_group_id = Column(String, nullable=True, index=True)
    card_last4 = Column(String(4), nullable=True)
    category = relationship("Category", back_populates="expenses")


class AnalysisHistory(Base):
    __tablename__ = "analysis_history"
    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    month = Column(String, nullable=True)
    question = Column(Text, nullable=True)
    result_text = Column(Text, nullable=False, default="")
    expense_count = Column(Integer, default=0)
    total_amount = Column(Float, default=0.0)


class Setting(Base):
    __tablename__ = "settings"
    key   = Column(String, primary_key=True)
    value = Column(Text, default="")


class Investment(Base):
    __tablename__ = "investments"
    id            = Column(Integer, primary_key=True, index=True)
    ticker        = Column(String,  default="")
    name          = Column(String,  default="")
    type          = Column(String,  default="")   # Acción, Cedear, Bono, Letra, ON, FCI, Caución, Plazo Fijo
    broker        = Column(String,  default="")   # InvertirOnline, Portfolio Personal
    quantity      = Column(Float,   default=0.0)
    avg_cost      = Column(Float,   default=0.0)  # cost per unit/nominal
    current_price = Column(Float,   nullable=True)
    currency      = Column(String,  default="ARS")
    notes         = Column(Text,    default="")
    updated_at    = Column(DateTime, default=datetime.utcnow)


class CardClosing(Base):
    __tablename__ = "card_closings"
    id = Column(Integer, primary_key=True, index=True)
    card = Column(String, nullable=False, default="")
    card_last_digits = Column(String, default="")
    card_type = Column(String, default="")
    bank = Column(String, default="")
    closing_date = Column(Date, nullable=False)
    next_closing_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    last_imported_at = Column(DateTime, default=datetime.utcnow)


Base.metadata.create_all(bind=engine)

# Add new columns to existing DBs without losing data
from sqlalchemy import inspect, text as sa_text
with engine.connect() as _conn:
    _cols = [c["name"] for c in inspect(engine).get_columns("expenses")]
    for _col, _type in [
        ("bank", "VARCHAR DEFAULT ''"),
        ("person", "VARCHAR DEFAULT ''"),
        ("transaction_id", "VARCHAR"),
        ("currency", "VARCHAR DEFAULT 'ARS'"),
        ("installment_number", "INTEGER"),
        ("installment_total", "INTEGER"),
        ("installment_group_id", "VARCHAR"),
        ("card_last4", "VARCHAR(4)"),
    ]:
        if _col not in _cols:
            _conn.execute(sa_text(f"ALTER TABLE expenses ADD COLUMN {_col} {_type}"))
    _cat_cols = [c["name"] for c in inspect(engine).get_columns("categories")]
    if "parent_id" not in _cat_cols:
        _conn.execute(sa_text("ALTER TABLE categories ADD COLUMN parent_id INTEGER REFERENCES categories(id)"))
    _conn.commit()


# ─── Schemas ─────────────────────────────────────────────────────────────────

class InvestmentCreate(BaseModel):
    ticker:        str   = ""
    name:          str   = ""
    type:          str   = ""
    broker:        str   = ""
    quantity:      float = 0.0
    avg_cost:      float = 0.0
    current_price: Optional[float] = None
    currency:      str   = "ARS"
    notes:         str   = ""


def _inv_response(inv: "Investment") -> dict:
    cost_basis    = (inv.quantity or 0) * (inv.avg_cost or 0)
    current_value = (inv.quantity or 0) * inv.current_price if inv.current_price is not None else None
    pnl           = (current_value - cost_basis) if current_value is not None else None
    pnl_pct       = (pnl / cost_basis * 100)     if (pnl is not None and cost_basis != 0) else None
    return {
        "id":            inv.id,
        "ticker":        inv.ticker        or "",
        "name":          inv.name          or "",
        "type":          inv.type          or "",
        "broker":        inv.broker        or "",
        "quantity":      inv.quantity      or 0.0,
        "avg_cost":      inv.avg_cost      or 0.0,
        "current_price": inv.current_price,
        "currency":      inv.currency      or "ARS",
        "notes":         inv.notes         or "",
        "updated_at":    inv.updated_at.isoformat() if inv.updated_at else None,
        "cost_basis":    cost_basis,
        "current_value": current_value,
        "pnl":           pnl,
        "pnl_pct":       pnl_pct,
    }


class CategoryBase(BaseModel):
    name: str
    color: str = "#6366f1"
    keywords: str = ""
    parent_id: Optional[int] = None


class CategoryCreate(CategoryBase):
    pass


class CategoryResponse(CategoryBase):
    id: int
    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    date: date
    description: str
    amount: float
    category_id: Optional[int] = None
    card: str = ""
    bank: str = ""
    person: str = ""
    notes: str = ""
    transaction_id: Optional[str] = None
    currency: str = "ARS"
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: Optional[str] = None

    @field_validator("date", mode="before")
    @classmethod
    def parse_date(cls, v: object) -> date:
        if isinstance(v, date):
            return v
        s = str(v).strip()
        if not s:
            return date.today()
        normalized = _normalize_date_str(s)
        if re.match(r"^\d{4}-\d{2}-\d{2}$", normalized):
            return date.fromisoformat(normalized)
        return pd.to_datetime(normalized, dayfirst=True).date()


class ExpenseUpdate(BaseModel):
    date: Optional[str] = None  # parsed to date in the endpoint
    description: Optional[str] = None
    amount: Optional[float] = None
    category_id: Optional[int] = None
    card: Optional[str] = None
    bank: Optional[str] = None
    person: Optional[str] = None
    notes: Optional[str] = None
    transaction_id: Optional[str] = None
    currency: Optional[str] = None
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: Optional[str] = None


class ExpenseResponse(BaseModel):
    id: int
    date: date
    description: str
    amount: float
    category_id: Optional[int] = None
    card: str = ""
    bank: str = ""
    person: str = ""
    notes: str = ""
    transaction_id: Optional[str] = None
    currency: str = "ARS"
    installment_number: Optional[int] = None
    installment_total: Optional[int] = None
    installment_group_id: Optional[str] = None
    card_last4: str = ""
    category: Optional[CategoryResponse] = None
    model_config = {"from_attributes": True}

    @field_validator("card", "bank", "person", "notes", "currency", "card_last4", mode="before")
    @classmethod
    def coerce_none(cls, v: object) -> str:
        return v if v is not None else ""

    @field_serializer("date")
    def serialize_date(self, d: date) -> str:
        return f"{d.day:02d}-{d.month:02d}-{d.year}"

    @computed_field  # type: ignore[misc]
    @property
    def category_name(self) -> Optional[str]:
        return self.category.name if self.category else None

    @computed_field  # type: ignore[misc]
    @property
    def category_color(self) -> Optional[str]:
        return self.category.color if self.category else None


class AnalysisRequest(BaseModel):
    month: Optional[str] = None
    question: Optional[str] = None


class AnalysisHistoryResponse(BaseModel):
    id: int
    created_at: datetime
    month: Optional[str] = None
    question: Optional[str] = None
    result_text: str
    expense_count: int
    total_amount: float
    model_config = {"from_attributes": True}


class RowsConfirmBody(BaseModel):
    rows: List[Any]


# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(title="Credit Card Analyzer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8082"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Seed ────────────────────────────────────────────────────────────────────

# Hierarchical category structure.
# Parents have no keywords — they are pure groupers.
# Children have keywords — they receive expenses via auto-categorize.
BASE_HIERARCHY = [
    {
        "parent": {"name": "Alimentación", "color": "#ef4444"},
        "children": [
            {"name": "Supermercado",    "color": "#f87171", "keywords": "supermercado,carrefour,dia,jumbo,coto,walmart,disco,vea,hipermercado,maxi"},
            {"name": "Restaurantes",    "color": "#fca5a5", "keywords": "restaurante,bistro,parrilla,pizza,burger,mcdonalds,burger king,subway,kentucky,wendy"},
            {"name": "Delivery",        "color": "#fee2e2", "keywords": "rappi,pedidosya,glovo,delivery,mercadito,pedidos ya"},
            {"name": "Almacén/Kiosco", "color": "#fecaca", "keywords": "almacen,kiosco,minimercado,despensa,buffet,cafe,panaderia,verduleria"},
        ],
    },
    {
        "parent": {"name": "Transporte", "color": "#f97316"},
        "children": [
            {"name": "Combustible",             "color": "#fb923c", "keywords": "nafta,combustible,shell,ypf,axion,bp,petrobras,puma,gasoil"},
            {"name": "Transporte Público",      "color": "#fdba74", "keywords": "colectivo,tren,subte,sube,metrobus,ecobici"},
            {"name": "Taxi/Remis",              "color": "#fed7aa", "keywords": "uber,cabify,taxi,remis,didi,beat,indrive"},
            {"name": "Peaje & Estacionamiento", "color": "#ffedd5", "keywords": "peaje,estacionamiento,parking,cochera,autopista,aupass"},
        ],
    },
    {
        "parent": {"name": "Entretenimiento", "color": "#8b5cf6"},
        "children": [
            {"name": "Streaming",      "color": "#a78bfa", "keywords": "netflix,spotify,youtube,hbo,disney,amazon,twitch,apple tv,paramount,star plus,flow,directv"},
            {"name": "Juegos",         "color": "#c4b5fd", "keywords": "steam,playstation,xbox,nintendo,epic games,gaming,game pass"},
            {"name": "Cine & Salidas", "color": "#ddd6fe", "keywords": "cine,teatro,boliche,bar,pub,recital,museo,circo,hoyts,cinemark"},
        ],
    },
    {
        "parent": {"name": "Salud", "color": "#10b981"},
        "children": [
            {"name": "Farmacia",    "color": "#34d399", "keywords": "farmacia,drogueria,farmacias del pueblo,farmacity"},
            {"name": "Médicos",     "color": "#6ee7b7", "keywords": "medico,dentista,clinica,hospital,consultorio,odontologo,psicólogo,pediatra,oftalmologo"},
            {"name": "Prepaga",     "color": "#a7f3d0", "keywords": "osde,swiss medical,medicus,omint,galeno,ioma,pami,obra social,prepaga"},
            {"name": "Laboratorio", "color": "#d1fae5", "keywords": "laboratorio,análisis,estudio,bioquímica,tomografía,resonancia,radiografía"},
        ],
    },
    {
        "parent": {"name": "Hogar & Servicios", "color": "#6366f1"},
        "children": [
            {"name": "Expensas",          "color": "#818cf8", "keywords": "expensas,administración,consorcio"},
            {"name": "Electricidad & Gas", "color": "#a5b4fc", "keywords": "electricidad,gas,edenor,edesur,metrogas,naturgy,camuzzi,litoral gas,enel"},
            {"name": "Internet & Cable",  "color": "#c7d2fe", "keywords": "internet,cablevision,telecom,fibertel,claro hogar,arlink,cable"},
            {"name": "Telefonía",         "color": "#e0e7ff", "keywords": "celular,movistar,personal,claro,telefonía,adt,alarm"},
        ],
    },
    {
        "parent": {"name": "Indumentaria", "color": "#06b6d4"},
        "children": [
            {"name": "Ropa",         "color": "#22d3ee", "keywords": "ropa,zara,h&m,forever 21,mango,kosiuko,rapsodia,markova,ayres,wanama"},
            {"name": "Calzado",      "color": "#67e8f9", "keywords": "zapatillas,calzado,adidas,nike,puma,fila,topper,reef,sarkany"},
            {"name": "Accesorios",   "color": "#a5f3fc", "keywords": "fravega,shopping,musimundo,cardon,joyeria,reloj,bolso,cartera"},
        ],
    },
    {
        "parent": {"name": "Educación", "color": "#f59e0b"},
        "children": [
            {"name": "Cursos Online",       "color": "#fbbf24", "keywords": "udemy,coursera,platzi,domestika,linkedin learning,edx,skillshare"},
            {"name": "Instituto & Colegio", "color": "#fcd34d", "keywords": "colegio,facultad,universidad,instituto,escuela,jardín,arancel"},
            {"name": "Librería & Libros",   "color": "#fde68a", "keywords": "librería,libro,papelería,corrugado,amazon libros"},
        ],
    },
    {
        "parent": {"name": "Viajes", "color": "#14b8a6"},
        "children": [
            {"name": "Alojamiento",         "color": "#2dd4bf", "keywords": "hotel,airbnb,booking,hostel,posada,apart,cabana,despegar alojamiento"},
            {"name": "Vuelos & Traslados",  "color": "#5eead4", "keywords": "vuelo,aerolíneas,latam,flybondi,despegar,aeropuerto,flecha bus,via bariloche,andesmar,crucero"},
        ],
    },
    {
        "parent": {"name": "Finanzas", "color": "#22c55e"},
        "children": [
            {"name": "Bonificación",        "color": "#4ade80", "keywords": "bonificacion,descuento,reintegro,cashback,devolucion,promocion"},
            {"name": "Devolución Impuestos","color": "#86efac", "keywords": "percepcion,percepción,iibb,ingresos brutos,devolucion imp,reintegro imp,imp iva,impuesto"},
        ],
    },
]


@app.on_event("startup")
def startup():
    db = SessionLocal()
    # Legacy flat seed for databases that have never had the hierarchy applied.
    # Only seeds if NO categories exist at all.
    if db.query(Category).count() == 0:
        _apply_base_hierarchy(db)
    db.commit()
    db.close()


def _apply_base_hierarchy(db: Session) -> dict:
    """
    Create parent/child hierarchy from BASE_HIERARCHY.
    - If a parent name already exists with keywords, rename it to '<name> General'
      then create a clean parent (no keywords).
    - If a child name already exists, update its parent_id.
    - Returns counts of created/updated categories.
    """
    created = 0
    updated = 0

    for group in BASE_HIERARCHY:
        pd = group["parent"]
        existing_parent = db.query(Category).filter(Category.name == pd["name"]).first()

        if existing_parent:
            if existing_parent.keywords:
                # Rename old keyword-bearing category so parent can take the clean name
                existing_parent.name = f"{pd['name']} General"
                existing_parent.parent_id = None  # will be set after parent is created
                db.flush()
            parent_cat = db.query(Category).filter(Category.name == pd["name"]).first()
            if not parent_cat:
                parent_cat = Category(name=pd["name"], color=pd["color"], keywords="", parent_id=None)
                db.add(parent_cat)
                db.flush()
                created += 1
                # If we just renamed an old category, make it a child of the new parent
                if existing_parent.name == f"{pd['name']} General":
                    existing_parent.parent_id = parent_cat.id
                    updated += 1
        else:
            parent_cat = Category(name=pd["name"], color=pd["color"], keywords="", parent_id=None)
            db.add(parent_cat)
            db.flush()
            created += 1

        for cd in group["children"]:
            existing_child = db.query(Category).filter(Category.name == cd["name"]).first()
            if existing_child:
                if existing_child.parent_id != parent_cat.id:
                    existing_child.parent_id = parent_cat.id
                    updated += 1
            else:
                db.add(Category(name=cd["name"], color=cd["color"], keywords=cd["keywords"], parent_id=parent_cat.id))
                created += 1

    db.commit()
    return {"created": created, "updated": updated}


@app.post("/categories/apply-base-hierarchy")
def apply_base_hierarchy(db: Session = Depends(get_db)):
    """Apply the recommended parent/child category structure."""
    result = _apply_base_hierarchy(db)
    return result


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _leaf_cats(cats: list) -> list:
    """Return only leaf categories (those that are not parents of any other category)."""
    parent_ids = {c.parent_id for c in cats if c.parent_id is not None}
    return [c for c in cats if c.id not in parent_ids]


def auto_categorize(description: str, categories: list) -> Optional[int]:
    desc_lower = description.lower()
    for cat in _leaf_cats(categories):
        if cat.keywords:
            for kw in cat.keywords.split(","):
                kw = kw.strip()
                if kw and kw in desc_lower:
                    return cat.id
    return None


def _load_dataframe(content: bytes, filename: str) -> "pd.DataFrame":
    if filename.lower().endswith(".csv"):
        for sep in [",", ";", "\t"]:
            try:
                df = pd.read_csv(io.BytesIO(content), sep=sep)
                if len(df.columns) > 1:
                    return df
            except Exception:
                pass
        return pd.read_csv(io.BytesIO(content))
    return pd.read_excel(io.BytesIO(content))


PAYMENT_SKIP_KEYWORDS = ["su pago en pesos", "su pago en usd", "su pago en dolares",
                         "pago en pesos", "pago en usd", "pago minimo", "pago mínimo"]
TAX_REFUND_KEYWORDS = ["percepcion", "percepción", "iibb", "ingresos brutos",
                       "devolucion imp", "reintegro imp", "imp. ", "imp iva", "impuesto"]


def _should_skip(description: str) -> bool:
    desc_lower = description.lower()
    return any(kw in desc_lower for kw in PAYMENT_SKIP_KEYWORDS)


def _resolve_category(db: Session, amount: float, description: str, cats: list) -> Optional[int]:
    """Pick category based on sign and keywords; skip-eligible rows should be filtered before this."""
    desc_lower = description.lower()
    if amount < 0:
        if any(kw in desc_lower for kw in TAX_REFUND_KEYWORDS):
            cat = next((c for c in cats if c.name == "Devolución Impuestos"), None)
        else:
            cat = next((c for c in cats if c.name == "Bonificación"), None)
        return cat.id if cat else None
    return auto_categorize(description, cats)


def add_months(dt: date, months: int) -> date:
    month = dt.month - 1 + months
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, cal_module.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _detect_col(columns: list, hints: list) -> str:
    for col in columns:
        low = col.lower()
        if any(h in low for h in hints):
            return col
    return columns[0] if columns else ""


_SPANISH_MONTHS = {
    # Full names (standard + Argentine variants)
    "ENERO": "01", "FEBRERO": "02", "MARZO": "03", "ABRIL": "04",
    "MAYO": "05", "JUNIO": "06", "JULIO": "07", "AGOSTO": "08",
    "SEPTIEMBRE": "09", "SETIEMBRE": "09",   # SETIEMBRE = Argentine spelling
    "OCTUBRE": "10", "NOVIEMBRE": "11", "DICIEMBRE": "12",
    # 3-letter abbreviations
    "ENE": "01", "FEB": "02", "MAR": "03", "ABR": "04",
    "MAY": "05", "JUN": "06", "JUL": "07", "AGO": "08",
    "SEP": "09", "OCT": "10", "NOV": "11", "DIC": "12",
    # 4-letter abbreviations
    "FEBR": "02", "SEPT": "09", "AGOS": "08",
    # 5–7 letter abbreviations used by Argentine PDFs (period already stripped before lookup)
    "SETIEM": "09", "SEPTIEM": "09",
    "NOVIEM": "11", "DICIEM": "12",
    "OCTUBR": "10",
}

# Longest keys first so "SEPTIEMBRE" matches before "SEP"
_SPANISH_MONTHS_SORTED = sorted(_SPANISH_MONTHS.keys(), key=len, reverse=True)


def _normalize_date_str(raw: str) -> str:
    """
    Normalize date strings from Argentine bank PDFs.

    Handles the common format:  AA MMM DD  (e.g. "26 ENE 15" → "2026-01-15")
    Also expands 2-digit years as a safety net (e.g. "26-01-15" → "2026-01-15").
    Falls back gracefully if the string doesn't match any known pattern.
    """
    import re
    raw_upper = raw.upper().strip()

    # Strip trailing abbreviation periods (e.g. "SETIEM." → "SETIEM", "NOVIEM." → "NOVIEM")
    # Only removes a period that immediately follows a letter, never a digit-separator dot.
    raw_upper = re.sub(r'(?<=[A-Z])\.', '', raw_upper)

    # 1. Replace Spanish month names with numeric equivalents (longest first to avoid partial matches)
    for es in _SPANISH_MONTHS_SORTED:
        if es in raw_upper:
            raw_upper = raw_upper.replace(es, _SPANISH_MONTHS[es])
            break  # only one month per date string

    # 2. Handle "AA MMM DD" → after month substitution becomes "AA NN DD"
    #    Pattern: 2-digit-year  separator  2-digit-month  separator  1-or-2-digit-day
    m = re.match(r'^(\d{2})[\s\-/](\d{2})[\s\-/](\d{1,2})$', raw_upper.strip())
    if m:
        yy, mm, dd = m.group(1), m.group(2), m.group(3).zfill(2)
        yyyy = f"20{yy}"
        return f"{yyyy}-{mm}-{dd}"

    # 2b. Handle DD-MM-YYYY (e.g., "08-12-2025") → YYYY-MM-DD
    m_ddmm = re.match(r'^(\d{1,2})[\s\-/](\d{1,2})[\s\-/](\d{4})$', raw_upper.strip())
    if m_ddmm:
        dd, mm, yyyy = m_ddmm.group(1).zfill(2), m_ddmm.group(2).zfill(2), m_ddmm.group(3)
        return f"{yyyy}-{mm}-{dd}"

    # 3. If still a 2-digit year in ISO-ish format (YY-MM-DD), expand it
    m2 = re.match(r'^(\d{2})-(\d{2})-(\d{2})$', raw_upper.strip())
    if m2:
        return f"20{m2.group(1)}-{m2.group(2)}-{m2.group(3)}"

    return raw_upper


def _is_duplicate(db: Session, exp_date: date, amount: float, description: str,
                  transaction_id: Optional[str] = None,
                  installment_number: Optional[int] = None,
                  installment_total: Optional[int] = None,
                  card_last4: Optional[str] = None) -> bool:
    if transaction_id:
        if db.query(Expense).filter(Expense.transaction_id == transaction_id).first():
            return True

    # For installment rows: match by (description, inst_num, inst_total) within the
    # same calendar month — projected dates may be ±1-2 days off real statement dates.
    if installment_number and installment_total and installment_total >= 2:
        month_start = exp_date.replace(day=1)
        next_month = month_start.replace(day=28) + timedelta(days=4)
        month_end = next_month.replace(day=1) - timedelta(days=1)
        q = db.query(Expense).filter(
            func.lower(Expense.description) == description.lower(),
            Expense.installment_number == installment_number,
            Expense.installment_total == installment_total,
            Expense.date >= month_start,
            Expense.date <= month_end,
        )
        if card_last4:
            q = q.filter(Expense.card_last4 == card_last4)
        if q.first():
            return True

    # Fallback: exact (date, amount, description) match
    q = db.query(Expense).filter(
        Expense.date == exp_date,
        Expense.amount == amount,
        func.lower(Expense.description) == description.lower(),
    )
    if installment_number is not None:
        q = q.filter(Expense.installment_number == installment_number)
    if card_last4:
        q = q.filter(Expense.card_last4 == card_last4)
    return q.first() is not None


def _extract_pdf_text(content: bytes) -> str:
    """
    Extract text from a PDF preserving row structure.
    """
    import pdfplumber
    pages_text = []
    try:
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                page_lines: list[str] = []
                try:
                    words = page.extract_words(x_tolerance=3, y_tolerance=3)
                    if words:
                        row_buckets: dict = {}
                        for w in words:
                            y_key = round(w["top"] / 5) * 5
                            row_buckets.setdefault(y_key, []).append(w)
                        for y in sorted(row_buckets):
                            line = " ".join(
                                w["text"]
                                for w in sorted(row_buckets[y], key=lambda w: w["x0"])
                            )
                            if line.strip():
                                page_lines.append(line)
                except Exception:
                    pass

                if not page_lines:
                    try:
                        text = page.extract_text()
                        if text:
                            page_lines.append(text)
                    except Exception:
                        pass

                try:
                    for table in (page.extract_tables() or []):
                        for row in table:
                            if row:
                                cells = [str(c or "").strip() for c in row if str(c or "").strip()]
                                if cells:
                                    page_lines.append(" | ".join(cells))
                except Exception:
                    pass

                pages_text.extend(page_lines)
    except Exception as e:
        raise ValueError(f"pdfplumber failed: {e}")

    return "\n".join(pages_text)


SPANISH_MONTHS = {
    "ene": 1, "enero": 1,
    "feb": 2, "febr": 2, "febrero": 2,
    "mar": 3, "marzo": 3,
    "abr": 4, "abril": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "junio": 6,
    "jul": 7, "julio": 7,
    "ago": 8, "agosto": 8,
    "set": 9, "seti": 9, "setiem": 9, "setiembre": 9,
    "sep": 9, "septi": 9, "septiem": 9, "septiembre": 9,
    "oct": 10, "octubr": 10, "octubre": 10,
    "nov": 11, "noviem": 11, "noviembre": 11,
    "dic": 12, "diciem": 12, "diciembre": 12,
}


def _normalize_santander_dates(text: str) -> str:
    """
    Normalize Santander Argentina date format.
    
    Santander format: "YY MonthName. DD" (e.g. "25 Diciem. 08")
      - YY = 2-digit year (25 → 2025)
      - MonthName = Spanish month (Diciem. = December)
      - DD = day (01-31)
    
    Example input:
      "25 Diciem. 08 201832 K MERPAGO*PASTASERNESTO"
      "08 199823 * MERPAGO*MERCADOLIBRE"
      "08 199967 * MERPAGO*MERCADOLIBRE"
      "10 274910 K JUMBO PILAR"
    
    Normalized output (DD-MM-YYYY):
      "08-12-2025 201832 K MERPAGO*PASTASERNESTO"
      "08-12-2025 199823 * MERPAGO*MERCADOLIBRE"
      "08-12-2025 199967 * MERPAGO*MERCADOLIBRE"
      "10-12-2025 274910 K JUMBO PILAR"
    """
    lines = text.split("\n")
    result_lines = []
    current_year = None
    current_month = None
    
    month_header_pattern = re.compile(r'^(\d{2})\s+([a-zA-Záéíóúñ]+)\.?\s+(\d{2})\s+(.*)$')
    
    for line in lines:
        stripped = line.strip()
        if not stripped:
            result_lines.append(line)
            continue
        
        match = month_header_pattern.match(stripped)
        if match:
            year_part = match.group(1)
            month_abbr = match.group(2).lower()
            day_part = match.group(3)
            rest = match.group(4)
            
            current_year = 2000 + int(year_part)
            current_month = SPANISH_MONTHS.get(month_abbr)
            if current_month:
                normalized_date = f"{int(day_part):02d}-{current_month:02d}-{current_year}"
                result_lines.append(f"{normalized_date} {rest}")
                continue
        
        parts = stripped.split()
        if len(parts) >= 2 and current_year and current_month:
            try:
                first_num = int(parts[0])
                if 1 <= first_num <= 31:
                    normalized_date = f"{int(parts[0]):02d}-{current_month:02d}-{current_year}"
                    rest = " ".join(parts[1:])
                    result_lines.append(f"{normalized_date} {rest}")
                    continue
            except ValueError:
                pass
        
        result_lines.append(line)
    
    return "\n".join(result_lines)


# ─── Investments ─────────────────────────────────────────────────────────────

@app.get("/investments")
def get_investments(broker: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Investment)
    if broker:
        q = q.filter(Investment.broker == broker)
    return [_inv_response(inv) for inv in q.order_by(Investment.broker, Investment.type, Investment.name).all()]


@app.post("/investments", status_code=201)
def create_investment(data: InvestmentCreate, db: Session = Depends(get_db)):
    inv = Investment(**data.model_dump(), updated_at=datetime.utcnow())
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@app.put("/investments/{inv_id}")
def update_investment(inv_id: int, data: InvestmentCreate, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    for k, v in data.model_dump().items():
        setattr(inv, k, v)
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@app.patch("/investments/{inv_id}/price")
def update_investment_price(inv_id: int, payload: dict, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    inv.current_price = payload.get("current_price")
    inv.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(inv)
    return _inv_response(inv)


@app.delete("/investments/{inv_id}")
def delete_investment(inv_id: int, db: Session = Depends(get_db)):
    inv = db.query(Investment).filter(Investment.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "Inversión no encontrada")
    db.delete(inv)
    db.commit()
    return {"ok": True}


# ─── Settings ────────────────────────────────────────────────────────────────

def _get_setting(db: Session, key: str) -> str:
    row = db.query(Setting).filter(Setting.key == key).first()
    return row.value if row else ""


def _set_setting(db: Session, key: str, value: str):
    row = db.query(Setting).filter(Setting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))
    db.commit()


@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    # Merge DB-stored runtime values with env-var status (never expose secrets)
    rows = db.query(Setting).all()
    result = {r.key: r.value for r in rows}
    result["iol_configured"]  = bool(os.getenv("IOL_USERNAME") and os.getenv("IOL_PASSWORD"))
    result["ppi_configured"]  = bool(os.getenv("PPI_API_KEY") and os.getenv("PPI_API_SECRET"))
    return result


@app.put("/settings/{key}")
def put_setting(key: str, payload: dict, db: Session = Depends(get_db)):
    _set_setting(db, key, payload.get("value", ""))
    return {"ok": True}


# ─── Broker Sync ─────────────────────────────────────────────────────────────

_IOL_TYPE_MAP = {
    "ACCIONES":                  "Acción",
    "CEDEARS":                   "Cedear",
    "BONOS":                     "Bono",
    "LETRAS":                    "Letra",
    "OBLIGACIONES_NEGOCIABLES":  "ON",
    "FONDOS_COMUNES_INVERSION":  "FCI",
    "CAUCIONES":                 "Caución",
    "OPCIONES":                  "Otro",
    "FUTUROS":                   "Otro",
}

_IOL_CURRENCY_MAP = {
    "pesos_argentinos":          "ARS",
    "dolares_estadounidenses":   "USD",
    "dolares_cable":             "USD",
}

_PPI_TYPE_MAP = {
    "ACCIONES":     "Acción",
    "CEDEARS":      "Cedear",
    "BONOS":        "Bono",
    "LETRAS":       "Letra",
    "ON":           "ON",
    "FCI":          "FCI",
    "CAUCIONES":    "Caución",
    "ETF":          "Cedear",
    "ACCIONES-USA": "Cedear",
    "FCI-EXTERIOR": "FCI",
    "NOBAC":        "Bono",
    "LEBAC":        "Letra",
    "OPCIONES":     "Otro",
    "FUTUROS":      "Otro",
}


@app.post("/investments/sync/iol")
def sync_iol(db: Session = Depends(get_db)):
    import requests as _req

    username = os.getenv("IOL_USERNAME", "")
    password = os.getenv("IOL_PASSWORD", "")
    if not username or not password:
        raise HTTPException(400, "IOL_USERNAME / IOL_PASSWORD no configurados en .env")

    try:
        auth = _req.post(
            "https://api.invertironline.com/token",
            data={"username": username, "password": password, "grant_type": "password"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        auth.raise_for_status()
    except Exception as e:
        raise HTTPException(502, f"Error autenticando con IOL: {e}")

    token = auth.json().get("access_token")
    if not token:
        raise HTTPException(502, "IOL no devolvió access_token")

    headers = {"Authorization": f"Bearer {token}"}

    # Collect raw holdings from all mercados, then deduplicate by ticker.
    # IOL returns the same position multiple times (one per settlement: CI/24hs/48hs),
    # so we keep the entry with the highest quantity and a valid avg_cost (ppc > 0).
    raw: list[dict] = []
    for mercado in ("bCBA", "nYSE", "cFondos"):
        try:
            resp = _req.get(
                f"https://api.invertironline.com/api/v2/portafolio/{mercado}",
                headers=headers, timeout=20,
            )
            if resp.status_code != 200:
                continue
            for activo in resp.json().get("activos", []):
                titulo      = activo.get("titulo", {})
                tipo_raw    = titulo.get("tipo", "")
                moneda_raw  = titulo.get("moneda", "")
                cantidad    = float(activo.get("cantidad") or 0)
                valorizado  = float(activo.get("valorizado") or 0)
                ganancia    = activo.get("gananciaDinero")  # total unrealized P&L
                ppc         = float(activo.get("ppc") or 0)

                # IOL reports bonds with cantidad=face_value and prices per-100-VN,
                # making quantity*price 100x wrong. Use valorizado (pre-computed total)
                # divided by cantidad to get a consistent per-unit price instead.
                if valorizado > 0 and cantidad > 0:
                    effective_price = valorizado / cantidad
                else:
                    raw_price = activo.get("ultimoPrecio")
                    effective_price = float(raw_price) if raw_price is not None else None

                # Derive avg_cost from (valorizado - gananciaDinero) / cantidad
                # so cost_basis stays consistent with the same per-unit convention.
                if ganancia is not None and valorizado > 0 and cantidad > 0:
                    cost_basis = valorizado - float(ganancia)
                    effective_avg_cost = cost_basis / cantidad
                else:
                    effective_avg_cost = ppc

                raw.append({
                    "ticker":        titulo.get("simbolo", ""),
                    "name":          titulo.get("descripcion", ""),
                    "type":          _IOL_TYPE_MAP.get(tipo_raw, "Otro"),
                    "currency":      _IOL_CURRENCY_MAP.get(moneda_raw, "ARS"),
                    "quantity":      cantidad,
                    "avg_cost":      effective_avg_cost,
                    "current_price": effective_price,
                })
        except Exception:
            continue

    # Deduplicate: for each ticker keep the row with the best data
    # (prefer rows with ppc > 0; among those, pick highest quantity)
    best: dict[str, dict] = {}
    for h in raw:
        t = h["ticker"]
        if not t:
            continue
        prev = best.get(t)
        if prev is None:
            best[t] = h
        else:
            # Prefer entry with a real avg_cost; break ties by quantity
            prev_score = (prev["avg_cost"] > 0, prev["quantity"])
            curr_score = (h["avg_cost"] > 0,    h["quantity"])
            if curr_score > prev_score:
                best[t] = h

    created = updated = 0
    for h in best.values():
        # Find ALL existing rows for this ticker+broker (may be duplicates from prior runs)
        all_existing = db.query(Investment).filter(
            Investment.ticker == h["ticker"],
            Investment.broker == "InvertirOnline",
        ).all()

        if all_existing:
            # Delete duplicates, keep the first row
            keeper = all_existing[0]
            for dup in all_existing[1:]:
                db.delete(dup)
            keeper.quantity      = h["quantity"]
            keeper.avg_cost      = h["avg_cost"]
            keeper.current_price = h["current_price"]
            keeper.type          = h["type"]
            keeper.currency      = h["currency"]
            keeper.updated_at    = datetime.utcnow()
            updated += 1
        else:
            db.add(Investment(
                ticker=h["ticker"], name=h["name"], type=h["type"],
                broker="InvertirOnline", quantity=h["quantity"],
                avg_cost=h["avg_cost"], current_price=h["current_price"],
                currency=h["currency"], notes="", updated_at=datetime.utcnow(),
            ))
            created += 1

    db.commit()
    _set_setting(db, "iol_last_sync", datetime.utcnow().isoformat())
    return {"broker": "IOL", "created": created, "updated": updated, "total": len(best)}


@app.post("/investments/deduplicate")
def deduplicate_investments(db: Session = Depends(get_db)):
    """Keep only the investment with the highest quantity for each ticker+broker pair."""
    all_inv = db.query(Investment).order_by(Investment.id).all()
    seen: dict[tuple, int] = {}   # (ticker, broker) → id to keep
    to_delete: list[int] = []

    for inv in all_inv:
        key = (inv.ticker, inv.broker)
        if key not in seen:
            seen[key] = inv.id
        else:
            # Compare with what we kept: keep higher quantity, prefer real avg_cost
            kept = db.query(Investment).filter(Investment.id == seen[key]).first()
            curr_score = (inv.avg_cost > 0,    inv.quantity)
            kept_score = (kept.avg_cost > 0, kept.quantity)  # type: ignore[union-attr]
            if curr_score > kept_score:
                to_delete.append(seen[key])
                seen[key] = inv.id
            else:
                to_delete.append(inv.id)

    if to_delete:
        db.query(Investment).filter(Investment.id.in_(to_delete)).delete(synchronize_session=False)
        db.commit()

    return {"removed": len(to_delete)}


@app.post("/investments/sync/ppi")
def sync_ppi(db: Session = Depends(get_db)):
    from ppi_client.ppi import PPI

    api_key    = os.getenv("PPI_API_KEY", "")
    api_secret = os.getenv("PPI_API_SECRET", "")
    if not api_key or not api_secret:
        raise HTTPException(400, "PPI_API_KEY / PPI_API_SECRET no configurados en .env")

    try:
        ppi = PPI(sandbox=False)
        ppi.account.login_api(api_key, api_secret)

        # Auto-discover account number from the session
        accounts = ppi.account.get_accounts()
        if not accounts:
            raise HTTPException(502, "PPI no devolvió ninguna cuenta")
        account_number = (
            accounts[0].get("comitente")
            or accounts[0].get("accountNumber")
            or accounts[0].get("numeroCuenta")
            or str(accounts[0].get("id", ""))
        )
        if not account_number:
            raise HTTPException(502, f"No se pudo leer el número de cuenta de PPI: {accounts[0]}")

        data = ppi.account.get_balance_and_positions(account_number)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Error conectando con PPI: {e}")

    created = updated = 0
    for group in data.get("groupedInstruments", []):
        group_name = (group.get("name") or "").upper()
        inv_type   = _PPI_TYPE_MAP.get(group_name, "Otro")

        for instrument in group.get("instruments", []):
            ticker = instrument.get("ticker", "")
            price  = instrument.get("price")
            amount = instrument.get("amount", 0)
            if not ticker:
                continue

            existing = db.query(Investment).filter(
                Investment.ticker == ticker,
                Investment.broker == "Portfolio Personal",
            ).first()
            if existing:
                existing.quantity      = float(amount or 0)
                existing.current_price = float(price) if price else existing.current_price
                existing.type          = inv_type
                existing.updated_at    = datetime.utcnow()
                updated += 1
            else:
                db.add(Investment(
                    ticker=ticker, name=ticker, type=inv_type,
                    broker="Portfolio Personal",
                    quantity=float(amount or 0), avg_cost=0,
                    current_price=float(price) if price else None,
                    currency="ARS", notes="", updated_at=datetime.utcnow(),
                ))
                created += 1

    db.commit()
    _set_setting(db, "ppi_last_sync", datetime.utcnow().isoformat())
    return {"broker": "PPI", "created": created, "updated": updated}


# ─── Categories ──────────────────────────────────────────────────────────────

@app.get("/categories", response_model=List[CategoryResponse])
def get_categories(db: Session = Depends(get_db)):
    return db.query(Category).all()


@app.post("/categories", response_model=CategoryResponse)
def create_category(cat: CategoryCreate, db: Session = Depends(get_db)):
    if db.query(Category).filter(Category.name == cat.name).first():
        raise HTTPException(400, "Ya existe una categoría con ese nombre")
    db_cat = Category(**cat.model_dump())
    db.add(db_cat)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@app.put("/categories/{cat_id}", response_model=CategoryResponse)
def update_category(cat_id: int, cat: CategoryCreate, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.id == cat_id).first()
    if not db_cat:
        raise HTTPException(404, "Categoría no encontrada")
    for k, v in cat.model_dump().items():
        setattr(db_cat, k, v)
    db.commit()
    db.refresh(db_cat)
    return db_cat


@app.delete("/categories/{cat_id}")
def delete_category(cat_id: int, db: Session = Depends(get_db)):
    db_cat = db.query(Category).filter(Category.id == cat_id).first()
    if not db_cat:
        raise HTTPException(404, "Categoría no encontrada")
    children = db.query(Category).filter(Category.parent_id == cat_id).all()
    if children:
        raise HTTPException(400, f"No se puede eliminar: tiene {len(children)} subcategorías. Eliminalas primero.")
    db.query(Expense).filter(Expense.category_id == cat_id).update({"category_id": None})
    db.delete(db_cat)
    db.commit()
    return {"ok": True}


# ─── Card Closings ───────────────────────────────────────────────────────────

from typing import Optional
from pydantic import BaseModel as PydanticBaseModel

class CardClosingResponse(PydanticBaseModel):
    id: int
    card: str
    card_last_digits: str = ""
    card_type: str = ""
    bank: str
    closing_date: date
    next_closing_date: Optional[date] = None
    due_date: Optional[date] = None
    model_config = {"from_attributes": True}


@app.get("/card-closings", response_model=List[CardClosingResponse])
def get_card_closings(db: Session = Depends(get_db)):
    return db.query(CardClosing).order_by(CardClosing.closing_date.desc()).all()


@app.post("/card-closings", response_model=CardClosingResponse)
def create_card_closing(
    card: str,
    bank: str,
    closing_date: str,
    next_closing_date: Optional[str] = None,
    due_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    from pydantic import field_validator
    
    closing = CardClosing(
        card=card,
        bank=bank,
        closing_date=pd.to_datetime(closing_date, dayfirst=True).date(),
        next_closing_date=pd.to_datetime(next_closing_date, dayfirst=True).date() if next_closing_date else None,
        due_date=pd.to_datetime(due_date, dayfirst=True).date() if due_date else None,
    )
    db.add(closing)
    db.commit()
    db.refresh(closing)
    return closing


# ─── Expenses ────────────────────────────────────────────────────────────────

@app.get("/expenses", response_model=List[ExpenseResponse])
def get_expenses(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    month: Optional[str] = None,
    category_id: Optional[int] = None,
    uncategorized: bool = False,
    bank: Optional[str] = None,
    person: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
):
    q = db.query(Expense)
    if month:
        try:
            from calendar import monthrange
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1]))
        except (ValueError, IndexError):
            pass
    if date_from:
        q = q.filter(Expense.date >= date_from)
    if date_to:
        q = q.filter(Expense.date <= date_to)
    if category_id is not None:
        q = q.filter(Expense.category_id == category_id)
    elif uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))
    if person:
        q = q.filter(Expense.person.ilike(f"%{person}%"))
    if search:
        q = q.filter(Expense.description.ilike(f"%{search}%"))
    return q.order_by(desc(Expense.date)).offset(skip).limit(limit).all()


@app.get("/expenses/distinct-values")
def get_distinct_values(db: Session = Depends(get_db)):
    """Return distinct non-empty values for bank, person, card fields."""
    def distinct(col):
        return sorted({r[0] for r in db.query(col).distinct().all() if r[0]})
    return {
        "banks":   distinct(Expense.bank),
        "persons": distinct(Expense.person),
        "cards":   distinct(Expense.card),
    }


@app.get("/expenses/card-options")
def get_card_options(db: Session = Depends(get_db)):
    """Normalized person→bank→[cards] hierarchy for cascading dropdowns.
    Applies the same bank/holder normalization + token-clustering as card-summary."""
    import re as _re

    def _sig_tokens(name: str) -> set:
        return {_re.sub(r'[^A-Z]', '', t) for t in name.upper().split()
                if len(_re.sub(r'[^A-Z]', '', t)) >= 5}

    rows = (
        db.query(Expense.person, Expense.bank, Expense.card)
        .filter(Expense.person != "", Expense.bank != "", Expense.card != "",
                Expense.card != "Efectivo")
        .distinct()
        .all()
    )

    # Collect normalized tuples
    data: list[tuple[str, str, str]] = []
    for person, bank, card in rows:
        nh = _norm_holder(person)
        nb = _norm_bank(bank)
        if nh and nb and card:
            data.append((nh, nb, card.strip()))

    if not data:
        return {"persons": [], "by_person": {}}

    # Cluster holder variants by shared significant tokens
    unique_holders = list({d[0] for d in data})
    parent = {h: h for h in unique_holders}

    def find(k: str) -> str:
        while parent[k] != k:
            parent[k] = parent[parent[k]]; k = parent[k]
        return k

    htok = {h: _sig_tokens(h) for h in unique_holders}
    for i, h1 in enumerate(unique_holders):
        for h2 in unique_holders[i + 1:]:
            if htok[h1] & htok[h2]:
                r1, r2 = find(h1), find(h2)
                if r1 != r2:
                    parent[r2] = r1

    # Canonical name per cluster = most-seen variant
    cluster_cnt: dict[str, dict[str, int]] = {}
    for nh, _, _ in data:
        root = find(nh)
        d = cluster_cnt.setdefault(root, {})
        d[nh] = d.get(nh, 0) + 1

    root_canonical: dict[str, str] = {
        root: max(cnts, key=cnts.get)
        for root, cnts in cluster_cnt.items()
    }

    # Build person → bank → [cards]
    structure: dict[str, dict[str, set]] = {}
    for nh, nb, card in data:
        canon = root_canonical[find(nh)]
        structure.setdefault(canon, {}).setdefault(nb, set()).add(card)

    by_person = {
        person: {bank: sorted(cards) for bank, cards in sorted(banks.items())}
        for person, banks in structure.items()
    }

    return {"persons": sorted(by_person), "by_person": by_person}


@app.get("/expenses/check-duplicate")
def check_duplicate(
    exp_date: date = Query(..., alias="date"),
    amount: float = Query(...),
    description: str = Query(...),
    transaction_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    dupe = None
    if transaction_id:
        dupe = db.query(Expense).filter(Expense.transaction_id == transaction_id).first()
    if not dupe:
        dupe = db.query(Expense).filter(
            Expense.date == exp_date,
            Expense.amount == amount,
            func.lower(Expense.description) == description.lower(),
        ).first()
    if dupe:
        return {"duplicate": True, "existing_id": dupe.id, "existing_date": dupe.date.isoformat(),
                "existing_description": dupe.description, "existing_amount": dupe.amount}
    return {"duplicate": False}


@app.post("/expenses", response_model=ExpenseResponse)
def create_expense(expense: ExpenseCreate, db: Session = Depends(get_db)):
    if _is_duplicate(db, expense.date, expense.amount, expense.description, expense.transaction_id):
        raise HTTPException(409, "Ya existe un gasto con la misma fecha, monto y descripción.")
    data = expense.model_dump()
    if data.get("category_id") is None:
        cats = db.query(Category).all()
        data["category_id"] = auto_categorize(data["description"], cats)
    db_exp = Expense(**data)
    db.add(db_exp)
    db.commit()
    db.refresh(db_exp)
    return db_exp


@app.put("/expenses/{exp_id}", response_model=ExpenseResponse)
def update_expense(exp_id: int, expense: ExpenseUpdate, db: Session = Depends(get_db)):
    db_exp = db.query(Expense).filter(Expense.id == exp_id).first()
    if not db_exp:
        raise HTTPException(404, "Gasto no encontrado")
    data = expense.model_dump(exclude_none=True)
    if "date" in data:
        raw = str(data["date"]).strip()
        normalized = _normalize_date_str(raw)
        if re.match(r"^\d{4}-\d{2}-\d{2}$", normalized):
            data["date"] = date.fromisoformat(normalized)
        else:
            data["date"] = pd.to_datetime(normalized, dayfirst=True).date()
    for k, v in data.items():
        setattr(db_exp, k, v)
    db.commit()
    db.refresh(db_exp)
    return db_exp


@app.delete("/expenses/{exp_id}")
def delete_expense(exp_id: int, db: Session = Depends(get_db)):
    db_exp = db.query(Expense).filter(Expense.id == exp_id).first()
    if not db_exp:
        raise HTTPException(404, "Gasto no encontrado")
    db.delete(db_exp)
    db.commit()
    return {"ok": True}


# ─── Import ──────────────────────────────────────────────────────────────────

@app.post("/import/preview")
async def preview_import(
    file: UploadFile = File(...),
    date_col: Optional[str] = None,
    desc_col: Optional[str] = None,
    amount_col: Optional[str] = None,
    card_col: Optional[str] = None,
    bank_col: Optional[str] = None,
    person_col: Optional[str] = None,
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        df = _load_dataframe(content, file.filename or "")
    except Exception as e:
        raise HTTPException(400, f"Error al leer el archivo: {e}")

    cols = list(df.columns)
    auto_date   = date_col   or _detect_col(cols, ["fecha", "date", "dia", "day"])
    auto_desc   = desc_col   or _detect_col(cols, ["desc", "concepto", "detalle", "comercio", "nombre", "detail"])
    auto_amount = amount_col or _detect_col(cols, ["monto", "importe", "amount", "total", "valor", "pesos"])
    auto_card   = card_col   or ""
    auto_bank   = bank_col   or ""
    auto_person = person_col or ""

    cats = db.query(Category).all()

    rows = []
    for _, row in df.head(50).iterrows():
        raw_amount = str(row.get(auto_amount, "0")).strip()
        if raw_amount.count(",") == 1 and raw_amount.count(".") == 0:
            raw_amount = raw_amount.replace(",", ".")
        elif raw_amount.count(",") > 1:
            raw_amount = raw_amount.replace(",", "")
        clean = "".join(c for c in raw_amount if c.isdigit() or c == ".")
        try:
            amount = abs(float(clean or "0"))
        except ValueError:
            amount = 0.0

        desc = str(row.get(auto_desc, "")).strip()
        cat_id = auto_categorize(desc, cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None) if cat_id else None

        try:
            row_date = pd.to_datetime(str(row.get(auto_date, "")).strip(), dayfirst=True).date()
        except Exception:
            row_date = None

        rows.append({
            "date": str(row.get(auto_date, "")).strip(),
            "description": desc,
            "amount": amount,
            "suggested_category": cat_name,
            "is_duplicate": _is_duplicate(db, row_date, amount, desc) if row_date else False,
        })

    return {
        "columns": cols,
        "rows": rows,
        "date_col": auto_date,
        "desc_col": auto_desc,
        "amount_col": auto_amount,
        "card_col": auto_card,
        "bank_col": auto_bank,
        "person_col": auto_person,
    }


@app.post("/import/confirm")
async def confirm_import(
    file: UploadFile = File(...),
    date_col: str = "",
    desc_col: str = "",
    amount_col: str = "",
    card_col: Optional[str] = None,
    bank_col: Optional[str] = None,
    person_col: Optional[str] = None,
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        df = _load_dataframe(content, file.filename or "")
    except Exception as e:
        raise HTTPException(400, f"Error al leer el archivo: {e}")

    cats = db.query(Category).all()
    imported = 0
    skipped = 0

    for _, row in df.iterrows():
        try:
            raw_date = str(row.get(date_col, "")).strip()
            try:
                normalized = _normalize_date_str(raw_date)
                if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                    parsed_date = date.fromisoformat(normalized)
                else:
                    parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
            except Exception:
                parsed_date = date.today()

            raw_amount = str(row.get(amount_col, "0")).strip()
            if raw_amount.count(",") == 1 and raw_amount.count(".") == 0:
                raw_amount = raw_amount.replace(",", ".")
            elif raw_amount.count(",") > 1:
                raw_amount = raw_amount.replace(",", "")
            clean = "".join(c for c in raw_amount if c.isdigit() or c == ".")
            amount = abs(float(clean or "0"))

            description = str(row.get(desc_col, "")).strip()
            if not description or amount == 0:
                skipped += 1
                continue

            if _should_skip(description):
                skipped += 1
                continue

            if _is_duplicate(db, parsed_date, amount, description):
                skipped += 1
                continue

            card   = str(row.get(card_col,   "")).strip() if card_col   else ""
            bank   = str(row.get(bank_col,   "")).strip() if bank_col   else ""
            person = str(row.get(person_col, "")).strip() if person_col else ""

            category_id = _resolve_category(db, amount, description, cats)
            db.add(Expense(
                date=parsed_date,
                description=description,
                amount=amount,
                category_id=category_id,
                card=card,
                bank=bank,
                person=person,
            ))
            imported += 1
        except Exception:
            skipped += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}


# ─── Smart Import (LLM) ──────────────────────────────────────────────────────

def _inject_card_markers(text: str) -> str:
    """
    Pre-processing: inject [TARJETA_LAST4: XXXX] markers into PDF text so the LLM
    can reliably assign card_last4 per transaction row.

    Priority (first match wins for the whole document):
      1. "TARJETA 7735 ..." / "Tarjeta 0645 ..." — actual card digits (Galicia VISA, Santander)
      2. "N° de socio: 12345678" — Galicia Mastercard (no card-number line)
      3. "N° de Cuenta: 3363972-0-8" — Galicia VISA fallback (only if no TARJETA line found)

    Two-pass approach: if the text already contains explicit TARJETA XXXX lines, skip
    the account/socio patterns entirely to avoid injecting conflicting last4 values.
    """
    import re as _re
    _tarjeta_re  = _re.compile(r'\bTarjeta\s+(\d{4})\b', _re.IGNORECASE)
    _socio_re    = _re.compile(r'(?:N[°º\xba]?\s*(?:°|º)?\s*)?(?:de\s+)?socio\s*:\s*([0-9][0-9\-]+[0-9])', _re.IGNORECASE)
    _cuenta_re   = _re.compile(r'(?:N[°º\xba]?\s*(?:°|º)?\s*)?(?:de\s+)?[Cc]uenta\s*:\s*([0-9][0-9\-]+[0-9])')

    # First pass: does the document have explicit "TARJETA XXXX" lines?
    has_tarjeta_lines = bool(_tarjeta_re.search(text))

    lines = text.split('\n')
    out = []
    for line in lines:
        out.append(line)
        s = line.strip()

        # Pattern 1: "TARJETA 7735" / "Tarjeta 0645" — always preferred
        m = _tarjeta_re.search(s)
        if m:
            out.append(f'[TARJETA_LAST4: {m.group(1)}]')
            continue

        # Patterns 2 & 3 only when no explicit card-number lines exist in the document
        if not has_tarjeta_lines:
            # Pattern 2: Galicia Mastercard — "N° de socio: 12345678"
            m = _socio_re.search(s)
            if not m:
                # Pattern 3: Galicia VISA account number fallback — "N° de Cuenta: 3363972-0-8"
                m = _cuenta_re.search(s)
            if m:
                digits = _re.sub(r'\D', '', m.group(1))
                if len(digits) >= 4:
                    out.append(f'[TARJETA_LAST4: {digits[-4:]}]')

    return '\n'.join(out)


# ─── Import normalization ─────────────────────────────────────────────────────

_BANK_NORM_MAP: dict[str, str] = {
    "santander río": "Santander",
    "santander rio": "Santander",
    "banco santander río": "Santander",
    "banco santander rio": "Santander",
    "banco santander": "Santander",
    "banco galicia": "Galicia",
    "galicia": "Galicia",
    "bbva francés": "BBVA",
    "bbva frances": "BBVA",
    "banco bbva": "BBVA",
    "banco nación": "Nación",
    "banco nacion": "Nación",
    "banco provincia": "Provincia",
    "banco macro": "Macro",
    "hsbc bank": "HSBC",
    "banco icbc": "ICBC",
    "banco ciudad": "Ciudad",
    "banco patagonia": "Patagonia",
}


def _normalize_bank(bank: str) -> str:
    return _BANK_NORM_MAP.get(bank.strip().lower(), bank.strip())


def _normalize_person(person: str, db: Session) -> str:
    """If the imported name is a prefix of a known longer name in the DB, use the longer one."""
    val = person.strip()
    if not val:
        return val
    val_lower = val.lower()
    rows = (
        db.query(Expense.person, func.count(Expense.id).label("cnt"))
        .filter(Expense.person != "")
        .group_by(Expense.person)
        .all()
    )
    candidates = [
        (r.person, r.cnt) for r in rows
        if r.person.lower().startswith(val_lower) and len(r.person) > len(val)
    ]
    if not candidates:
        return val
    # Pick the candidate with the highest count; break ties by longest name
    return max(candidates, key=lambda x: (x[1], len(x[0])))[0]


def _expand_installments(parsed: list, db: Session) -> list:
    """
    For each row with installment data (installment_number/total >= 2):
    1. Assigns installment_group_id keyed to (description, total, base-month).
    2. Generates projected rows for the installments NOT present in the current PDF,
       skipping any that already exist in the DB (month-level dedup).

    The reference date is the STATEMENT DATE of the known installment.
    Installment 1 date = known_date - (inst_num - 1) months.
    """
    from collections import defaultdict

    # Group parsed rows by purchase
    groups: dict = defaultdict(list)
    for r in parsed:
        inst_num   = r.get("installment_number")
        inst_total = r.get("installment_total")
        d          = r.get("_date_obj")
        if not inst_num or not inst_total or inst_total < 2 or not d:
            continue
        base_date = add_months(d, -(inst_num - 1))
        key = (r["description"].lower(), inst_total, base_date.strftime("%Y-%m"), r.get("card_last4") or "")
        groups[key].append((r, base_date))

    extra: list = []

    for (desc_lower, inst_total, base_ym, card_last4), entries in groups.items():
        template, base_date = entries[0]
        group_id = hashlib.md5(f"{desc_lower}_{inst_total}_{base_ym}_{card_last4}".encode()).hexdigest()[:12]

        # Assign group_id to all rows that belong to this purchase
        present_nums: set = set()
        for r, _ in entries:
            r["installment_group_id"] = group_id
            present_nums.add(r["installment_number"])

        # Project missing installments
        for i in range(1, inst_total + 1):
            if i in present_nums:
                continue
            charge_date = add_months(base_date, i - 1)
            # Skip if already in DB (month-level check)
            if _is_duplicate(db, charge_date, template["amount"], template["description"],
                             installment_number=i, installment_total=inst_total,
                             card_last4=card_last4 or None):
                continue
            extra.append({
                "date":                 charge_date.isoformat(),
                "_date_obj":            charge_date,
                "description":          template["description"],
                "amount":               template["amount"],
                "currency":             template.get("currency", "ARS"),
                "card":                 template.get("card", ""),
                "bank":                 template.get("bank", ""),
                "person":               template.get("person", ""),
                "card_last4":           template.get("card_last4", ""),
                "transaction_id":       None,
                "installment_number":   i,
                "installment_total":    inst_total,
                "installment_group_id": group_id,
                "_auto_generated":      True,
            })

    return parsed + extra


SMART_IMPORT_PROMPT = """Sos un asistente especializado en parsear extractos bancarios de Argentina.

INCLUÍ todas las transacciones de consumo/débito Y todos los reintegros/bonificaciones (montos negativos).
EXCLUÍ únicamente las filas de pago del resumen: "Su pago en pesos", "Su pago en USD", "Pago mínimo", totales y subtotales.

── FORMATO DE FECHAS ──────────────────────────────────────────────────────────
La fecha de cada transacción se forma con tres partes: AA (año), NombreMes (mes) y DD (día).

ESTRUCTURA DEL EXTRACTO:
  • "AA NombreMes" es un ENCABEZADO DE GRUPO que aparece UNA SOLA VEZ por mes.
    Todas las transacciones que siguen pertenecen a ese año y mes hasta que
    aparezca un nuevo encabezado.
  • Cada transacción tiene su propio DD (1-2 dígitos) justo antes del código
    de operación. El DD siempre está presente por transacción.
  • El encabezado "AA NombreMes" puede estar en su propia línea o pegado a la
    primera transacción del mes.

EJEMPLOS REALES:
  "25 Marzo"                       ← encabezado: año=2025, mes=03
  "11 003883 * WHIRLPOOL C.10/12 91.666,58"  → fecha 11-03-2025

  "25 Abril"                       ← encabezado: año=2025, mes=04
  "01 932492 * MERPAGO*TIENDA C.09/12 18.016,58"  → fecha 01-04-2025

  "25 Agosto 07 922186 * MERPAGO*MOULINEX C.05/06 44.623,58"
    → encabezado "25 Agosto" + primera transacción DD=07 en la misma línea → 07-08-2025

  "25 Setiem. 04 328319 * MERPAGO*BSAS C.04/06 10.000,00"  → 04-09-2025

  "25 Noviem. 29 083197 K MERPAGO*AVSPANADERIA 4.400,00"   → 29-11-2025
  "30 457603 K MERPAGO*LASPASTAS 13.500,00"                → 30-11-2025 (hereda "25 Noviem.")

  "25 Diciem. 02 035703 K Microsoft*Xbox G MicrosoftUSD 17,42"  → 02-12-2025
  "03 269543 K JUMBO PILAR 114.226,17"                     → 03-12-2025 (hereda "25 Diciem.")
  "04 147083 K FOOD BOX 2.300,00"                          → 04-12-2025
  "06 003548 * BAIKING PILAR C.01/03 151.666,68"           → 06-12-2025

⚠️  ANTI-CONFUSIÓN MES/DÍA (CRÍTICO):
  El número del encabezado "AA NombreMes" identifica el MES — es un nombre, NO un número de día.
  "Diciem." = Diciembre = mes 12 (DOCE). "Noviem." = Noviembre = mes 11 (ONCE).
  El número al inicio de cada línea de transacción (01-31) es siempre el DÍA.
  ✅ "25 Diciem." + línea "04 147083 K FOOD BOX" → date: "04-12-2025"  (día=04, mes=12)
  ❌ NUNCA: "12-04-2025"  ← invertir mes y día es el error más común y está PROHIBIDO.
  ✅ "25 Noviem." + línea "02 003883 K descripción" → date: "02-11-2025"  (día=02, mes=11)
  ❌ NUNCA: "11-02-2025"

REGLAS:
  1. Cuando encontrés "AA NombreMes", actualizá el contexto (año, mes).
  2. Para cada transacción, combiná el contexto vigente con el DD de esa línea.
  3. El DD nunca se hereda entre transacciones — cada una tiene el suyo.
  4. NUNCA devuelvas un año de 2 dígitos: siempre "20XX".

⚠️  PATRÓN CRÍTICO — líneas de transacción:
  "DD NNNNNN K descripcion monto"  o  "DD NNNNNN * descripcion monto"
  donde DD = DÍA (01-31), NNNNNN = código de referencia/comprobante (NO forma parte de la fecha).
  Ejemplo: "10 131966 K FRIGORIFICO SADA SAN M 144.072,43" con contexto "26 Enero"
           → date: "2026-01-10"  (DD=10 = día diez, mes=01 del contexto, año=2026)
  ⚠️  NUNCA interpretes el código de referencia (131966) como parte de la fecha.

  AA = 2 dígitos del año: 25 → 2025, 26 → 2026
  NombreMes puede estar abreviado hasta 6 letras + punto si es más largo:
    "Setiem." = Setiembre (sep), "Noviem." = Noviembre (nov), "Diciem." = Diciembre (dic)
  ⚠️ "SETIEMBRE" (una sola T) es la grafía argentina de septiembre.

Tabla de meses:
  ENE/ENERO → 01   FEB/FEBR/FEBRERO → 02   MAR/MARZO → 03   ABR/ABRIL → 04
  MAY/MAYO → 05    JUN/JUNIO → 06          JUL/JULIO → 07   AGO/AGOSTO → 08
  SEP/SEPT/SETIEM/SEPTIEM/SETIEMBRE/SEPTIEMBRE → 09
  OCT/OCTUBR/OCTUBRE → 10   NOV/NOVIEM/NOVIEMBRE → 11   DIC/DICIEM/DICIEMBRE → 12
───────────────────────────────────────────────────────────────────────────────

Por cada transacción devolvé un objeto JSON con exactamente estos campos:
- "date": fecha en formato "DD-MM-YYYY"
- "description": descripción limpia del comercio o concepto, sin códigos internos
- "amount": número decimal. NEGATIVO para reintegros/bonificaciones/devoluciones. POSITIVO para consumos.
- "currency": "USD" si el monto está expresado en dólares estadounidenses, "ARS" para pesos argentinos. Determinalo por el contexto (sección del resumen, encabezado, símbolo de moneda, o descripción como "USD" / "US$" / "U$S").
- "card": tipo de tarjeta del HEADER del extracto (ej: "Visa", "Mastercard", "Mastercard Black"). Poné el mismo valor en TODAS las transacciones del extracto. Si no figura, "".
- "bank": banco emisor del HEADER (ej: "Galicia", "Santander"). Poné el mismo valor en TODAS las transacciones. Si no figura, "".
  Normalizá los nombres de banco: "Santander Río", "Banco Santander Río", "Banco Santander" → "Santander".
- "person": nombre del titular para esta transacción específica.
  • Los extractos pueden tener secciones separadas para tarjetas adicionales (ej: un bloque
    encabezado por "TARJETA ADICIONAL", "ADICIONAL", o directamente el nombre de otro titular).
    En ese caso, usá el nombre de ESA sección para las transacciones de ese bloque.
  • Para las transacciones sin sección adicional, usá el titular principal del HEADER.
  • Devolvé el nombre EXACTAMENTE tal como figura en el PDF, sin modificarlo, completarlo ni expandirlo.
    Si el PDF muestra "ZANONI, NATALIA LI", devolvé "ZANONI, NATALIA LI" — NO intentes completar el nombre.
  • Si no figura ningún nombre, "".
- "transaction_id": código único de la operación si figura (nro operación, referencia, auth), sino null
- "installment_number": número de cuota si es un pago en cuotas (ej: "1/3" → 1), sino null
- "installment_total": total de cuotas si es un pago en cuotas (ej: "1/3" → 3), sino null

Para pagos en cuotas. Formatos reconocidos:
  • Santander / genérico: "C.12/12", "C.01/03", "Cta 2/6"
  • Galicia: sufijo "NN/NN" pegado al final de la descripción, sin prefijo
    Ej: "KEL EDICIONES SA03/03" → description: "KEL EDICIONES SA", installment_number: 3, installment_total: 3
    Ej: "MERPAGO*TIENDA01/12"  → description: "MERPAGO*TIENDA",  installment_number: 1, installment_total: 12
  • Simple: "1/3", "2/6"

Reglas:
- Extraé el número de cuota actual (installment_number) y el total de cuotas (installment_total).
- La descripción limpia NO debe incluir la parte de cuotas ni el separador.
- Para el formato Galicia, el patrón es exactamente 2 dígitos "/" 2 dígitos al final: NN/NN (ambos entre 01-99).
  Solo es cuota si installment_total >= 2. "01/01" NO es cuota (cuota única).
- La fecha que aparece en el PDF es la FECHA ORIGINAL DE COMPRA, no la fecha de cobro.
  NO la modifiques: el backend calcula la fecha real de cobro sumando N meses a esa fecha.
  Ej: "24 Noviem. 05 ... MOTOROLA C.12/12" → date: "2024-11-05", installment_number: 12, installment_total: 12
  Ej: "KEL EDICIONES SA03/03" → description: "KEL EDICIONES SA", installment_number: 3, installment_total: 3

Devolvé ÚNICAMENTE un array JSON válido. Sin texto adicional, sin markdown, sin bloques de código.

── IDENTIFICACIÓN DE TARJETA ────────────────────────────────────────
El texto contiene marcadores automáticos con el formato:
  [TARJETA_LAST4: XXXX]

Cada marcador aparece justo después del encabezado de una sección de tarjeta.
Para CADA transacción, devolvé el campo:
- "card_last4": los 4 dígitos del marcador [TARJETA_LAST4: XXXX] más reciente
  que aparece ANTES de esa transacción en el texto.
  Si no hubo ningún marcador antes, devolvé null.
  Usá el MISMO valor para todas las transacciones de la misma sección.

También extraé a nivel de encabezado (para usar como fallback):
- "card_last_digits": primer [TARJETA_LAST4: XXXX] del PDF (encabezado principal)
- "card_type": tipo de tarjeta del encabezado (Visa, Mastercard, etc.)

── FECHAS DE CIERRE DEL RESUMEN ─────────────────────────────────────────
También debés extraer las fechas de cierre del resumen bancario:

BUSCA estos patrones:
  • "CIERRE" seguido de fecha: "CIERRE 30 Oct 25" → closing_date
  • "Cierre Ant." o "Cierre Anterior": última fecha de cierre
  • "Prox.Cierre" o "Próximo Cierre": siguiente fecha de cierre
  • "VENCIMIENTO" seguido de fecha: fecha de vencimiento de la factura
  • Fechas al pie del resumen en formato DD-Mes-YY o DD-Mes-YYYY

EJEMPLOS REALES:
  "CIERRE 30 Oct 25 VENCIMIENTO 07 Nov 25" → closing_date: "30-10-2025", due_date: "07-11-2025"
  "Cierre Ant.: 02 Oct 25" → previous_closing_date: "02-10-2025"
  "Prox.Cierre: 27 Nov 25" → next_closing_date: "27-11-2025"

  Para Galicia (formato DD-Mes-YY):
  "26-Feb-26" "06-Mar-26" → closing_date: "26-02-2026", next_closing_date: "06-03-2026"

 Devolvé estas fechas en campos opcionales:
- "closing_date": fecha de cierre de este resumene (formato DD-MM-YYYY)
- "previous_closing_date": fecha de cierre anterior
- "next_closing_date": fecha del proximo cierre
- "due_date": fecha de vencimiento (formato DD-MM-YYYY)
- "bank_code": código o nombre del banco si aparece (ej: "Santander", "Galicia", etc.)

── TOTALES DEL RESUMEN ──────────────────────────────────────────────
Buscá los totales globales del resumen (NO los subtotales por sección).
Suelen aparecer al inicio o al pie del PDF con etiquetas como:
  "Total Consumos", "Total del período", "TOTAL CONSUMOS DEL MES",
  "Total en Pesos", "Total en Dólares", "Total USD"
  "Consumos que se debitarán en próximos resúmenes",
  "Saldo de cuotas a vencer", "Consumos futuros"

Devolvelos en campos opcionales en CUALQUIERA de las filas (preferentemente la primera):
- "total_ars": número decimal, total de consumos del mes en pesos argentinos (ARS). Solo el número, sin símbolo.
- "total_usd": número decimal, total de consumos del mes en dólares (USD). Solo el número, sin símbolo. null si no hay.
- "future_charges_ars": número decimal, consumos futuros / cuotas a vencer en ARS. null si no figura.
- "future_charges_usd": número decimal, consumos futuros en USD. null si no figura.

IMPORTANTE: estos son totales del RESUMEN COMPLETO, no de una sección individual.
Si no encontrás el valor, devolvé null (no inventes números)."""


@app.post("/import/pdf-debug")
async def pdf_debug(file: UploadFile = File(...)):
    """Returns raw PDF text info for pattern debugging."""
    import re as _re
    content = await file.read()
    try:
        raw = _extract_pdf_text(content)
        raw = _normalize_santander_dates(raw)
        lines = raw.splitlines()
        # lines that could contain account/card number or "Tarjeta"
        candidate_lines = [
            {"i": i, "line": repr(l)}
            for i, l in enumerate(lines)
            if (_re.search(r'\d[\d\-]{4,}\d', l) or 'arjeta' in l or 'uenta' in l or 'socio' in l)
            and len(l.strip()) < 200
        ]
        injected = _inject_card_markers(raw).splitlines()
        return {
            "total_lines": len(lines),
            "first_50": lines[:50],
            "candidate_lines": candidate_lines[:60],
            "markers_found": [l for l in injected if "[TARJETA_LAST4" in l],
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/import/smart")
async def smart_import(file: UploadFile = File(...), db: Session = Depends(get_db)):
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no está configurada.")

    content = await file.read()
    filename = (file.filename or "").lower()

    try:
        if filename.endswith(".pdf"):
            raw_text = _extract_pdf_text(content)
            raw_text = _normalize_santander_dates(raw_text)
            raw_text = _inject_card_markers(raw_text)   # inject [TARJETA_LAST4: XXXX] before LLM
            # Extract markers server-side so we don't depend on LLM to propagate card_last4.
            # Build a positional map: line_index → last4 in effect at that point.
            _marker_re = re.compile(r'\[TARJETA_LAST4:\s*(\d{4})\]')
            _injected_lines = raw_text.splitlines()
            _marker_map: list[tuple[int, str]] = []  # (line_index, last4)
            for _i, _ln in enumerate(_injected_lines):
                _m = _marker_re.search(_ln)
                if _m:
                    _marker_map.append((_i, _m.group(1)))
            # Single fallback last4: first marker found (used when LLM omits card_last4)
            _pdf_last4_fallback = _marker_map[0][1] if _marker_map else ""
        elif filename.endswith((".csv", ".xls", ".xlsx")):
            df = _load_dataframe(content, filename)
            raw_text = df.to_string(index=False, max_rows=1000)
            _pdf_last4_fallback = ""
        else:
            raise HTTPException(415, f"Formato no soportado: {filename}. Usá PDF, CSV o Excel.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"No se pudo leer el archivo: {e}")

    if not raw_text.strip():
        raise HTTPException(400, "No se pudo extraer contenido del archivo.")

    closing_info = {
        "closing_date": None, "next_closing_date": None, "due_date": None,
        "bank": "", "card_last_digits": "", "card_type": "",
        "total_ars": None, "total_usd": None,
        "future_charges_ars": None, "future_charges_usd": None,
    }

    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=f"Extracto bancario:\n\n{raw_text[:60000]}",
            config=genai_types.GenerateContentConfig(
                system_instruction=SMART_IMPORT_PROMPT,
                response_mime_type="application/json",
            ),
        )
        raw_response = (response.text or "").strip()
        if not raw_response:
            raise HTTPException(500, "El modelo no devolvió contenido. Intentá de nuevo.")
        try:
            rows_raw = json.loads(raw_response)
        except json.JSONDecodeError as je:
            raise HTTPException(500, f"Respuesta inválida del modelo (no es JSON): {raw_response[:300]}")
        if not isinstance(rows_raw, list):
            raise ValueError("Response is not a list")

        for field in ["closing_date", "next_closing_date", "due_date", "bank"]:
            for r in rows_raw:
                if r and r.get(field):
                    val = str(r.get(field, "")).strip()
                    if val:
                        try:
                            normalized = _normalize_date_str(val)
                            if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                                parsed_date = date.fromisoformat(normalized)
                            else:
                                parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
                            closing_info[field] = parsed_date
                            break
                        except Exception:
                            pass
            if field == "bank":
                for r in rows_raw:
                    if r and r.get("bank"):
                        val = str(r.get("bank", "")).strip()
                        if val:
                            closing_info["bank"] = val
                            break

        def _parse_amount(v) -> Optional[float]:
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "."))
            except (ValueError, TypeError):
                return None

        for r in rows_raw:
            if r:
                if r.get("card_last_digits") and not closing_info["card_last_digits"]:
                    closing_info["card_last_digits"] = str(r.get("card_last_digits", "")).strip()
                if r.get("card_type") and not closing_info["card_type"]:
                    closing_info["card_type"] = str(r.get("card_type", "")).strip()
                if r.get("total_ars") is not None and closing_info["total_ars"] is None:
                    closing_info["total_ars"] = _parse_amount(r["total_ars"])
                if r.get("total_usd") is not None and closing_info["total_usd"] is None:
                    closing_info["total_usd"] = _parse_amount(r["total_usd"])
                if r.get("future_charges_ars") is not None and closing_info["future_charges_ars"] is None:
                    closing_info["future_charges_ars"] = _parse_amount(r["future_charges_ars"])
                if r.get("future_charges_usd") is not None and closing_info["future_charges_usd"] is None:
                    closing_info["future_charges_usd"] = _parse_amount(r["future_charges_usd"])

        # Also collect first non-empty card/bank/person from transactions as fallbacks
        fallback_card   = closing_info["card_type"]  # card_type from header is most reliable
        fallback_bank   = closing_info["bank"]
        fallback_person = ""
        for r in rows_raw:
            if r:
                if not fallback_card   and r.get("card"):   fallback_card   = str(r["card"]).strip()
                if not fallback_bank   and r.get("bank"):   fallback_bank   = str(r["bank"]).strip()
                if not fallback_person and r.get("person"): fallback_person = str(r["person"]).strip()
            if fallback_card and fallback_bank and fallback_person:
                break

    except json.JSONDecodeError as e:
        raise HTTPException(422, f"La IA no pudo parsear las transacciones. Intentá con importación manual. ({e})")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"Error interno: {type(e).__name__}: {e}")

    cats = db.query(Category).all()

    # First pass: parse and filter
    parsed = []
    for r in rows_raw:
        desc = str(r.get("description", "")).strip()
        if not desc or _should_skip(desc):
            continue
        try:
            amount = float(r.get("amount", 0) or 0)
        except (ValueError, TypeError):
            amount = 0.0
        if amount == 0:
            continue
        txn_id = str(r.get("transaction_id") or "").strip() or None
        raw_date = str(r.get("date", "")).strip()
        try:
            normalized = _normalize_date_str(raw_date)
            if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                row_date = date.fromisoformat(normalized)
            else:
                row_date = pd.to_datetime(normalized, dayfirst=True).date()
        except Exception:
            row_date = None
        inst_num = r.get("installment_number")
        inst_total = r.get("installment_total")
        try:
            inst_num = int(inst_num) if inst_num else None
            inst_total = int(inst_total) if inst_total else None
        except (ValueError, TypeError):
            inst_num = inst_total = None
        raw_currency = str(r.get("currency", "") or "").strip().upper()
        currency = "USD" if raw_currency == "USD" else "ARS"
        row_card   = str(r.get("card",   "") or "").strip() or fallback_card
        row_bank   = str(r.get("bank",   "") or "").strip() or fallback_bank
        row_person = str(r.get("person", "") or "").strip() or fallback_person
        # card_last4: prefer per-row value from LLM, fall back to PDF-level extraction
        row_last4  = (str(r.get("card_last4") or "").strip()[:4]
                      or closing_info["card_last_digits"][:4]
                      or _pdf_last4_fallback)
        parsed.append({
            "date": raw_date,
            "_date_obj": row_date,
            "description": desc,
            "amount": amount,
            "currency": currency,
            "card": row_card,
            "bank": row_bank,
            "person": row_person,
            "card_last4": row_last4,
            "transaction_id": txn_id,
            "installment_number": inst_num,
            "installment_total": inst_total,
            "installment_group_id": None,
        })

    # Normalize person names: ask LLM to collapse truncated/reordered variants of the
    # same cardholder while keeping genuinely different people separate.
    unique_persons = list({r["person"] for r in parsed if r.get("person", "").strip()})
    if len(unique_persons) >= 1:
        norm_map = await _normalize_persons_llm(unique_persons, client)
        for r in parsed:
            raw_p = r.get("person", "")
            if raw_p in norm_map:
                r["person"] = norm_map[raw_p]

    # Forward dates: when a row has no date, inherit from the closest preceding row.
    # This matches the PDF convention where consecutive same-date rows omit the date.
    last_known_date: Optional[date] = None
    last_known_raw: str = ""
    for p in parsed:
        if p["_date_obj"] is not None:
            last_known_date = p["_date_obj"]
            last_known_raw  = p["date"]
        elif last_known_date is not None:
            p["_date_obj"] = last_known_date
            p["date"]      = last_known_raw

    # Expand installment groups: assign group_id and project missing installments.
    parsed = _expand_installments(parsed, db)

    # Build final rows with category and duplicate check
    rows = []
    for p in parsed:
        cat_id = _resolve_category(db, p["amount"], p["description"], cats)
        cat_name = next((c.name for c in cats if c.id == cat_id), None)
        row_date = p["_date_obj"]
        rows.append({
            "date": p["date"],
            "description": p["description"],
            "amount": p["amount"],
            "currency": p["currency"],
            "card": p["card"],
            "bank": p["bank"],
            "person": p["person"],
            "card_last4": p.get("card_last4", ""),
            "transaction_id": p["transaction_id"],
            "installment_number": p["installment_number"],
            "installment_total": p["installment_total"],
            "installment_group_id": p["installment_group_id"],
            "suggested_category": cat_name,
            "is_duplicate": _is_duplicate(db, row_date, p["amount"], p["description"], p["transaction_id"], p["installment_number"], p["installment_total"], p.get("card_last4") or None) if row_date else False,
            "is_auto_generated": p.get("_auto_generated", False),
        })

    non_auto = [r for r in rows if not r.get("is_auto_generated")]
    if not non_auto:
        raise HTTPException(422, "No se encontraron transacciones en el archivo. El resumen puede estar vacío o sin consumos.")

    summary = {
        "card_last4":          closing_info["card_last_digits"] or _pdf_last4_fallback,
        "card_type":           closing_info["card_type"] or "",
        "bank":                closing_info["bank"] or "",
        "closing_date":        closing_info["closing_date"].isoformat() if closing_info["closing_date"] else None,
        "due_date":            closing_info["due_date"].isoformat() if closing_info["due_date"] else None,
        "total_ars":           closing_info["total_ars"],
        "total_usd":           closing_info["total_usd"],
        "future_charges_ars":  closing_info["future_charges_ars"],
        "future_charges_usd":  closing_info["future_charges_usd"],
    }
    return {"rows": rows, "raw_count": len(rows_raw), "summary": summary}


@app.post("/import/rows-confirm")
def rows_confirm_import(body: RowsConfirmBody, db: Session = Depends(get_db)):
    cats = db.query(Category).all()
    imported = 0
    skipped = 0

    for r in body.rows:
        try:
            desc = str(r.get("description", "")).strip()
            try:
                amount = float(r.get("amount", 0) or 0)
            except (ValueError, TypeError):
                amount = 0.0

            if not desc or amount == 0:
                skipped += 1
                continue

            try:
                raw_date = str(r.get("date", "")).strip()
                normalized = _normalize_date_str(raw_date)
                if re.match(r'^\d{4}-\d{2}-\d{2}$', normalized):
                    parsed_date = date.fromisoformat(normalized)
                else:
                    parsed_date = pd.to_datetime(normalized, dayfirst=True).date()
            except Exception:
                parsed_date = date.today()

            if _should_skip(desc):
                skipped += 1
                continue

            # Definir inst_num ANTES de pasarlo a _is_duplicate
            try:
                inst_num = int(r["installment_number"]) if r.get("installment_number") else None
                inst_total = int(r["installment_total"]) if r.get("installment_total") else None
            except (ValueError, TypeError):
                inst_num = inst_total = None

            txn_id = str(r.get("transaction_id") or "").strip() or None
            row_last4 = str(r.get("card_last4") or "").strip()[:4] or None
            if _is_duplicate(db, parsed_date, amount, desc, txn_id, inst_num, inst_total, row_last4):
                skipped += 1
                continue

            raw_currency = str(r.get("currency", "") or "").strip().upper()
            currency = "USD" if raw_currency == "USD" else "ARS"
            category_id = _resolve_category(db, amount, desc, cats)
            norm_bank   = _normalize_bank(str(r.get("bank", "") or ""))
            norm_person = _normalize_person(str(r.get("person", "") or ""), db)
            db.add(Expense(
                date=parsed_date,
                description=desc,
                amount=amount,
                currency=currency,
                category_id=category_id,
                card=str(r.get("card", "") or ""),
                bank=norm_bank,
                person=norm_person,
                card_last4=row_last4,
                transaction_id=txn_id,
                installment_number=inst_num,
                installment_total=inst_total,
                installment_group_id=str(r.get("installment_group_id") or "") or None,
            ))
            imported += 1
        except Exception:
            skipped += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}


# ─── Dashboard ───────────────────────────────────────────────────────────────

@app.get("/dashboard/summary")
def get_summary(
    month: Optional[str] = None,
    group_by: str = "month",
    search: Optional[str] = None,
    person: Optional[str] = None,
    category_id: Optional[int] = None,
    card_last4: Optional[str] = None,
    bank: Optional[str] = None,
    db: Session = Depends(get_db),
):
    from calendar import monthrange

    def _apply_filters(q, month_val, search_val, person_val, cat_id_val, last4_val=None, bank_val=None):
        if month_val:
            try:
                if '-' in month_val:
                    parts = month_val.split('-')
                    if len(parts[0]) == 4:
                        y, m = int(parts[0]), int(parts[1])
                    else:
                        m, y = int(parts[0]), int(parts[1])
                else:
                    y, m = int(month_val[:4]), int(month_val[5:7])
                q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, monthrange(y, m)[1]))
            except (ValueError, IndexError):
                pass
        if search_val:
            q = q.filter(Expense.description.ilike(f"%{search_val}%"))
        if person_val:
            q = q.filter(Expense.person.ilike(f"%{person_val}%"))
        if cat_id_val is not None:
            q = q.filter(Expense.category_id == cat_id_val)
        if last4_val:
            q = q.filter(Expense.card_last4 == last4_val)
        if bank_val:
            q = q.filter(Expense.bank.ilike(f"%{bank_val}%"))
        return q

    expenses = _apply_filters(db.query(Expense), month, search, person, category_id, card_last4, bank).order_by(desc(Expense.date)).all()
    categories = db.query(Category).all()
    cat_map = {c.id: c for c in categories}
    total = sum(e.amount for e in expenses)

    by_category: dict = {}
    for e in expenses:
        if e.category_id and e.category_id in cat_map:
            cat = cat_map[e.category_id]
            cid, cname, ccolor = cat.id, cat.name, cat.color
            parent = cat_map.get(cat.parent_id) if cat.parent_id else None
            pid = parent.id if parent else None
            pname = parent.name if parent else None
            pcolor = parent.color if parent else None
        else:
            cid, cname, ccolor = None, "Sin categoría", "#6b7280"
            pid, pname, pcolor = None, None, None
        if cname not in by_category:
            by_category[cname] = {
                "category_id": cid, "category_name": cname, "category_color": ccolor,
                "parent_id": pid, "parent_name": pname, "parent_color": pcolor,
                "total": 0.0, "count": 0, "previous_total": 0.0,
            }
        by_category[cname]["total"] += e.amount
        by_category[cname]["count"] += 1

    # Trend: compare with previous month when a month filter is active
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            pm = m - 1 if m > 1 else 12
            py = y if m > 1 else y - 1
            prev_expenses = _apply_filters(db.query(Expense), f"{py}-{pm:02d}", search, None, category_id, card_last4, bank).all()
            for e in prev_expenses:
                cname = cat_map[e.category_id].name if e.category_id in cat_map else "Sin categoría"
                if cname in by_category:
                    by_category[cname]["previous_total"] += e.amount
        except (ValueError, IndexError):
            pass

    # by_period (group_by: week, month, year)
    by_period: dict = {}
    for e in expenses:
        if group_by == "week":
            key = e.date.strftime("%G-W%V")
        elif group_by == "year":
            key = e.date.strftime("%Y")
        else:
            key = e.date.strftime("%Y-%m")
        if key not in by_period:
            by_period[key] = {"period": key, "total": 0.0, "count": 0}
        by_period[key]["total"] += e.amount
        by_period[key]["count"] += 1

    by_card: dict = {}
    for e in expenses:
        key = f"{e.card or ''}|{e.bank or ''}|{e.person or ''}"
        if key == "||":
            continue
        if key not in by_card:
            by_card[key] = {"card": e.card or "", "bank": e.bank or "", "person": e.person or "", "total": 0.0, "count": 0}
        by_card[key]["total"] += e.amount
        by_card[key]["count"] += 1

    by_currency: dict = {}
    for e in expenses:
        cur = e.currency or "ARS"
        if cur not in by_currency:
            by_currency[cur] = {"currency": cur, "total": 0.0, "count": 0}
        by_currency[cur]["total"] += e.amount
        by_currency[cur]["count"] += 1

    def expense_to_dict(e: Expense) -> dict:
        cat = cat_map.get(e.category_id) if e.category_id else None
        return {
            "id": e.id, "date": e.date.isoformat(), "description": e.description,
            "amount": e.amount, "currency": e.currency or "ARS",
            "category_id": e.category_id,
            "category_name": cat.name if cat else None, "category_color": cat.color if cat else None,
            "card": e.card or "", "bank": e.bank or "", "person": e.person or "", "notes": e.notes or "",
        }

    # ─── Automatic Trend Data for Charts (Last 6 months + next 3 months) ───
    today = date.today()
    six_months_ago = add_months(today, -6)
    
    # 1. History
    hist_expenses = db.query(Expense).filter(Expense.date >= six_months_ago).all()
    trend_history: dict = {}
    for e in hist_expenses:
        k = e.date.strftime("%Y-%m")
        if k not in trend_history:
            trend_history[k] = {"month": k, "total": 0.0, "count": 0}
        trend_history[k]["total"] += e.amount
        trend_history[k]["count"] += 1
        
    # 2. Future Installments
    installments_exp = db.query(Expense).filter(Expense.installment_group_id != None, Expense.installment_group_id != "").all()
    groups: dict = {}
    for e in installments_exp:
        if e.installment_group_id not in groups:
            groups[e.installment_group_id] = []
        groups[e.installment_group_id].append(e)
        
    trend_future: dict = {}
    for gid, exps in groups.items():
        exps_sorted = sorted(exps, key=lambda x: x.installment_number or 0)
        total_inst = exps_sorted[0].installment_total or 0
        paid = len(exps_sorted)
        remaining = max(0, total_inst - paid)
        if remaining == 0:
            continue
        last_exp = exps_sorted[-1]
        inst_amount = abs(last_exp.amount)
        last_date = last_exp.date
        for i in range(1, remaining + 1):
            future_date = add_months(last_date, i)
            future_key = future_date.strftime("%Y-%m")
            if future_key not in trend_future:
                trend_future[future_key] = 0.0
            trend_future[future_key] += inst_amount

    return {
        "total_amount": total, "total_expenses": len(expenses),
        "by_category": sorted(by_category.values(), key=lambda x: x["total"], reverse=True),
        "by_period": sorted(by_period.values(), key=lambda x: x["period"]),
        "by_currency": sorted(by_currency.values(), key=lambda x: x["total"], reverse=True),
        "by_card": sorted(by_card.values(), key=lambda x: x["total"], reverse=True),
        "recent_expenses": [expense_to_dict(e) for e in expenses[:10]],
        "trend_data": {
            "history": sorted(trend_history.values(), key=lambda x: x["month"]),
            "future_installments": trend_future
        }
    }


@app.get("/dashboard/installments")
def get_installments_dashboard(db: Session = Depends(get_db)):
    exps = (
        db.query(Expense)
        .filter(Expense.installment_group_id != None, Expense.installment_group_id != "")
        .order_by(Expense.installment_number)
        .all()
    )
    cat_list = db.query(Category).all()
    cat_map_local = {c.id: c for c in cat_list}

    groups: dict = {}
    for e in exps:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {
                "installment_group_id": gid,
                "description": e.description,
                "installment_total": e.installment_total or 0,
                "installments_paid": 0,
                "total_amount": 0.0,
                "installment_amount": abs(e.amount),
                "dates": [],
                "category_id": e.category_id,
                "category_name": cat_map_local[e.category_id].name if e.category_id and e.category_id in cat_map_local else None,
                "category_color": cat_map_local[e.category_id].color if e.category_id and e.category_id in cat_map_local else None,
                "bank": e.bank or "",
                "person": e.person or "",
                "currency": e.currency or "ARS",
                "card_last4": e.card_last4 or "",
                "card": e.card or "",
            }
        groups[gid]["installments_paid"] += 1
        groups[gid]["total_amount"] += e.amount
        groups[gid]["dates"].append(e.date)

    result = []
    for g in groups.values():
        paid = g["installments_paid"]
        total_inst = g["installment_total"]
        remaining = max(0, total_inst - paid)
        dates = sorted(g["dates"])
        next_date = add_months(max(dates), 1).isoformat() if remaining > 0 and dates else None
        result.append({
            "installment_group_id": g["installment_group_id"],
            "description": g["description"],
            "installment_total": total_inst,
            "installments_paid": paid,
            "remaining_installments": remaining,
            "total_amount": g["total_amount"],
            "installment_amount": g["installment_amount"],
            "next_date": next_date,
            "category_id": g["category_id"],
            "category_name": g["category_name"],
            "category_color": g["category_color"],
            "bank": g["bank"],
            "person": g["person"],
            "currency": g["currency"],
            "card_last4": g["card_last4"],
            "card": g["card"],
        })

    return sorted(result, key=lambda x: (x["remaining_installments"] == 0, x["next_date"] or "9999-99"))


@app.get("/dashboard/installments/monthly-load")
def get_installments_monthly_load(db: Session = Depends(get_db)):
    """Return projected installment payment total per month for the next 12 months."""
    exps = (
        db.query(Expense)
        .filter(Expense.installment_group_id != None, Expense.installment_group_id != "")
        .order_by(Expense.installment_number)
        .all()
    )

    # Group and compute remaining installments per group
    groups: dict = {}
    for e in exps:
        gid = e.installment_group_id
        if gid not in groups:
            groups[gid] = {"installment_total": e.installment_total or 0, "amount": abs(e.amount), "dates": []}
        groups[gid]["dates"].append(e.date)

    monthly: dict = {}
    for g in groups.values():
        paid = len(g["dates"])
        remaining = max(0, g["installment_total"] - paid)
        if remaining == 0 or not g["dates"]:
            continue
        next_date = add_months(max(g["dates"]), 1)
        for i in range(remaining):
            charge_date = add_months(next_date, i)
            key = charge_date.strftime("%Y-%m")
            if key not in monthly:
                monthly[key] = {"month": key, "total": 0.0, "count": 0}
            monthly[key]["total"] += g["amount"]
            monthly[key]["count"] += 1

    return sorted(monthly.values(), key=lambda x: x["month"])


@app.get("/dashboard/top-merchants")
def get_top_merchants(
    month: Optional[str] = None,
    person: Optional[str] = None,
    bank: Optional[str] = None,
    card_last4: Optional[str] = None,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    from calendar import monthrange as _monthrange
    from collections import Counter

    q = db.query(Expense)
    if month:
        try:
            y, m = int(month[:4]), int(month[5:7])
            q = q.filter(Expense.date >= date(y, m, 1), Expense.date <= date(y, m, _monthrange(y, m)[1]))
        except (ValueError, IndexError):
            pass
    if person:
        q = q.filter(Expense.person.ilike(f"%{person}%"))
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))
    if card_last4:
        q = q.filter(Expense.card_last4 == card_last4)

    expenses = q.filter(Expense.amount > 0).all()
    cat_list = db.query(Category).all()
    cat_map = {c.id: c for c in cat_list}

    groups: dict = {}
    for e in expenses:
        key = e.description.lower().strip()
        if key not in groups:
            groups[key] = {"description": e.description, "total": 0.0, "count": 0, "cats": []}
        groups[key]["total"] += e.amount
        groups[key]["count"] += 1
        if e.category_id:
            groups[key]["cats"].append(e.category_id)

    result = []
    for g in groups.values():
        top_cat_id = Counter(g["cats"]).most_common(1)[0][0] if g["cats"] else None
        cat = cat_map.get(top_cat_id) if top_cat_id else None
        result.append({
            "description": g["description"],
            "total_amount": round(g["total"], 2),
            "count": g["count"],
            "category_name": cat.name if cat else None,
            "category_color": cat.color if cat else None,
        })

    result.sort(key=lambda x: x["total_amount"], reverse=True)
    return result[:limit]


_BANK_ALIASES: dict[str, str] = {
    "santander río": "Santander",
    "santander rio": "Santander",
    "bbva francés": "BBVA",
    "bbva frances": "BBVA",
    "hsbc bank": "HSBC",
    "icbc argentina": "ICBC",
    "banco nación": "Nación",
    "banco nacion": "Nación",
    "banco provincia": "Provincia",
    "banco ciudad": "Ciudad",
    "banco macro": "Macro",
    "banco supervielle": "Supervielle",
    "banco patagonia": "Patagonia",
    "banco credicoop": "Credicoop",
}

def _norm_bank(name: str) -> str:
    import re as _re
    raw = (name or "").strip()
    key = raw.lower()
    if key in _BANK_ALIASES:
        return _BANK_ALIASES[key]
    cleaned = _re.sub(r'(?i)^banco\s+', '', raw).strip()
    return cleaned.title() if cleaned else "Banco"

def _norm_holder(name: str) -> str:
    import re as _re
    name = (name or "").strip().upper()
    name = _re.sub(r',\s*', ', ', name)
    name = _re.sub(r'\s+', ' ', name)
    return name

async def _normalize_persons_llm(persons: list[str], client) -> dict[str, str]:
    """Second LLM pass: canonical-ise truncated/reordered holder names from PDF statements.
    Returns {original: canonical}.  Falls back to identity mapping on any error."""
    if not persons:
        return {}
    prompt = (
        "Estos son nombres de titulares de tarjetas de crédito argentinas extraídos de "
        "extractos bancarios. Los PDFs suelen truncar o reordenar los nombres "
        "(ej: 'MENDOZA MARCELO IGN' y 'MARCELO I MENDOZA N' son la misma persona).\n\n"
        "Para cada nombre:\n"
        "1. Si dos o más nombres son claramente la misma persona (mismo apellido + al menos "
        "   una inicial del nombre coincide), devolvé el MISMO valor normalizado para todos.\n"
        "2. Si son personas distintas, devolvé valores distintos.\n"
        "3. El formato normalizado debe ser: APELLIDO, NOMBRE (en MAYÚSCULAS).\n"
        "   Expandí abreviaturas si podés inferirlas (ej: 'IGN' → 'IGNACIO').\n\n"
        "Devolvé ÚNICAMENTE un JSON válido: {\"nombre_original\": \"NOMBRE_NORMALIZADO\", ...}\n\n"
        f"Nombres: {json.dumps(persons, ensure_ascii=False)}"
    )
    try:
        resp = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=prompt,
            config=genai_types.GenerateContentConfig(response_mime_type="application/json"),
        )
        result = json.loads(resp.text)
        if isinstance(result, dict):
            return result
    except Exception:
        pass
    return {p: p for p in persons}

@app.get("/dashboard/card-summary")
def get_card_summary(db: Session = Depends(get_db)):
    import re as _re

    def _card_network(card_str: str) -> str:
        s = (card_str or "").strip().lower()
        if "visa" in s:
            return "visa"
        if "mastercard" in s or "master card" in s:
            return "mastercard"
        if "amex" in s or "american express" in s:
            return "amex"
        return s or "unknown"

    exps = db.query(Expense).filter(Expense.amount > 0).all()

    # Key = "bank|network" — collapses all holder/card-name variants for same account
    by_card: dict = {}
    by_card_monthly: dict = {}

    for e in exps:
        bank     = _norm_bank(e.bank)
        card_str = (e.card or "").strip()
        network  = _card_network(card_str)
        holder   = _norm_holder(e.person)
        # Prefer explicit card_last4 column; fall back to trailing digits in card string
        last4    = (e.card_last4 or "").strip()
        if not last4:
            m4 = _re.search(r'\d{4}$', card_str)
            last4 = m4.group() if m4 else ""
        # Group by last4 when available (identifies a specific physical card);
        # fall back to holder name for old data without last4
        key = f"{bank}|{network}|last4:{last4}" if last4 else f"{bank}|{network}|holder:{holder}"
        month_key = e.date.strftime('%Y-%m') if e.date else "1970-01"

        if key not in by_card:
            by_card[key] = {
                "bank": bank, "network": network,
                "card_names": {},   # card_str → count
                "holders": {},      # holder → count
                "last4s": {},       # last4 → count
                "total_amount": 0.0, "count": 0,
                "currency": e.currency or "ARS", "last_used": None,
            }
            by_card_monthly[key] = {}

        g = by_card[key]
        g["total_amount"] += e.amount
        g["count"] += 1
        g["card_names"][card_str] = g["card_names"].get(card_str, 0) + 1
        if holder:
            g["holders"][holder] = g["holders"].get(holder, 0) + 1
        if last4:
            g["last4s"][last4] = g["last4s"].get(last4, 0) + 1
        if not g["last_used"] or e.date > g["last_used"]:
            g["last_used"] = e.date
        by_card_monthly[key][month_key] = by_card_monthly[key].get(month_key, 0.0) + e.amount

    # Merge holder variants that share a significant token (≥5 chars) under the same
    # bank+network — handles truncated/reordered PDF names for the same cardholder.
    def _sig_tokens(name: str) -> set:
        import re as _re2
        return {_re2.sub(r'[^A-Z]', '', t) for t in name.upper().split()
                if len(_re2.sub(r'[^A-Z]', '', t)) >= 5}

    # Only merge holder-keyed groups (old data without card_last4)
    bank_net_map: dict = {}
    for key in list(by_card.keys()):
        if not key.split('|', 2)[2].startswith("holder:"):
            continue
        parts = key.split('|', 2)
        bn = f"{parts[0]}|{parts[1]}"
        bank_net_map.setdefault(bn, []).append(key)

    for bn, keys in bank_net_map.items():
        if len(keys) <= 1:
            continue
        parent = {k: k for k in keys}

        def find(k: str) -> str:
            while parent[k] != k:
                parent[k] = parent[parent[k]]
                k = parent[k]
            return k

        key_tokens = {}
        for k in keys:
            ts: set = set()
            for h in by_card[k]["holders"]:
                ts |= _sig_tokens(h)
            key_tokens[k] = ts

        for i, k1 in enumerate(keys):
            for k2 in keys[i + 1:]:
                if key_tokens[k1] & key_tokens[k2]:
                    r1, r2 = find(k1), find(k2)
                    if r1 != r2:
                        parent[r2] = r1

        groups: dict = {}
        for k in keys:
            groups.setdefault(find(k), []).append(k)

        for root, members in groups.items():
            for m in members:
                if m == root:
                    continue
                gr, gm = by_card[root], by_card[m]
                gr["total_amount"] += gm["total_amount"]
                gr["count"]        += gm["count"]
                for cn, c in gm["card_names"].items():
                    gr["card_names"][cn] = gr["card_names"].get(cn, 0) + c
                for h, c in gm["holders"].items():
                    gr["holders"][h] = gr["holders"].get(h, 0) + c
                for l4, c in gm["last4s"].items():
                    gr["last4s"][l4] = gr["last4s"].get(l4, 0) + c
                if gm["last_used"] and (not gr["last_used"] or gm["last_used"] > gr["last_used"]):
                    gr["last_used"] = gm["last_used"]
                for mk, v in by_card_monthly.get(m, {}).items():
                    by_card_monthly[root][mk] = by_card_monthly[root].get(mk, 0.0) + v
                del by_card[m]
                del by_card_monthly[m]

    result = []
    for key, g in by_card.items():
        # Most common card name; tie-break by length (prefer more specific)
        card_name = max(g["card_names"], key=lambda n: (g["card_names"][n], len(n))) if g["card_names"] else g["network"].title()
        # Primary holder = most transactions
        holder = max(g["holders"], key=g["holders"].get) if g["holders"] else ""
        # Most common last4
        last4 = max(g["last4s"], key=g["last4s"].get) if g["last4s"] else ""

        monthly = by_card_monthly.get(key, {})
        months_list = sorted(monthly.keys(), reverse=True)[:12]
        monthly_data = [{"month": m, "total": monthly[m]} for m in reversed(months_list)]

        result.append({
            "holder": holder, "bank": g["bank"],
            "last4": last4, "card_name": card_name,
            "total_amount": g["total_amount"], "count": g["count"],
            "currency": g["currency"],
            "last_used": g["last_used"].isoformat() if g["last_used"] else None,
            "monthly": monthly_data,
        })

    return sorted(result, key=lambda x: x["total_amount"], reverse=True)


# ─── Análisis de consumo ──────────────────────────────────────────────────────

ANALYSIS_SYSTEM_PROMPT = """IMPORTANTE: Solo podés responder preguntas relacionadas con los gastos, consumos y finanzas personales del usuario. Si te hacen una pregunta sobre cualquier otro tema (política, recetas, programación, historia, etc.), respondé únicamente: "Solo puedo ayudarte con el análisis de tus gastos y finanzas personales." No hagas excepciones bajo ninguna circunstancia.

Sos un asistente financiero personal especializado en finanzas personales argentinas.
Tu tarea es analizar los gastos con tarjeta de crédito y brindar insights valiosos basados exclusivamente en los datos del usuario.

Al analizar, incluí siempre:
1. 📊 **Resumen general** — total, promedio mensual, tendencia
2. 🏆 **Top categorías** — dónde va el mayor porcentaje del gasto
3. 💡 **Insights clave** — patrones interesantes o preocupantes
4. ✂️ **Sugerencias concretas** — acciones específicas para reducir gastos
5. 🎯 **Prioridades** — qué ajustar primero para mayor impacto

Respondé siempre en español, de forma clara, amigable y directa. Usá markdown con negritas y emojis.
Sé específico con los números del usuario. No des consejos genéricos."""


@app.get("/dashboard/card-category-breakdown")
def get_card_category_breakdown(
    month: Optional[str] = None,
    card_last4: Optional[str] = None,
    bank: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Expenses by card (bank+network), broken down by category — stacked bar chart."""

    def _card_network_local(card_str: str) -> str:
        s = (card_str or "").strip().lower()
        if "visa" in s:
            return "Visa"
        if "mastercard" in s or "master card" in s:
            return "MC"
        if "amex" in s or "american express" in s:
            return "Amex"
        return s.title() or "Otra"

    q = db.query(Expense).filter(Expense.amount > 0)
    if month:
        try:
            y, m_num = int(month[:4]), int(month[5:7])
            from calendar import monthrange
            q = q.filter(
                Expense.date >= date(y, m_num, 1),
                Expense.date <= date(y, m_num, monthrange(y, m_num)[1]),
            )
        except (ValueError, IndexError):
            pass
    if card_last4:
        q = q.filter(Expense.card_last4 == card_last4)
    if bank:
        q = q.filter(Expense.bank.ilike(f"%{bank}%"))

    exps = q.all()
    cats_list = db.query(Category).all()
    cat_map = {c.id: c for c in cats_list}

    data: dict = {}
    cat_colors: dict = {}

    for e in exps:
        bank = _norm_bank(e.bank) or "Efectivo"
        network = _card_network_local(e.card or "")
        card_key = f"{bank} {network}" if bank != "Efectivo" else "Efectivo/Transferencia"

        cat = cat_map.get(e.category_id) if e.category_id else None
        cat_name = cat.name if cat else "Sin categoría"
        cat_color = cat.color if cat else "#94a3b8"
        cat_colors[cat_name] = cat_color

        if card_key not in data:
            data[card_key] = {}
        data[card_key][cat_name] = data[card_key].get(cat_name, 0.0) + e.amount

    rows = [
        {"card": k, **v}
        for k, v in sorted(data.items(), key=lambda x: sum(x[1].values()), reverse=True)
    ]
    categories = [{"name": n, "color": c} for n, c in cat_colors.items()]
    return {"rows": rows, "categories": categories}


@app.get("/dashboard/category-trend")
def get_category_trend(months: int = 4, db: Session = Depends(get_db)):
    """Last N months of expenses broken down by category (for stacked bar chart)."""
    today = date.today()
    # Build ordered list of month keys
    month_keys = []
    for i in range(months - 1, -1, -1):
        m = today.month - i
        y = today.year
        while m <= 0:
            m += 12
            y -= 1
        month_keys.append(f"{y}-{m:02d}")

    cats_list = db.query(Category).all()
    cats_by_id = {c.id: c for c in cats_list}

    start = date.fromisoformat(f"{month_keys[0]}-01")
    exps = db.query(Expense).filter(Expense.amount > 0, Expense.date >= start).all()

    # Accumulate: month_key → category_name → total
    data: dict = {mk: {} for mk in month_keys}
    cat_colors: dict = {}
    for e in exps:
        if not e.date:
            continue
        mk = e.date.strftime('%Y-%m')
        if mk not in data:
            continue
        cat = cats_by_id.get(e.category_id) if e.category_id else None
        cat_name = cat.name if cat else "Sin categoría"
        cat_color = cat.color if cat else "#94a3b8"
        cat_colors[cat_name] = cat_color
        data[mk][cat_name] = data[mk].get(cat_name, 0.0) + e.amount

    rows = [{"month": mk, **data[mk]} for mk in month_keys]
    categories = [{"name": n, "color": c} for n, c in cat_colors.items()]
    return {"rows": rows, "categories": categories}


@app.post("/analysis/stream")
async def stream_analysis(req: AnalysisRequest, db: Session = Depends(get_db)):
    q = db.query(Expense)
    if req.month:
        try:
            from calendar import monthrange
            y, m = int(req.month[:4]), int(req.month[5:7])
            q = q.filter(
                Expense.date >= date(y, m, 1),
                Expense.date <= date(y, m, monthrange(y, m)[1]),
            )
        except (ValueError, IndexError):
            pass

    expenses = q.all()
    categories = db.query(Category).all()
    cat_map = {c.id: c for c in categories}

    async def no_data_stream():
        msg = "No hay gastos registrados para el período seleccionado. Importá o cargá algunos gastos primero."
        yield f"data: {json.dumps({'text': msg})}\n\n"
        yield "data: [DONE]\n\n"

    if not expenses:
        return StreamingResponse(no_data_stream(), media_type="text/event-stream")

    total = sum(e.amount for e in expenses)

    by_cat: dict = {}
    for e in expenses:
        cat_name = cat_map[e.category_id].name if e.category_id and e.category_id in cat_map else "Sin categoría"
        by_cat[cat_name] = by_cat.get(cat_name, 0.0) + e.amount

    by_month: dict = {}
    for e in expenses:
        key = e.date.strftime("%Y-%m")
        by_month[key] = by_month.get(key, 0.0) + e.amount

    top_10 = sorted(expenses, key=lambda x: x.amount, reverse=True)[:10]

    period = ""
    if req.month:
        period = f"Período: {req.month}"
    else:
        dates = [e.date for e in expenses]
        period = f"Período: {min(dates)} → {max(dates)}" if dates else ""

    data_text = f"""
{period}

RESUMEN:
- Total gastado: ${total:,.2f}
- Transacciones: {len(expenses)}
- Promedio por transacción: ${total/len(expenses):,.2f}
{f'- Meses: {len(by_month)}, promedio mensual: ${total/len(by_month):,.2f}' if len(by_month) > 1 else ''}

GASTOS POR CATEGORÍA:
{chr(10).join(f"- {k}: ${v:,.2f} ({v/total*100:.1f}%)" for k, v in sorted(by_cat.items(), key=lambda x: x[1], reverse=True))}

GASTOS POR MES:
{chr(10).join(f"- {k}: ${v:,.2f}" for k, v in sorted(by_month.items()))}

TOP 10 GASTOS MÁS ALTOS:
{chr(10).join(f"- {e.date} | {e.description} | ${e.amount:,.2f} | {cat_map.get(e.category_id, type('C', (), {'name': 'Sin cat'})()).name}" for e in top_10)}
"""

    user_message = data_text.strip()
    if req.question:
        user_message += f"\n\nPREGUNTA ESPECÍFICA DEL USUARIO:\n{req.question}"
    else:
        user_message += "\n\nAnalizá estos gastos en detalle y dame sugerencias concretas para optimizar mis finanzas."

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no está configurada. Creá un archivo .env con tu API key.")

    expense_count_val = len(expenses)
    total_val = total
    accumulated_text: list = []

    async def generate():
        try:
            client = genai.Client(api_key=api_key)
            async for chunk in await client.aio.models.generate_content_stream(
                model="gemini-flash-latest",
                contents=user_message,
                config=genai_types.GenerateContentConfig(
                    system_instruction=ANALYSIS_SYSTEM_PROMPT,
                ),
            ):
                if chunk.text:
                    accumulated_text.append(chunk.text)
                    yield f"data: {json.dumps({'text': chunk.text})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'text': f'Error: {e}'})}\n\n"

        # Save to history after stream completes
        if accumulated_text:
            hist_db = SessionLocal()
            try:
                hist_db.add(AnalysisHistory(
                    created_at=datetime.utcnow(),
                    month=req.month,
                    question=req.question,
                    result_text="".join(accumulated_text),
                    expense_count=expense_count_val,
                    total_amount=total_val,
                ))
                hist_db.commit()
            except Exception:
                pass
            finally:
                hist_db.close()

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/analysis/history", response_model=List[AnalysisHistoryResponse])
def get_analysis_history(db: Session = Depends(get_db)):
    return db.query(AnalysisHistory).order_by(desc(AnalysisHistory.id)).limit(50).all()


@app.delete("/analysis/history/{hist_id}")
def delete_analysis_history(hist_id: int, db: Session = Depends(get_db)):
    h = db.query(AnalysisHistory).filter(AnalysisHistory.id == hist_id).first()
    if not h:
        raise HTTPException(404, "Historial no encontrado")
    db.delete(h)
    db.commit()
    return {"ok": True}


# ─── Delete all expenses ──────────────────────────────────────────────────────

@app.delete("/expenses/all")
def delete_all_expenses(db: Session = Depends(get_db)):
    count = db.query(Expense).count()
    db.query(Expense).delete()
    db.commit()
    return {"deleted": count}


@app.post("/expenses/recategorize")
def recategorize_expenses(
    payload: dict = {},
    db: Session = Depends(get_db),
):
    """Re-run auto-categorization on all expenses using current category keywords.
    Pass {"only_uncategorized": true} to skip already-categorized expenses."""
    only_uncategorized = (payload or {}).get("only_uncategorized", False)
    cats = db.query(Category).all()
    q = db.query(Expense)
    if only_uncategorized:
        q = q.filter(Expense.category_id.is_(None))
    expenses = q.all()
    updated = 0
    for exp in expenses:
        new_cat = _resolve_category(db, exp.amount, exp.description, cats)
        if new_cat != exp.category_id:
            exp.category_id = new_cat
            updated += 1
    db.commit()
    return {"updated": updated, "total": len(expenses)}


@app.post("/expenses/bulk-category")
def bulk_update_category(
    payload: dict,
    db: Session = Depends(get_db),
):
    ids: list = payload.get("ids", [])
    category_id = payload.get("category_id")  # may be None to clear
    if not ids:
        return {"updated": 0}
    db.query(Expense).filter(Expense.id.in_(ids)).update(
        {"category_id": category_id}, synchronize_session=False
    )
    db.commit()
    return {"updated": len(ids)}


# ─── AI Trends & Projection ───────────────────────────────────────────────────

AI_TRENDS_PROMPT = """Sos un analista financiero personal. Analizá los datos de gastos con tarjeta de crédito argentinos que te paso y devolvé un JSON estructurado.

IMPORTANTE: Devolvé ÚNICAMENTE JSON válido, sin texto adicional, sin markdown, sin bloques de código.

El JSON debe tener exactamente esta estructura:
{
  "trend": "up" | "down" | "stable",
  "trend_pct": <número, porcentaje de cambio vs mes anterior, positivo o negativo>,
  "trend_explanation": "<1-2 oraciones explicando la tendencia>",
  "top_rising_category": "<categoría con mayor aumento, o null>",
  "top_falling_category": "<categoría con mayor reducción, o null>",
  "projection": [
    {"month": "YYYY-MM", "projected_amount": <número>, "installments_amount": <monto de cuotas pendientes ese mes>, "note": "<frase corta>"},
    ... (3 meses futuros)
  ],
  "alert": "<alerta importante si existe, o null. Ej: gasto en X aumentó 40%>",
  "recommendation": "<1 sugerencia concreta de ahorro basada en los datos>"
}

Usá los datos históricos por mes para proyectar los próximos 3 meses.
Las cuotas pendientes ya están calculadas: sumá el monto de cuotas de cada mes futuro al gasto proyectado base.
Sé conservador en las proyecciones: usá el promedio de los últimos 3 meses como base."""


@app.get("/dashboard/ai-trends")
async def get_ai_trends(
    month: Optional[str] = None,
    db: Session = Depends(get_db),
):
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise HTTPException(500, "GOOGLE_API_KEY no configurada.")

    from calendar import monthrange
    from collections import defaultdict

    # ── 1. Gastos históricos de los últimos 6 meses ───────────────────────────
    today = date.today()
    six_months_ago = add_months(today, -6)

    expenses_hist = (
        db.query(Expense)
        .filter(Expense.date >= six_months_ago)
        .order_by(Expense.date)
        .all()
    )

    cat_map = {c.id: c for c in db.query(Category).all()}

    by_month: dict = defaultdict(lambda: {"total": 0.0, "count": 0, "by_cat": defaultdict(float)})
    for e in expenses_hist:
        key = e.date.strftime("%Y-%m")
        by_month[key]["total"] += e.amount
        by_month[key]["count"] += 1
        cat_name = cat_map[e.category_id].name if e.category_id and e.category_id in cat_map else "Sin categoría"
        by_month[key]["by_cat"][cat_name] += e.amount

    # ── 2. Cuotas pendientes proyectadas por mes futuro ───────────────────────
    installments_exp = (
        db.query(Expense)
        .filter(
            Expense.installment_group_id != None,
            Expense.installment_group_id != "",
        )
        .all()
    )

    # Group installments to find remaining ones
    groups: dict = defaultdict(list)
    for e in installments_exp:
        groups[e.installment_group_id].append(e)

    # Project future installment costs per month
    future_installments: dict = defaultdict(float)
    for gid, exps in groups.items():
        exps_sorted = sorted(exps, key=lambda x: x.installment_number or 0)
        total_inst = exps_sorted[0].installment_total or 0
        paid = len(exps_sorted)
        remaining = max(0, total_inst - paid)
        if remaining == 0:
            continue
        last_exp = exps_sorted[-1]
        inst_amount = abs(last_exp.amount)
        last_date = last_exp.date
        for i in range(1, remaining + 1):
            future_date = add_months(last_date, i)
            future_key = future_date.strftime("%Y-%m")
            future_installments[future_key] += inst_amount

    # ── 3. Build context for AI ───────────────────────────────────────────────
    sorted_months = sorted(by_month.keys())

    monthly_lines = []
    for m_key in sorted_months:
        d = by_month[m_key]
        cat_breakdown = ", ".join(
            f"{k}: ${v:,.0f}" for k, v in sorted(d["by_cat"].items(), key=lambda x: x[1], reverse=True)[:5]
        )
        monthly_lines.append(f"  {m_key}: total=${d['total']:,.0f} ({d['count']} transacciones) | {cat_breakdown}")

    future_lines = []
    for i in range(1, 4):
        fm = add_months(today, i)
        fkey = fm.strftime("%Y-%m")
        inst_amt = future_installments.get(fkey, 0.0)
        future_lines.append(f"  {fkey}: cuotas_pendientes=${inst_amt:,.0f}")

    # Current month filter context
    filter_ctx = f"Mes en foco del usuario: {month}" if month else "Sin filtro de mes específico (usar todos los datos)"

    context = f"""DATOS DE GASTOS HISTÓRICOS (últimos 6 meses):
{chr(10).join(monthly_lines) or "  Sin datos suficientes"}

CUOTAS PENDIENTES PROYECTADAS:
{chr(10).join(future_lines)}

{filter_ctx}

Fecha actual: {today.isoformat()}
"""

    client = genai.Client(api_key=api_key)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-flash-latest",
            contents=context,
            config=genai_types.GenerateContentConfig(
                system_instruction=AI_TRENDS_PROMPT,
                response_mime_type="application/json",
            ),
        )
        result = json.loads(response.text)
    except json.JSONDecodeError:
        raise HTTPException(422, "La IA no pudo generar el análisis. Intentá más tarde.")
    except Exception as e:
        raise HTTPException(500, f"Error al llamar a la IA: {e}")

    # Attach future installments data to projection for the frontend
    for proj in result.get("projection", []):
        fkey = proj.get("month", "")
        proj["installments_amount"] = future_installments.get(fkey, proj.get("installments_amount", 0))

    # Also return raw monthly history for the frontend charts
    result["monthly_history"] = [
        {
            "month": k,
            "total": by_month[k]["total"],
            "count": by_month[k]["count"],
            "by_cat": dict(by_month[k]["by_cat"]),
        }
        for k in sorted_months
    ]
    result["future_installments"] = {k: v for k, v in future_installments.items()}

    return result
