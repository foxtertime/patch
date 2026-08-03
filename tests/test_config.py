import os
import re
import tempfile
import unittest

from kojipatch.config import Config, ConfigError, GitlabHost, load_config

MINIMAL = """
koji:
  hub: https://hub.example.com/kojihub
"""

FULL = """
koji:
  hub: https://hub.example.com/kojihub
  web: https://hub.example.com/koji
gitlab:
  default_host: gitlab.example.com
  token_env: MY_TOKEN
  hosts:
    gitlab.example.com:
      api: https://gitlab.example.com/api/v4
      web: https://gitlab.example.com
patch_dir: PATCHES
patch_classes:
  - { name: CVE, pattern: 'CVE-\\d{4}-\\d{4,}' }
  - { name: SAST, pattern: '(?i)^sast[-_]' }
"""


def write(text):
    fd, path = tempfile.mkstemp(suffix=".yaml")
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
    return path


class LoadConfigTest(unittest.TestCase):
    def test_minimal_config_gets_defaults(self):
        cfg = load_config(write(MINIMAL))
        self.assertEqual(cfg.koji_hub, "https://hub.example.com/kojihub")
        self.assertIsNone(cfg.koji_web)
        self.assertEqual(cfg.patch_dir, "PATCH")
        self.assertEqual(cfg.gitlab_token_env, "GITLAB_TOKEN")
        self.assertEqual(cfg.gitlab_hosts, {})

    def test_full_config_is_read(self):
        cfg = load_config(write(FULL))
        self.assertEqual(cfg.koji_web, "https://hub.example.com/koji")
        self.assertEqual(cfg.gitlab_default_host, "gitlab.example.com")
        self.assertEqual(cfg.gitlab_token_env, "MY_TOKEN")
        self.assertEqual(cfg.patch_dir, "PATCHES")
        self.assertEqual(
            cfg.gitlab_hosts["gitlab.example.com"],
            GitlabHost(api="https://gitlab.example.com/api/v4",
                       web="https://gitlab.example.com"),
        )

    def test_implicit_other_rule_is_appended(self):
        cfg = load_config(write(FULL))
        self.assertEqual(cfg.patch_classes[-1], ("other", ".*"))

    def test_explicit_catch_all_is_not_duplicated(self):
        text = FULL + "  - { name: misc, pattern: '.*' }\n"
        cfg = load_config(write(text))
        self.assertEqual(cfg.patch_classes[-1], ("misc", ".*"))
        self.assertEqual(len(cfg.patch_classes), 3)

    def test_overrides_win_over_file(self):
        cfg = load_config(write(FULL), {"koji_hub": "https://other/hub",
                                        "patch_dir": "P"})
        self.assertEqual(cfg.koji_hub, "https://other/hub")
        self.assertEqual(cfg.patch_dir, "P")

    def test_missing_hub_is_an_error(self):
        with self.assertRaises(ConfigError):
            load_config(write("gitlab: {}\n"))

    def test_bad_pattern_is_an_error(self):
        text = MINIMAL + "patch_classes:\n  - { name: X, pattern: '[' }\n"
        with self.assertRaises(ConfigError):
            load_config(write(text))

    def test_missing_file_is_an_error(self):
        with self.assertRaises(ConfigError):
            load_config("/nonexistent/kojipatch.yaml")

    def test_no_file_requires_hub_override(self):
        cfg = load_config(None, {"koji_hub": "https://only/hub"})
        self.assertEqual(cfg.koji_hub, "https://only/hub")
        self.assertIsInstance(cfg, Config)

    def test_hub_is_optional_when_not_required(self):
        # подкоманда render читает готовые снапшоты и до koji не ходит
        cfg = load_config(None, None, require_hub=False)
        self.assertEqual(cfg.koji_hub, "")
        self.assertEqual(cfg.patch_classes[-1], ("other", ".*"))

    def test_default_cve_rule_is_case_insensitive(self):
        cfg = load_config(write(MINIMAL))
        name, pattern = cfg.patch_classes[0]
        self.assertEqual(name, "CVE")
        self.assertTrue(re.compile(pattern).search("cve-2024-1234.patch"))


if __name__ == "__main__":
    unittest.main()
