import io
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from kojipatch.cli import main
from kojipatch.model import (Build, Patch, Snapshot, Source, dump_snapshots,
                             load_snapshots)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def patch(name, cls="CVE"):
    return Patch(path="PATCH/" + name, name=name, cls=cls,
                 cves=[name.split(".")[0]] if cls == "CVE" else [],
                 web_url="https://gl/blob/" + name)


def build(name, version, patches=(), rpms=("a.x86_64",), ref="main"):
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 owner="builder", completed="2026-05-14",
                 source=Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                               host="h", project="g/" + name, ref=ref,
                               ref_kind="branch", web_url="https://gl/tree"),
                 patch_dir_present=True, patches=list(patches),
                 rpms=list(rpms), problems=[])


class CliRenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.makedirs(FIXTURES, exist_ok=True)
        old = Snapshot(tag="os-9.1", generated="2026-07-01T00:00:00+03:00",
                       koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                       builds=[build("nginx", "1.24.0",
                                     [patch("CVE-2024-7347.patch")]),
                               build("gone", "1.0")])
        new = Snapshot(tag="os-9.2", generated="2026-08-01T00:00:00+03:00",
                       koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                       builds=[build("nginx", "1.25.0",
                                     [patch("CVE-2024-7347.patch"),
                                      patch("sast-x.patch", "SAST")],
                                     ref="br-9.2"),
                               build("fresh", "2.0")])
        dump_snapshots([old], os.path.join(FIXTURES, "snapshot-os-9.1.json"))
        dump_snapshots([new], os.path.join(FIXTURES, "snapshot-os-9.2.json"))

    def out_path(self):
        fd, path = tempfile.mkstemp(suffix=".html")
        os.close(fd)
        return path

    def test_render_two_snapshots(self):
        out = self.out_path()
        code = main(["render",
                     os.path.join(FIXTURES, "snapshot-os-9.1.json"),
                     os.path.join(FIXTURES, "snapshot-os-9.2.json"),
                     "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            html = handle.read()
        self.assertIn("os-9.1", html)
        self.assertIn("os-9.2", html)
        self.assertNotIn("/*__DATA__*/", html)

    def test_render_single_snapshot_has_no_pairs(self):
        out = self.out_path()
        code = main(["render", os.path.join(FIXTURES, "snapshot-os-9.1.json"),
                     "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            self.assertIn('"pairs": []', handle.read().replace("\n", " ")
                          .replace('"pairs":[]', '"pairs": []'))

    def test_render_of_missing_file_is_fatal(self):
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(["render", "/nonexistent.json", "-o", self.out_path()])
        self.assertEqual(code, 2)
        self.assertIn("снапшот", err.getvalue())

    def test_bad_config_is_fatal(self):
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(["--config", "/nonexistent.yaml", "collect",
                         "--tag", "t"])
        self.assertEqual(code, 2)

    def test_malformed_config_section_is_fatal_without_traceback(self):
        fd, path = tempfile.mkstemp(suffix=".yaml")
        with os.fdopen(fd, "w") as handle:
            handle.write("koji: notadict\n")
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(["--config", path, "collect", "--tag", "t"])
        self.assertEqual(code, 2)
        text = err.getvalue()
        self.assertTrue(text.strip())
        self.assertNotIn("Traceback", text)

    def test_help_lists_subcommands(self):
        out = io.StringIO()
        with redirect_stdout(out):
            with self.assertRaises(SystemExit):
                main(["--help"])
        text = out.getvalue()
        for word in ("collect", "render", "run"):
            self.assertIn(word, text)


class SnapshotRoundTripTest(unittest.TestCase):
    def test_fixture_snapshots_load(self):
        snaps = load_snapshots(os.path.join(FIXTURES, "snapshot-os-9.2.json"))
        self.assertEqual(snaps[0].tag, "os-9.2")
        self.assertEqual(len(snaps[0].builds), 2)


if __name__ == "__main__":
    unittest.main()
