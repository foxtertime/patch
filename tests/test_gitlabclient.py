import unittest

from kojipatch.config import GitlabHost
from kojipatch.gitlabclient import GitlabClient
from tests.fakes import FakeTransport, Response

HOSTS = {"gitlab.example.com": GitlabHost(api="https://gitlab.example.com/api/v4",
                                          web="https://gitlab.example.com")}
TREE_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/tree"
COMMITS_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/commits/br"

TWO_FILES = Response(200, [
    {"id": "1", "name": "CVE-2024-7347.patch", "type": "blob",
     "path": "PATCH/CVE-2024-7347.patch"},
    {"id": "2", "name": "sub", "type": "tree", "path": "PATCH/sub"},
    {"id": "3", "name": "sast-x.patch", "type": "blob",
     "path": "PATCH/sub/sast-x.patch"},
], {})


def client(routes, **kwargs):
    transport = FakeTransport(routes)
    return GitlabClient(HOSTS, token="t", transport=transport,
                        sleeper=lambda _s: None, **kwargs), transport


class PatchFilesTest(unittest.TestCase):
    def test_blobs_are_returned_trees_are_not(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(result.paths,
                         ["PATCH/CVE-2024-7347.patch", "PATCH/sub/sast-x.patch"])
        self.assertIsNone(result.problem)

    def test_project_is_url_encoded_and_params_are_set(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "feat/x")
        url, params, headers = transport.requests[0]
        self.assertEqual(url, TREE_URL)
        self.assertEqual(params["ref"], "feat/x")
        self.assertEqual(params["path"], "PATCH")
        self.assertTrue(params["recursive"])
        self.assertEqual(headers["PRIVATE-TOKEN"], "t")

    def test_tree_not_found_means_no_patch_dir(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertEqual(result.paths, [])
        self.assertIsNone(result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_missing_ref_after_tree_not_found_is_a_problem(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(404, {"message": "404 Commit Not Found"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("ref not found", result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_disambiguation_failure_is_a_problem_not_a_missing_ref(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(403, {"message": "403 Forbidden"}, {}),
        })
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("403", result.problem)
        self.assertNotIn("ref not found", result.problem)
        self.assertEqual(len(transport.requests), 2)

    def test_missing_tree_disambiguation_is_memoized(self):
        cli, transport = client({
            TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS_URL: Response(200, {"id": "abc123"}, {}),
        })
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 2)

    def test_project_not_found_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(404, {"message": "404 Project Not Found"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("project", result.problem.lower())

    def test_unknown_host_is_a_problem(self):
        cli, _ = client({})
        result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("unknown host", result.problem)

    def test_forbidden_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(403, {"message": "403 Forbidden"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("403", result.problem)

    def test_pagination_follows_next_page(self):
        page1 = Response(200, [{"id": "1", "name": "a.patch", "type": "blob",
                                "path": "PATCH/a.patch"}], {"x-next-page": "2"})
        page2 = Response(200, [{"id": "2", "name": "b.patch", "type": "blob",
                                "path": "PATCH/b.patch"}], {"x-next-page": ""})
        cli, transport = client({TREE_URL: [page1, page2]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(result.paths, ["PATCH/a.patch", "PATCH/b.patch"])
        self.assertEqual(transport.requests[1][1]["page"], "2")

    def test_retries_on_429_then_succeeds(self):
        cli, transport = client({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                            TWO_FILES]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(len(transport.requests), 2)

    def test_gives_up_after_retries(self):
        cli, transport = client({TREE_URL: Response(500, {}, {})}, retries=3)
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("500", result.problem)
        self.assertEqual(len(transport.requests), 3)

    def test_same_triple_is_requested_once(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 1)

    def test_different_ref_is_requested_again(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "other")
        self.assertEqual(len(transport.requests), 2)

    def test_missing_ref_is_a_problem(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", None)
        self.assertIsNone(result.present)
        self.assertIn("ref", result.problem)


class UrlTest(unittest.TestCase):
    def test_tree_and_blob_urls(self):
        cli, _ = client({})
        self.assertEqual(cli.tree_url("gitlab.example.com", "g/r", "feat/x"),
                         "https://gitlab.example.com/g/r/-/tree/feat/x")
        self.assertEqual(
            cli.blob_url("gitlab.example.com", "g/r", "br", "PATCH/a.patch"),
            "https://gitlab.example.com/g/r/-/blob/br/PATCH/a.patch")

    def test_urls_are_none_for_unknown_host(self):
        cli, _ = client({})
        self.assertIsNone(cli.tree_url("nope", "g/r", "br"))


if __name__ == "__main__":
    unittest.main()
