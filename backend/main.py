import os
from dotenv import load_dotenv

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BACKEND_DIR, ".env"))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401 — runs migrations on import
from app.database import SessionLocal
from app.models import Category
from app.seed import _apply_base_hierarchy
from app.routers import (
    analysis,
    card_closings,
    categories,
    dashboard,
    expenses,
    import_,
    investments,
)

application = FastAPI(title="Credit Card Analyzer API")

application.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:8082"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

application.include_router(categories.router)
application.include_router(card_closings.router)
application.include_router(expenses.router)
application.include_router(investments.router)
application.include_router(import_.router)
application.include_router(dashboard.router)
application.include_router(analysis.router)

# Alias so uvicorn can still be started with: uvicorn main:app --reload
app = application


@app.on_event("startup")
def startup():
    db = SessionLocal()
    if db.query(Category).count() == 0:
        _apply_base_hierarchy(db)
    db.commit()
    db.close()
