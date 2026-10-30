#!/usr/bin/env python3
"""Announce a published release to every Telegram-linked user.

Usage (inside a backend or worker container, after the release is deployed):

    python scripts/announce_whats_new.py --version v1.6 --dry-run
    python scripts/announce_whats_new.py --version v1.6

The first run records ``whats_new_broadcast:v1.6`` in settings; later runs are
a no-op. ``--force`` resends on purpose. Users keep their channel preference,
so ``none`` skips the announcement entirely.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if not os.getenv("SECRET_KEY"):
    secret_file = "/run/secrets/creditcard_backend_dev_secret_key"
    if os.path.exists(secret_file):
        with open(secret_file) as f:
            os.environ["SECRET_KEY"] = f.read().strip()


def main(argv: list[str] | None = None) -> int:
    from app.database import SessionLocal
    from app.services.whats_new import RELEASES, announce_release

    parser = argparse.ArgumentParser(description="Announce an Oikonomia release.")
    parser.add_argument("--version", required=True, help=f"One of: {', '.join(RELEASES)}")
    parser.add_argument("--frontend-url", default=None, help="Defaults to FRONTEND_URL")
    parser.add_argument("--dry-run", action="store_true", help="Count recipients, send nothing")
    parser.add_argument("--force", action="store_true", help="Resend an already announced version")
    args = parser.parse_args(argv)

    if args.version not in RELEASES:
        print(f"Unknown version {args.version}. Known: {', '.join(RELEASES)}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        result = announce_release(
            db,
            args.version,
            frontend_url=args.frontend_url,
            dry_run=args.dry_run,
            force=args.force,
        )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    finally:
        db.close()

    if result["already_announced"]:
        print(f"{args.version} was already announced; nothing to do (use --force to resend).")
        return 0

    prefix = "Would notify" if result["dry_run"] else "Notified"
    print(f"{prefix} {result['sent']} of {result['recipients']} linked users.")
    if result["skipped"]:
        print(f"Skipped {result['skipped']} users with notifications disabled.")
    if result["channels"]:
        print(f"Channels: {result['channels']}")
    print(f"Link: {result['url']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
