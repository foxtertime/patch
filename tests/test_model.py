import json
import os
import tempfile
import unittest

from kojipatch.model import (SCHEMA, Build, Patch, Snapshot, SnapshotError,
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


if __name__ == "__main__":
    unittest.main()
