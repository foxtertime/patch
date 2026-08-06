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


def src(project, ref, kind="branch"):
    return Source(raw="git+https://gl/%s?#%s" % (project, ref), host="gl",
                  project=project, ref=ref, ref_kind=kind,
                  web_url="https://gl/%s/-/tree/%s" % (project, ref))


def patch(name, cls, cves=()):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=list(cves),
                 web_url="https://gl/blob/PATCH/" + name)


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
        patch_classes=list(CLASSES_WITH_DISTSUFFIX),
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
            # не менялся
            same(prev, "zlib", "os-9.4"),
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
        patch_classes=list(CLASSES_WITH_DISTSUFFIX),
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
        patch_classes=list(CLASSES_WITH_DISTSUFFIX),
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
            cls = CLASSES_WITH_DISTSUFFIX[i % len(CLASSES_WITH_DISTSUFFIX)]
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
    """
    prev = wide_snapshot().by_name()
    builds = [
        same(prev, "nginx", "os-9.7"),
        same(prev, "httpd", "os-9.7", tag_name="os-9.4",
             tags=["os-9.4", "os-9.7"]),
        same(prev, "zlib", "os-9.7"),
        same(prev, "vim", "os-9.7", tag_name=None, tags=[]),
        same(prev, "kernel", "os-9.7"),
        same(prev, "curl", "os-9.7"),
        same(prev, "openssl", "os-9.7"),
        same(prev, "chromium", "os-9.7", tag_name="os-9.5",
             tags=["os-9.5", "os-9.7"]),
    ]
    return Snapshot(
        tag="os-9.7", generated="2026-12-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES_WITH_DISTSUFFIX),
        builds=builds + many_builds())


FILES = [("rich-old.json", old_snapshot),
         ("rich-new.json", new_snapshot),
         ("rich-newer.json", newer_snapshot),
         ("rich-newest.json", newest_snapshot),
         ("rich-again.json", again_snapshot),
         ("rich-mirror.json", mirror_snapshot),
         ("rich-wide.json", wide_snapshot),
         ("rich-many.json", many_snapshot)]


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
