"""Internal CLI for the miscategorization detector (issue #414).

Admin-only tooling: run the forward-only scan, inspect the findings with their
evidence, and resolve them. Nothing here is user-facing.

Usage (from ``src/backend``):

    python -m scripts.categorization_review scan --user-id 3
    python -m scripts.categorization_review scan --since 2026-10-24T00:00:00 --dry-run
    python -m scripts.categorization_review report
    python -m scripts.categorization_review list --status pending --min-score 0.5
    python -m scripts.categorization_review show 12
    python -m scripts.categorization_review accept 12 --category-id 17
    python -m scripts.categorization_review reject 12
    python -m scripts.categorization_review investigate 12
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime

from app.database import SessionLocal
from app.models import CategorizationReview
from app.services import categorization_review as review_service


def _parse_since(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise SystemExit(f"since inválido (usá ISO 8601): {value}")


def _print_review(row: CategorizationReview, verbose: bool = False) -> None:
    expense = row.expense
    current = row.current_category.name if row.current_category else "?"
    suggested = row.suggested_category.name if row.suggested_category else "(sin sugerencia)"
    date = expense.date.isoformat() if expense and expense.date else "?"
    amount = f"${expense.amount:,.2f}" if expense and expense.amount is not None else "?"
    description = expense.description if expense else "?"
    print(
        f"[{row.id}] {date} | {amount} | {description}\n"
        f"      {current} -> {suggested} | score={row.score} | {row.status} | {row.source}\n"
        f"      {row.reason}"
    )
    if verbose:
        try:
            evidence = json.loads(row.evidence or "{}")
        except ValueError:
            evidence = {}
        print(json.dumps(evidence, ensure_ascii=False, indent=2))


def cmd_scan(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        result = review_service.scan_users(
            db,
            user_ids=[args.user_id] if args.user_id else None,
            since=_parse_since(args.since),
            use_llm=not args.no_llm,
            persist=not args.dry_run,
        )
        mode = "dry-run" if args.dry_run else "persistido"
        print(
            f"Scan ({mode}): {result['scanned']} gastos revisados, "
            f"{result['candidates']} candidatos, {result['persisted']} revisiones nuevas"
        )
        for run in result["runs"]:
            print(
                f"  usuario {run['user_id']}: {run['scanned']} gastos, "
                f"{run['candidates']} candidatos, {run['persisted']} nuevas"
            )
        return 0
    finally:
        db.close()


def cmd_report(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        data = review_service.summary(db, user_id=args.user_id)
        print(f"Revisiones: {data['total']}")
        for status, count in sorted(data["by_status"].items()):
            print(f"  {status}: {count}")
        print("Señales:")
        for signal, count in sorted(data["by_signal"].items(), key=lambda kv: -kv[1]):
            print(f"  {signal}: {count}")
        if data["observed_precision"] is not None:
            print(f"Precisión observada (aceptadas/resueltas): {data['observed_precision']}")
        else:
            print("Precisión observada: sin revisiones resueltas todavía")

        rows = (
            db.query(CategorizationReview)
            .filter(CategorizationReview.status == "pending")
            .order_by(CategorizationReview.score.desc())
            .limit(10)
            .all()
        )
        if rows:
            print("\nTop pendientes:")
            for row in rows:
                _print_review(row)
        return 0
    finally:
        db.close()


def cmd_list(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        query = db.query(CategorizationReview)
        if args.status != "all":
            query = query.filter(CategorizationReview.status == args.status)
        if args.user_id is not None:
            query = query.filter(CategorizationReview.user_id == args.user_id)
        if args.min_score is not None:
            query = query.filter(CategorizationReview.score >= args.min_score)
        rows = query.order_by(CategorizationReview.score.desc()).limit(args.limit).all()
        print(f"{len(rows)} revisión(es)")
        for row in rows:
            _print_review(row, verbose=args.verbose)
        return 0
    finally:
        db.close()


def cmd_show(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        review = review_service.get_review(db, args.review_id)
        _print_review(review, verbose=True)
        return 0
    except review_service.ReviewError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()


def _resolve(args: argparse.Namespace, action: str) -> int:
    db = SessionLocal()
    try:
        if action == "accept":
            review = review_service.accept_review(db, args.review_id, category_id=args.category_id)
        elif action == "reject":
            review = review_service.reject_review(db, args.review_id)
        else:
            review = review_service.investigate_review(db, args.review_id)
        print(f"Revisión {review.id} -> {review.status}")
        return 0
    except review_service.ReviewError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        db.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="reviewar los gastos creados desde una fecha")
    scan.add_argument("--user-id", type=int)
    scan.add_argument("--since", help="ISO 8601; por defecto, últimos 7 días")
    scan.add_argument("--dry-run", action="store_true", help="no persistir nada")
    scan.add_argument("--no-llm", action="store_true", help="solo reglas, sin segunda opinión")
    scan.set_defaults(func=cmd_scan)

    report = sub.add_parser("report", help="resumen del detector")
    report.add_argument("--user-id", type=int)
    report.set_defaults(func=cmd_report)

    list_p = sub.add_parser("list", help="listar revisiones")
    list_p.add_argument("--status", default="pending")
    list_p.add_argument("--user-id", type=int)
    list_p.add_argument("--min-score", type=float)
    list_p.add_argument("--limit", type=int, default=50)
    list_p.add_argument("--verbose", action="store_true")
    list_p.set_defaults(func=cmd_list)

    show = sub.add_parser("show", help="ver una revisión con su evidencia")
    show.add_argument("review_id", type=int)
    show.set_defaults(func=cmd_show)

    accept = sub.add_parser("accept", help="aplicar la categoría sugerida al gasto")
    accept.add_argument("review_id", type=int)
    accept.add_argument("--category-id", type=int)
    accept.set_defaults(func=lambda a: _resolve(a, "accept"))

    reject = sub.add_parser("reject", help="marcar como falso positivo")
    reject.add_argument("review_id", type=int)
    reject.set_defaults(func=lambda a: _resolve(a, "reject"))

    investigate = sub.add_parser("investigate", help="marcar como investigada, sin cambios")
    investigate.add_argument("review_id", type=int)
    investigate.set_defaults(func=lambda a: _resolve(a, "investigate"))

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
