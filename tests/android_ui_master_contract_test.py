import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID_ROOT = ROOT / "mobile" / "android" / "CastarroMobile" / "app" / "src" / "main"
UI_ROOT = ANDROID_ROOT / "java" / "com" / "castarro" / "mobile" / "ui"
MAIN_ACTIVITY = ANDROID_ROOT / "java" / "com" / "castarro" / "mobile" / "MainActivity.kt"
MASTER = UI_ROOT / "theme" / "CastarroUiMaster.kt"

COLOR_LITERAL_RE = re.compile(r"Color\(|0x[0-9A-Fa-f]{6,8}|#[0-9A-Fa-f]{6,8}\b")
DIMENSION_LITERAL_RE = re.compile(r"\b\d+(?:\.\d+)?\.(?:dp|sp)\b")
VISUAL_LITERAL_RE = re.compile(
    r"alpha\s*=\s*\d+(?:\.\d+)?f"
    r"|durationMillis\s*=\s*\d+"
    r"|RoundedCornerShape\(\s*\d"
    r"|aspectRatio\(\s*16f\s*/\s*9f"
)
UNIT_IMPORT_RE = re.compile(r"import androidx\.compose\.ui\.unit\.(?:dp|sp)\b")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def line_number(text: str, index: int) -> int:
    return text[:index].count("\n") + 1


def kt_sources():
    yield MAIN_ACTIVITY
    yield from UI_ROOT.rglob("*.kt")


def assert_no_matches(path: Path, pattern: re.Pattern[str], message: str):
    text = read(path)
    matches = [(match.group(0), line_number(text, match.start())) for match in pattern.finditer(text)]
    if matches:
        rel = path.relative_to(ROOT)
        details = "\n".join(f"{rel}:{line}: {value}" for value, line in matches)
        raise AssertionError(f"{message}:\n{details}")


def test_android_master_exists_and_owns_raw_visual_values():
    master = read(MASTER)
    assert "object CastarroUiMaster" in master
    assert "object Colors" in master
    assert "object Space" in master
    assert "object Radius" in master
    assert "object Size" in master
    assert "object TextSize" in master
    assert COLOR_LITERAL_RE.search(master), "Android master should own raw color values."
    assert DIMENSION_LITERAL_RE.search(master), "Android master should own raw dp/sp values."


def test_android_ui_kotlin_uses_master_tokens():
    for path in kt_sources():
        if path == MASTER:
            continue
        assert_no_matches(path, COLOR_LITERAL_RE, "Raw Android UI colors must live in CastarroUiMaster.kt")
        assert_no_matches(path, DIMENSION_LITERAL_RE, "Raw Android UI dp/sp values must live in CastarroUiMaster.kt")
        assert_no_matches(path, VISUAL_LITERAL_RE, "Raw Android UI visual literals must live in CastarroUiMaster.kt")
        assert_no_matches(path, UNIT_IMPORT_RE, "Android UI files must not import dp/sp directly outside CastarroUiMaster.kt")


def test_android_theme_wrappers_delegate_to_master():
    colors = read(UI_ROOT / "theme" / "CastarroColors.kt")
    typography = read(UI_ROOT / "theme" / "CastarroTypography.kt")
    theme = read(UI_ROOT / "theme" / "CastarroTheme.kt")
    main_activity = read(MAIN_ACTIVITY)
    assert "CastarroUiMaster.Colors" in colors
    assert "CastarroUiMaster.Typography" in typography
    assert "CastarroUiMaster.Colors.NavigationDark" in main_activity
    assert "CastarroUiMaster.Colors.Surface" in main_activity
    assert "CastarroTypography" in theme


def test_android_resources_do_not_define_screen_ui_colors():
    resource_files = [
        ANDROID_ROOT / "res" / "values" / "styles.xml",
        *(ANDROID_ROOT / "res" / "drawable").glob("ic_tab_*.xml"),
    ]
    for path in resource_files:
        assert_no_matches(path, re.compile(r"#[0-9A-Fa-f]{6,8}\b"), "Android screen resources must not define raw colors")


if __name__ == "__main__":
    test_android_master_exists_and_owns_raw_visual_values()
    test_android_ui_kotlin_uses_master_tokens()
    test_android_theme_wrappers_delegate_to_master()
    test_android_resources_do_not_define_screen_ui_colors()
    print("Android UI master contract passed.")
