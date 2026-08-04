"""Точка входа: collect, render, dashboard, run."""
import argparse
import logging
import os
import time
from typing import List, Optional

from . import logs
from .build import BuildError, build_html
from .collect import collect_tag
from .config import ConfigError, load_config
from .gitlabclient import GitlabClient
from .model import SnapshotError, dump_snapshots, load_snapshots

EXIT_OK = 0
EXIT_PROBLEMS = 1
EXIT_FATAL = 2

logger = logging.getLogger(__name__)


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
    parser.add_argument("--log-level", choices=sorted(logs.LEVELS),
                        default=logs.DEFAULT_LEVEL,
                        help="подробность лога (по умолчанию %s); на debug "
                             "печатается каждый запрос к GitLab и koji"
                             % logs.DEFAULT_LEVEL)

    subparsers = parser.add_subparsers(dest="command", required=True)

    collect = subparsers.add_parser("collect", help="собрать снапшоты тегов")
    collect.add_argument("--tag", action="append", required=True, dest="tags",
                         help="koji-тег; можно указать несколько раз")
    collect.add_argument("-o", "--output", default="snapshot.json")

    render = subparsers.add_parser("render", help="построить HTML из снапшотов")
    render.add_argument("snapshots", nargs="+")
    render.add_argument("-o", "--output", default="dashboard.html")

    dashboard = subparsers.add_parser(
        "dashboard",
        help="положить дашборд на диск (данные подгружаются в нём)")
    dashboard.add_argument("-o", "--output", default="dashboard.html")

    run = subparsers.add_parser("run", help="собрать и сразу построить HTML")
    run.add_argument("--tag", action="append", required=True, dest="tags")
    run.add_argument("-o", "--output", default="dashboard.html")
    run.add_argument("--save-snapshots", help="дополнительно сохранить JSON")
    return parser


def _load_config(args):
    overrides = {"koji_hub": args.koji_hub, "gitlab_api": args.gitlab_api,
                 "patch_dir": args.patch_dir}
    # эти двое работают из снапшотов, koji.hub им не нужен
    return load_config(args.config, overrides,
                       require_hub=args.command not in ("render", "dashboard"))


def _collect(args, cfg):
    from .kojiclient import connect  # импорт здесь: koji нужен только для сбора
    logger.info("хаб %s, теги: %s, --jobs %d, токен %s", cfg.koji_hub,
                ", ".join(args.tags), args.jobs,
                "задан" if cfg.token() else "не задан")
    koji_client = connect(cfg.koji_hub)
    gitlab = GitlabClient(cfg.gitlab_hosts, token=cfg.token(),
                          patch_dir=cfg.patch_dir,
                          default_host=cfg.gitlab_default_host)
    return [collect_tag(tag, cfg, koji_client, gitlab, jobs=args.jobs)
            for tag in args.tags]


def _render(snapshots, cfg, output) -> None:
    html = build_html(snapshots)
    with open(output, "w", encoding="utf-8") as handle:
        handle.write(html)
    logger.info("написан %s", output)


def _fatal(message, exc) -> int:
    """Одна строка пользователю, трейсбек — только на debug."""
    logger.error("%s: %s", message, exc)
    logger.debug("трейсбек", exc_info=True)
    return EXIT_FATAL


def main(argv: Optional[List[str]] = None) -> int:
    args = _parser().parse_args(argv)
    logs.configure(args.log_level)
    started = time.monotonic()

    try:
        cfg = _load_config(args)
    except ConfigError as exc:
        return _fatal("ошибка конфига", exc)
    except Exception as exc:  # непредвиденная ошибка не должна ронять CLI трейсбеком
        return _fatal("фатальная ошибка", exc)

    try:
        if args.command == "dashboard":
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(build_html())
            logger.info("написан %s", args.output)
            return EXIT_OK

        if args.command == "render":
            snapshots = []
            for path in args.snapshots:
                snapshots.extend(load_snapshots(path))
            _render(snapshots, cfg, args.output)
            logger.info("всего за %.1f с", time.monotonic() - started)
            return EXIT_OK

        snapshots = _collect(args, cfg)
        if args.command == "collect":
            dump_snapshots(snapshots, args.output)
            logger.info("написан %s", args.output)
        else:
            if args.save_snapshots:
                dump_snapshots(snapshots, args.save_snapshots)
            _render(snapshots, cfg, args.output)
        logger.info("всего за %.1f с", time.monotonic() - started)

        if args.max_problems is not None:
            problems = sum(1 for s in snapshots for b in s.builds if b.problems)
            if problems > args.max_problems:
                logger.warning("проблемных билдов %d > %d", problems,
                               args.max_problems)
                return EXIT_PROBLEMS
        return EXIT_OK
    except SnapshotError as exc:
        return _fatal("ошибка снапшота", exc)
    except BuildError as exc:
        return _fatal("ошибка сборки страницы", exc)
    except OSError as exc:
        return _fatal("ошибка ввода-вывода", exc)
    except Exception as exc:  # koji недоступен и прочие фатальные случаи
        return _fatal("фатальная ошибка", exc)
