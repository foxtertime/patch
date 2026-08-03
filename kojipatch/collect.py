"""Сбор снапшота одного тега из koji и GitLab."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Optional

from .classify import Classifier, find_cves
from .model import Build, Patch, Snapshot, Source
from .sourceurl import SourceUrlError, parse_source_url


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(
        microsecond=0).isoformat()


def _completed(raw) -> Optional[str]:
    """koji отдаёт completion_time строкой или float; нужна дата YYYY-MM-DD."""
    if raw in (None, ""):
        return None
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw).strftime("%Y-%m-%d")
    return str(raw)[:10]


def _original_url(info: dict) -> Optional[str]:
    extra = info.get("extra") or {}
    source = extra.get("source") or {}
    return source.get("original_url") or None


def collect_tag(tag: str, cfg, koji_client, gitlab_client, jobs: int = 8,
                now: Optional[str] = None, progress=None) -> Snapshot:
    """Собирает билды тега, их патчи и RPM в один снапшот."""
    classifier = Classifier.from_config(cfg)
    tagged = koji_client.tagged_builds(tag)
    build_ids = [item["build_id"] for item in tagged]
    details = koji_client.build_details(build_ids)
    rpms = koji_client.rpms_for(build_ids)

    infos = [details[bid] for bid in build_ids if bid in details]
    total = len(infos)
    done = [0]

    def handle(info) -> Build:
        build = _build_from_info(info, rpms.get(info.get("build_id"), []))
        _attach_patches(build, info, cfg, gitlab_client, classifier)
        done[0] += 1
        if progress:
            progress(done[0], total)
        return build

    workers = max(1, int(jobs))
    if workers == 1 or total <= 1:
        builds = [handle(info) for info in infos]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            builds = list(pool.map(handle, infos))

    builds.sort(key=lambda b: b.name)
    return Snapshot(tag=tag, generated=now or _now_iso(),
                    koji_hub=cfg.koji_hub, koji_web=cfg.koji_web, builds=builds)


def _build_from_info(info: dict, rpms) -> Build:
    return Build(
        nvr=info.get("nvr") or "%s-%s-%s" % (info.get("name"),
                                             info.get("version"),
                                             info.get("release")),
        name=info.get("name"), version=info.get("version"),
        release=info.get("release"), epoch=info.get("epoch"),
        build_id=info.get("build_id"), task_id=info.get("task_id"),
        owner=info.get("owner_name"),
        completed=_completed(info.get("completion_time")),
        rpms=list(rpms), patches=[], problems=[])


def _attach_patches(build: Build, info: dict, cfg, gitlab_client,
                    classifier: Classifier) -> None:
    raw_url = _original_url(info)
    if not raw_url:
        build.problems.append("no source url")
        return
    try:
        parsed = parse_source_url(raw_url)
    except SourceUrlError as exc:
        build.source = Source(raw=raw_url)
        build.problems.append("bad source url: %s" % exc)
        return

    build.source = Source(
        raw=raw_url, host=parsed.host, project=parsed.project, ref=parsed.ref,
        ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref))

    result = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    build.patch_dir_present = result.present
    if result.problem:
        build.problems.append(result.problem)
        return
    for path in result.paths:
        name = os.path.basename(path)
        build.patches.append(Patch(
            path=path, name=name, cls=classifier.classify(name),
            cves=find_cves(name),
            web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                           parsed.ref, path)))


def problem_summary(snapshot: Snapshot) -> Dict[str, int]:
    """Сколько раз встретилась каждая проблема — для сводки в stderr."""
    counts = {}
    for build in snapshot.builds:
        for problem in build.problems:
            key = problem.split(":")[0] if problem.startswith("gitlab:") else problem
            counts[key] = counts.get(key, 0) + 1
    return counts
