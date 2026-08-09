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


def _koji_source(info: dict) -> Optional[str]:
    """Верхнеуровневое поле source: чем сборка пошла на самом деле.

    В extra.source.original_url лежит то, что ввёл человек, — обычно ветка.
    Здесь же koji хранит разрешённый адрес, и у сборок из git в нём стоит
    полный хеш: git+ssh://<host>/<group>/<repo>#<hash>.
    """
    value = info.get("source")
    return value if isinstance(value, str) and value.strip() else None


def _same_project(left: Optional[str], right: Optional[str]) -> bool:
    if not left or not right:
        return False
    return left.strip("/").lower() == right.strip("/").lower()


def _commit_of(info: dict, parsed):
    """Хеш коммита сборки и то, откуда он взят.

    Из верхнеуровневого source берётся ТОЛЬКО хеш: ssh-хост в нём может не
    совпасть с https-хостом из original_url, и пусти мы его дальше —
    сработала бы подстановка хоста в GitlabClient, и здоровые билды
    получили бы проблему «host не описан в конфиге».

    Проекты при этом сверяются. Разошлись — хеш не берём: это другой
    репозиторий, а не уточнение, и приклеить билду чужой коммит хуже, чем
    не показать коммита вовсе. Хост в сверке не участвует по причине выше.
    """
    if parsed.ref_kind == "commit":
        return parsed.ref, "original_url"
    raw = _koji_source(info)
    if not raw:
        return None, None
    try:
        other = parse_source_url(raw)
    except SourceUrlError:
        return None, None
    if other.ref_kind != "commit":
        return None, None
    if not _same_project(other.project, parsed.project):
        return None, None
    return other.ref, "koji_source"


def collect_tag(tag: str, cfg, koji_client, gitlab_client, jobs: int = 8,
                now: Optional[str] = None,
                branch_check: bool = True) -> Snapshot:
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
            _attach_patches(build, info, cfg, gitlab_client, classifier,
                            branch_check)
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
    # Билды, у которых original_url нет, а верхнеуровневый source есть:
    # формально мы могли бы восстановить им и проект, и коммит, но тогда
    # билд перестал бы быть no-source и получил бы from-commit — метка
    # строки и фильтр поехали бы. Число показывает, стоит ли заводить
    # под это отдельную работу.
    orphan_source = sum(1 for info in infos
                        if not _original_url(info) and _koji_source(info))
    _log_summary(snapshot, time.monotonic() - started, orphan_source)
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
                    classifier: Classifier,
                    branch_check: bool = True) -> None:
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

    commit, commit_from = _commit_of(info, parsed)
    build.source = Source(
        raw=raw_url, host=parsed.host, project=parsed.project, ref=parsed.ref,
        ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref),
        commit=commit, commit_source=commit_from,
        commit_url=gitlab_client.tree_url(parsed.host, parsed.project, commit))

    ref, result = _read_patch_dir(build, gitlab_client, parsed, commit)
    if ref != commit:
        # откат на ветку: коммита в репозитории нет, и сравнивать с ним
        # ветку бессмысленно — точка отсчёта пропала вместе с коммитом
        commit = None
    build.patches_ref = ref
    build.patch_dir_present = result.present
    if result.problem:
        # проблема не обязательно означает, что читать нечего: подменённый
        # хост отдаёт и заметку, и настоящее дерево патчей. У неудачных
        # чтений paths и так пустой.
        build.problems.append(result.problem)
    for path in result.paths:
        build.patches.append(_patch(path, parsed, ref, classifier,
                                    gitlab_client))

    # Сравнивать есть с чем, только когда билд собран с ветки: у сборки
    # прямо с коммита ветки нет, а без хеша нет и точки отсчёта.
    if not (branch_check and commit and parsed.ref_kind == "branch"):
        return
    ahead = gitlab_client.compare(parsed.host, parsed.project, commit,
                                  parsed.ref)
    if ahead.problem:
        build.problems.append(ahead.problem)
        return
    build.source.branch_head = ahead.head
    build.source.commits_ahead = ahead.ahead

    if not build.source.commits_ahead:
        return
    # Дерево коммита не прочиталось вовсе (сетевой отказ, 500, исчерпанные
    # ретраи 429) — result.present is None, а built.blobs в _ghosts пуст.
    # Посчитай мы ghost-и по такому дереву, каждый файл на вершине ветки
    # ушёл бы в сторону "branch" — «влит, но не собран», — хотя на деле мы
    # просто не знаем, что лежало в коммите: фабрикация, а не находка.
    # commits_ahead уже записан и не трогается: число коммитов не зависит
    # от чтения дерева патчей и остаётся верным само по себе — то, что
    # ветка ушла вперёд, известно, даже если неизвестно, что именно она
    # принесла.
    #
    # result.present is False — легитимно пустое дерево (ветка есть,
    # каталога PATCH в коммите нет), и сравнение с веткой по нему верно:
    # тогда каждый файл ветки — и правда несобранный ghost. Поэтому
    # ограничиваемся ровно случаем «неизвестно», а не любым пустым built.
    if result.present is None:
        return
    tip = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    if tip.problem:
        build.problems.append(tip.problem)
        return
    build.ghost_patches = _ghosts(result, tip, parsed, commit, classifier,
                                  gitlab_client)


# Единственный ответ дерева, по которому видно, что коммита в репозитории
# уже нет: его выдаёт доразбор 404 в GitlabClient. Отказ сети выглядит
# иначе, и путать их нельзя — на отказе сети чтение ветки ничего не
# исправит, а патчи с ветки, выданные за патчи коммита, соврут.
#
# Сравниваем суффиксом, а не полным равенством: при подмене хоста
# GitlabClient._fetch приписывает свою заметку впереди («host не описан в
# конфиге, запрошен ...; gitlab: ref not found»), и точное равенство эту
# комбинацию бы не узнало. Строка рождается в одном месте
# (_resolve_missing_tree), а _fetch только дописывает к ней спереди — маркер
# всегда остаётся в конце, и ложных срабатываний суффикс не даёт.
_REF_GONE = "gitlab: ref not found"


def _read_patch_dir(build, gitlab_client, parsed, commit):
    """Дерево патчей билда и ref, с которого оно снято.

    Патчи билда — это то, что лежало в PATCH на коммите сборки. На ветку
    откатываемся, только когда хеша нет вовсе или когда коммита в
    репозитории уже не осталось: ветку могли форс-пушнуть, а коммит —
    собрать мусором. Во втором случае данные деградировали, и молчать об
    этом нельзя — но откат имеет смысл, только если ветка вообще есть.

    У билда, собранного прямо с коммита (ref_kind == "commit"), ветки нет:
    сам commit и есть parsed.ref, единственный ref, который мы вообще
    знаем. Откатываться в этом случае некуда — второй вызов patch_files
    ушёл бы за тем же самым ref и по мемоизации вернул бы тот же самый
    отказ без единого нового запроса, а сообщение «патчи сняты с ветки»
    было бы неправдой: ветки не существует, и патчи ниоткуда не читались.
    """
    if not commit:
        return parsed.ref, gitlab_client.patch_files(parsed.host,
                                                     parsed.project, parsed.ref)
    result = gitlab_client.patch_files(parsed.host, parsed.project, commit)
    if not result.problem or not result.problem.endswith(_REF_GONE):
        return commit, result
    if parsed.ref_kind == "commit":
        build.problems.append(
            "gitlab: коммит %s недоступен, патчей нет" % commit[:12])
        return commit, result
    build.problems.append(
        "gitlab: коммит %s недоступен, патчи сняты с ветки" % commit[:12])
    return parsed.ref, gitlab_client.patch_files(parsed.host, parsed.project,
                                                 parsed.ref)


# Порядок сторон — тот же, в каком их читают на странице: сперва то, чего
# в билде не хватает, потом устаревшее, потом лишнее.
_GHOST_SIDES = ("branch", "changed", "build")


def _ghosts(built, tip, parsed, commit, classifier, gitlab_client):
    """Различие между деревом коммита и деревом вершины ветки.

    Считается по blob sha, а не по одним именам: файл с тем же именем и
    другим содержимым — это патч, переписанный после сборки, и в пакете
    лежит его прежняя редакция. Форма истории ветки на это не влияет
    никак: сравниваются деревья, а не журнал.
    """
    paths = {
        "branch": sorted(set(tip.blobs) - set(built.blobs)),
        "changed": sorted(path for path in set(tip.blobs) & set(built.blobs)
                          if tip.blobs[path] != built.blobs[path]),
        "build": sorted(set(built.blobs) - set(tip.blobs)),
    }
    out = []
    for side in _GHOST_SIDES:
        # ссылка ведёт туда, где файл есть: у стороны build его в ветке уже
        # нет, и ссылка на ветку вела бы в никуда
        ref = commit if side == "build" else parsed.ref
        for path in paths[side]:
            out.append(_patch(path, parsed, ref, classifier, gitlab_client,
                              ghost=side))
    return out


def _patch(path, parsed, ref, classifier, gitlab_client, ghost=None):
    name = os.path.basename(path)
    return Patch(path=path, name=name, cls=classifier.classify(name),
                 cves=find_cves(name), ghost=ghost,
                 web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                                ref, path))


# Проблемы, у которых после двоеточия стоит произвольный текст: в сводке их
# группируем по префиксу, иначе одна строка stderr растёт до числа билдов.
_GROUPED_PROBLEMS = ("gitlab:", "internal error:", "bad source url:")


def _log_summary(snapshot: Snapshot, elapsed: float,
                 orphan_source: int = 0) -> None:
    """Итог по тегу — то, что раньше печатал CLI своим sys.stderr.write."""
    summary = problem_summary(snapshot)
    problems = sum(1 for b in snapshot.builds if b.problems)
    details = ", ".join("%s: %d" % item for item in sorted(summary.items()))
    logger.info("%s: готово, %d билдов, %d проблемных%s, за %.1f с",
                snapshot.tag, len(snapshot.builds), problems,
                (" (%s)" % details) if details else "", elapsed)
    known = sum(1 for b in snapshot.builds if b.source and b.source.commit)
    ahead = sum(1 for b in snapshot.builds
                if b.source and b.source.commits_ahead)
    ghosts = sum(1 for b in snapshot.builds if b.ghost_patches)
    logger.info("%s: коммит известен у %d из %d, ветка ушла вперёд у %d, "
                "ghost-патчи у %d, без original_url но с source %d",
                snapshot.tag, known, len(snapshot.builds), ahead, ghosts,
                orphan_source)


def problem_summary(snapshot: Snapshot) -> Dict[str, int]:
    """Сколько раз встретилась каждая проблема — для сводки в stderr."""
    counts = {}
    for build in snapshot.builds:
        for problem in build.problems:
            key = (problem.split(":")[0]
                   if problem.startswith(_GROUPED_PROBLEMS) else problem)
            counts[key] = counts.get(key, 0) + 1
    return counts
