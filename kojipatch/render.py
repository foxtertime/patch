"""Подготовка данных страницы и подстановка их в HTML-шаблон."""
import json
import os
from typing import Dict, List, Optional
from urllib.parse import quote

PLACEHOLDER = "/*__DATA__*/"
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "assets",
                             "dashboard.html")


class RenderError(Exception):
    """Шаблон не найден или в нём нет плейсхолдера данных."""


def _koji_url(koji_web: Optional[str], nvr: str) -> Optional[str]:
    if not koji_web:
        return None
    return "%s/search?match=exact&type=build&terms=%s" % (
        koji_web.rstrip("/"), quote(nvr))


def _evr(build) -> str:
    prefix = "%s:" % build.epoch if build.epoch else ""
    return "%s%s-%s" % (prefix, build.version, build.release)


def _build_tags(build) -> List[str]:
    tags = []
    for patch in build.patches:
        tag = patch.cls.lower()
        if tag not in tags:
            tags.append(tag)
    if build.source is None:
        tags.append("no-source")
    elif build.source.ref_kind == "commit":
        tags.append("from-commit")
    if build.patch_dir_present is False:
        tags.append("no-patch")
    if any(p.startswith("gitlab:") or p.startswith("bad source")
           for p in build.problems):
        tags.append("gitlab-error")
    return tags


def _patch_dict(patch) -> Dict[str, object]:
    return {"path": patch.path, "name": patch.name, "class": patch.cls,
            "cves": list(patch.cves), "url": patch.web_url}


def _build_row(build, koji_web) -> Dict[str, object]:
    counts = {}
    for patch in build.patches:
        counts[patch.cls] = counts.get(patch.cls, 0) + 1
    source = build.source
    return {
        "name": build.name, "nvr": build.nvr, "version": build.version,
        "release": build.release, "evr": _evr(build),
        "branch": source.ref if source else None,
        "ref_kind": source.ref_kind if source else "none",
        "project": source.project if source else None,
        "source_url": source.web_url if source else None,
        "koji_url": _koji_url(koji_web, build.nvr),
        "completed": build.completed, "owner": build.owner,
        "build_id": build.build_id, "task_id": build.task_id,
        "patches": [_patch_dict(p) for p in build.patches],
        "patch_counts": counts, "rpms": list(build.rpms),
        "patch_dir_present": build.patch_dir_present,
        "problems": list(build.problems), "tags": _build_tags(build),
    }


def _snapshot_counts(rows, class_names) -> Dict[str, object]:
    by_class = {name: {"builds": 0, "files": 0} for name in class_names}
    with_patches = without_patches = problems = files = 0
    for row in rows:
        if row["patches"]:
            with_patches += 1
        if row["patch_dir_present"] is False:
            without_patches += 1
        if row["problems"]:
            problems += 1
        files += len(row["patches"])
        for name, count in row["patch_counts"].items():
            bucket = by_class.setdefault(name, {"builds": 0, "files": 0})
            bucket["builds"] += 1
            bucket["files"] += count
    return {"builds": len(rows), "with_patches": with_patches,
            "without_patches": without_patches, "problems": problems,
            "patch_files": files, "by_class": by_class}


def _diff_tags(component) -> List[str]:
    tags = [component.status]
    if component.repackaged:
        tags.append("repackaged")
    if component.patches_added:
        tags.append("patches+")
    if component.patches_removed:
        tags.append("patches-")
    if component.branch_changed:
        tags.append("branch-changed")
    return tags


def _diff_row(component, koji_web) -> Dict[str, object]:
    old, new = component.old, component.new
    shown = new or old
    return {
        "name": component.name, "status": component.status,
        "changed": bool(component.changed()),
        "old_evr": _evr(old) if old else None,
        "new_evr": _evr(new) if new else None,
        "old_branch": old.source.ref if old and old.source else None,
        "new_branch": new.source.ref if new and new.source else None,
        "patches_added": list(component.patches_added),
        "patches_removed": list(component.patches_removed),
        "rpms_added": list(component.rpms_added),
        "rpms_removed": list(component.rpms_removed),
        "old_patches": [_patch_dict(p) for p in (old.patches if old else [])],
        "new_patches": [_patch_dict(p) for p in (new.patches if new else [])],
        "old_rpms": list(old.rpms) if old else [],
        "new_rpms": list(new.rpms) if new else [],
        "koji_url": _koji_url(koji_web, shown.nvr) if shown else None,
        "source_url": (shown.source.web_url
                       if shown and shown.source else None),
        "tags": _diff_tags(component),
    }


def build_page_data(snapshots, pairs, classifier) -> Dict[str, object]:
    """Собирает всё, что нужно фронтенду, в один сериализуемый словарь."""
    class_names = classifier.class_names()
    snapshot_blocks = []
    for snapshot in snapshots:
        # порядок билдов в снапшоте не гарантирован — сортируем здесь
        rows = sorted((_build_row(b, snapshot.koji_web)
                       for b in snapshot.builds),
                      key=lambda row: row["name"])
        snapshot_blocks.append({
            "tag": snapshot.tag, "generated": snapshot.generated,
            "koji_web": snapshot.koji_web,
            "counts": _snapshot_counts(rows, class_names), "builds": rows})

    koji_web = snapshots[0].koji_web if snapshots else None
    pair_blocks = [{
        "old": pair.old_tag, "new": pair.new_tag, "summary": pair.is_summary,
        "counts": dict(pair.counts),
        "rows": [_diff_row(c, koji_web) for c in pair.components],
    } for pair in pairs]

    return {"generated": snapshots[0].generated if snapshots else "",
            "patch_classes": class_names, "snapshots": snapshot_blocks,
            "pairs": pair_blocks}


def _encode(data: Dict[str, object]) -> str:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    # безопасная вставка внутрь <script>
    return (text.replace("</", "<\\/")
                .replace(" ", "\\u2028")
                .replace(" ", "\\u2029"))


def render_html(snapshots, pairs, classifier,
                template_path: Optional[str] = None) -> str:
    path = template_path or TEMPLATE_PATH
    try:
        with open(path, "r", encoding="utf-8") as handle:
            template = handle.read()
    except OSError as exc:
        raise RenderError("не прочитать шаблон %s: %s" % (path, exc))
    if PLACEHOLDER not in template:
        raise RenderError("в шаблоне %s нет плейсхолдера %s"
                          % (path, PLACEHOLDER))
    data = build_page_data(snapshots, pairs, classifier)
    return template.replace(PLACEHOLDER, _encode(data))
