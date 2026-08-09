import json
import os
import tempfile
import unittest

from dashboard import __version__
from dashboard.model import (SCHEMA, Build, Patch, Snapshot, SnapshotError,
                             Source, dump_snapshots, load_snapshots,
                             snapshot_from_dict, snapshot_to_dict)


def sample_build(name="nginx"):
    return Build(
        nvr="%s-1.24.0-3.el9" % name, name=name, version="1.24.0",
        release="3.el9", epoch=None, build_id=1, task_id=2, owner="builder",
        completed="2026-05-14",
        source=Source(raw="git+ssh://git@h/g/r?#origin/br", host="h",
                      project="g/r", ref="br", ref_kind="branch",
                      web_url="https://h/blob"),
        patch_dir_present=True,
        patches=[Patch(path="PATCH/CVE-2024-7347.patch",
                       name="CVE-2024-7347.patch", cls="CVE",
                       cves=["CVE-2024-7347"], web_url="https://h/blob")],
        rpms=["nginx-1.24.0-3.el9.x86_64"],
        problems=[])


def sample_snapshot(tag="os-9.2"):
    return Snapshot(tag=tag, generated="2026-08-03T13:20:00+03:00",
                    koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                    builds=[sample_build()])


class SerialisationTest(unittest.TestCase):
    def test_written_snapshot_names_the_version_that_wrote_it(self):
        data = snapshot_to_dict(sample_snapshot())
        self.assertEqual(data["dashboard"], __version__)
        # Схема от появления поля не поехала: поле добавлено, а не заменило
        # собой что-то, и старый читатель его просто не заметит.
        self.assertEqual(data["schema"], SCHEMA)

    def test_snapshot_without_a_version_still_reads(self):
        # Снапшоты, собранные до появления поля, — законный вход: версия
        # инструмента необязательна, обязательна только схема.
        data = snapshot_to_dict(sample_snapshot())
        del data["dashboard"]
        self.assertEqual(snapshot_from_dict(data), sample_snapshot())

    def test_roundtrip_preserves_everything(self):
        snap = sample_snapshot()
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertEqual(again, snap)

    def test_patch_class_key_is_class_in_json(self):
        data = snapshot_to_dict(sample_snapshot())
        self.assertEqual(data["builds"][0]["patches"][0]["class"], "CVE")
        self.assertNotIn("cls", data["builds"][0]["patches"][0])

    def test_schema_version_is_written(self):
        self.assertEqual(snapshot_to_dict(sample_snapshot())["schema"], SCHEMA)

    def test_source_may_be_null(self):
        build = sample_build()
        build.source = None
        build.patch_dir_present = None
        build.problems = ["no source url"]
        snap = Snapshot(tag="t", generated="g", koji_hub="h", koji_web=None,
                        builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertIsNone(again.builds[0].source)
        self.assertIsNone(again.builds[0].patch_dir_present)
        self.assertEqual(again.builds[0].problems, ["no source url"])

    def test_unknown_schema_rejected(self):
        data = snapshot_to_dict(sample_snapshot())
        data["schema"] = 99
        with self.assertRaises(SnapshotError):
            snapshot_from_dict(data)

    def test_roundtrip_preserves_false_and_epoch(self):
        build = sample_build()
        build.patch_dir_present = False
        build.epoch = 2
        snap = Snapshot(tag="t", generated="g", koji_hub="h",
                        koji_web=None, builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertIs(again.builds[0].patch_dir_present, False)
        self.assertEqual(again.builds[0].epoch, 2)

    def test_roundtrip_preserves_the_tag_the_build_is_in(self):
        build = sample_build()
        build.tag_name = "os-9-base"
        snap = Snapshot(tag="os-9.2", generated="g", koji_hub="h",
                        koji_web=None, builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertEqual(again.builds[0].tag_name, "os-9-base")

    def test_roundtrip_preserves_all_tags_of_the_build(self):
        build = sample_build()
        build.tags = ["os-9-base", "os-9.2-candidate"]
        snap = Snapshot(tag="os-9.2", generated="g", koji_hub="h",
                        koji_web=None, builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertEqual(again.builds[0].tags,
                         ["os-9-base", "os-9.2-candidate"])

    def test_snapshot_without_tags_reads_as_empty(self):
        data = snapshot_to_dict(sample_snapshot())
        del data["builds"][0]["tags"]
        self.assertEqual(snapshot_from_dict(data).builds[0].tags, [])

    def test_snapshot_without_tag_name_reads_as_unknown(self):
        # снапшот, собранный прежней версией: «не знаем, откуда билд» — это
        # не то же самое, что «затегован прямо», и подменять одно другим
        # нельзя, иначе дашборд соврёт про наследование
        data = snapshot_to_dict(sample_snapshot())
        del data["builds"][0]["tag_name"]
        self.assertIsNone(snapshot_from_dict(data).builds[0].tag_name)

    def test_missing_raw_in_source_raises(self):
        data = snapshot_to_dict(sample_snapshot())
        del data["builds"][0]["source"]["raw"]
        with self.assertRaises(SnapshotError):
            snapshot_from_dict(data)

    def test_missing_koji_hub_raises(self):
        data = snapshot_to_dict(sample_snapshot())
        del data["koji_hub"]
        with self.assertRaises(SnapshotError):
            snapshot_from_dict(data)

    def test_patch_classes_are_serialized(self):
        snapshot = sample_snapshot()
        snapshot.patch_classes = ["CVE", "SAST", "other"]
        data = snapshot_to_dict(snapshot)
        self.assertEqual(data["patch_classes"], ["CVE", "SAST", "other"])
        self.assertEqual(
            snapshot_from_dict(data).patch_classes, ["CVE", "SAST", "other"])

    def test_snapshot_without_patch_classes_still_reads(self):
        """Снапшот прежней версии обязан читаться: список классов в нём
        просто не записан, и выдумывать его нельзя."""
        data = snapshot_to_dict(sample_snapshot())
        del data["patch_classes"]
        self.assertEqual(snapshot_from_dict(data).patch_classes, [])


class FileIoTest(unittest.TestCase):
    def path(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        return path

    def test_dump_single_snapshot_writes_a_list(self):
        path = self.path()
        dump_snapshots([sample_snapshot()], path)
        with open(path) as handle:
            data = json.load(handle)
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)

    def test_load_accepts_a_list(self):
        path = self.path()
        dump_snapshots([sample_snapshot("a"), sample_snapshot("b")], path)
        snaps = load_snapshots(path)
        self.assertEqual([s.tag for s in snaps], ["a", "b"])

    def test_load_accepts_a_bare_object(self):
        path = self.path()
        with open(path, "w") as handle:
            json.dump(snapshot_to_dict(sample_snapshot("solo")), handle)
        self.assertEqual([s.tag for s in load_snapshots(path)], ["solo"])

    def test_load_of_garbage_raises(self):
        path = self.path()
        with open(path, "w") as handle:
            handle.write("{not json")
        with self.assertRaises(SnapshotError):
            load_snapshots(path)

    def test_load_of_missing_file_raises(self):
        with self.assertRaises(SnapshotError):
            load_snapshots("/nonexistent/snap.json")


class NewFieldsTest(unittest.TestCase):
    def test_round_trip_keeps_commit_and_ghosts(self):
        source = Source(raw="git+https://gl/g/r#origin/br", host="gl",
                        project="g/r", ref="br", ref_kind="branch",
                        web_url="https://gl/g/r/-/tree/br",
                        commit="0f1a2b3c", commit_url="https://gl/g/r/-/tree/0f1a2b3c",
                        commit_source="koji_source", branch_head="99aabbcc",
                        commits_ahead=3)
        build = Build(nvr="n-1-1", name="n", version="1", release="1",
                      source=source, patches_ref="0f1a2b3c",
                      patches=[Patch(path="PATCH/a.patch", name="a.patch",
                                     cls="CVE")],
                      ghost_patches=[Patch(path="PATCH/b.patch",
                                           name="b.patch", cls="CVE",
                                           ghost="branch")])
        snapshot = Snapshot(tag="os-9.2", generated="2026-08-09T00:00:00+03:00",
                            koji_hub="https://hub", builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snapshot)).builds[0]
        self.assertEqual(again.source.commit, "0f1a2b3c")
        self.assertEqual(again.source.commit_source, "koji_source")
        self.assertEqual(again.source.branch_head, "99aabbcc")
        self.assertEqual(again.source.commits_ahead, 3)
        self.assertEqual(again.patches_ref, "0f1a2b3c")
        self.assertIsNone(again.patches[0].ghost)
        self.assertEqual(again.ghost_patches[0].ghost, "branch")

    def test_old_snapshot_reads_with_empty_new_fields(self):
        # снапшот, записанный до этой работы: новых ключей в нём нет вовсе
        data = {"schema": 1, "tag": "os-9.2", "generated": "2026-01-01T00:00:00+03:00",
                "koji_hub": "https://hub",
                "builds": [{"nvr": "n-1-1", "name": "n", "version": "1",
                            "release": "1",
                            "source": {"raw": "git+https://gl/g/r#origin/br",
                                       "ref": "br", "ref_kind": "branch"},
                            "patches": [{"path": "PATCH/a.patch",
                                         "name": "a.patch", "class": "CVE"}]}]}
        build = snapshot_from_dict(data).builds[0]
        self.assertIsNone(build.source.commit)
        self.assertIsNone(build.source.commits_ahead)
        self.assertIsNone(build.patches_ref)
        self.assertEqual(build.ghost_patches, [])
        self.assertIsNone(build.patches[0].ghost)


class PatchShaTest(unittest.TestCase):
    def test_round_trip(self):
        patch = Patch(path="PATCH/a.patch", name="a.patch", cls="CVE",
                      sha="0123456789abcdef0123456789abcdef01234567")
        again = Patch.from_dict(patch.to_dict())
        self.assertEqual(again.sha,
                         "0123456789abcdef0123456789abcdef01234567")

    def test_old_patch_reads_without_sha(self):
        # снапшот до 2.3.0: ключа нет вовсе
        again = Patch.from_dict({"path": "PATCH/a.patch", "name": "a.patch",
                                 "class": "CVE"})
        self.assertIsNone(again.sha)


if __name__ == "__main__":
    unittest.main()
