"""Объекты предметной области и сериализация снапшотов."""
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA = 1


class SnapshotError(Exception):
    """Снапшот не читается или несовместим по версии схемы."""


@dataclass
class Patch:
    path: str
    name: str
    cls: str
    cves: List[str] = field(default_factory=list)
    web_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"path": self.path, "name": self.name, "class": self.cls,
                "cves": list(self.cves), "web_url": self.web_url}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Patch":
        return cls(path=data["path"], name=data["name"], cls=data["class"],
                   cves=list(data.get("cves") or []),
                   web_url=data.get("web_url"))


@dataclass
class Source:
    raw: str
    host: Optional[str] = None
    project: Optional[str] = None
    ref: Optional[str] = None
    ref_kind: str = "none"
    web_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"raw": self.raw, "host": self.host, "project": self.project,
                "ref": self.ref, "ref_kind": self.ref_kind,
                "web_url": self.web_url}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Source":
        return cls(raw=data["raw"], host=data.get("host"),
                   project=data.get("project"), ref=data.get("ref"),
                   ref_kind=data.get("ref_kind", "none"),
                   web_url=data.get("web_url"))


@dataclass
class Build:
    nvr: str
    name: str
    version: str
    release: str
    epoch: Optional[int] = None
    build_id: Optional[int] = None
    task_id: Optional[int] = None
    owner: Optional[str] = None
    completed: Optional[str] = None
    # тег, в котором билд реально висит (listTagged с inherit=True отдаёт его
    # у каждой записи). Совпал с тегом снапшота — билд затегован прямо, не
    # совпал — унаследован оттуда. None означает «неизвестно»: так читаются
    # снапшоты, собранные до появления поля.
    tag_name: Optional[str] = None
    # все koji-теги билда (listTags). tag_name — тот из них, через который
    # билд попал в этот снапшот; остальные показывают, где он висит ещё.
    # Пустой список означает «не спрашивали» — так читаются снапшоты,
    # собранные до появления поля.
    tags: List[str] = field(default_factory=list)
    source: Optional[Source] = None
    patch_dir_present: Optional[bool] = None
    patches: List[Patch] = field(default_factory=list)
    rpms: List[str] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nvr": self.nvr, "name": self.name, "version": self.version,
            "release": self.release, "epoch": self.epoch,
            "build_id": self.build_id, "task_id": self.task_id,
            "owner": self.owner, "completed": self.completed,
            "tag_name": self.tag_name, "tags": list(self.tags),
            "source": self.source.to_dict() if self.source else None,
            "patch_dir_present": self.patch_dir_present,
            "patches": [p.to_dict() for p in self.patches],
            "rpms": list(self.rpms), "problems": list(self.problems),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Build":
        source = data.get("source")
        return cls(
            nvr=data["nvr"], name=data["name"], version=data["version"],
            release=data["release"], epoch=data.get("epoch"),
            build_id=data.get("build_id"), task_id=data.get("task_id"),
            owner=data.get("owner"), completed=data.get("completed"),
            tag_name=data.get("tag_name"),
            tags=list(data.get("tags") or []),
            source=Source.from_dict(source) if source else None,
            patch_dir_present=data.get("patch_dir_present"),
            patches=[Patch.from_dict(p) for p in data.get("patches") or []],
            rpms=list(data.get("rpms") or []),
            problems=list(data.get("problems") or []),
        )

    def evr(self):
        return (self.epoch, self.version, self.release)


@dataclass
class Snapshot:
    tag: str
    generated: str
    koji_hub: str
    koji_web: Optional[str] = None
    # Имена классов патчей в порядке классификатора. Пустой список означает
    # «не записано» — так читаются снапшоты, собранные до появления поля.
    # Дашборду этот порядок нужен для карточек классов и меток строк, а
    # взять его больше неоткуда: конфига у него нет.
    patch_classes: List[str] = field(default_factory=list)
    builds: List[Build] = field(default_factory=list)

    def by_name(self) -> Dict[str, Build]:
        return {build.name: build for build in self.builds}


def snapshot_to_dict(snapshot: Snapshot) -> Dict[str, Any]:
    return {"schema": SCHEMA, "tag": snapshot.tag,
            "generated": snapshot.generated, "koji_hub": snapshot.koji_hub,
            "koji_web": snapshot.koji_web,
            "patch_classes": list(snapshot.patch_classes),
            "builds": [b.to_dict() for b in snapshot.builds]}


def snapshot_from_dict(data: Dict[str, Any]) -> Snapshot:
    if not isinstance(data, dict):
        raise SnapshotError("снапшот должен быть объектом")
    schema = data.get("schema")
    if schema != SCHEMA:
        raise SnapshotError("несовместимая схема снапшота: %r (нужна %d)"
                            % (schema, SCHEMA))
    try:
        return Snapshot(tag=data["tag"], generated=data["generated"],
                        koji_hub=data["koji_hub"],
                        koji_web=data.get("koji_web"),
                        patch_classes=list(data.get("patch_classes") or []),
                        builds=[Build.from_dict(b)
                                for b in data.get("builds") or []])
    except KeyError as exc:
        raise SnapshotError("в снапшоте нет поля %s" % exc)


def dump_snapshots(snapshots: List[Snapshot], path: str) -> None:
    payload = [snapshot_to_dict(s) for s in snapshots]
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=True)


def load_snapshots(path: str) -> List[Snapshot]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise SnapshotError("не прочитать снапшот %s: %s" % (path, exc))
    except ValueError as exc:
        raise SnapshotError("снапшот %s не разбирается: %s" % (path, exc))
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise SnapshotError("снапшот %s: ожидался объект или список" % path)
    return [snapshot_from_dict(item) for item in data]
