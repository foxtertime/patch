"""Сборка дашборда: шаблон плюс скрипты в один самодостаточный файл."""
import json
import logging
import os
from typing import List, Optional

logger = logging.getLogger(__name__)

PLACEHOLDER = "<!--__SCRIPTS__-->"
ASSETS = os.path.join(os.path.dirname(__file__), "assets")
TEMPLATE_PATH = os.path.join(ASSETS, "dashboard.html")
# Порядок по зависимостям, а не по алфавиту: каждый следующий скрипт
# рассчитывает, что предыдущие уже положили себя в KP.
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "ui.js")


class BuildError(Exception):
    """Шаблон или скрипт не найден, либо в шаблоне нет плейсхолдера."""


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        raise BuildError("не прочитать %s: %s" % (path, exc))


def _encode(data) -> str:
    """JSON, безопасный внутри <script>.

    U+2028 и U+2029 для JS — разделители строк, внутри литерала их быть не
    должно. В самом исходнике они записаны escape-последовательностями:
    глазом такой символ не виден, а редактор, нормализующий переводы строк,
    его молча съест.
    """
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return (text.replace("</", "<\\/")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029"))


def build_html(snapshots: Optional[List] = None,
               template_path: Optional[str] = None) -> str:
    """Собранная страница. snapshots=None — пустой дашборд."""
    path = template_path or TEMPLATE_PATH
    template = _read(path)
    if PLACEHOLDER not in template:
        raise BuildError("в шаблоне %s нет плейсхолдера %s"
                         % (path, PLACEHOLDER))

    blocks = []
    if snapshots:
        from .model import snapshot_to_dict
        payload = [snapshot_to_dict(s) for s in snapshots]
        blocks.append("<script>window.KP_SNAPSHOTS = %s;</script>"
                      % _encode(payload))
    for name in SCRIPTS:
        source = _read(os.path.join(ASSETS, "js", name))
        blocks.append("<script>\n/* %s */\n%s\n</script>" % (name, source))

    html = template.replace(PLACEHOLDER, "\n".join(blocks))
    logger.debug("страница: %d КБ", len(html) // 1024)
    return html
