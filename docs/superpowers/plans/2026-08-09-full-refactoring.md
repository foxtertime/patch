# Полный рефакторинг — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Убрать долг, найденный аудитом всего производственного кода: разрезать три переросших файла, схлопнуть шесть дублей правил, вымести мёртвое и устаревшее — и заодно научить колонку «Δ патчей» видеть переписанные патчи.

**Architecture:** Пять новых JS-модулей отделяются от `ui.js` и `page.js` в том же виде, в каком уже написаны `rail`, `files`, `tips`, `toasts`, `filters`: UMD-обёртка, `create(deps)`, свои узлы и слушатели, наружу минимум. `_attach_patches` в Python разрезается на четыре фазы. Дубли схлопываются каждый в своём слое: правило «переписан» уходит из разметки в `diff.js`, обход списка патчей — в одну функцию, мемоизация и постройка `TreeResult` — в помощников `GitlabClient`.

**Tech Stack:** Python 3.9 (stdlib + PyYAML + requests + koji), ES2015+ без сборщика, `unittest` и `node --test`.

## Global Constraints

Эти требования входят в требования каждой задачи.

- **Обе сюиты зелёные после каждой задачи.** Точка отсчёта: `python3 -m unittest discover -s tests` → 359 тестов, `node --test tests/js/*.test.js` → 501.
- **Схема снапшота `SCHEMA = 1` не меняется**, и ни одно поле `dashboard/model.py` не трогается. Значит `tests/test_fixtures.py::test_generator_writes_exactly_what_is_committed` в этой работе не срабатывает и фикстуры `rich-*.json` не перегенерируются ни разу. Понадобилось их тронуть — значит что-то пошло не по плану, надо остановиться и сказать.
- **Форма данных страницы не меняется.** `page-data.golden.json` правится ровно ноль раз.
- **Схлопывание дубля обязано оставить сюиту зелёной без единой правки теста.** Правка, которая ничего не меняет, тесты менять не может. Понадобилось поправить тест — поведение всё-таки поехало; это находка, а не помеха, и о ней надо сказать, а не подогнать тест.
  **Единственное исключение — Задача 8**, и она названа здесь поимённо: там у `patchesChangeHtml` меняется сигнатура, и вызовы в тестах обязаны поехать вместе с ней. Во всех остальных задачах правка существующего теста — сигнал остановиться.
  Это правило про **правку** тестов. Дописать новый тест (Задачи 2, 7, 9, 10, 11, 12) и перевезти существующий в файл нового модуля без изменения тела (Задачи 6, 11, 13) оно не запрещает.
- **Задачи 3 и 5 не пишут ни одного теста, и это не упущение.** Обе — чистое переустройство внутренностей: наружность функций не меняется, а существующие тесты её уже сторожат. Тест, написанный под новую внутреннюю функцию, закрепил бы разрез, который завтра захочется провести иначе. Проверка этих задач — зелёная сюита без правок, и только она.
- **Комментарии переезжают целиком.** Они объясняют не строки, а решения. Ни сокращать, ни пересказывать своими словами, ни выбрасывать «очевидное». Если комментарий ссылается на имя, которое задача переименовала, правится только имя.
- **Язык — русский**, тот же регистр, что в соседнем коде: разговорный, без канцелярита, с объяснением «почему», а не «что».
- **Цвет значит класс патча и ничего больше.** `--major` (янтарный) на этой странице уже значит «разъехалось, но ничего не потеряно» — им покрашены `.is-rewritten`, «сменил ветку» и «ветка +N». Новых цветов и новых легенд не заводится.
- **Новые JS-модули** — UMD-обёртка + `create(deps)`, кроме `search.js`: он ничем не владеет и остаётся простым модулем без фабрики, как `text.js` и `rpms.js`.
- **`SCRIPTS` в `dashboard/build.py`** собирается по зависимостям, а не по алфавиту. Каждый новый файл туда дописывается в той же задаче, где заводится, иначе `dashboard page` соберёт страницу без него, и тесты этого не заметят.
- **Ловушка `tests/fakes.py`.** `FakeTransport.get` сопоставляет маршруты по `tuple(sorted(params.items()))`. Для чтения дерева отсортированный порядок — `(path, per_page, recursive, ref)`. Ключ, собранный в другом порядке, молча даёт 404, и тест зеленеет не по той причине. В этой работе новых маршрутов не заводится, но старые трогаются в Задаче 2 — если тест внезапно позеленел «сам», проверить это.
- **Версию поднимает Задача 14**, и никакая другая. Промежуточные задачи `dashboard/__init__.py` не трогают.

---

## Файлы

**Создаются (JS):**

| файл | ответственность |
|---|---|
| `dashboard/assets/js/search.js` | совпало ли в строке и достаточно ли этого, чтобы не разворачивать |
| `dashboard/assets/js/copy.js` | список NVR видимых строк в буфер обмена |
| `dashboard/assets/js/viewport.js` | реакции на размер и прокрутку окна: липкая шапка, кнопка «наверх» |
| `dashboard/assets/js/address.js` | владение `location.hash`: когда его читать и когда писать |
| `dashboard/assets/js/notices.js` | какие предупреждения хранилища ещё не показаны |

**Создаются (тесты):** `tests/js/search.test.js`, `copy.test.js`, `viewport.test.js`, `address.test.js`, `notices.test.js`.

**Правятся:**

| файл | что в нём меняется |
|---|---|
| `dashboard/collect.py` | `_attach_patches` → четыре фазы; `cfg` прочь; `_completed` без устаревшего вызова |
| `dashboard/gitlabclient.py` | `_cached`, `_tree_problem` |
| `dashboard/build.py` | `SCRIPTS` — пять новых имён |
| `dashboard/assets/js/page.js` | поиск наружу, `rowsOf`, `setFrom` прочь, сортировка по `dpatch` |
| `dashboard/assets/js/ui.js` | четыре выноса, устаревший комментарий |
| `dashboard/assets/js/viewmodel.js` | `sideOf` |
| `dashboard/assets/js/markup.js` | `patchesChangeHtml` принимает список, `delta` знает третий исход |
| `dashboard/assets/js/tables.js` | передаёт переписанные, показывает три исхода |
| `dashboard/assets/css/table.css` | `.tilde` |
| `dashboard/assets/css/cards.css` | устаревший комментарий |
| `dashboard/assets/dashboard.html` | подсказка колонки «Δ патчей» |
| `README.md`, `CHANGELOG.md`, `dashboard/__init__.py` | Задача 14 |

**Тесты правятся:** `tests/test_collect.py`, `tests/test_gitlabclient.py`, `tests/js/ui.test.js` (тесты уезжают), `markup.test.js`, `tables.test.js`, `page.test.js`, `viewmodel.test.js`.

---

## Задача 1: Уборка мелочей

Пять мелких правок, ни одна из которых не меняет поведения. Идут первыми, чтобы в новые файлы не переехало устаревшее.

**Files:**
- Modify: `dashboard/assets/js/page.js:21`
- Modify: `dashboard/assets/js/ui.js:109-118`
- Modify: `dashboard/assets/css/cards.css:16`
- Modify: `tests/js/viewmodel.test.js:655`
- Modify: `dashboard/collect.py:33-34`

**Interfaces:**
- Consumes: ничего
- Produces: ничего

- [ ] **Шаг 1: Убрать неиспользуемый `setFrom` из `page.js`**

Строка 21 сейчас:

```js
    const has = text.has, slug = text.slug;
```

а строкой выше:

```js
    const own = text.own, keys = text.keys, setFrom = text.setFrom;
```

`setFrom` в `page.js` не зовут ни разу (проверить: `grep -n 'setFrom' dashboard/assets/js/page.js` должен дать только эту строку). Стало:

```js
    const own = text.own, keys = text.keys;
```

Сам `text.setFrom` остаётся на месте: у него есть свой тест в `text.test.js`, и модуль-словарь не обязан состоять только из того, что зовут сегодня.

- [ ] **Шаг 2: Поправить устаревший комментарий в `ui.js`**

Срезов на «Изменениях» стало двенадцать (карточка `patches~` пришла в 2.3.0). Два таких же комментария поправлены раньше, этот — третий. Было (`ui.js:109-113`):

```js
  /* Ширина карточки-среза. Браузер набивает строку под завязку и про
     остаток не думает: одиннадцать срезов при десяти влезающих дают строку
     из одной карточки. Считаем, на сколько строк они делятся поровну, и
     задаём ширину числом — строка флексов растягивает то, что в ней стоит,
     поэтому короткая последняя строка занята целиком.
```

Стало:

```js
  /* Ширина карточки-среза. Браузер набивает строку под завязку и про
     остаток не думает: двенадцать срезов при десяти влезающих дают вторую
     строку из двух карточек. Считаем, на сколько строк они делятся поровну,
     и задаём ширину числом — строка флексов растягивает то, что в ней стоит,
     поэтому короткая последняя строка занята целиком.
```

- [ ] **Шаг 3: Поправить тот же счёт в `cards.css`**

Было (`cards.css:16`):

```css
/* Срезы — не сетка, а строки: их бывает и десять, и одиннадцать, и сетка с
```

Стало:

```css
/* Срезы — не сетка, а строки: их бывает и десять, и двенадцать, и сетка с
```

- [ ] **Шаг 4: Назвать сверку эталона тем, чем она является**

`viewmodel.test.js:655` зовёт сверку побайтовой, а `assert.deepStrictEqual` порядок ключей не проверяет вовсе — он сравнивает разобранные объекты. Комментарий вводит в заблуждение насчёт того, что тест сторожит, и на него чуть не оперлась Задача 4. Было:

```js
  // побайтовая сверка выше ничего не говорит о том, что в эталоне вообще
```

Стало:

```js
  // сверка выше ничего не говорит о том, что в эталоне вообще
```

- [ ] **Шаг 5: Убрать устаревший вызов из `_completed`**

`datetime.utcfromtimestamp` объявлен устаревшим в Python 3.12. Здесь Python 3.9, поэтому сегодня это ничего не значит — правка на будущее. Было (`collect.py:33-34`):

```python
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw).strftime("%Y-%m-%d %H:%M:%S")
```

Стало:

```python
    if isinstance(raw, (int, float)):
        # не utcfromtimestamp: тот объявлен устаревшим в 3.12. Пояс в
        # строку не попадает — его нет в формате, — поэтому результат
        # тот же самый.
        return datetime.fromtimestamp(raw, timezone.utc).strftime(
            "%Y-%m-%d %H:%M:%S")
```

`timezone` в модуле уже импортирован (`from datetime import datetime, timezone`), дописывать импорт не нужно.

- [ ] **Шаг 6: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: 359 Python (в том числе `CompletedTimeTest::test_epoch_number`, который и сторожит Шаг 5), 501 JS. Ни одного упавшего, ни одного правленного теста.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/assets/js/page.js dashboard/assets/js/ui.js \
        dashboard/assets/css/cards.css tests/js/viewmodel.test.js \
        dashboard/collect.py
git commit -m "Вымести мёртвое и устаревшее"
```

---

## Задача 2: `_tree_problem` и `_cached` в GitlabClient

Два дубля в одном файле: постройка «дерево не прочиталось» повторена восемь раз, мемоизация — дважды.

**Files:**
- Modify: `dashboard/gitlabclient.py`
- Test: `tests/test_gitlabclient.py`

**Interfaces:**
- Consumes: ничего
- Produces: `_tree_problem(problem) -> TreeResult`, `GitlabClient._cached(key, note, compute)` — внутренние, наружу не выставляются

- [ ] **Шаг 1: Написать падающие тесты**

В `tests/test_gitlabclient.py` дописать (класс подобрать по соседству — рядом с тестами кэша и с тестами чтения дерева; смотреть, как в файле уже устроены заглушки транспорта):

```python
    def test_tree_problem_builds_the_same_tuple_as_by_hand(self):
        # восемь мест собирали этот кортеж вручную; помощник обязан давать
        # ровно то же самое, иначе один из восьми случаев тихо поменяется
        from dashboard.gitlabclient import TreeResult, _tree_problem
        self.assertEqual(_tree_problem("gitlab: беда"),
                         TreeResult(None, [], "gitlab: беда", {}))

    def test_compare_is_memoised_like_the_tree(self):
        # мемоизация у дерева и у сравнения теперь одна на двоих: второй
        # вызов обязан вернуть тот же объект и не сходить в транспорт
        client, transport = self.client_with_compare()
        first = client.compare(HOST, "group/nginx", "abc1234", "main")
        before = len(transport.calls)
        second = client.compare(HOST, "group/nginx", "abc1234", "main")
        self.assertIs(first, second)
        self.assertEqual(len(transport.calls), before)
```

Второй тест почти наверняка **уже есть** в файле в том или ином виде — сперва проверить: `grep -n 'compare' tests/test_gitlabclient.py`. Если есть, писать его заново не надо: дубль теста хуже отсутствующего. Тогда падающим остаётся только первый.

`client_with_compare` — вспомогательная сборка клиента с маршрутом `/repository/compare`; если такой в файле нет, взять за образец ближайшую существующую и назвать в её стиле.

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
python3 -m unittest tests.test_gitlabclient -v
```

Ожидается: `ImportError: cannot import name '_tree_problem'`.

- [ ] **Шаг 3: Завести `_tree_problem`**

Сразу после `logger = logging.getLogger(__name__)`:

```python
def _tree_problem(problem: str) -> TreeResult:
    """Дерево не прочиталось: причина есть, содержимого нет.

    Восемь мест собирали этот кортеж вручную и позиционно. В 2.2.0
    добавление поля blobs стоило правки одиннадцати конструкций, и
    следующее поле стоило бы того же.
    """
    return TreeResult(None, [], problem, {})
```

- [ ] **Шаг 4: Заменить восемь конструкций**

Ровно эти восемь, и никакие другие:

| где | было | стало |
|---|---|---|
| `patch_files` | `TreeResult(None, [], "gitlab: no ref in source url", {})` | `_tree_problem("gitlab: no ref in source url")` |
| `_fetch` | `TreeResult(None, [], "gitlab: unknown host %s" % host, {})` | `_tree_problem("gitlab: unknown host %s" % host)` |
| `_fetch_tree` | `TreeResult(None, [], response, {})` | `_tree_problem(response)` |
| `_fetch_tree` | `TreeResult(None, [], "gitlab: %s" % note, {})` | `_tree_problem("gitlab: %s" % note)` |
| `_fetch_tree` | `TreeResult(None, [], "gitlab: %s %s" % (response.status, server_message(response)), {})` | `_tree_problem("gitlab: %s %s" % (response.status, server_message(response)))` |
| `_resolve_missing_tree` | `TreeResult(None, [], response, {})` | `_tree_problem(response)` |
| `_resolve_missing_tree` | `TreeResult(None, [], "gitlab: ref not found", {})` | `_tree_problem("gitlab: ref not found")` |
| `_resolve_missing_tree` | `TreeResult(None, [], "gitlab: %s %s" % (response.status, server_message(response)), {})` | `_tree_problem("gitlab: %s %s" % (response.status, server_message(response)))` |

**Три конструкции остаются как есть** — они не про «не прочиталось»:

- `_fetch`: `TreeResult(result.present, result.paths, problem, result.blobs)` — пересборка удачного чтения с припиской о подменённом хосте
- `_fetch_tree`: `TreeResult(True, sorted(paths), None, blobs)` — успех
- `_resolve_missing_tree`: `TreeResult(False, [], None, {})` — законно пустое дерево

Последнюю в помощника не заворачивать: место одно, и `_tree_empty()` ради одного вызова — это лишнее имя, а не меньше кода.

- [ ] **Шаг 5: Завести `_cached`**

Методом `GitlabClient`, рядом с `patch_files`:

```python
    def _cached(self, key, note, compute):
        """Мемоизация под общим локом: посмотреть, посчитать, положить.

        Пояснение для лога приходит уже собранным строкой: строка в логе
        обязана остаться той же, что писали patch_files и compare по
        отдельности. Цена — склейка происходит и на уровне INFO, где
        строка никуда не уйдёт; на теге в сотни билдов это доли
        миллисекунды против самих запросов в GitLab.
        """
        with self._lock:
            if key in self._cache:
                logger.debug("кэш: %s", note)
                return self._cache[key]
        result = compute()
        with self._lock:
            self._cache[key] = result
        return result
```

- [ ] **Шаг 6: Перевести `patch_files` и `compare` на `_cached`**

`patch_files` целиком:

```python
    def patch_files(self, host, project, ref) -> TreeResult:
        """Пути файлов внутри каталога патчей ветки; результат мемоизируется."""
        if not ref:
            return _tree_problem("gitlab: no ref in source url")
        return self._cached((host, project, ref),
                            "%s %s@%s" % (host, project, ref),
                            lambda: self._fetch(host, project, ref))
```

Тело `compare` после докстроки (докстрока остаётся слово в слово):

```python
        if not from_sha or not to_ref:
            return CompareResult(None, None, "gitlab: нечего сравнивать")
        return self._cached(("compare", host, project, from_sha, to_ref),
                            "сравнение %s %s %s..%s" % (host, project,
                                                        from_sha, to_ref),
                            lambda: self._fetch_compare(host, project,
                                                        from_sha, to_ref))
```

Строки в логе выходят те же, что и раньше: `кэш: <host> <project>@<ref>` и `кэш: сравнение <host> <project> <from>..<to>`.

- [ ] **Шаг 7: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: 360+ Python (359 плюс новые), 501 JS. **Ни один существующий тест не правится.** Понадобилось — значит поведение поехало: остановиться и сказать.

- [ ] **Шаг 8: Коммит**

```bash
git add dashboard/gitlabclient.py tests/test_gitlabclient.py
git commit -m "Один помощник на восемь неудачных чтений и одна мемоизация на две"
```

---

## Задача 3: `_attach_patches` — четыре фазы четырьмя функциями

Девяносто девять строк, четыре фазы, каждая со своим ранним выходом. Плюс мёртвый параметр.

**Files:**
- Modify: `dashboard/collect.py:144-153` (вызов в `handle`), `220-302` (сама функция)
- Test: `tests/test_collect.py`

**Interfaces:**
- Consumes: `_read_patch_dir`, `_ghosts`, `_patch`, `_commit_of`, `_original_url` — остаются как есть
- Produces:
  - `_attach_patches(build, info, gitlab_client, classifier, branch_check=True) -> None` — **`cfg` из сигнатуры исчез**
  - `_parse_source(build, info) -> Optional[ParsedSource]`
  - `_describe_source(build, info, parsed, gitlab_client) -> Optional[str]`
  - `_collect_patches(build, gitlab_client, parsed, commit, classifier) -> Tuple[str, TreeResult]`
  - `_branch_drift(build, gitlab_client, parsed, commit, tree, classifier) -> None`

- [ ] **Шаг 1: Убедиться, что наружность уже под охраной**

Прежде чем резать, прочитать в `tests/test_collect.py` классы `CollectTagTest`, `PatchesComeFromCommitTest`, `BranchAheadTest` и убедиться, что там уже есть: билд без URL (`test_build_without_source_gets_a_problem`), неразбираемый URL (`test_unparseable_source_url_gets_a_problem`), сборка из SRPM (`test_build_from_srpm_is_not_a_broken_url`), откат на ветку (`test_missing_commit_falls_back_to_the_branch_and_says_so`), непрочитанное дерево при ушедшей вперёд ветке (`test_network_failure_does_not_silently_read_the_branch`).

Все пять есть. **Новых тестов эта задача не пишет** — она обязана пройти под существующими без единой их правки. Это и есть её проверка.

- [ ] **Шаг 2: Написать новое тело `_attach_patches`**

Заменить весь блок с `def _attach_patches(` по строку `build.ghost_patches = _ghosts(...)` включительно на:

```python
def _attach_patches(build: Build, info: dict, gitlab_client,
                    classifier: Classifier,
                    branch_check: bool = True) -> None:
    """Патчи билда и всё, что о них известно.

    Четыре фазы подряд, и каждая может оказаться последней: разобрать
    источник, записать его в билд, прочитать каталог патчей, сравнить
    коммит сборки с вершиной ветки.
    """
    parsed = _parse_source(build, info)
    if parsed is None:
        return
    commit = _describe_source(build, info, parsed, gitlab_client)
    ref, tree = _collect_patches(build, gitlab_client, parsed, commit,
                                 classifier)
    if ref != commit:
        # откат на ветку: коммита в репозитории нет, и сравнивать с ним
        # ветку бессмысленно — точка отсчёта пропала вместе с коммитом
        commit = None
    # Сравнивать есть с чем, только когда билд собран с ветки: у сборки
    # прямо с коммита ветки нет, а без хеша нет и точки отсчёта.
    if branch_check and commit and parsed.ref_kind == "branch":
        _branch_drift(build, gitlab_client, parsed, commit, tree, classifier)


def _parse_source(build: Build, info: dict) -> Optional[ParsedSource]:
    """Источник билда, разобранный настолько, чтобы было что читать.

    None значит «дальше идти незачем»: URL нет вовсе, URL не разобрался
    или билд собран из готового SRPM. Причина в каждом из трёх случаев
    уже записана в билд, и звать следующие фазы не с чем.
    """
    raw_url = _original_url(info)
    if not raw_url:
        build.problems.append("no source url")
        return None
    try:
        parsed = parse_source_url(raw_url)
    except SourceUrlError as exc:
        build.source = Source(raw=raw_url)
        build.problems.append("bad source url: %s" % exc)
        return None

    # Сборка из готового SRPM: ветки нет, каталог PATCH читать негде и не у
    # кого. Это не проблема билда, а другой способ его собрать, поэтому в
    # problems ничего не уезжает — вид источника скажет метка в строке.
    # patch_dir_present остаётся None: «неизвестно», а не «нет патчей».
    if parsed.ref_kind == "srpm":
        build.source = Source(raw=raw_url, ref=parsed.ref, ref_kind="srpm")
        return None
    return parsed


def _describe_source(build: Build, info: dict, parsed,
                     gitlab_client) -> Optional[str]:
    """Записывает build.source целиком и отдаёт хеш коммита сборки.

    Сырой URL читаем из info заново — то же самое поле, что разбирал
    _parse_source; таскать его между фазами ради одного обращения к
    словарю значило бы усложнить их договор.
    """
    commit, commit_from = _commit_of(info, parsed)
    build.source = Source(
        raw=_original_url(info), host=parsed.host, project=parsed.project,
        ref=parsed.ref, ref_kind=parsed.ref_kind,
        web_url=gitlab_client.tree_url(parsed.host, parsed.project, parsed.ref),
        commit=commit, commit_source=commit_from,
        commit_url=gitlab_client.tree_url(parsed.host, parsed.project, commit))
    return commit


def _collect_patches(build: Build, gitlab_client, parsed, commit,
                     classifier: Classifier):
    """Каталог патчей билда: список патчей, ref и результат чтения.

    Результат отдаём наружу целиком: по нему считается расхождение с
    веткой, и читать дерево второй раз ради этого незачем.
    """
    ref, result = _read_patch_dir(build, gitlab_client, parsed, commit)
    build.patches_ref = ref
    build.patch_dir_present = result.present
    if result.problem:
        # проблема не обязательно означает, что читать нечего: подменённый
        # хост отдаёт и заметку, и настоящее дерево патчей. У неудачных
        # чтений paths и так пустой.
        build.problems.append(result.problem)
    for path in result.paths:
        build.patches.append(_patch(path, parsed, ref, classifier,
                                    gitlab_client,
                                    sha=result.blobs.get(path)))
    return ref, result


def _branch_drift(build: Build, gitlab_client, parsed, commit, tree,
                  classifier: Classifier) -> None:
    """Насколько ветка ушла вперёд от коммита сборки и что она принесла."""
    ahead = gitlab_client.compare(parsed.host, parsed.project, commit,
                                  parsed.ref)
    if ahead.problem:
        build.problems.append(ahead.problem)
        return
    build.source.branch_head = ahead.head
    build.source.commits_ahead = ahead.ahead

    if not build.source.commits_ahead:
        return
    # Дерево коммита не прочиталось вовсе (сетевой отказ, 500, исчерпанные
    # ретраи 429) — tree.present is None, а built.blobs в _ghosts пуст.
    # Посчитай мы ghost-и по такому дереву, каждый файл на вершине ветки
    # ушёл бы в сторону "branch" — «влит, но не собран», — хотя на деле мы
    # просто не знаем, что лежало в коммите: фабрикация, а не находка.
    # commits_ahead уже записан и не трогается: число коммитов не зависит
    # от чтения дерева патчей и остаётся верным само по себе — то, что
    # ветка ушла вперёд, известно, даже если неизвестно, что именно она
    # принесла.
    #
    # tree.present is False — легитимно пустое дерево (ветка есть,
    # каталога PATCH в коммите нет), и сравнение с веткой по нему верно:
    # тогда каждый файл ветки — и правда несобранный ghost. Поэтому
    # ограничиваемся ровно случаем «неизвестно», а не любым пустым built.
    if tree.present is None:
        return
    tip = gitlab_client.patch_files(parsed.host, parsed.project, parsed.ref)
    if tip.problem:
        build.problems.append(tip.problem)
        return
    build.ghost_patches = _ghosts(tree, tip, parsed, commit, classifier,
                                  gitlab_client)
```

Обратить внимание: в переехавшем длинном комментарии `result.present` стало `tree.present` — это единственная правка его текста, и она вынужденная, потому что довод теперь так и зовут.

- [ ] **Шаг 3: Дописать импорт `ParsedSource`**

`_parse_source` объявляет возвращаемый тип. Строка импорта была:

```python
from .sourceurl import SourceUrlError, parse_source_url
```

стала:

```python
from .sourceurl import ParsedSource, SourceUrlError, parse_source_url
```

- [ ] **Шаг 4: Убрать `cfg` из вызова**

`handle` в `collect_tag`, строки 151-153. Было:

```python
        try:
            _attach_patches(build, info, cfg, gitlab_client, classifier,
                            branch_check)
```

Стало:

```python
        try:
            _attach_patches(build, info, gitlab_client, classifier,
                            branch_check)
```

Проверить, что `cfg` в `collect_tag` всё ещё нужен для другого (`Classifier.from_config(cfg)`, `cfg.koji_hub`, `cfg.koji_web` в `Snapshot`) — нужен, из сигнатуры `collect_tag` он не убирается.

- [ ] **Шаг 5: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: столько же Python, сколько было после Задачи 2, 501 JS. **Ни один тест не правится.**

- [ ] **Шаг 6: Проверить, что разрез настоящий**

Глазами: тело `_attach_patches` — двенадцать строк, читается как оглавление; ни один комментарий не пропал (сверить с `git show HEAD:dashboard/collect.py`); `grep -n 'cfg' dashboard/collect.py` не показывает `cfg` внутри четырёх новых функций.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/collect.py
git commit -m "Разрезать _attach_patches по фазам"
```

---

## Задача 4: `sideOf` в viewmodel

Тридцать строк правил вывода значения, написанных дважды — для «было» и для «стало».

**Files:**
- Modify: `dashboard/assets/js/viewmodel.js:274-324`
- Test: `tests/js/viewmodel.test.js`

**Interfaces:**
- Consumes: `orNull`, `inheritedIn`, `evrOf`, `toMsk`, `kojiUrl` — все уже есть в модуле
- Produces: `sideOf(build, tag, kojiWeb)` — внутренняя, наружу не выставляется. Форма строки `diffRow` не меняется ни одним ключом.

- [ ] **Шаг 1: Завести `sideOf`**

Прямо перед `diffRow`:

```js
  /* Одна сторона перехода: десять значений, каждое со своей охраной от
     отсутствующего билда и отсутствующего источника. Считаются они у «было»
     и у «стало» по одному правилу, и правило это должно быть записано один
     раз — разойдись две копии, одна сторона показывала бы не то, что
     другая, и заметить это было бы нечем. */
  function sideOf(build, tag, kojiWeb) {
    const source = (build && build.source) || null;
    return {
      tagged_in: build ? orNull(build.tag_name) : null,
      inherited: build ? inheritedIn(build, tag) : null,
      evr: build ? evrOf(build) : null,
      branch: source ? orNull(source.ref) : null,
      // Чем ветка приходится билду, у каждой стороны своё: пересобранный из
      // SRPM компонент рядом с прежним, собранным из ветки, — законная
      // пара, и подписать оба «веткой» значило бы соврать про одну из них.
      ref_kind: source ? orNull(source.ref_kind) : null,
      // Своё у каждой стороны: раскрытая строка показывает не сравнение, а
      // две карточки одного билда, и «кто собрал» с «когда» у них разные.
      owner: build ? orNull(build.owner) : null,
      completed: build ? toMsk(build.completed) : null,
      project: source ? orNull(source.project) : null,
      koji_url: build ? kojiUrl(kojiWeb, build.nvr) : null,
      source_url: source ? orNull(source.web_url) : null
    };
  }
```

- [ ] **Шаг 2: Переписать `diffRow`**

Целиком:

```js
  function diffRow(component, kojiWeb, oldTag, newTag) {
    const old = component.old || null, fresh = component['new'] || null;
    const shown = fresh || old;
    const was = sideOf(old, oldTag, kojiWeb);
    const now = sideOf(fresh, newTag, kojiWeb);
    /* Список полей остаётся явным, а не собирается приписыванием приставки
       в цикле. Дублировалось здесь правило вывода значения, и оно теперь
       одно — в sideOf; форма же строки это договор с дашбордом, и её надо
       уметь найти поиском по old_project. */
    return {
      old_tagged_in: was.tagged_in, new_tagged_in: now.tagged_in,
      old_inherited: was.inherited, new_inherited: now.inherited,
      name: component.name, status: component.status,
      changed: Boolean(component.changed),
      old_evr: was.evr, new_evr: now.evr,
      old_branch: was.branch, new_branch: now.branch,
      old_ref_kind: was.ref_kind, new_ref_kind: now.ref_kind,
      patches_added: component.patches_added.slice(),
      patches_removed: component.patches_removed.slice(),
      patches_rewritten: component.patches_rewritten.slice(),
      rpms_added: component.rpms_added.slice(),
      rpms_removed: component.rpms_removed.slice(),
      old_patches: patchDicts(old ? (old.patches || []) : []),
      new_patches: patchDicts(fresh ? (fresh.patches || []) : []),
      // выровненные строки «было/стало» вместо двух отдельных списков:
      // так один и тот же подпакет стоит в обеих колонках на одной высоте,
      // и NVRA не дублируются в данных страницы
      rpm_rows: diff.alignRpms(old, fresh),
      old_owner: was.owner, new_owner: now.owner,
      old_completed: was.completed, new_completed: now.completed,
      old_project: was.project, new_project: now.project,
      old_koji_url: was.koji_url, new_koji_url: now.koji_url,
      old_source_url: was.source_url, new_source_url: now.source_url,
      // Ссылки строки — одной стороны, той, что показана в таблице: колонка
      // «ссылки» ведёт к тому билду, о котором строка и рассказывает.
      koji_url: shown ? kojiUrl(kojiWeb, shown.nvr) : null,
      source_url: (shown && shown.source) ? orNull(shown.source.web_url) : null,
      marks: diffMarks(component)
    };
  }
```

- [ ] **Шаг 3: Прогнать JS-сюиту**

```bash
node --test tests/js/viewmodel.test.js
```

Ожидается: всё зелёное, и в первую очередь `данные страницы совпадают с питоновским эталоном`. Этот тест прогоняет данные через `JSON.stringify`/`JSON.parse`, так что `undefined` вместо `null` в любом из двадцати полей он поймает — но только он, и только целиком.

Упало на нём — искать поле, где охрана `orNull` не доехала: `sideOf` обязан вернуть `null`, а не `undefined`, для каждого из десяти значений при `build === null`.

- [ ] **Шаг 4: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

**Ни один тест не правится.**

- [ ] **Шаг 5: Коммит**

```bash
git add dashboard/assets/js/viewmodel.js
git commit -m "Одно правило на обе стороны перехода"
```

---

## Задача 5: `rowsOf` в page.js

Две строки «откуда брать строки текущей вкладки», написанные четырежды.

**Files:**
- Modify: `dashboard/assets/js/page.js` — `filterCounts` (328-341), `knownFilter` (349-362), `visibleRows` (467-474), `totalRows` (476-483)
- Test: `tests/js/page.test.js`

**Interfaces:**
- Consumes: `curPair`, `curSnap`
- Produces: `rowsOf(tab)` — внутренняя

- [ ] **Шаг 1: Завести `rowsOf`**

Перед `filterCounts`:

```js
    /* Строки вкладки. Правило «откуда их брать» одно на четверых —
       счётчики меню, отсев мёртвых фильтров, видимые строки и общее
       число, — и все четверо обязаны спрашивать в одном месте. Вкладка
       приходит доводом: судить приходится и о той, на которой человека
       сейчас нет. */
    function rowsOf(tab) {
      const host = tab === 'diff' ? curPair() : curSnap();
      if (!host) return [];
      return tab === 'diff' ? host.rows : host.builds;
    }
```

- [ ] **Шаг 2: Перевести четверых**

`filterCounts` — было:

```js
      const tab = st.tab;
      const host = tab === 'diff' ? curPair() : curSnap();
      const list = host ? (tab === 'diff' ? host.rows : host.builds) : [];
      const out = {};
```

стало:

```js
      const tab = st.tab;
      const list = rowsOf(tab);
      const out = {};
```

`knownFilter` — было:

```js
      const host = tab === 'diff' ? curPair() : curSnap();
      const rows = host ? (tab === 'diff' ? host.rows : host.builds) : [];
```

стало:

```js
      const rows = rowsOf(tab);
```

`visibleRows` целиком:

```js
    function visibleRows() {
      if (st.tab === 'diff') return pick(rowsOf('diff'), diffMatches, scanDiff);
      return pick(rowsOf('state'), stateMatches, scanState);
    }
```

`totalRows` целиком:

```js
    function totalRows() {
      return rowsOf(st.tab).length;
    }
```

- [ ] **Шаг 3: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

**Ни один тест не правится.** Особое внимание на `page.test.js` и на те тесты `ui.test.js`, что считают строки в счётчике над таблицей: `totalRows` был единственным, кто раньше не звал `curPair()` через общий путь, и подмена там видна сразу.

- [ ] **Шаг 4: Коммит**

```bash
git add dashboard/assets/js/page.js
git commit -m "Один источник строк вкладки вместо четырёх"
```

---

## Задача 6: Вынос `search.js`

Чистый переезд: код не меняется ни одной буквой, меняется только его адрес. Дубль внутри него схлопывает следующая задача — смешивать переезд с правкой нельзя, иначе по диффу не видно ни того ни другого.

**Files:**
- Create: `dashboard/assets/js/search.js`
- Create: `tests/js/search.test.js`
- Modify: `dashboard/assets/js/page.js` (убрать `scanState`/`scanDiff`, принять `search` в `deps`), `dashboard/build.py` (`SCRIPTS`), `dashboard/assets/js/ui.js` (передать `search` в `pagemod.create`)
- Modify: `tests/js/page.test.js` (передать `search` в `pagemod.create`)

**Interfaces:**
- Consumes: `text.has`
- Produces: `KP.search.scanState(row, q)`, `KP.search.scanDiff(row, q)` → `{ show, deep }`
- `page.create(deps)` начинает требовать `deps.search`

- [ ] **Шаг 1: Завести `dashboard/assets/js/search.js`**

Тела `scanState` и `scanDiff` переносятся из `page.js:386-450` **дословно**, вместе со всеми комментариями внутри:

```js
/* Поиск по строке таблицы: совпало ли и достаточно ли этого совпадения,
   чтобы строку не разворачивать.

   Поиск идёт и по видимым полям строки, и по её деталям. Если совпало
   только в деталях, строка не просто остаётся — она сразу разворачивается,
   иначе непонятно, почему она в выдаче.

   Ни состояния страницы, ни DOM здесь нет: строка и запрос приходят
   доводами, а решает, что делать с ответом, page.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.search = factory(root.KP.text);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (text) => {
  'use strict';

  const has = text.has;

  function scanState(row, q) {
    /* …тело из page.js:386-426, дословно… */
  }

  function scanDiff(row, q) {
    /* …тело из page.js:428-450, дословно… */
  }

  return { scanState: scanState, scanDiff: scanDiff };
}));
```

Комментарий-шапка над `scanState` в `page.js` («Поиск идёт и по видимым полям…») переезжает в шапку модуля — он описывает оба, а не одну функцию.

- [ ] **Шаг 2: Убрать их из `page.js`**

Удалить блок `/* ---------- поиск ---------- */` целиком, вместе с обеими функциями. В `create` принять новую зависимость — строка 19-20 была:

```js
    const viewmodel = deps.viewmodel, diffmod = deps.diffmod;
    const store = deps.store, labels = deps.labels, text = deps.text;
```

стала:

```js
    const viewmodel = deps.viewmodel, diffmod = deps.diffmod;
    const store = deps.store, labels = deps.labels, text = deps.text;
    /* Поиск живёт отдельным модулем: он ничего не знает ни о состоянии, ни
       о данных страницы — только о строке и запросе. */
    const scanState = deps.search.scanState, scanDiff = deps.search.scanDiff;
```

`has` из `text` в `page.js` после этого больше не нужен — проверить `grep -n 'has(' dashboard/assets/js/page.js` и убрать его из строки деструктуризации, если не осталось ни одного вызова.

- [ ] **Шаг 3: Передать `search` из `ui.js`**

Было:

```js
  let page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text });
```

стало:

```js
  let page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text,
                              search: searchmod });
```

и `search.js` добавляется в оба списка UMD-обёртки `ui.js` — в `require`-ветку и в `root.KP`-ветку, под именем `searchmod` в списке доводов фабрики (имя с суффиксом `mod`, как у `pagemod`, `railmod`, `filesmod`, потому что короткое `search` в `ui.js` не занято, но занято словом «поиск» в смысле поля ввода — путать их не надо).

- [ ] **Шаг 4: Дописать в `SCRIPTS`**

`dashboard/build.py`, было:

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "labels.js", "hash.js", "page.js", "markup.js",
           "tables.js", "cards.js", "filters.js", "rail.js", "files.js",
           "tips.js", "toasts.js", "ui.js")
```

стало (`search.js` перед `page.js` — тот его зовёт):

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "labels.js", "hash.js", "search.js", "page.js",
           "markup.js", "tables.js", "cards.js", "filters.js", "rail.js",
           "files.js", "tips.js", "toasts.js", "ui.js")
```

- [ ] **Шаг 5: Починить прямые вызовы `pagemod.create`**

```bash
grep -rn 'pagemod.create\|pagemod\.create' tests/js/
```

Каждому дописать `search: require('../../dashboard/assets/js/search.js')`. В `page.test.js` — вместе с остальными `require` в шапке файла.

- [ ] **Шаг 6: Завести `tests/js/search.test.js`**

Тесты поиска, живущие сейчас в `page.test.js`, **переезжают** сюда — те из них, что проверяют само совпадение, а не то, как страница им распоряжается. Найти их:

```bash
grep -n "^test(" tests/js/page.test.js | grep -i "поиск\|ищет\|находит\|разворач"
```

Тест, который проверяет «строка нашлась И развернулась И осталась после смены фильтра», делится: первая половина сюда, вторая остаётся.

Плюс шапка файла:

```js
'use strict';
/* Поиск по строке: совпало ли, и стоит ли ради этого совпадения строку
   разворачивать. Страница здесь не нужна вовсе — на входе строка и
   запрос, на выходе два булевых значения. */
var test = require('node:test');
var assert = require('node:assert');
var search = require('../../dashboard/assets/js/search.js');
```

Плюс один тест, который прямо называет договор модуля:

```js
test('пустой запрос показывает строку и не разворачивает её', function () {
  var out = search.scanState({ name: 'nginx' }, '');
  assert.deepStrictEqual(out, { show: true, deep: false });
});
```

- [ ] **Шаг 7: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: Python столько же, JS столько же плюс один новый тест из Шага 6. Переехавшие тесты считаются один раз — в новом файле; в старом их быть не должно.

- [ ] **Шаг 8: Проверить, что страница собирается**

```bash
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.search' /tmp/check.html
```

Ожидается: код выхода 0 и хотя бы одно совпадение. Забыть про `SCRIPTS` — самая дешёвая из возможных ошибок и самая незаметная: сюиты этого не видят.

- [ ] **Шаг 9: Коммит**

```bash
git add dashboard/assets/js/search.js dashboard/assets/js/page.js \
        dashboard/assets/js/ui.js dashboard/build.py \
        tests/js/search.test.js tests/js/page.test.js
git commit -m "Вынести поиск по строке в свой модуль"
```

---

## Задача 7: Один обход списка патчей

Три копии одного цикла: патчи билда и ghost-патчи в `scanState`, обе стороны диффа в `scanDiff`.

**Files:**
- Modify: `dashboard/assets/js/search.js`
- Test: `tests/js/search.test.js`

**Interfaces:**
- Consumes: `text.has`
- Produces: `patchesHit(list, q)` — внутренняя

- [ ] **Шаг 1: Завести `patchesHit`**

```js
  /* Есть ли совпадение в этом списке патчей: имя, путь, класс или любой из
     CVE. Один обход на три места — патчи билда, ghost-патчи и обе стороны
     диффа. Списки разные, правило одно, и записано оно теперь один раз. */
  function patchesHit(list, q) {
    for (const p of list || []) {
      if (has(p.name, q) || has(p.path, q) || has(p['class'], q)) return true;
      for (const cve of p.cves || []) {
        if (has(cve, q)) return true;
      }
    }
    return false;
  }
```

- [ ] **Шаг 2: Переписать `scanState`**

```js
  function scanState(row, q) {
    if (!q) return { show: true, deep: false };
    /* Видимое в самой строке — мелкое совпадение: разворачивать её незачем,
       человек и так видит, за что она попала в выдачу. Владелец и время
       сборки билда стоят в своих колонках, поэтому они здесь, а не ниже. */
    const shallow = has(row.name, q) || has(row.nvr, q) || has(row.branch, q)
               || has(row.evr, q) || has(row.tagged_in, q)
               || has(row.owner, q) || has(row.completed, q);
    /* Ghost-патчи — то самое место, где живёт «влито в ветку, не собрано»:
       без них запрос по имени CVE не находил бы строку вовсе, хотя вопрос
       дашборда патчей CVE как раз «какие пакеты его ещё ждут». Секция
       ghost-ов лежит в раскрытии, поэтому совпадение здесь тоже глубокое —
       строка обязана открыться, а не просто остаться в выдаче. */
    const deep = has(row.project, q)
              || (row.koji_tags || []).some((t) => has(t, q))
              || patchesHit(row.patches, q)
              || patchesHit(row.ghosts, q)
              || row.rpms.some((r) => has(r, q))
              || row.problems.some((p) => has(p, q));
    return { show: shallow || deep, deep: !shallow && deep };
  }
```

`||` и `.some` останавливаются на первом совпадении ровно так же, как останавливались сегодняшние `!deep &&` в условиях циклов: ни одного лишнего обхода не появляется.

- [ ] **Шаг 3: Переписать `scanDiff`**

```js
  function scanDiff(row, q) {
    if (!q) return { show: true, deep: false };
    const shallow = has(row.name, q) || has(row.old_evr, q)
                 || has(row.new_evr, q);
    const deep = has(row.old_branch, q) || has(row.new_branch, q)
              || has(row.old_tagged_in, q) || has(row.new_tagged_in, q)
              || patchesHit(row.old_patches, q)
              || patchesHit(row.new_patches, q)
              || row.rpm_rows.some((pair) => (pair[0] && has(pair[0], q))
                                          || (pair[1] && has(pair[1], q)));
    return { show: shallow || deep, deep: !shallow && deep };
  }
```

- [ ] **Шаг 4: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

**Ни один тест не правится.** Это главная проверка задачи: обход переписан целиком, и если хоть одно поле выпало из перебора, существующие тесты поиска это ловят.

- [ ] **Шаг 5: Дописать тест на общий обход**

Он не для того, чтобы что-то поймать сейчас, а для того, чтобы правило осталось одним:

```js
test('CVE ищется одинаково в патчах билда и в ghost-патчах', function () {
  var found = { name: 'x.patch', path: 'PATCH/x.patch', 'class': 'CVE',
                cves: ['CVE-2026-3011'] };
  var byPatch = search.scanState(
    { patches: [found], ghosts: [], rpms: [], problems: [] },
    'cve-2026-3011');
  var byGhost = search.scanState(
    { patches: [], ghosts: [found], rpms: [], problems: [] },
    'cve-2026-3011');
  assert.deepStrictEqual(byPatch, byGhost);
  assert.deepStrictEqual(byPatch, { show: true, deep: true });
});
```

- [ ] **Шаг 6: Прогнать ещё раз и закоммитить**

```bash
node --test tests/js/*.test.js
git add dashboard/assets/js/search.js tests/js/search.test.js
git commit -m "Один обход списка патчей вместо трёх"
```

---

## Задача 8: Один источник правила «переписан»

Вердикт «путь тот же, содержимое другое» считается в `diff.js` и **заново выводится** в `markup.js`. Разметка перестаёт его выводить и начинает принимать.

**Files:**
- Modify: `dashboard/assets/js/markup.js:210-244`
- Modify: `dashboard/assets/js/tables.js:257-258`
- Test: `tests/js/markup.test.js`

**Interfaces:**
- Consumes: `row.patches_rewritten` — список путей, который `viewmodel.diffRow` пишет с 2.3.0 и который до сих пор не читал никто
- Produces: `markup.patchesChangeHtml(oldPatches, newPatches, rewritten, q)` — **сигнатура меняется**, третьим доводом встаёт список путей

- [ ] **Шаг 1: Написать падающий тест**

В `tests/js/markup.test.js`:

```js
/* Правило «переписан» живёт в diff.js и только там. Разметка красит то,
   что ей сказали: патч с разными sha, которого нет в списке, остаётся
   непомеченным, а патч из списка помечается, какими бы ни были его sha.
   Иначе правило снова окажется записанным дважды. */
test('переписанные приходят списком, а не выводятся заново', function () {
  var was = [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
               cves: [], url: null, sha: 'aaa' }];
  var now = [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
               cves: [], url: null, sha: 'bbb' }];
  labels.setClasses(['CVE']);

  var silent = markup.patchesChangeHtml(was, now, [], '');
  assert.doesNotMatch(silent, /is-rewritten/,
    'sha разные, но списка нет — разметка не имеет права решать сама');

  var told = markup.patchesChangeHtml(was, now, ['PATCH/a.patch'], '');
  assert.match(told, /is-rewritten/);
  assert.match(told, /class="sign">~/);
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/markup.test.js
```

Ожидается: падает первая проверка — сегодня разметка выводит вердикт сама и пометит патч без всякого списка.

- [ ] **Шаг 3: Переписать `patchesChangeHtml`**

Меняются сигнатура, начало тела и один комментарий. Было:

```js
  function patchesChangeHtml(oldPatches, newPatches, q) {
    const inNew = {}, inOld = {};
    for (const p of newPatches) inNew[p.path] = p;
    for (const p of oldPatches) inOld[p.path] = p;
    const items = [];
    for (const p of oldPatches) {
      const kept = own(inNew, p.path);
      /* Уцелевший берём из нового состояния: класс или ссылка могли
         поменяться, и показывать надо то, что есть сейчас. */
      /* Переписанный — тот же путь и другое содержимое. Обе sha должны
         быть известны: снапшоты до 2.3.0 их не несут, и метить патч по
         одной стороне значило бы объявить переписанным то, чего мы не
         сравнивали. */
      const rewritten = Boolean(kept && p.sha && kept.sha
                                && p.sha !== kept.sha);
      items.push({ p: kept || p,
                   cls: kept ? (rewritten ? 'is-rewritten' : '')
                             : 'is-removed' });
    }
```

Стало:

```js
  function patchesChangeHtml(oldPatches, newPatches, rewritten, q) {
    const inNew = {}, inOld = {}, redone = {};
    for (const p of newPatches) inNew[p.path] = p;
    for (const p of oldPatches) inOld[p.path] = p;
    /* Переписанные приходят готовым списком путей. Правило «путь тот же,
       содержимое другое, и обе sha известны» живёт в diff.js — вместе с
       оговоркой про снапшоты до 2.3.0, которые sha не несут, — и должно
       жить там одно. Разметка красит то, что ей сказали, ровно как она уже
       поступает с «пришёл» и «ушёл»: выводя вердикт заново, она держала бы
       вторую запись того же правила, и разошлись бы они молча.

       own(), а не прямое обращение: ключи здесь — пути из GitLab, и путь
       вида PATCH/constructor у голого объекта ответил бы функцией. */
    for (const path of rewritten || []) redone[path] = 1;
    const items = [];
    for (const p of oldPatches) {
      const kept = own(inNew, p.path);
      /* Уцелевший берём из нового состояния: класс или ссылка могли
         поменяться, и показывать надо то, что есть сейчас. */
      items.push({ p: kept || p,
                   cls: kept ? (own(redone, p.path) ? 'is-rewritten' : '')
                             : 'is-removed' });
    }
```

Остальное тело — от `for (const p of newPatches)` и ниже — не трогается.

- [ ] **Шаг 4: Передать список из `tables.js`**

`diffDetail`, было:

```js
      + sideBlock('патчи', row.new_patches.length,
                  markup.patchesChangeHtml(row.old_patches, row.new_patches, q))
```

стало:

```js
      + sideBlock('патчи', row.new_patches.length,
                  markup.patchesChangeHtml(row.old_patches, row.new_patches,
                                           row.patches_rewritten || [], q))
```

`|| []` по той же причине, что и у `row.ghosts` двумя блоками ниже: данные страницы приходят из файла, который выбрал человек.

- [ ] **Шаг 5: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Существующие тесты `markup.test.js`, зовущие `patchesChangeHtml` с тремя доводами, **придётся поправить** — у функции изменилась сигнатура, и это единственная задача плана, где правка тестов законна. Найти их:

```bash
grep -n 'patchesChangeHtml' tests/js/*.test.js
```

Каждому дописать третьим доводом список путей: `[]` там, где тест про приход и уход, и настоящий список там, где тест был про переписанные.

- [ ] **Шаг 6: Коммит**

```bash
git add dashboard/assets/js/markup.js dashboard/assets/js/tables.js \
        tests/js/markup.test.js
git commit -m "Правило «переписан» живёт в одном месте"
```

---

## Задача 9: Три исхода в колонке «Δ патчей»

Единственное видимое изменение всей работы.

**Files:**
- Modify: `dashboard/assets/js/markup.js:372-376` (`delta`)
- Modify: `dashboard/assets/js/tables.js:276-277`
- Modify: `dashboard/assets/js/page.js:513` (`sortValue`, ключ `dpatch`)
- Modify: `dashboard/assets/css/table.css:93-94`
- Modify: `dashboard/assets/dashboard.html:79`
- Test: `tests/js/markup.test.js`, `tests/js/tables.test.js`, `tests/js/page.test.js`

**Interfaces:**
- Consumes: `row.patches_rewritten`
- Produces: `markup.delta(added, removed, rewritten)` — третий довод необязателен; при двух доводах разметка обязана выйти байт в байт прежней

- [ ] **Шаг 1: Написать падающие тесты**

`tests/js/markup.test.js`:

```js
/* Третий довод строго дописывается: той же delta рисуется колонка Δ RPM,
   где третьего исхода не бывает и не будет, и любая правка её разметки
   поехала бы вместе с этой. */
test('delta с двумя доводами даёт ровно то же, что и раньше', function () {
  assert.strictEqual(markup.delta(0, 0), '<span class="zero">—</span>');
  assert.strictEqual(markup.delta(1, 0), '<span class="plus">+1</span> ');
  assert.strictEqual(markup.delta(0, 1), '<span class="minus">−1</span>');
  assert.strictEqual(markup.delta(1, 1),
    '<span class="plus">+1</span> <span class="minus">−1</span>');
});

test('delta показывает переписанные третьим знаком', function () {
  assert.strictEqual(markup.delta(0, 0, 2), '<span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(0, 1, 2),
    '<span class="minus">−1</span> <span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(1, 0, 2),
    '<span class="plus">+1</span> <span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(1, 1, 2),
    '<span class="plus">+1</span> <span class="minus">−1</span>'
    + ' <span class="tilde">~2</span>');
});
```

`tests/js/page.test.js` — сортировка. Помощники `make`, `snap`, `build`, `patch` в этом файле уже есть; `patch()` возвращает патч без `sha`, поэтому его дописываем:

```js
test('сортировка по Δ патчей считает и переписанные', function () {
  /* Компонент, у которого переписан единственный патч, раньше стоял в
     колонке с прочерком и по ней же уезжал вниз — то есть ровно тот
     случай, ради которого 2.3.0 и делалась, из колонки не читался. */
  function withSha(sha) {
    var p = patch('CVE-2026-3011.patch', 'CVE');
    p.sha = sha;
    return p;
  }
  var was = snap('os-9.1', JUL, { builds: [
    build('nginx', { patches: [withSha('aaa')] }),
    build('httpd', { patches: [] }) ] });
  var now = snap('os-9.2', AUG, { builds: [
    build('nginx', { patches: [withSha('bbb')] }),
    build('httpd', { patches: [] }) ] });
  var p = make([was, now]);
  p.st.tab = 'diff';
  /* Снимаем умолчание «только изменившиеся»: неизменившийся httpd нужен в
     таблице именно затем, чтобы было с чем сравнивать порядок. */
  p.toggleFilter('all');
  p.sortBy('dpatch');            /* по возрастанию */
  p.sortBy('dpatch');            /* второй клик по той же — по убыванию */
  var order = p.sortRows(p.visibleRows()).map(function (i) {
    return i.row.name;
  });
  assert.deepStrictEqual(order, ['nginx', 'httpd']);
});
```

Тест обязан падать до правки, и падать осмысленно: сегодня у обоих `dpatch` равен нулю, ничью разрешает имя, и первым встаёт `httpd`. Увидели `['nginx', 'httpd']` до Шага 5 — значит тест меряет не то.

Проверить перед написанием, что помощник `snap` в этом файле принимает `{ builds: [...] }` (`sed -n '/^function snap/,/^}/p' tests/js/page.test.js`); если ключ зовётся иначе — использовать тот, что есть, а не переделывать помощника.

`tests/js/tables.test.js`. Помощник `diffRow` в этом файле поля `patches_rewritten` не несёт — его надо дописать туда, чтобы подставная строка совпадала по форме с настоящей из `viewmodel.diffRow`:

```js
           patches_added: [], patches_removed: [],
           patches_rewritten: over.patches_rewritten || [],
```

и сам тест:

```js
test('колонка Δ патчей показывает три исхода, Δ RPM — два', function () {
  var row = diffRow({ patches_rewritten: ['PATCH/c.patch'] });
  row.patches_added = ['PATCH/a.patch'];
  row.patches_removed = ['PATCH/b.patch'];
  row.rpms_added = ['nginx-1.24.0-4.el9.x86_64'];
  row.rpms_removed = ['nginx-1.24.0-3.el9.x86_64'];
  var out = tables.diffRows([{ row: row, open: false }], opts());
  var cells = out.match(/<td class="pat">.*?<\/td>/g);
  assert.strictEqual(cells.length, 2);
  assert.match(cells[0], /tilde">~1</);
  /* У пакетов третьего исхода нет и не будет: сравнивать в них нечего. */
  assert.doesNotMatch(cells[1], /tilde/);
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/markup.test.js tests/js/tables.test.js tests/js/page.test.js
```

- [ ] **Шаг 3: Научить `delta` третьему исходу**

Было:

```js
  function delta(added, removed) {
    if (!added && !removed) return '<span class="zero">—</span>';
    return (added ? `<span class="plus">+${added}</span> ` : '')
         + (removed ? `<span class="minus">−${removed}</span>` : '');
  }
```

Стало:

```js
  /* Третий исход дописывается, а не переписывает первые два: этой же
     функцией рисуется колонка Δ RPM, где переписанных не бывает — у
     пакетов нет содержимого, которое можно сравнить, — и вызов с двумя
     доводами обязан дать ровно прежнюю строку.

     Цвет тот же янтарный, что у переписанного патча в списке «стало», у
     «сменил ветку» и у «ветка +N»: на этой странице он значит
     «разъехалось, но ничего не потеряно», и третья легенда тут не нужна. */
  function delta(added, removed, rewritten) {
    if (!added && !removed && !rewritten) return '<span class="zero">—</span>';
    return (added ? `<span class="plus">+${added}</span> ` : '')
         + (removed ? `<span class="minus">−${removed}</span>` : '')
         + (rewritten
              ? `${removed ? ' ' : ''}<span class="tilde">~${rewritten}</span>`
              : '');
  }
```

Разделитель перед `~` ставится только когда слева стоял `−`: у `+` пробел уже свой, в хвосте его куска.

- [ ] **Шаг 4: Передать число из `tables.js`**

`diffRows`, было:

```js
        + `<td class="pat">${markup.delta(row.patches_added.length,
                                          row.patches_removed.length)}</td>`
```

стало:

```js
        + `<td class="pat">${markup.delta(row.patches_added.length,
                                          row.patches_removed.length,
                                          (row.patches_rewritten || []).length)}</td>`
```

Ячейка Δ RPM строкой ниже **не трогается**.

- [ ] **Шаг 5: Научить сортировку**

`page.js`, `sortValue`, было:

```js
        if (key === 'dpatch') return row.patches_added.length + row.patches_removed.length;
```

стало:

```js
        if (key === 'dpatch') {
          return row.patches_added.length + row.patches_removed.length
               + (row.patches_rewritten || []).length;
        }
```

- [ ] **Шаг 6: Завести `.tilde`**

`dashboard/assets/css/table.css`, рядом с соседями:

```css
.plus { color: var(--added); }
.minus { color: var(--removed); }
/* Переписанный патч: тот же янтарный, что у .is-rewritten в списке «стало»
   и у «ветка +N». Значит он здесь то же самое — разъехалось, но ничего не
   потеряно. */
.tilde { color: var(--major); }
```

Проверить, что `--major` и правда объявлен: `grep -n '\-\-major' dashboard/assets/css/base.css`.

- [ ] **Шаг 7: Переписать подсказку колонки**

`dashboard/assets/dashboard.html:79`. Было:

```
data-tip="Сколько файлов патчей пришло и ушло. Сортировка — по сумме пришедших и ушедших: сверху компоненты, у которых стек патчей менялся сильнее всего."
```

Стало:

```
data-tip="Сколько файлов патчей пришло, ушло и переписано под тем же именем. Сортировка — по сумме трёх: сверху компоненты, у которых стек патчей менялся сильнее всего. Переписанные видны только у пары снапшотов, собранных начиная с 2.3.0."
```

Последнее предложение — не украшение: без него прочерк в колонке у старой пары читался бы как «ничего не переписывали», хотя значит «не сравнивали».

- [ ] **Шаг 8: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается зелёное всё, включая тесты Задачи 8. Особое внимание на тесты, которые сверяют разметку ячейки Δ RPM: они обязаны остаться нетронутыми.

- [ ] **Шаг 9: Посмотреть глазами**

```bash
python3 -m dashboard page -o /tmp/check.html
```

Открыть, подгрузить `tests/fixtures/rich-drift.json` и `rich-caught-up.json`, встать на «Изменения» и найти nginx: у него переписан `nginx-distsuffix.patch`. В колонке должен стоять янтарный `~1` рядом с зелёным `+1`.

- [ ] **Шаг 10: Коммит**

```bash
git add dashboard/assets/js/markup.js dashboard/assets/js/tables.js \
        dashboard/assets/js/page.js dashboard/assets/css/table.css \
        dashboard/assets/dashboard.html tests/js/
git commit -m "Δ патчей считает три исхода"
```

---

## Задача 10: Вынос `copy.js`

**Files:**
- Create: `dashboard/assets/js/copy.js`, `tests/js/copy.test.js`
- Modify: `dashboard/assets/js/ui.js:319-369, 501`, `dashboard/build.py`

**Interfaces:**
- Consumes: `deps.button` — узел кнопки; `deps.rowsOf()` → массив **самих строк**, уже отсортированных и отфильтрованных (разворачивать пары `{row, open}` — дело корня, который их и завёл)
- Produces: `KP.copy.create(deps) -> { copy }`

- [ ] **Шаг 1: Завести `dashboard/assets/js/copy.js`**

```js
/* Список NVR видимых строк в буфер обмена. Владеет кнопкой и таймером её
   подписи; строки приходят доводом — какие из них видны, знает страница.

   Про page здесь не знают ничего: на входе список строк, на выходе текст в
   буфере и подпись на кнопке. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.copy = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const FLASH = 1400;

  function create(deps) {
    const button = deps.button, rowsOf = deps.rowsOf;

    /* Подпись берём один раз при загрузке: если запомнить текущую, то
       второй клик подряд запомнит «Скопировано» и вернёт кнопку к нему
       навсегда. */
    const LABEL = button.textContent;
    let timer = null;

    /* NVR диффа собирается из имени и evr: evr — это
       «epoch:version-release», а в NVR эпохи нет, поэтому ведущее «N:»
       отбрасываем. */
    function nvrOf(row) { /* …тело из ui.js:323-327 дословно… */ }

    function flash(text) {
      button.textContent = text;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        button.textContent = LABEL;
      }, FLASH);
      /* В node таймер держит процесс живым, и сюита досиживала бы полторы
         секунды на каждом тесте копирования. В браузере setTimeout отдаёт
         число, у которого unref нет, и строка ничего не делает. Так же
         поступает toasts.js — по той же причине. */
      if (timer && timer.unref) timer.unref();
    }

    function fallback(text) { /* …тело copyFallback из ui.js:343-355,
                                  flash() уже свой… */ }

    function copy() { /* …тело copyNvr из ui.js:357-369, с правкой из
                          абзаца ниже… */ }

    button.addEventListener('click', copy);

    return { copy: copy };
  }

  return { create };
}));
```

Две правки при переезде, обе вынужденные:

`copyNvr` начинается со строки `let items = sortRows(visibleRows()), lines = [], i;` — здесь она становится `let items = rowsOf(), lines = [], i;`, и `items[i].row` становится `items[i]`: разворачивать пары `{row, open}` теперь дело корня.

`flash` обзавёлся `unref` (см. комментарий в коде выше). В `ui.js` его не было, потому что в браузере таймер никого не держит, а тестов у копирования не было вовсе.

- [ ] **Шаг 2: Убрать это из `ui.js`**

Удалить весь блок `/* ---------- копирование ---------- */` (строки 319-369) и строку `copyBtn.addEventListener('click', copyNvr);`. Вместо этого — рядом с остальными владельцами участков:

```js
  const copier = copymod.create({
    button: copyBtn,
    rowsOf: () => sortRows(visibleRows()).map((item) => item.row) });
```

Имя `copier`, а не `copy`: словом «copy» зовётся то, что делают, и локальная переменная с этим именем читалась бы как глагол.

Проверить, что `copyBtn.disabled = !items.length;` в `render()` остаётся на месте: кнопкой владеет копирование, но её доступность зависит от того, есть ли что копировать, и знает это только корень.

- [ ] **Шаг 3: `SCRIPTS` и UMD-обёртка `ui.js`**

`copy.js` дописывается в `SCRIPTS` между `toasts.js` и `ui.js`; в `ui.js` — в обе ветки обёртки, доводом `copymod`.

- [ ] **Шаг 4: Завести `tests/js/copy.test.js`**

Копирование сегодня не покрыто ничем — заглушка DOM прямо об этом говорит («…лишь в копировании NVR, которое заглушкой не проверяется»). Значит это **новые** тесты, а не переезд.

**Ловушка, из-за которой тест мог бы позеленеть не по той причине.** На Node 22 `navigator` — свойство `globalThis` с геттером, и `globalThis.navigator = {...}` в нестрогом режиме **молча ничего не делает**: присваивание проваливается без ошибки. Подмена, сделанная так, не сработала бы, `copy()` ушёл бы в запасной путь через `document.execCommand`, и тест проверял бы совсем не то, что написано в его имени. Подменять только через `Object.defineProperty` (проверено: `configurable: true`).

```js
'use strict';
/* Список NVR видимых строк. Ни страницы, ни заглушки DOM здесь не нужно:
   кнопка и буфер подделываются в несколько строк. */
var test = require('node:test');
var assert = require('node:assert');
var copymod = require('../../dashboard/assets/js/copy.js');

function fakeButton() {
  return { textContent: 'Копировать NVR',
           addEventListener: function () {} };
}

/* navigator на Node 22 — свойство с геттером: простое присваивание молча
   не срабатывает, и подмена оказалась бы мнимой. Только defineProperty. */
function withClipboard(fn) {
  var wrote = [];
  var had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: function (text) {
      wrote.push(text);
      return Promise.resolve();
    } } } });
  try {
    fn(wrote);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

function copier(rows) {
  return copymod.create({ button: fakeButton(),
                          rowsOf: function () { return rows; } });
}

test('строка состояния отдаёт свой nvr как есть', function () {
  withClipboard(function (wrote) {
    copier([{ name: 'nginx', nvr: 'nginx-1.24.0-3.el9' }]).copy();
    assert.deepStrictEqual(wrote, ['nginx-1.24.0-3.el9']);
  });
});

test('NVR диффовой строки собирается из имени и версии без эпохи',
  function () {
    /* У строки «Изменений» своего nvr нет — только evr вида 1:1.24.0-4.el9,
       а в NVR эпохи не бывает. */
    withClipboard(function (wrote) {
      copier([{ name: 'nginx', new_evr: '1:1.24.0-4.el9' }]).copy();
      assert.deepStrictEqual(wrote, ['nginx-1.24.0-4.el9']);
    });
  });

test('строки уезжают в буфер по одной на строку', function () {
  withClipboard(function (wrote) {
    copier([{ nvr: 'a-1-1.el9' }, { nvr: 'b-2-1.el9' }]).copy();
    assert.deepStrictEqual(wrote, ['a-1-1.el9\nb-2-1.el9']);
  });
});

test('без строк в буфер не уходит ничего', function () {
  withClipboard(function (wrote) {
    copier([]).copy();
    assert.deepStrictEqual(wrote, []);
  });
});
```

Запасной путь (`document.execCommand`) этими тестами не проверяется и заглушки `document` не требует: во всех четырёх буфер отвечает успехом. Захочется проверить и его — подменять `document` тем же способом и отдельным тестом, а не дописывать заглушку ко всем.

- [ ] **Шаг 5: Прогнать, собрать страницу, закоммитить**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.copy' /tmp/check.html
git add dashboard/assets/js/copy.js dashboard/assets/js/ui.js \
        dashboard/build.py tests/js/copy.test.js
git commit -m "Вынести копирование NVR в свой модуль"
```

---

## Задача 11: Вынос `viewport.js`

**Files:**
- Create: `dashboard/assets/js/viewport.js`, `tests/js/viewport.test.js`
- Modify: `dashboard/assets/js/ui.js:531-569`, `545`, `dashboard/build.py`
- Modify: `tests/js/ui.test.js` (тесты «наверх» уезжают)

**Interfaces:**
- Consumes: `deps.controls`, `deps.toTop`, `deps.onResize` — пересчёт ширины карточек; мерить раскладку умеет только тот, у кого есть узлы рядов
- Produces: `KP.viewport.create(deps)` — наружу ничего

- [ ] **Шаг 1: Завести `dashboard/assets/js/viewport.js`**

Забирает: `syncStickyOffset`, блок с `ResizeObserver`, `window.addEventListener('resize', fitAllCards)`, `syncToTop`, обработчик клика по кнопке «наверх», `window.addEventListener('scroll', syncToTop)` и вызов `syncToTop()` из `start()`.

```js
/* Реакции на размер и прокрутку окна: высота липкой шапки и кнопка
   «наверх». Владеет своими слушателями; наружу не отдаёт ничего — звать
   этот модуль неоткуда, он сам слушает окно.

   Про карточки здесь не знают: пересчитать их ширину умеет только тот, у
   кого есть узлы рядов, поэтому пересчёт приходит доводом onResize. */
(function (root, factory) { /* …как у остальных, имя KP.viewport… */ }(
  /* … */ () => {
  'use strict';

  function create(deps) {
    const controls = deps.controls, toTop = deps.toTop;
    const onResize = deps.onResize || function () {};

    function syncStickyOffset() { /* …из ui.js:533-537 дословно… */ }

    /* Порог — высота окна, а не круглое число точек: «ниже первого экрана»
       человек видит глазами, а «ниже шестисот точек» ни о чём не говорит и
       на разных окнах срабатывает по-разному. */
    function syncToTop() { /* …из ui.js:554-556… */ }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(syncStickyOffset).observe(controls);
    } else {
      window.addEventListener('resize', syncStickyOffset);
    }
    /* Ширина карточки посчитана от ширины окна и переживает её изменение не
       сама: окно сузили — в строку влезает меньше, и делить надо заново. */
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', syncToTop);

    toTop.addEventListener('click', () => { /* …из ui.js:558-567… */ });

    syncStickyOffset();
    /* Браузер восстанавливает прокрутку при перезагрузке, и страница может
       открыться уже внизу — тогда кнопка нужна сразу, не дожидаясь, пока
       человек тронет колесо. */
    syncToTop();
  }

  return { create };
}));
```

Оба стартовых вызова (`syncStickyOffset()` и `syncToTop()`) переезжают сюда из `start()` в `ui.js` — модуль, который сам слушает окно, обязан и стартовое состояние поставить сам.

- [ ] **Шаг 2: Убрать это из `ui.js`**

Удалить блоки `/* ---------- «липкая» шапка ---------- */` и `/* ---------- кнопка «наверх» ---------- */` целиком, а также строки `syncStickyOffset();` и `syncToTop();` из `start()`. Вместо них — рядом с владельцами участков:

```js
  viewportmod.create({ controls: controls, toTop: document.getElementById('totop'),
                       onResize: fitAllCards });
```

Строка `const toTop = document.getElementById('totop');` из `ui.js` уходит: узел теперь нужен только модулю.

- [ ] **Шаг 3: Перевезти тесты**

Из `tests/js/ui.test.js` уезжают три теста, стоящие подряд вместе со своим комментарием (сейчас это строки ~1602-1628):

- `кнопка «наверх» прячется на нетронутой странице`
- `кнопка «наверх» появляется ниже первого экрана и уходит обратно`
- `щелчок по кнопке «наверх» поднимает страницу`

Они держатся на заглушке DOM (`dom.fireWindow('scroll')`, `dom.window.pageYOffset`), поэтому `viewport.test.js` поднимает `domstub.js` так же, как это делает `ui.test.js`, но создаёт **только** `viewport.create`, а не весь `ui.js`. Шапка:

```js
'use strict';
/* Кнопка «наверх» и высота липкой шапки. Заглушка DOM здесь нужна — без
   окна с прокруткой проверять нечего, — а вот вся страница нет. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var viewportmod = require('../../dashboard/assets/js/viewport.js');
```

Липкая шапка сегодня не покрыта ничем; дописать один тест на то, что модуль ставит `--controls-h` при создании, — заглушка `style.setProperty` для этого уже есть в `domstub.js` (пустая функция; подменить её на запоминающую прямо в тесте).

- [ ] **Шаг 4: Прогнать, собрать, закоммитить**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.viewport' /tmp/check.html
git add dashboard/assets/js/viewport.js dashboard/assets/js/ui.js \
        dashboard/build.py tests/js/viewport.test.js tests/js/ui.test.js
git commit -m "Вынести реакции на окно в свой модуль"
```

Число тестов JS обязано остаться прежним плюс новый про липкую шапку: три переехавших считаются один раз.

---

## Задача 12: Вынос `address.js`

Самая тонкая из четырёх: переезжает не код, а состояние — два замка, по которым страница отличает свою запись в адресе от чужой.

**Files:**
- Create: `dashboard/assets/js/address.js`, `tests/js/address.test.js`
- Modify: `dashboard/assets/js/ui.js:64-67, 238, 292-317, 503-506, 637`, `dashboard/build.py`

**Interfaces:**
- Consumes: `deps.page` (`hashParts`, `restore`), `deps.hash` (`format`, `parse`), `deps.dom.search`, `deps.dom.clear`, `deps.onExternal` — что делать со ссылкой, приехавшей снаружи
- Produces: `KP.address.create(deps) -> { write, read, isOurs }`

- [ ] **Шаг 1: Завести `dashboard/assets/js/address.js`**

```js
/* Владение адресной строкой: когда её читать и когда писать.

   Формат строки знает hash.js и не знает ничего про страницу; здесь
   наоборот — про формат не знают вовсе, зато знают, чей сейчас адрес.
   Замок нужен ровно затем, чтобы отличить собственную запись от чужой, и
   держать его в одном месте, а единственного его читателя в другом
   значило бы приглашать расхождение — потому слушатель hashchange живёт
   здесь же. */
(function (root, factory) { /* …как у остальных, имя KP.address… */ }(
  /* … */ () => {
  'use strict';

  function create(deps) {
    const page = deps.page, hash = deps.hash;
    const search = deps.dom.search, clear = deps.dom.clear;
    const onExternal = deps.onExternal;

    let locked = false;
    /* Писала ли страница адрес сама. С этого мгновения location.hash — её
       собственное эхо, а не то, с чем её открыли. */
    let ours = false;

    function write() { /* …тело writeHash из ui.js:294-306, hashIsOurs → ours,
                          hashLock → locked… */ }

    function read() { /* …тело readHash из ui.js:308-317, st.q → page.st.q,
                         clearBtn → clear… */ }

    window.addEventListener('hashchange', () => {
      if (locked) return;
      if (read()) onExternal();
    });

    return { write: write, read: read, isOurs: () => ours };
  }

  return { create };
}));
```

В `readHash` сегодня стоит `search.value = st.q;` — здесь это `search.value = page.st.q;`.

- [ ] **Шаг 2: Убрать это из `ui.js`**

Удалить: объявления `hashLock`/`hashIsOurs` (строки 64-67), блок `/* ---------- состояние в адресной строке ---------- */` (292-317) и слушатель `hashchange` (503-506).

Завести модуль рядом с остальными владельцами участков:

```js
  const address = addressmod.create({
    page: page, hash: hash, dom: { search: search, clear: clearBtn },
    /* Ссылка, присланная позже, — это смена всего сразу: вкладки, выбора,
       фильтров. Что после неё перерисовать, знает корень. */
    onExternal: () => { page.dropDeadFilters(); showTab(st.tab); rebuild(); } });
```

Два места зовут его наружу. В `render()`, последняя строка, было `writeHash();` — стало `address.write();`. В `applyData`, было:

```js
    /* Адрес читаем, только пока он чужой — тот, с которым страницу открыли.
       Дальше в нём лежит наша же прошлая запись, и она вернула бы прежний
       выбор в обход picked, снова похоронив умолчание. Ссылку, присланную
       позже, приносит hashchange. */
    if (!hashIsOurs) readHash();
```

стало:

```js
    /* Адрес читаем, только пока он чужой — тот, с которым страницу открыли.
       Дальше в нём лежит наша же прошлая запись, и она вернула бы прежний
       выбор в обход picked, снова похоронив умолчание. Ссылку, присланную
       позже, приносит hashchange внутри address. */
    if (!address.isOurs()) address.read();
```

**Порядок объявлений здесь решает**: `address` создаётся до первого вызова `applyData`, но `onExternal` замыкается на `showTab` и `rebuild`, объявленные выше через `function` — их подъём это покрывает. Проверить, что `address` объявлен раньше строки `store.onChange(...)`.

- [ ] **Шаг 3: `SCRIPTS` и обёртка**

`address.js` — в `SCRIPTS` между `toasts.js` и `ui.js`, доводом `addressmod` в обе ветки обёртки `ui.js`.

- [ ] **Шаг 4: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Тесты адреса в `ui.test.js` (`в адресе у снапшота стоит и тег, и время сбора`, `пары одинаковых тегов различимы в адресе`, `переключатель группы уезжает в адрес`, короткая форма адреса около строки 1792) **остаются на месте**: они проверяют круговой ход через всю страницу — состояние уехало в адрес и вернулось, — и это работа корня, а не одного модуля.

- [ ] **Шаг 5: Завести `tests/js/address.test.js`**

Только то, чем владеет сам модуль и что через страницу не видно, — оба замка:

```js
'use strict';
/* Владение адресной строкой. Круговой ход «состояние уехало в адрес и
   вернулось» проверяется через всю страницу в ui.test.js; здесь — только
   два замка, которых оттуда не видно. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var hash = require('../../dashboard/assets/js/hash.js');
var addressmod = require('../../dashboard/assets/js/address.js');

/* Страница подставная: адресу от неё нужны ровно три вещи. */
function fakePage(restored) {
  return {
    st: { q: '' },
    hashParts: function () {
      return { tab: 'state', tag: 'os-9.2@2026-08-01T00:00:00+03:00',
               pair: null, filters: [], any: [], q: '',
               sort: { key: 'name', asc: true } };
    },
    restore: function (parsed) { if (restored) restored.push(parsed); }
  };
}

function make(dom, over) {
  over = over || {};
  return addressmod.create({
    page: over.page || fakePage(), hash: hash,
    dom: { search: dom.id('q'), clear: dom.id('q-clear') },
    onExternal: over.onExternal || function () {} });
}

test('своя запись в адрес не будит чтение обратно', function () {
  var dom = domstub.install();
  var external = 0;
  var addr = make(dom, { onExternal: function () { external += 1; } });
  addr.write();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 0, 'страница прочитала собственное эхо');
});

test('замок снимается, и следующая чужая ссылка проходит', async function () {
  /* Замок живёт до конца текущей макрозадачи: он про одну свою запись, а
     не про всё оставшееся время жизни страницы. */
  var dom = domstub.install();
  var external = 0;
  var addr = make(dom, { onExternal: function () { external += 1; } });
  addr.write();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 0);
  await dom.tick();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 1, 'замок остался закрытым навсегда');
});

test('чужой hashchange доходит до восстановления', function () {
  var dom = domstub.install({ hash: '#tab=state&f=&sort=name' });
  var restored = [], external = 0;
  make(dom, { page: fakePage(restored),
              onExternal: function () { external += 1; } });
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 1);
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].tab, 'state');
});

test('isOurs становится правдой только после своей записи', function () {
  var dom = domstub.install({ hash: '#tab=state&f=&sort=name' });
  var addr = make(dom);
  assert.strictEqual(addr.isOurs(), false,
                     'адрес пока тот, с которым страницу открыли');
  addr.write();
  assert.strictEqual(addr.isOurs(), true);
});
```

Второй тест асинхронный: замок снимается через `setTimeout(..., 0)`, а `dom.tick()` в заглушке ждёт ровно макрозадачу.

Перед написанием проверить, что `history.replaceState` в `domstub.js` и правда записывает адрес в `location.hash` (`sed -n '/var history/,/};/p' tests/js/domstub.js`). Второй тест держится на этом: без записи `read()` на втором `hashchange` увидит пустой адрес, вернёт `false`, и `onExternal` не позовут — тест упадёт с виду на замке, а на деле на заглушке. Не записывает — дописать заглушке запись, это её работа.

- [ ] **Шаг 6: Собрать и закоммитить**

```bash
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.address' /tmp/check.html
git add dashboard/assets/js/address.js dashboard/assets/js/ui.js \
        dashboard/build.py tests/js/address.test.js
git commit -m "Вынести владение адресной строкой в свой модуль"
```

---

## Задача 13: Вынос `notices.js`

**Files:**
- Create: `dashboard/assets/js/notices.js`, `tests/js/notices.test.js`
- Modify: `dashboard/assets/js/ui.js:587-625`, `dashboard/build.py`
- Modify: `tests/js/ui.test.js` (тесты предупреждений уезжают)

**Interfaces:**
- Consumes: `deps.store` (`list`, `warnings`), `deps.toasts` (`show`)
- Produces: `KP.notices.create(deps) -> { sync }`

- [ ] **Шаг 1: Завести `dashboard/assets/js/notices.js`**

Забирает `shownWarnings`, `shownStock`, `stockOf` и всю середину `renderSources` — кроме `rail.render()`.

```js
/* Какие предупреждения хранилища человеку ещё не показывали.

   Предупреждение всплывает, только когда состав снапшотов и правда стал
   другим, и только если такой строки на прошлом составе не было.

   Порядок из состава выкинут намеренно. Предупреждение про разные хабы
   называет тот снапшот, который выбивается из ряда, а выбивается — всегда
   не первый; от перестановки строка переписывается, хотя факт под ней тот
   же самый. Сравнивай мы строки, окошко вылезало бы на каждое
   перетаскивание узла и твердило человеку одно и то же за то, что он
   двигает рельс. */
(function (root, factory) { /* …как у остальных, имя KP.notices… */ }(
  /* … */ () => {
  'use strict';

  function create(deps) {
    const store = deps.store, toasts = deps.toasts;
    let shown = [];
    let stock = '';

    function stockOf() { /* …из ui.js:600-603… */ }

    function sync() { /* …середина renderSources из ui.js:609-624, без
                         rail.render(); shownWarnings → shown,
                         shownStock → stock… */ }

    return { sync: sync };
  }

  return { create };
}));
```

Комментарий про «состав тот же — показываем ровно то, на что список вырос» переезжает вместе с телом.

- [ ] **Шаг 2: Ужать `renderSources` в `ui.js`**

```js
  /* Состав снапшотов весь живёт на рельсе: там его показывают, там же
     добавляют, переставляют и убирают. Отдельного списка источников с теми
     же строками у страницы больше нет. */
  function renderSources() {
    rail.render();
    notices.sync();
  }
```

и рядом с владельцами участков:

```js
  const notices = noticesmod.create({ store: store, toasts: toasts });
```

Объявить его **раньше** первого вызова `renderSources` — то есть до `store.onChange(...)` и до `start()`. `const` не поднимается, и порядок здесь решает по-настоящему.

- [ ] **Шаг 3: Перевезти тесты**

Из `ui.test.js` уезжают (сейчас строки ~1004-1041):

- `разные хабы — предупреждение на странице`
- `перестановка тех же снапшотов предупреждение не повторяет`
- `откатившаяся перестановка объясняется окошком`

Первый и третий держатся на настоящем `store` и настоящих `toasts`; второй зовёт `dragNode(dom, ...)`, то есть перетаскивание по рельсу — это уже работа страницы, а не модуля. Поэтому:

- первый и третий переезжают в `notices.test.js` и поднимают там `store` с подставным `toasts`, считающим показанные окошки;
- второй **остаётся** в `ui.test.js`: он проверяет, что перетаскивание узла не будит предупреждение, и без рельса этого не проверить.

- [ ] **Шаг 4: Прогнать, собрать, закоммитить**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.notices' /tmp/check.html
git add dashboard/assets/js/notices.js dashboard/assets/js/ui.js \
        dashboard/build.py tests/js/notices.test.js tests/js/ui.test.js
git commit -m "Вынести показ предупреждений в свой модуль"
```

- [ ] **Шаг 5: Посмотреть, что осталось в корне**

```bash
wc -l dashboard/assets/js/ui.js dashboard/assets/js/page.js
```

Ожидается около 500 и около 600. Сильно больше — значит что-то из выносов не доехало; сильно меньше — значит уехало лишнее, и это надо назвать вслух, а не радоваться числу.

---

## Задача 14: README, CHANGELOG, версия 2.4.0

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `dashboard/__init__.py`
- Test: `tests/test_version.py`

**Interfaces:**
- Consumes: всё сделанное выше
- Produces: версия `2.4.0`

- [ ] **Шаг 1: Найти в README всё, что устарело**

```bash
grep -n "Δ патчей\|патчи пришли\|патчи ушли\|dpatch" README.md
grep -n "assets/js\|модул" README.md | head -30
```

Править ровно два места: описание колонки «Δ патчей» (теперь три исхода, и переписанные видны только у пары снапшотов от 2.3.0 и новее) и список модулей страницы, если он там есть, — пятью новыми именами.

**Не выдумывать.** Каждое утверждение, которое дописывается в README, должно быть проверяемо по коду: раньше на этом уже спотыкались — README сообщал, что коммит бывает пустым из-за ошибки GitLab, чего код не делает никогда.

- [ ] **Шаг 2: Поднять версию**

`dashboard/__init__.py`: `__version__ = "2.3.0"` → `"2.4.0"`.

- [ ] **Шаг 3: Запись в CHANGELOG**

Тем же коммитом, что и бамп. Взять за образец форму соседних записей. Содержание: рефакторинг без изменения поведения — пять новых модулей страницы, разрезанный `_attach_patches`, схлопнутые дубли; и одно видимое добавление — колонка «Δ патчей» считает переписанные патчи. Отдельно сказать, что схема снапшота прежняя и снапшоты 2.3.0 читаются без оговорок.

- [ ] **Шаг 4: Прогнать всё и проверить версию**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard --version
```

Ожидается `dashboard 2.4.0`. `tests/test_version.py` сторожит, что версия доезжает до собранной страницы.

- [ ] **Шаг 5: Коммит**

```bash
git add README.md CHANGELOG.md dashboard/__init__.py
git commit -m "Выпуск 2.4.0"
```

---

## Итоговая проверка перед вливанием

- [ ] Обе сюиты зелёные: Python ≥ 359, JS ≥ 501 (плюс новые, минус ноль).
- [ ] `python3 -m dashboard page -o /tmp/check.html` собирается, и все пять новых модулей в странице есть: `grep -c 'KP.search\|KP.copy\|KP.viewport\|KP.address\|KP.notices' /tmp/check.html` даёт не меньше пяти.
- [ ] `git diff --stat develop` не показывает ни `dashboard/model.py`, ни `tests/fixtures/rich-*.json`, ни `tests/js/fixtures/page-data.golden.json`. Любой из них в списке — повод остановиться и разобраться: схема и форма данных в этой работе не менялись.
- [ ] Страница открыта глазами на `rich-drift.json` + `rich-caught-up.json`: янтарный `~1` у nginx в колонке «Δ патчей», сортировка по колонке поднимает его наверх, раскрытие показывает переписанный патч янтарным, ghost-и на «Состоянии» на месте.
- [ ] `dashboard --version` → `2.4.0`.
