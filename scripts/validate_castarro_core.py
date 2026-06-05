#!/usr/bin/env python3
"""Validate Castarro shared-core fixtures against the local JSON schemas."""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
CORE = ROOT / "shared" / "castarro-core"


class ContractError(AssertionError):
    pass


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def type_matches(value: object, expected: object) -> bool:
    if isinstance(expected, list):
        return any(type_matches(value, item) for item in expected)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True


def validate_value(path: str, value: object, rule: dict) -> None:
    expected_type = rule.get("type")
    if expected_type is not None and not type_matches(value, expected_type):
        raise ContractError(f"{path}: expected {expected_type}, got {type(value).__name__}")
    if "enum" in rule and value not in rule["enum"]:
        raise ContractError(f"{path}: {value!r} is not one of {rule['enum']}")
    if isinstance(value, str) and rule.get("minLength") and len(value) < int(rule["minLength"]):
        raise ContractError(f"{path}: string is shorter than {rule['minLength']}")
    if isinstance(value, (int, float)) and "minimum" in rule and value < rule["minimum"]:
        raise ContractError(f"{path}: {value} is lower than minimum {rule['minimum']}")
    if isinstance(value, list) and "items" in rule:
        for index, item in enumerate(value):
            validate_value(f"{path}[{index}]", item, rule["items"])


def validate_object(schema_path: Path, fixture_path: Path) -> None:
    schema = load_json(schema_path)
    fixture = load_json(fixture_path)
    required = set(schema.get("required", []))
    missing = sorted(required - set(fixture))
    if missing:
        raise ContractError(f"{fixture_path}: missing required fields {missing}")

    properties = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        extra = sorted(set(fixture) - set(properties))
        if extra:
            raise ContractError(f"{fixture_path}: unexpected fields {extra}")

    for key, rule in properties.items():
        if key in fixture:
            validate_value(key, fixture[key], rule)

    if fixture_path.name.startswith("ready-") and not fixture.get("isReady"):
        raise ContractError(f"{fixture_path}: ready fixtures must set isReady true")
    if fixture_path.name.startswith("blocked-") and fixture.get("isReady"):
        raise ContractError(f"{fixture_path}: blocked fixtures must set isReady false")
    if fixture.get("isReady") and fixture.get("blockingIssues"):
        raise ContractError(f"{fixture_path}: ready reports cannot include blocking issues")


def validate_feature_flags() -> None:
    flags = load_json(CORE / "feature-flags" / "features.json")
    valid_scopes = {"shared", "desktopOnly", "mobileOnly"}
    seen: set[str] = set()
    for feature in flags.get("features", []):
        feature_id = feature.get("id")
        if not feature_id:
            raise ContractError("feature-flags: every feature needs an id")
        if feature_id in seen:
            raise ContractError(f"feature-flags: duplicate feature id {feature_id}")
        seen.add(feature_id)
        scope = feature.get("scope")
        if scope not in valid_scopes:
            raise ContractError(f"feature-flags: {feature_id} has invalid scope {scope}")
        if scope == "desktopOnly" and feature.get("android"):
            raise ContractError(f"feature-flags: {feature_id} cannot be android-enabled")
        if scope == "mobileOnly" and feature.get("desktop"):
            raise ContractError(f"feature-flags: {feature_id} cannot be desktop-enabled")


def main() -> int:
    cases = load_json(CORE / "tests" / "contract-cases.json")
    for case in cases.get("schemaCases", []):
        validate_object(CORE / case["schema"], CORE / case["fixture"])
    validate_feature_flags()
    print(f"validate_castarro_core: PASS ({len(cases.get('schemaCases', []))} schema cases)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContractError as exc:
        print(f"validate_castarro_core: FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1)
