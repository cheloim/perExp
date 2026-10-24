#!/bin/bash
set -e

# Verify script for Oikonomia (creditCardAnalyzer)
#
# This script runs all static checks and unit tests for frontend and backend,
# each exactly once. Run it before opening a PR.
# For the fast pre-commit loop use ./scripts/lint.sh (static only).

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

failed=0

run_check() {
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

echo "=== Frontend ==="
run_check "ESLint" "npm run lint" "$PROJECT_ROOT/src/frontend"
run_check "Prettier" "npx prettier --check src/ e2e/ playwright.config.ts" "$PROJECT_ROOT/src/frontend"
run_check "TypeScript" "npm run typecheck" "$PROJECT_ROOT/src/frontend"
run_check "Unit Tests" "npm test" "$PROJECT_ROOT/src/frontend"

echo "=== Backend ==="
run_check "Ruff Lint" "ruff check app/ tests/" "$PROJECT_ROOT/src/backend"
run_check "Ruff Format" "ruff format --check app/ tests/" "$PROJECT_ROOT/src/backend"
run_check "MyPy" "mypy app/" "$PROJECT_ROOT/src/backend"
run_check "Unit Tests" \
    "SECRET_KEY='test-secret-key-that-is-at-least-32-chars-long-for-testing' python -m pytest tests/ -q" \
    "$PROJECT_ROOT/src/backend"

if [ "$failed" -eq 0 ]; then
    echo -e "${GREEN}All checks passed${NC}"
    exit 0
else
    echo -e "${RED}Some checks failed${NC}"
    exit 1
fi
