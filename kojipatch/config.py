"""Загрузка и валидация конфигурации."""
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import yaml

DEFAULT_PATCH_DIR = "PATCH"
DEFAULT_TOKEN_ENV = "GITLAB_TOKEN"
DEFAULT_PATCH_CLASSES = [
    ("CVE", r"CVE-\d{4}-\d{4,}"),
    ("SAST", r"(?i)^sast[-_]"),
    ("DAST", r"(?i)^dast[-_]"),
]
CATCH_ALL = ("other", ".*")


class ConfigError(Exception):
    """Конфиг отсутствует, нечитаем или не проходит валидацию."""


@dataclass(frozen=True)
class GitlabHost:
    api: str
    web: str


@dataclass
class Config:
    koji_hub: str
    koji_web: Optional[str] = None
    gitlab_default_host: Optional[str] = None
    gitlab_hosts: Dict[str, GitlabHost] = field(default_factory=dict)
    gitlab_token_env: str = DEFAULT_TOKEN_ENV
    patch_dir: str = DEFAULT_PATCH_DIR
    patch_classes: List[Tuple[str, str]] = field(
        default_factory=lambda: list(DEFAULT_PATCH_CLASSES) + [CATCH_ALL])

    def token(self) -> Optional[str]:
        """Токен GitLab из окружения; None означает анонимный доступ."""
        return os.environ.get(self.gitlab_token_env) or None


def _read_yaml(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = yaml.safe_load(handle)
    except OSError as exc:
        raise ConfigError("не удалось прочитать конфиг %s: %s" % (path, exc))
    except yaml.YAMLError as exc:
        raise ConfigError("конфиг %s не разбирается: %s" % (path, exc))
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ConfigError("конфиг %s должен быть отображением" % path)
    return data


def _patch_classes(raw) -> List[Tuple[str, str]]:
    if raw is None:
        return list(DEFAULT_PATCH_CLASSES) + [CATCH_ALL]
    if not isinstance(raw, list) or not raw:
        raise ConfigError("patch_classes должен быть непустым списком")
    rules = []
    for item in raw:
        if not isinstance(item, dict):
            raise ConfigError("правило patch_classes должно быть отображением")
        name = item.get("name")
        pattern = item.get("pattern")
        if not name or not pattern:
            raise ConfigError("у правила patch_classes нужны name и pattern")
        try:
            re.compile(pattern)
        except re.error as exc:
            raise ConfigError("плохой pattern %r: %s" % (pattern, exc))
        rules.append((str(name), str(pattern)))
    if rules[-1][1] != ".*":
        rules.append(CATCH_ALL)
    return rules


def load_config(path: Optional[str],
                overrides: Optional[Dict[str, str]] = None,
                require_hub: bool = True) -> Config:
    """Читает YAML-конфиг и накладывает поверх непустые overrides.

    require_hub=False нужен подкоманде render: она работает из готовых
    снапшотов и до koji вообще не ходит.
    """
    data = _read_yaml(path) if path else {}
    overrides = {k: v for k, v in (overrides or {}).items() if v}

    koji = data.get("koji") or {}
    gitlab = data.get("gitlab") or {}
    hosts = {}
    for host, spec in (gitlab.get("hosts") or {}).items():
        spec = spec or {}
        api = spec.get("api")
        if not api:
            raise ConfigError("у хоста %s не задан gitlab api" % host)
        hosts[host] = GitlabHost(api=api, web=spec.get("web") or api.split("/api/")[0])

    cfg = Config(
        koji_hub=overrides.get("koji_hub") or koji.get("hub") or "",
        koji_web=koji.get("web"),
        gitlab_default_host=gitlab.get("default_host"),
        gitlab_hosts=hosts,
        gitlab_token_env=gitlab.get("token_env") or DEFAULT_TOKEN_ENV,
        patch_dir=overrides.get("patch_dir") or data.get("patch_dir") or DEFAULT_PATCH_DIR,
        patch_classes=_patch_classes(data.get("patch_classes")),
    )
    if overrides.get("gitlab_api"):
        host = cfg.gitlab_default_host or "*"
        api = overrides["gitlab_api"]
        cfg.gitlab_hosts[host] = GitlabHost(api=api, web=api.split("/api/")[0])
        cfg.gitlab_default_host = host
    if require_hub and not cfg.koji_hub:
        raise ConfigError("не задан koji.hub (ни в конфиге, ни флагом --koji-hub)")
    return cfg
