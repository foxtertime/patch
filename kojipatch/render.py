"""Подготовка данных страницы и подстановка их в HTML-шаблон."""
import json
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from urllib.parse import quote

from .diff import align_rpms
from .rpms import sort_rpms

logger = logging.getLogger(__name__)

PLACEHOLDER = "/*__DATA__*/"
# то же правило, что и slug() в дашборде: ключ фильтра из имени класса
# патчей. Считать его по-разному на двух сторонах нельзя — карточка класса
# вроде «C++» не нашла бы ни одной строки.
_SLUG_RE = re.compile(r"[^a-z0-9]+")
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


def slug(name: str) -> str:
    """Ключ фильтра из имени класса патчей — как slug() в дашборде."""
    return _SLUG_RE.sub("-", str(name).lower())


# Москва — UTC+3 круглый год: перехода на летнее время в России нет с 2014,
# поэтому смещение задано числом, а не через tzdata. Понадобится другая
# зона — меняется эта одна константа.
MSK_SHIFT = timedelta(hours=3)


def to_msk(value: Optional[str]) -> Optional[str]:
    """Время сборки из снапшота (UTC) в московском времени.

    Перевод делается здесь, а не при сборе: в снапшоте время остаётся тем,
    что отдал хаб, и файл читается однозначно независимо от того, кто и где
    его открыл. Дата без часа не переводится — прибавив три часа к
    неизвестному времени, мы бы утверждали то, чего не знаем.
    """
    if not value or len(value) <= 10:
        return value
    try:
        stamp = datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return value
    return (stamp + MSK_SHIFT).strftime("%Y-%m-%d %H:%M:%S")


def _inherited(build, tag: Optional[str]) -> Optional[bool]:
    """Унаследован ли билд в этот тег. None — тег билда неизвестен.

    Неизвестность отдельным значением, а не False: снапшот прежней версии
    не знает про tag_name, и объявить такие билды прямыми значило бы
    показать в дашборде утверждение, которого никто не проверял.
    """
    if build.tag_name is None or not tag:
        return None
    return build.tag_name != tag


# Порядок меток состояния после классов патчей. Он же порядок в колонке
# «теги»: сперва откуда билд, потом что не так с патчами, потом ошибки.
_STATE_TAG_ORDER = ("inherited", "no-source", "from-commit", "no-patch",
                    "gitlab-error", "internal-error")


def _tag_sort_key(tag: str, class_order: List[str]):
    """Позиция метки в строке. Классы патчей идут первыми, в порядке
    классификатора — том же, в каком стоят карточки классов."""
    if tag in class_order:
        return (0, class_order.index(tag), "")
    if tag in _STATE_TAG_ORDER:
        return (1, _STATE_TAG_ORDER.index(tag), "")
    return (2, 0, tag)


def _build_tags(build, tag: Optional[str], class_order=()) -> List[str]:
    """Метки строки, всегда в одном и том же порядке.

    Порядок здесь позиционный: колонку «теги» читают по месту, а порядок
    файлов в каталоге PATCH задаёт GitLab и он разный от репозитория к
    репозиторию. Без сортировки у одной строки первым стоял бы cve, у
    соседней sast, и колонка перестала бы читаться.
    """
    tags = []
    for patch in build.patches:
        tag_key = slug(patch.cls)
        if tag_key not in tags:
            tags.append(tag_key)
    if _inherited(build, tag):
        tags.append("inherited")
    if build.source is None:
        tags.append("no-source")
    elif build.source.ref_kind == "commit":
        tags.append("from-commit")
    if build.patch_dir_present is False:
        tags.append("no-patch")
    if any(p.startswith("gitlab:") or p.startswith("bad source")
           for p in build.problems):
        tags.append("gitlab-error")
    if any(p.startswith("internal error") for p in build.problems):
        tags.append("internal-error")
    return sorted(tags, key=lambda t: _tag_sort_key(t, list(class_order)))


def _patch_dict(patch) -> Dict[str, object]:
    return {"path": patch.path, "name": patch.name, "class": patch.cls,
            "cves": list(patch.cves), "url": patch.web_url}


def _build_row(build, koji_web, tag: Optional[str] = None,
               class_order=()) -> Dict[str, object]:
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
        "completed": to_msk(build.completed), "owner": build.owner,
        "build_id": build.build_id, "task_id": build.task_id,
        # koji_tags, а не tags: ключ tags в строке занят вычисляемыми
        # метками дашборда, и путать их нельзя
        "tagged_in": build.tag_name, "inherited": _inherited(build, tag),
        "koji_tags": list(build.tags),
        "patches": [_patch_dict(p) for p in build.patches],
        # порядок задаём здесь: дашборд режет список на блоки по смене
        # архитектуры и сам ничего не пересортировывает
        "patch_counts": counts, "rpms": sort_rpms(build.rpms),
        "patch_dir_present": build.patch_dir_present,
        "problems": list(build.problems),
        "tags": _build_tags(build, tag, class_order),
    }


def _snapshot_counts(rows, class_names) -> Dict[str, object]:
    by_class = {name: {"builds": 0, "files": 0} for name in class_names}
    with_patches = without_patches = problems = files = 0
    inherited = direct = 0
    for row in rows:
        if row["inherited"] is True:
            inherited += 1
        elif row["inherited"] is False:
            direct += 1
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
            "inherited": inherited, "direct": direct,
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
    if component.tag_changed:
        tags.append("tag-changed")
    return tags


def _diff_row(component, koji_web, old_tag=None, new_tag=None) -> Dict[str, object]:
    old, new = component.old, component.new
    shown = new or old
    return {
        "old_tagged_in": old.tag_name if old else None,
        "new_tagged_in": new.tag_name if new else None,
        "old_inherited": _inherited(old, old_tag) if old else None,
        "new_inherited": _inherited(new, new_tag) if new else None,
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
        # выровненные строки «было/стало» вместо двух отдельных списков:
        # так один и тот же подпакет стоит в обеих колонках на одной высоте,
        # и NVRA не дублируются в данных страницы
        "rpm_rows": align_rpms(old, new),
        "koji_url": _koji_url(koji_web, shown.nvr) if shown else None,
        "source_url": (shown.source.web_url
                       if shown and shown.source else None),
        "tags": _diff_tags(component),
    }


def build_page_data(snapshots, pairs, classifier) -> Dict[str, object]:
    """Собирает всё, что нужно фронтенду, в один сериализуемый словарь."""
    class_names = classifier.class_names()
    # метки классов в строке — те же slug'и, что и ключи карточек классов
    class_order = [slug(name) for name in class_names]
    snapshot_blocks = []
    for snapshot in snapshots:
        # порядок билдов в снапшоте не гарантирован — сортируем здесь
        rows = sorted((_build_row(b, snapshot.koji_web, snapshot.tag,
                                  class_order)
                       for b in snapshot.builds),
                      key=lambda row: row["name"])
        snapshot_blocks.append({
            "tag": snapshot.tag, "generated": snapshot.generated,
            "koji_web": snapshot.koji_web,
            "counts": _snapshot_counts(rows, class_names), "builds": rows})

    # koji-ссылки для всех пар строим по хабу первого снапшота: за один
    # прогон все теги собираются с одного хаба, так что это безопасно
    koji_web = snapshots[0].koji_web if snapshots else None
    pair_blocks = [{
        "old": pair.old_tag, "new": pair.new_tag, "summary": pair.is_summary,
        "counts": dict(pair.counts),
        "rows": [_diff_row(c, koji_web, pair.old_tag, pair.new_tag)
                 for c in pair.components],
    } for pair in pairs]

    logger.debug("страница: %d снапшотов, %d строк, %d пар",
                 len(snapshot_blocks),
                 sum(len(block["builds"]) for block in snapshot_blocks),
                 len(pair_blocks))
    return {"generated": snapshots[0].generated if snapshots else "",
            "patch_classes": class_names, "snapshots": snapshot_blocks,
            "pairs": pair_blocks}


def _encode(data: Dict[str, object]) -> str:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    # Безопасная вставка внутрь <script>: U+2028/U+2029 для JS —
    # разделители строк, внутри литерала их быть не должно. В самом
    # исходнике пишем их escape-последовательностями: глазом такой
    # символ не виден, а редактор, нормализующий переводы строк, его
    # молча съест.
    return (text.replace("</", "<\\/")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029"))


# СЛОМАНА и не чинится: шаблон уехал в kojipatch/build.py, плейсхолдера
# /*__DATA__*/ в dashboard.html больше нет, и любой вызов кончается
# RenderError. Никто её не зовёт — страницу собирает build_html. Чинить
# нечего: модуль целиком уходит следующей задачей, а до неё render.py жив
# ради build_page_data, на котором держится сверка с эталоном.
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
