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


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    dump_snapshots([old_snapshot()], os.path.join(here, "rich-old.json"))
    dump_snapshots([new_snapshot()], os.path.join(here, "rich-new.json"))
    print("написаны rich-old.json и rich-new.json")


if __name__ == "__main__":
    main()
