"""Разбор extra.source.original_url в координаты GitLab."""
import re
from collections import namedtuple

ParsedSource = namedtuple("ParsedSource", "host project ref ref_kind")

_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.I)
_ORIGIN = "origin/"
# Сборка не из git, а из готового SRPM: koji пишет сюда путь загруженного
# файла — «cli-build/1699999999.9/nginx-1.24.0-3.el9.src.rpm» — или просто
# его имя. Ни хоста, ни проекта у такого источника нет и быть не может, а
# схемы «://» в нём обычно нет тоже, поэтому проверка идёт раньше неё:
# иначе законная сборка выглядела бы как неразобранный URL.
_SRPM_RE = re.compile(r"\.src\.rpm$", re.I)


class SourceUrlError(ValueError):
    """URL билда не удалось разобрать."""


def parse_source_url(url) -> ParsedSource:
    if not isinstance(url, str) or not url.strip():
        raise SourceUrlError("пустой source url")

    rest = url.strip()
    frag = ""
    if "#" in rest:
        rest, frag = rest.split("#", 1)
    # SRPM опознаём до всего остального: у него нет ни ветки, ни коммита, и
    # разбирать его на host/project нечего. Ссылкой он тоже быть может
    # (https://.../nginx-1.24.0-3.el9.src.rpm) — тогда именем считаем
    # последний кусок пути, всё остальное к патчам отношения не имеет.
    head = rest.split("?", 1)[0].rstrip("/")
    if _SRPM_RE.search(head):
        return ParsedSource(None, None, head.rsplit("/", 1)[-1], "srpm")
    if "://" not in rest:
        raise SourceUrlError("нет схемы в %r" % url)
    rest = rest.split("://", 1)[1]
    rest = rest.split("?", 1)[0]

    head = rest.split("/", 1)[0]
    if "@" in head:
        rest = rest.split("@", 1)[1]
    if "/" not in rest:
        raise SourceUrlError("нет пути проекта в %r" % url)

    host, project = rest.split("/", 1)
    host = host.split(":", 1)[0].strip()
    project = project.strip("/")
    if project.endswith(".git"):
        project = project[:-4]
    if not host or not project:
        raise SourceUrlError("не разобрать host/project в %r" % url)

    frag = frag.strip()
    if not frag:
        return ParsedSource(host, project, None, "none")
    ref = frag[len(_ORIGIN):] if frag.startswith(_ORIGIN) else frag
    if not ref:
        return ParsedSource(host, project, None, "none")
    kind = "commit" if _SHA_RE.match(ref) else "branch"
    return ParsedSource(host, project, ref, kind)
