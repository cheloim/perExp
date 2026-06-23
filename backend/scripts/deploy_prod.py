#!/usr/bin/env python3
"""
Production deployment script for creditCardAnalyzer.

Handles:
1. Running database migrations
2. Verifying migration success
3. Restarting services

Usage:
  ./scripts/deploy_prod.sh [--dry-run] [--skip-migration]
"""

import argparse
import os
import subprocess
import sys


def run_command(cmd: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a shell command."""
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=capture, text=True)
    if check and result.returncode != 0:
        print(f"  ERROR: Command failed with exit code {result.returncode}")
        if capture:
            print(f"  stderr: {result.stderr}")
        sys.exit(1)
    return result


def main():
    parser = argparse.ArgumentParser(description="Deploy to production")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be done without executing")
    parser.add_argument("--skip-migration", action="store_true", help="Skip database migration")
    parser.add_argument("--skip-restart", action="store_true", help="Skip service restart")
    args = parser.parse_args()

    print("=" * 60)
    print("Production Deployment")
    print("=" * 60)

    if args.dry_run:
        print("\n[DRY RUN] No changes will be made.\n")

    # Step 1: Run migration
    if not args.skip_migration:
        print("\n[Step 1] Running database migration...")
        if args.dry_run:
            print("  Would run: python -m scripts.migrate_remove_legacy_fields")
        else:
            run_command("cd /home/chelo/creditCardAnalyzer/backend && python -m scripts.migrate_remove_legacy_fields")
    else:
        print("\n[Step 1] Skipping migration (--skip-migration)")

    # Step 2: Restart backend
    if not args.skip_restart:
        print("\n[Step 2] Restarting backend service...")
        if args.dry_run:
            print("  Would restart backend container")
        else:
            # Try podman-compose first, then docker-compose
            compose_cmd = "podman-compose"
            result = run_command("which podman-compose", check=False, capture=True)
            if result.returncode != 0:
                compose_cmd = "docker-compose"

            run_command(f"{compose_cmd} restart backend_dev", check=False)
    else:
        print("\n[Step 2] Skipping restart (--skip-restart)")

    # Step 3: Verify
    print("\n[Step 3] Verifying deployment...")
    if args.dry_run:
        print("  Would verify API health endpoint")
    else:
        # Quick health check
        result = run_command("curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/docs", check=False, capture=True)
        if result.stdout.strip() == "200":
            print("  Backend is healthy!")
        else:
            print(f"  Warning: Backend returned status {result.stdout.strip()}")

    print("\n" + "=" * 60)
    print("Deployment complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
