"""Contract and failure-mode checks for the brand research file generator."""

import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / ".agents" / "skills" / "brand-research"
SCRIPT = SKILL / "scripts" / "build_harness.py"
SPEC = importlib.util.spec_from_file_location("build_harness", SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)
EXAMPLE = json.loads((SKILL / "examples" / "research.json").read_text(encoding="utf-8"))


class BrandHarnessTests(unittest.TestCase):
    def setUp(self):
        self.data = copy.deepcopy(EXAMPLE)

    def test_cli_creates_four_consistent_files(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "ブランド 出力"
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(SKILL / "examples" / "research.json"), "--out", str(target)],
                capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual({p.name for p in target.iterdir()}, {"BRAND.md", "brand.json", "tokens.css", "sources.md"})
            self.assertEqual(json.loads((target / "brand.json").read_text()), self.data)
            brand = (target / "BRAND.md").read_text()
            sources = (target / "sources.md").read_text()
            self.assertIn("推定・提案", brand)
            self.assertIn("未確認", brand)
            self.assertIn("実調査ではありません", brand)
            for source in self.data["sources"]:
                self.assertIn(f"sources.md#{source['id']}", brand)
                self.assertIn(f"## {source['id']}", sources)
                self.assertIn(source["url"], sources)

    def test_css_uses_only_official_or_observed_tokens(self):
        css = BUILDER.render_css(BUILDER.validate(self.data))
        self.assertIn("--brand-color-primary: #174E45;", css)
        self.assertIn('--brand-font-body: "Noto Sans JP", sans-serif;', css)
        self.assertNotIn("--brand-color-accent", css)
        self.assertNotIn("#E6BB68", css)

    def test_existing_outputs_and_symlinks_are_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            output = base / "brand"
            output.mkdir()
            marker = output / "BRAND.md"
            marker.write_text("user content")
            alias = base / "alias"
            alias.symlink_to(output, target_is_directory=True)
            dangling = base / "dangling"
            dangling.symlink_to(base / "missing", target_is_directory=True)
            for target in (output, marker, alias, dangling):
                with self.subTest(target=target), self.assertRaises(FileExistsError):
                    BUILDER.write_harness(self.data, target)
            self.assertEqual(marker.read_text(), "user content")
            self.assertFalse((base / "missing").exists())

    def test_invalid_research_never_creates_output(self):
        self.data["colors"][0]["source_ids"] = ["missing-source"]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "brand"
            with self.assertRaises(BUILDER.InvalidResearch):
                BUILDER.write_harness(self.data, output)
            self.assertFalse(output.exists())

    def test_official_claim_needs_official_evidence(self):
        self.data["sources"][0]["kind"] = "third_party"
        with self.assertRaisesRegex(BUILDER.InvalidResearch, "公式の出典"):
            BUILDER.validate(self.data)

    def test_unknown_cannot_contain_a_guessed_value(self):
        self.data["logos"][0]["value"] = "https://example.com/logo.svg"
        with self.assertRaisesRegex(BUILDER.InvalidResearch, "unknown"):
            BUILDER.validate(self.data)

    def test_empty_research_is_partial_and_has_no_css_defaults(self):
        self.data["company"]["website"] = None
        self.data["sources"] = []
        for section in BUILDER.SECTIONS:
            self.data[section] = []
        BUILDER.validate(self.data)
        self.assertNotIn("--brand-", BUILDER.render_css(self.data))
        self.assertIn("確認済みの出典はありません", BUILDER.render_sources(self.data))
        self.data["research"]["status"] = "complete"
        self.data["research"]["limitations"] = []
        with self.assertRaises(BUILDER.InvalidResearch):
            BUILDER.validate(self.data)

    def test_complete_research_requires_all_categories_and_no_unknowns(self):
        self.data["logos"][0].update(value="https://example.com/logo.svg", status="official", source_ids=["demo-guide"])
        self.data["research"] = {"status": "complete", "limitations": []}
        BUILDER.validate(self.data)
        self.data["rules"] = []
        with self.assertRaises(BUILDER.InvalidResearch):
            BUILDER.validate(self.data)

    def test_css_injection_and_invalid_colors_are_rejected(self):
        changes = [
            ("colors", "value", "red; background: url(https://example.com)"),
            ("colors", "token", "x; color: red"),
            ("typography", "value", ['Example"; color: red; /*']),
            ("typography", "value", ["Example\nFont"]),
        ]
        for section, key, value in changes:
            with self.subTest(value=value):
                data = copy.deepcopy(self.data)
                data[section][0][key] = value
                with self.assertRaises(BUILDER.InvalidResearch):
                    BUILDER.validate(data)

    def test_unsafe_source_urls_are_rejected(self):
        for url in ("javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "https://example.com:bad", "https://exa mple.com"):
            with self.subTest(url=url):
                self.data["sources"][0]["url"] = url
                with self.assertRaises(BUILDER.InvalidResearch):
                    BUILDER.validate(self.data)

    def test_duplicate_source_ids_and_tokens_are_rejected(self):
        for field in ("sources", "colors"):
            with self.subTest(field=field):
                data = copy.deepcopy(self.data)
                data[field].append(copy.deepcopy(data[field][0]))
                with self.assertRaises(BUILDER.InvalidResearch):
                    BUILDER.validate(data)

    def test_bad_shapes_are_validation_errors_not_tracebacks(self):
        changes = [("colors", None), ("company", []), ("sources", {}), ("researched_at", "2026-11-03")]
        for key, value in changes:
            with self.subTest(key=key):
                data = copy.deepcopy(self.data)
                data[key] = value
                with self.assertRaises(BUILDER.InvalidResearch):
                    BUILDER.validate(data)
        self.data["colors"][0]["status"] = []
        with self.assertRaises(BUILDER.InvalidResearch):
            BUILDER.validate(self.data)

    def test_markdown_cannot_embed_active_html_or_links_from_notes(self):
        self.data["voice"][0]["note"] = '<script>alert(1)</script>\n[click](javascript:alert(1))'
        brand = BUILDER.render_brand(BUILDER.validate(self.data))
        self.assertNotIn("<script>", brand)
        self.assertNotIn("[click](javascript:", brand)

    def test_check_cli_and_duplicate_json_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "research.json"
            for contents, expected in ((json.dumps(self.data), 0), ('{"schema_version":"1.0","schema_version":"2.0"}', 2)):
                with self.subTest(expected=expected):
                    path.write_text(contents)
                    result = subprocess.run([sys.executable, str(SCRIPT), str(path), "--check"], capture_output=True, text=True)
                    self.assertEqual(result.returncode, expected, result.stderr)
                    self.assertNotIn("Traceback", result.stderr)
                    self.assertEqual([p.name for p in Path(directory).iterdir()], ["research.json"])


if __name__ == "__main__":
    unittest.main()
