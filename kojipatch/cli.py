"""Точка входа: collect, render, run."""
import argparse
import os
import sys
import traceback
from typing import List, Optional

from .classify import Classifier
from .collect import collect_tag, problem_summary
from .config import ConfigError, load_config
from .diff import diff_chain
from .gitlabclient import GitlabClient
from .model import SnapshotError, dump_snapshots, load_snapshots
from .render import RenderError, render_html

EXIT_OK = 0
EXIT_PROBLEMS = 1
EXIT_FATAL = 2


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="kojipatch",
        description="Дашборд патчей: агрегация koji и GitLab")
    parser.add_argument("--config", default=os.environ.get("KOJIPATCH_CONFIG"),
                        help="путь к YAML-конфигу")
    parser.add_argument("--koji-hub", help="перекрыть koji.hub из конфига")
    parser.add_argument("--gitlab-api", help="перекрыть адрес GitLab API")
    parser.add_argument("--patch-dir", help="имя каталога патчей в корне репо")
    parser.add_argument("--jobs", type=int, default=8,
                        help="параллельных запросов к GitLab (по умолчанию 8)")
    parser.add_argument("--max-problems", type=int, default=None,
                        help="вернуть код 1, если проблемных билдов больше")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="печатать прогресс сбора и трейсбек при фатальной ошибке")

    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="собрать снапшоты тегов")
    collect.add_argument("--tag", action="append", required=True, dest="tags",
                         help="koji-тег; можно указать несколько раз")
    collect.add_argument("-o", "--output", default="snapshot.json")

    render = subparsers.add_parser("render", help="построить HTML из снапшотов")
    render.add_argument("snapshots", nargs="+")
    render.add_argument("-o", "--output", default="dashboard.html")

    run = subparsers.add_parser("run", help="собрать и сразу построить HTML")
    run.add_argument("--tag", action="append", required=True, dest="tags")
    run.add_argument("-o", "--output", default="dashboard.html")
    run.add_argument("--save-snapshots", help="дополнительно сохранить JSON")
    return parser


def _load_config(args):
    overrides = {"koji_hub": args.koji_hub, "gitlab_api": args.gitlab_api,
                 "patch_dir": args.patch_dir}
    # render работает из снапшотов, koji.hub ему не нужен
    return load_config(args.config, overrides,
                       require_hub=args.command != "render")


def _collect(args, cfg):
    from .kojiclient import connect  # импорт здесь: koji нужен только для сбора
    koji_client = connect(cfg.koji_hub)
    gitlab = GitlabClient(cfg.gitlab_hosts, token=cfg.token(),
                          patch_dir=cfg.patch_dir,
                          default_host=cfg.gitlab_default_host)
    snapshots = []
    for tag in args.tags:
        progress = None
        if args.verbose:
            def progress(done, total, tag=tag):
                sys.stderr.write("\r%s: %d/%d" % (tag, done, total))
                sys.stderr.flush()
        snapshot = collect_tag(tag, cfg, koji_client, gitlab, jobs=args.jobs,
                               progress=progress)
        if args.verbose:
            sys.stderr.write("\n")
        _report(snapshot)
        snapshots.append(snapshot)
    return snapshots


def _report(snapshot) -> int:
    summary = problem_summary(snapshot)
    problem_builds = sum(1 for b in snapshot.builds if b.problems)
    details = ", ".join("%s: %d" % item for item in sorted(summary.items()))
    sys.stderr.write("%s: %d билдов, %d проблемных%s\n"
                     % (snapshot.tag, len(snapshot.builds), problem_builds,
                        (" (%s)" % details) if details else ""))
    return problem_builds


def _render(snapshots, cfg, output) -> None:
    pairs = diff_chain(snapshots)
    html = render_html(snapshots, pairs, Classifier.from_config(cfg))
    with open(output, "w", encoding="utf-8") as handle:
        handle.write(html)
    sys.stderr.write("написан %s\n" % output)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parser().parse_args(argv)
    try:
        cfg = _load_config(args)
    except ConfigError as exc:
        sys.stderr.write("ошибка конфига: %s\n" % exc)
        return EXIT_FATAL
    except Exception as exc:  # непредвиденная ошибка тоже не должна ронять CLI трейсбеком
        if args.verbose:
            traceback.print_exc()
        sys.stderr.write("фатальная ошибка: %s\n" % exc)
        return EXIT_FATAL

    try:
        if args.command == "render":
            snapshots = []
            for path in args.snapshots:
                snapshots.extend(load_snapshots(path))
            _render(snapshots, cfg, args.output)
            return EXIT_OK

        snapshots = _collect(args, cfg)
        if args.command == "collect":
            dump_snapshots(snapshots, args.output)
            sys.stderr.write("написан %s\n" % args.output)
        else:
            if args.save_snapshots:
                dump_snapshots(snapshots, args.save_snapshots)
            _render(snapshots, cfg, args.output)

        if args.max_problems is not None:
            problems = sum(1 for s in snapshots for b in s.builds if b.problems)
            if problems > args.max_problems:
                sys.stderr.write("проблемных билдов %d > %d\n"
                                 % (problems, args.max_problems))
                return EXIT_PROBLEMS
        return EXIT_OK
    except (SnapshotError, RenderError) as exc:
        sys.stderr.write("%s\n" % exc)
        return EXIT_FATAL
    except OSError as exc:
        sys.stderr.write("ошибка ввода-вывода: %s\n" % exc)
        return EXIT_FATAL
    except Exception as exc:  # koji недоступен и прочие фатальные случаи
        if args.verbose:
            traceback.print_exc()
        sys.stderr.write("фатальная ошибка: %s\n" % exc)
        return EXIT_FATAL
