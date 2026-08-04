import unittest

from kojipatch.diff import align_rpms, diff_chain, diff_snapshots
from kojipatch.model import Build, Patch, Snapshot, Source
from kojipatch.rpms import arch_of


def nvra(sub, version, release, arch="x86_64"):
    """RPM в том же виде, в каком его отдаёт koji: name-version-release.arch."""
    return "%s-%s-%s.%s" % (sub, version, release, arch)


def build(name, version="1.0", release="1.el9", patches=(), rpms=(),
          ref="main", epoch=None, subpackages=None, tag_name=None):
    # подпакеты задаём именами, а NVRA собираем из версии билда — так же,
    # как это делает koji: иначе тест сравнивал бы то, чего в жизни нет.
    if subpackages is not None:
        rpms = [nvra(sub, version, release) for sub in subpackages]
    return Build(nvr="%s-%s-%s" % (name, version, release), name=name,
                 version=version, release=release, epoch=epoch,
                 tag_name=tag_name,
                 source=Source(raw="r", host="h", project="g/" + name, ref=ref,
                               ref_kind="branch"),
                 patch_dir_present=True,
                 patches=[Patch(path="PATCH/" + p, name=p,
                                cls="CVE" if p.startswith("CVE") else "other",
                                cves=[]) for p in patches],
                 rpms=list(rpms), problems=[])


def snap(tag, builds):
    return Snapshot(tag=tag, generated="g", koji_hub="h", koji_web=None,
                    builds=list(builds))


class StatusTest(unittest.TestCase):
    def diff_of(self, old_builds, new_builds):
        pair = diff_snapshots(snap("a", old_builds), snap("b", new_builds))
        return {c.name: c for c in pair.components}

    def test_added(self):
        got = self.diff_of([], [build("nginx")])
        self.assertEqual(got["nginx"].status, "added")
        self.assertIsNone(got["nginx"].old)

    def test_removed(self):
        got = self.diff_of([build("nginx")], [])
        self.assertEqual(got["nginx"].status, "removed")
        self.assertIsNone(got["nginx"].new)

    def test_unchanged(self):
        got = self.diff_of([build("nginx")], [build("nginx")])
        self.assertEqual(got["nginx"].status, "unchanged")

    def test_upgraded(self):
        got = self.diff_of([build("nginx", "1.0")], [build("nginx", "1.1")])
        self.assertEqual(got["nginx"].status, "upgraded")

    def test_downgraded(self):
        got = self.diff_of([build("nginx", "1.1")], [build("nginx", "1.0")])
        self.assertEqual(got["nginx"].status, "downgraded")

    def test_release_only_change_is_an_upgrade(self):
        got = self.diff_of([build("nginx", "1.0", "1.el9")],
                           [build("nginx", "1.0", "2.el9")])
        self.assertEqual(got["nginx"].status, "upgraded")

    def test_epoch_dominates(self):
        got = self.diff_of([build("nginx", "9.0", epoch=None)],
                           [build("nginx", "1.0", epoch=1)])
        self.assertEqual(got["nginx"].status, "upgraded")


class DetailsTest(unittest.TestCase):
    def diff_of(self, old_builds, new_builds):
        pair = diff_snapshots(snap("a", old_builds), snap("b", new_builds))
        return {c.name: c for c in pair.components}

    def test_patch_delta(self):
        got = self.diff_of(
            [build("nginx", patches=["CVE-2024-1111.patch", "old.patch"])],
            [build("nginx", patches=["CVE-2024-1111.patch", "new.patch"])])
        component = got["nginx"]
        self.assertEqual(component.patches_added, ["PATCH/new.patch"])
        self.assertEqual(component.patches_removed, ["PATCH/old.patch"])

    def test_rpm_delta_sets_repackaged(self):
        got = self.diff_of(
            [build("nginx", subpackages=["nginx", "nginx-mod"])],
            [build("nginx", subpackages=["nginx", "nginx-core"])])
        component = got["nginx"]
        self.assertEqual(component.rpms_added,
                         ["nginx-core-1.0-1.el9.x86_64"])
        self.assertEqual(component.rpms_removed,
                         ["nginx-mod-1.0-1.el9.x86_64"])
        self.assertTrue(component.repackaged)

    def test_version_bump_alone_is_not_repackaged(self):
        # чистая пересборка: подпакеты те же, поехала только версия
        got = self.diff_of(
            [build("nginx", "1.24.0", subpackages=["nginx", "nginx-core"])],
            [build("nginx", "1.25.0", subpackages=["nginx", "nginx-core"])])
        component = got["nginx"]
        self.assertEqual(component.status, "upgraded")
        self.assertFalse(component.repackaged)
        self.assertEqual(component.rpms_added, [])
        self.assertEqual(component.rpms_removed, [])

    def test_new_subpackage_on_a_version_bump_is_repackaged(self):
        got = self.diff_of(
            [build("nginx", "1.24.0", subpackages=["nginx", "nginx-core"])],
            [build("nginx", "1.25.0",
                   subpackages=["nginx", "nginx-core", "nginx-mod-mail"])])
        component = got["nginx"]
        self.assertTrue(component.repackaged)
        # наружу отдаём полный NVRA — по нему дашборд красит строку «стало»
        self.assertEqual(component.rpms_added,
                         ["nginx-mod-mail-1.25.0-1.el9.x86_64"])
        self.assertEqual(component.rpms_removed, [])

    def test_release_only_bump_is_not_repackaged(self):
        got = self.diff_of(
            [build("nginx", "1.24.0", "1.el9", subpackages=["nginx"])],
            [build("nginx", "1.24.0", "2.el9", subpackages=["nginx"])])
        self.assertFalse(got["nginx"].repackaged)

    def test_arch_change_is_repackaged(self):
        got = self.diff_of(
            [build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "x86_64")])],
            [build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "aarch64")])])
        self.assertTrue(got["nginx"].repackaged)

    def test_branch_change_is_flagged(self):
        got = self.diff_of([build("nginx", ref="br-9.1")],
                           [build("nginx", ref="br-9.2")])
        self.assertTrue(got["nginx"].branch_changed)

    def test_same_branch_is_not_flagged(self):
        got = self.diff_of([build("nginx")], [build("nginx")])
        self.assertFalse(got["nginx"].branch_changed)

    def test_changed_returns_a_bool_not_a_list(self):
        got = self.diff_of([build("nginx", patches=["a.patch"])],
                           [build("nginx", patches=["a.patch", "b.patch"])])
        self.assertIs(got["nginx"].changed(), True)

    def test_added_component_has_no_deltas(self):
        got = self.diff_of([], [build("nginx", patches=["a.patch"])])
        self.assertEqual(got["nginx"].patches_added, [])
        self.assertFalse(got["nginx"].repackaged)


class TagChangedTest(unittest.TestCase):
    """Переезд билда между тегами. Сравнивается сам tag_name, а не
    «прямой/унаследованный»: последнее зависит от того, какой тег мы сейчас
    рассматриваем, и меняется само собой при обычном наследовании."""

    def diff_of(self, old_tag, old_builds, new_tag, new_builds):
        pair = diff_snapshots(snap(old_tag, old_builds), snap(new_tag, new_builds))
        return {c.name: c for c in pair.components}

    def test_retagged_directly_into_the_new_tag(self):
        got = self.diff_of("os-9.1", [build("nginx", tag_name="os-9-base")],
                           "os-9.2", [build("nginx", tag_name="os-9.2")])
        self.assertTrue(got["nginx"].tag_changed)

    def test_same_tag_on_both_sides_is_not_a_change(self):
        got = self.diff_of("os-9.1", [build("nginx", tag_name="os-9-base")],
                           "os-9.2", [build("nginx", tag_name="os-9-base")])
        self.assertFalse(got["nginx"].tag_changed)

    def test_plain_inheritance_of_the_older_tag_is_not_a_change(self):
        # os-9.2 наследует os-9.1: нетронутый билд в старом снапшоте прямой,
        # в новом — унаследованный, но сам он никуда не переезжал, и
        # помечать такое переездом значило бы пометить полтега
        got = self.diff_of("os-9.1", [build("nginx", tag_name="os-9.1")],
                           "os-9.2", [build("nginx", tag_name="os-9.1")])
        self.assertFalse(got["nginx"].tag_changed)

    def test_a_new_version_in_a_new_tag_is_not_a_move(self):
        # обновлённый компонент — это другой билд, и лежать в новом теге для
        # него нормально. Пометить такое переездом значило бы поставить
        # метку каждому обновлению в теге
        got = self.diff_of("os-9.1", [build("nginx", "1.0", tag_name="os-9.1")],
                           "os-9.2", [build("nginx", "1.1", tag_name="os-9.2")])
        self.assertEqual(got["nginx"].status, "upgraded")
        self.assertFalse(got["nginx"].tag_changed)

    def test_unknown_tag_on_either_side_is_not_a_change(self):
        # снапшот прежней версии: сказать нечего, и выдумывать нельзя
        got = self.diff_of("os-9.1", [build("nginx", tag_name=None)],
                           "os-9.2", [build("nginx", tag_name="os-9.2")])
        self.assertFalse(got["nginx"].tag_changed)

    def test_tag_change_alone_makes_the_component_changed(self):
        got = self.diff_of("os-9.1", [build("nginx", tag_name="os-9-base")],
                           "os-9.2", [build("nginx", tag_name="os-9.2")])
        self.assertIs(got["nginx"].changed(), True)

    def test_counts_have_a_bucket(self):
        pair = diff_snapshots(
            snap("os-9.1", [build("nginx", tag_name="os-9-base"),
                            build("curl", tag_name="os-9-base")]),
            snap("os-9.2", [build("nginx", tag_name="os-9.2"),
                            build("curl", tag_name="os-9-base")]))
        self.assertEqual(pair.counts["tag_changed"], 1)


class AlignRpmsTest(unittest.TestCase):
    """Строки «было/стало» для подпакетов: один подпакет — одна строка."""

    def test_same_subpackage_stands_opposite_itself(self):
        # версия билда поехала, NVRA слева и справа разные — но это один и
        # тот же подпакет, и он обязан стоять на одной высоте
        rows = align_rpms(build("nginx", "1.24.0", subpackages=["nginx"]),
                          build("nginx", "1.25.0", subpackages=["nginx"]))
        self.assertEqual(rows, [["nginx-1.24.0-1.el9.x86_64",
                                 "nginx-1.25.0-1.el9.x86_64"]])

    def test_disappeared_subpackage_keeps_its_place(self):
        rows = align_rpms(
            build("nginx", subpackages=["nginx", "nginx-mod"]),
            build("nginx", subpackages=["nginx"]))
        self.assertEqual(rows, [["nginx-1.0-1.el9.x86_64",
                                 "nginx-1.0-1.el9.x86_64"],
                                ["nginx-mod-1.0-1.el9.x86_64", None]])

    def test_new_subpackage_goes_to_the_bottom(self):
        # «aaa» встал бы первым по алфавиту, но пришедшее место
        # существующих строк не сдвигает — иначе поедет выравнивание
        rows = align_rpms(
            build("nginx", subpackages=["nginx"]),
            build("nginx", subpackages=["aaa-tool", "nginx"]))
        self.assertEqual(rows, [["nginx-1.0-1.el9.x86_64",
                                 "nginx-1.0-1.el9.x86_64"],
                                [None, "aaa-tool-1.0-1.el9.x86_64"]])

    def test_left_column_is_sorted(self):
        rows = align_rpms(build("nginx", subpackages=["zzz", "aaa", "mmm"]),
                          build("nginx", subpackages=["zzz", "aaa", "mmm"]))
        self.assertEqual([row[0].split("-1.0-")[0] for row in rows],
                         ["aaa", "mmm", "zzz"])

    def test_component_without_an_old_build(self):
        rows = align_rpms(None, build("nginx", subpackages=["nginx"]))
        self.assertEqual(rows, [[None, "nginx-1.0-1.el9.x86_64"]])

    def test_component_without_a_new_build(self):
        rows = align_rpms(build("nginx", subpackages=["nginx"]), None)
        self.assertEqual(rows, [["nginx-1.0-1.el9.x86_64", None]])

    def test_no_builds_at_all(self):
        self.assertEqual(align_rpms(None, None), [])

    def test_arch_split_is_two_rows(self):
        # один и тот же name в двух архитектурах — разные ключи, разные
        # строки: иначе aarch64 «превратился бы» в x86_64
        rows = align_rpms(
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "aarch64"),
                                 nvra("nginx", "1.0", "1.el9", "x86_64")]),
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "x86_64")]))
        self.assertEqual(rows, [["nginx-1.0-1.el9.aarch64", None],
                                ["nginx-1.0-1.el9.x86_64",
                                 "nginx-1.0-1.el9.x86_64"]])

    def test_rows_come_grouped_by_arch(self):
        # дашборд рисует группы, просто разрезая строки по смене
        # архитектуры, — значит порядок обязан задавать этот код
        both = [nvra("nginx", "1.0", "1.el9", "x86_64"),
                nvra("nginx", "1.0", "1.el9", "src"),
                nvra("nginx-doc", "1.0", "1.el9", "noarch")]
        rows = align_rpms(build("nginx", rpms=both), build("nginx", rpms=both))
        self.assertEqual([arch_of(row[0]) for row in rows],
                         ["src", "noarch", "x86_64"])

    def test_new_subpackage_goes_to_the_bottom_of_its_own_arch(self):
        # «вниз списка» — вниз своей группы, иначе пакет уедет под чужой
        # заголовок архитектуры
        rows = align_rpms(
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "noarch"),
                                 nvra("nginx", "1.0", "1.el9", "x86_64")]),
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "noarch"),
                                 nvra("aaa", "1.0", "1.el9", "noarch"),
                                 nvra("nginx", "1.0", "1.el9", "x86_64")]))
        self.assertEqual(rows, [
            ["nginx-1.0-1.el9.noarch", "nginx-1.0-1.el9.noarch"],
            [None, "aaa-1.0-1.el9.noarch"],
            ["nginx-1.0-1.el9.x86_64", "nginx-1.0-1.el9.x86_64"]])

    def test_arch_present_on_one_side_only_still_keeps_its_group(self):
        rows = align_rpms(
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "aarch64")]),
            build("nginx", rpms=[nvra("nginx", "1.0", "1.el9", "x86_64")]))
        self.assertEqual(rows, [["nginx-1.0-1.el9.aarch64", None],
                                [None, "nginx-1.0-1.el9.x86_64"]])

    def test_rows_agree_with_the_deltas(self):
        # выравнивание и rpms_added/rpms_removed считают одно и то же:
        # пустая ячейка справа — это ровно «ушедший» подпакет
        old = build("nginx", subpackages=["nginx", "nginx-mod"])
        new = build("nginx", subpackages=["nginx", "nginx-core"])
        component = {c.name: c for c in
                     diff_snapshots(snap("a", [old]), snap("b", [new]))
                     .components}["nginx"]
        rows = align_rpms(old, new)
        self.assertEqual([r[0] for r in rows if r[1] is None],
                         component.rpms_removed)
        self.assertEqual([r[1] for r in rows if r[0] is None],
                         component.rpms_added)


class CountsTest(unittest.TestCase):
    def test_counts_cover_every_bucket(self):
        pair = diff_snapshots(
            snap("a", [build("keep"), build("gone"), build("up", "1.0"),
                       build("down", "2.0"),
                       build("patched", patches=["old.patch"])]),
            snap("b", [build("keep"), build("new"), build("up", "1.1"),
                       build("down", "1.0"),
                       build("patched", patches=["new.patch"])]))
        counts = pair.counts
        self.assertEqual(counts["added"], 1)
        self.assertEqual(counts["removed"], 1)
        self.assertEqual(counts["upgraded"], 1)
        self.assertEqual(counts["downgraded"], 1)
        self.assertEqual(counts["unchanged"], 2)
        self.assertEqual(counts["patches_added"], 1)
        self.assertEqual(counts["patches_removed"], 1)
        self.assertEqual(counts["repackaged"], 0)
        self.assertEqual(counts["branch_changed"], 0)

    def test_tags_are_recorded(self):
        pair = diff_snapshots(snap("t1", []), snap("t2", []))
        self.assertEqual((pair.old_tag, pair.new_tag), ("t1", "t2"))
        self.assertFalse(pair.is_summary)

    def test_components_sorted_by_name(self):
        pair = diff_snapshots(snap("a", [build("zzz"), build("aaa")]),
                              snap("b", [build("aaa"), build("zzz")]))
        self.assertEqual([c.name for c in pair.components], ["aaa", "zzz"])


class ChainTest(unittest.TestCase):
    def test_single_snapshot_gives_no_pairs(self):
        self.assertEqual(diff_chain([snap("a", [])]), [])

    def test_two_snapshots_give_one_pair_without_summary(self):
        pairs = diff_chain([snap("a", []), snap("b", [])])
        self.assertEqual(len(pairs), 1)
        self.assertFalse(pairs[0].is_summary)

    def test_three_snapshots_give_two_steps_plus_summary(self):
        pairs = diff_chain([snap("a", []), snap("b", []), snap("c", [])])
        self.assertEqual([(p.old_tag, p.new_tag, p.is_summary) for p in pairs],
                         [("a", "b", False), ("b", "c", False),
                          ("a", "c", True)])

    def test_chain_length_is_logged_at_debug(self):
        # цепочка — единственное место, где видно, сколько пар получилось
        # из скольких снапшотов; на debug это первое, что спрашивают
        with self.assertLogs("kojipatch.diff", level="DEBUG") as caught:
            diff_chain([snap("a", []), snap("b", []), snap("c", [])])
        self.assertIn("цепочка из 3 снапшотов", "\n".join(caught.output))

    def test_summary_compares_endpoints_not_steps(self):
        # компонент удалён на шаге 2 и вернулся на шаге 3 — в итоге он неизменен
        pairs = diff_chain([snap("a", [build("nginx")]), snap("b", []),
                            snap("c", [build("nginx")])])
        summary = pairs[-1]
        component = {c.name: c for c in summary.components}["nginx"]
        self.assertEqual(component.status, "unchanged")


if __name__ == "__main__":
    unittest.main()
