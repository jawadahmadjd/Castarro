import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

COLOR_LITERAL_RE = re.compile(
    r"(?<!&)#[0-9A-Fa-f]{3,8}\b"
    r"|rgba?\([^)]*\)"
    r"|hsla?\([^)]*\)"
    r"|(?<![-\w])(?:white|black|transparent)(?![-\w])"
)
MASTER_REF_RE = re.compile(r"var\((--master-color-[^)]+)\)")
MASTER_DEF_RE = re.compile(r"(--master-color-[A-Za-z0-9-]+)\s*:")
INLINE_STYLE_RE = re.compile(r"style=\"([^\"]*)\"")
EMBEDDED_STYLE_RE = re.compile(r"<style>(.*?)</style>", re.DOTALL)
HARDCODED_VISUAL_STYLE_RE = re.compile(
    r"\.style\.(?:color|background|backgroundColor|border|borderColor|borderRadius|"
    r"boxShadow|font|fontFamily|fontSize|padding|margin|width|height|left|right|top|bottom|"
    r"position)\s*="
)

PRODUCTION_UI_FILES = (
    "web/styles.css",
    "web/index.html",
    "web/app.js",
    "desktop/main.js",
    "scripts/web_ui.py",
)


def read(relative_path):
    return (ROOT / relative_path).read_text(encoding="utf-8-sig")


def assert_no_color_literals(relative_path):
    text = read(relative_path)
    matches = [(match.group(0), text[: match.start()].count("\n") + 1) for match in COLOR_LITERAL_RE.finditer(text)]
    if matches:
      details = "\n".join(f"{relative_path}:{line}: {value}" for value, line in matches)
      raise AssertionError(f"Hardcoded UI color literals found outside web/ui-master.css:\n{details}")


def assert_no_inline_visual_styles(relative_path):
    text = read(relative_path)
    matches = []
    for match in INLINE_STYLE_RE.finditer(text):
        value = match.group(1)
        if value.strip().startswith("--progress-fill-width:"):
            continue
        matches.append((value, text[: match.start()].count("\n") + 1))
    if matches:
        details = "\n".join(f"{relative_path}:{line}: {value}" for value, line in matches)
        raise AssertionError(f"Inline visual styles must be promoted to web/ui-master.css:\n{details}")


def assert_no_embedded_styles(relative_path):
    text = read(relative_path)
    matches = []
    for match in EMBEDDED_STYLE_RE.finditer(text):
        value = match.group(1).strip()
        if relative_path == "desktop/main.js" and value == "${uiMasterCss()}":
            continue
        matches.append((text[: match.start()].count("\n") + 1, value[:80]))
    if matches:
        details = "\n".join(f"{relative_path}:{line}: {value}" for line, value in matches)
        raise AssertionError(f"Embedded style blocks must use web/ui-master.css:\n{details}")


def assert_no_hardcoded_visual_style_writes(relative_path):
    text = read(relative_path)
    matches = [
        (match.group(0), text[: match.start()].count("\n") + 1)
        for match in HARDCODED_VISUAL_STYLE_RE.finditer(text)
    ]
    if matches:
        details = "\n".join(f"{relative_path}:{line}: {value}" for value, line in matches)
        raise AssertionError(f"Hardcoded JS visual style writes found outside web/ui-master.css:\n{details}")


def test_ui_master_is_loaded_by_the_app():
    index = read("web/index.html")
    styles = read("web/styles.css").strip()
    assert 'href="ui-master.css"' in index
    assert styles == "@import url('/ui-master.css');"


def test_non_master_ui_files_do_not_define_colors():
    for relative_path in PRODUCTION_UI_FILES:
        assert_no_color_literals(relative_path)


def test_non_master_ui_files_do_not_define_visual_styles():
    for relative_path in PRODUCTION_UI_FILES:
        assert_no_inline_visual_styles(relative_path)
        assert_no_embedded_styles(relative_path)
        assert_no_hardcoded_visual_style_writes(relative_path)


def test_special_desktop_web_pages_use_ui_master():
    app_js = read("web/app.js")
    desktop = read("desktop/main.js")
    backend = read("scripts/web_ui.py")
    assert "localAssetUrl(\"ui-master.css\")" in app_js
    assert "uiMasterCss()" in desktop
    assert '<body class="startup-page">' in desktop
    assert backend.count('<link rel="stylesheet" href="/ui-master.css">') >= 2
    assert backend.count('<body class="startup-page">') >= 2


def test_master_colors_are_only_raw_registry_values():
    master = read("web/ui-master.css")
    marker = "  /* Legacy semantic aliases"
    assert marker in master
    registry, component_rules = master.split(marker, 1)
    assert COLOR_LITERAL_RE.search(registry), "The master registry should contain the raw managed color values."
    matches = [
        (match.group(0), component_rules[: match.start()].count("\n") + 1)
        for match in COLOR_LITERAL_RE.finditer(component_rules)
    ]
    if matches:
        details = "\n".join(f"web/ui-master.css:{line}: {value}" for value, line in matches)
        raise AssertionError(f"Master component rules must reference tokens instead of raw colors:\n{details}")


def test_master_color_references_resolve():
    master = read("web/ui-master.css")
    refs = set(MASTER_REF_RE.findall(master))
    defs = set(MASTER_DEF_RE.findall(master))
    missing = sorted(refs - defs)
    assert not missing, "Missing master color token declarations: " + ", ".join(missing)


def test_add_stream_modal_contract():
    index = read("web/index.html")
    app_js = read("web/app.js")
    assert 'id="addStreamModal"' in index
    assert 'id="addStreamNameInput"' in index
    assert 'id="addStreamKeyInput"' in index
    assert 'window.openAddStreamModal = openAddStreamModal;' in app_js
    assert 'window.closeAddStreamModal = closeAddStreamModal;' in app_js
    assert 'window.submitAddStreamModal = submitAddStreamModal;' in app_js


if __name__ == "__main__":
    test_ui_master_is_loaded_by_the_app()
    test_non_master_ui_files_do_not_define_colors()
    test_non_master_ui_files_do_not_define_visual_styles()
    test_special_desktop_web_pages_use_ui_master()
    test_master_colors_are_only_raw_registry_values()
    test_master_color_references_resolve()
    test_add_stream_modal_contract()
    print("UI master contract passed.")
