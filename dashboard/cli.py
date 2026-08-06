"""Точка входа: collect, page."""
import argparse
import logging
import os
import time
from typing import List, Optional

from . import __version__, logs
from .build import BuildError, build_html
from .collect import collect_tag
from .config import ConfigError, load_config
from .gitlabclient import GitlabClient
from .model import dump_snapshots

EXIT_OK = 0
EXIT_PROBLEMS = 1
EXIT_FATAL = 2

logger = logging.getLogger(__name__)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dashboard",
        description="Дашборд патчей: агрегация koji и GitLab")
    # Версия стоит до подкоманды и печатается даже без неё: у argparse
    # действие version завершает разбор на месте, не доходя до проверки
    # обязательного подпараметра. Спрашивают её как раз тогда, когда
    # собирать нечего — например, разбирая чужой снапшот.
    parser.add_argument("--version", action="version",
                        version="dashboard " + __version__,
                        help="напечатать версию и выйти")
    parser.add_argument("--config", default=os.environ.get("DASHBOARD_CONFIG"),
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

    # Не «dashboard»: программа теперь так и зовётся, и строка запуска
    # читалась бы как «dashboard dashboard». Команда называет то, что кладёт
    # на диск, — страницу.
    page = subparsers.add_parser(
        "page", help="положить страницу дашборда на диск (данные "
                     "подгружаются в неё)")
    page.add_argument("-o", "--output", default="dashboard.html")
    return parser


def _load_config(args):
    overrides = {"koji_hub": args.koji_hub, "gitlab_api": args.gitlab_api,
                 "patch_dir": args.patch_dir}
    # страница пуста, пока в неё не подгрузят снапшоты руками — koji.hub
    # ей не нужен
    return load_config(args.config, overrides,
                       require_hub=args.command != "page")


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
        if args.command == "page":
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(build_html())
            logger.info("написан %s", args.output)
            return EXIT_OK

        snapshots = _collect(args, cfg)
        dump_snapshots(snapshots, args.output)
        logger.info("написан %s", args.output)
        logger.info("всего за %.1f с", time.monotonic() - started)

        if args.max_problems is not None:
            problems = sum(1 for s in snapshots for b in s.builds if b.problems)
            if problems > args.max_problems:
                logger.warning("проблемных билдов %d > %d", problems,
                               args.max_problems)
                return EXIT_PROBLEMS
        return EXIT_OK
    except BuildError as exc:
        return _fatal("ошибка сборки страницы", exc)
    except OSError as exc:
        return _fatal("ошибка ввода-вывода", exc)
    except Exception as exc:  # koji недоступен и прочие фатальные случаи
        return _fatal("фатальная ошибка", exc)
