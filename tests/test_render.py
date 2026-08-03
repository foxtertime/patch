import json
import re
import unittest

from kojipatch.classify import Classifier
from kojipatch.diff import diff_chain
from kojipatch.model import Build, Patch, Snapshot, Source
from kojipatch.render import PLACEHOLDER, build_page_data, render_html

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

    def test_html_has_both_tab_containers(self):
        html = self.html()
        self.assertIn('id="tab-state"', html)
        self.assertIn('id="tab-diff"', html)


if __name__ == "__main__":
    unittest.main()
