"""Сравнение снапшотов тегов."""
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .model import Build, Snapshot
from .rpms import arch_key, arch_of
from .rpmvercmp import compare_evr

logger = logging.getLogger(__name__)

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
        return bool(self.status != "unchanged" or self.patches_added
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


def _rpm_key(build: Build, nvra: str) -> str:
    """Ключ подпакета для сравнения: name.arch, без version-release.

    Сравнивать надо состав подпакетов, а не версии: иначе любое обновление
    компонента выглядит как «состав RPM изменился». Все подпакеты одного
    билда несут его же version-release, поэтому вырезать их из NVRA надёжно.
    """
    tail = "-%s-%s." % (build.version, build.release)
    index = nvra.rfind(tail)
    if index == -1:
        return nvra
    return nvra[:index] + "." + nvra[index + len(tail):]


def _rpm_keys(build: Build) -> Dict[str, List[str]]:
    """Ключ подпакета → NVRA, под которыми он встретился в снапшоте.

    В снапшоте остаётся полный NVRA (так требует модель), поэтому наружу
    отдаём именно его: строки в rpms_added/rpms_removed должны совпадать со
    строками в old_rpms/new_rpms, по которым дашборд красит «было/стало».
    """
    keys = {}
    for nvra in build.rpms:
        keys.setdefault(_rpm_key(build, nvra), []).append(nvra)
    return keys


def _rpm_delta(source: Dict[str, List[str]],
               other: Dict[str, List[str]]) -> List[str]:
    out = []
    for key in set(source) - set(other):
        out.extend(source[key])
    return sorted(out)


def _rpm_row_pairs(left: List[str], right: List[str]) -> List[List[Optional[str]]]:
    left, right = sorted(left), sorted(right)
    return [[left[i] if i < len(left) else None,
             right[i] if i < len(right) else None]
            for i in range(max(len(left), len(right)))]


def align_rpms(old: Optional[Build],
               new: Optional[Build]) -> List[List[Optional[str]]]:
    """Строки «было/стало» по подпакетам: одна строка — один подпакет.

    Один и тот же подпакет должен стоять слева и справа на одной высоте,
    иначе версии не сравнить глазами. Строки собираются по ключу
    (name.arch), а не по NVRA: NVRA несёт версию билда и с обновлением
    меняется целиком. Пропавший подпакет остаётся на своём месте с пустой
    правой ячейкой; пришедший уходит вниз своей группы, чтобы не сдвигать
    всё, что стоит выше.

    Строки идут группами по архитектуре, в порядке sort_key. Дашборд
    рисует блоки, просто разрезая список по смене архитектуры, — поэтому
    порядок задаётся здесь, один раз и сразу для обеих колонок.
    """
    old_keys = _rpm_keys(old) if old else {}
    new_keys = _rpm_keys(new) if new else {}
    arches = sorted({arch_of(k) for k in set(old_keys) | set(new_keys)},
                    key=arch_key)
    rows = []
    for arch in arches:
        kept = [k for k in old_keys if arch_of(k) == arch]
        for key in sorted(kept, key=lambda k: min(old_keys[k])):
            rows.extend(_rpm_row_pairs(old_keys[key], new_keys.get(key, [])))
        fresh = [k for k in new_keys if k not in old_keys and arch_of(k) == arch]
        for key in sorted(fresh, key=lambda k: min(new_keys[k])):
            rows.extend(_rpm_row_pairs([], new_keys[key]))
    return rows


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
        old_rpms = _rpm_keys(old_build)
        new_rpms = _rpm_keys(new_build)
        components.append(ComponentDiff(
            name=name, status=_status(old_build, new_build),
            old=old_build, new=new_build,
            patches_added=sorted(new_patches - old_patches),
            patches_removed=sorted(old_patches - new_patches),
            rpms_added=_rpm_delta(new_rpms, old_rpms),
            rpms_removed=_rpm_delta(old_rpms, new_rpms),
            branch_changed=_ref(old_build) != _ref(new_build),
            repackaged=set(old_rpms) != set(new_rpms)))

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
    logger.debug("цепочка из %d снапшотов → %d пар", len(snapshots), len(pairs))
    return pairs
