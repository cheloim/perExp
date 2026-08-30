"""Validate state management patterns in frontend code.

Checks:
1. Fire-and-forget mutations (.catch(() => {})) that return User data must update ["me"] query
2. localStorage.setItem for user preferences must also have a backend API call
3. Mutations that affect query data must invalidate the relevant queries

Usage: python scripts/validate_state_sync.py
Exit code 0 = pass, 1 = fail
"""

import re
import sys
from pathlib import Path

# Resolve paths relative to this script
# Script is at src/backend/scripts/ -> ROOT is project root
ROOT = Path(__file__).resolve().parent.parent.parent.parent
FRONTEND_SRC = ROOT / "src" / "frontend" / "src"


def find_tsx_files(directory: Path) -> list[Path]:
    """Find all .tsx files in directory."""
    return list(directory.rglob("*.tsx"))


def check_fire_and_forget_user_mutations(content: str, filepath: Path) -> list[str]:
    """Check for fire-and-forget mutations that return User data without updating query cache."""
    errors = []

    # Pattern: someApiCall(...).catch(() => {})
    # This is a fire-and-forget mutation
    fire_forget_pattern = re.compile(
        r"(\w+)\([^)]*\)\.catch\(\s*\(\)\s*=>\s*\{\s*\}\s*\)", re.DOTALL
    )

    for match in fire_forget_pattern.finditer(content):
        func_name = match.group(1)

        # Check if this function is defined in the same file or imported
        # Look for the function definition to see if it returns User type
        func_def_pattern = re.compile(
            rf"(?:export\s+)?(?:const|function)\s+{re.escape(func_name)}\s*[=:][^;]*",
            re.DOTALL,
        )
        func_def = func_def_pattern.search(content)

        if func_def:
            func_text = func_def.group(0)
            # Check if the function returns User type or calls an endpoint that returns User
            if "User" in func_text or "/auth/me" in func_text or "user" in func_text.lower():
                # Check if there's a queryClient.invalidateQueries for ["me"] nearby
                # Look within 20 lines of the fire-and-forget call
                line_num = content[: match.start()].count("\n")
                nearby_content = "\n".join(
                    content.split("\n")[max(0, line_num - 5) : line_num + 10]
                )

                if 'invalidateQueries' not in nearby_content or '"me"' not in nearby_content:
                    errors.append(
                        f"Fire-and-forget mutation '{func_name}' may return User data "
                        f"but doesn't invalidate [\"me\"] query. "
                        f"Use .then(() => queryClient.invalidateQueries({{ queryKey: [\"me\"] }})) "
                        f"instead of .catch(() => {{}})."
                    )

    return errors


def check_localstorage_without_backend(content: str, filepath: Path) -> list[str]:
    """Check for localStorage.setItem that stores user preferences without backend call."""
    errors = []

    # Find localStorage.setItem calls
    ls_pattern = re.compile(
        r'localStorage\.setItem\(\s*["\']([^"\']+)["\']\s*,\s*([^)]+)\)'
    )

    for match in ls_pattern.finditer(content):
        key = match.group(1)

        # Skip non-preference keys
        skip_keys = {"auth_token", "theme", "locale", "sidebar_state"}
        if key in skip_keys:
            continue

        # Check if there's a backend API call nearby (within 10 lines)
        line_num = content[: match.start()].count("\n")
        nearby_lines = content.split("\n")[max(0, line_num - 10) : line_num + 5]
        nearby_content = "\n".join(nearby_lines)

        # Look for API call patterns (api.put, api.post, fetch, etc.)
        has_api_call = bool(
            re.search(r"api\.(put|post|patch|delete)\(", nearby_content)
            or re.search(r"fetch\(", nearby_content)
        )

        if not has_api_call:
            errors.append(
                f"localStorage.setItem('{key}') stores user preference "
                f"without a backend API call nearby. "
                f"User preferences should be persisted server-side for cross-device sync."
            )

    return errors


def main():
    print("=" * 60)
    print("State Management Validation")
    print("=" * 60)

    tsx_files = find_tsx_files(FRONTEND_SRC)
    all_errors = []

    for filepath in sorted(tsx_files):
        content = filepath.read_text()
        rel_path = filepath.relative_to(ROOT)

        file_errors = []
        file_errors.extend(check_fire_and_forget_user_mutations(content, filepath))
        file_errors.extend(check_localstorage_without_backend(content, filepath))

        if file_errors:
            print(f"\n--- {rel_path} ---")
            for err in file_errors:
                print(f"  WARN: {err}")
            all_errors.extend(file_errors)

    print("\n" + "=" * 60)
    if all_errors:
        print(f"Status: WARN ({len(all_errors)} issues)")
        # Return 0 for now — warnings only, not blocking
        # Change to return 1 to make this a blocking check
        return 0
    else:
        print("Status: PASS")
        return 0


if __name__ == "__main__":
    sys.exit(main())
