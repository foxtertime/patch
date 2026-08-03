import json
import logging
import re
import unittest

from kojipatch.classify import Classifier
from kojipatch.diff import diff_chain
from kojipatch.model import Build, Patch, Snapshot, Source
from kojipatch.render import (PLACEHOLDER, build_page_data, render_html,
                              slug)

RULES = [("CVE", r"CVE-\d{4}-\d{4,}"), ("SAST", r"(?i)^sast[-_]"),
         ("DAST", r"(?i)^dast[-_]"), ("other", ".*")]


def patch(name, cls):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=[],
                 web_url="https://gl/blob/" + name)


def build(name, version="1.0", patches=(), problems=(), present=True,
          ref="main", ref_kind="branch", rpms=("a.x86_64",)):
    source = None
    if ref is not None:
        source = Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                        host="h", project="g/" + name, ref=ref,
                        ref_kind=ref_kind, web_url="https://gl/tree")
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 owner="builder", completed="2026-05-14", source=source,
                 patch_dir_present=present, patches=list(patches),
                 rpms=list(rpms), problems=list(problems))


def snap(tag, builds):
    return Snapshot(tag=tag, generated="2026-08-03T13:20:00+03:00",
                    koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                    builds=list(builds))


class PageDataTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshot = snap("os-9.2", [
            build("nginx", patches=[patch("CVE-2024-7347.patch", "CVE"),
                                    patch("sast-x.patch", "SAST")]),
            build("curl", present=False),
            build("vim", ref=None, problems=["no source url"], present=None),
        ])

    def data(self, snapshots=None, pairs=None):
        snapshots = snapshots or [self.snapshot]
        return build_page_data(snapshots, pairs or [], self.classifier)

    def test_patch_classes_come_from_classifier(self):
        self.assertEqual(self.data()["patch_classes"],
                         ["CVE", "SAST", "DAST", "other"])

    def test_snapshot_counts(self):
        counts = self.data()["snapshots"][0]["counts"]
        self.assertEqual(counts["builds"], 3)
        self.assertEqual(counts["with_patches"], 1)
        self.assertEqual(counts["without_patches"], 1)
        self.assertEqual(counts["problems"], 1)
        self.assertEqual(counts["patch_files"], 2)
        self.assertEqual(counts["by_class"]["CVE"], {"builds": 1, "files": 1})
        self.assertEqual(counts["by_class"]["DAST"], {"builds": 0, "files": 0})

    def test_builds_are_sorted_by_name(self):
        rows = self.data()["snapshots"][0]["builds"]
        self.assertEqual([r["name"] for r in rows], ["curl", "nginx", "vim"])

    def test_build_row_fields(self):
        row = self.data()["snapshots"][0]["builds"][1]  # curl, nginx, vim
        self.assertEqual(row["name"], "nginx")
        self.assertEqual(row["evr"], "1.0-1.el9")
        self.assertEqual(row["branch"], "main")
        self.assertEqual(row["patch_counts"], {"CVE": 1, "SAST": 1})
        self.assertTrue(row["koji_url"].endswith("nginx-1.0-1.el9"))

    def test_row_tags_for_patch_classes(self):
        rows = {r["name"]: r for r in self.data()["snapshots"][0]["builds"]}
        self.assertEqual(sorted(rows["nginx"]["tags"]), ["cve", "sast"])
        self.assertIn("no-patch", rows["curl"]["tags"])
        self.assertIn("no-source", rows["vim"]["tags"])

    def test_class_tag_uses_the_dashboard_slug_rule(self):
        # ключ фильтра в карточке класса считает slug() из дашборда:
        # /[^a-z0-9]+/g → '-'. Тег строки обязан считаться так же, иначе
        # карточка класса «C++» не нашла бы ни одной строки.
        classifier = Classifier([("C++", r"\.cpp$"), ("other", ".*")])
        rows = build_page_data(
            [snap("t", [build("x", patches=[patch("a.cpp", "C++")])])],
            [], classifier)["snapshots"][0]["builds"]
        self.assertIn("c-", rows[0]["tags"])

    def test_slug_matches_the_javascript_rule(self):
        for name, expected in (("CVE", "cve"), ("C++", "c-"),
                               ("Fix_it now", "fix-it-now"), ("DAST", "dast")):
            self.assertEqual(slug(name), expected, name)

    def test_gitlab_error_tag(self):
        broken = build("bad", problems=["gitlab: 403 Forbidden"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertIn("gitlab-error", rows[0]["tags"])

    def test_from_commit_tag(self):
        commit = build("c", ref="a1b2c3d", ref_kind="commit")
        rows = self.data([snap("t", [commit])])["snapshots"][0]["builds"]
        self.assertIn("from-commit", rows[0]["tags"])

    def test_internal_error_tag(self):
        broken = build("bad", problems=["internal error: boom"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertIn("internal-error", rows[0]["tags"])

    def test_gitlab_error_does_not_imply_internal_error(self):
        broken = build("bad", problems=["gitlab: 403 Forbidden"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertNotIn("internal-error", rows[0]["tags"])

    def test_pairs_are_rendered(self):
        old = snap("os-9.1", [build("nginx", "1.0"), build("gone")])
        new = snap("os-9.2", [build("nginx", "1.1"), build("fresh")])
        data = self.data([old, new], diff_chain([old, new]))
        pair = data["pairs"][0]
        self.assertEqual((pair["old"], pair["new"]), ("os-9.1", "os-9.2"))
        rows = {r["name"]: r for r in pair["rows"]}
        self.assertEqual(rows["nginx"]["old_evr"], "1.0-1.el9")
        self.assertEqual(rows["nginx"]["new_evr"], "1.1-1.el9")
        self.assertIn("upgraded", rows["nginx"]["tags"])
        self.assertEqual(rows["gone"]["status"], "removed")
        self.assertEqual(pair["counts"]["added"], 1)

    def test_summary_pair_is_marked(self):
        snaps = [snap("a", []), snap("b", []), snap("c", [])]
        data = self.data(snaps, diff_chain(snaps))
        self.assertTrue(data["pairs"][-1]["summary"])


class RenderHtmlTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshots = [snap("os-9.2", [build("nginx")])]

    def html(self, snapshots=None):
        return render_html(snapshots or self.snapshots, [], self.classifier)

    def test_no_placeholder_remains(self):
        self.assertNotIn(PLACEHOLDER, self.html())

    def test_embedded_json_parses(self):
        match = re.search(r"var DATA = (.*?);\n", self.html(), re.S)
        self.assertIsNotNone(match)
        data = json.loads(match.group(1))
        self.assertEqual(data["snapshots"][0]["tag"], "os-9.2")

    def test_script_close_tag_is_escaped(self):
        nasty = build("evil</script><script>alert(1)</script>")
        html = self.html([snap("t", [nasty])])
        self.assertNotIn("</script><script>alert(1)", html)
        self.assertIn("<\\/script>", html)

    def test_line_separators_are_escaped(self):
        # U+2028/U+2029 внутри <script> — переводы строк для JS, а JSON их
        # не экранирует: литерал развалился бы прямо по данным.
        nasty = build("evil" + chr(0x2028) + "x" + chr(0x2029) + "y")
        html = self.html([snap("t", [nasty])])
        self.assertNotIn(chr(0x2028), html)
        self.assertNotIn(chr(0x2029), html)
        self.assertIn("\\u2028", html)
        self.assertIn("\\u2029", html)
        match = re.search(r"var DATA = (.*?);\n", html, re.S)
        self.assertEqual(json.loads(match.group(1))["snapshots"][0]["tag"], "t")

    def test_html_has_both_tab_containers(self):
        html = self.html()
        self.assertIn('id="tab-state"', html)
        self.assertIn('id="tab-diff"', html)


class TemplateContractTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        old = snap("os-9.1", [build("nginx", "1.0")])
        new = snap("os-9.2", [build("nginx", "1.1",
                                    patches=[patch("CVE-2024-7347.patch", "CVE")])])
        from kojipatch.diff import diff_chain as chain
        self.html = render_html([old, new], chain([old, new]), self.classifier)

    def test_has_tab_navigation(self):
        self.assertIn('data-tab="state"', self.html)
        self.assertIn('data-tab="diff"', self.html)

    def test_has_search_and_expand_controls(self):
        self.assertIn('id="q"', self.html)
        self.assertIn('id="expand"', self.html)

    def test_has_active_filter_chip_bar(self):
        self.assertIn('id="chips"', self.html)

    def test_has_copy_nvr_button(self):
        self.assertIn('id="copy-nvr"', self.html)

    def test_reuses_ref_html_css_variables(self):
        for name in ("--bg", "--fg", "--muted", "--line", "--card",
                     "--accent", "--added", "--removed", "--hit"):
            self.assertIn(name, self.html, name)

    def test_supports_dark_theme(self):
        self.assertIn("prefers-color-scheme: dark", self.html)

    def test_diff_tab_starts_filtered_to_changed_rows(self):
        # обещание спеки и README: «Изменения» открываются на изменившихся
        self.assertIn("diff: { 'changed': 1 }", self.html)

    def test_search_is_debounced(self):
        self.assertIn("SEARCH_DELAY", self.html)

    def test_pair_lives_in_the_hash_by_tag_names(self):
        self.assertIn("function pairKey(", self.html)
        self.assertNotIn("'pair=' + st.pair", self.html)

    def test_version_sort_is_documented_as_lexicographic(self):
        self.assertIn("Сортировка лексикографическая", self.html)

    def test_tooltip_container_present(self):
        self.assertIn('id="tip"', self.html)

    def test_no_external_resources(self):
        for marker in ("<script src=", "<link rel=\"stylesheet\"", "https://cdn",
                       "@import"):
            self.assertNotIn(marker, self.html, marker)


class LoggingTest(unittest.TestCase):
    def test_page_size_is_logged_at_debug(self):
        classifier = Classifier(RULES)
        old = snap("os-9.1", [build("nginx", "1.0")])
        new = snap("os-9.2", [build("nginx", "1.1")])
        from kojipatch.diff import diff_chain as chain
        with self.assertLogs("kojipatch", level="DEBUG") as caught:
            render_html([old, new], chain([old, new]), classifier)
        line = "\n".join(caught.output)
        self.assertIn("kojipatch.render", line)
        self.assertIn("kojipatch.diff", line)


if __name__ == "__main__":
    unittest.main()
