"""Сборка дашборда: шаблон, стили и скрипты в один самодостаточный файл."""
import logging
import os
from typing import Optional

from . import __version__

logger = logging.getLogger(__name__)

SCRIPT_PLACEHOLDER = "<!--__SCRIPTS__-->"
STYLE_PLACEHOLDER = "<!--__STYLES__-->"
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
# Порядок решает каскад: при равной специфичности выигрывает то, что ниже.
# base идёт первым — там переменные и палитра, tip последним — он всплывает
# поверх всего. Перестановка файлов здесь молча меняет вид страницы.
STYLES = ("base.css", "layout.css", "rail.css", "cards.css", "table.css",
          "tip.css")


class BuildError(Exception):
    """Шаблон или часть сборки не найдена, либо в шаблоне нет плейсхолдера."""


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        raise BuildError("не прочитать %s: %s" % (path, exc))


def _parts(kind: str, names, wrap: str) -> str:
    """Куски сборки одного вида, каждый подписан своим именем.

    Подпись нужна тому, кто открыл собранную страницу: исходников у него
    нет, а по имени видно, откуда кусок и где его править.
    """
    blocks = []
    for name in names:
        source = _read(os.path.join(ASSETS, kind, name))
        blocks.append("/* %s */\n%s" % (name, source))
    return "<%s>\n%s\n</%s>" % (wrap, "\n".join(blocks), wrap)


def build_html(template_path: Optional[str] = None) -> str:
    """Собранная страница: данные в неё подгружают уже в браузере."""
    path = template_path or TEMPLATE_PATH
    template = _read(path)
    for token in (SCRIPT_PLACEHOLDER, STYLE_PLACEHOLDER, VERSION_TOKEN):
        if token not in template:
            raise BuildError("в шаблоне %s нет плейсхолдера %s" % (path, token))

    scripts = "\n".join(
        "<script>\n/* %s */\n%s\n</script>"
        % (name, _read(os.path.join(ASSETS, "js", name)))
        for name in SCRIPTS)

    html = template.replace(SCRIPT_PLACEHOLDER, scripts)
    html = html.replace(STYLE_PLACEHOLDER, _parts("css", STYLES, "style"))
    html = html.replace(VERSION_TOKEN, __version__)
    logger.debug("страница: %d КБ", len(html) // 1024)
    return html
