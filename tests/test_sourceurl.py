import unittest

from dashboard.sourceurl import SourceUrlError, parse_source_url

SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"


class ParseSourceUrlTest(unittest.TestCase):
    def test_ssh_with_query_and_origin_prefix(self):
        got = parse_source_url("git+ssh://git@gitlab.example.com/group/repo?#origin/br-9.2")
        self.assertEqual(got.host, "gitlab.example.com")
        self.assertEqual(got.project, "group/repo")
        self.assertEqual(got.ref, "br-9.2")
        self.assertEqual(got.ref_kind, "branch")

    def test_https_with_dot_git_suffix(self):
        got = parse_source_url("git+https://gitlab.example.com/group/repo.git#br")
        self.assertEqual(got.project, "group/repo")
        self.assertEqual(got.ref, "br")

    def test_nested_subgroups_and_slash_in_branch(self):
        got = parse_source_url(
            "git+ssh://git@h.example/g/sub/deep/repo?#origin/feat/x/y")
        self.assertEqual(got.project, "g/sub/deep/repo")
        self.assertEqual(got.ref, "feat/x/y")
        self.assertEqual(got.ref_kind, "branch")

    def test_commit_sha_is_marked(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#" + SHA)
        self.assertEqual(got.ref, SHA)
        self.assertEqual(got.ref_kind, "commit")

    def test_short_sha_is_marked_as_commit(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#a1b2c3d")
        self.assertEqual(got.ref_kind, "commit")

    def test_no_fragment_means_no_ref(self):
        got = parse_source_url("git+ssh://git@h.example/g/r")
        self.assertIsNone(got.ref)
        self.assertEqual(got.ref_kind, "none")

    def test_port_is_stripped_from_host(self):
        got = parse_source_url("git+ssh://git@h.example:2222/g/r?#origin/br")
        self.assertEqual(got.host, "h.example")

    def test_branch_named_origin_something_keeps_suffix_only_once(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#origin/origin-fix")
        self.assertEqual(got.ref, "origin-fix")

    def test_garbage_raises(self):
        for bad in ["", "   ", "not a url", "git+ssh://", "git+ssh://host-only"]:
            with self.assertRaises(SourceUrlError, msg=bad):
                parse_source_url(bad)

    def test_none_raises(self):
        with self.assertRaises(SourceUrlError):
            parse_source_url(None)


if __name__ == "__main__":
    unittest.main()
