"""Демонстрационные снапшоты.

Фикстуры rich-*.json лежат в репозитории готовыми: их кладут на страницу
руками и смотрят глазами. Именно поэтому за ними некому следить — ни один
тест их не читал, кроме rich-old.json и rich-new.json, из которых порождён
эталон паритета. Набор, который никто не проверяет, беднеет незаметно:
случай, ради которого файл заведён, исчезает при первой же правке, а узнают
об этом через полгода и на живом теге.

Здесь проверяется две вещи: что файлы читаются, и что в них осталось то,
ради чего каждый из них добавлен.
"""
import importlib.util
import json
import os
import unittest

from dashboard.model import load_snapshots

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "fixtures")


def generator():
    """Генератор фикстур модулем.

    Он лежит рядом с фикстурами, а не в пакете тестов: это скрипт, который
    запускают руками. Пакетом tests.fixtures каталог не объявлен, поэтому
    обычный import сюда не дотянется.
    """
    path = os.path.join(FIXTURES, "make_rich_fixtures.py")
    spec = importlib.util.spec_from_file_location("make_rich_fixtures", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def snapshot(name):
    snapshots = load_snapshots(os.path.join(FIXTURES, name))
    assert len(snapshots) == 1, name
    return snapshots[0]


def marks_of(build, tag):
    """Метки строки так, как их считает страница, — коротким пересказом.

    Полное правило живёт в viewmodel.js, и переносить его сюда целиком
    незачем: тесту нужно знать, что интересный случай в фикстуре есть, а не
    как страница его рисует.
    """
    marks = set(p.cls.lower() for p in build.patches)
    if build.tag_name != tag:
        marks.add("inherited")
    if build.source is None:
        marks.add("no-source")
    elif build.source.ref_kind == "commit":
        marks.add("from-commit")
    elif build.source.ref_kind == "srpm":
        marks.add("from-srpm")
    if build.patch_dir_present is False:
        marks.add("no-patch")
    if build.source is not None and build.source.commits_ahead:
        marks.add("branch-ahead")
    for problem in build.problems:
        if problem.startswith("gitlab:") or problem.startswith("bad source"):
            marks.add("gitlab-error")
        if problem.startswith("internal error"):
            marks.add("internal-error")
    return marks


NAMES = ["rich-old.json", "rich-new.json", "rich-newer.json",
         "rich-newest.json", "rich-again.json", "rich-mirror.json",
         "rich-wide.json", "rich-many.json",
         "rich-legacy.json", "rich-drift.json", "rich-caught-up.json"]

# Цепочка одного тега про коммит сборки, в порядке съёмки.
DRIFT_CHAIN = ["rich-legacy.json", "rich-drift.json", "rich-caught-up.json"]


class ReadableTest(unittest.TestCase):
    def test_every_fixture_loads(self):
        for name in NAMES:
            self.assertTrue(snapshot(name).builds, name)

    def test_generator_writes_exactly_what_is_committed(self):
        # Фикстуру правят генератором, а не руками: иначе скрипт рядом с
        # ней врёт о том, что в ней лежит. Версия записавшего в сравнении не
        # участвует — она меняется от выпуска к выпуску сама, и файл честно
        # называет тот, при котором появился.
        module = generator()
        for name, build in module.FILES:
            with open(os.path.join(FIXTURES, name), encoding="utf-8") as fh:
                stored = json.load(fh)
            fresh = [module.snapshot_to_dict(build())]
            self.assertEqual(module.bare(stored), module.bare(fresh),
                             "%s разошёлся с генератором" % name)


class InterestingCasesTest(unittest.TestCase):
    """Каждый файл добавлен ради случая, которого нет в остальных."""

    def test_the_same_tag_is_collected_twice(self):
        first = snapshot("rich-newest.json")
        again = snapshot("rich-again.json")
        self.assertEqual(first.tag, again.tag)
        self.assertNotEqual(first.generated, again.generated)

    def test_a_component_is_rebuilt_by_another_owner_after_a_move(self):
        old = snapshot("rich-newest.json").by_name()["httpd"]
        new = snapshot("rich-again.json").by_name()["httpd"]
        self.assertNotEqual(old.owner, new.owner)
        self.assertNotEqual(old.source.project, new.source.project)
        # Ветка та же: карточка должна показать переезд проекта, но не
        # выставить метку «сменилась ветка».
        self.assertEqual(old.source.ref, new.source.ref)

    def test_a_component_is_rebuilt_from_a_plain_srpm(self):
        # Собрать можно и не из git. У такого билда нет ни ветки, ни
        # каталога PATCH — и это не проблема, а другой способ сборки:
        # в problems ничего не уезжает.
        again = snapshot("rich-again.json")
        build = again.by_name()["zlib"]
        self.assertEqual(build.source.ref_kind, "srpm")
        self.assertIsNone(build.source.project)
        self.assertIsNone(build.patch_dir_present)
        self.assertEqual(build.problems, [])
        self.assertIn("from-srpm", marks_of(build, again.tag))
        # На прежнем конце тот же компонент собран из ветки: пара
        # «ветка → srpm» и есть то, ради чего случай заведён.
        before = snapshot("rich-newest.json").by_name()["zlib"]
        self.assertEqual(before.source.ref_kind, "branch")

    def test_a_build_without_an_owner(self):
        build = snapshot("rich-again.json").by_name()["openssl"]
        self.assertIsNone(build.owner)
        self.assertIsNone(build.completed)

    def test_the_mirror_snapshot_comes_from_another_hub(self):
        others = [snapshot(name).koji_hub for name in NAMES
                  if name != "rich-mirror.json"]
        self.assertNotIn(snapshot("rich-mirror.json").koji_hub, others)

    def test_the_wide_snapshot_carries_a_row_that_breaks_the_table(self):
        wide = snapshot("rich-wide.json")
        build = wide.by_name()["chromium"]
        marks = marks_of(build, wide.tag)
        # Все классы патчей разом, обе ошибки и наследование: полтора
        # десятка меток в одной ячейке — ровно то, ради чего им разрешили
        # переноситься.
        for cls in wide.patch_classes:
            self.assertIn(cls.lower(), marks, cls)
        self.assertIn("gitlab-error", marks)
        self.assertIn("internal-error", marks)
        self.assertIn("inherited", marks)
        self.assertIn("from-commit", marks)
        # Сорокасимвольный хеш коммита и длинный путь проекта — на них
        # колонка источника и разъезжалась.
        self.assertEqual(len(build.source.ref), 40)
        self.assertGreater(len(build.source.project), 30)
        self.assertGreater(len(build.rpms), 15)

    def test_the_big_snapshot_is_the_size_of_a_real_tag(self):
        many = snapshot("rich-many.json")
        self.assertGreater(len(many.builds), 100)
        # Сотня одинаковых строк не показала бы ничего: случаи расставлены
        # по кругу, и каждый в этой сотне встречается.
        marks = set()
        for build in many.builds:
            marks |= marks_of(build, many.tag)
        for key in ("inherited", "no-source", "from-commit", "no-patch",
                    "gitlab-error", "internal-error"):
            self.assertIn(key, marks, key)


class DriftChainTest(unittest.TestCase):
    """Три снапшота одного тега про коммит сборки.

    Каждый по отдельности показывает своё состояние, а вместе они —
    единственное место в наборе, где видно движение: ghost-патч перестаёт
    быть ghost, потому что билд пересобрали.
    """

    def test_the_chain_is_one_tag_at_three_moments(self):
        tags = set(snapshot(name).tag for name in DRIFT_CHAIN)
        self.assertEqual(len(tags), 1)
        stamps = [snapshot(name).generated for name in DRIFT_CHAIN]
        self.assertEqual(stamps, sorted(stamps))
        self.assertEqual(len(set(stamps)), 3)

    def test_legacy_carries_none_of_the_new_fields(self):
        # Так выглядит файл, записанный до 2.2.0: страница обязана открыть
        # его без единой ошибки, а рядом с соседями по цепочке — поднять
        # предупреждение о двух видах.
        legacy = snapshot("rich-legacy.json")
        for build in legacy.builds:
            self.assertIsNone(build.patches_ref, build.name)
            self.assertEqual(build.ghost_patches, [], build.name)
            self.assertIsNone(build.source.commit, build.name)
            self.assertIsNone(build.source.commits_ahead, build.name)

    def test_the_lie_the_work_was_about_is_visible_in_the_pair(self):
        # В legacy патчи сняты с вершины ветки, и CVE-2026-3011 стоит у
        # билда как свой. В drift тот же файл — ghost стороны branch: он
        # в ветке есть, а в пакет не вошёл. Ровно то расхождение, ради
        # которого всё затевалось, и увидеть его можно только в паре.
        was = snapshot("rich-legacy.json").by_name()["nginx"]
        now = snapshot("rich-drift.json").by_name()["nginx"]
        self.assertIn("CVE-2026-3011.patch", [p.name for p in was.patches])
        self.assertNotIn("CVE-2026-3011.patch", [p.name for p in now.patches])
        self.assertEqual([(p.name, p.ghost) for p in now.ghost_patches
                          if p.ghost == "branch"],
                         [("CVE-2026-3011.patch", "branch")])

    def test_drift_shows_every_ghost_side_and_the_quiet_case(self):
        drift = snapshot("rich-drift.json")
        sides = set(p.ghost for b in drift.builds for p in b.ghost_patches)
        self.assertEqual(sides, {"branch", "changed", "build"})
        # Бейдж без секции: ветка ушла, а каталога PATCH не касалась.
        openssl = drift.by_name()["openssl"]
        self.assertEqual(openssl.source.commits_ahead, 7)
        self.assertEqual(openssl.ghost_patches, [])
        # Обратного в наборе нет и быть не должно: ghost без отставания
        # не бывает — второе дерево читают только когда ветка ушла.
        for build in drift.builds:
            if build.ghost_patches:
                self.assertTrue(build.source.commits_ahead, build.name)
        # Спокойная строка, на фоне которой остальные и читаются.
        python3 = drift.by_name()["python3"]
        self.assertEqual(python3.source.commits_ahead, 0)
        self.assertNotIn("branch-ahead", marks_of(python3, drift.tag))

    def test_drift_holds_both_kinds_of_build_at_once(self):
        # Предупреждение о двух видах поднимается и на одном файле: у curl
        # хеша нет вовсе и патчи сняты с ветки, у соседей — с коммита.
        drift = snapshot("rich-drift.json")
        curl = drift.by_name()["curl"]
        self.assertIsNone(curl.source.commit)
        self.assertEqual(curl.patches_ref, curl.source.ref)
        self.assertEqual(curl.problems, [])
        nginx = drift.by_name()["nginx"]
        self.assertNotEqual(nginx.patches_ref, nginx.source.ref)

    def test_drift_has_a_pinned_build_and_a_vanished_commit(self):
        drift = snapshot("rich-drift.json")
        # Собран прямо с коммита: ветки нет, сравнивать не с чем — и
        # «снятым с ветки» такой билд считать нельзя.
        zlib = drift.by_name()["zlib"]
        self.assertEqual(zlib.source.ref_kind, "commit")
        self.assertEqual(zlib.patches_ref, zlib.source.commit)
        self.assertIsNone(zlib.source.commits_ahead)
        self.assertIn("from-commit", marks_of(zlib, drift.tag))
        # Коммит пропал: патчи сняты с ветки, и об этом сказано вслух.
        glibc = drift.by_name()["glibc"]
        self.assertEqual(glibc.patches_ref, glibc.source.ref)
        self.assertIsNotNone(glibc.source.commit)
        self.assertTrue(any("недоступен" in p for p in glibc.problems))

    def test_catching_up_turns_a_ghost_into_a_patch(self):
        before = snapshot("rich-drift.json").by_name()
        after = snapshot("rich-caught-up.json").by_name()
        # nginx пересобрали: ghost стал патчем билда, ghost не осталось.
        self.assertIn("CVE-2026-3011.patch",
                      [p.name for p in before["nginx"].ghost_patches])
        self.assertIn("CVE-2026-3011.patch",
                      [p.name for p in after["nginx"].patches])
        self.assertEqual(after["nginx"].ghost_patches, [])
        self.assertNotEqual(before["nginx"].nvr, after["nginx"].nvr)
        # httpd тоже: сторона build исчерпана вместе с пересборкой.
        self.assertEqual(after["httpd"].ghost_patches, [])
        # glibc пересобрали с живого коммита — проблема ушла.
        self.assertEqual(after["glibc"].problems, [])

    def test_catching_up_also_lets_drift_accumulate(self):
        before = snapshot("rich-drift.json").by_name()
        after = snapshot("rich-caught-up.json").by_name()
        # openssl не трогали, и ветка ушла ещё дальше.
        self.assertEqual(before["openssl"].nvr, after["openssl"].nvr)
        self.assertGreater(after["openssl"].source.commits_ahead,
                           before["openssl"].source.commits_ahead)
        # А спокойная прежде строка обзавелась несобранным CVE.
        self.assertEqual(before["python3"].ghost_patches, [])
        self.assertEqual([(p.name, p.ghost)
                          for p in after["python3"].ghost_patches],
                         [("CVE-2026-3030.patch", "branch")])


if __name__ == "__main__":
    unittest.main()
