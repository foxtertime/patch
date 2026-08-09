"""Генератор богатых фикстур для паритетной сверки Python и JS.

Фикстуры коммитятся; скрипт нужен, чтобы их можно было пересобрать и
чтобы было видно, какие случаи они покрывают. Запуск из корня репозитория:

    python3 tests/fixtures/make_rich_fixtures.py
"""
import hashlib
import json
import os
import sys
from dataclasses import replace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from dashboard.model import (Build, Patch, Snapshot, Source,  # noqa: E402
                             dump_snapshots, snapshot_to_dict)

CLASSES = ["AUTOGEN", "CVE", "SAST", "DAST", "COVERAGE", "SPEC",
           "CHANGELOG", "FILES", "other"]
# У четвёртого снапшота список свой: DISTSUFFIX появился позже первых трёх,
# и дописывать его в них нельзя — rich-old.json и rich-new.json порождают
# эталон page-data.golden.json, который пересобрать уже нечем. Страница
# складывает списки всех загруженных снапшотов, поэтому новый класс доедет
# до карточек и фильтров и так — хвостом, за перечисленными.
CLASSES_WITH_DISTSUFFIX = ["AUTOGEN", "CVE", "SAST", "DAST", "COVERAGE",
                           "DISTSUFFIX", "SPEC", "CHANGELOG", "FILES",
                           "other"]
# У пятого и дальше — свой: LICENSE появился ещё позже DISTSUFFIX, и в
# снапшотах, собранных до него, его нет. Так же выглядит и жизнь: снапшоты
# копятся годами, а классы в дашборд добавляют по ходу.
CLASSES_WITH_LICENSE = ["AUTOGEN", "CVE", "SAST", "DAST", "COVERAGE",
                        "DISTSUFFIX", "LICENSE", "SPEC", "CHANGELOG",
                        "FILES", "other"]

# Ссылки демонстрационного билда httpd (собран с коммита, ghost-патчи всех
# трёх сторон): короткие постоянные рядом с остальными в шапке, чтобы
# длинные адреса не расползались по строкам самих Build().
BLOB = ("https://gitlab.example.com/g/httpd/-/blob/"
        "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122/PATCH/%s")
BLOB_BRANCH = "https://gitlab.example.com/g/httpd/-/blob/os-9.4/PATCH/%s"


def src(project, ref, kind="branch"):
    return Source(raw="git+https://gl/%s?#%s" % (project, ref), host="gl",
                  project=project, ref=ref, ref_kind=kind,
                  web_url="https://gl/%s/-/tree/%s" % (project, ref))


def srpm(name):
    """Источник билда, собранного не из git, а из готового SRPM.

    Ни хоста, ни проекта у такого источника нет и быть не может: koji
    пишет сюда путь загруженного файла. Каталог PATCH читать негде, и
    patch_dir_present у такого билда остаётся None — «неизвестно», а не
    «патчей нет».
    """
    return Source(raw="cli-build/1730000000.5/" + name, project=None,
                  ref=name, ref_kind="srpm")


def patch(name, cls, cves=()):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=list(cves),
                 web_url="https://gl/blob/PATCH/" + name)


def blob(project, ref, name):
    return "https://gl/%s/-/blob/%s/PATCH/%s" % (project, ref, name)


def pat(project, ref, name, cls, cves=(), ghost=None):
    """Патч со ссылкой на то состояние репозитория, из которого он прочитан.

    Ref здесь не украшение: у патчей билда и у ghost-стороны build он
    коммит, у сторон branch и changed — ветка, ровно так же их строит
    collect. Фикстура, разошедшаяся с коллектором, перестаёт быть
    демонстрацией и становится выдумкой.
    """
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=list(cves),
                 ghost=ghost, web_url=blob(project, ref, name))


def src_at(project, branch, commit, ahead=0, head=None):
    """Источник билда с ветки, у которого известен коммит сборки.

    head по умолчанию равен коммиту: ветка стоит там же, где её оставила
    сборка, и это самый обычный случай, а не редкость.
    """
    return Source(raw="git+https://gl/%s?#%s" % (project, branch), host="gl",
                  project=project, ref=branch, ref_kind="branch",
                  web_url="https://gl/%s/-/tree/%s" % (project, branch),
                  commit=commit,
                  commit_url="https://gl/%s/-/tree/%s" % (project, commit),
                  commit_source="koji_source",
                  branch_head=head or commit, commits_ahead=ahead)


def same(prev, name, tag, **changes):
    """Тот же билд в следующем снапшоте: берём его из предыдущего и меняем
    только то, что действительно изменилось.

    Так в фикстуре видно, где разница задумана, а где её нет; переписанный
    заново билд разъезжается с прежним по мелочи — по времени сборки, по
    списку подпакетов, — и дашборд честно показывает изменение, которого
    никто не хотел показать.

    Тег по умолчанию прямой: снапшот берут за тем, чтобы билд в нём висел.
    Унаследованному передают tag_name и tags руками.
    """
    changes.setdefault("tag_name", tag)
    changes.setdefault("tags", [tag])
    return replace(prev[name], **changes)


def old_snapshot():
    return Snapshot(
        tag="os-9.1", generated="2026-07-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES),
        builds=[
            # прямой тег, три класса патчей, четыре архитектуры
            Build(nvr="nginx-1.24.0-3.el9", name="nginx", version="1.24.0",
                  release="3.el9", build_id=101, task_id=201, owner="builder",
                  completed="2026-05-14 21:30:00", tag_name="os-9.1",
                  tags=["os-9.1"], source=src("web/nginx", "os-9.1"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("autogen-sast-patches.inc.new", "AUTOGEN"),
                           patch("nginx.spec.patch", "SPEC")],
                  rpms=["nginx-1.24.0-3.el9.x86_64",
                        "nginx-core-1.24.0-3.el9.x86_64",
                        "nginx-1.24.0-3.el9.src",
                        "nginx-filesystem-1.24.0-3.el9.noarch"]),
            # унаследован из родителя, эпоха, сборка с коммита, ошибка GitLab
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.0", tags=["os-9.0", "os-9.1"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # тег неизвестен, внутренняя ошибка, дата без времени
            Build(nvr="vim-9.0-1.el9", name="vim", version="9.0",
                  release="1.el9", build_id=103, owner="editor",
                  completed="2026-05-14", tag_name=None, tags=[],
                  source=None, patch_dir_present=None,
                  patches=[patch("coverage-vim.patch", "COVERAGE")],
                  rpms=["vim-9.0-1.el9.x86_64"],
                  problems=["internal error: boom"]),
            # откат версии в новом теге, неразбираемое время
            Build(nvr="zlib-1.3-2.el9", name="zlib", version="1.3",
                  release="2.el9", build_id=104, owner="builder",
                  completed="никогда", tag_name="os-9.1", tags=["os-9.1"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-2.el9.x86_64", "zlib-1.3-2.el9.src"]),
        ])


def new_snapshot():
    return Snapshot(
        tag="os-9.2", generated="2026-08-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES),
        builds=[
            # версия выросла, патчи пришли и ушли, ветка сменилась,
            # подпакет исчез и появился на новой архитектуре
            Build(nvr="nginx-1.26.0-1.el9", name="nginx", version="1.26.0",
                  release="1.el9", build_id=111, task_id=211, owner="builder",
                  completed="2026-07-30 23:45:00", tag_name="os-9.2",
                  tags=["os-9.2"], source=src("web/nginx", "os-9.2"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("dast-fuzz.patch", "DAST")],
                  rpms=["nginx-1.26.0-1.el9.x86_64",
                        "nginx-core-1.26.0-1.el9.x86_64",
                        "nginx-1.26.0-1.el9.src",
                        "nginx-mod-http-1.26.0-1.el9.aarch64"]),
            # тот же билд переехал в другой тег: был унаследован — стал прямым
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.2", tags=["os-9.2"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # откат: 1.3-2 → 1.3-1
            Build(nvr="zlib-1.3-1.el9", name="zlib", version="1.3",
                  release="1.el9", build_id=114, owner="builder",
                  completed="никогда", tag_name="os-9.2", tags=["os-9.2"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-1.el9.x86_64", "zlib-1.3-1.el9.src"]),
            # новый компонент
            Build(nvr="curl-8.0-1.el9", name="curl", version="8.0",
                  release="1.el9", build_id=115, owner="net",
                  completed="2026-07-31 00:10:00", tag_name="os-9.2",
                  tags=["os-9.2"], source=src("core/curl", "os-9.2"),
                  patch_dir_present=True,
                  patches=[patch("source.tar.gz", "FILES")],
                  rpms=["curl-8.0-1.el9.x86_64"]),
            # vim в новом теге отсутствует — компонент исчез
        ])


def newer_snapshot():
    """Третий тег цепочки. Он нужен не тестам, а глазам: на двух снапшотах
    не видно ни сводной пары, ни рельса из трёх узлов, ни того, зачем
    сводная пара вообще существует.

    Поэтому здесь сознательно собраны случаи, которые видны только на
    трёх тегах: vim уходил в os-9.2 и вернулся тем же билдом, zlib
    откатывался и поднялся обратно на прежний релиз. По шагам оба
    двигались, а сводная пара os-9.1 → os-9.3 честно скажет, что ничего
    не изменилось.
    """
    return Snapshot(
        tag="os-9.3", generated="2026-09-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES),
        builds=[
            # версия выросла ещё раз; spec-патч вернулся, fuzz ушёл
            Build(nvr="nginx-1.26.2-1.el9", name="nginx", version="1.26.2",
                  release="1.el9", build_id=121, task_id=221, owner="builder",
                  completed="2026-08-28 09:15:00", tag_name="os-9.3",
                  tags=["os-9.3"], source=src("web/nginx", "os-9.3"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("CVE-2025-1111.patch", "CVE",
                                 ["CVE-2025-1111"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("nginx.spec.patch", "SPEC")],
                  rpms=["nginx-1.26.2-1.el9.x86_64",
                        "nginx-core-1.26.2-1.el9.x86_64",
                        "nginx-1.26.2-1.el9.src",
                        "nginx-mod-http-1.26.2-1.el9.aarch64"]),
            # тот же билд снова унаследован: в os-9.2 он был затегован прямо
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.2", tags=["os-9.2", "os-9.3"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # релиз вернулся к тому, что был в os-9.1
            Build(nvr="zlib-1.3-2.el9", name="zlib", version="1.3",
                  release="2.el9", build_id=104, owner="builder",
                  completed="никогда", tag_name="os-9.3", tags=["os-9.3"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-2.el9.x86_64", "zlib-1.3-2.el9.src"]),
            # вернулся тем же билдом: тег по-прежнему неизвестен, но
            # внутренняя ошибка ушла — видно по карточке «с проблемами»
            Build(nvr="vim-9.0-1.el9", name="vim", version="9.0",
                  release="1.el9", build_id=103, owner="editor",
                  completed="2026-05-14", tag_name=None, tags=[],
                  source=None, patch_dir_present=None,
                  patches=[patch("coverage-vim.patch", "COVERAGE")],
                  rpms=["vim-9.0-1.el9.x86_64"]),
            # крупный компонент: стек патчей заметно двигает сводку, а
            # подпакеты расходятся по четырём архитектурам
            Build(nvr="kernel-5.14.0-611.el9", name="kernel",
                  version="5.14.0", release="611.el9", build_id=130,
                  task_id=230, owner="kernel",
                  completed="2026-08-30 03:40:00", tag_name="os-9.3",
                  tags=["os-9.3"], source=src("core/kernel", "os-9.3"),
                  patch_dir_present=True,
                  patches=[patch("autogen-cve-patches.inc.new", "AUTOGEN"),
                           patch("CVE-2025-2001.patch", "CVE",
                                 ["CVE-2025-2001"]),
                           patch("CVE-2025-2002.patch", "CVE",
                                 ["CVE-2025-2002"]),
                           patch("CVE-2025-2003.patch", "CVE",
                                 ["CVE-2025-2003"]),
                           patch("sast-kernel-net.patch", "SAST"),
                           patch("sast-kernel-fs.patch", "SAST"),
                           patch("dast-kernel-fuzz.patch", "DAST"),
                           patch("coverage-kernel.patch", "COVERAGE"),
                           patch("kernel.spec.patch", "SPEC"),
                           patch("linux-5.14.0.tar.gz", "FILES")],
                  rpms=["kernel-5.14.0-611.el9.src",
                        "kernel-doc-5.14.0-611.el9.noarch",
                        "kernel-5.14.0-611.el9.x86_64",
                        "kernel-core-5.14.0-611.el9.x86_64",
                        "kernel-modules-5.14.0-611.el9.x86_64",
                        "kernel-5.14.0-611.el9.aarch64"]),
            # curl, появившийся в os-9.2, исчез: в сводную пару
            # os-9.1 → os-9.3 он не попадёт вовсе — его нет ни на одном
            # её конце
        ])


def newest_snapshot():
    """Четвёртый тег цепочки. Он тоже для глаз, и показывает то, чего не
    показывают три.

    Первое — класс DISTSUFFIX: он появился позже первых трёх снапшотов, и
    ни одного такого патча в них нет. Здесь их два, и один нарочно назван
    kernel.spec.distsuffix.patch — файл со «спековым» именем, который всё
    равно уходит в DISTSUFFIX, потому что класс отвечает на вопрос «зачем
    патч».

    Второе — диапазон, который не сводный и не соседний. На трёх узлах
    такого нет вовсе: os-9.1 → os-9.3 и есть вся цепочка. Здесь curl,
    появившийся в os-9.2 и исчезнувший в os-9.3, возвращается тем же
    билдом: диапазон os-9.2 → os-9.4 скажет про него «не изменилось»,
    сводный os-9.1 → os-9.4 — «появился», а соседние — «исчез» и снова
    «появился».

    Третье — время. Собран снапшот через восемь часов после os-9.3, а не
    через месяц: на рельсе видно, что расстояние между узлами меряется той
    единицей, которая ему подходит.
    """
    return Snapshot(
        tag="os-9.4", generated="2026-09-01T08:15:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_DISTSUFFIX),
        builds=[
            # выросла одна релизная часть, и пришёл патч суффикса сборки
            Build(nvr="nginx-1.26.2-2.el9", name="nginx", version="1.26.2",
                  release="2.el9", build_id=131, task_id=231, owner="builder",
                  completed="2026-09-01 06:20:00", tag_name="os-9.4",
                  tags=["os-9.4"], source=src("web/nginx", "os-9.4"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("CVE-2025-1111.patch", "CVE",
                                 ["CVE-2025-1111"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("nginx.spec.patch", "SPEC"),
                           patch("nginx-distsuffix.patch", "DISTSUFFIX")],
                  rpms=["nginx-1.26.2-2.el9.x86_64",
                        "nginx-core-1.26.2-2.el9.x86_64",
                        "nginx-1.26.2-2.el9.src",
                        "nginx-mod-http-1.26.2-2.el9.aarch64"]),
            # не менялся с os-9.2: тот же билд, унаследован
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.2", tags=["os-9.2", "os-9.4"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # не менялся с os-9.3
            Build(nvr="zlib-1.3-2.el9", name="zlib", version="1.3",
                  release="2.el9", build_id=104, owner="builder",
                  completed="никогда", tag_name="os-9.4", tags=["os-9.4"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-2.el9.x86_64", "zlib-1.3-2.el9.src"]),
            # не менялся с os-9.3
            Build(nvr="vim-9.0-1.el9", name="vim", version="9.0",
                  release="1.el9", build_id=103, owner="editor",
                  completed="2026-05-14", tag_name=None, tags=[],
                  source=None, patch_dir_present=None,
                  patches=[patch("coverage-vim.patch", "COVERAGE")],
                  rpms=["vim-9.0-1.el9.x86_64"]),
            # стек патчей поредел: две CVE закрыты и ушли, зато пришёл
            # патч суффикса сборки — и назван он по-спековому, а класс у
            # него всё равно DISTSUFFIX
            Build(nvr="kernel-5.14.0-620.el9", name="kernel",
                  version="5.14.0", release="620.el9", build_id=140,
                  task_id=240, owner="kernel",
                  completed="2026-09-01 05:05:00", tag_name="os-9.4",
                  tags=["os-9.4"], source=src("core/kernel", "os-9.4"),
                  patch_dir_present=True,
                  patches=[patch("autogen-cve-patches.inc.new", "AUTOGEN"),
                           patch("CVE-2025-2003.patch", "CVE",
                                 ["CVE-2025-2003"]),
                           patch("sast-kernel-net.patch", "SAST"),
                           patch("sast-kernel-fs.patch", "SAST"),
                           patch("dast-kernel-fuzz.patch", "DAST"),
                           patch("coverage-kernel.patch", "COVERAGE"),
                           patch("kernel.spec.distsuffix.patch", "DISTSUFFIX"),
                           patch("kernel.spec.patch", "SPEC"),
                           patch("linux-5.14.0.tar.gz", "FILES")],
                  rpms=["kernel-5.14.0-620.el9.src",
                        "kernel-doc-5.14.0-620.el9.noarch",
                        "kernel-5.14.0-620.el9.x86_64",
                        "kernel-core-5.14.0-620.el9.x86_64",
                        "kernel-modules-5.14.0-620.el9.x86_64",
                        "kernel-5.14.0-620.el9.aarch64"]),
            # вернулся тем же билдом, каким был в os-9.2
            Build(nvr="curl-8.0-1.el9", name="curl", version="8.0",
                  release="1.el9", build_id=115, owner="net",
                  completed="2026-07-31 00:10:00", tag_name="os-9.4",
                  tags=["os-9.4"], source=src("core/curl", "os-9.2"),
                  patch_dir_present=True,
                  patches=[patch("source.tar.gz", "FILES")],
                  rpms=["curl-8.0-1.el9.x86_64"]),
        ])


def again_snapshot():
    """Тот же тег, собранный второй раз.

    До сих пор в фикстурах на каждый тег приходился ровно один сбор, а
    снапшот опознаётся парой «тег и время сбора» — и половина этой пары
    нигде не работала. Здесь os-9.4 собран через месяц после первого раза:
    на рельсе два узла с одним именем, и сравнить их между собой — это
    вопрос «что за месяц случилось с тегом», ради которого пара и заведена.

    Заодно здесь то, чего не показывает вся прежняя цепочка: компонент
    пересобран другим владельцем и из переехавшей в другую группу GitLab
    ветки — обе строки карточка изменения показывает обеими сторонами. И
    сборка без владельца и без времени сборки: колонке «владелец» есть чем
    заполнить пустое место, и лучше это увидеть на фикстуре, чем на живом
    теге.
    """
    prev = newest_snapshot().by_name()
    return Snapshot(
        tag="os-9.4", generated="2026-10-01T09:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            # пересобран внутри того же тега: релиз вырос, закрылась ещё
            # одна дыра
            Build(nvr="nginx-1.26.2-3.el9", name="nginx", version="1.26.2",
                  release="3.el9", build_id=141, task_id=241, owner="builder",
                  completed="2026-09-24 18:05:00", tag_name="os-9.4",
                  tags=["os-9.4"], source=src("web/nginx", "os-9.4"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("CVE-2025-1111.patch", "CVE",
                                 ["CVE-2025-1111"]),
                           patch("CVE-2025-1112.patch", "CVE",
                                 ["CVE-2025-1112"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("nginx.spec.patch", "SPEC"),
                           patch("nginx-distsuffix.patch", "DISTSUFFIX")],
                  rpms=["nginx-1.26.2-3.el9.x86_64",
                        "nginx-core-1.26.2-3.el9.x86_64",
                        "nginx-1.26.2-3.el9.src",
                        "nginx-mod-http-1.26.2-3.el9.aarch64"]),
            # пересобран с того же коммита, но другим человеком и из
            # переехавшего в другую группу проекта. Владельца у сборки не
            # меняют — его меняет пересборка, поэтому здесь новый билд, а не
            # прежний с новым именем в поле. Ветка та же, и метки
            # branch-changed тут быть не должно, зато карточка изменения
            # покажет обе стороны и у владельца, и у проекта
            Build(nvr="httpd-2.4.62-2.el9", name="httpd", version="2.4.62",
                  release="2.el9", epoch=1, build_id=143, task_id=243,
                  owner="httpd-team", completed="2026-09-30 12:00:00",
                  tag_name="os-9.4", tags=["os-9.4"],
                  source=src("apps/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-2.el9.x86_64"]),
            # пересобран руками из готового SRPM: ветки у такого билда
            # нет, каталог PATCH читать негде, и патчи из строки уходят
            # вместе с источником. Это не проблема, а другой способ
            # собрать, и метка в строке говорит именно это
            Build(nvr="zlib-1.3-3.el9", name="zlib", version="1.3",
                  release="3.el9", build_id=144, task_id=244,
                  owner="builder", completed="2026-09-29 07:30:00",
                  tag_name="os-9.4", tags=["os-9.4"],
                  source=srpm("zlib-1.3-3.el9.src.rpm"),
                  patch_dir_present=None, patches=[],
                  rpms=["zlib-1.3-3.el9.x86_64", "zlib-1.3-3.el9.src"]),
            # не менялся
            same(prev, "vim", "os-9.4", tag_name=None, tags=[]),
            # тот же NVR, но подпакеты пересобраны иначе — «переупакован», и
            # к этому добавилась внутренняя ошибка сбора
            same(prev, "kernel", "os-9.4",
                 rpms=["kernel-5.14.0-620.el9.src",
                       "kernel-doc-5.14.0-620.el9.noarch",
                       "kernel-5.14.0-620.el9.x86_64",
                       "kernel-core-5.14.0-620.el9.x86_64",
                       "kernel-modules-5.14.0-620.el9.x86_64",
                       "kernel-modules-extra-5.14.0-620.el9.x86_64",
                       "kernel-5.14.0-620.el9.aarch64"],
                 problems=["internal error: koji не ответил за 60 с"]),
            # не менялся
            same(prev, "curl", "os-9.4"),
            # собран роботом: владельца koji не назвал, времени сборки тоже
            Build(nvr="openssl-3.2.1-1.el9", name="openssl", version="3.2.1",
                  release="1.el9", build_id=142, task_id=242, owner=None,
                  completed=None, tag_name="os-9.4", tags=["os-9.4"],
                  source=src("core/openssl", "os-9.4"), patch_dir_present=True,
                  patches=[patch("CVE-2025-3001.patch", "CVE",
                                 ["CVE-2025-3001"]),
                           patch("openssl-distsuffix.patch", "DISTSUFFIX")],
                  rpms=["openssl-3.2.1-1.el9.x86_64",
                        "openssl-libs-3.2.1-1.el9.x86_64",
                        "openssl-3.2.1-1.el9.src"]),
        ])


def mirror_snapshot():
    """Снапшот с другого koji-хаба.

    Хаб у снапшота свой, и страница про это предупреждает: сравнивать сборки
    разных хабов обычно бессмысленно, но бывает и наоборот — переезд, зеркало,
    — поэтому снапшот принимается, а предупреждение всплывает окошком. До сих
    пор ни одна фикстура его не поднимала, и увидеть это окошко было не на чем.

    Второе, что видно только здесь: ссылка на сборку в koji берётся у того
    снапшота, из которого сборка приехала, а не у первого загруженного. В
    паре os-9.4 → os-9.5 левая сторона ведёт на прежний хаб, правая — на
    зеркало.
    """
    prev = again_snapshot().by_name()
    return Snapshot(
        tag="os-9.5", generated="2026-10-15T12:00:00+03:00",
        koji_hub="https://mirror/kojihub", koji_web="https://mirror/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            # версия выросла
            Build(nvr="nginx-1.27.0-1.el9", name="nginx", version="1.27.0",
                  release="1.el9", build_id=151, task_id=251, owner="builder",
                  completed="2026-10-12 11:40:00", tag_name="os-9.5",
                  tags=["os-9.5"], source=src("web/nginx", "os-9.5"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2025-1112.patch", "CVE",
                                 ["CVE-2025-1112"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("nginx.spec.patch", "SPEC"),
                           patch("nginx-distsuffix.patch", "DISTSUFFIX")],
                  rpms=["nginx-1.27.0-1.el9.x86_64",
                        "nginx-core-1.27.0-1.el9.x86_64",
                        "nginx-1.27.0-1.el9.src",
                        "nginx-mod-http-1.27.0-1.el9.aarch64"]),
            same(prev, "httpd", "os-9.5", tag_name="os-9.4",
                 tags=["os-9.4", "os-9.5"]),
            same(prev, "zlib", "os-9.5"),
            same(prev, "vim", "os-9.5", tag_name=None, tags=[]),
            same(prev, "kernel", "os-9.5"),
            same(prev, "curl", "os-9.5"),
            # унаследован из os-9.4: на зеркале прямо его не тегировали
            same(prev, "openssl", "os-9.5", tag_name="os-9.4",
                 tags=["os-9.4", "os-9.5"]),
        ])


def wide_snapshot():
    """Снапшот с широкими значениями.

    Таблица разъезжается не на ровных данных, а на неудобных: на сборке, у
    которой метки не влезают в свою ячейку, на сорокасимвольном хеше
    коммита, на длинном пути проекта и на двух десятках подпакетов. В живом
    теге такая сборка одна на сотню, и попадается она позже, чем вёрстку
    правят.

    Здесь она есть нарочно: у chromium патчи всех классов сразу, обе ошибки
    — и GitLab, и внутренняя, — унаследованный тег и сборка с коммита. Меток
    выходит полтора десятка, и это ровно тот случай, ради которого им
    разрешили переноситься.
    """
    prev = mirror_snapshot().by_name()
    commit = "9f1c0b5a3d7e46b2c81f0a4d6e29b357ca8d1f04"
    return Snapshot(
        tag="os-9.6", generated="2026-11-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            same(prev, "nginx", "os-9.6"),
            same(prev, "httpd", "os-9.6", tag_name="os-9.4",
                 tags=["os-9.4", "os-9.6"]),
            same(prev, "zlib", "os-9.6"),
            same(prev, "vim", "os-9.6", tag_name=None, tags=[]),
            same(prev, "kernel", "os-9.6"),
            same(prev, "curl", "os-9.6"),
            same(prev, "openssl", "os-9.6"),
            # всё сразу: каждый класс патчей, обе ошибки, унаследованный тег,
            # сборка с коммита, длинный путь проекта и двадцать подпакетов
            Build(nvr="chromium-131.0.6778.204-1.el9", name="chromium",
                  version="131.0.6778.204", release="1.el9", build_id=160,
                  task_id=260, owner="browser-team",
                  completed="2026-10-30 02:55:00", tag_name="os-9.5",
                  tags=["os-9.5", "os-9.6"],
                  source=src("desktop/browsers/chromium-browser-upstream",
                             commit, kind="commit"),
                  patch_dir_present=True,
                  patches=[patch("autogen-sast-patches.inc.new", "AUTOGEN"),
                           patch("CVE-2025-4001.patch", "CVE",
                                 ["CVE-2025-4001", "CVE-2025-4002",
                                  "CVE-2025-4003"]),
                           patch("sast-chromium-ipc.patch", "SAST"),
                           patch("dast-chromium-fuzz.patch", "DAST"),
                           patch("coverage-chromium.patch", "COVERAGE"),
                           patch("chromium-distsuffix.patch", "DISTSUFFIX"),
                           patch("chromium-license.patch", "LICENSE"),
                           patch("chromium.spec.patch", "SPEC"),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("chromium-131.0.6778.204.tar.xz", "FILES"),
                           patch("no-idea-what-this-is.diff", "other")],
                  rpms=["chromium-131.0.6778.204-1.el9.src",
                        "chromium-131.0.6778.204-1.el9.x86_64",
                        "chromium-common-131.0.6778.204-1.el9.x86_64",
                        "chromium-headless-131.0.6778.204-1.el9.x86_64",
                        "chromium-libs-131.0.6778.204-1.el9.x86_64",
                        "chromium-libs-media-131.0.6778.204-1.el9.x86_64",
                        "chromedriver-131.0.6778.204-1.el9.x86_64",
                        "chromium-131.0.6778.204-1.el9.aarch64",
                        "chromium-common-131.0.6778.204-1.el9.aarch64",
                        "chromium-headless-131.0.6778.204-1.el9.aarch64",
                        "chromium-libs-131.0.6778.204-1.el9.aarch64",
                        "chromium-libs-media-131.0.6778.204-1.el9.aarch64",
                        "chromedriver-131.0.6778.204-1.el9.aarch64",
                        "chromium-131.0.6778.204-1.el9.ppc64le",
                        "chromium-common-131.0.6778.204-1.el9.ppc64le",
                        "chromium-libs-131.0.6778.204-1.el9.ppc64le",
                        "chromium-131.0.6778.204-1.el9.s390x",
                        "chromium-common-131.0.6778.204-1.el9.s390x",
                        "chromium-libs-131.0.6778.204-1.el9.s390x",
                        "chromium-doc-131.0.6778.204-1.el9.noarch"],
                  problems=["gitlab: 403 на каталоге PATCH",
                            "internal error: не разобрать changelog.yaml"]),
        ])


# Имена настоящие и стоят вперемешку: отсортированную таблицу должна
# складывать страница, а не порядок в фикстуре.
MANY = (
    "bash", "coreutils", "systemd", "glibc", "gcc", "binutils", "make",
    "python3", "perl", "ruby", "rust", "golang", "nodejs", "php", "lua",
    "openldap", "cyrus-sasl", "krb5", "pam", "shadow-utils", "sudo",
    "audit", "selinux-policy", "policycoreutils", "libselinux", "libsemanage",
    "rpm", "dnf", "libdnf", "librepo", "createrepo_c", "libsolv",
    "sqlite", "libxml2", "libxslt", "expat", "json-c", "libyaml",
    "openssh", "gnutls", "nss", "libgcrypt", "gpgme", "p11-kit",
    "postgresql", "mariadb", "redis", "memcached", "rabbitmq-server",
    "tomcat", "java-17-openjdk", "maven", "ant", "log4j",
    "dbus", "polkit", "udisks2", "upower", "NetworkManager", "firewalld",
    "iproute", "iptables", "nftables", "bind", "dhcp", "chrony",
    "grub2", "shim", "dracut", "kmod", "lvm2", "device-mapper",
    "e2fsprogs", "xfsprogs", "btrfs-progs", "parted", "util-linux",
    "tar", "gzip", "bzip2", "xz", "zstd", "cpio", "unzip",
    "vim-enhanced", "emacs", "nano", "less", "grep", "sed", "gawk",
    "findutils", "diffutils", "patch", "which", "file", "procps-ng",
)

OWNERS = ("builder", "core", "net", "kernel", "release-bot")
ARCHES = ("x86_64", "aarch64", "ppc64le", "s390x")


def many_builds():
    """Сотня сборок, разложенных по кругу.

    Правила зависят только от номера: тот же скрипт даёт тот же файл, и
    разница между двумя запусками означала бы, что изменился генератор, а не
    случайное число.
    """
    out = []
    for i, name in enumerate(MANY):
        version = "%d.%d" % (1 + i % 7, i % 13)
        release = "%d.el9" % (1 + i % 4)
        nvr = "%s-%s-%s" % (name, version, release)
        inherited = i % 7 == 3
        # Сорок символов хеша — не украшение: колонка источника на них
        # разъезжалась, и пусть в сотне строк они попадаются, как в жизни.
        ref = hashlib.sha1(name.encode("utf-8")).hexdigest()
        if i % 9 == 4:
            source = None
        elif i % 5 == 2:
            source = src("core/" + name, ref, kind="commit")
        else:
            source = src("core/" + name, "os-9.7")
        patches, problems = [], []
        # Без исходников каталог PATCH читать негде: у такой сборки не «нет
        # патчей», а «неизвестно», и патчей у неё не бывает вовсе.
        has_dir = None if source is None else i % 4 != 3
        if has_dir and i % 3 != 1:
            cls = CLASSES_WITH_LICENSE[i % len(CLASSES_WITH_LICENSE)]
            if cls == "CVE":
                patches.append(patch("CVE-2025-%04d.patch" % (5000 + i), "CVE",
                                     ["CVE-2025-%04d" % (5000 + i)]))
            else:
                patches.append(patch("%s-%s.patch" % (cls.lower(), name), cls))
            if i % 6 == 0:
                patches.append(patch("%s.spec.patch" % name, "SPEC"))
        if i % 11 == 0:
            problems.append("gitlab: 404 на дереве ветки")
        if i % 13 == 5:
            problems.append("internal error: сборка без исходников")
        rpms = ["%s.%s" % (nvr, ARCHES[j])
                for j in range(1 + i % len(ARCHES))]
        rpms.append(nvr + ".src")
        out.append(Build(
            nvr=nvr, name=name, version=version, release=release,
            build_id=300 + i, task_id=400 + i, owner=OWNERS[i % len(OWNERS)],
            completed="2026-11-%02d %02d:%02d:00" % (1 + i % 28, i % 24,
                                                     (i * 7) % 60),
            tag_name="os-9.6" if inherited else "os-9.7",
            tags=["os-9.6", "os-9.7"] if inherited else ["os-9.7"],
            source=source, patch_dir_present=has_dir,
            patches=patches, rpms=rpms, problems=problems))
    return out


def many_snapshot():
    """Тег величиной с настоящий.

    В прежних снапшотах сборок пять-шесть, и на них не видно ничего из того,
    что делает страница на живом теге: сортировка меняет порядок сотни
    строк, поиск отсекает, а не подсвечивает одну, числа на плашках и в меню
    фильтров перестают быть однозначными, «развернуть все» разворачивает
    сотню карточек. Тут около сотни сборок, и половина случаев — патчи,
    проблемы, наследование, сборка с коммита, отсутствие исходников —
    расставлена по кругу, чтобы попадаться вперемешку.

    Прежние компоненты цепочки на месте: без них диапазон os-9.6 → os-9.7
    состоял бы из одних появившихся, и смотреть в нём было бы нечего.

    Здесь же httpd впервые за всю цепочку затегован прямо, а не унаследован:
    пересобран с ветки os-9.4 (тег в этом мире не изменил самой ветки — она
    просто отстала от него), коммит сборки известен из `source`, и с тех пор
    ветка ушла на четыре коммита вперёд. На таком билде видны разом: бейдж
    «ветка +N», метка `branch-ahead` и ghost-патчи всех трёх сторон — то, чего
    ни один прежний компонент цепочки не показывал.
    """
    prev = wide_snapshot().by_name()
    tag = "os-9.7"
    builds = [
        same(prev, "nginx", tag),
        # ghost-патчи всех трёх сторон и «ветка +N»: собран с коммита ветки
        # os-9.4, которая с тех пор ушла на четыре коммита вперёд. Ссылки не
        # случайны — у патчей билда и у стороны build они ведут на коммит, у
        # branch и changed — на ветку, так же как их строит collect
        Build(nvr="httpd-2.4.62-13.el9", name="httpd", version="2.4.62",
              release="13.el9", build_id=901, task_id=9011, owner="builder",
              completed="2026-07-01 10:00:00", tag_name=tag,
              source=Source(
                  raw="git+https://gitlab.example.com/g/httpd#origin/os-9.4",
                  host="gitlab.example.com", project="g/httpd",
                  ref="os-9.4", ref_kind="branch",
                  web_url="https://gitlab.example.com/g/httpd/-/tree/os-9.4",
                  commit="0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122",
                  commit_url="https://gitlab.example.com/g/httpd/-/tree/"
                             "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122",
                  commit_source="koji_source",
                  branch_head="99aabbccddeeff00112233445566778899aabbcc",
                  commits_ahead=4),
              patches_ref="0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122",
              patch_dir_present=True,
              rpms=["httpd-2.4.62-13.el9.x86_64"],
              patches=[
                  Patch(path="PATCH/CVE-2026-1111.patch",
                        name="CVE-2026-1111.patch", cls="CVE",
                        cves=["CVE-2026-1111"],
                        web_url=BLOB % "CVE-2026-1111.patch"),
                  Patch(path="PATCH/httpd-distsuffix.patch",
                        name="httpd-distsuffix.patch", cls="DISTSUFFIX",
                        web_url=BLOB % "httpd-distsuffix.patch"),
                  Patch(path="PATCH/old-fix.patch", name="old-fix.patch",
                        cls="other", web_url=BLOB % "old-fix.patch"),
              ],
              ghost_patches=[
                  Patch(path="PATCH/CVE-2026-9999.patch",
                        name="CVE-2026-9999.patch", cls="CVE",
                        cves=["CVE-2026-9999"], ghost="branch",
                        web_url=BLOB_BRANCH % "CVE-2026-9999.patch"),
                  Patch(path="PATCH/httpd-distsuffix.patch",
                        name="httpd-distsuffix.patch", cls="DISTSUFFIX",
                        ghost="changed",
                        web_url=BLOB_BRANCH % "httpd-distsuffix.patch"),
                  Patch(path="PATCH/old-fix.patch", name="old-fix.patch",
                        cls="other", ghost="build",
                        web_url=BLOB % "old-fix.patch"),
              ]),
        same(prev, "zlib", tag),
        same(prev, "vim", tag, tag_name=None, tags=[]),
        same(prev, "kernel", tag),
        same(prev, "curl", tag),
        same(prev, "openssl", tag),
        same(prev, "chromium", tag, tag_name="os-9.5",
             tags=["os-9.5", tag]),
    ]
    return Snapshot(
        tag=tag, generated="2026-12-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=builds + many_builds())


# Тег os-9.5, снятый трижды: до перехода на коммит сборки, сразу после и
# ещё раз, когда часть отставаний догнали пересборкой. Хеши выписаны
# постоянными, потому что каждый встречается в двух-трёх снапшотах сразу:
# в одном как коммит сборки, в другом как вершина ветки, до которой сборка
# наконец доехала. Разъехавшись, они превратили бы историю в бессмыслицу.
NGINX_BUILT = "3f5a1c9e2b7d48a06e1f5c3b9d2a7e4f60c81b53"
NGINX_HEAD = "9d4e7b12c05af3689e2d1a7c4b53f80e6a91d2c7"
HTTPD_BUILT = "c81b5390a2f74e6d15b8c3097e2a4d6f81035b9c"
HTTPD_HEAD = "1a7f34d6b92e05c8437f6a1d29b0c5e83f47a612"
OPENSSL_BUILT = "7e2d19b4c60a3f85d17e94b2a538c06f2d914e7b"
OPENSSL_HEAD = "b53f80e6a91d2c74f36a1e8d052b9c7f43e6081a"
OPENSSL_HEAD_LATER = "4b53f80e6a91d2c74f36a1e8d052b9c7f43e6081"
GLIBC_GONE = "5c0a7f31d84b26e9057c3a1f6b28d40e7913a5c6"
GLIBC_REBUILT = "8d052b9c7f43e6081ab53f80e6a91d2c74f36a1e"
PYTHON_BUILT = "e91d2c74f36a1e8d052b9c7f43e6081ab53f80e6"
PYTHON_HEAD_LATER = "f36a1e8d052b9c7f43e6081ab53f80e6a91d2c74"
ZLIB_PINNED = "2b7d48a06e1f5c3b9d2a7e4f60c81b533f5a1c9e"

# Свой тег, а не занятый: os-9.5 висит на зеркальном снапшоте с другого
# хаба, и цепочка встала бы с ним на один рельс, добавив к предупреждению
# о двух видах ещё и предупреждение о разных хабах. Два предупреждения
# разом ничего не объясняют, а мешают друг другу.
DRIFT_TAG = "os-9.8"


def legacy_snapshot():
    """Тот же тег, снятый до перехода на коммит сборки.

    Ни одного нового поля: ни коммита, ни patches_ref, ни ghost — так
    выглядит файл, записанный любым выпуском до 2.2.0. Лежит он здесь не
    ради ностальгии, а ради двух вещей, которые больше проверить нечем:
    что старый снапшот открывается нынешней страницей без единой ошибки, и
    что рядом с новым он поднимает предупреждение о снапшотах двух видов —
    потому что часть разницы патчей между ними будет следом смены смысла, а
    не событием в репозитории.

    Патчи здесь сняты с вершины ветки, как их и снимали: у nginx в списке
    стоит CVE-2026-3011, который в билд на самом деле не входил. Ровно то
    враньё, ради устранения которого всё и затевалось, — и увидеть его
    можно, только положив этот файл рядом со следующим.
    """
    tag = DRIFT_TAG
    return Snapshot(
        tag=tag, generated="2026-06-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            Build(nvr="nginx-1.26.0-2.el9", name="nginx", version="1.26.0",
                  release="2.el9", build_id=1101, task_id=2101,
                  owner="builder", completed="2026-05-20 11:00:00",
                  tag_name=tag, tags=[tag],
                  source=src("web/nginx", tag), patch_dir_present=True,
                  patches=[
                      pat("web/nginx", tag, "CVE-2026-3010.patch", "CVE",
                          ["CVE-2026-3010"]),
                      # его в билде нет и не было: он лежит в ветке
                      pat("web/nginx", tag, "CVE-2026-3011.patch", "CVE",
                          ["CVE-2026-3011"]),
                      pat("web/nginx", tag, "nginx-distsuffix.patch",
                          "DISTSUFFIX"),
                  ],
                  rpms=["nginx-1.26.0-2.el9.x86_64",
                        "nginx-1.26.0-2.el9.src"]),
            Build(nvr="httpd-2.4.62-9.el9", name="httpd", version="2.4.62",
                  release="9.el9", epoch=1, build_id=1102, task_id=2102,
                  owner="apache", completed="2026-05-18 09:30:00",
                  tag_name=tag, tags=[tag],
                  source=src("web/httpd", tag), patch_dir_present=True,
                  patches=[
                      pat("web/httpd", tag, "CVE-2026-3020.patch", "CVE",
                          ["CVE-2026-3020"]),
                      pat("web/httpd", tag, "httpd-license.patch", "LICENSE"),
                  ],
                  rpms=["httpd-2.4.62-9.el9.x86_64"]),
            Build(nvr="openssl-3.2.1-4.el9", name="openssl", version="3.2.1",
                  release="4.el9", build_id=1103, task_id=2103,
                  owner="crypto", completed="2026-05-11 08:00:00",
                  tag_name=tag, tags=[tag],
                  source=src("core/openssl", tag), patch_dir_present=True,
                  patches=[pat("core/openssl", tag, "sast-openssl.patch",
                               "SAST")],
                  rpms=["openssl-3.2.1-4.el9.x86_64",
                        "openssl-libs-3.2.1-4.el9.x86_64"]),
            Build(nvr="curl-8.6.0-1.el9", name="curl", version="8.6.0",
                  release="1.el9", build_id=1104, task_id=2104,
                  owner="builder", completed="2026-05-09 07:00:00",
                  tag_name=tag, tags=[tag],
                  source=src("core/curl", tag), patch_dir_present=True,
                  patches=[pat("core/curl", tag, "curl-distsuffix.patch",
                               "DISTSUFFIX")],
                  rpms=["curl-8.6.0-1.el9.x86_64"]),
            Build(nvr="glibc-2.34-60.el9", name="glibc", version="2.34",
                  release="60.el9", build_id=1105, task_id=2105,
                  owner="core", completed="2026-05-05 06:00:00",
                  tag_name=tag, tags=[tag],
                  source=src("core/glibc", tag), patch_dir_present=True,
                  patches=[pat("core/glibc", tag, "coverage-glibc.patch",
                               "COVERAGE")],
                  rpms=["glibc-2.34-60.el9.x86_64"]),
        ])


def drift_snapshot():
    """Тот же тег после перехода: каждая строка показывает свой случай.

    Здесь собрано всё, ради чего затевалась работа, и по одному разу:
    ghost-патчи всех трёх сторон, «ветка +N» без единого ghost, билд без
    хеша вовсе, сборка прямо с коммита, пропавший коммит и спокойный билд,
    у которого ветка стоит на месте.

    Рядом с legacy этот файл поднимает предупреждение о двух видах — и
    поднимал бы его сам по себе: curl прочитан с ветки, остальные с
    коммита, а это и есть два вида в одном снапшоте.
    """
    tag = DRIFT_TAG
    return Snapshot(
        tag=tag, generated="2026-08-07T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            # Две стороны разом: CVE влит в ветку и не собран, а патч
            # суффикса переписан после сборки — в пакете лежит прежняя его
            # редакция. Это тот самый случай, который до 2.2.0 выглядел
            # как «патч у билда есть».
            Build(nvr="nginx-1.26.0-3.el9", name="nginx", version="1.26.0",
                  release="3.el9", build_id=1201, task_id=2201,
                  owner="builder", completed="2026-07-02 12:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("web/nginx", tag, NGINX_BUILT, ahead=3,
                                head=NGINX_HEAD),
                  patches_ref=NGINX_BUILT, patch_dir_present=True,
                  patches=[
                      pat("web/nginx", NGINX_BUILT, "CVE-2026-3010.patch",
                          "CVE", ["CVE-2026-3010"]),
                      pat("web/nginx", NGINX_BUILT, "nginx-distsuffix.patch",
                          "DISTSUFFIX"),
                  ],
                  ghost_patches=[
                      pat("web/nginx", tag, "CVE-2026-3011.patch", "CVE",
                          ["CVE-2026-3011"], ghost="branch"),
                      pat("web/nginx", tag, "nginx-distsuffix.patch",
                          "DISTSUFFIX", ghost="changed"),
                  ],
                  rpms=["nginx-1.26.0-3.el9.x86_64",
                        "nginx-1.26.0-3.el9.src"]),
            # Третья сторона: патч из ветки убрали, а в пакете он остался.
            Build(nvr="httpd-2.4.62-10.el9", name="httpd", version="2.4.62",
                  release="10.el9", epoch=1, build_id=1202, task_id=2202,
                  owner="apache", completed="2026-06-30 09:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("web/httpd", tag, HTTPD_BUILT, ahead=1,
                                head=HTTPD_HEAD),
                  patches_ref=HTTPD_BUILT, patch_dir_present=True,
                  patches=[
                      pat("web/httpd", HTTPD_BUILT, "CVE-2026-3020.patch",
                          "CVE", ["CVE-2026-3020"]),
                      pat("web/httpd", HTTPD_BUILT, "httpd-license.patch",
                          "LICENSE"),
                  ],
                  ghost_patches=[
                      pat("web/httpd", HTTPD_BUILT, "httpd-license.patch",
                          "LICENSE", ghost="build"),
                  ],
                  rpms=["httpd-2.4.62-10.el9.x86_64"]),
            # Бейдж без ghost-секции: ветка ушла на семь коммитов, но
            # каталога PATCH они не касались. Обратное невозможно —
            # ghost без отставания не бывает.
            Build(nvr="openssl-3.2.1-5.el9", name="openssl", version="3.2.1",
                  release="5.el9", build_id=1203, task_id=2203,
                  owner="crypto", completed="2026-06-20 08:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("core/openssl", tag, OPENSSL_BUILT, ahead=7,
                                head=OPENSSL_HEAD),
                  patches_ref=OPENSSL_BUILT, patch_dir_present=True,
                  patches=[pat("core/openssl", OPENSSL_BUILT,
                               "sast-openssl.patch", "SAST")],
                  rpms=["openssl-3.2.1-5.el9.x86_64",
                        "openssl-libs-3.2.1-5.el9.x86_64"]),
            # Хеша нет вовсе: koji не отдал верхнеуровневого source, и
            # патчи сняты с ветки — как до 2.2.0. Повседневный случай, а не
            # сбой: в problems ничего не уезжает, но patches_ref называет
            # ветку, и в паре с соседями это два вида в одном снапшоте.
            Build(nvr="curl-8.6.0-2.el9", name="curl", version="8.6.0",
                  release="2.el9", build_id=1204, task_id=2204,
                  owner="builder", completed="2026-06-15 07:00:00",
                  tag_name=tag, tags=[tag],
                  source=src("core/curl", tag),
                  patches_ref=tag, patch_dir_present=True,
                  patches=[pat("core/curl", tag, "curl-distsuffix.patch",
                               "DISTSUFFIX")],
                  rpms=["curl-8.6.0-2.el9.x86_64"]),
            # Коммит пропал из репозитория — ветку форс-пушнули. Патчи
            # сняты с ветки, и об этом сказано в problems: данные
            # деградировали, и молчать о них нельзя.
            Build(nvr="glibc-2.34-61.el9", name="glibc", version="2.34",
                  release="61.el9", build_id=1205, task_id=2205,
                  owner="core", completed="2026-06-10 06:00:00",
                  tag_name=tag, tags=[tag],
                  source=Source(
                      raw="git+https://gl/core/glibc?#%s" % tag, host="gl",
                      project="core/glibc", ref=tag, ref_kind="branch",
                      web_url="https://gl/core/glibc/-/tree/%s" % tag,
                      commit=GLIBC_GONE,
                      commit_url="https://gl/core/glibc/-/tree/%s"
                                 % GLIBC_GONE,
                      commit_source="koji_source"),
                  patches_ref=tag, patch_dir_present=True,
                  patches=[pat("core/glibc", tag, "coverage-glibc.patch",
                               "COVERAGE")],
                  rpms=["glibc-2.34-61.el9.x86_64"],
                  problems=["gitlab: коммит %s недоступен, патчи сняты с "
                            "ветки" % GLIBC_GONE[:12]]),
            # Собран прямо с коммита: ветки у такого билда нет, сравнивать
            # не с чем. Считать его «снятым с ветки» нельзя — точнее
            # источника не бывает.
            Build(nvr="zlib-1.3.1-1.el9", name="zlib", version="1.3.1",
                  release="1.el9", build_id=1206, task_id=2206,
                  owner="builder", completed="2026-06-05 05:00:00",
                  tag_name=tag, tags=[tag],
                  source=Source(
                      raw="git+https://gl/core/zlib?#%s" % ZLIB_PINNED,
                      host="gl", project="core/zlib", ref=ZLIB_PINNED,
                      ref_kind="commit",
                      web_url="https://gl/core/zlib/-/tree/%s" % ZLIB_PINNED,
                      commit=ZLIB_PINNED,
                      commit_url="https://gl/core/zlib/-/tree/%s"
                                 % ZLIB_PINNED,
                      commit_source="original_url"),
                  patches_ref=ZLIB_PINNED, patch_dir_present=True,
                  patches=[pat("core/zlib", ZLIB_PINNED, "sast-zlib.patch",
                               "SAST")],
                  rpms=["zlib-1.3.1-1.el9.x86_64"]),
            # Спокойная строка для сравнения: ветка стоит там же, где её
            # оставила сборка. Ни бейджа, ни метки, ни ghost — так
            # выглядит большинство, и на этом фоне остальные и читаются.
            Build(nvr="python3-3.11.9-1.el9", name="python3",
                  version="3.11.9", release="1.el9", build_id=1207,
                  task_id=2207, owner="builder",
                  completed="2026-06-01 04:00:00", tag_name=tag, tags=[tag],
                  source=src_at("core/python3", tag, PYTHON_BUILT),
                  patches_ref=PYTHON_BUILT, patch_dir_present=True,
                  patches=[pat("core/python3", PYTHON_BUILT,
                               "python3-distsuffix.patch", "DISTSUFFIX")],
                  rpms=["python3-3.11.9-1.el9.x86_64",
                        "python3-libs-3.11.9-1.el9.x86_64"]),
        ])


def caught_up_snapshot():
    """Тот же тег ещё позже: часть отставаний догнали, часть накопилась.

    Смысл файла — в паре с предыдущим. На «Изменениях» видно то, чего
    прежде увидеть было нельзя: ghost-патч перестал быть ghost и стал
    патчем билда, потому что билд пересобрали. И наоборот — там, где не
    пересобирали, ветка ушла ещё дальше.
    """
    tag = DRIFT_TAG
    prev = drift_snapshot().by_name()
    return Snapshot(
        tag=tag, generated="2026-08-09T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_LICENSE),
        builds=[
            # Пересобран с вершины: CVE-2026-3011 из ghost стал патчем
            # билда, переписанный суффикс подтянулся, ghost не осталось.
            Build(nvr="nginx-1.26.0-4.el9", name="nginx", version="1.26.0",
                  release="4.el9", build_id=1301, task_id=2301,
                  owner="builder", completed="2026-08-08 12:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("web/nginx", tag, NGINX_HEAD),
                  patches_ref=NGINX_HEAD, patch_dir_present=True,
                  patches=[
                      pat("web/nginx", NGINX_HEAD, "CVE-2026-3010.patch",
                          "CVE", ["CVE-2026-3010"]),
                      pat("web/nginx", NGINX_HEAD, "CVE-2026-3011.patch",
                          "CVE", ["CVE-2026-3011"]),
                      pat("web/nginx", NGINX_HEAD, "nginx-distsuffix.patch",
                          "DISTSUFFIX"),
                  ],
                  rpms=["nginx-1.26.0-4.el9.x86_64",
                        "nginx-1.26.0-4.el9.src"]),
            # Тоже пересобран: патч, которого в ветке уже не было, ушёл и
            # из пакета — сторона build исчерпана.
            Build(nvr="httpd-2.4.62-11.el9", name="httpd", version="2.4.62",
                  release="11.el9", epoch=1, build_id=1302, task_id=2302,
                  owner="apache", completed="2026-08-08 09:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("web/httpd", tag, HTTPD_HEAD),
                  patches_ref=HTTPD_HEAD, patch_dir_present=True,
                  patches=[pat("web/httpd", HTTPD_HEAD, "CVE-2026-3020.patch",
                               "CVE", ["CVE-2026-3020"])],
                  rpms=["httpd-2.4.62-11.el9.x86_64"]),
            # Не пересобирали: тот же билд, а ветка ушла ещё дальше.
            same(prev, "openssl", tag,
                 source=src_at("core/openssl", tag, OPENSSL_BUILT, ahead=9,
                               head=OPENSSL_HEAD_LATER)),
            same(prev, "curl", tag),
            # Коммит вернулся вместе с пересборкой: проблема ушла.
            Build(nvr="glibc-2.34-62.el9", name="glibc", version="2.34",
                  release="62.el9", build_id=1305, task_id=2305,
                  owner="core", completed="2026-08-07 06:00:00",
                  tag_name=tag, tags=[tag],
                  source=src_at("core/glibc", tag, GLIBC_REBUILT),
                  patches_ref=GLIBC_REBUILT, patch_dir_present=True,
                  patches=[pat("core/glibc", GLIBC_REBUILT,
                               "coverage-glibc.patch", "COVERAGE")],
                  rpms=["glibc-2.34-62.el9.x86_64"]),
            same(prev, "zlib", tag),
            # А здесь отставание только появилось: спокойная строка
            # предыдущего снапшота обзавелась несобранным CVE.
            Build(nvr="python3-3.11.9-1.el9", name="python3",
                  version="3.11.9", release="1.el9", build_id=1207,
                  task_id=2207, owner="builder",
                  completed="2026-06-01 04:00:00", tag_name=tag, tags=[tag],
                  source=src_at("core/python3", tag, PYTHON_BUILT, ahead=2,
                                head=PYTHON_HEAD_LATER),
                  patches_ref=PYTHON_BUILT, patch_dir_present=True,
                  patches=[pat("core/python3", PYTHON_BUILT,
                               "python3-distsuffix.patch", "DISTSUFFIX")],
                  ghost_patches=[
                      pat("core/python3", tag, "CVE-2026-3030.patch", "CVE",
                          ["CVE-2026-3030"], ghost="branch"),
                  ],
                  rpms=["python3-3.11.9-1.el9.x86_64",
                        "python3-libs-3.11.9-1.el9.x86_64"]),
        ])


FILES = [("rich-old.json", old_snapshot),
         ("rich-new.json", new_snapshot),
         ("rich-newer.json", newer_snapshot),
         ("rich-newest.json", newest_snapshot),
         ("rich-again.json", again_snapshot),
         ("rich-mirror.json", mirror_snapshot),
         ("rich-wide.json", wide_snapshot),
         ("rich-many.json", many_snapshot),
         # Цепочка одного тега про коммит сборки: «до», «после» и «догнали».
         # Порядок здесь тот же, в каком их кладут на рельс.
         ("rich-legacy.json", legacy_snapshot),
         ("rich-drift.json", drift_snapshot),
         ("rich-caught-up.json", caught_up_snapshot)]


def bare(data):
    """Снапшоты без версии записавшего."""
    return [dict((k, v) for k, v in item.items() if k != "dashboard")
            for item in data]


def write(snapshot, path):
    """Пишет файл, только если изменились данные.

    Версию записавшего снапшот несёт полем `dashboard`, и она меняется от
    выпуска к выпуску сама собой. Переписывать из-за неё файл — значит на
    каждом подъёме номера тащить в коммит восемь изменённых фикстур, в
    которых не изменилось ничего; а rich-old.json и rich-new.json к тому же
    порождают эталон page-data.golden.json, и трогать их без нужды нельзя
    вовсе. Поэтому в сравнении версия не участвует: каждый файл говорит, чем
    он записан, и это правда — тем выпуском, при котором он появился.
    Разными версиями собранные снапшоты и в жизни лежат рядом.
    """
    fresh = [snapshot_to_dict(snapshot)]
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as handle:
            if bare(json.load(handle)) == bare(fresh):
                return False
    dump_snapshots([snapshot], path)
    return True


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    written, kept = [], []
    for name, build in FILES:
        if write(build(), os.path.join(here, name)):
            written.append(name)
        else:
            kept.append(name)
    print("написаны: %s" % (", ".join(written) or "ничего"))
    print("не изменились: %s" % (", ".join(kept) or "ничего"))


if __name__ == "__main__":
    main()
