import io
import logging
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from kojipatch import cli, kojiclient
from kojipatch.cli import main
from kojipatch.gitlabclient import GitlabClient
from kojipatch.kojiclient import KojiClient
from kojipatch.model import (Build, Patch, Snapshot, Source, dump_snapshots,
                             load_snapshots)
from tests.fakes import FakeKojiSession, FakeTransport, Response

# Фикстуры снапшотов — зафиксированный контракт формата и вход тестов.
# Писать в них нельзя: перезапись прятала бы регрессию сериализации вместо
# того, чтобы её показать. Всё, что тесту нужно записать, уходит во временный
# каталог.
FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")
SNAP_91 = os.path.join(FIXTURES, "snapshot-os-9.1.json")
SNAP_92 = os.path.join(FIXTURES, "snapshot-os-9.2.json")


def patch(name, cls="CVE"):
    return Patch(path="PATCH/" + name, name=name, cls=cls,
                 cves=[name.split(".")[0]] if cls == "CVE" else [],
                 web_url="https://gl/blob/" + name)


def build(name, version, patches=(), subpackages=None, ref="main"):
    subpackages = [name] if subpackages is None else subpackages
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 owner="builder", completed="2026-05-14",
                 source=Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                               host="h", project="g/" + name, ref=ref,
                               ref_kind="branch", web_url="https://gl/tree"),
                 patch_dir_present=True, patches=list(patches),
                 rpms=["%s-%s-1.el9.x86_64" % (sub, version)
                       for sub in subpackages],
                 problems=[])


class LoggerStateMixin:
    """Возврат логгера пакета в исходное состояние после прогона CLI.

    main() зовёт logs.configure(): на логгере kojipatch остаётся хендлер с
    уже никому не нужным потоком и propagate=False. Само по себе это
    безвредно, но следующий тест, который пишет в лог мимо assertLogs,
    молча потерял бы свои строки. Восстановление вешаем через addCleanup,
    а не через tearDown: наследники его переопределяют, не вызывая super.
    """

    def setUp(self):
        super().setUp()
        logger = logging.getLogger("kojipatch")
        state = (list(logger.handlers), logger.level, logger.propagate)
        self.addCleanup(self._restore_logger, logger, state)

    @staticmethod
    def _restore_logger(logger, state):
        handlers, level, propagate = state
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
        for handler in handlers:
            logger.addHandler(handler)
        logger.setLevel(level)
        logger.propagate = propagate


class TempDirTest(LoggerStateMixin, unittest.TestCase):
    """Общий временный каталог: ничего не пишем в дерево исходников."""

    def setUp(self):
        super().setUp()
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def out_path(self, name="out.html"):
        return os.path.join(self.tmp, name)

    def run_cli(self, argv):
        """Прогон CLI с перехватом stderr: вывод тестов должен быть чистым."""
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(argv)
        return code, err.getvalue()


class CliRenderTest(TempDirTest):
    def test_render_two_snapshots(self):
        out = self.out_path()
        code, _ = self.run_cli(["render", SNAP_91, SNAP_92, "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            html = handle.read()
        self.assertIn("os-9.1", html)
        self.assertIn("os-9.2", html)
        self.assertNotIn("/*__DATA__*/", html)

    def test_render_single_snapshot_has_no_pairs(self):
        out = self.out_path()
        code, _ = self.run_cli(["render", SNAP_91, "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            self.assertIn('"pairs": []', handle.read().replace("\n", " ")
                          .replace('"pairs":[]', '"pairs": []'))

    def test_render_of_missing_file_is_fatal(self):
        code, err = self.run_cli(["render", "/nonexistent.json",
                                  "-o", self.out_path()])
        self.assertEqual(code, 2)
        self.assertIn("снапшот", err)

    def test_bad_config_is_fatal(self):
        code, _ = self.run_cli(["--config", "/nonexistent.yaml", "collect",
                                "--tag", "t"])
        self.assertEqual(code, 2)

    def test_malformed_config_section_is_fatal_without_traceback(self):
        path = os.path.join(self.tmp, "bad.yaml")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("koji: notadict\n")
        code, err = self.run_cli(["--config", path, "collect", "--tag", "t"])
        self.assertEqual(code, 2)
        self.assertTrue(err.strip())
        self.assertNotIn("Traceback", err)

    def test_help_lists_subcommands(self):
        out = io.StringIO()
        with redirect_stdout(out):
            with self.assertRaises(SystemExit):
                main(["--help"])
        text = out.getvalue()
        for word in ("collect", "render", "run"):
            self.assertIn(word, text)


class LogLevelTest(LoggerStateMixin, unittest.TestCase):
    def out_path(self):
        fd, path = tempfile.mkstemp(suffix=".html")
        os.close(fd)
        return path

    def snapshots(self):
        return [os.path.join(FIXTURES, "snapshot-os-9.1.json"),
                os.path.join(FIXTURES, "snapshot-os-9.2.json")]

    def test_written_file_is_logged_at_info(self):
        out = self.out_path()
        with self.assertLogs("kojipatch.cli", level="INFO") as caught:
            code = main(["render"] + self.snapshots() + ["-o", out])
        self.assertEqual(code, 0)
        self.assertIn(out, "\n".join(caught.output))

    def test_fatal_error_is_logged_at_error(self):
        with self.assertLogs("kojipatch.cli", level="ERROR") as caught:
            code = main(["render", "/nonexistent.json", "-o", self.out_path()])
        self.assertEqual(code, 2)
        self.assertIn("снапшот", "\n".join(caught.output).lower())

    def test_error_carries_a_traceback_record_at_debug(self):
        # пользователю — одна строка, разработчику — трейсбек, но только
        # когда он его попросил уровнем
        with self.assertLogs("kojipatch.cli", level="DEBUG") as caught:
            main(["--config", "/nonexistent.yaml", "collect", "--tag", "t"])
        self.assertIn(logging.ERROR, [r.levelno for r in caught.records])
        with_traceback = [r for r in caught.records
                          if r.levelno == logging.DEBUG and r.exc_info]
        self.assertTrue(with_traceback, caught.output)

    def test_error_alone_has_no_traceback_record(self):
        with self.assertLogs("kojipatch.cli", level="ERROR") as caught:
            main(["--config", "/nonexistent.yaml", "collect", "--tag", "t"])
        for record in caught.records:
            self.assertIsNone(record.exc_info)

    def test_snapshot_error_is_named_in_the_error_line(self):
        # «cli: ошибка: ...» не говорит ничего, в отличие от соседних
        # «ошибка конфига» и «ошибка ввода-вывода»
        with self.assertLogs("kojipatch.cli", level="ERROR") as caught:
            main(["render", "/nonexistent.json", "-o", self.out_path()])
        self.assertIn("ошибка снапшота", "\n".join(caught.output))

    def test_unknown_level_is_rejected_by_argparse(self):
        err = io.StringIO()
        with redirect_stderr(err):
            with self.assertRaises(SystemExit):
                main(["--log-level", "loud", "render", "x.json"])
        self.assertIn("--log-level", err.getvalue())

    def test_verbose_flag_is_gone(self):
        err = io.StringIO()
        with redirect_stderr(err):
            with self.assertRaises(SystemExit):
                main(["-v", "render", "x.json"])
        self.assertIn("unrecognized", err.getvalue())

    def test_help_mentions_log_level(self):
        out = io.StringIO()
        with redirect_stdout(out):
            with self.assertRaises(SystemExit):
                main(["--help"])
        self.assertIn("--log-level", out.getvalue())


class SnapshotFixtureTest(unittest.TestCase):
    """Фикстуры читаются как есть — ими же кормится демонстрационный рендер."""

    def snapshot(self, path):
        snaps = load_snapshots(path)
        self.assertEqual(len(snaps), 1)
        return snaps[0]

    def test_old_fixture_loads(self):
        snap = self.snapshot(SNAP_91)
        self.assertEqual(snap.tag, "os-9.1")
        self.assertEqual(sorted(b.name for b in snap.builds),
                         ["gone", "nginx"])

    def test_new_fixture_loads(self):
        snap = self.snapshot(SNAP_92)
        self.assertEqual(snap.tag, "os-9.2")
        self.assertEqual(sorted(b.name for b in snap.builds),
                         ["fresh", "nginx"])

    def test_fixture_rpms_look_like_koji_output(self):
        nginx = self.snapshot(SNAP_92).by_name()["nginx"]
        self.assertEqual(nginx.rpms, ["nginx-1.25.0-1.el9.x86_64",
                                      "nginx-core-1.25.0-1.el9.x86_64"])

    def test_fixture_patches_are_classified(self):
        nginx = self.snapshot(SNAP_92).by_name()["nginx"]
        self.assertEqual([(p.name, p.cls) for p in nginx.patches],
                         [("CVE-2024-7347.patch", "CVE"),
                          ("sast-x.patch", "SAST")])


class SnapshotRoundTripTest(TempDirTest):
    """Запись снапшота проверяем во временном каталоге, а не в фикстурах."""

    def test_dump_and_load_preserve_the_snapshot(self):
        snapshot = Snapshot(tag="os-9.3", generated="2026-09-01T00:00:00+03:00",
                            koji_hub="https://hub/kojihub",
                            koji_web="https://hub/koji",
                            builds=[build("nginx", "1.26.0",
                                          [patch("CVE-2024-7347.patch")],
                                          subpackages=["nginx", "nginx-core"])])
        path = os.path.join(self.tmp, "snapshot.json")
        dump_snapshots([snapshot], path)
        loaded = load_snapshots(path)[0]
        self.assertEqual(loaded.tag, "os-9.3")
        self.assertEqual([b.to_dict() for b in loaded.builds],
                         [b.to_dict() for b in snapshot.builds])


# ---- сквозные прогоны collect/run против фейков koji и GitLab ----

HUB = "https://hub/kojihub"
GITLAB_API = "https://gitlab.example.com/api/v4"
TREE = GITLAB_API + "/projects/%s/repository/tree"

TAGGED = {"os-9.2": [{"build_id": 1, "name": "nginx"},
                     {"build_id": 2, "name": "curl"}]}
DETAILS = {
    1: {"build_id": 1, "task_id": 11, "name": "nginx", "version": "1.25.0",
        "release": "1.el9", "epoch": None, "nvr": "nginx-1.25.0-1.el9",
        "owner_name": "builder", "completion_time": "2026-05-14 10:00:00",
        "extra": {"source": {"original_url":
                             "git+ssh://git@gitlab.example.com/g/nginx?#origin/br"}}},
    # у curl нет original_url — это штатная «проблема» билда
    2: {"build_id": 2, "task_id": 12, "name": "curl", "version": "8.0.1",
        "release": "1.el9", "epoch": None, "nvr": "curl-8.0.1-1.el9",
        "owner_name": "builder", "completion_time": "2026-04-01 10:00:00",
        "extra": {}},
}
RPMS = {1: [{"name": "nginx", "version": "1.25.0", "release": "1.el9",
             "arch": "x86_64"}],
        2: [{"name": "curl", "version": "8.0.1", "release": "1.el9",
             "arch": "x86_64"}]}
ROUTES = {TREE % "g%2Fnginx": Response(200, [
    {"name": "CVE-2024-7347.patch", "type": "blob",
     "path": "PATCH/CVE-2024-7347.patch"}], {})}


class RunCommandTest(TempDirTest):
    """kojiclient.connect и GitlabClient подменяются присваиванием в модуль:
    внешней библиотеки моков в проекте нет, а сети в тестах быть не должно."""

    def setUp(self):
        super().setUp()
        self.session = FakeKojiSession(tagged=TAGGED, builds=DETAILS, rpms=RPMS)
        self.transport = FakeTransport(ROUTES)
        self._connect = kojiclient.connect
        self._gitlab = cli.GitlabClient
        kojiclient.connect = self.fake_connect
        cli.GitlabClient = self.fake_gitlab

    def tearDown(self):
        kojiclient.connect = self._connect
        cli.GitlabClient = self._gitlab

    def fake_connect(self, hub, batch=100):
        self.assertEqual(hub, HUB)
        return KojiClient(self.session, batch=batch)

    def fake_gitlab(self, hosts, token=None, patch_dir="PATCH",
                    default_host=None):
        return GitlabClient(hosts, token=token, patch_dir=patch_dir,
                            default_host=default_host,
                            transport=self.transport, sleeper=lambda _s: None)

    def argv(self, *rest):
        return ["--koji-hub", HUB, "--gitlab-api", GITLAB_API,
                "--jobs", "1"] + list(rest)

    def test_run_writes_html_and_returns_zero(self):
        out = self.out_path()
        code, err = self.run_cli(self.argv("run", "--tag", "os-9.2", "-o", out))
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            html = handle.read()
        self.assertIn("os-9.2", html)
        self.assertIn("nginx-1.25.0-1.el9", html)
        self.assertIn("CVE-2024-7347.patch", html)
        self.assertNotIn("/*__DATA__*/", html)
        self.assertIn("os-9.2", err)
        self.assertIn("2 билдов, 1 проблемных", err)

    def test_run_returns_one_when_problems_exceed_the_limit(self):
        code, err = self.run_cli(self.argv("run", "--tag", "os-9.2",
                                           "-o", self.out_path()))
        self.assertEqual(code, 0)
        code, err = self.run_cli(
            ["--max-problems", "0"] + self.argv("run", "--tag", "os-9.2",
                                                "-o", self.out_path()))
        self.assertEqual(code, 1)
        self.assertIn("проблемных билдов 1 > 0", err)

    def test_problem_limit_is_not_exceeded_when_equal(self):
        code, _ = self.run_cli(
            ["--max-problems", "1"] + self.argv("run", "--tag", "os-9.2",
                                                "-o", self.out_path()))
        self.assertEqual(code, 0)

    def test_run_saves_a_loadable_snapshot(self):
        path = os.path.join(self.tmp, "snap.json")
        code, _ = self.run_cli(self.argv("run", "--tag", "os-9.2",
                                         "-o", self.out_path(),
                                         "--save-snapshots", path))
        self.assertEqual(code, 0)
        snaps = load_snapshots(path)
        self.assertEqual(snaps[0].tag, "os-9.2")
        nginx = snaps[0].by_name()["nginx"]
        self.assertEqual(nginx.rpms, ["nginx-1.25.0-1.el9.x86_64"])
        self.assertEqual([p.name for p in nginx.patches],
                         ["CVE-2024-7347.patch"])
        self.assertEqual(snaps[0].by_name()["curl"].problems, ["no source url"])

    def test_collect_writes_a_snapshot_without_html(self):
        path = os.path.join(self.tmp, "collected.json")
        code, err = self.run_cli(self.argv("collect", "--tag", "os-9.2",
                                           "-o", path))
        self.assertEqual(code, 0)
        self.assertEqual(load_snapshots(path)[0].tag, "os-9.2")
        self.assertIn(path, err)

    def test_unknown_tag_is_fatal(self):
        code, err = self.run_cli(self.argv("run", "--tag", "нет-такого",
                                           "-o", self.out_path()))
        self.assertEqual(code, 2)
        self.assertIn("нет-такого", err)


class LoggerIsolationTest(unittest.TestCase):
    def test_a_cli_test_leaves_the_package_logger_as_it_found_it(self):
        # прогоняем настоящий тест целиком, вместе с его setUp и уборкой,
        # и смотрим на глобальное состояние после: если восстановление
        # пропадёт, этот тест упадёт
        logger = logging.getLogger("kojipatch")
        before = (list(logger.handlers), logger.level, logger.propagate)
        case = CliRenderTest("test_render_two_snapshots")
        result = unittest.TestResult()
        case.run(result)
        self.assertEqual(result.errors + result.failures, [])
        self.assertEqual((list(logger.handlers), logger.level,
                          logger.propagate), before)


if __name__ == "__main__":
    unittest.main()
