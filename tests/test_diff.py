import unittest

from kojipatch.diff import diff_chain, diff_snapshots
from kojipatch.model import Build, Patch, Snapshot, Source


def nvra(sub, version, release, arch="x86_64"):
    """RPM в том же виде, в каком его отдаёт koji: name-version-release.arch."""
    return "%s-%s-%s.%s" % (sub, version, release, arch)


def build(name, version="1.0", release="1.el9", patches=(), rpms=(),
          ref="main", epoch=None, subpackages=None):
    # подпакеты задаём именами, а NVRA собираем из версии билда — так же,
    # как это делает koji: иначе тест сравнивал бы то, чего в жизни нет.
    if subpackages is not None:
        rpms = [nvra(sub, version, release) for sub in subpackages]
    return Build(nvr="%s-%s-%s" % (name, version, release), name=name,
                 version=version, release=release, epoch=epoch,
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

    def test_summary_compares_endpoints_not_steps(self):
        # компонент удалён на шаге 2 и вернулся на шаге 3 — в итоге он неизменен
        pairs = diff_chain([snap("a", [build("nginx")]), snap("b", []),
                            snap("c", [build("nginx")])])
        summary = pairs[-1]
        component = {c.name: c for c in summary.components}["nginx"]
        self.assertEqual(component.status, "unchanged")


if __name__ == "__main__":
    unittest.main()
