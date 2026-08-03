"""Сравнение снапшотов тегов."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .model import Build, Snapshot
from .rpmvercmp import compare_evr

STATUSES = ("added", "removed", "unchanged", "upgraded", "downgraded")


@dataclass
class ComponentDiff:
    name: str
    status: str
    old: Optional[Build] = None
    new: Optional[Build] = None
    patches_added: List[str] = field(default_factory=list)
    patches_removed: List[str] = field(default_factory=list)
    rpms_added: List[str] = field(default_factory=list)
    rpms_removed: List[str] = field(default_factory=list)
    branch_changed: bool = False
    repackaged: bool = False

    def changed(self) -> bool:
        return (self.status != "unchanged" or self.patches_added
                or self.patches_removed or self.repackaged
                or self.branch_changed)


@dataclass
class PairDiff:
    old_tag: str
    new_tag: str
    is_summary: bool
    components: List[ComponentDiff]
    counts: Dict[str, int]


def _status(old: Build, new: Build) -> str:
    result = compare_evr(old.evr(), new.evr())
    if result == 0:
        return "unchanged"
    return "upgraded" if result < 0 else "downgraded"


def _ref(build: Optional[Build]) -> Optional[str]:
    return build.source.ref if build and build.source else None


def diff_snapshots(old: Snapshot, new: Snapshot,
                   is_summary: bool = False) -> PairDiff:
    """Сравнивает два снапшота по именам компонентов."""
    old_map = old.by_name()
    new_map = new.by_name()
    components = []

    for name in sorted(set(old_map) | set(new_map)):
        old_build = old_map.get(name)
        new_build = new_map.get(name)
        if old_build is None:
            components.append(ComponentDiff(name=name, status="added",
                                            new=new_build))
            continue
        if new_build is None:
            components.append(ComponentDiff(name=name, status="removed",
                                            old=old_build))
            continue

        old_patches = {p.path for p in old_build.patches}
        new_patches = {p.path for p in new_build.patches}
        old_rpms = set(old_build.rpms)
        new_rpms = set(new_build.rpms)
        rpms_added = sorted(new_rpms - old_rpms)
        rpms_removed = sorted(old_rpms - new_rpms)
        components.append(ComponentDiff(
            name=name, status=_status(old_build, new_build),
            old=old_build, new=new_build,
            patches_added=sorted(new_patches - old_patches),
            patches_removed=sorted(old_patches - new_patches),
            rpms_added=rpms_added, rpms_removed=rpms_removed,
            branch_changed=_ref(old_build) != _ref(new_build),
            repackaged=bool(rpms_added or rpms_removed)))

    return PairDiff(old_tag=old.tag, new_tag=new.tag, is_summary=is_summary,
                    components=components, counts=_counts(components))


def _counts(components: List[ComponentDiff]) -> Dict[str, int]:
    counts = {status: 0 for status in STATUSES}
    counts.update({"patches_added": 0, "patches_removed": 0,
                   "repackaged": 0, "branch_changed": 0, "changed": 0})
    for component in components:
        counts[component.status] += 1
        if component.patches_added:
            counts["patches_added"] += 1
        if component.patches_removed:
            counts["patches_removed"] += 1
        if component.repackaged:
            counts["repackaged"] += 1
        if component.branch_changed:
            counts["branch_changed"] += 1
        if component.changed():
            counts["changed"] += 1
    return counts


def diff_chain(snapshots: List[Snapshot]) -> List[PairDiff]:
    """Пары подряд идущих снапшотов плюс сводная пара первый→последний."""
    if len(snapshots) < 2:
        return []
    pairs = [diff_snapshots(snapshots[i], snapshots[i + 1])
             for i in range(len(snapshots) - 1)]
    if len(snapshots) > 2:
        pairs.append(diff_snapshots(snapshots[0], snapshots[-1],
                                    is_summary=True))
    return pairs
