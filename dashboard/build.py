"""Сборка дашборда: шаблон плюс скрипты в один самодостаточный файл."""
import logging
import os
from typing import Optional

from . import __version__

logger = logging.getLogger(__name__)

PLACEHOLDER = "<!--__SCRIPTS__-->"
# Один токен на две подстановки: он стоит и в meta generator, и в заголовке
# страницы. Версия нужна в собранном файле именно потому, что файл этот
# пересылают: у того, кто его открыл, исходников под рукой нет.
VERSION_TOKEN = "__DASHBOARD_VERSION__"
ASSETS = os.path.join(os.path.dirname(__file__), "assets")
TEMPLATE_PATH = os.path.join(ASSETS, "dashboard.html")
# Порядок по зависимостям, а не по алфавиту: каждый следующий скрипт
# рассчитывает, что предыдущие уже положили себя в KP.
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "labels.js", "hash.js", "page.js", "markup.js",
           "tables.js", "cards.js", "rail.js", "files.js", "tips.js",
           "ui.js")


class BuildError(Exception):
    """Шаблон или скрипт не найден, либо в шаблоне нет плейсхолдера."""


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        raise BuildError("не прочитать %s: %s" % (path, exc))


def build_html(template_path: Optional[str] = None) -> str:
    """Собранная страница: данные в неё подгружают уже в браузере."""
    path = template_path or TEMPLATE_PATH
    template = _read(path)
    if PLACEHOLDER not in template:
        raise BuildError("в шаблоне %s нет плейсхолдера %s"
                         % (path, PLACEHOLDER))
    if VERSION_TOKEN not in template:
        raise BuildError("в шаблоне %s нет плейсхолдера %s"
                         % (path, VERSION_TOKEN))

    blocks = []
    for name in SCRIPTS:
        source = _read(os.path.join(ASSETS, "js", name))
        blocks.append("<script>\n/* %s */\n%s\n</script>" % (name, source))

    html = template.replace(PLACEHOLDER, "\n".join(blocks))
    html = html.replace(VERSION_TOKEN, __version__)
    logger.debug("страница: %d КБ", len(html) // 1024)
    return html
