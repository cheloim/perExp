#!/bin/bash
set -e

# Lint script for Oikonomia (creditCardAnalyzer)
# Usage:
#   ./scripts/lint.sh          # Check mode (reports errors)
#   ./scripts/lint.sh --fix    # Auto-fix mode
#
# This script runs all linters for frontend and backend.
# See .sdd/guides/local-linting.md for details.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIX_MODE="${1:-}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

failed=0

run_linter() {
    local name="$1"
    local cmd="$2"
    local dir="$3"

    echo -e "${YELLOW}[$name]${NC} Running..."
    if (cd "$dir" && eval "$cmd"); then
        echo -e "${GREEN}[$name]${NC} Passed"
    else
        echo -e "${RED}[$name]${NC} FAILED"
        failed=1
    fi
    echo ""
}

echo "=== Frontend Linting ==="
run_linter "ESLint" "npm run lint" "$PROJECT_ROOT/src/frontend"

if [ "$FIX_MODE" = "--fix" ]; then
    run_linter "Prettier" "npx prettier --write src/" "$PROJECT_ROOT/src/frontend"
else
    run_linter "Prettier" "npx prettier --check src/" "$PROJECT_ROOT/src/frontend"
fi

run_linter "TypeScript" "npm run typecheck" "$PROJECT_ROOT/src/frontend"

echo "=== Backend Linting ==="
run_linter "Ruff Lint" "ruff check app/" "$PROJECT_ROOT/src/backend"

if [ "$FIX_MODE" = "--fix" ]; then
    run_linter "Ruff Format" "ruff format app/" "$PROJECT_ROOT/src/backend"
else
    run_linter "Ruff Format" "ruff format --check app/" "$PROJECT_ROOT/src/backend"
fi

run_linter "MyPy" "mypy app/" "$PROJECT_ROOT/src/backend"

echo "=== Tests ==="
run_linter "Unit Tests" \
    "SECRET_KEY='test-secret-key-that-is-at-least-32-chars-long-for-testing' pytest tests/test_card_matching.py tests/test_encryption.py -v" \
    "$PROJECT_ROOT/src/backend"

if [ "$failed" -eq 0 ]; then
    echo -e "${GREEN}All linters passed${NC}"
    exit 0
else
    echo -e "${RED}Some linters failed${NC}"
    exit 1
fi
