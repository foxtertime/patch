# Коммит сборки и ghost-патчи — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Патчи билда снимаются с коммита, из которого билд собран, а
расхождение этого коммита с вершиной ветки показывается числом непобранных
коммитов и ghost-патчами в раскрытой строке.

**Architecture:** Хеш берётся из верхнеуровневого поля `source` ответа
`getBuild` — оно уже приезжает в том же пакетном вызове, лишних запросов
ноль. Разбирает его существующий `parse_source_url`. Дерево `PATCH`
читается на хеше; когда ветка ушла вперёд, оно читается второй раз на
вершине, и различие двух деревьев (по путям и по blob sha) даёт три вида
ghost-патчей. Страница получает метку с фильтром, хеш в раскрытии и
ghost-секцию под списком патчей.

**Tech Stack:** Python 3.9+ без зависимостей сверх koji/requests/PyYAML,
`unittest` с подделками из `tests/fakes.py`; ванильный ES2015+ в UMD-обёртке
вокруг `KP`, CSS без препроцессора, сборка одним файлом через
`dashboard/build.py`, тесты — `node --test` поверх `tests/js/domstub.js`.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-09-build-commit-ghosts-design.md`.
  При расхождении плана со спекой права спека.
- **`SCHEMA` в `model.py` остаётся `1`.** Все новые поля необязательные,
  читаются через `.get`, старые снапшоты открываются без ошибок.
- Собранная страница остаётся одним самодостаточным файлом: никаких внешних
  запросов, никаких библиотек.
- **Из `source` берётся только хеш.** Хост, проект, `web_url` и адрес чтения
  `PATCH` приходят из `extra.source.original_url`, иначе ssh-хост уедет в
  `_resolve_host` и здоровые билды получат «host не описан в конфиге».
- Ghost-патчи не идут в счётчики строки, карточки классов и сводку.
- Сводка дашборда, колонка «ветка», карточки классов и вид «Изменений» не
  трогаются; на «Изменениях» добавляется только предупреждение о разных
  режимах.
- Ни один отказ GitLab не валит прогон и не выбрасывает билд из снапшота.
- Комментарии, подписи и сообщения — по-русски, в тон соседним файлам:
  объясняют «почему», а не пересказывают код.
- Эталон `tests/js/fixtures/page-data.golden.json` автоматически не
  пересчитывается — правится руками и осознанно (Задача 10).
- Ветка `feature/build-commit` от `develop`; в `develop` не вливать без
  апрува человека.
- После каждой задачи обе сюиты зелёные:
  `python3 -m unittest discover -s tests` и `node --test tests/js/*.test.js`.

## Раскладка файлов

| файл | роль |
|---|---|
| `dashboard/model.py` | `Source` +5 полей, `Build` +2, `Patch` +1 |
| `dashboard/gitlabclient.py` | `compare()`, `blobs` в `TreeResult` |
| `dashboard/collect.py` | добыча хеша, чтение `PATCH` с коммита, ghost, счётчики |
| `dashboard/cli.py` | флаг `--no-branch-check` |
| `dashboard/assets/js/labels.js` | подпись, степень и фильтр `branch-ahead` |
| `dashboard/assets/js/viewmodel.js` | метка, новые поля строки, `ghostDicts` |
| `dashboard/assets/js/markup.js` | `aheadHtml`, `ghostsHtml`, `ghostItem` |
| `dashboard/assets/js/tables.js` | коммит в блоке gitlab, бейдж и ghost-секция |
| `dashboard/assets/js/store.js` | предупреждение о разных режимах |
| `dashboard/assets/css/table.css` | вид бейджа, ghost-группы и ghost-строки |
| `tests/*.py`, `tests/js/*.test.js` | по задачам |
| `tests/fixtures/make_rich_fixtures.py` | демонстрационные случаи |
| `README.md`, `CHANGELOG.md`, `dashboard/__init__.py` | документация и 2.2.0 |

---

### Task 1: Формы `git+ssh` закреплены тестом

Разборщик их уже берёт правильно — задача только в том, чтобы это перестало
быть случайностью. Кода не меняется ни строки.

**Files:**
- Modify: `tests/test_sourceurl.py`

**Interfaces:**
- Consumes: `parse_source_url(url) -> ParsedSource(host, project, ref, ref_kind)`.
- Produces: ничего.

- [ ] **Step 1: Написать тест**

Дописать в `tests/test_sourceurl.py` новый класс:

```python
SHA = "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122"


class KojiSourceFormTest(unittest.TestCase):
    """Верхнеуровневое поле source билда: git+ssh с хешем в конце.

    Отдельным классом, потому что это другой источник строки: остальные
    тесты разбирают extra.source.original_url, а сюда приезжает то, чем
    koji пошёл собирать на самом деле.
    """

    def test_plain(self):
        got = parse_source_url("git+ssh://gitlab.example.com/g/nginx#" + SHA)
        self.assertEqual(got.host, "gitlab.example.com")
        self.assertEqual(got.project, "g/nginx")
        self.assertEqual(got.ref, SHA)
        self.assertEqual(got.ref_kind, "commit")

    def test_user_and_dot_git(self):
        got = parse_source_url(
            "git+ssh://git@gitlab.example.com/g/nginx.git#" + SHA)
        self.assertEqual(got.host, "gitlab.example.com")
        self.assertEqual(got.project, "g/nginx")
        self.assertEqual(got.ref_kind, "commit")

    def test_port_and_nested_group(self):
        got = parse_source_url(
            "git+ssh://git@gitlab.example.com:2222/g/sub/nginx.git#0f1a2b3c")
        self.assertEqual(got.host, "gitlab.example.com")
        self.assertEqual(got.project, "g/sub/nginx")
        self.assertEqual(got.ref, "0f1a2b3c")
        self.assertEqual(got.ref_kind, "commit")

    def test_branch_in_the_same_form_is_still_a_branch(self):
        # хеш опознаётся по виду, а не по тому, из какого поля пришла строка
        got = parse_source_url("git+ssh://gitlab.example.com/g/nginx#os-9.1")
        self.assertEqual(got.ref, "os-9.1")
        self.assertEqual(got.ref_kind, "branch")
```

- [ ] **Step 2: Прогнать тест**

Run: `python3 -m unittest tests.test_sourceurl -v`
Expected: PASS — разборщик уже умеет эти формы, тест их фиксирует.

- [ ] **Step 3: Коммит**

```bash
git add tests/test_sourceurl.py
git commit -m "Формы git+ssh из поля source закреплены тестом"
```

---

### Task 2: Новые поля модели

**Files:**
- Modify: `dashboard/model.py:15-111`
- Modify: `tests/test_model.py`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `Patch(path, name, cls, cves=[], web_url=None, ghost=None)` — `ghost` это
    `None`, `"branch"`, `"changed"` или `"build"`; в JSON ключ `ghost`.
  - `Source(raw, host=None, project=None, ref=None, ref_kind="none",
    web_url=None, commit=None, commit_url=None, commit_source=None,
    branch_head=None, commits_ahead=None)`; `commit_source` это
    `"original_url"` или `"koji_source"`.
  - `Build(..., patches_ref=None, ghost_patches=[])` — `patches_ref` это
    ref, с которого снят список `patches`: хеш или имя ветки.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_model.py`:

```python
class NewFieldsTest(unittest.TestCase):
    def test_round_trip_keeps_commit_and_ghosts(self):
        source = Source(raw="git+https://gl/g/r#origin/br", host="gl",
                        project="g/r", ref="br", ref_kind="branch",
                        web_url="https://gl/g/r/-/tree/br",
                        commit="0f1a2b3c", commit_url="https://gl/g/r/-/tree/0f1a2b3c",
                        commit_source="koji_source", branch_head="99aabbcc",
                        commits_ahead=3)
        build = Build(nvr="n-1-1", name="n", version="1", release="1",
                      source=source, patches_ref="0f1a2b3c",
                      patches=[Patch(path="PATCH/a.patch", name="a.patch",
                                     cls="CVE")],
                      ghost_patches=[Patch(path="PATCH/b.patch",
                                           name="b.patch", cls="CVE",
                                           ghost="branch")])
        snapshot = Snapshot(tag="os-9.2", generated="2026-08-09T00:00:00+03:00",
                            koji_hub="https://hub", builds=[build])
        again = snapshot_from_dict(snapshot_to_dict(snapshot)).builds[0]
        self.assertEqual(again.source.commit, "0f1a2b3c")
        self.assertEqual(again.source.commit_source, "koji_source")
        self.assertEqual(again.source.branch_head, "99aabbcc")
        self.assertEqual(again.source.commits_ahead, 3)
        self.assertEqual(again.patches_ref, "0f1a2b3c")
        self.assertIsNone(again.patches[0].ghost)
        self.assertEqual(again.ghost_patches[0].ghost, "branch")

    def test_old_snapshot_reads_with_empty_new_fields(self):
        # снапшот, записанный до этой работы: новых ключей в нём нет вовсе
        data = {"schema": 1, "tag": "os-9.2", "generated": "2026-01-01T00:00:00+03:00",
                "koji_hub": "https://hub",
                "builds": [{"nvr": "n-1-1", "name": "n", "version": "1",
                            "release": "1",
                            "source": {"raw": "git+https://gl/g/r#origin/br",
                                       "ref": "br", "ref_kind": "branch"},
                            "patches": [{"path": "PATCH/a.patch",
                                         "name": "a.patch", "class": "CVE"}]}]}
        build = snapshot_from_dict(data).builds[0]
        self.assertIsNone(build.source.commit)
        self.assertIsNone(build.source.commits_ahead)
        self.assertIsNone(build.patches_ref)
        self.assertEqual(build.ghost_patches, [])
        self.assertIsNone(build.patches[0].ghost)
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_model -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'commit'`

- [ ] **Step 3: Дописать поля в модель**

В `dashboard/model.py`, класс `Patch`:

```python
@dataclass
class Patch:
    path: str
    name: str
    cls: str
    cves: List[str] = field(default_factory=list)
    web_url: Optional[str] = None
    # Не патч билда, а различие между коммитом сборки и вершиной ветки:
    # "branch" — файл в ветке есть, в билд не вошёл; "build" — был в билде,
    # из ветки убран; "changed" — путь тот же, содержимое в ветке другое.
    # У патчей самого билда поле пустое.
    ghost: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"path": self.path, "name": self.name, "class": self.cls,
                "cves": list(self.cves), "web_url": self.web_url,
                "ghost": self.ghost}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Patch":
        return cls(path=data["path"], name=data["name"], cls=data["class"],
                   cves=list(data.get("cves") or []),
                   web_url=data.get("web_url"), ghost=data.get("ghost"))
```

Класс `Source`:

```python
@dataclass
class Source:
    raw: str
    host: Optional[str] = None
    project: Optional[str] = None
    ref: Optional[str] = None
    ref_kind: str = "none"
    web_url: Optional[str] = None
    # Коммит, из которого билд действительно собран. Ветка в ref — то, что
    # человек ввёл; коммит — то, чем сборка пошла, и он неизменяем.
    commit: Optional[str] = None
    commit_url: Optional[str] = None
    # Чему мы верим: "original_url" — коммит стоял прямо в ссылке билда,
    # "koji_source" — добыт из верхнеуровневого source. Доверие к ним
    # разное, и в день, когда коммит окажется неверным, разбираться будет
    # нечем без этого поля.
    commit_source: Optional[str] = None
    # Вершина ветки на момент сбора и сколько коммитов легло в ветку после
    # точки, из которой собран билд. None — не считали или не удалось.
    branch_head: Optional[str] = None
    commits_ahead: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {"raw": self.raw, "host": self.host, "project": self.project,
                "ref": self.ref, "ref_kind": self.ref_kind,
                "web_url": self.web_url, "commit": self.commit,
                "commit_url": self.commit_url,
                "commit_source": self.commit_source,
                "branch_head": self.branch_head,
                "commits_ahead": self.commits_ahead}

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Source":
        return cls(raw=data["raw"], host=data.get("host"),
                   project=data.get("project"), ref=data.get("ref"),
                   ref_kind=data.get("ref_kind", "none"),
                   web_url=data.get("web_url"), commit=data.get("commit"),
                   commit_url=data.get("commit_url"),
                   commit_source=data.get("commit_source"),
                   branch_head=data.get("branch_head"),
                   commits_ahead=data.get("commits_ahead"))
```

Класс `Build` — после `patch_dir_present`:

```python
    # Ref, с которого снят список patches: хеш коммита сборки, а когда
    # хеша нет — имя ветки. Без этого поля одна и та же строка «патчи»
    # означала бы у разных билдов разное, и сравнить снапшот, собранный
    # до этой работы, с нынешним было бы нельзя.
    patches_ref: Optional[str] = None
    patches: List[Patch] = field(default_factory=list)
    # Различие между коммитом сборки и вершиной ветки. В счётчики строки,
    # карточки классов и сводку не идёт: это то, чего в билде нет.
    ghost_patches: List[Patch] = field(default_factory=list)
```

В `Build.to_dict` — две записи рядом с `patches`:

```python
            "patch_dir_present": self.patch_dir_present,
            "patches_ref": self.patches_ref,
            "patches": [p.to_dict() for p in self.patches],
            "ghost_patches": [p.to_dict() for p in self.ghost_patches],
```

В `Build.from_dict` — там же:

```python
            patch_dir_present=data.get("patch_dir_present"),
            patches_ref=data.get("patches_ref"),
            patches=[Patch.from_dict(p) for p in data.get("patches") or []],
            ghost_patches=[Patch.from_dict(p)
                           for p in data.get("ghost_patches") or []],
```

- [ ] **Step 4: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS, включая старые тесты сериализации.

- [ ] **Step 5: Коммит**

```bash
git add dashboard/model.py tests/test_model.py
git commit -m "Модель знает про коммит сборки и ghost-патчи"
```

---

### Task 3: `GitlabClient.compare`

**Files:**
- Modify: `dashboard/gitlabclient.py:15-17,75-101`
- Modify: `tests/test_gitlabclient.py`

**Interfaces:**
- Consumes: `HttpClient.get(url, headers, params)`, `server_message(response)`.
- Produces: `CompareResult = namedtuple("CompareResult", "head ahead problem")`
  и `GitlabClient.compare(host, project, from_sha, to_ref) -> CompareResult`.
  `head` — хеш вершины `to_ref` или `None`; `ahead` — число коммитов после
  точки расхождения или `None`, если неизвестно; `problem` — строка или
  `None`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_gitlabclient.py`:

```python
COMPARE_URL = "https://gitlab.example.com/api/v4/projects/g%2Fr/repository/compare"
SHA = "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122"
HEAD = "99aabbccddeeff00112233445566778899aabbcc"


class CompareTest(unittest.TestCase):
    def test_head_and_count(self):
        cli, transport = client({COMPARE_URL: Response(200, {
            "commit": {"id": HEAD},
            "commits": [{"id": HEAD}, {"id": "cafebabe"}],
        }, {})})
        got = cli.compare("gitlab.example.com", "g/r", SHA, "br")
        self.assertEqual(got.head, HEAD)
        self.assertEqual(got.ahead, 2)
        self.assertIsNone(got.problem)
        url, params, _ = transport.requests[0]
        self.assertEqual(url, COMPARE_URL)
        self.assertEqual(params, {"from": SHA, "to": "br"})

    def test_nothing_new_is_zero_not_a_problem(self):
        cli, _ = client({COMPARE_URL: Response(200, {"commit": {"id": SHA},
                                                     "commits": []}, {})})
        got = cli.compare("gitlab.example.com", "g/r", SHA, "br")
        self.assertEqual(got.ahead, 0)
        self.assertIsNone(got.problem)

    def test_truncated_answer_gives_unknown_count(self):
        # усечённый список тише соврёт, чем промолчит: число неизвестно,
        # но вершину сервер назвал, и она остаётся
        cli, _ = client({COMPARE_URL: Response(200, {
            "commit": {"id": HEAD}, "commits": [{"id": HEAD}],
            "compare_timeout": True}, {})})
        got = cli.compare("gitlab.example.com", "g/r", SHA, "br")
        self.assertEqual(got.head, HEAD)
        self.assertIsNone(got.ahead)
        self.assertIsNone(got.problem)

    def test_missing_project_is_a_problem(self):
        cli, _ = client({COMPARE_URL: Response(
            404, {"message": "404 Project Not Found"}, {})})
        got = cli.compare("gitlab.example.com", "g/r", SHA, "br")
        self.assertIsNone(got.head)
        self.assertIsNone(got.ahead)
        self.assertIn("Project Not Found", got.problem)

    def test_unknown_host_does_not_go_to_the_network(self):
        cli, transport = client({})
        got = cli.compare("elsewhere.example.com", "g/r", SHA, "br")
        self.assertIn("unknown host", got.problem)
        self.assertEqual(transport.requests, [])

    def test_result_is_memoized(self):
        cli, transport = client({COMPARE_URL: Response(200, {
            "commit": {"id": HEAD}, "commits": []}, {})})
        cli.compare("gitlab.example.com", "g/r", SHA, "br")
        cli.compare("gitlab.example.com", "g/r", SHA, "br")
        self.assertEqual(len(transport.requests), 1)
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_gitlabclient -v`
Expected: FAIL с `AttributeError: 'GitlabClient' object has no attribute 'compare'`

- [ ] **Step 3: Реализовать `compare`**

В `dashboard/gitlabclient.py` рядом с `TreeResult`:

```python
CompareResult = namedtuple("CompareResult", "head ahead problem")
```

И метод после `patch_files`:

```python
    def compare(self, host, project, from_sha, to_ref) -> CompareResult:
        """Вершина ветки и сколько коммитов легло после точки сборки.

        Число считается от точки расхождения, а не двухточечным сравнением:
        отличить перебазированную ветку от обычной без второго запроса
        нельзя, а ради формулировки лишний запрос на каждый билд не стоит
        того. Поэтому и в модели, и на странице число зовётся «коммитов
        после точки, из которой собран билд» — это верно при любой форме
        истории. Ghost-патчи от формы истории не зависят вовсе: они
        считаются сравнением деревьев, а не журнала.
        """
        if not from_sha or not to_ref:
            return CompareResult(None, None, "gitlab: нечего сравнивать")
        key = ("compare", host, project, from_sha, to_ref)
        with self._lock:
            if key in self._cache:
                logger.debug("кэш: сравнение %s %s %s..%s", host, project,
                             from_sha, to_ref)
                return self._cache[key]
        result = self._fetch_compare(host, project, from_sha, to_ref)
        with self._lock:
            self._cache[key] = result
        return result

    def _fetch_compare(self, host, project, from_sha, to_ref) -> CompareResult:
        cfg = self._host_config(host)
        if cfg is None:
            return CompareResult(None, None, "gitlab: unknown host %s" % host)
        url = "%s/projects/%s/repository/compare" % (
            cfg.api.rstrip("/"), quote(project, safe=""))
        headers = {"PRIVATE-TOKEN": self._token} if self._token else {}
        response = self._http.get(url, headers,
                                  {"from": from_sha, "to": to_ref})
        if isinstance(response, str):
            return CompareResult(None, None, response)
        if response.status >= 400:
            return CompareResult(None, None,
                                 "gitlab: %s %s" % (response.status,
                                                    server_message(response)))
        body = response.body or {}
        head = (body.get("commit") or {}).get("id")
        # compare_timeout значит «список коммитов усечён»: показывать по
        # нему число нельзя, оно будет меньше настоящего
        if body.get("compare_timeout"):
            return CompareResult(head, None, None)
        return CompareResult(head, len(body.get("commits") or []), None)
```

Заметка про `_host_config`: подстановка хоста здесь без заметки в
`problems` — заметку уже выпишет `patch_files` того же билда, а вторая
строка о том же самом только удлинит список.

- [ ] **Step 4: Прогнать тесты**

Run: `python3 -m unittest tests.test_gitlabclient -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/gitlabclient.py tests/test_gitlabclient.py
git commit -m "GitlabClient умеет сравнивать коммит с веткой"
```

---

### Task 4: Blob sha в дереве патчей

Без него различаются только имена файлов, и «патч переписан в ветке после
сборки» остаётся невидимым. Идентификатор и так приходит в ответе — мы его
выбрасываем.

**Files:**
- Modify: `dashboard/gitlabclient.py:15,103-165`
- Modify: `dashboard/collect.py` (только вызовы конструктора, если появятся)
- Modify: `tests/test_gitlabclient.py`

**Interfaces:**
- Consumes: `TreeResult` из Задачи 3 (поле `problem`).
- Produces: `TreeResult = namedtuple("TreeResult", "present paths problem blobs")`,
  где `blobs` — словарь `{путь: blob sha}`. Порядок полей прежний, `blobs`
  дописан в конец, поэтому распаковка `present, paths, problem` в старом коде
  не ломается только при обращении по имени — по имени и обращаемся везде.

- [ ] **Step 1: Написать падающий тест**

Дописать в `tests/test_gitlabclient.py`, в `PatchFilesTest`:

```python
    def test_blob_ids_come_along_with_paths(self):
        cli, _ = client({TREE_URL: TWO_FILES})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(result.blobs,
                         {"PATCH/CVE-2024-7347.patch": "1",
                          "PATCH/sub/sast-x.patch": "3"})

    def test_failed_read_has_empty_blobs_not_none(self):
        # у неудачного чтения blobs пуст, а не None: сравнивать деревья
        # придётся всегда, и None заставил бы каждого звонящего проверять
        cli, _ = client({TREE_URL: Response(500, {"message": "boom"}, {})})
        result = cli.patch_files("gitlab.example.com", "g/r", "br")
        self.assertEqual(result.blobs, {})
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_gitlabclient -v`
Expected: FAIL с `AttributeError: 'TreeResult' object has no attribute 'blobs'`

- [ ] **Step 3: Дописать поле**

В `dashboard/gitlabclient.py` заменить объявление:

```python
TreeResult = namedtuple("TreeResult", "present paths problem blobs")
```

В `_fetch_tree` собирать словарь рядом со списком:

```python
        paths = []
        blobs = {}
        page = None
        while True:
            ...
            if isinstance(response, str):
                return TreeResult(None, [], response, {})
            if response.status == 404:
                note = server_message(response)
                if "project not found" in note.lower():
                    return TreeResult(None, [], "gitlab: %s" % note, {})
                return self._resolve_missing_tree(cfg, project, ref, headers)
            if response.status >= 400:
                return TreeResult(None, [],
                                  "gitlab: %s %s" % (response.status,
                                                     server_message(response)),
                                  {})
            for item in response.body or []:
                if item.get("type") == "blob":
                    paths.append(item["path"])
                    # id блоба — содержимое файла: одинаковый id у двух
                    # деревьев значит, что файл тот же самый, а разный —
                    # что его переписали
                    blobs[item["path"]] = item.get("id")
            ...
        return TreeResult(True, sorted(paths), None, blobs)
```

В `_resolve_missing_tree` — четвёртым доводом `{}` во всех трёх возвратах:

```python
            return TreeResult(None, [], response, {})
        ...
            return TreeResult(None, [], "gitlab: ref not found", {})
        ...
            return TreeResult(False, [], None, {})
        ...
        return TreeResult(None, [],
                          "gitlab: %s %s" % (response.status,
                                             server_message(response)), {})
```

В `_fetch` — там, где заметка о подмене хоста пересобирает результат:

```python
        return TreeResult(result.present, result.paths, problem, result.blobs)
```

В `patch_files` — ранний возврат при пустом ref:

```python
            return TreeResult(None, [], "gitlab: no ref in source url", {})
```

- [ ] **Step 4: Прогнать все питоновские тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS. Если что-то падает на распаковке `TreeResult` — заменить на
обращение по имени поля, конструкцию с индексами в этом коде не заводить.

- [ ] **Step 5: Коммит**

```bash
git add dashboard/gitlabclient.py tests/test_gitlabclient.py
git commit -m "Дерево патчей отдаёт blob sha рядом с путём"
```

---

### Task 5: Хеш коммита из поля `source`

Только добыча и запись: откуда читаются патчи, эта задача ещё не меняет.

**Files:**
- Modify: `dashboard/collect.py:40-43,166-205`
- Modify: `tests/test_collect.py`

**Interfaces:**
- Consumes: `parse_source_url`, `Source` из Задачи 2,
  `GitlabClient.tree_url(host, project, ref)`.
- Produces: `_commit_of(info, parsed) -> (sha или None, источник или None)`,
  где источник это `"original_url"` или `"koji_source"`. Заполненные
  `Source.commit`, `Source.commit_url`, `Source.commit_source`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_collect.py`. Билд `nginx` в фикстуре собран с ветки
`br`, ему и дадим верхнеуровневый `source`:

```python
SHA = "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122"


def build_with_source(source_url):
    """Копия фикстуры билдов, где у nginx свой верхнеуровневый source."""
    builds = {bid: dict(info) for bid, info in BUILDS.items()}
    builds[1] = dict(builds[1])
    if source_url is None:
        builds[1].pop("source", None)
    else:
        builds[1]["source"] = source_url
    return builds


def clients_with_source(routes, source_url):
    session = FakeKojiSession(tagged=TAGGED, builds=build_with_source(source_url),
                              rpms=RPMS, tags=TAGS)
    transport = FakeTransport(routes)
    gitlab = GitlabClient(HOSTS, token=None, transport=transport,
                          sleeper=lambda _s: None)
    return KojiClient(session), gitlab, transport


class CommitFromKojiSourceTest(unittest.TestCase):
    def _nginx(self, source_url, routes=None):
        koji, gitlab, _ = clients_with_source(routes or {}, source_url)
        snapshot = collect_tag("os-9.2", config(), koji, gitlab, jobs=1)
        return snapshot.by_name()["nginx"]

    def test_hash_is_taken_from_koji_source(self):
        build = self._nginx("git+ssh://git@gitlab.example.com/g/nginx#" + SHA)
        self.assertEqual(build.source.commit, SHA)
        self.assertEqual(build.source.commit_source, "koji_source")
        self.assertEqual(build.source.ref, "br")
        self.assertEqual(build.source.ref_kind, "branch")
        self.assertIn(SHA, build.source.commit_url)

    def test_ssh_host_does_not_replace_the_https_one(self):
        build = self._nginx("git+ssh://git@internal.example.com/g/nginx#" + SHA)
        self.assertEqual(build.source.host, "gitlab.example.com")
        self.assertEqual(build.source.commit, SHA)
        self.assertNotIn("host", " ".join(build.problems))

    def test_other_project_is_not_trusted(self):
        build = self._nginx("git+ssh://git@gitlab.example.com/g/other#" + SHA)
        self.assertIsNone(build.source.commit)
        self.assertIsNone(build.source.commit_source)

    def test_branch_in_koji_source_gives_no_hash(self):
        build = self._nginx("git+ssh://git@gitlab.example.com/g/nginx#other-br")
        self.assertIsNone(build.source.commit)

    def test_no_koji_source_at_all(self):
        build = self._nginx(None)
        self.assertIsNone(build.source.commit)
        self.assertIsNone(build.source.commit_source)

    def test_unparsable_koji_source_is_not_a_problem(self):
        # мусор в source не должен превращаться в проблему билда: сам билд
        # в порядке, у него просто не добылся хеш
        build = self._nginx("cli-build/17/nginx.src.rpm")
        self.assertIsNone(build.source.commit)
        self.assertFalse([p for p in build.problems if "source" in p])
```

Отдельный тест на `original_url`, который сам указывает на коммит, — своим
классом, потому что там меняется фикстура `BUILDS`:

```python
class CommitFromOriginalUrlTest(unittest.TestCase):
    def test_hash_in_original_url_is_marked_as_such(self):
        builds = {bid: dict(info) for bid, info in BUILDS.items()}
        builds[1] = dict(builds[1])
        builds[1]["extra"] = {"source": {"original_url":
            "git+https://gitlab.example.com/g/nginx#" + SHA}}
        session = FakeKojiSession(tagged=TAGGED, builds=builds, rpms=RPMS,
                                  tags=TAGS)
        gitlab = GitlabClient(HOSTS, token=None, transport=FakeTransport({}),
                              sleeper=lambda _s: None)
        snapshot = collect_tag("os-9.2", config(), KojiClient(session), gitlab,
                               jobs=1)
        source = snapshot.by_name()["nginx"].source
        self.assertEqual(source.commit, SHA)
        self.assertEqual(source.commit_source, "original_url")
        self.assertEqual(source.ref_kind, "commit")
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `build.source.commit` равен `None` там, где ждём хеш.

- [ ] **Step 3: Реализовать добычу хеша**

В `dashboard/collect.py` рядом с `_original_url`:

```python
def _koji_source(info: dict) -> Optional[str]:
    """Верхнеуровневое поле source: чем сборка пошла на самом деле.

    В extra.source.original_url лежит то, что ввёл человек, — обычно ветка.
    Здесь же koji хранит разрешённый адрес, и у сборок из git в нём стоит
    полный хеш: git+ssh://<host>/<group>/<repo>#<hash>.
    """
    value = info.get("source")
    return value if isinstance(value, str) and value.strip() else None


def _same_project(left: Optional[str], right: Optional[str]) -> bool:
    if not left or not right:
        return False
    return left.strip("/").lower() == right.strip("/").lower()


def _commit_of(info: dict, parsed):
    """Хеш коммита сборки и то, откуда он взят.

    Из верхнеуровневого source берётся ТОЛЬКО хеш: ssh-хост в нём может не
    совпасть с https-хостом из original_url, и пусти мы его дальше —
    сработала бы подстановка хоста в GitlabClient, и здоровые билды
    получили бы проблему «host не описан в конфиге».

    Проекты при этом сверяются. Разошлись — хеш не берём: это другой
    репозиторий, а не уточнение, и приклеить билду чужой коммит хуже, чем
    не показать коммита вовсе. Хост в сверке не участвует по причине выше.
    """
    if parsed.ref_kind == "commit":
        return parsed.ref, "original_url"
    raw = _koji_source(info)
    if not raw:
        return None, None
    try:
        other = parse_source_url(raw)
    except SourceUrlError:
        return None, None
    if other.ref_kind != "commit":
        return None, None
    if not _same_project(other.project, parsed.project):
        return None, None
    return other.ref, "koji_source"
```

В `_attach_patches`, сразу после выхода по `srpm`, заменить создание
`Source` на:

```python
    commit, commit_from = _commit_of(info, parsed)
    build.source = Source(
        raw=raw_url, host=parsed.host, project=parsed.project, ref=parsed.ref,
        ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref),
        commit=commit, commit_source=commit_from,
        commit_url=gitlab_client.tree_url(parsed.host, parsed.project, commit))
```

`tree_url` при `commit is None` вернёт `None` сам (`gitlabclient.py:61-66`),
отдельной проверки не нужно.

- [ ] **Step 4: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/collect.py tests/test_collect.py
git commit -m "Хеш коммита сборки добывается из поля source"
```

---

### Task 6: Патчи снимаются с коммита

Ядро работы: меняется смысл поля `patches`.

**Files:**
- Modify: `dashboard/collect.py:166-205`
- Modify: `tests/test_collect.py`

**Interfaces:**
- Consumes: `_commit_of` из Задачи 5, `TreeResult.blobs` из Задачи 4.
- Produces: заполненный `Build.patches_ref`; `Build.patches` сняты с
  `Source.commit`, когда он известен, иначе с ветки — как прежде.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_collect.py`:

```python
def tree(paths):
    """Ответ дерева: пути и id блобов, id по порядку."""
    return Response(200, [{"id": str(i + 1), "type": "blob", "path": p,
                           "name": p.rsplit("/", 1)[-1]}
                          for i, p in enumerate(paths)], {})


NGINX_TREE = TREE % "g%2Fnginx"


class PatchesComeFromCommitTest(unittest.TestCase):
    def _nginx(self, routes):
        koji, gitlab, transport = clients_with_source(
            routes, "git+ssh://git@gitlab.example.com/g/nginx#" + SHA)
        snapshot = collect_tag("os-9.2", config(), koji, gitlab, jobs=1)
        return snapshot.by_name()["nginx"], transport

    def test_tree_is_read_at_the_commit(self):
        build, transport = self._nginx({
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", SHA))):
                tree(["PATCH/CVE-2026-1.patch"]),
        })
        self.assertEqual(build.patches_ref, SHA)
        self.assertEqual([p.name for p in build.patches],
                         ["CVE-2026-1.patch"])
        refs = [params.get("ref") for url, params, _ in transport.requests
                if url == NGINX_TREE]
        self.assertIn(SHA, refs)

    def test_without_a_hash_the_branch_is_read_as_before(self):
        koji, gitlab, _ = clients_with_source({
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", "br"))):
                tree(["PATCH/CVE-2026-1.patch"]),
        }, None)
        build = collect_tag("os-9.2", config(), koji, gitlab,
                            jobs=1).by_name()["nginx"]
        self.assertEqual(build.patches_ref, "br")
        self.assertEqual(len(build.patches), 1)

    def test_missing_commit_falls_back_to_the_branch_and_says_so(self):
        # дерево на хеше отвечает 404, доразбор коммита — тоже: коммита нет
        build, _ = self._nginx({
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", SHA))):
                Response(404, {"message": "404 Tree Not Found"}, {}),
            COMMITS % ("g%2Fnginx", SHA): Response(404, {"message": "404"}, {}),
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", "br"))):
                tree(["PATCH/CVE-2026-1.patch"]),
        })
        self.assertEqual(build.patches_ref, "br")
        self.assertEqual(len(build.patches), 1)
        self.assertTrue(any("недоступен" in p for p in build.problems))

    def test_network_failure_does_not_silently_read_the_branch(self):
        # отказ сети — не «коммита нет»: второе чтение ничего не исправит,
        # а патчи с ветки, выданные за патчи коммита, соврут
        build, transport = self._nginx({NGINX_TREE: Response(500, {}, {})})
        self.assertEqual(build.patches_ref, SHA)
        self.assertEqual(build.patches, [])
        self.assertTrue(build.problems)

    def test_url_without_a_fragment_is_healed_by_the_hash(self):
        # у такого билда сегодня стоит «no ref in source url» и патчей нет:
        # адреса не было. Хеш его даёт, и проблема исчезает.
        builds = {bid: dict(info) for bid, info in BUILDS.items()}
        builds[1] = dict(builds[1])
        builds[1]["extra"] = {"source": {"original_url":
            "git+https://gitlab.example.com/g/nginx"}}
        builds[1]["source"] = "git+ssh://git@gitlab.example.com/g/nginx#" + SHA
        session = FakeKojiSession(tagged=TAGGED, builds=builds, rpms=RPMS,
                                  tags=TAGS)
        gitlab = GitlabClient(HOSTS, token=None, sleeper=lambda _s: None,
                              transport=FakeTransport({
                                  (NGINX_TREE, (("path", "PATCH"),
                                                ("recursive", "true"),
                                                ("per_page", "100"),
                                                ("ref", SHA))):
                                      tree(["PATCH/CVE-2026-1.patch"])}))
        build = collect_tag("os-9.2", config(), KojiClient(session), gitlab,
                            jobs=1).by_name()["nginx"]
        self.assertEqual(build.source.ref_kind, "none")
        self.assertEqual(build.patches_ref, SHA)
        self.assertEqual(len(build.patches), 1)
        self.assertEqual(build.problems, [])
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `patches_ref` равен `None`.

- [ ] **Step 3: Переписать чтение патчей**

В `dashboard/collect.py` заменить хвост `_attach_patches` (всё после
создания `Source`) на:

```python
    ref, result = _read_patch_dir(build, gitlab_client, parsed, commit)
    if ref != commit:
        # откат на ветку: коммита в репозитории нет, и сравнивать с ним
        # ветку бессмысленно — точка отсчёта пропала вместе с коммитом
        commit = None
    build.patches_ref = ref
    build.patch_dir_present = result.present
    if result.problem:
        # проблема не обязательно означает, что читать нечего: подменённый
        # хост отдаёт и заметку, и настоящее дерево патчей. У неудачных
        # чтений paths и так пустой.
        build.problems.append(result.problem)
    for path in result.paths:
        build.patches.append(_patch(path, parsed, ref, classifier,
                                    gitlab_client))
```

И два помощника рядом:

```python
# Единственный ответ дерева, по которому видно, что коммита в репозитории
# уже нет: его выдаёт доразбор 404 в GitlabClient. Отказ сети выглядит
# иначе, и путать их нельзя — на отказе сети чтение ветки ничего не
# исправит, а патчи с ветки, выданные за патчи коммита, соврут.
_REF_GONE = "gitlab: ref not found"


def _read_patch_dir(build, gitlab_client, parsed, commit):
    """Дерево патчей билда и ref, с которого оно снято.

    Патчи билда — это то, что лежало в PATCH на коммите сборки. Ветку
    читаем, только когда хеша нет вовсе или когда коммита в репозитории
    уже не осталось: ветку могли форс-пушнуть, а коммит — собрать мусором.
    Во втором случае данные деградировали, и молчать об этом нельзя.
    """
    if not commit:
        return parsed.ref, gitlab_client.patch_files(parsed.host,
                                                     parsed.project, parsed.ref)
    result = gitlab_client.patch_files(parsed.host, parsed.project, commit)
    if result.problem != _REF_GONE:
        return commit, result
    build.problems.append(
        "gitlab: коммит %s недоступен, патчи сняты с ветки" % commit[:12])
    return parsed.ref, gitlab_client.patch_files(parsed.host, parsed.project,
                                                 parsed.ref)


def _patch(path, parsed, ref, classifier, gitlab_client, ghost=None):
    name = os.path.basename(path)
    return Patch(path=path, name=name, cls=classifier.classify(name),
                 cves=find_cves(name), ghost=ghost,
                 web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                                ref, path))
```

- [ ] **Step 4: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS. Старые тесты `test_collect`, читавшие дерево по ветке,
проходят без правок: у их билдов верхнеуровневого `source` нет, и путь
остался прежним.

- [ ] **Step 5: Коммит**

```bash
git add dashboard/collect.py tests/test_collect.py
git commit -m "Патчи билда снимаются с коммита сборки"
```

---

### Task 7: Отставание ветки, флаг и счётчики

**Files:**
- Modify: `dashboard/collect.py:46-136,166-205,213-220`
- Modify: `dashboard/cli.py:36-46,76-85`
- Modify: `tests/test_collect.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: `GitlabClient.compare` из Задачи 3.
- Produces: `collect_tag(tag, cfg, koji_client, gitlab_client, jobs=8,
  now=None, branch_check=True)`; заполненные `Source.branch_head` и
  `Source.commits_ahead`; флаг CLI `--no-branch-check`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_collect.py`:

```python
HEAD = "99aabbccddeeff00112233445566778899aabbcc"
NGINX_COMPARE = ("https://gitlab.example.com/api/v4/projects/g%2Fnginx"
                 "/repository/compare")


def compare_answer(ahead, head=HEAD):
    return Response(200, {"commit": {"id": head},
                          "commits": [{"id": "x"}] * ahead}, {})


class BranchAheadTest(unittest.TestCase):
    def _nginx(self, routes, **kwargs):
        koji, gitlab, transport = clients_with_source(
            routes, "git+ssh://git@gitlab.example.com/g/nginx#" + SHA)
        snapshot = collect_tag("os-9.2", config(), koji, gitlab, jobs=1,
                               **kwargs)
        return snapshot.by_name()["nginx"], transport

    def test_head_and_count_land_in_the_snapshot(self):
        build, _ = self._nginx({
            NGINX_TREE: tree(["PATCH/CVE-2026-1.patch"]),
            NGINX_COMPARE: compare_answer(3),
        })
        self.assertEqual(build.source.branch_head, HEAD)
        self.assertEqual(build.source.commits_ahead, 3)
        self.assertEqual(build.problems, [])

    def test_branch_not_moved_is_zero(self):
        build, _ = self._nginx({
            NGINX_TREE: tree(["PATCH/CVE-2026-1.patch"]),
            NGINX_COMPARE: compare_answer(0, head=SHA),
        })
        self.assertEqual(build.source.commits_ahead, 0)

    def test_no_hash_means_no_comparison(self):
        koji, gitlab, transport = clients_with_source(
            {NGINX_TREE: tree([])}, None)
        collect_tag("os-9.2", config(), koji, gitlab, jobs=1)
        self.assertFalse([r for r in transport.requests
                          if r[0] == NGINX_COMPARE])

    def test_flag_turns_the_comparison_off(self):
        build, transport = self._nginx({NGINX_TREE: tree([])},
                                       branch_check=False)
        self.assertIsNone(build.source.commits_ahead)
        self.assertFalse([r for r in transport.requests
                          if r[0] == NGINX_COMPARE])

    def test_failed_comparison_is_a_problem_and_not_a_count(self):
        build, _ = self._nginx({
            NGINX_TREE: tree([]),
            NGINX_COMPARE: Response(500, {"message": "boom"}, {}),
        })
        self.assertIsNone(build.source.commits_ahead)
        self.assertTrue(any("gitlab:" in p for p in build.problems))
```

И в `tests/test_cli.py` — что флаг доезжает:

```python
    def test_no_branch_check_reaches_collect(self):
        seen = {}

        def fake_collect(tag, cfg, koji_client, gitlab_client, jobs=8,
                         now=None, branch_check=True):
            seen["branch_check"] = branch_check
            return Snapshot(tag=tag, generated="now", koji_hub=cfg.koji_hub)

        with mock.patch("dashboard.cli.collect_tag", fake_collect), \
             mock.patch("dashboard.cli.connect", lambda hub: None):
            cli.main(["--config", self.config_path, "collect", "--tag", "os-9.2",
                      "--no-branch-check", "-o", self.out_path])
        self.assertFalse(seen["branch_check"])
```

(Импорты `mock` и `Snapshot` — по образцу соседних тестов файла; если в
`test_cli.py` уже есть свой способ подменять `collect_tag`, использовать его,
а не заводить второй.)

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_collect tests.test_cli -v`
Expected: FAIL — `commits_ahead` равен `None`, `collect_tag` не принимает
`branch_check`.

- [ ] **Step 3: Реализовать сравнение и флаг**

В `dashboard/collect.py` — довод у `collect_tag` и передача его в `handle`:

```python
def collect_tag(tag: str, cfg, koji_client, gitlab_client, jobs: int = 8,
                now: Optional[str] = None,
                branch_check: bool = True) -> Snapshot:
```

```python
        try:
            _attach_patches(build, info, cfg, gitlab_client, classifier,
                            branch_check)
```

Сигнатура `_attach_patches`:

```python
def _attach_patches(build: Build, info: dict, cfg, gitlab_client,
                    classifier: Classifier,
                    branch_check: bool = True) -> None:
```

В конец `_attach_patches`, после заполнения `build.patches`:

```python
    # Сравнивать есть с чем, только когда билд собран с ветки: у сборки
    # прямо с коммита ветки нет, а без хеша нет и точки отсчёта.
    if not (branch_check and commit and parsed.ref_kind == "branch"):
        return
    ahead = gitlab_client.compare(parsed.host, parsed.project, commit,
                                  parsed.ref)
    if ahead.problem:
        build.problems.append(ahead.problem)
        return
    build.source.branch_head = ahead.head
    build.source.commits_ahead = ahead.ahead
```

В `dashboard/cli.py`, в разбор доводов подкоманды `collect`:

```python
    collect.add_argument("--no-branch-check", action="store_true",
                         help="не сравнивать коммит сборки с веткой: патчи "
                              "по-прежнему снимаются с коммита, но число "
                              "несобранных коммитов и ghost-патчи не "
                              "считаются — один запрос в GitLab на билд "
                              "вместо двух-трёх")
```

И в `_collect`:

```python
    return [collect_tag(tag, cfg, koji_client, gitlab, jobs=args.jobs,
                        branch_check=not args.no_branch_check)
            for tag in args.tags]
```

- [ ] **Step 4: Дописать счётчики в итоговую строку**

В `collect_tag`, до вызова `_log_summary`:

```python
    # Билды, у которых original_url нет, а верхнеуровневый source есть:
    # формально мы могли бы восстановить им и проект, и коммит, но тогда
    # билд перестал бы быть no-source и получил бы from-commit — метка
    # строки и фильтр поехали бы. Число показывает, стоит ли заводить
    # под это отдельную работу.
    orphan_source = sum(1 for info in infos
                        if not _original_url(info) and _koji_source(info))
    _log_summary(snapshot, time.monotonic() - started, orphan_source)
```

И сам `_log_summary`:

```python
def _log_summary(snapshot: Snapshot, elapsed: float,
                 orphan_source: int = 0) -> None:
    """Итог по тегу — то, что раньше печатал CLI своим sys.stderr.write."""
    summary = problem_summary(snapshot)
    problems = sum(1 for b in snapshot.builds if b.problems)
    details = ", ".join("%s: %d" % item for item in sorted(summary.items()))
    logger.info("%s: готово, %d билдов, %d проблемных%s, за %.1f с",
                snapshot.tag, len(snapshot.builds), problems,
                (" (%s)" % details) if details else "", elapsed)
    known = sum(1 for b in snapshot.builds if b.source and b.source.commit)
    ahead = sum(1 for b in snapshot.builds
                if b.source and b.source.commits_ahead)
    ghosts = sum(1 for b in snapshot.builds if b.ghost_patches)
    logger.info("%s: коммит известен у %d из %d, ветка ушла вперёд у %d, "
                "ghost-патчи у %d, без original_url но с source %d",
                snapshot.tag, known, len(snapshot.builds), ahead, ghosts,
                orphan_source)
```

- [ ] **Step 5: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add dashboard/collect.py dashboard/cli.py tests/test_collect.py tests/test_cli.py
git commit -m "Отставание ветки считается, --no-branch-check его отключает"
```

---

### Task 8: Ghost-патчи

**Files:**
- Modify: `dashboard/collect.py` (хвост `_attach_patches`, новый `_ghosts`)
- Modify: `tests/test_collect.py`

**Interfaces:**
- Consumes: `TreeResult.blobs`, `_patch(...)` из Задачи 6,
  `Source.commits_ahead` из Задачи 7.
- Produces: заполненный `Build.ghost_patches` — список `Patch` со стороной в
  поле `ghost`, в порядке `branch`, `changed`, `build`, внутри стороны — по
  пути.

- [ ] **Step 1: Написать падающие тесты**

```python
class GhostPatchesTest(unittest.TestCase):
    def _nginx(self, built, tip, ahead=2):
        routes = {
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", SHA))): built,
            (NGINX_TREE, (("path", "PATCH"), ("recursive", "true"),
                          ("per_page", "100"), ("ref", "br"))): tip,
            NGINX_COMPARE: compare_answer(ahead),
        }
        koji, gitlab, transport = clients_with_source(
            routes, "git+ssh://git@gitlab.example.com/g/nginx#" + SHA)
        snapshot = collect_tag("os-9.2", config(), koji, gitlab, jobs=1)
        return snapshot.by_name()["nginx"], transport

    def test_three_sides(self):
        built = Response(200, [
            {"id": "a1", "type": "blob", "path": "PATCH/kept.patch"},
            {"id": "b1", "type": "blob", "path": "PATCH/rewritten.patch"},
            {"id": "c1", "type": "blob", "path": "PATCH/dropped.patch"},
        ], {})
        tip = Response(200, [
            {"id": "a1", "type": "blob", "path": "PATCH/kept.patch"},
            {"id": "b2", "type": "blob", "path": "PATCH/rewritten.patch"},
            {"id": "d1", "type": "blob", "path": "PATCH/CVE-2026-9.patch"},
        ], {})
        build, _ = self._nginx(built, tip)
        self.assertEqual([(p.name, p.ghost) for p in build.ghost_patches],
                         [("CVE-2026-9.patch", "branch"),
                          ("rewritten.patch", "changed"),
                          ("dropped.patch", "build")])
        # патчи билда — по-прежнему то, что лежит на коммите
        self.assertEqual(sorted(p.name for p in build.patches),
                         ["dropped.patch", "kept.patch", "rewritten.patch"])

    def test_ghosts_are_classified_like_the_rest(self):
        built = Response(200, [], {})
        tip = Response(200, [{"id": "d1", "type": "blob",
                              "path": "PATCH/CVE-2026-9.patch"}], {})
        build, _ = self._nginx(built, tip)
        self.assertEqual(build.ghost_patches[0].cls, "CVE")
        self.assertEqual(build.ghost_patches[0].cves, ["CVE-2026-9"])

    def test_ghost_links_point_where_the_file_exists(self):
        built = Response(200, [{"id": "c1", "type": "blob",
                                "path": "PATCH/dropped.patch"}], {})
        tip = Response(200, [{"id": "d1", "type": "blob",
                              "path": "PATCH/added.patch"}], {})
        build, _ = self._nginx(built, tip)
        by_side = {p.ghost: p.web_url for p in build.ghost_patches}
        self.assertIn("/br/", by_side["branch"])
        self.assertIn("/%s/" % SHA, by_side["build"])

    def test_branch_at_the_same_place_reads_the_tree_once(self):
        built = Response(200, [{"id": "a1", "type": "blob",
                                "path": "PATCH/kept.patch"}], {})
        build, transport = self._nginx(built, Response(500, {}, {}), ahead=0)
        self.assertEqual(build.ghost_patches, [])
        refs = [params.get("ref") for url, params, _ in transport.requests
                if url == NGINX_TREE]
        self.assertEqual(refs, [SHA])

    def test_failed_second_read_leaves_the_count_and_says_so(self):
        built = Response(200, [], {})
        build, _ = self._nginx(built, Response(500, {"message": "boom"}, {}))
        self.assertEqual(build.source.commits_ahead, 2)
        self.assertEqual(build.ghost_patches, [])
        self.assertTrue(any("gitlab:" in p for p in build.problems))
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `ghost_patches` пуст.

- [ ] **Step 3: Реализовать**

В `dashboard/collect.py`, в самый конец `_attach_patches`:

```python
    if not build.source.commits_ahead:
        return
    tip = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    if tip.problem:
        build.problems.append(tip.problem)
        return
    build.ghost_patches = _ghosts(result, tip, parsed, commit, classifier,
                                  gitlab_client)
```

И функция рядом:

```python
# Порядок сторон — тот же, в каком их читают на странице: сперва то, чего
# в билде не хватает, потом устаревшее, потом лишнее.
_GHOST_SIDES = ("branch", "changed", "build")


def _ghosts(built, tip, parsed, commit, classifier, gitlab_client):
    """Различие между деревом коммита и деревом вершины ветки.

    Считается по blob sha, а не по одним именам: файл с тем же именем и
    другим содержимым — это патч, переписанный после сборки, и в пакете
    лежит его прежняя редакция. Форма истории ветки на это не влияет
    никак: сравниваются деревья, а не журнал.
    """
    paths = {
        "branch": sorted(set(tip.blobs) - set(built.blobs)),
        "changed": sorted(path for path in set(tip.blobs) & set(built.blobs)
                          if tip.blobs[path] != built.blobs[path]),
        "build": sorted(set(built.blobs) - set(tip.blobs)),
    }
    out = []
    for side in _GHOST_SIDES:
        # ссылка ведёт туда, где файл есть: у стороны build его в ветке уже
        # нет, и ссылка на ветку вела бы в никуда
        ref = commit if side == "build" else parsed.ref
        for path in paths[side]:
            out.append(_patch(path, parsed, ref, classifier, gitlab_client,
                              ghost=side))
    return out
```

- [ ] **Step 4: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/collect.py tests/test_collect.py
git commit -m "Ghost-патчи: чего в билде нет, что устарело и что лишнее"
```

---

### Task 9: Метка `branch-ahead` и её фильтр

**Files:**
- Modify: `dashboard/assets/js/labels.js:16-33,45-60`
- Modify: `dashboard/assets/js/viewmodel.js:134-173`
- Modify: `tests/js/labels.test.js`, `tests/js/viewmodel.test.js`

**Interfaces:**
- Consumes: `build.source.commits_ahead` из снапшота.
- Produces: ключ метки `branch-ahead` в `marks` строки состояния; подпись
  «ветка ушла вперёд»; степень `warn`; пункт в группе фильтров `build`.

- [ ] **Step 1: Написать падающие тесты**

Сперва — помощник `build(name, over)` в `tests/js/viewmodel.test.js` учится
пробрасывать новые поля. Он собирает `source` сам, поэтому дописываем внутрь
его сборки, а не поверх:

```js
  var source = null;
  if (ref !== null) {
    source = { raw: 'git+ssh://git@h/g/' + name + '?#origin/' + ref,
               host: 'h', project: 'g/' + name, ref: ref, ref_kind: refKind,
               web_url: 'https://gl/tree' };
    if (has(over, 'commit')) source.commit = over.commit;
    if (has(over, 'commit_url')) source.commit_url = over.commit_url;
    if (has(over, 'ahead')) source.commits_ahead = over.ahead;
  }
```

и в возвращаемый объект, рядом с `patches`:

```js
           patches_ref: has(over, 'patches_ref') ? over.patches_ref : null,
           ghost_patches: has(over, 'ghosts') ? over.ghosts : [],
```

Умолчания здесь `null` и `[]` — те же, что даёт снапшот, собранный до этой
работы; `fixture()` и остальные тесты файла от этого не меняются.

Дальше сами тесты:

```js
test('ветка ушла вперёд — метка branch-ahead', function () {
  var rows = data([snap('os-9.2', [build('nginx', { commit: 'abc123',
                                                    ahead: 3 })])])
             .snapshots[0].builds;
  assert.ok(rows[0].marks.indexOf('branch-ahead') !== -1);
});

test('ветка на месте — метки нет', function () {
  var rows = data([snap('os-9.2', [build('nginx', { commit: 'abc123',
                                                    ahead: 0 })])])
             .snapshots[0].builds;
  assert.strictEqual(rows[0].marks.indexOf('branch-ahead'), -1);
});

test('снапшот без нового поля метки не получает', function () {
  var rows = data([snap('os-9.2', [build('nginx')])]).snapshots[0].builds;
  assert.strictEqual(rows[0].marks.indexOf('branch-ahead'), -1);
});
```

В `tests/js/labels.test.js`:

```js
test('branch-ahead подписан и лежит в группе свойств билда', function () {
  assert.strictEqual(labels.label('branch-ahead'), 'ветка ушла вперёд');
  var build = labels.groups('state').filter(function (g) {
    return g.id === 'build';
  })[0];
  assert.ok(build.keys.indexOf('branch-ahead') !== -1);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/labels.test.js tests/js/viewmodel.test.js`
Expected: FAIL — метки нет, подпись равна самому ключу.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/labels.js`, в `LABELS` рядом с `from-srpm`:

```js
    "from-commit": "собран с коммита", "from-srpm": "собран из SRPM",
    "branch-ahead": "ветка ушла вперёд",
```

В `CALM_MARKS`:

```js
  const CALM_MARKS = { "from-commit": "warn", "from-srpm": "warn",
                       "branch-ahead": "warn",
                       "no-patch": "calm",
```

В `GROUPS.state`, группа `build`:

```js
      { id: "build", label: "свойства билда",
        keys: ["has-patch", "inherited", "from-commit", "from-srpm",
               "branch-ahead"] },
```

В `dashboard/assets/js/viewmodel.js`, `STATE_TAG_ORDER`:

```js
  const STATE_TAG_ORDER = ['inherited', 'no-source', 'from-commit',
                           'from-srpm', 'branch-ahead', 'no-patch',
                           'gitlab-error', 'internal-error'];
```

И в `buildMarks`, сразу после ветвления по `ref_kind`:

```js
    /* Ветка ушла вперёд: патчи билда сняты с коммита, а в ветке с тех пор
       что-то появилось. Метка нужна не сама по себе — без неё несобранный
       патч CVE ищется на теге в сотни билдов только перебором раскрытий. */
    if (build.source && build.source.commits_ahead) marks.push('branch-ahead');
```

- [ ] **Step 4: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/assets/js/labels.js dashboard/assets/js/viewmodel.js \
        tests/js/labels.test.js tests/js/viewmodel.test.js
git commit -m "Метка branch-ahead и фильтр по ней"
```

---

### Task 10: Коммит и «ветка +N» в раскрытой строке

Здесь же в строку данных приезжают все новые поля разом — чтобы эталон
паритета правился один раз, а не дважды.

**Files:**
- Modify: `dashboard/assets/js/viewmodel.js:175-215`
- Modify: `dashboard/assets/js/markup.js`
- Modify: `dashboard/assets/js/tables.js:31-35,52-109`
- Modify: `dashboard/assets/css/table.css`
- Modify: `tests/js/fixtures/page-data.golden.json`
- Modify: `tests/js/viewmodel.test.js`, `tests/js/markup.test.js`,
  `tests/js/tables.test.js`

**Interfaces:**
- Consumes: `build.source.commit`, `build.source.commit_url`,
  `build.source.commits_ahead`, `build.patches_ref`, `build.ghost_patches`.
- Produces: в строке состояния появляются `commit`, `commit_url`,
  `commits_ahead`, `patches_ref`, `ghosts` (список тех же словарей, что и
  `patches`, плюс ключ `ghost`); `markup.aheadHtml(row) -> string`;
  `blockHead(title, count, extra)` — третий необязательный довод,
  дописываемый внутрь заголовка блока.

- [ ] **Step 1: Написать падающие тесты**

В `tests/js/viewmodel.test.js`:

```js
test('коммит и отставание доезжают до строки', function () {
  var row = data([snap('os-9.2', [build('nginx', {
    commit: 'abc123', commit_url: 'https://gl/g/r/-/tree/abc123', ahead: 3,
    patches_ref: 'abc123',
    ghosts: [{ path: 'PATCH/x.patch', name: 'x.patch', 'class': 'CVE',
               cves: ['CVE-2026-9'], web_url: 'https://gl/x',
               ghost: 'branch' }]
  })])]).snapshots[0].builds[0];
  assert.strictEqual(row.commit, 'abc123');
  assert.strictEqual(row.commit_url, 'https://gl/g/r/-/tree/abc123');
  assert.strictEqual(row.commits_ahead, 3);
  assert.strictEqual(row.patches_ref, 'abc123');
  assert.strictEqual(row.ghosts.length, 1);
  assert.strictEqual(row.ghosts[0].ghost, 'branch');
  assert.strictEqual(row.ghosts[0]['class'], 'CVE');
});

test('старый снапшот даёт пустые новые поля, а не undefined', function () {
  var row = data([snap('os-9.2', [build('nginx')])]).snapshots[0].builds[0];
  assert.strictEqual(row.commit, null);
  assert.strictEqual(row.commits_ahead, null);
  assert.strictEqual(row.patches_ref, null);
  assert.deepStrictEqual(row.ghosts, []);
});

test('у обычного патча ghost пуст, а не отсутствует', function () {
  var row = data([snap('os-9.2', [build('nginx', {
    patches: [patch('CVE-2024-7347.patch', 'CVE')]
  })])]).snapshots[0].builds[0];
  assert.strictEqual(row.patches[0].ghost, null);
});
```

В `tests/js/markup.test.js`:

```js
test('бейдж отставания есть только когда есть отставание', function () {
  assert.strictEqual(markup.aheadHtml({ commits_ahead: 0, branch: 'br' }), '');
  assert.strictEqual(markup.aheadHtml({ commits_ahead: null, branch: 'br' }), '');
  var html = markup.aheadHtml({ commits_ahead: 3, branch: 'br' });
  assert.match(html, /ветка \+3/);
  assert.match(html, /data-tip="[^"]*br[^"]*"/);
});
```

В `tests/js/tables.test.js` помощник `stateRow(over)` перечисляет поля
строки поимённо и новых не знает — дописать в его возвращаемый объект
умолчания:

```js
           commit: null, commit_url: null, commits_ahead: null,
           patches_ref: null, ghosts: over.ghosts || [],
```

и накрывать их в тесте через `Object.assign`, как это уже делается с
`patches` и `rpms`:

```js
test('раскрытие показывает коммит и ссылку на него', function () {
  var row = Object.assign(stateRow(), {
    commit: 'abc123def456', commit_url: 'https://gl/g/r/-/tree/abc123def456'
  });
  var out = tables.stateRows([{ row: row, open: true }], opts());
  assert.match(out, /abc123def456/);
  assert.match(out, /https:\/\/gl\/g\/r\/-\/tree\/abc123def456/);
});

test('без коммита строка коммита стоит с прочерком', function () {
  var out = tables.stateRows([{ row: stateRow(), open: true }], opts());
  assert.match(out, /коммит/);
  assert.match(out, /class="none">—/);
});

test('бейдж отставания попадает в шапку блока патчей', function () {
  var row = Object.assign(stateRow(), { commits_ahead: 4 });
  var out = tables.stateRows([{ row: row, open: true }], opts());
  assert.match(out, /<div class="bl">патчи[\s\S]*ветка \+4/);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/viewmodel.test.js tests/js/markup.test.js tests/js/tables.test.js`
Expected: FAIL — `row.commit` равен `undefined`, `markup.aheadHtml` не
существует.

- [ ] **Step 3: Новые поля строки**

В `dashboard/assets/js/viewmodel.js`, `patchDict` — вместе с ghost:

```js
  function patchDict(patch) {
    return { path: orNull(patch.path), name: orNull(patch.name),
             'class': orNull(patch['class']), cves: (patch.cves || []).slice(),
             url: orNull(patch.web_url), ghost: orNull(patch.ghost) };
  }
```

В `buildRow`, рядом с `source_url`:

```js
      // Коммит сборки — единственная вечная ссылка в дашборде: ветка
      // уедет, а дерево на хеше останется тем же и через полгода.
      commit: source ? orNull(source.commit) : null,
      commit_url: source ? orNull(source.commit_url) : null,
      commits_ahead: source ? orNull(source.commits_ahead) : null,
      patches_ref: orNull(build.patches_ref),
```

и рядом с `patches`:

```js
      // Ghost-патчи стоят отдельно и в patch_counts не идут: это то, чего
      // в билде нет, и счётчики строки о нём молчат нарочно.
      ghosts: patchDicts(build.ghost_patches || []),
```

- [ ] **Step 4: Бейдж и заголовок блока**

В `dashboard/assets/js/markup.js`, рядом с `meterHtml`:

```js
  /* «Ветка +N» в шапке блока патчей. При нуле и при неизвестном числе не
     показывается ничего: отставания нет или его не считали, и бейдж на
     большинстве строк был бы шумом. */
  function aheadHtml(row) {
    if (!row.commits_ahead) return '';
    const tip = `В ветке ${row.branch || '—'} после точки, из которой собран `
              + `билд, ${row.commits_ahead} коммит(ов). Патчи билда сняты с `
              + `коммита, а не с вершины ветки.`;
    return `<span class="ahead" data-tip="${esc(tip)}">`
         + `ветка +${esc(row.commits_ahead)}</span>`;
  }
```

и `aheadHtml` в объект возврата модуля.

В `dashboard/assets/js/tables.js`:

```js
  function blockHead(title, count, extra) {
    return `<div class="bl">${esc(title)}`
      + (count === undefined ? '' : `<span class="n">· ${count}</span>`)
      + (extra || '')
      + '</div>';
  }
```

В `stateDetail`, в блок `gitlab` — строка коммита после строки ref'а:

```js
      + kv(refName, branch)
      + kv('коммит', row.commit
            ? (row.commit_url
                ? markup.linkHtml(row.commit_url, row.commit)
                : `<span class="mono">${hl(row.commit, q)}</span>`)
            : '<span class="none">—</span>')
```

и заголовок блока патчей:

```js
      + `<div class="block">${blockHead('патчи', row.patches.length,
                                        markup.aheadHtml(row))}`
      + `${markup.patchesHtml(row.patches, q)}</div>`;
```

`linkHtml(url, label)` подписывает ссылку своим текстом — хеш и станет
подписью; отдельного `mono` вокруг неё не нужно, ссылки в раскрытии и так
набраны в одном стиле.

- [ ] **Step 5: Вид бейджа**

В `dashboard/assets/css/table.css`, рядом с правилами `.bl`:

```css
/* «Ветка +N» в шапке блока патчей: не метка строки и не счётчик, поэтому
   свой вид — янтарный, как у предупреждающих меток, но без плашки. */
.bl .ahead { margin-left: .4rem; font-size: .7rem; font-weight: 700;
             letter-spacing: .03em; color: var(--warn); cursor: help; }
```

Если переменной `--warn` в `base.css` нет — взять ту, которой красится
`.mark.warn` в `table.css`, и не заводить новую.

- [ ] **Step 6: Поправить эталон паритета**

Эталон автоматически не пересчитывается. Новые ключи дописываются в каждую
строку состояния со значениями по умолчанию — в фикстурах `rich-old.json` и
`rich-new.json` новых полей нет, поэтому значения именно такие:

```bash
node -e '
const fs = require("fs");
const p = "tests/js/fixtures/page-data.golden.json";
const g = JSON.parse(fs.readFileSync(p, "utf8"));
for (const s of g.snapshots) {
  for (const b of s.builds) {
    b.commit = null; b.commit_url = null; b.commits_ahead = null;
    b.patches_ref = null; b.ghosts = [];
    for (const patch of b.patches) patch.ghost = null;
  }
}
for (const pair of g.pairs) {
  for (const row of pair.rows) {
    for (const patch of row.old_patches) patch.ghost = null;
    for (const patch of row.new_patches) patch.ghost = null;
  }
}
fs.writeFileSync(p, JSON.stringify(g, null, 1) + "\n");
'
```

Отступ и хвостовой перевод строки подогнать под то, чем файл был записан:
сверить `git diff --stat` — правка должна коснуться только содержательных
строк, а не всего файла целиком. Если форматирование разъехалось, отменить и
дописать ключи вручную.

- [ ] **Step 7: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS, включая «данные страницы совпадают с питоновским эталоном».
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 8: Коммит**

```bash
git add dashboard/assets/js/viewmodel.js dashboard/assets/js/markup.js \
        dashboard/assets/js/tables.js dashboard/assets/css/table.css \
        tests/js/fixtures/page-data.golden.json tests/js/viewmodel.test.js \
        tests/js/markup.test.js tests/js/tables.test.js
git commit -m "Коммит сборки и «ветка +N» в раскрытой строке"
```

---

### Task 11: Ghost-секция под списком патчей

**Files:**
- Modify: `dashboard/assets/js/markup.js`
- Modify: `dashboard/assets/js/tables.js:108-109`
- Modify: `dashboard/assets/css/table.css`
- Modify: `tests/js/markup.test.js`, `tests/js/tables.test.js`

**Interfaces:**
- Consumes: `row.ghosts` из Задачи 10, `labels.classCls(name)`.
- Produces: `markup.ghostsHtml(ghosts, q) -> string`; пустой список даёт
  пустую строку, и блок патчей выглядит ровно как прежде.

- [ ] **Step 1: Написать падающие тесты**

В `tests/js/markup.test.js`:

```js
function ghost(name, side, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls || 'CVE',
           cves: [], url: 'https://gl/' + name, ghost: side };
}

test('без ghost-патчей секции нет', function () {
  assert.strictEqual(markup.ghostsHtml([], ''), '');
});

test('стороны идут в одном порядке и подписаны по-разному', function () {
  var html = markup.ghostsHtml([ghost('c.patch', 'build'),
                                ghost('a.patch', 'branch'),
                                ghost('b.patch', 'changed')], '');
  var order = ['готово в ветке, не собрано',
               'переписано в ветке после сборки',
               'убрано из ветки после сборки'];
  var at = order.map(function (t) { return html.indexOf(t); });
  assert.ok(at[0] !== -1 && at[0] < at[1] && at[1] < at[2]);
});

test('у каждой стороны свой счётчик и своя подсказка', function () {
  var html = markup.ghostsHtml([ghost('a.patch', 'branch'),
                                ghost('b.patch', 'branch')], '');
  assert.match(html, /готово в ветке, не собрано <span class="n">2<\/span>/);
  assert.match(html, /data-tip="[^"]+"/);
});

test('класс патча виден и покрашен', function () {
  var html = markup.ghostsHtml([ghost('a.patch', 'branch', 'SAST')], '');
  assert.match(html, /SAST/);
  assert.match(html, /class="pcls [^"]+"/);
});
```

В `tests/js/tables.test.js`:

```js
test('ghost-секция стоит в блоке патчей', function () {
  var row = stateRow({ ghosts: [{ path: 'PATCH/x.patch', name: 'x.patch',
                                  'class': 'CVE', cves: [],
                                  url: 'https://gl/x', ghost: 'branch' }] });
  var out = tables.stateRows([{ row: row, open: true }], opts());
  assert.match(out, /готово в ветке, не собрано/);
});

test('без ghost блок патчей прежний', function () {
  var out = tables.stateRows([{ row: stateRow(), open: true }], opts());
  assert.strictEqual(out.indexOf('готово в ветке'), -1);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/markup.test.js tests/js/tables.test.js`
Expected: FAIL — `markup.ghostsHtml` не существует.

- [ ] **Step 3: Реализовать разметку**

В `dashboard/assets/js/markup.js`, после `patchesHtml`:

```js
  /* Ghost-патчи — не патчи билда, а различие между коммитом сборки и
     вершиной ветки. Порядок сторон читается как рассказ: чего в билде не
     хватает, что в нём устарело, что в нём лишнее. */
  const GHOST_ORDER = ['branch', 'changed', 'build'];
  const GHOST_HEAD = {
    branch: 'готово в ветке, не собрано',
    changed: 'переписано в ветке после сборки',
    build: 'убрано из ветки после сборки'
  };
  const GHOST_TIP = {
    branch: 'Файл есть в ветке, но появился после коммита, из которого '
          + 'собран билд: в пакете его нет.',
    changed: 'Файл с тем же именем в ветке другой: в пакете лежит его '
           + 'прежняя редакция.',
    build: 'Файл был на коммите сборки, а из ветки его убрали: в пакете '
         + 'он есть.'
  };

  function ghostItem(g, q) {
    const href = safeUrl(g.url);
    const title = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">`
        + `${hl(g.name, q)}</a>`
      : `<span class="mono">${hl(g.name, q)}</span>`;
    /* Класс подписью, а не отдельной группой: сторон уже три, и деление
       каждой ещё и по классам дало бы девять заголовков на четыре файла. */
    const cls = g['class']
      ? `<span class="pcls ${labels.classCls(g['class'])}">`
        + `${esc(g['class'])}</span>` : '';
    const path = pathAdds(g, q) ? `<div class="ppath">${hl(g.path, q)}</div>`
                                : '';
    return `<li class="is-ghost">${cls}${title}${path}</li>`;
  }

  function ghostsHtml(ghosts, q) {
    if (!ghosts.length) return '';
    return GHOST_ORDER.map((side) => {
      const list = ghosts.filter((g) => g.ghost === side);
      if (!list.length) return '';
      return `<div class="pgroup ghost">`
           + `<div class="pclass" data-tip="${esc(GHOST_TIP[side])}">`
           + `${esc(GHOST_HEAD[side])} <span class="n">${list.length}</span>`
           + `</div><ul class="plist">`
           + `${list.map((g) => ghostItem(g, q)).join('')}</ul></div>`;
    }).join('');
  }
```

и `ghostsHtml` в объект возврата модуля.

В `dashboard/assets/js/tables.js`, блок патчей:

```js
      + `<div class="block">${blockHead('патчи', row.patches.length,
                                        markup.aheadHtml(row))}`
      + `${markup.patchesHtml(row.patches, q)}`
      + `${markup.ghostsHtml(row.ghosts || [], q)}</div>`;
```

- [ ] **Step 4: Вид ghost-секции**

В `dashboard/assets/css/table.css`, после правил `.plist`:

```css
/* Ghost-патчи приглушены нарочно: их нет в пакете, и читаться они должны
   тише настоящих — иначе блок патчей превращается в два равноправных
   списка, и какой из них про билд, станет неочевидно. */
.pgroup.ghost { margin-top: .75rem; padding-top: .5rem;
                border-top: 1px dashed var(--line); }
.pgroup.ghost .pclass { color: var(--muted); font-weight: 600;
                        text-transform: none; letter-spacing: 0;
                        cursor: help; }
.pgroup.ghost .plist li.is-ghost { opacity: .72; }
.pgroup.ghost .pcls { margin-right: .35rem; font-size: .66rem;
                      font-weight: 700; letter-spacing: .04em; }
```

Имена переменных `--line` и `--muted` сверить с `base.css`; если такой
переменной нет, взять ту, которой уже нарисованы разделители и приглушённый
текст в этом файле, и новую не заводить.

- [ ] **Step 5: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 6: Посмотреть глазами**

```bash
python3 -m dashboard page -o /tmp/dash.html
```

Открыть `/tmp/dash.html`, загрузить снапшот с ghost-патчами (появится в
Задаче 13; до неё — собранный руками файл), раскрыть строку и убедиться:
секция читается тише основного списка, подсказки на заголовках работают,
бейдж «ветка +N» стоит в шапке блока патчей и не переносится на вторую
строку.

- [ ] **Step 7: Коммит**

```bash
git add dashboard/assets/js/markup.js dashboard/assets/js/tables.js \
        dashboard/assets/css/table.css tests/js/markup.test.js \
        tests/js/tables.test.js
git commit -m "Ghost-патчи в раскрытой строке"
```

---

### Task 12: Предупреждение о разных режимах на «Изменениях»

**Files:**
- Modify: `dashboard/assets/js/store.js:92-109`
- Modify: `tests/js/store.test.js`

**Interfaces:**
- Consumes: `snapshot.builds[*].patches_ref` из сырого снапшота.
- Produces: строка в `store.warnings()`, когда среди загруженных снапшотов
  есть и снятые с коммита, и снятые с ветки.

- [ ] **Step 1: Написать падающий тест**

Хранилище в этом файле — модуль-одиночка: тесты начинают со `store.reset()`
и зовут `store.add([снапшот], 'имя.json')`. Помощник `snap(tag, generated)`
отдаёт снапшот с пустым `builds`, поэтому билды кладём сами:

```js
function withBuild(tag, generated, over) {
  var s = snap(tag, generated);
  s.builds = [Object.assign({ nvr: 'n-1-1', name: 'n', version: '1',
                              release: '1',
                              source: { raw: 'git+https://gl/g/n#origin/br',
                                        ref: 'br', ref_kind: 'branch' } },
                            over || {})];
  return s;
}

test('снапшоты разных видов — предупреждение', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'b.json');
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /коммит/);
});

test('снапшоты одного вида — тишина', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'def456' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('снапшоты без patches_ref в счёт не идут', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/store.test.js`
Expected: FAIL — предупреждений ноль.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/store.js` — новая проверка рядом с `checkHubs`, и
вызов её оттуда же, откуда зовётся `checkHubs`:

```js
  /* Снапшоты, собранные до перехода на коммит сборки, сняты с вершины
     ветки, а нынешние — с коммита сборки. Сравнивать их можно, но часть
     разницы патчей в такой паре — след смены смысла, а не событие в
     репозитории. Это предупреждение, а не отказ: пары разных лет всё равно
     смотрят, и молчаливое искажение хуже лишней строки. */
  function checkPatchRefs() {
    let kinds = {}, i, j, builds, ref;
    for (i = 0; i < items.length; i++) {
      builds = items[i].snapshot.builds || [];
      for (j = 0; j < builds.length; j++) {
        ref = builds[j].patches_ref;
        if (ref === undefined || ref === null) continue;
        kinds[ref === (builds[j].source && builds[j].source.ref)
              ? 'branch' : 'commit'] = true;
      }
    }
    if (kinds.branch && kinds.commit) {
      warns.push('Загружены снапшоты двух видов: в одних патчи сняты с '
               + 'коммита сборки, в других — с вершины ветки. Часть разницы '
               + 'патчей между ними — след этой разницы, а не изменение в '
               + 'репозитории.');
    }
  }
```

В `checkHubs` строка `warns = []` обнуляет список — значит `checkPatchRefs`
должна звучать **после** неё, в том же месте, где `checkHubs` уже зовётся.
Проще всего завести обёртку и звать её вместо `checkHubs`:

```js
  function recheck() {
    checkHubs();          /* она же обнуляет warns */
    checkPatchRefs();
  }
```

и заменить все вызовы `checkHubs()` на `recheck()`.

Снапшоты без `patches_ref` вовсе в подсчёт не идут: у них режим неизвестен,
и объявлять их «ветковыми» значило бы ругаться на каждую пару, где одна
сторона старая.

- [ ] **Step 4: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/assets/js/store.js tests/js/store.test.js
git commit -m "Предупреждение о снапшотах двух видов"
```

---

### Task 13: Фикстуры, документация, версия 2.2.0

**Files:**
- Modify: `tests/fixtures/make_rich_fixtures.py`
- Modify: `tests/fixtures/rich-*.json` (перегенерация)
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `dashboard/__init__.py:8`

**Interfaces:**
- Consumes: всё, сделанное в Задачах 1–12.
- Produces: демонстрационные снапшоты с отставшей веткой и ghost-патчами
  всех трёх сторон; версия `2.2.0`.

- [ ] **Step 1: Добавить случаи в генератор**

В `tests/fixtures/make_rich_fixtures.py` дописать билд с отставшей веткой и
ghost-патчами всех трёх сторон — в те снапшоты, которые **не** порождают
эталон паритета. `rich-old.json` и `rich-new.json` не трогать: из них
считается `page-data.golden.json`, пересчитать который нечем.

Ориентир — комментарий в шапке генератора про `CLASSES_WITH_DISTSUFFIX`: там
уже описано, какие снапшоты можно расширять, а какие нет.

Новый билд задаётся так (`BLOB` — короткая постоянная рядом с остальными в
шапке генератора, чтобы длинные адреса не расползались по строкам):

```python
BLOB = ("https://gitlab.example.com/g/httpd/-/blob/"
        "0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122/PATCH/%s")
BLOB_BRANCH = "https://gitlab.example.com/g/httpd/-/blob/os-9.4/PATCH/%s"

    Build(nvr="httpd-2.4.62-13.el9", name="httpd", version="2.4.62",
          release="13.el9", build_id=901, task_id=9011, owner="builder",
          completed="2026-07-01 10:00:00", tag_name=tag,
          source=Source(raw="git+https://gitlab.example.com/g/httpd#origin/os-9.4",
                        host="gitlab.example.com", project="g/httpd",
                        ref="os-9.4", ref_kind="branch",
                        web_url="https://gitlab.example.com/g/httpd/-/tree/os-9.4",
                        commit="0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122",
                        commit_url="https://gitlab.example.com/g/httpd/-/tree/0f1a2b3c4d5e6f70819293a4b5c6d7e8f9001122",
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
```

Ссылки не случайны: у патчей билда и у стороны `build` они ведут на коммит,
у сторон `branch` и `changed` — на ветку. Так же их строит `collect`, и
фикстура, разошедшаяся с ним, перестала бы быть демонстрацией.

Класс `DISTSUFFIX` есть не во всех снапшотах — класть новый билд только
туда, где список классов его содержит (`CLASSES_WITH_DISTSUFFIX` и
`CLASSES_WITH_LICENSE`).

- [ ] **Step 2: Перегенерировать и прогнать**

```bash
python3 tests/fixtures/make_rich_fixtures.py
git diff --stat tests/fixtures/
```

Expected: изменились только те снапшоты, куда добавлен билд; `rich-old.json`
и `rich-new.json` — нет.

Run: `python3 -m unittest discover -s tests && node --test tests/js/*.test.js`
Expected: PASS

- [ ] **Step 3: README**

Дописать и поправить:

- Раздел про поле `source` снапшота: пять новых ключей с их значениями,
  таблицей — как в спеке.
- Новый абзац: `patches` — это то, что лежало в `PATCH` **на коммите
  сборки**; `patches_ref` говорит, с какого ref'а список снят на самом деле
  (хеш или имя ветки), и почему у части билдов там имя ветки.
- Абзац про `patch_dir_present`: речь теперь о дереве коммита.
- Новый абзац про `ghost_patches` и три стороны.
- Раздел меток и раздел фильтров: `branch-ahead`.
- Раздел флагов: `--no-branch-check` с ценой в запросах.
- Раздел «Скрипты»/«Стили» не трогать: новых файлов не появилось.

- [ ] **Step 4: Версия и CHANGELOG**

`dashboard/__init__.py`:

```python
__version__ = "2.2.0"
```

В `CHANGELOG.md` новая запись перед `## 2.1.0`:

```markdown
## 2.2.0 — 2026-08-09

**Патчи билда снимаются с коммита, из которого он собран.** Раньше каталог
`PATCH` читался с вершины ветки на момент прогона, и снапшот склеивался из
двух разных времён: koji-часть замороженная, GitLab-часть сегодняшняя.
Патч, влитый в ветку но не собранный, выглядел как патч билда — для
дашборда патчей CVE это опасное направление ошибки. Теперь хеш берётся из
верхнеуровневого поля `source` ответа `getBuild` (оно приезжает в том же
пакетном вызове, лишних запросов ноль), а `patches_ref` в каждом билде
говорит, с какого ref'а список снят на самом деле: у билдов без хеша это
по-прежнему имя ветки, и всё для них осталось как было.

**Видно, что ветка ушла вперёд.** Метка `branch-ahead` с фильтром, бейдж
«ветка +N» в шапке блока патчей, `commits_ahead` и `branch_head` в
снапшоте. Число считается от точки расхождения и так и называется —
«коммитов после точки, из которой собран билд»: это верно и для
перебазированной ветки.

**Ghost-патчи.** В раскрытой строке под списком патчей появилась
приглушённая секция с тремя сторонами: «готово в ветке, не собрано»,
«переписано в ветке после сборки», «убрано из ветки после сборки».
Считаются они сравнением двух деревьев по blob sha, а не по одним именам,
поэтому переписанный патч CVE тоже виден. В счётчики строки, карточки
классов и сводку ghost не идут — это то, чего в билде нет.

**Коммит и вечная ссылка в раскрытии.** Хеш сборки и ссылка на дерево
репозитория в этом состоянии. Ветка уедет, а ссылка останется той же и
через полгода.

**`--no-branch-check`.** Отключает сравнение с веткой: патчи по-прежнему
снимаются с коммита, но число несобранных коммитов и ghost не считаются, и
запрос в GitLab остаётся один на билд вместо двух-трёх.

Формат снапшота совместим: `schema` по-прежнему `1`, все новые поля
необязательные. Снапшоты, собранные до 2.2.0, читаются как раньше, а
страница предупреждает, когда рядом легли снапшоты двух видов — снятые с
коммита и снятые с ветки.
```

- [ ] **Step 5: Прогнать всё и посмотреть страницу**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard --version
python3 -m dashboard page -o /tmp/dash.html
```

Expected: обе сюиты зелёные, версия `dashboard 2.2.0`, страница открывается,
демонстрационные фикстуры показывают метку, бейдж и ghost-секцию.

- [ ] **Step 6: Коммит**

```bash
git add tests/fixtures README.md CHANGELOG.md dashboard/__init__.py
git commit -m "Демонстрационные фикстуры, документация и версия 2.2.0"
```

---

## После всех задач

- [ ] Прогнать обе сюиты начисто на чистом дереве.
- [ ] Прогнать `collect` по настоящему тегу и посмотреть на новую строку
      итогов: у скольких билдов известен коммит. Если почти у всех —
      фолбэк на git-теги не нужен и обсуждать его больше не нужно. Если у
      заметной доли нет — это вход в отдельную работу, а не повод править
      эту.
- [ ] Сравнить время прогона с прежним и посмотреть в дебажном логе, не
      ловим ли мы 429. Если ловим — в README к `--no-branch-check` дописать
      строку про то, когда его включать.
- [ ] Отдать ветку на апрув человеку. В `develop` не вливать самому.
