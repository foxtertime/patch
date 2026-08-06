import os
import re
import tempfile
import unittest

from dashboard.classify import CVE_RE, Classifier, find_cves
from dashboard.config import Config, ConfigError, GitlabHost, load_config

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
            load_config("/nonexistent/dashboard.yaml")

    def test_koji_section_must_be_a_mapping(self):
        with self.assertRaises(ConfigError):
            load_config(write("koji: notadict\n"))

    def test_gitlab_section_must_be_a_mapping(self):
        with self.assertRaises(ConfigError):
            load_config(write(MINIMAL + "gitlab: [1, 2]\n"))

    def test_no_file_requires_hub_override(self):
        cfg = load_config(None, {"koji_hub": "https://only/hub"})
        self.assertEqual(cfg.koji_hub, "https://only/hub")
        self.assertIsInstance(cfg, Config)

    def test_hub_is_optional_when_not_required(self):
        # подкоманда dashboard пуста при старте и до koji не ходит
        cfg = load_config(None, None, require_hub=False)
        self.assertEqual(cfg.koji_hub, "")
        self.assertEqual(cfg.patch_classes[-1], ("other", ".*"))

    def cve_rule(self, cfg):
        # ищем по имени, а не по позиции: порядок правил меняется по мере
        # появления новых классов, и тесты не должны на него опираться
        return dict(cfg.patch_classes)["CVE"]

    def test_default_cve_rule_is_case_insensitive(self):
        pattern = self.cve_rule(load_config(write(MINIMAL)))
        self.assertTrue(re.compile(pattern).search("cve-2024-1234.patch"))

    def test_default_cve_rule_comes_from_classify(self):
        # выражение для CVE в проекте одно: правило по умолчанию — это
        # ровно CVE_RE, иначе конфиг и классификатор разъехались бы
        pattern = self.cve_rule(load_config(write(MINIMAL)))
        self.assertEqual(pattern, "(?i)" + CVE_RE.pattern)
        self.assertEqual(re.compile(pattern).findall("CVE-2024-1234"),
                         CVE_RE.findall("CVE-2024-1234"))


class DefaultRulesOnRealNamesTest(unittest.TestCase):
    """Правила по умолчанию на именах файлов, как их называют в PATCH."""

    def setUp(self):
        self.classifier = Classifier.from_config(load_config(write(MINIMAL)))

    def test_autogen_index_files(self):
        for name in ("autogen-sast-patches.inc.new",
                     "autogen-cve-patches.inc.new",
                     "autogen-fuzz-patches.inc.new"):
            self.assertEqual(self.classifier.classify(name), "AUTOGEN", name)

    def test_autogen_wins_over_the_marker_inside_its_name(self):
        # ради этого правило и стоит первым: в именах есть sast и fuzz, и без
        # него сгенерированные списки накручивали бы счётчики SAST и DAST
        self.assertNotEqual(
            self.classifier.classify("autogen-sast-patches.inc.new"), "SAST")
        self.assertNotEqual(
            self.classifier.classify("autogen-fuzz-patches.inc.new"), "DAST")

    def test_autogen_wins_even_over_cve(self):
        # автосписок остаётся автосписком, даже если в имени полный CVE-ID:
        # это не исправление, а перечень исправлений
        self.assertEqual(
            self.classifier.classify("autogen-cve-2024-42516-patches.inc.new"),
            "AUTOGEN")

    def test_autogen_is_anchored_to_the_start(self):
        # «autogen» в середине имени — обычный патч, а не сгенерированный
        # список: правило не должно съедать такие имена
        self.assertEqual(
            self.classifier.classify("httpd-autogen-fix.patch.new"), "other")

    def test_cve_id_in_the_middle_of_the_name(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-cve-2024-42516.patch.new"),
            "CVE")

    def test_cve_id_is_extracted_from_such_a_name(self):
        self.assertEqual(find_cves("httpd-2.4.62-cve-2024-42516.patch.new"),
                         ["CVE-2024-42516"])

    def test_sast_at_the_start(self):
        self.assertEqual(
            self.classifier.classify("SAST-src.core.ngx_file.c.patch.new"),
            "SAST")

    def test_sast_in_the_middle(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-sast-src.core.c.patch.new"),
            "SAST")

    def test_dast_in_the_middle(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-dast-scan.patch.new"),
            "DAST")

    def test_fuzz_goes_to_dast(self):
        # фаззинг — то же динамическое тестирование, отдельной категорией
        # он бы только дробил отчёт
        self.assertEqual(self.classifier.classify("FUZZ-parser.patch.new"),
                         "DAST")

    def test_fuzz_lowercase_and_in_the_middle(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-fuzz-parser.patch.new"),
            "DAST")

    def test_cve_still_wins_over_fuzz(self):
        self.assertEqual(
            self.classifier.classify("fuzz-cve-2024-42516.patch.new"), "CVE")

    def test_coverage(self):
        self.assertEqual(self.classifier.classify("COVERAGE-parser.patch.new"),
                         "COVERAGE")

    def test_coverage_lowercase_and_in_the_middle(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-coverage-src.c.patch.new"),
            "COVERAGE")

    def test_cve_still_wins_over_coverage(self):
        self.assertEqual(
            self.classifier.classify("coverage-cve-2024-42516.patch.new"),
            "CVE")

    def test_sast_after_an_underscore(self):
        self.assertEqual(self.classifier.classify("httpd_sast_fix.patch.new"),
                         "SAST")

    def test_cve_wins_over_sast_in_one_name(self):
        # порядок правил: CVE стоит первым, и имя с обоими маркерами
        # должно попасть в CVE — иначе уедет в отчёт не той категорией
        self.assertEqual(
            self.classifier.classify("sast-cve-2024-42516-fix.patch.new"),
            "CVE")

    def test_distsuffix_patch(self):
        self.assertEqual(self.classifier.classify("nginx-distsuffix.patch"),
                         "DISTSUFFIX")

    def test_distsuffix_with_the_new_tail(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-distsuffix.patch.new"),
            "DISTSUFFIX")

    def test_distsuffix_wins_over_spec(self):
        # Правит такой патч и правда спек, но затем, чтобы переклеить
        # суффикс сборки: класс отвечает на вопрос «зачем патч».
        self.assertEqual(
            self.classifier.classify("kernel.spec.distsuffix.patch"),
            "DISTSUFFIX")

    def test_distsuffix_needs_the_patch_extension(self):
        # «distsuffix» без .patch — не тот файл: так называют и включаемые
        # куски спека, и переменные внутри них
        self.assertEqual(self.classifier.classify("distsuffix.inc"), "other")

    def test_cve_still_wins_over_distsuffix(self):
        self.assertEqual(
            self.classifier.classify("cve-2024-42516-distsuffix.patch"), "CVE")

    def test_license_patch(self):
        self.assertEqual(self.classifier.classify("nginx-license.patch"),
                         "LICENSE")

    def test_license_marker_anywhere_in_the_name(self):
        # Расширения правило не требует: файл с «license» в имени, лежащий
        # в каталоге патчей, про лицензию и есть — патч это, текст или
        # список.
        for name in ("LICENSE", "LICENSE.txt", "add-license-header.patch.new",
                     "chromium-licence.patch"):
            self.assertEqual(self.classifier.classify(name), "LICENSE", name)

    def test_license_wins_over_spec(self):
        # Правит такой патч поле License в спеке, но затем, чтобы
        # разобраться с лицензией: класс отвечает на вопрос «зачем патч».
        self.assertEqual(
            self.classifier.classify("nginx.spec.license.patch"), "LICENSE")

    def test_cve_still_wins_over_license(self):
        self.assertEqual(
            self.classifier.classify("cve-2024-42516-license.patch"), "CVE")

    def test_spec_patch(self):
        self.assertEqual(self.classifier.classify("nginx.spec.patch"), "SPEC")

    def test_spec_marker_in_the_middle_of_a_longer_name(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62.spec.patch.new"), "SPEC")

    def test_spec_needs_the_dots(self):
        # «spec» внутри слова — не спек-патч: иначе туда уехали бы
        # specfile-*, respec-* и прочие имена с этими буквами
        self.assertEqual(self.classifier.classify("nginx-respec-fix.patch"),
                         "other")
        self.assertEqual(self.classifier.classify("specialcase.patch"),
                         "other")

    def test_tarball_is_a_file_not_a_patch(self):
        self.assertEqual(self.classifier.classify("nginx-1.24.0.tar.gz"),
                         "FILES")

    def test_tarball_with_the_projects_new_suffix(self):
        # в каталоге встречается соглашение *.new — архив с ним тоже архив
        self.assertEqual(self.classifier.classify("nginx-1.24.0.tar.gz.new"),
                         "FILES")

    def test_tar_without_gz_is_not_matched_yet(self):
        # категория заведена под tar.gz; остальные расширения добавляются
        # в это же правило по мере того, как встречаются
        self.assertEqual(self.classifier.classify("nginx-1.24.0.tar"), "other")

    def test_cve_still_wins_over_files(self):
        self.assertEqual(
            self.classifier.classify("cve-2024-42516-sources.tar.gz"), "CVE")

    def test_changelog(self):
        self.assertEqual(self.classifier.classify("changelog.yaml"),
                         "CHANGELOG")

    def test_changelog_with_a_component_prefix(self):
        self.assertEqual(self.classifier.classify("nginx-changelog.yaml"),
                         "CHANGELOG")

    def test_changelog_in_the_short_yaml_spelling(self):
        self.assertEqual(self.classifier.classify("changelog.yml"), "CHANGELOG")

    def test_changelog_needs_the_yaml_extension(self):
        # просто «changelog» без расширения — не тот файл, о котором речь
        self.assertEqual(self.classifier.classify("changelog.patch"), "other")

    def test_cve_wins_over_spec(self):
        # спек-патч, закрывающий CVE, — прежде всего CVE: класс отвечает на
        # вопрос «зачем патч», а не «какой файл он правит»
        self.assertEqual(
            self.classifier.classify("httpd-cve-2024-42516.spec.patch"), "CVE")

    def test_plain_patch_is_other(self):
        self.assertEqual(
            self.classifier.classify("httpd-2.4.62-fix-build.patch.new"),
            "other")


class TokenTest(unittest.TestCase):
    """Токен из окружения. Пробелы по краям — не косметика: requests
    отказывается отправлять такой заголовок и кладёт ЗНАЧЕНИЕ заголовка в
    текст исключения, а тот уходит в лог, в проблемы билда, в снапшот и в
    HTML."""

    ENV = "DASHBOARD_TEST_TOKEN"

    def setUp(self):
        os.environ.pop(self.ENV, None)
        self.addCleanup(os.environ.pop, self.ENV, None)
        self.cfg = Config(koji_hub="https://hub/kojihub",
                          gitlab_token_env=self.ENV)

    def test_token_is_read_from_the_environment(self):
        os.environ[self.ENV] = "glpat-t0ken"
        self.assertEqual(self.cfg.token(), "glpat-t0ken")

    def test_trailing_newline_is_stripped(self):
        # классическое GITLAB_TOKEN=$(cat token.txt)
        os.environ[self.ENV] = "glpat-t0ken\n"
        self.assertEqual(self.cfg.token(), "glpat-t0ken")

    def test_surrounding_whitespace_is_stripped(self):
        # копипаста из вебморды приносит пробелы и с той, и с другой стороны
        os.environ[self.ENV] = "  glpat-t0ken \r\n"
        self.assertEqual(self.cfg.token(), "glpat-t0ken")

    def test_whitespace_only_value_is_none(self):
        # пустого токена в заголовке быть не должно: это тот же «токена нет»
        os.environ[self.ENV] = " \n\t "
        self.assertIsNone(self.cfg.token())

    def test_empty_value_is_none(self):
        os.environ[self.ENV] = ""
        self.assertIsNone(self.cfg.token())

    def test_unset_variable_is_none(self):
        self.assertIsNone(self.cfg.token())


if __name__ == "__main__":
    unittest.main()
