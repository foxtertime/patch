"""Генератор богатых фикстур для паритетной сверки Python и JS.

Фикстуры коммитятся; скрипт нужен, чтобы их можно было пересобрать и
чтобы было видно, какие случаи они покрывают. Запуск из корня репозитория:

    python3 tests/fixtures/make_rich_fixtures.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from kojipatch.model import (Build, Patch, Snapshot, Source,  # noqa: E402
                             dump_snapshots)

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


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    dump_snapshots([old_snapshot()], os.path.join(here, "rich-old.json"))
    dump_snapshots([new_snapshot()], os.path.join(here, "rich-new.json"))
    dump_snapshots([newer_snapshot()], os.path.join(here, "rich-newer.json"))
    dump_snapshots([newest_snapshot()], os.path.join(here, "rich-newest.json"))
    print("написаны rich-old.json, rich-new.json, rich-newer.json "
          "и rich-newest.json")


if __name__ == "__main__":
    main()
