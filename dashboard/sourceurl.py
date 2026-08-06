"""Разбор extra.source.original_url в координаты GitLab."""
import re
from collections import namedtuple

ParsedSource = namedtuple("ParsedSource", "host project ref ref_kind")

_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.I)
_ORIGIN = "origin/"


class SourceUrlError(ValueError):
    """URL билда не удалось разобрать."""


def parse_source_url(url) -> ParsedSource:
    if not isinstance(url, str) or not url.strip():
        raise SourceUrlError("пустой source url")

    rest = url.strip()
    frag = ""
    if "#" in rest:
        rest, frag = rest.split("#", 1)
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
