from services.tools import get_style_guide_section, run_linter, run_security_scan


def test_run_linter_python_flags_unused_import():
    code = "import os\n\ndef add(a, b):\n    return a + b\n"
    result = run_linter("python", code)
    assert result["supported"] is True
    codes = [issue["code"] for issue in result["issues"]]
    assert "F401" in codes  # unused import


def test_run_linter_clean_code_has_no_issues():
    code = "def add(a, b):\n    return a + b\n"
    result = run_linter("python", code)
    assert result["supported"] is True
    assert result["issues"] == []


def test_run_linter_unsupported_language():
    result = run_linter("cobol", "IDENTIFICATION DIVISION.")
    assert result["supported"] is False


def test_run_security_scan_flags_eval():
    code = "def run(user_input):\n    return eval(user_input)\n"
    result = run_security_scan("python", code)
    assert result["supported"] is True
    test_ids = [f["testId"] for f in result["findings"]]
    assert "B307" in test_ids  # bandit: use of eval


def test_get_style_guide_section_known_topic():
    result = get_style_guide_section("naming")
    assert result["found"] is True
    assert "content" in result


def test_get_style_guide_section_unknown_topic():
    result = get_style_guide_section("quantum-computing")
    assert result["found"] is False
