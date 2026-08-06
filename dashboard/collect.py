"""Сбор снапшота одного тега из koji и GitLab."""
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Optional

from .classify import Classifier, find_cves
from .model import Build, Patch, Snapshot, Source
from .sourceurl import SourceUrlError, parse_source_url

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(
        microsecond=0).isoformat()


def _completed(raw) -> Optional[str]:
    """Когда билд собран, в виде «YYYY-MM-DD HH:MM:SS».

    koji отдаёт completion_time то строкой ('2026-05-14 10:00:00.123456+00:00'
    или через 'T'), то числом epoch — приводим к одному виду. Доли секунды
    режем: они ничего не решают, а строку удлиняют. Время остаётся тем же
    UTC, в котором его хранит koji: перевод в местное сделал бы один и тот же
    снапшот разным у разных людей, а снапшотами обмениваются.
    """
    if raw in (None, ""):
        return None
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw).strftime("%Y-%m-%d %H:%M:%S")
    # хаб может не прислать время вовсе — тогда останется одна дата, и это
    # нормально: срез по длине ничего не ломает
    return str(raw).replace("T", " ", 1)[:19].strip()


def _original_url(info: dict) -> Optional[str]:
    extra = info.get("extra") or {}
    source = extra.get("source") or {}
    return source.get("original_url") or None


def collect_tag(tag: str, cfg, koji_client, gitlab_client, jobs: int = 8,
                now: Optional[str] = None) -> Snapshot:
    """Собирает билды тега, их патчи и RPM в один снапшот."""
    classifier = Classifier.from_config(cfg)
    started = time.monotonic()
    tagged = koji_client.tagged_builds(tag)
    build_ids = [item["build_id"] for item in tagged]
    workers = max(1, int(jobs))
    # на 800 билдах это шестнадцать мультиколлов подряд: без строки прогон
    # выглядит зависшим между размером тега и первой строкой прогресса
    logger.info("%s: %d билдов в теге, спрашиваю у koji детали и RPM", tag,
                len(build_ids))
    details = koji_client.build_details(build_ids)
    rpms = koji_client.rpms_for(build_ids)
    tags = koji_client.tags_for(build_ids)

    infos = [details[bid] for bid in build_ids if bid in details]
    # оба числа в одной строке: прогресс считает полученные детали, а размер
    # тега — то, что перечислил listTagged. Когда они расходятся, «4 билдов в
    # теге» и остановившийся на «3/3» прогресс читаются как выброшенный билд;
    # на деле такой билд обработан и о нём предупреждено отдельно.
    logger.info("%s: %d билдов в теге, деталей получено %d, сбор в %d "
                "поток(ов)", tag, len(build_ids), len(infos), workers)
    # getBuild мог не вернуть билд, который listTagged только что перечислил.
    # Молча выбросить строку нельзя: для дашборда патчей пропавший компонент —
    # худший из возможных исходов. Показываем его по данным listTagged.
    tagged_by_id = {item.get("build_id"): item for item in tagged}
    missing = [tagged_by_id[bid] for bid in build_ids if bid not in details]
    total = len(infos)
    step = max(1, total // 20)   # ~20 строк прогресса на прогон любого размера
    done = [0]
    problem_builds = [0]
    progress_lock = threading.Lock()

    def report_progress(build) -> None:
        # increment/read под одним lock'ом, чтобы разные потоки пула не
        # теряли инкременты; строку пишем уже вне лока, чтобы медленный
        # обработчик лога не сериализовал пул.
        with progress_lock:
            done[0] += 1
            if build.problems:
                problem_builds[0] += 1
            current, problems = done[0], problem_builds[0]
        if current % step and current != total:
            return
        elapsed = time.monotonic() - started
        rate = current / elapsed if elapsed > 0 else 0.0
        left = (total - current) / rate if rate > 0 else 0.0
        logger.info("%s: %d/%d (%d%%), %d проблемных, %.1f билда/с, "
                    "~%d с осталось", tag, current, total,
                    100 * current // max(1, total), problems, rate, left)

    def handle(info) -> Build:
        # тег, в котором билд висит, знает только listTagged: getBuild такого
        # поля не отдаёт вовсе
        entry = tagged_by_id.get(info.get("build_id")) or {}
        build = _build_from_info(info, rpms.get(info.get("build_id"), []),
                                 entry.get("tag_name"),
                                 tags.get(info.get("build_id"), []))
        try:
            _attach_patches(build, info, cfg, gitlab_client, classifier)
        except Exception as exc:
            # ни одна ошибка билда (в т.ч. неожиданная, не только
            # SourceUrlError/проблема GitLab) не должна валить весь сбор.
            build.problems.append("internal error: %s" % exc)
        for problem in build.problems:
            logger.warning("%s: %s", build.name, problem)
        report_progress(build)
        return build

    if workers == 1 or total <= 1:
        builds = [handle(info) for info in infos]
    else:
        # имя потока попадает в дебажный лог, длинное сделало бы его нечитаемым
        with ThreadPoolExecutor(max_workers=workers,
                                thread_name_prefix="w") as pool:
            builds = list(pool.map(handle, infos))

    for item in missing:
        build = _placeholder_build(item, rpms.get(item.get("build_id"), []),
                                   tags.get(item.get("build_id"), []))
        logger.warning("%s: %s", build.name, build.problems[0])
        builds.append(build)
    builds.sort(key=lambda b: b.name or "")

    snapshot = Snapshot(tag=tag, generated=now or _now_iso(),
                        koji_hub=cfg.koji_hub, koji_web=cfg.koji_web,
                        patch_classes=classifier.class_names(),
                        builds=builds)
    _log_summary(snapshot, time.monotonic() - started)
    return snapshot


def _build_from_info(info: dict, rpms, tag_name: Optional[str] = None,
                     tags=()) -> Build:
    return Build(
        tag_name=tag_name, tags=list(tags),
        nvr=info.get("nvr") or "%s-%s-%s" % (info.get("name"),
                                             info.get("version"),
                                             info.get("release")),
        name=info.get("name"), version=info.get("version"),
        release=info.get("release"), epoch=info.get("epoch"),
        build_id=info.get("build_id"), task_id=info.get("task_id"),
        owner=info.get("owner_name"),
        completed=_completed(info.get("completion_time")),
        rpms=list(rpms), patches=[], problems=[])


def _placeholder_build(info: dict, rpms, tags=()) -> Build:
    """Билд, по которому пришёл только ответ listTagged.

    Строка остаётся в снапшоте — с проблемой и без сведений об источнике,
    чтобы было видно: данные по ней неполные, а не «патчей нет».
    """
    build = _build_from_info(info, rpms, info.get("tag_name"), tags)
    build.patch_dir_present = None
    build.problems.append("koji: нет деталей билда")
    return build


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

    # Сборка из готового SRPM: ветки нет, каталог PATCH читать негде и не у
    # кого. Это не проблема билда, а другой способ его собрать, поэтому в
    # problems ничего не уезжает — вид источника скажет метка в строке.
    # patch_dir_present остаётся None: «неизвестно», а не «нет патчей».
    if parsed.ref_kind == "srpm":
        build.source = Source(raw=raw_url, ref=parsed.ref, ref_kind="srpm")
        return

    build.source = Source(
        raw=raw_url, host=parsed.host, project=parsed.project, ref=parsed.ref,
        ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref))

    result = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    build.patch_dir_present = result.present
    if result.problem:
        # проблема не обязательно означает, что читать нечего: подменённый
        # хост отдаёт и заметку, и настоящее дерево патчей. У неудачных
        # чтений paths и так пустой.
        build.problems.append(result.problem)
    for path in result.paths:
        name = os.path.basename(path)
        build.patches.append(Patch(
            path=path, name=name, cls=classifier.classify(name),
            cves=find_cves(name),
            web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                           parsed.ref, path)))


# Проблемы, у которых после двоеточия стоит произвольный текст: в сводке их
# группируем по префиксу, иначе одна строка stderr растёт до числа билдов.
_GROUPED_PROBLEMS = ("gitlab:", "internal error:", "bad source url:")


def _log_summary(snapshot: Snapshot, elapsed: float) -> None:
    """Итог по тегу — то, что раньше печатал CLI своим sys.stderr.write."""
    summary = problem_summary(snapshot)
    problems = sum(1 for b in snapshot.builds if b.problems)
    details = ", ".join("%s: %d" % item for item in sorted(summary.items()))
    logger.info("%s: готово, %d билдов, %d проблемных%s, за %.1f с",
                snapshot.tag, len(snapshot.builds), problems,
                (" (%s)" % details) if details else "", elapsed)


def problem_summary(snapshot: Snapshot) -> Dict[str, int]:
    """Сколько раз встретилась каждая проблема — для сводки в stderr."""
    counts = {}
    for build in snapshot.builds:
        for problem in build.problems:
            key = (problem.split(":")[0]
                   if problem.startswith(_GROUPED_PROBLEMS) else problem)
            counts[key] = counts.get(key, 0) + 1
    return counts
