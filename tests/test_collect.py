import unittest

from kojipatch.classify import Classifier
from kojipatch.collect import collect_tag, problem_summary
from kojipatch.config import Config, GitlabHost
from kojipatch.gitlabclient import GitlabClient
from kojipatch.kojiclient import KojiClient
from tests.fakes import FakeKojiSession, FakeTransport, Response

HOST = "gitlab.example.com"
HOSTS = {HOST: GitlabHost(api="https://gitlab.example.com/api/v4",
                          web="https://gitlab.example.com")}
TREE = "https://gitlab.example.com/api/v4/projects/%s/repository/tree"

TAGGED = {"os-9.2": [
    {"build_id": 1, "name": "nginx"},
    {"build_id": 2, "name": "curl"},
    {"build_id": 3, "name": "vim"},
]}
BUILDS = {
    1: {"build_id": 1, "task_id": 11, "name": "nginx", "version": "1.24.0",
        "release": "3.el9", "epoch": None, "nvr": "nginx-1.24.0-3.el9",
        "owner_name": "builder", "completion_time": "2026-05-14 10:00:00",
        "extra": {"source": {"original_url":
                             "git+ssh://git@gitlab.example.com/g/nginx?#origin/br"}}},
    2: {"build_id": 2, "task_id": 12, "name": "curl", "version": "8.0.1",
        "release": "1.el9", "epoch": None, "nvr": "curl-8.0.1-1.el9",
        "owner_name": "builder", "completion_time": "2026-04-01 10:00:00",
        "extra": {}},
    3: {"build_id": 3, "task_id": 13, "name": "vim", "version": "9.0",
        "release": "1.el9", "epoch": 2, "nvr": "vim-9.0-1.el9",
        "owner_name": "builder", "completion_time": "2026-03-01 10:00:00",
        "extra": {"source": {"original_url":
                             "git+ssh://git@gitlab.example.com/g/vim?#origin/br"}}},
}
RPMS = {1: [{"name": "nginx", "version": "1.24.0", "release": "3.el9",
             "arch": "x86_64"}],
        2: [], 3: []}


def make_clients(routes):
    session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
    transport = FakeTransport(routes)
    gitlab = GitlabClient(HOSTS, token=None, transport=transport,
                          sleeper=lambda _s: None)
    return KojiClient(session), gitlab, transport


def config():
    return Config(koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                  gitlab_hosts=HOSTS,
                  patch_classes=[("CVE", r"CVE-\d{4}-\d{4,}"),
                                 ("SAST", r"(?i)^sast[-_]"),
                                 ("other", ".*")])


class CollectTagTest(unittest.TestCase):
    def setUp(self):
        self.routes = {
            TREE % "g%2Fnginx": Response(200, [
                {"name": "CVE-2024-7347.patch", "type": "blob",
                 "path": "PATCH/CVE-2024-7347.patch"},
                {"name": "sast-x.patch", "type": "blob",
                 "path": "PATCH/sast-x.patch"}], {}),
            TREE % "g%2Fvim": Response(404, {"message": "404 Tree Not Found"}, {}),
            # 404 Tree Not Found неоднозначен: клиент уточняет через
            # /repository/commits/<ref>, ветка должна существовать —
            # тогда это действительно "нет каталога PATCH", а не удалённая ветка.
            "https://gitlab.example.com/api/v4/projects/g%2Fvim/repository/commits/br":
                Response(200, {"id": "abc123"}, {}),
        }

    def collect(self):
        koji_client, gitlab, transport = make_clients(self.routes)
        snap = collect_tag("os-9.2", config(), koji_client, gitlab, jobs=2,
                           now="2026-08-03T13:20:00+03:00")
        return snap, transport

    def test_snapshot_header(self):
        snap, _ = self.collect()
        self.assertEqual(snap.tag, "os-9.2")
        self.assertEqual(snap.generated, "2026-08-03T13:20:00+03:00")
        self.assertEqual(snap.koji_hub, "https://hub/kojihub")
        self.assertEqual(snap.koji_web, "https://hub/koji")

    def test_builds_are_sorted_by_name(self):
        snap, _ = self.collect()
        self.assertEqual([b.name for b in snap.builds], ["curl", "nginx", "vim"])

    def test_build_fields_are_filled(self):
        snap, _ = self.collect()
        build = snap.by_name()["nginx"]
        self.assertEqual(build.nvr, "nginx-1.24.0-3.el9")
        self.assertEqual(build.task_id, 11)
        self.assertEqual(build.owner, "builder")
        self.assertEqual(build.completed, "2026-05-14")
        self.assertEqual(build.rpms, ["nginx-1.24.0-3.el9.x86_64"])

    def test_source_is_parsed_with_web_url(self):
        snap, _ = self.collect()
        source = snap.by_name()["nginx"].source
        self.assertEqual(source.project, "g/nginx")
        self.assertEqual(source.ref, "br")
        self.assertEqual(source.ref_kind, "branch")
        self.assertEqual(source.web_url,
                         "https://gitlab.example.com/g/nginx/-/tree/br")

    def test_patches_are_classified_with_links(self):
        snap, _ = self.collect()
        patches = snap.by_name()["nginx"].patches
        self.assertEqual([p.cls for p in patches], ["CVE", "SAST"])
        self.assertEqual(patches[0].cves, ["CVE-2024-7347"])
        self.assertEqual(patches[0].name, "CVE-2024-7347.patch")
        self.assertEqual(
            patches[0].web_url,
            "https://gitlab.example.com/g/nginx/-/blob/br/PATCH/CVE-2024-7347.patch")
        self.assertTrue(snap.by_name()["nginx"].patch_dir_present)

    def test_build_without_source_gets_a_problem(self):
        snap, _ = self.collect()
        build = snap.by_name()["curl"]
        self.assertIsNone(build.source)
        self.assertIsNone(build.patch_dir_present)
        self.assertEqual(build.problems, ["no source url"])

    def test_missing_patch_dir_is_not_a_problem(self):
        snap, _ = self.collect()
        build = snap.by_name()["vim"]
        self.assertIs(build.patch_dir_present, False)
        self.assertEqual(build.problems, [])
        self.assertEqual(build.patches, [])

    def test_gitlab_error_becomes_a_problem(self):
        self.routes[TREE % "g%2Fvim"] = Response(
            404, {"message": "404 Project Not Found"}, {})
        snap, _ = self.collect()
        build = snap.by_name()["vim"]
        self.assertIsNone(build.patch_dir_present)
        self.assertEqual(len(build.problems), 1)
        self.assertIn("Project Not Found", build.problems[0])

    def test_epoch_is_preserved(self):
        snap, _ = self.collect()
        self.assertEqual(snap.by_name()["vim"].epoch, 2)

    def test_progress_callback_is_called(self):
        koji_client, gitlab, _ = make_clients(self.routes)
        seen = []
        collect_tag("os-9.2", config(), koji_client, gitlab, jobs=1,
                    now="n", progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(seen[-1], (3, 3))

    def test_problem_summary_counts_by_message(self):
        snap, _ = self.collect()
        summary = problem_summary(snap)
        self.assertEqual(summary["no source url"], 1)


if __name__ == "__main__":
    unittest.main()
