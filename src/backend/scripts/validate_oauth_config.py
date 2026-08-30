"""Validate OAuth/SSO configuration in frontend code.

Checks:
1. initCodeClient includes required parameters (client_id, scope, ux_mode, redirect_uri)
2. If access_type is "offline", prompt must also be set
3. TypeScript type definition in env.d.ts includes all parameters used in initCodeClient
4. state parameter should be present (CSRF protection)

Usage: python scripts/validate_oauth_config.py
Exit code 0 = pass, 1 = fail
"""

import re
import sys
from pathlib import Path

# Resolve paths relative to this script
# Script is at src/backend/scripts/ -> ROOT is project root
ROOT = Path(__file__).resolve().parent.parent.parent.parent
FRONTEND_SRC = ROOT / "src" / "frontend" / "src"
LOGIN_PAGE = FRONTEND_SRC / "pages" / "LoginPage.tsx"
ENV_D_TS = FRONTEND_SRC / "env.d.ts"

REQUIRED_PARAMS = {"client_id", "scope", "ux_mode", "redirect_uri"}
RECOMMENDED_PARAMS = {"state"}  # CSRF protection


def extract_init_code_client_params(content: str) -> dict[str, str]:
    """Extract parameters from initCodeClient({ ... }) call."""
    # Find the initCodeClient block - handle multi-line with nested braces
    match = re.search(r"initCodeClient\(\{", content)
    if not match:
        return {}

    # Find the matching closing brace
    start = match.end()
    brace_depth = 1
    pos = start
    while pos < len(content) and brace_depth > 0:
        if content[pos] == "{":
            brace_depth += 1
        elif content[pos] == "}":
            brace_depth -= 1
        pos += 1

    block = content[start : pos - 1]
    params = {}
    # Match key: value pairs (handling quoted and unquoted values)
    for param_match in re.finditer(r"(\w+)\s*:\s*([^,\n]+)", block):
        key = param_match.group(1).strip()
        value = param_match.group(2).strip().rstrip(",")
        params[key] = value
    return params


def extract_type_def_params(content: str) -> set[str]:
    """Extract parameter names from the initCodeClient type definition in env.d.ts."""
    # Find the initCodeClient config block in the type definition
    match = re.search(
        r"initCodeClient\(config:\s*\{([^}]+)\}\)", content, re.DOTALL
    )
    if not match:
        return set()

    block = match.group(1)
    params = set()
    for param_match in re.finditer(r"(\w+)\s*[?]?\s*:", block):
        params.add(param_match.group(1))
    return params


def validate_login_page() -> list[str]:
    """Validate LoginPage.tsx OAuth configuration."""
    errors = []

    if not LOGIN_PAGE.exists():
        errors.append(f"LoginPage.tsx not found at {LOGIN_PAGE}")
        return errors

    content = LOGIN_PAGE.read_text()
    params = extract_init_code_client_params(content)

    if not params:
        errors.append("No initCodeClient() call found in LoginPage.tsx")
        return errors

    # Check required parameters
    for param in REQUIRED_PARAMS:
        if param not in params:
            errors.append(f"Missing required parameter: {param}")

    # Check: if access_type is "offline", prompt must be set
    access_type = params.get("access_type", "").strip('"').strip("'")
    prompt = params.get("prompt", "").strip('"').strip("'")
    if access_type == "offline" and not prompt:
        errors.append(
            'access_type is "offline" but prompt is not set. '
            "Google will re-prompt for consent on every login. "
            'Add prompt: "select_account" to skip consent on repeat visits.'
        )

    # Check recommended parameters (warn, don't fail)
    for param in RECOMMENDED_PARAMS:
        if param not in params:
            errors.append(f"WARN: Missing recommended parameter (CSRF protection): {param}")

    return errors


def validate_type_definition() -> list[str]:
    """Validate env.d.ts type definition includes all used parameters."""
    errors = []

    if not ENV_D_TS.exists():
        errors.append(f"env.d.ts not found at {ENV_D_TS}")
        return errors

    content = ENV_D_TS.read_text()
    type_params = extract_type_def_params(content)

    if not type_params:
        errors.append("No initCodeClient type definition found in env.d.ts")
        return errors

    # Check that type def includes all required + recommended params
    all_expected = REQUIRED_PARAMS | RECOMMENDED_PARAMS | {"access_type", "prompt"}
    for param in all_expected:
        if param not in type_params:
            errors.append(
                f"Type definition in env.d.ts missing parameter: {param}. "
                "Add it to the GoogleAccountsOauth2 interface."
            )

    return errors


def main():
    print("=" * 60)
    print("OAuth Configuration Validation")
    print("=" * 60)

    all_errors = []

    print("\n--- LoginPage.tsx ---")
    login_errors = validate_login_page()
    if login_errors:
        for err in login_errors:
            if err.startswith("WARN:"):
                print(f"  {err}")
            else:
                print(f"  FAIL: {err}")
        all_errors.extend(login_errors)
    else:
        print("  PASS: All OAuth parameters configured correctly")

    print("\n--- env.d.ts ---")
    type_errors = validate_type_definition()
    if type_errors:
        for err in type_errors:
            print(f"  FAIL: {err}")
        all_errors.extend(type_errors)
    else:
        print("  PASS: Type definition includes all parameters")

    print("\n" + "=" * 60)
    # Filter out WARN-only errors for exit code
    hard_errors = [e for e in all_errors if not e.startswith("WARN:")]
    if hard_errors:
        print(f"Status: FAIL ({len(hard_errors)} issues, {len(all_errors) - len(hard_errors)} warnings)")
        return 1
    elif all_errors:
        print(f"Status: PASS ({len(all_errors)} warnings)")
        return 0
    else:
        print("Status: PASS")
        return 0


if __name__ == "__main__":
    sys.exit(main())
