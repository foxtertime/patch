# Koji + GitLab Patch Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать по koji-тегам последние билды, вытащить из `extra.source.original_url` ветку GitLab, прочитать каталог `PATCH` в этой ветке, классифицировать патчи и сгенерировать самодостаточный HTML-дашборд с состоянием тега и сравнением тегов.

**Architecture:** Пакет `kojipatch/` из чистых модулей (`sourceurl`, `classify`, `rpmvercmp`, `diff`) и модулей ввода-вывода (`kojiclient`, `gitlabclient`), которые получают транспорт через конструктор и потому тестируются на подделках. Данные проходят конвейер `collect → Snapshot → JSON-снапшот → diff → render → HTML`. HTML самодостаточен: данные встроены как `var DATA`, логика — ванильный JS.

**Tech Stack:** Python 3.9, `koji`, `requests`, `PyYAML`, stdlib `unittest`. Никакого `jinja2`, `python-gitlab`, `pytest`, `tomllib` — в целевом окружении их нет.

## Global Constraints

- Python 3.9 — никаких `match`, `tomllib`, `X | Y` в аннотациях, `dict[str, int]` в рантайме (только `typing.Dict`).
- Внешние зависимости строго: `koji`, `requests`, `PyYAML`. Ничего больше не добавлять.
- Тесты — только stdlib `unittest`, запуск `python3 -m unittest discover -s tests -v`. Сеть в тестах запрещена.
- Спека: `docs/superpowers/specs/2026-08-03-koji-gitlab-patch-dashboard-design.md`. При расхождении плана и спеки — правильна спека.
- Версия схемы снапшота: `"schema": 1`.
- Регулярка CVE ровно одна на весь проект: `CVE-\d{4}-\d{4,}`, регистронезависимо, результат приводится к верхнему регистру.
- Дизайн дашборда наследует `ref.html` в корне репозитория: те же имена CSS-переменных, тёмная тема через `prefers-color-scheme`, карточки-счётчики, sticky-шапка таблицы, тултипы по `data-tip`.
- Коммит после каждой задачи. Сообщения коммитов на русском, в повелительном наклонении не обязательно.
- Никаких дисковых кэшей ответов API.

---

### Task 1: Каркас пакета и конфигурация

**Files:**
- Create: `kojipatch/__init__.py`, `kojipatch/config.py`
- Create: `kojipatch.example.yaml`
- Test: `tests/test_config.py`
- Create: `tests/__init__.py`

**Interfaces:**
- Consumes: ничего.
- Produces: `kojipatch.config.Config` (dataclass с полями `koji_hub: str`, `koji_web: Optional[str]`, `gitlab_default_host: Optional[str]`, `gitlab_hosts: Dict[str, GitlabHost]`, `gitlab_token_env: str`, `patch_dir: str`, `patch_classes: List[Tuple[str, str]]`), `kojipatch.config.GitlabHost` (dataclass `api: str`, `web: str`), `kojipatch.config.ConfigError`, `load_config(path: Optional[str], overrides: Optional[Dict[str, str]] = None) -> Config`.

- [ ] **Step 1: Написать падающий тест**

Создать `tests/__init__.py` (пустой) и `tests/test_config.py`:

```python
import os
import tempfile
import unittest

from kojipatch.config import Config, ConfigError, GitlabHost, load_config

MINIMAL = """
koji:
  hub: https://hub.example.com/kojihub
"""

FULL = """
koji:
  hub: https://hub.example.com/kojihub
  web: https://hub.example.com/koji
gitlab:
  default_host: gitlab.example.com
  token_env: MY_TOKEN
  hosts:
    gitlab.example.com:
      api: https://gitlab.example.com/api/v4
      web: https://gitlab.example.com
patch_dir: PATCHES
patch_classes:
  - { name: CVE, pattern: 'CVE-\\d{4}-\\d{4,}' }
  - { name: SAST, pattern: '(?i)^sast[-_]' }
"""


def write(text):
    fd, path = tempfile.mkstemp(suffix=".yaml")
    with os.fdopen(fd, "w") as handle:
        handle.write(text)
    return path


class LoadConfigTest(unittest.TestCase):
    def test_minimal_config_gets_defaults(self):
        cfg = load_config(write(MINIMAL))
        self.assertEqual(cfg.koji_hub, "https://hub.example.com/kojihub")
        self.assertIsNone(cfg.koji_web)
        self.assertEqual(cfg.patch_dir, "PATCH")
        self.assertEqual(cfg.gitlab_token_env, "GITLAB_TOKEN")
        self.assertEqual(cfg.gitlab_hosts, {})

    def test_full_config_is_read(self):
        cfg = load_config(write(FULL))
        self.assertEqual(cfg.koji_web, "https://hub.example.com/koji")
        self.assertEqual(cfg.gitlab_default_host, "gitlab.example.com")
        self.assertEqual(cfg.gitlab_token_env, "MY_TOKEN")
        self.assertEqual(cfg.patch_dir, "PATCHES")
        self.assertEqual(
            cfg.gitlab_hosts["gitlab.example.com"],
            GitlabHost(api="https://gitlab.example.com/api/v4",
                       web="https://gitlab.example.com"),
        )

    def test_implicit_other_rule_is_appended(self):
        cfg = load_config(write(FULL))
        self.assertEqual(cfg.patch_classes[-1], ("other", ".*"))

    def test_explicit_catch_all_is_not_duplicated(self):
        text = FULL + "  - { name: misc, pattern: '.*' }\n"
        cfg = load_config(write(text))
        self.assertEqual(cfg.patch_classes[-1], ("misc", ".*"))
        self.assertEqual(len(cfg.patch_classes), 3)

    def test_overrides_win_over_file(self):
        cfg = load_config(write(FULL), {"koji_hub": "https://other/hub",
                                        "patch_dir": "P"})
        self.assertEqual(cfg.koji_hub, "https://other/hub")
        self.assertEqual(cfg.patch_dir, "P")

    def test_missing_hub_is_an_error(self):
        with self.assertRaises(ConfigError):
            load_config(write("gitlab: {}\n"))

    def test_bad_pattern_is_an_error(self):
        text = MINIMAL + "patch_classes:\n  - { name: X, pattern: '[' }\n"
        with self.assertRaises(ConfigError):
            load_config(write(text))

    def test_missing_file_is_an_error(self):
        with self.assertRaises(ConfigError):
            load_config("/nonexistent/kojipatch.yaml")

    def test_no_file_requires_hub_override(self):
        cfg = load_config(None, {"koji_hub": "https://only/hub"})
        self.assertEqual(cfg.koji_hub, "https://only/hub")
        self.assertIsInstance(cfg, Config)

    def test_hub_is_optional_when_not_required(self):
        # подкоманда render читает готовые снапшоты и до koji не ходит
        cfg = load_config(None, None, require_hub=False)
        self.assertEqual(cfg.koji_hub, "")
        self.assertEqual(cfg.patch_classes[-1], ("other", ".*"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_config -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kojipatch'`

- [ ] **Step 3: Реализовать конфиг**

Создать пустой `kojipatch/__init__.py` и `kojipatch/config.py`:

```python
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
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_config -v`
Expected: PASS, 10 тестов

- [ ] **Step 5: Написать пример конфига**

`kojipatch.example.yaml`:

```yaml
koji:
  hub: https://kojihub.example.com/kojihub
  web: https://kojihub.example.com/koji

gitlab:
  default_host: gitlab.example.com
  token_env: GITLAB_TOKEN
  hosts:
    gitlab.example.com:
      api: https://gitlab.example.com/api/v4
      web: https://gitlab.example.com

patch_dir: PATCH

# Правила применяются по порядку, побеждает первое совпадение.
# Последнее всеохватное правило добавляется автоматически, если его нет.
patch_classes:
  - { name: CVE,  pattern: 'CVE-\d{4}-\d{4,}' }
  - { name: SAST, pattern: '(?i)^sast[-_]' }
  - { name: DAST, pattern: '(?i)^dast[-_]' }
```

- [ ] **Step 6: Коммит**

```bash
git add kojipatch tests kojipatch.example.yaml
git commit -m "Каркас пакета и загрузка конфигурации"
```

---

### Task 2: Разбор original_url

**Files:**
- Create: `kojipatch/sourceurl.py`
- Test: `tests/test_sourceurl.py`

**Interfaces:**
- Consumes: ничего.
- Produces: `parse_source_url(url: str) -> ParsedSource`, `ParsedSource = namedtuple("ParsedSource", "host project ref ref_kind")` (`ref_kind` ∈ `{"branch", "commit", "none"}`), `SourceUrlError(ValueError)`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_sourceurl.py`:

```python
import unittest

from kojipatch.sourceurl import SourceUrlError, parse_source_url

SHA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"


class ParseSourceUrlTest(unittest.TestCase):
    def test_ssh_with_query_and_origin_prefix(self):
        got = parse_source_url("git+ssh://git@gitlab.example.com/group/repo?#origin/br-9.2")
        self.assertEqual(got.host, "gitlab.example.com")
        self.assertEqual(got.project, "group/repo")
        self.assertEqual(got.ref, "br-9.2")
        self.assertEqual(got.ref_kind, "branch")

    def test_https_with_dot_git_suffix(self):
        got = parse_source_url("git+https://gitlab.example.com/group/repo.git#br")
        self.assertEqual(got.project, "group/repo")
        self.assertEqual(got.ref, "br")

    def test_nested_subgroups_and_slash_in_branch(self):
        got = parse_source_url(
            "git+ssh://git@h.example/g/sub/deep/repo?#origin/feat/x/y")
        self.assertEqual(got.project, "g/sub/deep/repo")
        self.assertEqual(got.ref, "feat/x/y")
        self.assertEqual(got.ref_kind, "branch")

    def test_commit_sha_is_marked(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#" + SHA)
        self.assertEqual(got.ref, SHA)
        self.assertEqual(got.ref_kind, "commit")

    def test_short_sha_is_marked_as_commit(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#a1b2c3d")
        self.assertEqual(got.ref_kind, "commit")

    def test_no_fragment_means_no_ref(self):
        got = parse_source_url("git+ssh://git@h.example/g/r")
        self.assertIsNone(got.ref)
        self.assertEqual(got.ref_kind, "none")

    def test_port_is_stripped_from_host(self):
        got = parse_source_url("git+ssh://git@h.example:2222/g/r?#origin/br")
        self.assertEqual(got.host, "h.example")

    def test_branch_named_origin_something_keeps_suffix_only_once(self):
        got = parse_source_url("git+ssh://git@h.example/g/r?#origin/origin-fix")
        self.assertEqual(got.ref, "origin-fix")

    def test_garbage_raises(self):
        for bad in ["", "   ", "not a url", "git+ssh://", "git+ssh://host-only"]:
            with self.assertRaises(SourceUrlError, msg=bad):
                parse_source_url(bad)

    def test_none_raises(self):
        with self.assertRaises(SourceUrlError):
            parse_source_url(None)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_sourceurl -v`
Expected: FAIL — `No module named 'kojipatch.sourceurl'`

- [ ] **Step 3: Реализовать разбор**

`kojipatch/sourceurl.py`:

```python
"""Разбор extra.source.original_url в координаты GitLab."""
import re
from collections import namedtuple

ParsedSource = namedtuple("ParsedSource", "host project ref ref_kind")

_SHA_RE = re.compile(r"^[0-9a-f]{7,40}$", re.I)
_ORIGIN = "origin/"


class SourceUrlError(ValueError):
    """URL сборки не удалось разобрать."""


def parse_source_url(url) -> ParsedSource:
    if not isinstance(url, str) or not url.strip():
        raise SourceUrlError("пустой source url")

    rest = url.strip()
    frag = ""
    if "#" in rest:
        rest, frag = rest.split("#", 1)
    if "://" not in rest:
        raise SourceUrlError("нет схемы в %r" % url)
    rest = rest.split("://", 1)[1]
    rest = rest.split("?", 1)[0]

    head = rest.split("/", 1)[0]
    if "@" in head:
        rest = rest.split("@", 1)[1]
    if "/" not in rest:
        raise SourceUrlError("нет пути проекта в %r" % url)

    host, project = rest.split("/", 1)
    host = host.split(":", 1)[0].strip()
    project = project.strip("/")
    if project.endswith(".git"):
        project = project[:-4]
    if not host or not project:
        raise SourceUrlError("не разобрать host/project в %r" % url)

    frag = frag.strip()
    if not frag:
        return ParsedSource(host, project, None, "none")
    ref = frag[len(_ORIGIN):] if frag.startswith(_ORIGIN) else frag
    if not ref:
        return ParsedSource(host, project, None, "none")
    kind = "commit" if _SHA_RE.match(ref) else "branch"
    return ParsedSource(host, project, ref, kind)
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_sourceurl -v`
Expected: PASS, 10 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/sourceurl.py tests/test_sourceurl.py
git commit -m "Разбор original_url в host/project/ref"
```

---

### Task 3: Классификация патчей

**Files:**
- Create: `kojipatch/classify.py`
- Test: `tests/test_classify.py`

**Interfaces:**
- Consumes: `kojipatch.config.Config.patch_classes`.
- Produces: `find_cves(text: str) -> List[str]`, `Classifier(rules: List[Tuple[str, str]])` с методами `classify(filename: str) -> str` и `class_names() -> List[str]`, `Classifier.from_config(cfg) -> Classifier`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_classify.py`:

```python
import unittest

from kojipatch.classify import Classifier, find_cves
from kojipatch.config import Config

RULES = [
    ("CVE", r"CVE-\d{4}-\d{4,}"),
    ("SAST", r"(?i)^sast[-_]"),
    ("DAST", r"(?i)^dast[-_]"),
    ("other", ".*"),
]


class FindCvesTest(unittest.TestCase):
    def test_single_cve(self):
        self.assertEqual(find_cves("CVE-2024-7347.patch"), ["CVE-2024-7347"])

    def test_multiple_cves_keep_order_and_dedup(self):
        name = "fix-CVE-2024-1234-and-cve-2023-9999-and-CVE-2024-1234.patch"
        self.assertEqual(find_cves(name),
                         ["CVE-2024-1234", "CVE-2023-9999"])

    def test_lowercase_is_normalised(self):
        self.assertEqual(find_cves("cve-2021-44228.patch"), ["CVE-2021-44228"])

    def test_three_digit_tail_is_not_a_cve(self):
        self.assertEqual(find_cves("CVE-2024-123.patch"), [])

    def test_no_cve(self):
        self.assertEqual(find_cves("sast-fix.patch"), [])


class ClassifierTest(unittest.TestCase):
    def setUp(self):
        self.c = Classifier(RULES)

    def test_cve_wins_over_catch_all(self):
        self.assertEqual(self.c.classify("CVE-2024-7347.patch"), "CVE")

    def test_sast_prefix(self):
        self.assertEqual(self.c.classify("sast-null-deref.patch"), "SAST")

    def test_sast_uppercase_prefix(self):
        self.assertEqual(self.c.classify("SAST_overflow.patch"), "SAST")

    def test_dast_prefix(self):
        self.assertEqual(self.c.classify("dast_timeout.patch"), "DAST")

    def test_first_rule_wins(self):
        # имя подходит и под CVE, и под SAST — правило CVE стоит раньше
        self.assertEqual(self.c.classify("sast-CVE-2024-7347.patch"), "CVE")

    def test_unknown_falls_back_to_other(self):
        self.assertEqual(self.c.classify("0001-fix-build.patch"), "other")

    def test_class_names_are_unique_and_ordered(self):
        self.assertEqual(self.c.class_names(), ["CVE", "SAST", "DAST", "other"])

    def test_from_config(self):
        cfg = Config(koji_hub="h", patch_classes=RULES)
        self.assertEqual(Classifier.from_config(cfg).classify("dast_x.patch"),
                         "DAST")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_classify -v`
Expected: FAIL — `No module named 'kojipatch.classify'`

- [ ] **Step 3: Реализовать классификатор**

`kojipatch/classify.py`:

```python
"""Классификация файлов патчей по имени."""
import re
from typing import List, Tuple

CVE_RE = re.compile(r"CVE-\d{4}-\d{4,}", re.I)


def find_cves(text: str) -> List[str]:
    """Все CVE-идентификаторы из строки: верхний регистр, без повторов."""
    seen = []
    for match in CVE_RE.finditer(text or ""):
        cve = match.group(0).upper()
        if cve not in seen:
            seen.append(cve)
    return seen


class Classifier:
    """Первое совпавшее правило определяет класс патча."""

    def __init__(self, rules: List[Tuple[str, str]]):
        self._rules = [(name, re.compile(pattern)) for name, pattern in rules]

    @classmethod
    def from_config(cls, cfg) -> "Classifier":
        return cls(cfg.patch_classes)

    def classify(self, filename: str) -> str:
        for name, regex in self._rules:
            if regex.search(filename):
                return name
        return "other"

    def class_names(self) -> List[str]:
        names = []
        for name, _ in self._rules:
            if name not in names:
                names.append(name)
        return names
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_classify -v`
Expected: PASS, 13 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/classify.py tests/test_classify.py
git commit -m "Классификация патчей по имени файла"
```

---

### Task 4: Сравнение версий rpmvercmp

**Files:**
- Create: `kojipatch/rpmvercmp.py`
- Test: `tests/test_rpmvercmp.py`

**Interfaces:**
- Consumes: ничего.
- Produces: `rpmvercmp(a: str, b: str) -> int` (-1/0/1), `compare_evr(a: Tuple[Optional[int], str, str], b: Tuple[Optional[int], str, str]) -> int` — кортежи `(epoch, version, release)`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_rpmvercmp.py`:

```python
import unittest

from kojipatch.rpmvercmp import compare_evr, rpmvercmp


class RpmVerCmpTest(unittest.TestCase):
    def check(self, a, b, expected):
        self.assertEqual(rpmvercmp(a, b), expected, "%s vs %s" % (a, b))
        self.assertEqual(rpmvercmp(b, a), -expected, "%s vs %s" % (b, a))

    def test_equal(self):
        self.check("1.0", "1.0", 0)
        self.check("1.0-1.el9", "1.0-1.el9", 0)

    def test_numeric_segments(self):
        self.check("1.0.1", "1.0", 1)
        self.check("2.0", "1.9.9", 1)
        self.check("1.10", "1.9", 1)

    def test_leading_zeros_ignored(self):
        self.check("1.007", "1.7", 0)

    def test_digits_beat_letters(self):
        self.check("1.1", "1.a", 1)

    def test_alpha_suffix_is_greater_than_bare(self):
        self.check("1.0a", "1.0", 1)

    def test_separators_are_equivalent(self):
        self.check("1.0.1", "1_0-1", 0)

    def test_tilde_sorts_before_everything(self):
        self.check("1.0", "1.0~rc1", 1)
        self.check("1.0~rc2", "1.0~rc1", 1)
        self.check("1.0~rc1", "0.9", 1)

    def test_caret_sorts_after_bare_but_before_next(self):
        self.check("1.0^20240101", "1.0", 1)
        self.check("1.0.1", "1.0^20240101", 1)

    def test_empty_strings(self):
        self.assertEqual(rpmvercmp("", ""), 0)
        self.assertEqual(rpmvercmp("1", ""), 1)
        self.assertEqual(rpmvercmp("", "1"), -1)


class CompareEvrTest(unittest.TestCase):
    def test_release_breaks_the_tie(self):
        self.assertEqual(compare_evr((None, "1.0", "2.el9"),
                                     (None, "1.0", "1.el9")), 1)

    def test_epoch_dominates(self):
        self.assertEqual(compare_evr((1, "1.0", "1"), (None, "9.0", "1")), 1)

    def test_missing_epoch_equals_zero(self):
        self.assertEqual(compare_evr((None, "1.0", "1"), (0, "1.0", "1")), 0)

    def test_full_equality(self):
        self.assertEqual(compare_evr((0, "1.0", "1.el9"),
                                     (0, "1.0", "1.el9")), 0)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_rpmvercmp -v`
Expected: FAIL — `No module named 'kojipatch.rpmvercmp'`

- [ ] **Step 3: Реализовать алгоритм**

`kojipatch/rpmvercmp.py`:

```python
"""Сравнение версий по алгоритму RPM, без зависимости от python-rpm."""
import re
from typing import Optional, Tuple

_DIGITS = re.compile(r"^(\d+)")
_ALPHA = re.compile(r"^([A-Za-z]+)")


def _strip_separators(text: str) -> str:
    index = 0
    while index < len(text) and not (text[index].isalnum()
                                     or text[index] in "~^"):
        index += 1
    return text[index:]


def rpmvercmp(a: str, b: str) -> int:
    """Возвращает -1, 0 или 1, как rpmvercmp(3)."""
    a = a or ""
    b = b or ""
    if a == b:
        return 0

    while a or b:
        a = _strip_separators(a)
        b = _strip_separators(b)

        if a[:1] == "~" or b[:1] == "~":
            if a[:1] != "~":
                return 1
            if b[:1] != "~":
                return -1
            a, b = a[1:], b[1:]
            continue

        if a[:1] == "^" or b[:1] == "^":
            if not a:
                return -1
            if not b:
                return 1
            if a[:1] != "^":
                return 1
            if b[:1] != "^":
                return -1
            a, b = a[1:], b[1:]
            continue

        if not a or not b:
            break

        if a[0].isdigit():
            match_a, match_b, numeric = _DIGITS.match(a), _DIGITS.match(b), True
        else:
            match_a, match_b, numeric = _ALPHA.match(a), _ALPHA.match(b), False

        if match_b is None:
            # цифры «весомее» букв
            return 1 if numeric else -1

        seg_a, seg_b = match_a.group(1), match_b.group(1)
        a, b = a[len(seg_a):], b[len(seg_b):]

        if numeric:
            seg_a = seg_a.lstrip("0") or "0"
            seg_b = seg_b.lstrip("0") or "0"
            if len(seg_a) != len(seg_b):
                return 1 if len(seg_a) > len(seg_b) else -1

        if seg_a != seg_b:
            return 1 if seg_a > seg_b else -1

    if not a and not b:
        return 0
    return 1 if a else -1


def compare_evr(a: Tuple[Optional[int], str, str],
                b: Tuple[Optional[int], str, str]) -> int:
    """Сравнивает (epoch, version, release); epoch None считается нулём."""
    epoch_a = int(a[0] or 0)
    epoch_b = int(b[0] or 0)
    if epoch_a != epoch_b:
        return 1 if epoch_a > epoch_b else -1
    result = rpmvercmp(a[1], b[1])
    if result:
        return result
    return rpmvercmp(a[2], b[2])
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_rpmvercmp -v`
Expected: PASS, 13 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/rpmvercmp.py tests/test_rpmvercmp.py
git commit -m "Сравнение версий по алгоритму RPM"
```

---

### Task 5: Модель данных и снапшоты

**Files:**
- Create: `kojipatch/model.py`
- Test: `tests/test_model.py`

**Interfaces:**
- Consumes: ничего.
- Produces: dataclass'ы `Patch(path, name, cls, cves, web_url)`, `Source(raw, host, project, ref, ref_kind, web_url)`, `Build(nvr, name, version, release, epoch, build_id, task_id, owner, completed, source, patch_dir_present, patches, rpms, problems)`, `Snapshot(tag, generated, koji_hub, koji_web, builds)`; функции `snapshot_to_dict`, `snapshot_from_dict`, `dump_snapshots(snapshots, path)`, `load_snapshots(path) -> List[Snapshot]`, `SnapshotError`. В JSON поле класса патча называется `class`, в Python — `cls`. Константа `SCHEMA = 1`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_model.py`:

```python
import json
import os
import tempfile
import unittest

from kojipatch.model import (SCHEMA, Build, Patch, Snapshot, SnapshotError,
                             Source, dump_snapshots, load_snapshots,
                             snapshot_from_dict, snapshot_to_dict)


def sample_build(name="nginx"):
    return Build(
        nvr="%s-1.24.0-3.el9" % name, name=name, version="1.24.0",
        release="3.el9", epoch=None, build_id=1, task_id=2, owner="builder",
        completed="2026-05-14",
        source=Source(raw="git+ssh://git@h/g/r?#origin/br", host="h",
                      project="g/r", ref="br", ref_kind="branch",
                      web_url="https://h/g/r/-/tree/br"),
        patch_dir_present=True,
        patches=[Patch(path="PATCH/CVE-2024-7347.patch",
                       name="CVE-2024-7347.patch", cls="CVE",
                       cves=["CVE-2024-7347"], web_url="https://h/blob")],
        rpms=["nginx-1.24.0-3.el9.x86_64"],
        problems=[])


def sample_snapshot(tag="os-9.2"):
    return Snapshot(tag=tag, generated="2026-08-03T13:20:00+03:00",
                    koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                    builds=[sample_build()])


class SerialisationTest(unittest.TestCase):
    def test_roundtrip_preserves_everything(self):
        snap = sample_snapshot()
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertEqual(again, snap)

    def test_patch_class_key_is_class_in_json(self):
        data = snapshot_to_dict(sample_snapshot())
        self.assertEqual(data["builds"][0]["patches"][0]["class"], "CVE")
        self.assertNotIn("cls", data["builds"][0]["patches"][0])

    def test_schema_version_is_written(self):
        self.assertEqual(snapshot_to_dict(sample_snapshot())["schema"], SCHEMA)

    def test_source_may_be_null(self):
        build = sample_build()
        build.source = None
        build.patch_dir_present = None
        build.problems = ["no source url"]
        snap = Snapshot(tag="t", generated="g", koji_hub="h", koji_web=None,
                        builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snap))
        self.assertIsNone(again.builds[0].source)
        self.assertIsNone(again.builds[0].patch_dir_present)
        self.assertEqual(again.builds[0].problems, ["no source url"])

    def test_unknown_schema_rejected(self):
        data = snapshot_to_dict(sample_snapshot())
        data["schema"] = 99
        with self.assertRaises(SnapshotError):
            snapshot_from_dict(data)


class FileIoTest(unittest.TestCase):
    def path(self):
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        return path

    def test_dump_single_snapshot_writes_a_list(self):
        path = self.path()
        dump_snapshots([sample_snapshot()], path)
        with open(path) as handle:
            data = json.load(handle)
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)

    def test_load_accepts_a_list(self):
        path = self.path()
        dump_snapshots([sample_snapshot("a"), sample_snapshot("b")], path)
        snaps = load_snapshots(path)
        self.assertEqual([s.tag for s in snaps], ["a", "b"])

    def test_load_accepts_a_bare_object(self):
        path = self.path()
        with open(path, "w") as handle:
            json.dump(snapshot_to_dict(sample_snapshot("solo")), handle)
        self.assertEqual([s.tag for s in load_snapshots(path)], ["solo"])

    def test_load_of_garbage_raises(self):
        path = self.path()
        with open(path, "w") as handle:
            handle.write("{not json")
        with self.assertRaises(SnapshotError):
            load_snapshots(path)

    def test_load_of_missing_file_raises(self):
        with self.assertRaises(SnapshotError):
            load_snapshots("/nonexistent/snap.json")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_model -v`
Expected: FAIL — `No module named 'kojipatch.model'`

- [ ] **Step 3: Реализовать модель**

`kojipatch/model.py`:

```python
"""Объекты предметной области и сериализация снапшотов."""
import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

SCHEMA = 1


class SnapshotError(Exception):
    """Снапшот не читается или несовместим по версии схемы."""


@dataclass
class Patch:
    path: str
    name: str
    cls: str
    cves: List[str] = field(default_factory=list)
    web_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"path": self.path, "name": self.name, "class": self.cls,
                "cves": list(self.cves), "web_url": self.web_url}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Patch":
        return cls(path=data["path"], name=data["name"], cls=data["class"],
                   cves=list(data.get("cves") or []),
                   web_url=data.get("web_url"))


@dataclass
class Source:
    raw: str
    host: Optional[str] = None
    project: Optional[str] = None
    ref: Optional[str] = None
    ref_kind: str = "none"
    web_url: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"raw": self.raw, "host": self.host, "project": self.project,
                "ref": self.ref, "ref_kind": self.ref_kind,
                "web_url": self.web_url}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Source":
        return cls(raw=data.get("raw", ""), host=data.get("host"),
                   project=data.get("project"), ref=data.get("ref"),
                   ref_kind=data.get("ref_kind", "none"),
                   web_url=data.get("web_url"))


@dataclass
class Build:
    nvr: str
    name: str
    version: str
    release: str
    epoch: Optional[int] = None
    build_id: Optional[int] = None
    task_id: Optional[int] = None
    owner: Optional[str] = None
    completed: Optional[str] = None
    source: Optional[Source] = None
    patch_dir_present: Optional[bool] = None
    patches: List[Patch] = field(default_factory=list)
    rpms: List[str] = field(default_factory=list)
    problems: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "nvr": self.nvr, "name": self.name, "version": self.version,
            "release": self.release, "epoch": self.epoch,
            "build_id": self.build_id, "task_id": self.task_id,
            "owner": self.owner, "completed": self.completed,
            "source": self.source.to_dict() if self.source else None,
            "patch_dir_present": self.patch_dir_present,
            "patches": [p.to_dict() for p in self.patches],
            "rpms": list(self.rpms), "problems": list(self.problems),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Build":
        source = data.get("source")
        return cls(
            nvr=data["nvr"], name=data["name"], version=data["version"],
            release=data["release"], epoch=data.get("epoch"),
            build_id=data.get("build_id"), task_id=data.get("task_id"),
            owner=data.get("owner"), completed=data.get("completed"),
            source=Source.from_dict(source) if source else None,
            patch_dir_present=data.get("patch_dir_present"),
            patches=[Patch.from_dict(p) for p in data.get("patches") or []],
            rpms=list(data.get("rpms") or []),
            problems=list(data.get("problems") or []),
        )

    def evr(self):
        return (self.epoch, self.version, self.release)


@dataclass
class Snapshot:
    tag: str
    generated: str
    koji_hub: str
    koji_web: Optional[str] = None
    builds: List[Build] = field(default_factory=list)

    def by_name(self) -> Dict[str, Build]:
        return {build.name: build for build in self.builds}


def snapshot_to_dict(snapshot: Snapshot) -> Dict[str, Any]:
    return {"schema": SCHEMA, "tag": snapshot.tag,
            "generated": snapshot.generated, "koji_hub": snapshot.koji_hub,
            "koji_web": snapshot.koji_web,
            "builds": [b.to_dict() for b in snapshot.builds]}


def snapshot_from_dict(data: Dict[str, Any]) -> Snapshot:
    if not isinstance(data, dict):
        raise SnapshotError("снапшот должен быть объектом")
    schema = data.get("schema")
    if schema != SCHEMA:
        raise SnapshotError("несовместимая схема снапшота: %r (нужна %d)"
                            % (schema, SCHEMA))
    try:
        return Snapshot(tag=data["tag"], generated=data["generated"],
                        koji_hub=data.get("koji_hub", ""),
                        koji_web=data.get("koji_web"),
                        builds=[Build.from_dict(b)
                                for b in data.get("builds") or []])
    except KeyError as exc:
        raise SnapshotError("в снапшоте нет поля %s" % exc)


def dump_snapshots(snapshots: List[Snapshot], path: str) -> None:
    payload = [snapshot_to_dict(s) for s in snapshots]
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1, sort_keys=True)


def load_snapshots(path: str) -> List[Snapshot]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except OSError as exc:
        raise SnapshotError("не прочитать снапшот %s: %s" % (path, exc))
    except ValueError as exc:
        raise SnapshotError("снапшот %s не разбирается: %s" % (path, exc))
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise SnapshotError("снапшот %s: ожидался объект или список" % path)
    return [snapshot_from_dict(item) for item in data]
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_model -v`
Expected: PASS, 10 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/model.py tests/test_model.py
git commit -m "Модель данных и сериализация снапшотов"
```

---

### Task 6: Клиент koji

**Files:**
- Create: `kojipatch/kojiclient.py`
- Create: `tests/fakes.py`
- Test: `tests/test_kojiclient.py`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `KojiClient(session, batch: int = 100)` с методами `tagged_builds(tag: str) -> List[dict]`, `build_details(build_ids: List[int]) -> Dict[int, dict]`, `rpms_for(build_ids: List[int]) -> Dict[int, List[str]]`; фабрика `connect(hub: str) -> KojiClient`; `KojiError(Exception)`. `rpms_for` возвращает отсортированные строки `name-version-release.arch`. Плюс `tests/fakes.py` с `FakeKojiSession` (используется в задачах 6 и 8).

- [ ] **Step 1: Написать падающий тест**

`tests/fakes.py`:

```python
"""Подделки внешних систем для тестов. Сети здесь нет."""
from collections import namedtuple


class _VirtualCall:
    """Отложенный результат, как koji.VirtualCall: .result заполняется на выходе."""

    def __init__(self):
        self.result = None


class _MultiCallProxy:
    def __init__(self, recorder, name):
        self._recorder = recorder
        self._name = name

    def __call__(self, *args, **kwargs):
        call = _VirtualCall()
        self._recorder.append((self._name, args, kwargs, call))
        return call


class _MultiCall:
    """Имитация koji.ClientSession.multicall как контекстного менеджера."""

    def __init__(self, session):
        self._session = session
        self._calls = []

    def __getattr__(self, name):
        return _MultiCallProxy(self._calls, name)

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        for name, args, kwargs, call in self._calls:
            call.result = getattr(self._session, name)(*args, **kwargs)
        return False


class FakeKojiSession:
    """Считает вызовы и отдаёт заранее заданные ответы."""

    def __init__(self, tagged=None, builds=None, rpms=None,
                 supports_multicall=True):
        self.tagged = tagged or {}
        self.builds = builds or {}
        self.rpms = rpms or {}
        self.supports_multicall = supports_multicall
        self.calls = []

    def listTagged(self, tag, latest=False, inherit=False):
        self.calls.append(("listTagged", tag, latest, inherit))
        if tag not in self.tagged:
            raise ValueError("no such tag: %s" % tag)
        return list(self.tagged[tag])

    def getBuild(self, build_id):
        self.calls.append(("getBuild", build_id))
        return self.builds.get(build_id)

    def listRPMs(self, buildID=None):
        self.calls.append(("listRPMs", buildID))
        return list(self.rpms.get(buildID, []))

    def multicall(self, batch=None, strict=False):
        if not self.supports_multicall:
            raise AttributeError("multicall")
        self.calls.append(("multicall", batch))
        return _MultiCall(self)


Response = namedtuple("Response", "status body headers")


class FakeTransport:
    """HTTP-транспорт для GitlabClient: очередь ответов на каждый URL."""

    def __init__(self, routes=None):
        self.routes = routes or {}
        self.requests = []

    def get(self, url, headers=None, params=None):
        self.requests.append((url, dict(params or {}), dict(headers or {})))
        key = (url, tuple(sorted((params or {}).items())))
        if key in self.routes:
            queue = self.routes[key]
        elif url in self.routes:
            queue = self.routes[url]
        else:
            return Response(404, {"message": "404 Project Not Found"}, {})
        if isinstance(queue, list):
            return queue.pop(0) if len(queue) > 1 else queue[0]
        return queue
```

`tests/test_kojiclient.py`:

```python
import unittest

from kojipatch.kojiclient import KojiClient
from tests.fakes import FakeKojiSession

TAGGED = {"os-9.2": [{"build_id": 1, "name": "nginx", "nvr": "nginx-1.24.0-3.el9"},
                     {"build_id": 2, "name": "curl", "nvr": "curl-8.0.1-1.el9"}]}
BUILDS = {
    1: {"build_id": 1, "name": "nginx", "version": "1.24.0", "release": "3.el9",
        "extra": {"source": {"original_url": "git+ssh://git@h/g/nginx?#origin/br"}}},
    2: {"build_id": 2, "name": "curl", "version": "8.0.1", "release": "1.el9",
        "extra": None},
}
RPMS = {
    1: [{"name": "nginx", "version": "1.24.0", "release": "3.el9", "arch": "x86_64"},
        {"name": "nginx-core", "version": "1.24.0", "release": "3.el9", "arch": "x86_64"}],
    2: [],
}


class KojiClientTest(unittest.TestCase):
    def setUp(self):
        self.session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
        self.client = KojiClient(self.session, batch=10)

    def test_tagged_builds_uses_latest_and_inherit(self):
        builds = self.client.tagged_builds("os-9.2")
        self.assertEqual(len(builds), 2)
        self.assertIn(("listTagged", "os-9.2", True, True), self.session.calls)

    def test_build_details_returns_map_with_extra(self):
        details = self.client.build_details([1, 2])
        self.assertEqual(set(details), {1, 2})
        self.assertEqual(
            details[1]["extra"]["source"]["original_url"],
            "git+ssh://git@h/g/nginx?#origin/br")

    def test_build_details_uses_multicall(self):
        self.client.build_details([1, 2])
        self.assertTrue(any(call[0] == "multicall" for call in self.session.calls))

    def test_rpms_are_formatted_and_sorted(self):
        rpms = self.client.rpms_for([1, 2])
        self.assertEqual(rpms[1], ["nginx-1.24.0-3.el9.x86_64",
                                   "nginx-core-1.24.0-3.el9.x86_64"])
        self.assertEqual(rpms[2], [])

    def test_falls_back_when_multicall_missing(self):
        session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS,
                                  supports_multicall=False)
        client = KojiClient(session, batch=10)
        details = client.build_details([1, 2])
        self.assertEqual(set(details), {1, 2})
        self.assertFalse(any(call[0] == "multicall" for call in session.calls))

    def test_empty_input_makes_no_calls(self):
        self.assertEqual(self.client.build_details([]), {})
        self.assertEqual(self.client.rpms_for([]), {})
        self.assertEqual(self.session.calls, [])

    def test_missing_build_is_skipped(self):
        details = self.client.build_details([1, 999])
        self.assertEqual(set(details), {1})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_kojiclient -v`
Expected: FAIL — `No module named 'kojipatch.kojiclient'`

- [ ] **Step 3: Реализовать клиент**

`kojipatch/kojiclient.py`:

```python
"""Тонкая обёртка над koji.ClientSession с пакетными вызовами."""
from typing import Dict, List


class KojiError(Exception):
    """Хаб недоступен или ответил ошибкой."""


class KojiClient:
    def __init__(self, session, batch: int = 100):
        self._session = session
        self._batch = max(1, int(batch))

    def tagged_builds(self, tag: str) -> List[dict]:
        """Последние билды тега с учётом наследования."""
        try:
            return self._session.listTagged(tag, latest=True, inherit=True)
        except Exception as exc:
            raise KojiError("не получить билды тега %s: %s" % (tag, exc))

    def build_details(self, build_ids: List[int]) -> Dict[int, dict]:
        results = self._call_batched("getBuild", build_ids)
        return {bid: info for bid, info in results.items() if info}

    def rpms_for(self, build_ids: List[int]) -> Dict[int, List[str]]:
        raw = self._call_batched("listRPMs", build_ids, keyword="buildID")
        out = {}
        for bid, rpms in raw.items():
            names = ["%s-%s-%s.%s" % (r["name"], r["version"], r["release"],
                                      r["arch"])
                     for r in rpms or []]
            out[bid] = sorted(names)
        return out

    def _call_batched(self, method: str, build_ids: List[int],
                      keyword: str = None) -> Dict[int, object]:
        ids = list(build_ids)
        if not ids:
            return {}
        results = {}
        for start in range(0, len(ids), self._batch):
            chunk = ids[start:start + self._batch]
            try:
                results.update(self._multicall_chunk(method, chunk, keyword))
            except (AttributeError, NotImplementedError):
                results.update(self._sequential_chunk(method, chunk, keyword))
        return results

    def _invoke(self, target, method: str, build_id: int, keyword: str):
        call = getattr(target, method)
        if keyword:
            return call(**{keyword: build_id})
        return call(build_id)

    def _multicall_chunk(self, method, chunk, keyword) -> Dict[int, object]:
        multicall = getattr(self._session, "multicall", None)
        if multicall is None:
            raise AttributeError("multicall")
        with multicall(batch=len(chunk)) as batch:
            # каждый вызов возвращает VirtualCall, результат появляется на выходе
            calls = [self._invoke(batch, method, build_id, keyword)
                     for build_id in chunk]
        if any(call is None for call in calls):
            raise NotImplementedError("multicall не вернул VirtualCall")
        return dict(zip(chunk, [call.result for call in calls]))

    def _sequential_chunk(self, method, chunk, keyword) -> Dict[int, object]:
        return {build_id: self._invoke(self._session, method, build_id, keyword)
                for build_id in chunk}


def connect(hub: str, batch: int = 100) -> KojiClient:
    """Анонимная сессия к хабу; чтение аутентификации не требует."""
    import koji  # импорт внутри, чтобы тесты не зависели от библиотеки
    try:
        session = koji.ClientSession(hub)
    except Exception as exc:
        raise KojiError("не подключиться к koji %s: %s" % (hub, exc))
    return KojiClient(session, batch=batch)
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_kojiclient -v`
Expected: PASS, 7 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/kojiclient.py tests/test_kojiclient.py tests/fakes.py
git commit -m "Клиент koji с пакетными вызовами и фолбэком"
```

---

### Task 7: Клиент GitLab

**Files:**
- Create: `kojipatch/gitlabclient.py`
- Test: `tests/test_gitlabclient.py`
- Modify: `tests/fakes.py` (уже содержит `FakeTransport` из задачи 6 — использовать как есть)

**Interfaces:**
- Consumes: `kojipatch.config.GitlabHost`.
- Produces: `TreeResult = namedtuple("TreeResult", "present paths problem")` (`present`: `True`/`False`/`None`), `GitlabClient(hosts: Dict[str, GitlabHost], token: Optional[str], patch_dir: str = "PATCH", transport=None, retries: int = 3, sleeper=time.sleep, default_host: Optional[str] = None)` с методами `patch_files(host, project, ref) -> TreeResult`, `tree_url(host, project, ref) -> Optional[str]`, `blob_url(host, project, ref, path) -> Optional[str]`; класс `HttpTransport` поверх `requests`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_gitlabclient.py`:

```python
import unittest

from kojipatch.config import GitlabHost
from kojipatch.gitlabclient import GitlabClient
from tests.fakes import FakeTransport, Response

HOSTS = {"gitlab.example.com": GitlabHost(api="https://gitlab.example.com/api/v4",
                                          web="https://gitlab.example.com")}
TREE_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/tree"

TWO_FILES = Response(200, [
    {"id": "1", "name": "CVE-2024-7347.patch", "type": "blob",
     "path": "PATCH/CVE-2024-7347.patch"},
    {"id": "2", "name": "sub", "type": "tree", "path": "PATCH/sub"},
    {"id": "3", "name": "sast-x.patch", "type": "blob",
     "path": "PATCH/sub/sast-x.patch"},
], {})


def client(routes, **kwargs):
    transport = FakeTransport(routes)
    return GitlabClient(HOSTS, token="t", transport=transport,
                        sleeper=lambda _s: None, **kwargs), transport


class PatchFilesTest(unittest.TestCase):
    def test_blobs_are_returned_trees_are_not(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(result.paths,
                         ["PATCH/CVE-2024-7347.patch", "PATCH/sub/sast-x.patch"])
        self.assertIsNone(result.problem)

    def test_project_is_url_encoded_and_params_are_set(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "feat/x")
        url, params, headers = transport.requests[0]
        self.assertEqual(url, TREE_URL)
        self.assertEqual(params["ref"], "feat/x")
        self.assertEqual(params["path"], "PATCH")
        self.assertTrue(params["recursive"])
        self.assertEqual(headers["PRIVATE-TOKEN"], "t")

    def test_tree_not_found_means_no_patch_dir(self):
        cli, _ = client({TREE_URL: Response(404, {"message": "404 Tree Not Found"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIs(result.present, False)
        self.assertEqual(result.paths, [])
        self.assertIsNone(result.problem)

    def test_project_not_found_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(404, {"message": "404 Project Not Found"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("project", result.problem.lower())

    def test_unknown_host_is_a_problem(self):
        cli, _ = client({})
        result = cli.patch_files("other.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("unknown host", result.problem)

    def test_forbidden_is_a_problem(self):
        cli, _ = client({TREE_URL: Response(403, {"message": "403 Forbidden"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("403", result.problem)

    def test_pagination_follows_next_page(self):
        page1 = Response(200, [{"id": "1", "name": "a.patch", "type": "blob",
                                "path": "PATCH/a.patch"}], {"x-next-page": "2"})
        page2 = Response(200, [{"id": "2", "name": "b.patch", "type": "blob",
                                "path": "PATCH/b.patch"}], {"x-next-page": ""})
        cli, transport = client({TREE_URL: [page1, page2]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(result.paths, ["PATCH/a.patch", "PATCH/b.patch"])
        self.assertEqual(transport.requests[1][1]["page"], "2")

    def test_retries_on_429_then_succeeds(self):
        cli, transport = client({TREE_URL: [Response(429, {}, {"Retry-After": "0"}),
                                            TWO_FILES]})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertTrue(result.present)
        self.assertEqual(len(transport.requests), 2)

    def test_gives_up_after_retries(self):
        cli, transport = client({TREE_URL: Response(500, {}, {})}, retries=3)
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertIsNone(result.present)
        self.assertIn("500", result.problem)
        self.assertEqual(len(transport.requests), 3)

    def test_same_triple_is_requested_once(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(len(transport.requests), 1)

    def test_different_ref_is_requested_again(self):
        cli, transport = client({TREE_URL: TWO_FILES})
        cli.patch_files("gitlab.example.com", "g/r", "br")
        cli.patch_files("gitlab.example.com", "g/r", "other")
        self.assertEqual(len(transport.requests), 2)

    def test_missing_ref_is_a_problem(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", None)
        self.assertIsNone(result.present)
        self.assertIn("ref", result.problem)


class UrlTest(unittest.TestCase):
    def test_tree_and_blob_urls(self):
        cli, _ = client({})
        self.assertEqual(cli.tree_url("gitlab.example.com", "g/r", "feat/x"),
                         "https://gitlab.example.com/g/r/-/tree/feat/x")
        self.assertEqual(
            cli.blob_url("gitlab.example.com", "g/r", "br", "PATCH/a.patch"),
            "https://gitlab.example.com/g/r/-/blob/br/PATCH/a.patch")

    def test_urls_are_none_for_unknown_host(self):
        cli, _ = client({})
        self.assertIsNone(cli.tree_url("nope", "g/r", "br"))


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_gitlabclient -v`
Expected: FAIL — `No module named 'kojipatch.gitlabclient'`

- [ ] **Step 3: Реализовать клиент**

`kojipatch/gitlabclient.py`:

```python
"""Чтение каталога патчей из GitLab через REST v4."""
import threading
import time
from collections import namedtuple
from typing import Dict, Optional
from urllib.parse import quote

TreeResult = namedtuple("TreeResult", "present paths problem")

_RETRY_STATUSES = (429, 500, 502, 503, 504)


class HttpTransport:
    """requests поверх пула сессий: по одной сессии на поток."""

    def __init__(self, timeout: int = 30):
        self._timeout = timeout
        self._local = threading.local()

    def _session(self):
        session = getattr(self._local, "session", None)
        if session is None:
            import requests
            session = requests.Session()
            self._local.session = session
        return session

    def get(self, url, headers=None, params=None):
        response = self._session().get(url, headers=headers, params=params,
                                       timeout=self._timeout)
        try:
            body = response.json()
        except ValueError:
            body = None
        return _Response(response.status_code, body, response.headers)


class _Response:
    def __init__(self, status, body, headers):
        self.status = status
        self.body = body
        self.headers = headers


class GitlabClient:
    def __init__(self, hosts: Dict[str, object], token: Optional[str] = None,
                 patch_dir: str = "PATCH", transport=None, retries: int = 3,
                 sleeper=time.sleep, default_host: Optional[str] = None):
        self._hosts = hosts or {}
        self._token = token
        self._patch_dir = patch_dir
        self._transport = transport or HttpTransport()
        self._retries = max(1, int(retries))
        self._sleep = sleeper
        self._default_host = default_host
        self._cache = {}
        self._lock = threading.Lock()

    # -- адреса -----------------------------------------------------------
    def _host_config(self, host):
        if host in self._hosts:
            return self._hosts[host]
        if self._default_host and self._default_host in self._hosts:
            return self._hosts[self._default_host]
        if "*" in self._hosts:
            return self._hosts["*"]
        return None

    def tree_url(self, host, project, ref) -> Optional[str]:
        cfg = self._host_config(host)
        if not cfg or not ref:
            return None
        return "%s/%s/-/tree/%s" % (cfg.web.rstrip("/"), project, ref)

    def blob_url(self, host, project, ref, path) -> Optional[str]:
        cfg = self._host_config(host)
        if not cfg or not ref:
            return None
        return "%s/%s/-/blob/%s/%s" % (cfg.web.rstrip("/"), project, ref, path)

    # -- дерево патчей ----------------------------------------------------
    def patch_files(self, host, project, ref) -> TreeResult:
        """Пути файлов внутри каталога патчей ветки; результат мемоизируется."""
        if not ref:
            return TreeResult(None, [], "gitlab: no ref in source url")
        key = (host, project, ref)
        with self._lock:
            if key in self._cache:
                return self._cache[key]
        result = self._fetch(host, project, ref)
        with self._lock:
            self._cache[key] = result
        return result

    def _fetch(self, host, project, ref) -> TreeResult:
        cfg = self._host_config(host)
        if cfg is None:
            return TreeResult(None, [], "gitlab: unknown host %s" % host)
        url = "%s/projects/%s/repository/tree" % (
            cfg.api.rstrip("/"), quote(project, safe=""))
        headers = {"PRIVATE-TOKEN": self._token} if self._token else {}

        paths = []
        page = None
        while True:
            params = {"ref": ref, "path": self._patch_dir,
                      "recursive": "true", "per_page": "100"}
            if page:
                params["page"] = page
            response = self._get_with_retries(url, headers, params)
            if isinstance(response, str):
                return TreeResult(None, [], response)
            if response.status == 404:
                message = _message(response)
                if "tree not found" in message.lower():
                    return TreeResult(False, [], None)
                return TreeResult(None, [], "gitlab: %s" % (message or "404"))
            if response.status >= 400:
                return TreeResult(None, [],
                                  "gitlab: %s %s" % (response.status,
                                                     _message(response)))
            for item in response.body or []:
                if item.get("type") == "blob":
                    paths.append(item["path"])
            page = (response.headers or {}).get("x-next-page") or ""
            if not page:
                break
        return TreeResult(True, sorted(paths), None)

    def _get_with_retries(self, url, headers, params):
        last = None
        for attempt in range(self._retries):
            try:
                response = self._transport.get(url, headers=headers,
                                               params=params)
            except Exception as exc:  # сетевые ошибки транспорта
                last = "gitlab: %s" % exc
                self._backoff(attempt, None)
                continue
            if response.status in _RETRY_STATUSES and attempt < self._retries - 1:
                self._backoff(attempt, (response.headers or {}).get("Retry-After"))
                last = "gitlab: %s %s" % (response.status, _message(response))
                continue
            return response
        return last or "gitlab: запрос не удался"

    def _backoff(self, attempt, retry_after):
        delay = 2 ** attempt
        if retry_after:
            try:
                delay = float(retry_after)
            except (TypeError, ValueError):
                pass
        self._sleep(delay)


def _message(response) -> str:
    body = getattr(response, "body", None)
    if isinstance(body, dict):
        return str(body.get("message") or body.get("error") or "")
    return ""
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_gitlabclient -v`
Expected: PASS, 14 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/gitlabclient.py tests/test_gitlabclient.py
git commit -m "Клиент GitLab: дерево PATCH, пагинация, ретраи, мемоизация"
```

---

### Task 8: Сбор снапшота тега

**Files:**
- Create: `kojipatch/collect.py`
- Test: `tests/test_collect.py`

**Interfaces:**
- Consumes: `KojiClient`, `GitlabClient`, `Classifier`, `parse_source_url`, `Config`, модель.
- Produces: `collect_tag(tag: str, cfg: Config, koji_client, gitlab_client, jobs: int = 8, now: Optional[str] = None, progress=None) -> Snapshot`, `problem_summary(snapshot: Snapshot) -> Dict[str, int]`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_collect.py`:

```python
import unittest

from kojipatch.classify import Classifier
from kojipatch.collect import collect_tag, problem_summary
from kojipatch.config import Config, GitlabHost
from kojipatch.gitlabclient import GitlabClient
from kojipatch.kojiclient import KojiClient
from tests.fakes import FakeKojiSession, FakeTransport, Response

HOST = "gitlab.example.com"
HOSTS = {HOST: GitlabHost(api="https://gitlab.example.com/api/v4",
                          web="https://gitlab.example.com")}
TREE = "https://gitlab.example.com/api/v4/projects/%s/repository/tree"

TAGGED = {"os-9.2": [
    {"build_id": 1, "name": "nginx"},
    {"build_id": 2, "name": "curl"},
    {"build_id": 3, "name": "vim"},
]}
BUILDS = {
    1: {"build_id": 1, "task_id": 11, "name": "nginx", "version": "1.24.0",
        "release": "3.el9", "epoch": None, "nvr": "nginx-1.24.0-3.el9",
        "owner_name": "builder", "completion_time": "2026-05-14 10:00:00",
        "extra": {"source": {"original_url":
                             "git+ssh://git@gitlab.example.com/g/nginx?#origin/br"}}},
    2: {"build_id": 2, "task_id": 12, "name": "curl", "version": "8.0.1",
        "release": "1.el9", "epoch": None, "nvr": "curl-8.0.1-1.el9",
        "owner_name": "builder", "completion_time": "2026-04-01 10:00:00",
        "extra": {}},
    3: {"build_id": 3, "task_id": 13, "name": "vim", "version": "9.0",
        "release": "1.el9", "epoch": 2, "nvr": "vim-9.0-1.el9",
        "owner_name": "builder", "completion_time": "2026-03-01 10:00:00",
        "extra": {"source": {"original_url":
                             "git+ssh://git@gitlab.example.com/g/vim?#origin/br"}}},
}
RPMS = {1: [{"name": "nginx", "version": "1.24.0", "release": "3.el9",
             "arch": "x86_64"}],
        2: [], 3: []}


def make_clients(routes):
    session = FakeKojiSession(tagged=TAGGED, builds=BUILDS, rpms=RPMS)
    transport = FakeTransport(routes)
    gitlab = GitlabClient(HOSTS, token=None, transport=transport,
                          sleeper=lambda _s: None)
    return KojiClient(session), gitlab, transport


def config():
    return Config(koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                  gitlab_hosts=HOSTS,
                  patch_classes=[("CVE", r"CVE-\d{4}-\d{4,}"),
                                 ("SAST", r"(?i)^sast[-_]"),
                                 ("other", ".*")])


class CollectTagTest(unittest.TestCase):
    def setUp(self):
        self.routes = {
            TREE % "g%2Fnginx": Response(200, [
                {"name": "CVE-2024-7347.patch", "type": "blob",
                 "path": "PATCH/CVE-2024-7347.patch"},
                {"name": "sast-x.patch", "type": "blob",
                 "path": "PATCH/sast-x.patch"}], {}),
            TREE % "g%2Fvim": Response(404, {"message": "404 Tree Not Found"}, {}),
        }

    def collect(self):
        koji_client, gitlab, transport = make_clients(self.routes)
        snap = collect_tag("os-9.2", config(), koji_client, gitlab, jobs=2,
                           now="2026-08-03T13:20:00+03:00")
        return snap, transport

    def test_snapshot_header(self):
        snap, _ = self.collect()
        self.assertEqual(snap.tag, "os-9.2")
        self.assertEqual(snap.generated, "2026-08-03T13:20:00+03:00")
        self.assertEqual(snap.koji_hub, "https://hub/kojihub")
        self.assertEqual(snap.koji_web, "https://hub/koji")

    def test_builds_are_sorted_by_name(self):
        snap, _ = self.collect()
        self.assertEqual([b.name for b in snap.builds], ["curl", "nginx", "vim"])

    def test_build_fields_are_filled(self):
        snap, _ = self.collect()
        build = snap.by_name()["nginx"]
        self.assertEqual(build.nvr, "nginx-1.24.0-3.el9")
        self.assertEqual(build.task_id, 11)
        self.assertEqual(build.owner, "builder")
        self.assertEqual(build.completed, "2026-05-14")
        self.assertEqual(build.rpms, ["nginx-1.24.0-3.el9.x86_64"])

    def test_source_is_parsed_with_web_url(self):
        snap, _ = self.collect()
        source = snap.by_name()["nginx"].source
        self.assertEqual(source.project, "g/nginx")
        self.assertEqual(source.ref, "br")
        self.assertEqual(source.ref_kind, "branch")
        self.assertEqual(source.web_url,
                         "https://gitlab.example.com/g/nginx/-/tree/br")

    def test_patches_are_classified_with_links(self):
        snap, _ = self.collect()
        patches = snap.by_name()["nginx"].patches
        self.assertEqual([p.cls for p in patches], ["CVE", "SAST"])
        self.assertEqual(patches[0].cves, ["CVE-2024-7347"])
        self.assertEqual(patches[0].name, "CVE-2024-7347.patch")
        self.assertEqual(
            patches[0].web_url,
            "https://gitlab.example.com/g/nginx/-/blob/br/PATCH/CVE-2024-7347.patch")
        self.assertTrue(snap.by_name()["nginx"].patch_dir_present)

    def test_build_without_source_gets_a_problem(self):
        snap, _ = self.collect()
        build = snap.by_name()["curl"]
        self.assertIsNone(build.source)
        self.assertIsNone(build.patch_dir_present)
        self.assertEqual(build.problems, ["no source url"])

    def test_missing_patch_dir_is_not_a_problem(self):
        snap, _ = self.collect()
        build = snap.by_name()["vim"]
        self.assertIs(build.patch_dir_present, False)
        self.assertEqual(build.problems, [])
        self.assertEqual(build.patches, [])

    def test_gitlab_error_becomes_a_problem(self):
        self.routes[TREE % "g%2Fvim"] = Response(
            404, {"message": "404 Project Not Found"}, {})
        snap, _ = self.collect()
        build = snap.by_name()["vim"]
        self.assertIsNone(build.patch_dir_present)
        self.assertEqual(len(build.problems), 1)
        self.assertIn("Project Not Found", build.problems[0])

    def test_epoch_is_preserved(self):
        snap, _ = self.collect()
        self.assertEqual(snap.by_name()["vim"].epoch, 2)

    def test_progress_callback_is_called(self):
        koji_client, gitlab, _ = make_clients(self.routes)
        seen = []
        collect_tag("os-9.2", config(), koji_client, gitlab, jobs=1,
                    now="n", progress=lambda done, total: seen.append((done, total)))
        self.assertEqual(seen[-1], (3, 3))

    def test_problem_summary_counts_by_message(self):
        snap, _ = self.collect()
        summary = problem_summary(snap)
        self.assertEqual(summary["no source url"], 1)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `No module named 'kojipatch.collect'`

- [ ] **Step 3: Реализовать сбор**

`kojipatch/collect.py`:

```python
"""Сбор снапшота одного тега из koji и GitLab."""
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Dict, Optional

from .classify import Classifier, find_cves
from .model import Build, Patch, Snapshot, Source
from .sourceurl import SourceUrlError, parse_source_url


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().replace(
        microsecond=0).isoformat()


def _completed(raw) -> Optional[str]:
    """koji отдаёт completion_time строкой или float; нужна дата YYYY-MM-DD."""
    if raw in (None, ""):
        return None
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw).strftime("%Y-%m-%d")
    return str(raw)[:10]


def _original_url(info: dict) -> Optional[str]:
    extra = info.get("extra") or {}
    source = extra.get("source") or {}
    return source.get("original_url") or None


def collect_tag(tag: str, cfg, koji_client, gitlab_client, jobs: int = 8,
                now: Optional[str] = None, progress=None) -> Snapshot:
    """Собирает билды тега, их патчи и RPM в один снапшот."""
    classifier = Classifier.from_config(cfg)
    tagged = koji_client.tagged_builds(tag)
    build_ids = [item["build_id"] for item in tagged]
    details = koji_client.build_details(build_ids)
    rpms = koji_client.rpms_for(build_ids)

    infos = [details[bid] for bid in build_ids if bid in details]
    total = len(infos)
    done = [0]

    def handle(info) -> Build:
        build = _build_from_info(info, rpms.get(info.get("build_id"), []))
        _attach_patches(build, info, cfg, gitlab_client, classifier)
        done[0] += 1
        if progress:
            progress(done[0], total)
        return build

    workers = max(1, int(jobs))
    if workers == 1 or total <= 1:
        builds = [handle(info) for info in infos]
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            builds = list(pool.map(handle, infos))

    builds.sort(key=lambda b: b.name)
    return Snapshot(tag=tag, generated=now or _now_iso(),
                    koji_hub=cfg.koji_hub, koji_web=cfg.koji_web, builds=builds)


def _build_from_info(info: dict, rpms) -> Build:
    return Build(
        nvr=info.get("nvr") or "%s-%s-%s" % (info.get("name"),
                                             info.get("version"),
                                             info.get("release")),
        name=info.get("name"), version=info.get("version"),
        release=info.get("release"), epoch=info.get("epoch"),
        build_id=info.get("build_id"), task_id=info.get("task_id"),
        owner=info.get("owner_name"),
        completed=_completed(info.get("completion_time")),
        rpms=list(rpms), patches=[], problems=[])


def _attach_patches(build: Build, info: dict, cfg, gitlab_client,
                    classifier: Classifier) -> None:
    raw_url = _original_url(info)
    if not raw_url:
        build.problems.append("no source url")
        return
    try:
        parsed = parse_source_url(raw_url)
    except SourceUrlError as exc:
        build.source = Source(raw=raw_url)
        build.problems.append("bad source url: %s" % exc)
        return

    build.source = Source(
        raw=raw_url, host=parsed.host, project=parsed.project, ref=parsed.ref,
        ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref))

    result = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    build.patch_dir_present = result.present
    if result.problem:
        build.problems.append(result.problem)
        return
    for path in result.paths:
        name = os.path.basename(path)
        build.patches.append(Patch(
            path=path, name=name, cls=classifier.classify(name),
            cves=find_cves(name),
            web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                           parsed.ref, path)))


def problem_summary(snapshot: Snapshot) -> Dict[str, int]:
    """Сколько раз встретилась каждая проблема — для сводки в stderr."""
    counts = {}
    for build in snapshot.builds:
        for problem in build.problems:
            key = problem.split(":")[0] if problem.startswith("gitlab:") else problem
            counts[key] = counts.get(key, 0) + 1
    return counts
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_collect -v`
Expected: PASS, 11 тестов

Если `test_problem_summary_counts_by_message` падает из-за группировки ключей — привести `problem_summary` к тому, что проверяет тест: ключ `no source url` остаётся целиком, а сообщения `gitlab: ...` группируются под ключом `gitlab`.

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/collect.py tests/test_collect.py
git commit -m "Сбор снапшота тега: билды, источники, патчи"
```

---

### Task 9: Дифф снапшотов

**Files:**
- Create: `kojipatch/diff.py`
- Test: `tests/test_diff.py`

**Interfaces:**
- Consumes: `Snapshot`, `Build`, `compare_evr`.
- Produces: dataclass `ComponentDiff(name, status, old, new, patches_added, patches_removed, rpms_added, rpms_removed, branch_changed, repackaged)` (`status` ∈ `{"added", "removed", "unchanged", "upgraded", "downgraded"}`), dataclass `PairDiff(old_tag, new_tag, is_summary, components, counts)`, функции `diff_snapshots(old, new, is_summary=False) -> PairDiff`, `diff_chain(snapshots) -> List[PairDiff]`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_diff.py`:

```python
import unittest

from kojipatch.diff import diff_chain, diff_snapshots
from kojipatch.model import Build, Patch, Snapshot, Source


def build(name, version="1.0", release="1.el9", patches=(), rpms=(),
          ref="main", epoch=None):
    return Build(nvr="%s-%s-%s" % (name, version, release), name=name,
                 version=version, release=release, epoch=epoch,
                 source=Source(raw="r", host="h", project="g/" + name, ref=ref,
                               ref_kind="branch"),
                 patch_dir_present=True,
                 patches=[Patch(path="PATCH/" + p, name=p,
                                cls="CVE" if p.startswith("CVE") else "other",
                                cves=[]) for p in patches],
                 rpms=list(rpms), problems=[])


def snap(tag, builds):
    return Snapshot(tag=tag, generated="g", koji_hub="h", koji_web=None,
                    builds=list(builds))


class StatusTest(unittest.TestCase):
    def diff_of(self, old_builds, new_builds):
        pair = diff_snapshots(snap("a", old_builds), snap("b", new_builds))
        return {c.name: c for c in pair.components}

    def test_added(self):
        got = self.diff_of([], [build("nginx")])
        self.assertEqual(got["nginx"].status, "added")
        self.assertIsNone(got["nginx"].old)

    def test_removed(self):
        got = self.diff_of([build("nginx")], [])
        self.assertEqual(got["nginx"].status, "removed")
        self.assertIsNone(got["nginx"].new)

    def test_unchanged(self):
        got = self.diff_of([build("nginx")], [build("nginx")])
        self.assertEqual(got["nginx"].status, "unchanged")

    def test_upgraded(self):
        got = self.diff_of([build("nginx", "1.0")], [build("nginx", "1.1")])
        self.assertEqual(got["nginx"].status, "upgraded")

    def test_downgraded(self):
        got = self.diff_of([build("nginx", "1.1")], [build("nginx", "1.0")])
        self.assertEqual(got["nginx"].status, "downgraded")

    def test_release_only_change_is_an_upgrade(self):
        got = self.diff_of([build("nginx", "1.0", "1.el9")],
                           [build("nginx", "1.0", "2.el9")])
        self.assertEqual(got["nginx"].status, "upgraded")

    def test_epoch_dominates(self):
        got = self.diff_of([build("nginx", "9.0", epoch=None)],
                           [build("nginx", "1.0", epoch=1)])
        self.assertEqual(got["nginx"].status, "upgraded")


class DetailsTest(unittest.TestCase):
    def diff_of(self, old_builds, new_builds):
        pair = diff_snapshots(snap("a", old_builds), snap("b", new_builds))
        return {c.name: c for c in pair.components}

    def test_patch_delta(self):
        got = self.diff_of(
            [build("nginx", patches=["CVE-2024-1111.patch", "old.patch"])],
            [build("nginx", patches=["CVE-2024-1111.patch", "new.patch"])])
        component = got["nginx"]
        self.assertEqual(component.patches_added, ["PATCH/new.patch"])
        self.assertEqual(component.patches_removed, ["PATCH/old.patch"])

    def test_rpm_delta_sets_repackaged(self):
        got = self.diff_of([build("nginx", rpms=["a.x86_64", "b.x86_64"])],
                           [build("nginx", rpms=["a.x86_64", "c.x86_64"])])
        component = got["nginx"]
        self.assertEqual(component.rpms_added, ["c.x86_64"])
        self.assertEqual(component.rpms_removed, ["b.x86_64"])
        self.assertTrue(component.repackaged)

    def test_branch_change_is_flagged(self):
        got = self.diff_of([build("nginx", ref="br-9.1")],
                           [build("nginx", ref="br-9.2")])
        self.assertTrue(got["nginx"].branch_changed)

    def test_same_branch_is_not_flagged(self):
        got = self.diff_of([build("nginx")], [build("nginx")])
        self.assertFalse(got["nginx"].branch_changed)

    def test_added_component_has_no_deltas(self):
        got = self.diff_of([], [build("nginx", patches=["a.patch"])])
        self.assertEqual(got["nginx"].patches_added, [])
        self.assertFalse(got["nginx"].repackaged)


class CountsTest(unittest.TestCase):
    def test_counts_cover_every_bucket(self):
        pair = diff_snapshots(
            snap("a", [build("keep"), build("gone"), build("up", "1.0"),
                       build("down", "2.0"),
                       build("patched", patches=["old.patch"])]),
            snap("b", [build("keep"), build("new"), build("up", "1.1"),
                       build("down", "1.0"),
                       build("patched", patches=["new.patch"])]))
        counts = pair.counts
        self.assertEqual(counts["added"], 1)
        self.assertEqual(counts["removed"], 1)
        self.assertEqual(counts["upgraded"], 1)
        self.assertEqual(counts["downgraded"], 1)
        self.assertEqual(counts["unchanged"], 2)
        self.assertEqual(counts["patches_added"], 1)
        self.assertEqual(counts["patches_removed"], 1)
        self.assertEqual(counts["repackaged"], 0)
        self.assertEqual(counts["branch_changed"], 0)

    def test_tags_are_recorded(self):
        pair = diff_snapshots(snap("t1", []), snap("t2", []))
        self.assertEqual((pair.old_tag, pair.new_tag), ("t1", "t2"))
        self.assertFalse(pair.is_summary)

    def test_components_sorted_by_name(self):
        pair = diff_snapshots(snap("a", [build("zzz"), build("aaa")]),
                              snap("b", [build("aaa"), build("zzz")]))
        self.assertEqual([c.name for c in pair.components], ["aaa", "zzz"])


class ChainTest(unittest.TestCase):
    def test_single_snapshot_gives_no_pairs(self):
        self.assertEqual(diff_chain([snap("a", [])]), [])

    def test_two_snapshots_give_one_pair_without_summary(self):
        pairs = diff_chain([snap("a", []), snap("b", [])])
        self.assertEqual(len(pairs), 1)
        self.assertFalse(pairs[0].is_summary)

    def test_three_snapshots_give_two_steps_plus_summary(self):
        pairs = diff_chain([snap("a", []), snap("b", []), snap("c", [])])
        self.assertEqual([(p.old_tag, p.new_tag, p.is_summary) for p in pairs],
                         [("a", "b", False), ("b", "c", False),
                          ("a", "c", True)])

    def test_summary_compares_endpoints_not_steps(self):
        # компонент удалён на шаге 2 и вернулся на шаге 3 — в итоге он неизменен
        pairs = diff_chain([snap("a", [build("nginx")]), snap("b", []),
                            snap("c", [build("nginx")])])
        summary = pairs[-1]
        component = {c.name: c for c in summary.components}["nginx"]
        self.assertEqual(component.status, "unchanged")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_diff -v`
Expected: FAIL — `No module named 'kojipatch.diff'`

- [ ] **Step 3: Реализовать дифф**

`kojipatch/diff.py`:

```python
"""Сравнение снапшотов тегов."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .model import Build, Snapshot
from .rpmvercmp import compare_evr

STATUSES = ("added", "removed", "unchanged", "upgraded", "downgraded")


@dataclass
class ComponentDiff:
    name: str
    status: str
    old: Optional[Build] = None
    new: Optional[Build] = None
    patches_added: List[str] = field(default_factory=list)
    patches_removed: List[str] = field(default_factory=list)
    rpms_added: List[str] = field(default_factory=list)
    rpms_removed: List[str] = field(default_factory=list)
    branch_changed: bool = False
    repackaged: bool = False

    def changed(self) -> bool:
        return (self.status != "unchanged" or self.patches_added
                or self.patches_removed or self.repackaged
                or self.branch_changed)


@dataclass
class PairDiff:
    old_tag: str
    new_tag: str
    is_summary: bool
    components: List[ComponentDiff]
    counts: Dict[str, int]


def _status(old: Build, new: Build) -> str:
    result = compare_evr(old.evr(), new.evr())
    if result == 0:
        return "unchanged"
    return "upgraded" if result < 0 else "downgraded"


def _ref(build: Optional[Build]) -> Optional[str]:
    return build.source.ref if build and build.source else None


def diff_snapshots(old: Snapshot, new: Snapshot,
                   is_summary: bool = False) -> PairDiff:
    """Сравнивает два снапшота по именам компонентов."""
    old_map = old.by_name()
    new_map = new.by_name()
    components = []

    for name in sorted(set(old_map) | set(new_map)):
        old_build = old_map.get(name)
        new_build = new_map.get(name)
        if old_build is None:
            components.append(ComponentDiff(name=name, status="added",
                                            new=new_build))
            continue
        if new_build is None:
            components.append(ComponentDiff(name=name, status="removed",
                                            old=old_build))
            continue

        old_patches = {p.path for p in old_build.patches}
        new_patches = {p.path for p in new_build.patches}
        old_rpms = set(old_build.rpms)
        new_rpms = set(new_build.rpms)
        rpms_added = sorted(new_rpms - old_rpms)
        rpms_removed = sorted(old_rpms - new_rpms)
        components.append(ComponentDiff(
            name=name, status=_status(old_build, new_build),
            old=old_build, new=new_build,
            patches_added=sorted(new_patches - old_patches),
            patches_removed=sorted(old_patches - new_patches),
            rpms_added=rpms_added, rpms_removed=rpms_removed,
            branch_changed=_ref(old_build) != _ref(new_build),
            repackaged=bool(rpms_added or rpms_removed)))

    return PairDiff(old_tag=old.tag, new_tag=new.tag, is_summary=is_summary,
                    components=components, counts=_counts(components))


def _counts(components: List[ComponentDiff]) -> Dict[str, int]:
    counts = {status: 0 for status in STATUSES}
    counts.update({"patches_added": 0, "patches_removed": 0,
                   "repackaged": 0, "branch_changed": 0, "changed": 0})
    for component in components:
        counts[component.status] += 1
        if component.patches_added:
            counts["patches_added"] += 1
        if component.patches_removed:
            counts["patches_removed"] += 1
        if component.repackaged:
            counts["repackaged"] += 1
        if component.branch_changed:
            counts["branch_changed"] += 1
        if component.changed():
            counts["changed"] += 1
    return counts


def diff_chain(snapshots: List[Snapshot]) -> List[PairDiff]:
    """Пары подряд идущих снапшотов плюс сводная пара первый→последний."""
    if len(snapshots) < 2:
        return []
    pairs = [diff_snapshots(snapshots[i], snapshots[i + 1])
             for i in range(len(snapshots) - 1)]
    if len(snapshots) > 2:
        pairs.append(diff_snapshots(snapshots[0], snapshots[-1],
                                    is_summary=True))
    return pairs
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_diff -v`
Expected: PASS, 18 тестов

- [ ] **Step 5: Коммит**

```bash
git add kojipatch/diff.py tests/test_diff.py
git commit -m "Дифф снапшотов: статусы, патчи, RPM, цепочка"
```

---

### Task 10: Подготовка данных страницы и рендер

**Files:**
- Create: `kojipatch/render.py`
- Create: `kojipatch/assets/dashboard.html` (временный каркас; полноценный дизайн — задача 11)
- Test: `tests/test_render.py`

**Interfaces:**
- Consumes: `Snapshot`, `PairDiff`, `Classifier`.
- Produces: `build_page_data(snapshots, pairs, classifier) -> dict`, `render_html(snapshots, pairs, classifier, template_path=None) -> str`, `TEMPLATE_PATH`, `PLACEHOLDER = "/*__DATA__*/"`, `RenderError`.

Форма `page_data` — контракт между Python и JS, задача 11 опирается на него:

```json
{
  "generated": "2026-08-03T13:20:00+03:00",
  "patch_classes": ["CVE", "SAST", "DAST", "other"],
  "snapshots": [{
    "tag": "os-9.2", "generated": "...", "koji_web": "...",
    "counts": {"builds": 3, "with_patches": 1, "without_patches": 1,
               "problems": 1, "patch_files": 2,
               "by_class": {"CVE": {"builds": 1, "files": 1}}},
    "builds": [{"name": "...", "nvr": "...", "version": "...", "release": "...",
                "evr": "1.24.0-3.el9", "branch": "br", "ref_kind": "branch",
                "project": "g/nginx", "source_url": "...", "koji_url": "...",
                "completed": "2026-05-14", "owner": "builder",
                "build_id": 1, "task_id": 11,
                "patches": [{"path": "...", "name": "...", "class": "CVE",
                             "cves": ["CVE-2024-7347"], "url": "..."}],
                "patch_counts": {"CVE": 1}, "rpms": ["..."],
                "problems": [], "tags": ["cve"]}]
  }],
  "pairs": [{
    "old": "os-9.1", "new": "os-9.2", "summary": false,
    "counts": {"added": 1, "removed": 1, "upgraded": 1, "downgraded": 0,
               "unchanged": 2, "repackaged": 0, "patches_added": 1,
               "patches_removed": 1, "branch_changed": 0, "changed": 4},
    "rows": [{"name": "nginx", "status": "upgraded", "changed": true,
              "old_evr": "1.24.0-3.el9", "new_evr": "1.25.0-1.el9",
              "old_branch": "br-9.1", "new_branch": "br-9.2",
              "patches_added": [...], "patches_removed": [...],
              "rpms_added": [...], "rpms_removed": [...],
              "old_patches": [...], "new_patches": [...],
              "old_rpms": [...], "new_rpms": [...],
              "koji_url": "...", "source_url": "...", "tags": ["upgraded"]}]
  }]
}
```

Теги строк в состоянии: класс каждого патча в нижнем регистре (`cve`, `sast`, `dast`, `other`), плюс `no-patch` (каталога нет), `no-source`, `gitlab-error`, `from-commit`. Теги строк в диффе: `status`, плюс `repackaged`, `patches+`, `patches-`, `branch-changed`.

- [ ] **Step 1: Написать падающий тест**

`tests/test_render.py`:

```python
import json
import re
import unittest

from kojipatch.classify import Classifier
from kojipatch.diff import diff_chain
from kojipatch.model import Build, Patch, Snapshot, Source
from kojipatch.render import PLACEHOLDER, build_page_data, render_html

RULES = [("CVE", r"CVE-\d{4}-\d{4,}"), ("SAST", r"(?i)^sast[-_]"),
         ("DAST", r"(?i)^dast[-_]"), ("other", ".*")]


def patch(name, cls):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=[],
                 web_url="https://gl/blob/" + name)


def build(name, version="1.0", patches=(), problems=(), present=True,
          ref="main", ref_kind="branch", rpms=("a.x86_64",)):
    source = None
    if ref is not None:
        source = Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                        host="h", project="g/" + name, ref=ref,
                        ref_kind=ref_kind, web_url="https://gl/tree")
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 owner="builder", completed="2026-05-14", source=source,
                 patch_dir_present=present, patches=list(patches),
                 rpms=list(rpms), problems=list(problems))


def snap(tag, builds):
    return Snapshot(tag=tag, generated="2026-08-03T13:20:00+03:00",
                    koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                    builds=list(builds))


class PageDataTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshot = snap("os-9.2", [
            build("nginx", patches=[patch("CVE-2024-7347.patch", "CVE"),
                                    patch("sast-x.patch", "SAST")]),
            build("curl", present=False),
            build("vim", ref=None, problems=["no source url"], present=None),
        ])

    def data(self, snapshots=None, pairs=None):
        snapshots = snapshots or [self.snapshot]
        return build_page_data(snapshots, pairs or [], self.classifier)

    def test_patch_classes_come_from_classifier(self):
        self.assertEqual(self.data()["patch_classes"],
                         ["CVE", "SAST", "DAST", "other"])

    def test_snapshot_counts(self):
        counts = self.data()["snapshots"][0]["counts"]
        self.assertEqual(counts["builds"], 3)
        self.assertEqual(counts["with_patches"], 1)
        self.assertEqual(counts["without_patches"], 1)
        self.assertEqual(counts["problems"], 1)
        self.assertEqual(counts["patch_files"], 2)
        self.assertEqual(counts["by_class"]["CVE"], {"builds": 1, "files": 1})
        self.assertEqual(counts["by_class"]["DAST"], {"builds": 0, "files": 0})

    def test_builds_are_sorted_by_name(self):
        rows = self.data()["snapshots"][0]["builds"]
        self.assertEqual([r["name"] for r in rows], ["curl", "nginx", "vim"])

    def test_build_row_fields(self):
        row = self.data()["snapshots"][0]["builds"][1]  # curl, nginx, vim
        self.assertEqual(row["name"], "nginx")
        self.assertEqual(row["evr"], "1.0-1.el9")
        self.assertEqual(row["branch"], "main")
        self.assertEqual(row["patch_counts"], {"CVE": 1, "SAST": 1})
        self.assertTrue(row["koji_url"].endswith("nginx-1.0-1.el9"))

    def test_row_tags_for_patch_classes(self):
        rows = {r["name"]: r for r in self.data()["snapshots"][0]["builds"]}
        self.assertEqual(sorted(rows["nginx"]["tags"]), ["cve", "sast"])
        self.assertIn("no-patch", rows["curl"]["tags"])
        self.assertIn("no-source", rows["vim"]["tags"])

    def test_gitlab_error_tag(self):
        broken = build("bad", problems=["gitlab: 403 Forbidden"], present=None)
        rows = self.data([snap("t", [broken])])["snapshots"][0]["builds"]
        self.assertIn("gitlab-error", rows[0]["tags"])

    def test_from_commit_tag(self):
        commit = build("c", ref="a1b2c3d", ref_kind="commit")
        rows = self.data([snap("t", [commit])])["snapshots"][0]["builds"]
        self.assertIn("from-commit", rows[0]["tags"])

    def test_pairs_are_rendered(self):
        old = snap("os-9.1", [build("nginx", "1.0"), build("gone")])
        new = snap("os-9.2", [build("nginx", "1.1"), build("fresh")])
        data = self.data([old, new], diff_chain([old, new]))
        pair = data["pairs"][0]
        self.assertEqual((pair["old"], pair["new"]), ("os-9.1", "os-9.2"))
        rows = {r["name"]: r for r in pair["rows"]}
        self.assertEqual(rows["nginx"]["old_evr"], "1.0-1.el9")
        self.assertEqual(rows["nginx"]["new_evr"], "1.1-1.el9")
        self.assertIn("upgraded", rows["nginx"]["tags"])
        self.assertEqual(rows["gone"]["status"], "removed")
        self.assertEqual(pair["counts"]["added"], 1)

    def test_summary_pair_is_marked(self):
        snaps = [snap("a", []), snap("b", []), snap("c", [])]
        data = self.data(snaps, diff_chain(snaps))
        self.assertTrue(data["pairs"][-1]["summary"])


class RenderHtmlTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        self.snapshots = [snap("os-9.2", [build("nginx")])]

    def html(self, snapshots=None):
        return render_html(snapshots or self.snapshots, [], self.classifier)

    def test_no_placeholder_remains(self):
        self.assertNotIn(PLACEHOLDER, self.html())

    def test_embedded_json_parses(self):
        match = re.search(r"var DATA = (.*?);\n", self.html(), re.S)
        self.assertIsNotNone(match)
        data = json.loads(match.group(1))
        self.assertEqual(data["snapshots"][0]["tag"], "os-9.2")

    def test_script_close_tag_is_escaped(self):
        nasty = build("evil</script><script>alert(1)</script>")
        html = self.html([snap("t", [nasty])])
        self.assertNotIn("</script><script>alert(1)", html)
        self.assertIn("<\\/script>", html)

    def test_html_has_both_tab_containers(self):
        html = self.html()
        self.assertIn('id="tab-state"', html)
        self.assertIn('id="tab-diff"', html)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_render -v`
Expected: FAIL — `No module named 'kojipatch.render'`

- [ ] **Step 3: Реализовать сборку данных и рендер**

`kojipatch/render.py`:

```python
"""Подготовка данных страницы и подстановка их в HTML-шаблон."""
import json
import os
from typing import Dict, List, Optional
from urllib.parse import quote

PLACEHOLDER = "/*__DATA__*/"
TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "assets",
                             "dashboard.html")


class RenderError(Exception):
    """Шаблон не найден или в нём нет плейсхолдера данных."""


def _koji_url(koji_web: Optional[str], nvr: str) -> Optional[str]:
    if not koji_web:
        return None
    return "%s/search?match=exact&type=build&terms=%s" % (
        koji_web.rstrip("/"), quote(nvr))


def _evr(build) -> str:
    prefix = "%s:" % build.epoch if build.epoch else ""
    return "%s%s-%s" % (prefix, build.version, build.release)


def _build_tags(build) -> List[str]:
    tags = []
    for patch in build.patches:
        tag = patch.cls.lower()
        if tag not in tags:
            tags.append(tag)
    if build.source is None:
        tags.append("no-source")
    elif build.source.ref_kind == "commit":
        tags.append("from-commit")
    if build.patch_dir_present is False:
        tags.append("no-patch")
    if any(p.startswith("gitlab:") or p.startswith("bad source")
           for p in build.problems):
        tags.append("gitlab-error")
    return tags


def _patch_dict(patch) -> Dict[str, object]:
    return {"path": patch.path, "name": patch.name, "class": patch.cls,
            "cves": list(patch.cves), "url": patch.web_url}


def _build_row(build, koji_web) -> Dict[str, object]:
    counts = {}
    for patch in build.patches:
        counts[patch.cls] = counts.get(patch.cls, 0) + 1
    source = build.source
    return {
        "name": build.name, "nvr": build.nvr, "version": build.version,
        "release": build.release, "evr": _evr(build),
        "branch": source.ref if source else None,
        "ref_kind": source.ref_kind if source else "none",
        "project": source.project if source else None,
        "source_url": source.web_url if source else None,
        "koji_url": _koji_url(koji_web, build.nvr),
        "completed": build.completed, "owner": build.owner,
        "build_id": build.build_id, "task_id": build.task_id,
        "patches": [_patch_dict(p) for p in build.patches],
        "patch_counts": counts, "rpms": list(build.rpms),
        "patch_dir_present": build.patch_dir_present,
        "problems": list(build.problems), "tags": _build_tags(build),
    }


def _snapshot_counts(rows, class_names) -> Dict[str, object]:
    by_class = {name: {"builds": 0, "files": 0} for name in class_names}
    with_patches = without_patches = problems = files = 0
    for row in rows:
        if row["patches"]:
            with_patches += 1
        if row["patch_dir_present"] is False:
            without_patches += 1
        if row["problems"]:
            problems += 1
        files += len(row["patches"])
        for name, count in row["patch_counts"].items():
            bucket = by_class.setdefault(name, {"builds": 0, "files": 0})
            bucket["builds"] += 1
            bucket["files"] += count
    return {"builds": len(rows), "with_patches": with_patches,
            "without_patches": without_patches, "problems": problems,
            "patch_files": files, "by_class": by_class}


def _diff_tags(component) -> List[str]:
    tags = [component.status]
    if component.repackaged:
        tags.append("repackaged")
    if component.patches_added:
        tags.append("patches+")
    if component.patches_removed:
        tags.append("patches-")
    if component.branch_changed:
        tags.append("branch-changed")
    return tags


def _diff_row(component, koji_web) -> Dict[str, object]:
    old, new = component.old, component.new
    shown = new or old
    return {
        "name": component.name, "status": component.status,
        "changed": bool(component.changed()),
        "old_evr": _evr(old) if old else None,
        "new_evr": _evr(new) if new else None,
        "old_branch": old.source.ref if old and old.source else None,
        "new_branch": new.source.ref if new and new.source else None,
        "patches_added": list(component.patches_added),
        "patches_removed": list(component.patches_removed),
        "rpms_added": list(component.rpms_added),
        "rpms_removed": list(component.rpms_removed),
        "old_patches": [_patch_dict(p) for p in (old.patches if old else [])],
        "new_patches": [_patch_dict(p) for p in (new.patches if new else [])],
        "old_rpms": list(old.rpms) if old else [],
        "new_rpms": list(new.rpms) if new else [],
        "koji_url": _koji_url(koji_web, shown.nvr) if shown else None,
        "source_url": (shown.source.web_url
                       if shown and shown.source else None),
        "tags": _diff_tags(component),
    }


def build_page_data(snapshots, pairs, classifier) -> Dict[str, object]:
    """Собирает всё, что нужно фронтенду, в один сериализуемый словарь."""
    class_names = classifier.class_names()
    snapshot_blocks = []
    for snapshot in snapshots:
        # порядок билдов в снапшоте не гарантирован — сортируем здесь
        rows = sorted((_build_row(b, snapshot.koji_web)
                       for b in snapshot.builds),
                      key=lambda row: row["name"])
        snapshot_blocks.append({
            "tag": snapshot.tag, "generated": snapshot.generated,
            "koji_web": snapshot.koji_web,
            "counts": _snapshot_counts(rows, class_names), "builds": rows})

    koji_web = snapshots[0].koji_web if snapshots else None
    pair_blocks = [{
        "old": pair.old_tag, "new": pair.new_tag, "summary": pair.is_summary,
        "counts": dict(pair.counts),
        "rows": [_diff_row(c, koji_web) for c in pair.components],
    } for pair in pairs]

    return {"generated": snapshots[0].generated if snapshots else "",
            "patch_classes": class_names, "snapshots": snapshot_blocks,
            "pairs": pair_blocks}


def _encode(data: Dict[str, object]) -> str:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    # безопасная вставка внутрь <script>
    return (text.replace("</", "<\\/")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029"))


def render_html(snapshots, pairs, classifier,
                template_path: Optional[str] = None) -> str:
    path = template_path or TEMPLATE_PATH
    try:
        with open(path, "r", encoding="utf-8") as handle:
            template = handle.read()
    except OSError as exc:
        raise RenderError("не прочитать шаблон %s: %s" % (path, exc))
    if PLACEHOLDER not in template:
        raise RenderError("в шаблоне %s нет плейсхолдера %s"
                          % (path, PLACEHOLDER))
    data = build_page_data(snapshots, pairs, classifier)
    return template.replace(PLACEHOLDER, _encode(data))
```

- [ ] **Step 4: Создать временный шаблон**

`kojipatch/assets/dashboard.html` — каркас, который в задаче 11 будет заменён полноценным дизайном. Он обязан содержать `var DATA = /*__DATA__*/;` и контейнеры вкладок:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Koji patch dashboard</title>
</head>
<body>
<div class="wrap">
  <h1>Koji patch dashboard</h1>
  <section id="tab-state"></section>
  <section id="tab-diff" hidden></section>
</div>
<script>
var DATA = /*__DATA__*/;
document.getElementById('tab-state').textContent =
  'snapshots: ' + DATA.snapshots.length + ', pairs: ' + DATA.pairs.length;
</script>
</body>
</html>
```

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_render -v`
Expected: PASS, 13 тестов

- [ ] **Step 6: Коммит**

```bash
git add kojipatch/render.py kojipatch/assets/dashboard.html tests/test_render.py
git commit -m "Подготовка данных страницы и рендер в HTML-шаблон"
```

---

### Task 11: CLI и сквозной прогон

**Files:**
- Create: `kojipatch/cli.py`, `kojipatch/__main__.py`
- Test: `tests/test_cli.py`
- Create: `tests/fixtures/snapshot-os-9.1.json`, `tests/fixtures/snapshot-os-9.2.json`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: `main(argv: Optional[List[str]] = None) -> int`, подкоманды `collect`, `render`, `run`. Коды возврата: 0 — успех, 1 — проблем больше `--max-problems`, 2 — фатальная ошибка.

- [ ] **Step 1: Написать падающий тест**

Фикстуры создаются самим тестом через модель — отдельные JSON-файлы в `tests/fixtures/` пишет `setUpClass`, чтобы они всегда соответствовали текущей схеме.

`tests/test_cli.py`:

```python
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout

from kojipatch.cli import main
from kojipatch.model import (Build, Patch, Snapshot, Source, dump_snapshots,
                             load_snapshots)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures")


def patch(name, cls="CVE"):
    return Patch(path="PATCH/" + name, name=name, cls=cls,
                 cves=[name.split(".")[0]] if cls == "CVE" else [],
                 web_url="https://gl/blob/" + name)


def build(name, version, patches=(), rpms=("a.x86_64",), ref="main"):
    return Build(nvr="%s-%s-1.el9" % (name, version), name=name,
                 version=version, release="1.el9", build_id=1, task_id=2,
                 owner="builder", completed="2026-05-14",
                 source=Source(raw="git+ssh://git@h/g/%s?#origin/%s" % (name, ref),
                               host="h", project="g/" + name, ref=ref,
                               ref_kind="branch", web_url="https://gl/tree"),
                 patch_dir_present=True, patches=list(patches),
                 rpms=list(rpms), problems=[])


class CliRenderTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.makedirs(FIXTURES, exist_ok=True)
        old = Snapshot(tag="os-9.1", generated="2026-07-01T00:00:00+03:00",
                       koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                       builds=[build("nginx", "1.24.0",
                                     [patch("CVE-2024-7347.patch")]),
                               build("gone", "1.0")])
        new = Snapshot(tag="os-9.2", generated="2026-08-01T00:00:00+03:00",
                       koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
                       builds=[build("nginx", "1.25.0",
                                     [patch("CVE-2024-7347.patch"),
                                      patch("sast-x.patch", "SAST")],
                                     ref="br-9.2"),
                               build("fresh", "2.0")])
        dump_snapshots([old], os.path.join(FIXTURES, "snapshot-os-9.1.json"))
        dump_snapshots([new], os.path.join(FIXTURES, "snapshot-os-9.2.json"))

    def out_path(self):
        fd, path = tempfile.mkstemp(suffix=".html")
        os.close(fd)
        return path

    def test_render_two_snapshots(self):
        out = self.out_path()
        code = main(["render",
                     os.path.join(FIXTURES, "snapshot-os-9.1.json"),
                     os.path.join(FIXTURES, "snapshot-os-9.2.json"),
                     "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            html = handle.read()
        self.assertIn("os-9.1", html)
        self.assertIn("os-9.2", html)
        self.assertNotIn("/*__DATA__*/", html)

    def test_render_single_snapshot_has_no_pairs(self):
        out = self.out_path()
        code = main(["render", os.path.join(FIXTURES, "snapshot-os-9.1.json"),
                     "-o", out])
        self.assertEqual(code, 0)
        with open(out, encoding="utf-8") as handle:
            self.assertIn('"pairs": []', handle.read().replace("\n", " ")
                          .replace('"pairs":[]', '"pairs": []'))

    def test_render_of_missing_file_is_fatal(self):
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(["render", "/nonexistent.json", "-o", self.out_path()])
        self.assertEqual(code, 2)
        self.assertIn("снапшот", err.getvalue())

    def test_bad_config_is_fatal(self):
        err = io.StringIO()
        with redirect_stderr(err):
            code = main(["--config", "/nonexistent.yaml", "collect",
                         "--tag", "t"])
        self.assertEqual(code, 2)

    def test_help_lists_subcommands(self):
        out = io.StringIO()
        with redirect_stdout(out):
            with self.assertRaises(SystemExit):
                main(["--help"])
        text = out.getvalue()
        for word in ("collect", "render", "run"):
            self.assertIn(word, text)


class SnapshotRoundTripTest(unittest.TestCase):
    def test_fixture_snapshots_load(self):
        snaps = load_snapshots(os.path.join(FIXTURES, "snapshot-os-9.2.json"))
        self.assertEqual(snaps[0].tag, "os-9.2")
        self.assertEqual(len(snaps[0].builds), 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `python3 -m unittest tests.test_cli -v`
Expected: FAIL — `No module named 'kojipatch.cli'`

- [ ] **Step 3: Реализовать CLI**

`kojipatch/cli.py`:

```python
"""Точка входа: collect, render, run."""
import argparse
import os
import sys
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
                        help="печатать прогресс сбора")

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
        sys.stderr.write("фатальная ошибка: %s\n" % exc)
        return EXIT_FATAL
```

`kojipatch/__main__.py`:

```python
import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest tests.test_cli -v`
Expected: PASS, 6 тестов

- [ ] **Step 5: Прогнать весь набор тестов**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS, 126 тестов (код и тесты из этого плана прогонялись целиком —
при точном следовании плану набор зелёный)

- [ ] **Step 6: Проверить сквозной сценарий вручную**

```bash
python3 -m kojipatch render tests/fixtures/snapshot-os-9.1.json tests/fixtures/snapshot-os-9.2.json -o /tmp/dash.html && grep -c 'var DATA' /tmp/dash.html
```
Expected: код возврата 0, `1` в выводе grep

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/cli.py kojipatch/__main__.py tests/test_cli.py tests/fixtures
git commit -m "CLI: collect, render, run и сквозной прогон на фикстурах"
```

---

### Task 12: Дизайн дашборда

**Files:**
- Modify: `kojipatch/assets/dashboard.html` (заменить каркас из задачи 10 полноценной страницей)
- Modify: `tests/test_render.py` (добавить проверки разметки)
- Read: `ref.html` — источник визуального языка

**Interfaces:**
- Consumes: `page_data` из задачи 10 — форма контракта описана там и менять её нельзя без правки `render.py` и его тестов.
- Produces: HTML-шаблон с плейсхолдером `/*__DATA__*/`, содержащий `id="tab-state"` и `id="tab-diff"`.

**ОБЯЗАТЕЛЬНО:** перед версткой вызвать skill `frontend-design` и следовать ему. Визуальная база — `ref.html`: те же имена CSS-переменных (`--bg`, `--fg`, `--muted`, `--line`, `--card`, `--accent`, `--up`, `--down`, `--added`, `--removed`, `--hit`), тёмная тема через `prefers-color-scheme`, карточки `.card`, sticky-шапка таблицы, тултипы `#tip` по `data-tip`, сортировка кликом по `th[data-sort]`.

- [ ] **Step 1: Написать падающие тесты разметки**

Добавить в `tests/test_render.py` новый класс:

```python
class TemplateContractTest(unittest.TestCase):
    def setUp(self):
        self.classifier = Classifier(RULES)
        old = snap("os-9.1", [build("nginx", "1.0")])
        new = snap("os-9.2", [build("nginx", "1.1",
                                    patches=[patch("CVE-2024-7347.patch", "CVE")])])
        from kojipatch.diff import diff_chain as chain
        self.html = render_html([old, new], chain([old, new]), self.classifier)

    def test_has_tab_navigation(self):
        self.assertIn('data-tab="state"', self.html)
        self.assertIn('data-tab="diff"', self.html)

    def test_has_search_and_expand_controls(self):
        self.assertIn('id="q"', self.html)
        self.assertIn('id="expand"', self.html)

    def test_has_active_filter_chip_bar(self):
        self.assertIn('id="chips"', self.html)

    def test_has_copy_nvr_button(self):
        self.assertIn('id="copy-nvr"', self.html)

    def test_reuses_ref_html_css_variables(self):
        for name in ("--bg", "--fg", "--muted", "--line", "--card",
                     "--accent", "--added", "--removed", "--hit"):
            self.assertIn(name, self.html, name)

    def test_supports_dark_theme(self):
        self.assertIn("prefers-color-scheme: dark", self.html)

    def test_tooltip_container_present(self):
        self.assertIn('id="tip"', self.html)

    def test_no_external_resources(self):
        for marker in ("<script src=", "<link rel=\"stylesheet\"", "https://cdn",
                       "@import"):
            self.assertNotIn(marker, self.html, marker)
```

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `python3 -m unittest tests.test_render.TemplateContractTest -v`
Expected: FAIL — в каркасе нет ни вкладок, ни контролов

- [ ] **Step 3: Вызвать skill frontend-design**

Вызвать `frontend-design` и по его указаниям спроектировать страницу. Ограничения, которые нельзя нарушать: ванильный JS, ноль внешних ресурсов, визуальный язык `ref.html`, поддержка светлой и тёмной темы.

- [ ] **Step 4: Сверстать шаблон**

Заменить `kojipatch/assets/dashboard.html`. Обязательная структура:

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Koji patch dashboard</title>
<style>
:root { /* переменные из ref.html */ }
@media (prefers-color-scheme: dark) { :root { /* тёмная тема */ } }
/* .card, .chip, .tabs, table, sticky thead, #tip — как в ref.html */
</style>
</head>
<body>
<div class="wrap">
  <h1>Koji patch dashboard</h1>
  <div class="meta" id="meta"></div>
  <nav class="tabs">
    <button class="tab" data-tab="state" aria-selected="true">Состояние</button>
    <button class="tab" data-tab="diff">Изменения</button>
  </nav>
  <section id="tab-state">
    <div class="selector" id="tag-select"></div>
    <div class="cards global" id="state-cards"></div>
    <div class="controls">
      <input type="search" id="q" placeholder="Компонент, ветка, патч, CVE, RPM…">
      <button id="expand" class="toggle">Expand all</button>
      <button id="copy-nvr" class="toggle" data-tip="Скопировать NVR отфильтрованных строк">Copy NVR</button>
      <span class="count" id="count"></span>
    </div>
    <div class="chips" id="chips"></div>
    <div class="tablewrap"><table id="state-table">
      <thead><tr>
        <th data-sort="name">компонент <span class="arrow">▲</span></th>
        <th data-sort="evr">version-release <span class="arrow"></span></th>
        <th data-sort="branch">ветка <span class="arrow"></span></th>
        <th data-sort="patches">патчи <span class="arrow"></span></th>
        <th data-sort="rpms">RPM <span class="arrow"></span></th>
        <th data-sort="completed">собран <span class="arrow"></span></th>
        <th>теги</th>
        <th>ссылки</th>
      </tr></thead>
      <tbody id="state-rows"></tbody>
    </table></div>
  </section>
  <section id="tab-diff" hidden>
    <div class="selector" id="pair-select"></div>
    <div class="cards diff" id="diff-cards"></div>
    <div class="tablewrap"><table id="diff-table">
      <thead><tr>
        <th data-sort="name">компонент <span class="arrow">▲</span></th>
        <th data-sort="old">было <span class="arrow"></span></th>
        <th></th>
        <th data-sort="new">стало <span class="arrow"></span></th>
        <th data-sort="dpatch">Δ патчей <span class="arrow"></span></th>
        <th data-sort="drpm">Δ RPM <span class="arrow"></span></th>
        <th>теги</th>
        <th>ссылки</th>
      </tr></thead>
      <tbody id="diff-rows"></tbody>
    </table></div>
  </section>
</div>
<div id="tip" role="tooltip"></div>
<script>
var DATA = /*__DATA__*/;
/* Вкладки, селекторы, карточки-фильтры, чипы, поиск с подсветкой,
   сортировка, раскрытие строк, состояние в location.hash, copy NVR. */
</script>
</body>
</html>
```

Требования к JS:
- вкладка `Изменения` скрыта, если `DATA.pairs` пуст;
- клик по карточке ставит фильтр, повторный клик снимает; активные фильтры рисуются чипами в `#chips` и складываются по И;
- поиск ищет по `name`, `nvr`, `branch`, именам и путям патчей, `cves`, `rpms`; строка остаётся видимой, даже если совпадение только в свёрнутых деталях;
- раскрытие строки в `Состоянии` показывает Koji-блок, GitLab-блок, патчи по классам со ссылками и бейджами CVE, список RPM и `problems`;
- раскрытие строки в `Изменениях` показывает две колонки «было / стало» с подсветкой `--added` / `--removed`;
- состояние (`tab`, `tag`, `pair`, фильтры, запрос, сортировка) читается и пишется в `location.hash`;
- `#copy-nvr` кладёт в буфер NVR текущих видимых строк через `navigator.clipboard` с фолбэком на скрытую `textarea`;
- экранирование любых данных перед вставкой в DOM (функция `esc` как в `ref.html`).

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS, все тесты, включая `TemplateContractTest`

- [ ] **Step 6: Посмотреть результат глазами**

```bash
python3 -m kojipatch render tests/fixtures/snapshot-os-9.1.json tests/fixtures/snapshot-os-9.2.json -o /tmp/dash.html
```

Открыть `/tmp/dash.html` в браузере (при наличии skill `claude-in-chrome` — через него, сделав скриншоты светлой и тёмной темы). Проверить вручную: переключение вкладок, фильтр по карточке, чипы, поиск с подсветкой, раскрытие строк в обеих вкладках, сортировка, copy NVR, восстановление состояния при перезагрузке страницы с hash.

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/assets/dashboard.html tests/test_render.py
git commit -m "Дизайн дашборда: вкладки, карточки-фильтры, чипы, детали строк"
```

---

### Task 13: Документация

**Files:**
- Create: `README.md`
- Modify: `kojipatch.example.yaml` (сверить с реализацией, поправить при расхождении)

**Interfaces:**
- Consumes: финальный CLI и конфиг.
- Produces: ничего для кода.

- [ ] **Step 1: Написать README**

`README.md` должен содержать:

```markdown
# kojipatch

Дашборд патчей: агрегирует последние билды koji-тегов, вытаскивает ветку GitLab
из `extra.source.original_url`, читает каталог `PATCH` в этой ветке,
классифицирует патчи и строит самодостаточный HTML.

## Требования

Python 3.9+, `koji`, `requests`, `PyYAML`.

## Быстрый старт

    export GITLAB_TOKEN=glpat-...
    cp kojipatch.example.yaml kojipatch.yaml   # поправить адреса
    python3 -m kojipatch --config kojipatch.yaml run --tag os-9.2 -o dashboard.html

Сравнить два тега:

    python3 -m kojipatch --config kojipatch.yaml run \
        --tag os-9.1 --tag os-9.2 -o dashboard.html

Собрать снапшоты сейчас, а сравнить позже:

    python3 -m kojipatch --config kojipatch.yaml collect --tag os-9.1 -o os-9.1.json
    # через месяц
    python3 -m kojipatch --config kojipatch.yaml collect --tag os-9.2 -o os-9.2.json
    python3 -m kojipatch render os-9.1.json os-9.2.json -o dashboard.html

## Конфигурация

| Ключ | Обязателен | По умолчанию | Что делает |
|---|---|---|---|
| `koji.hub` | да | — | XML-RPC адрес хаба; можно перекрыть `--koji-hub` |
| `koji.web` | нет | нет ссылок на koji | база для ссылок вида `/search?match=exact&type=build&terms=NVR` |
| `gitlab.default_host` | нет | — | хост, используемый, если в `original_url` встретился незнакомый |
| `gitlab.token_env` | нет | `GITLAB_TOKEN` | имя переменной окружения с токеном |
| `gitlab.hosts.<host>.api` | да для каждого хоста | — | база REST v4, например `https://gitlab.example.com/api/v4` |
| `gitlab.hosts.<host>.web` | нет | `api` без `/api/...` | база для ссылок на дерево и файлы |
| `patch_dir` | нет | `PATCH` | имя каталога патчей в корне репозитория |
| `patch_classes` | нет | CVE, SAST, DAST, other | правила «регулярка по имени файла → класс» |

Правила `patch_classes` применяются по порядку, побеждает первое совпадение.
Если последнее правило не всеохватное, автоматически добавляется `other: '.*'`.
Токен читается только из переменной окружения: флага для него нет, чтобы он не
попадал в историю шелла и в список процессов. Без токена запросы идут анонимно —
это рабочий режим для публичных репозиториев, а `401`/`403` тогда попадают в
`problems` конкретных билдов и не роняют прогон.

## Дашборд

Вкладка «Состояние» отвечает на вопрос «что сейчас в теге»: карточки-счётчики
(всего билдов, с патчами, без патчей, проблемных, по классам патчей) и таблица
билдов с раскрытием — Koji, GitLab, патчи по классам, RPM, проблемы.

Вкладка «Изменения» появляется при двух и более тегах: переключатель переходов
`T1→T2`, `T2→T3` и сводный `T1→Tn`, карточки диффа и таблица изменившихся
компонентов с раскрытием «было / стало».

Теги строк — вычисляемые метки, к koji-тегам отношения не имеют:
`cve`, `sast`, `dast`, `other`, `no-patch` (каталога `PATCH` нет),
`no-source` (у билда нет `original_url`), `gitlab-error` (репозиторий или ветка
недоступны), `from-commit` (собран не с ветки, а с коммита); в диффе —
`added`, `removed`, `upgraded`, `downgraded`, `repackaged`, `patches+`,
`patches-`, `branch-changed`.

Клик по карточке или по тегу строки ставит фильтр, несколько фильтров
складываются по И. Поиск идёт по компоненту, NVR, ветке, именам патчей, CVE-ID
и именам RPM. Текущий вид (вкладка, тег, переход, фильтры, запрос, сортировка)
пишется в hash URL, поэтому ссылкой на конкретный срез можно поделиться.

## Коды возврата

0 — успех, 1 — проблемных билдов больше `--max-problems`, 2 — фатальная ошибка.

## Формат снапшота

Пример JSON и пояснение полей `patch_dir_present` (`true`/`false`/`null`)
и `problems`.

## Разработка

    python3 -m unittest discover -s tests -v
```

Каждый раздел заполнить реальным содержимым, сверяясь с `kojipatch/cli.py` и
`kojipatch/config.py` — не оставлять описаний-заглушек.

- [ ] **Step 2: Проверить, что команды из README работают**

Run:
```bash
python3 -m kojipatch render tests/fixtures/snapshot-os-9.1.json tests/fixtures/snapshot-os-9.2.json -o /tmp/readme-check.html
python3 -m unittest discover -s tests
```
Expected: обе команды завершаются с кодом 0

- [ ] **Step 3: Коммит**

```bash
git add README.md kojipatch.example.yaml
git commit -m "README: установка, конфиг, сценарии запуска, формат снапшота"
```

---

## Порядок и зависимости

Задачи 1–5 независимы друг от друга по коду и могут выполняться в любом порядке
(задача 3 использует `Config` из задачи 1 только в одном тесте). Задача 6 создаёт
`tests/fakes.py`, от которого зависят задачи 7 и 8. Задача 8 требует 1, 2, 3, 5,
6, 7. Задача 9 требует 4 и 5. Задача 10 требует 3, 5, 9. Задача 11 требует всё
предыдущее. Задача 12 требует 10. Задача 13 — последняя.
