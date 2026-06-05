#!/usr/bin/env python3
"""Smoke-test the Castarro shared-core contracts used by desktop and Android."""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    script = ROOT / "scripts" / "validate_castarro_core.py"
    result = subprocess.run([sys.executable, str(script)], cwd=ROOT, text=True, capture_output=True)
    if result.returncode != 0:
        print(result.stdout, end="")
        print(result.stderr, end="", file=sys.stderr)
        return result.returncode
    print(result.stdout, end="")
    print("mobile_shared_core_contract_test: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
