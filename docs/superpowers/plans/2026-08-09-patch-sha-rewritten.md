# Переписанный патч на «Изменениях» — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дифф между снапшотами перестаёт пропускать патч, у которого имя
осталось прежним, а содержимое изменилось.

**Architecture:** Blob sha уже приезжает в ответе GitLab и уже лежит в
`TreeResult.blobs` — сейчас он выбрасывается после `_ghosts`. Перестаём
выбрасывать: он ложится в `Patch.sha`, и дифф сравнивает пару «путь + sha»
вместо пути. Ноль новых запросов, схема снапшота прежняя.

**Tech Stack:** Python 3.9+ без зависимостей сверх koji/requests/PyYAML,
`unittest` с подделками из `tests/fakes.py`; ванильный ES2015+ в UMD-обёртке
вокруг `KP`, CSS без препроцессора, сборка одним файлом через
`dashboard/build.py`, тесты — `node --test` поверх `tests/js/domstub.js`.

## Global Constraints

- Спека: `docs/superpowers/specs/2026-08-09-patch-sha-rewritten-design.md`.
  При расхождении плана со спекой права спека.
- **`SCHEMA` в `model.py` остаётся `1`.** `sha` необязателен, читается через
  `.get`, снапшоты до 2.3.0 открываются без ошибок.
- **Ни одного нового запроса** — ни к koji, ни к GitLab.
- **Молчим, когда sha неизвестен хоть с одной стороны.** Патч в
  «переписанные» не попадает. Это сознательный ложный отрицательный ответ, и
  переигрывать его в плане нельзя.
- **sha берётся с того дерева, куда ведёт ссылка файла:** у обычных патчей
  и ghost-стороны `build` — с коммита сборки, у сторон `branch` и `changed`
  — с вершины ветки.
- В коде исход зовётся `rewritten`, на странице «патчи переписаны».
  Ghost-сторона остаётся `changed` и значит другое — их нельзя смешивать.
- Сводка вкладки **«Состояние» не трогается**. Ряд итогов на «Изменениях»
  получает третью карточку — это спрошено и разрешено отдельно.
- Собранная страница остаётся одним самодостаточным файлом.
- Комментарии, подписи и сообщения — по-русски, в тон соседним файлам:
  объясняют «почему», а не пересказывают код.
- Ветка `feature/patch-sha` от `develop`; в `develop` не вливать без апрува.
- После каждой задачи обе сюиты зелёные:
  `python3 -m unittest discover -s tests` и `node --test tests/js/*.test.js`.

## Ловушки, на которых спотыкались в 2.2.0

Обе стоили по фикс-раунду, обе повторятся здесь буквально:

1. **Фикстуры перегенерируются сразу, как только `to_dict` меняется.**
   `tests/test_fixtures.py::test_generator_writes_exactly_what_is_committed`
   сверяет committed-файлы с выводом генератора. Отложить регенерацию на
   последнюю задачу нельзя — она входит в Задачу 1.
2. **`tests/fakes.py::FakeTransport.get` сопоставляет маршруты по
   `tuple(sorted(params.items()))`.** Ключ маршрута, записанный в другом
   порядке, не совпадёт никогда и молча свалится в 404 по умолчанию — тест
   пройдёт по неверной причине. Для чтения дерева верный порядок:
   `(path, per_page, recursive, ref)`.

## Раскладка файлов

| файл | роль |
|---|---|
| `dashboard/model.py` | `Patch.sha` |
| `dashboard/collect.py` | sha у патчей билда и у ghost-патчей |
| `dashboard/assets/js/diff.js` | `patches_rewritten`, `isChanged`, `counts` |
| `dashboard/assets/js/viewmodel.js` | `sha` в строке, метка `patches~` |
| `dashboard/assets/js/labels.js` | подпись, степень и фильтр `patches~` |
| `dashboard/assets/js/cards.js` | третья карточка в ряду итогов |
| `dashboard/assets/js/markup.js` | знак `~` и класс строки |
| `dashboard/assets/css/table.css` | цвет переписанной строки |
| `tests/js/fixtures/page-data.golden.json` | правится руками (Задача 4) |
| `tests/fixtures/make_rich_fixtures.py` | демонстрационная пара |
| `README.md`, `CHANGELOG.md`, `dashboard/__init__.py` | документация и 2.3.0 |

---

### Task 1: `Patch.sha` в модели

**Files:**
- Modify: `dashboard/model.py:15-32`
- Modify: `tests/test_model.py`
- Modify: `tests/fixtures/rich-*.json` (перегенерация, см. ниже)

**Interfaces:**
- Consumes: ничего.
- Produces: `Patch(path, name, cls, cves=[], web_url=None, ghost=None,
  sha=None)`; в JSON ключ `sha`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_model.py`:

```python
class PatchShaTest(unittest.TestCase):
    def test_round_trip(self):
        patch = Patch(path="PATCH/a.patch", name="a.patch", cls="CVE",
                      sha="0123456789abcdef0123456789abcdef01234567")
        again = Patch.from_dict(patch.to_dict())
        self.assertEqual(again.sha,
                         "0123456789abcdef0123456789abcdef01234567")

    def test_old_patch_reads_without_sha(self):
        # снапшот до 2.3.0: ключа нет вовсе
        again = Patch.from_dict({"path": "PATCH/a.patch", "name": "a.patch",
                                 "class": "CVE"})
        self.assertIsNone(again.sha)
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_model -v`
Expected: FAIL с `TypeError: __init__() got an unexpected keyword argument 'sha'`

- [ ] **Step 3: Дописать поле**

В `dashboard/model.py`, класс `Patch` — после `ghost`:

```python
    # blob sha файла: тот же объект, что git кладёт в дерево, — sha1 от
    # «blob <длина>\0» и содержимого. Адресуется содержимым, а не адресом,
    # поэтому одинаковые файлы дают одинаковый sha в любом репозитории и в
    # любом прогоне: по нему сравнимы два снапшота, даже если компонент
    # переехал в другой проект. None — не знаем: снапшот собран до 2.3.0
    # или дерево не прочиталось.
    sha: Optional[str] = None
```

В `to_dict` — рядом с `ghost`:

```python
                "ghost": self.ghost, "sha": self.sha}
```

В `from_dict`:

```python
                   web_url=data.get("web_url"), ghost=data.get("ghost"),
                   sha=data.get("sha"))
```

- [ ] **Step 4: Перегенерировать фикстуры**

`to_dict` изменился, значит committed-фикстуры разошлись с генератором —
`test_generator_writes_exactly_what_is_committed` это ловит. Регенерация
входит в эту задачу, а не в последнюю:

```bash
python3 tests/fixtures/make_rich_fixtures.py
git diff --stat tests/fixtures/
```

Expected: во всех одиннадцати `rich-*.json` дописан `"sha": null` каждому
патчу и каждому ghost-патчу, других изменений нет. Если в диффе появились
строки со знаком `-` помимо поля `dashboard`, остановиться и разобраться:
регенерация обязана быть строго дописывающей.

- [ ] **Step 5: Прогнать обе сюиты**

Run: `python3 -m unittest discover -s tests`
Expected: PASS
Run: `node --test tests/js/*.test.js`
Expected: PASS — страница нового ключа пока не читает, эталон не затронут.

- [ ] **Step 6: Коммит**

```bash
git add dashboard/model.py tests/test_model.py tests/fixtures
git commit -m "Патч помнит blob sha своего файла"
```

---

### Task 2: sha заполняется при сборе

**Files:**
- Modify: `dashboard/collect.py` (`_attach_patches`, `_ghosts`, `_patch`)
- Modify: `tests/test_collect.py`

**Interfaces:**
- Consumes: `TreeResult.blobs` (`{путь: blob sha}`, `{}` при отказе),
  `Patch.sha` из Задачи 1.
- Produces: `_patch(path, parsed, ref, classifier, gitlab_client,
  ghost=None, sha=None)`; заполненный `Patch.sha` у патчей билда и у
  ghost-патчей.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/test_collect.py`. Помощники `clients_with_source`, `tree`,
`compare_answer`, постоянные `SHA`, `NGINX_TREE`, `NGINX_COMPARE` в файле
уже есть — использовать их, а не заводить свои:

```python
class PatchShaTest(unittest.TestCase):
    def _nginx(self, routes):
        koji, gitlab, _ = clients_with_source(
            routes, "git+ssh://git@gitlab.example.com/g/nginx#" + SHA)
        return collect_tag("os-9.2", config(), koji, gitlab,
                           jobs=1).by_name()["nginx"]

    def test_build_patches_carry_the_sha_of_the_commit_tree(self):
        build = self._nginx({
            (NGINX_TREE, (("path", "PATCH"), ("per_page", "100"),
                          ("recursive", "true"), ("ref", SHA))):
                Response(200, [{"id": "blob-a", "type": "blob",
                                "path": "PATCH/a.patch"}], {}),
            NGINX_COMPARE: compare_answer(0, head=SHA),
        })
        self.assertEqual([p.sha for p in build.patches], ["blob-a"])

    def test_each_ghost_side_takes_the_sha_of_the_tree_its_link_points_at(self):
        built = Response(200, [
            {"id": "kept", "type": "blob", "path": "PATCH/kept.patch"},
            {"id": "old", "type": "blob", "path": "PATCH/rewritten.patch"},
            {"id": "gone", "type": "blob", "path": "PATCH/dropped.patch"},
        ], {})
        tip = Response(200, [
            {"id": "kept", "type": "blob", "path": "PATCH/kept.patch"},
            {"id": "new", "type": "blob", "path": "PATCH/rewritten.patch"},
            {"id": "fresh", "type": "blob", "path": "PATCH/added.patch"},
        ], {})
        build = self._nginx({
            (NGINX_TREE, (("path", "PATCH"), ("per_page", "100"),
                          ("recursive", "true"), ("ref", SHA))): built,
            (NGINX_TREE, (("path", "PATCH"), ("per_page", "100"),
                          ("recursive", "true"), ("ref", "br"))): tip,
            NGINX_COMPARE: compare_answer(2),
        })
        got = {(p.ghost, p.name): p.sha for p in build.ghost_patches}
        # branch и changed ведут на ветку — и sha берут оттуда же
        self.assertEqual(got[("branch", "added.patch")], "fresh")
        self.assertEqual(got[("changed", "rewritten.patch")], "new")
        # build ведёт на коммит: в ветке этого файла уже нет
        self.assertEqual(got[("build", "dropped.patch")], "gone")

    def test_failed_read_leaves_no_sha_and_is_not_a_new_problem(self):
        build = self._nginx({NGINX_TREE: Response(500, {}, {})})
        self.assertEqual(build.patches, [])
        self.assertFalse([p for p in build.problems if "sha" in p])
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `p.sha` равен `None` там, где ждём идентификатор.

- [ ] **Step 3: Пробросить sha**

В `dashboard/collect.py` — подпись `_patch`:

```python
def _patch(path, parsed, ref, classifier, gitlab_client, ghost=None,
           sha=None):
    name = os.path.basename(path)
    return Patch(path=path, name=name, cls=classifier.classify(name),
                 cves=find_cves(name), ghost=ghost, sha=sha,
                 web_url=gitlab_client.blob_url(parsed.host, parsed.project,
                                                ref, path))
```

В `_attach_patches`, цикл по патчам билда:

```python
    for path in result.paths:
        build.patches.append(_patch(path, parsed, ref, classifier,
                                    gitlab_client,
                                    sha=result.blobs.get(path)))
```

`result` здесь — то самое дерево, с которого снят список, включая случай
отката на ветку: тогда и `ref`, и `blobs` от ветки, и они сходятся.

В `_ghosts` — блоб берётся с того же дерева, что и ссылка:

```python
    out = []
    for side in _GHOST_SIDES:
        # ссылка ведёт туда, где файл есть: у стороны build его в ветке уже
        # нет, и ссылка на ветку вела бы в никуда. sha берётся оттуда же:
        # разойдись они, снапшот утверждал бы, что по этому адресу лежит
        # файл вот с таким содержимым, — и врал бы.
        ref = commit if side == "build" else parsed.ref
        blobs = built.blobs if side == "build" else tip.blobs
        for path in paths[side]:
            out.append(_patch(path, parsed, ref, classifier, gitlab_client,
                              ghost=side, sha=blobs.get(path)))
    return out
```

- [ ] **Step 4: Прогнать обе сюиты**

Run: `python3 -m unittest discover -s tests`
Expected: PASS
Run: `node --test tests/js/*.test.js`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/collect.py tests/test_collect.py
git commit -m "Blob sha доезжает до патчей билда и до ghost-патчей"
```

---

### Task 3: третий исход в диффе

**Files:**
- Modify: `dashboard/assets/js/diff.js:200-260`
- Modify: `tests/js/diff.test.js`

**Interfaces:**
- Consumes: `build.patches[*].sha` из снапшота.
- Produces: у компонента появляется `patches_rewritten` — отсортированный
  список путей; `isChanged` учитывает его; `counts` даёт
  `counts.patches_rewritten` — **число компонентов**, а не файлов.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/js/diff.test.js`:

```js
function withPatch(over, path, sha) {
  return build(Object.assign({ patches: [{ path: path, name: 'x.patch',
                                           'class': 'CVE', sha: sha }] },
                             over || {}));
}

test('патч переписан: путь тот же, sha другой', function () {
  var pair = diff.diffSnapshots(
    snap('a', [withPatch({}, 'PATCH/x.patch', 'aaa')]),
    snap('b', [withPatch({ nvr: 'nginx-2.0-1.el9', version: '2.0' },
                         'PATCH/x.patch', 'bbb')]));
  assert.deepStrictEqual(only(pair).patches_rewritten, ['PATCH/x.patch']);
  assert.deepStrictEqual(only(pair).patches_added, []);
  assert.deepStrictEqual(only(pair).patches_removed, []);
});

test('тот же sha — патч уцелел, а не переписан', function () {
  var pair = diff.diffSnapshots(
    snap('a', [withPatch({}, 'PATCH/x.patch', 'aaa')]),
    snap('b', [withPatch({ nvr: 'nginx-2.0-1.el9', version: '2.0' },
                         'PATCH/x.patch', 'aaa')]));
  assert.deepStrictEqual(only(pair).patches_rewritten, []);
});

test('sha известен только с одной стороны — молчим', function () {
  var pair = diff.diffSnapshots(
    snap('a', [withPatch({}, 'PATCH/x.patch', undefined)]),
    snap('b', [withPatch({ nvr: 'nginx-2.0-1.el9', version: '2.0' },
                         'PATCH/x.patch', 'bbb')]));
  assert.deepStrictEqual(only(pair).patches_rewritten, []);
});

test('переписанный патч делает компонент изменившимся', function () {
  // сам по себе, без смены версии: status остался unchanged, а метка
  // «изменился» обязана появиться — иначе подпись карточки «изменилось
  // хоть что-нибудь» становится неправдой
  var pair = diff.diffSnapshots(
    snap('a', [withPatch({}, 'PATCH/x.patch', 'aaa')]),
    snap('b', [withPatch({}, 'PATCH/x.patch', 'bbb')]));
  assert.strictEqual(only(pair).status, 'unchanged');
  assert.strictEqual(only(pair).changed, true);
});

test('счётчик считает компоненты, а не файлы', function () {
  var two = build({ nvr: 'curl-1.0-1.el9', name: 'curl',
                    patches: [{ path: 'PATCH/a.patch', name: 'a.patch',
                                'class': 'CVE', sha: 'a1' },
                              { path: 'PATCH/b.patch', name: 'b.patch',
                                'class': 'CVE', sha: 'b1' }] });
  var twoNew = build({ nvr: 'curl-1.0-1.el9', name: 'curl',
                       patches: [{ path: 'PATCH/a.patch', name: 'a.patch',
                                   'class': 'CVE', sha: 'a2' },
                                 { path: 'PATCH/b.patch', name: 'b.patch',
                                   'class': 'CVE', sha: 'b2' }] });
  var pair = diff.diffSnapshots(snap('a', [two]), snap('b', [twoNew]));
  assert.strictEqual(pair.counts.patches_rewritten, 1);
});

test('появившийся и исчезнувший компонент переписанных не имеют', function () {
  var added = diff.diffSnapshots(snap('a', []), snap('b', [build({})]));
  var gone = diff.diffSnapshots(snap('a', [build({})]), snap('b', []));
  assert.deepStrictEqual(only(added).patches_rewritten, []);
  assert.deepStrictEqual(only(gone).patches_rewritten, []);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/diff.test.js`
Expected: FAIL — `patches_rewritten` равен `undefined`.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/diff.js`, рядом с `setMinus`:

```js
  function pathShas(build) {
    const out = new Map();
    for (const p of (build.patches || [])) out.set(p.path, p.sha || null);
    return out;
  }

  /* Путь есть с обеих сторон, а содержимое разное. Сравнение по одним
     именам этот случай пропускает, а он самый опасный из трёх:
     переписанный после сборки патч CVE выглядит как уцелевший.

     Молчим, когда sha неизвестен хоть с одной стороны: снапшоты до 2.3.0
     его не несут. Объявить такой патч уцелевшим — меньшее зло, чем
     объявить переписанным то, чего мы не сравнивали. */
  function rewritten(oldShas, newShas) {
    const out = [];
    oldShas.forEach((sha, path) => {
      const other = newShas.get(path);
      if (sha && other && sha !== other) out.push(path);
    });
    return out.sort();
  }
```

В `diffSnapshots`, ветка, где есть обе стороны, — заменить построение
множеств и дописать поле:

```js
        const oldShas = pathShas(oldBuild);
        const newShas = pathShas(newBuild);
        const oldPatches = new Set(oldShas.keys());
        const newPatches = new Set(newShas.keys());
```

```js
          patches_added: setMinus(newPatches, oldPatches),
          patches_removed: setMinus(oldPatches, newPatches),
          patches_rewritten: rewritten(oldShas, newShas),
```

В двух ветках «компонент появился» и «компонент исчез» — там, где уже
стоят `patches_added: [], patches_removed: []`, дописать:

```js
                       patches_added: [], patches_removed: [],
                       patches_rewritten: [],
```

В `isChanged`:

```js
  function isChanged(component) {
    return Boolean(component.status !== 'unchanged'
                   || component.patches_added.length
                   || component.patches_removed.length
                   || component.patches_rewritten.length
                   || component.repackaged
                   || component.branch_changed
                   || component.tag_changed);
  }
```

В `counts` — объявление и подсчёт рядом с соседями:

```js
    result.patches_rewritten = 0;
```

```js
      if (component.patches_rewritten.length) result.patches_rewritten += 1;
```

Существующие тесты диффа правок не требуют, и это проверено, а не
предположено: помощник `build2` в `tests/js/diff.test.js` строит патчи без
`sha`, `pathShas` даёт ровно те же ключи, что нынешний
`map((p) => p.path)`, — множества `oldPatches`/`newPatches` не меняются, —
а `rewritten` на пустых sha возвращает пустой список. Если какой-то из них
всё же упал, это настоящий сигнал: разбираться, а не подгонять тест.

- [ ] **Step 4: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/assets/js/diff.js tests/js/diff.test.js
git commit -m "Дифф сравнивает содержимое, а не одни имена"
```

---

### Task 4: строка страницы и эталон паритета

**Files:**
- Modify: `dashboard/assets/js/viewmodel.js` (`patchDict`, `diffMarks`, `diffRow`)
- Modify: `tests/js/fixtures/page-data.golden.json`
- Modify: `tests/js/viewmodel.test.js`

**Interfaces:**
- Consumes: `component.patches_rewritten` из Задачи 3, `patch.sha` из
  Задачи 1.
- Produces: в словаре патча появляется `sha`; в строке диффа —
  `patches_rewritten` и метка `patches~`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/js/viewmodel.test.js`:

```js
test('sha патча доезжает до страницы', function () {
  var rows = data([snap('os-9.2', [build('nginx', {
    patches: [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
                cves: [], web_url: 'https://gl/a', sha: 'blob-a' }]
  })])]).snapshots[0].builds;
  assert.strictEqual(rows[0].patches[0].sha, 'blob-a');
});

test('патч без sha даёт null, а не undefined', function () {
  var rows = data([snap('os-9.2', [build('nginx', {
    patches: [patch('a.patch', 'CVE')]
  })])]).snapshots[0].builds;
  assert.strictEqual(rows[0].patches[0].sha, null);
});

test('переписанный патч даёт метку patches~', function () {
  var withSha = function (sha, over) {
    return build('nginx', Object.assign({
      patches: [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
                  cves: [], web_url: 'https://gl/a', sha: sha }]
    }, over || {}));
  };
  var pair = data([snap('os-9.1', [withSha('aaa')]),
                   snap('os-9.2', [withSha('bbb', { version: '1.2' })])])
             .pairs[0];
  var row = pair.rows[0];
  assert.deepStrictEqual(row.patches_rewritten, ['PATCH/a.patch']);
  assert.ok(row.marks.indexOf('patches~') !== -1);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/viewmodel.test.js`
Expected: FAIL — `sha` равен `undefined`, метки нет.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/viewmodel.js`, `patchDict`:

```js
  function patchDict(patch) {
    return { path: orNull(patch.path), name: orNull(patch.name),
             'class': orNull(patch['class']), cves: (patch.cves || []).slice(),
             url: orNull(patch.web_url), ghost: orNull(patch.ghost),
             sha: orNull(patch.sha) };
  }
```

В `diffMarks` — между `patches-` и `branch-changed`, чтобы порядок меток
повторял порядок карточек:

```js
    if (component.patches_rewritten.length) marks.push('patches~');
```

В `diffRow` — рядом с соседями:

```js
      patches_rewritten: component.patches_rewritten.slice(),
```

- [ ] **Step 4: Поправить эталон паритета**

Эталон автоматически не пересчитывается — правится руками и осознанно
(см. комментарий в `tests/js/viewmodel.test.js` над проверкой паритета).
В фикстурах `rich-old.json`/`rich-new.json` sha нет, поэтому значения
ровно такие:

```bash
node -e '
const fs = require("fs");
const p = "tests/js/fixtures/page-data.golden.json";
const g = JSON.parse(fs.readFileSync(p, "utf8"));
for (const s of g.snapshots) {
  for (const b of s.builds) {
    for (const patch of b.patches) patch.sha = null;
    for (const patch of b.ghosts) patch.sha = null;
  }
}
for (const pair of g.pairs) {
  for (const row of pair.rows) {
    for (const patch of row.old_patches) patch.sha = null;
    for (const patch of row.new_patches) patch.sha = null;
    row.patches_rewritten = [];
  }
}
fs.writeFileSync(p, JSON.stringify(g, null, 1) + "\n");
'
git diff --stat tests/js/fixtures/page-data.golden.json
```

Отступ и хвостовой перевод строки подогнать под то, чем файл был записан:
правка обязана коснуться только содержательных строк, а не всего файла
целиком. Если форматирование разъехалось, отменить и дописать ключи иначе.

- [ ] **Step 5: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS, включая «данные страницы совпадают с питоновским эталоном».
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add dashboard/assets/js/viewmodel.js tests/js/viewmodel.test.js \
        tests/js/fixtures/page-data.golden.json
git commit -m "Строка диффа знает про переписанные патчи"
```

---

### Task 5: метка, фильтр и карточка

**Files:**
- Modify: `dashboard/assets/js/labels.js` (`LABELS`, `CALM_MARKS`, `GROUPS`)
- Modify: `dashboard/assets/js/cards.js` (`spec` ряда итогов)
- Modify: `tests/js/labels.test.js`, `tests/js/cards.test.js`

**Interfaces:**
- Consumes: метка `patches~` из Задачи 4, `counts.patches_rewritten` из
  Задачи 3.
- Produces: подпись «патчи переписаны», степень `warn`, пункт в группе
  фильтров `change`, третья карточка в ряду итогов.

- [ ] **Step 1: Написать падающие тесты**

В `tests/js/labels.test.js`:

```js
test('patches~ подписан и лежит в группе изменений', function () {
  assert.strictEqual(labels.label('patches~'), 'патчи переписаны');
  var change = labels.groups('diff').filter(function (g) {
    return g.id === 'change';
  })[0];
  assert.ok(change.keys.indexOf('patches~') !== -1);
});
```

В `tests/js/cards.test.js` помощник `pair` перечисляет `counts` поимённо —
дописать в его умолчания `patches_rewritten: 0`, иначе карточка получит
`undefined` вместо числа. Затем новая проверка:

```js
test('ряд итогов считает переписанные патчи', function () {
  var out = cards.diffCards(pair({ counts: { patches_rewritten: 3 } }));
  assert.match(out, /data-filter="patches~"/);
  assert.match(out, /патчи переписаны/);
});
```

**Существующую проверку `tests/js/cards.test.js:76` придётся поправить:**

```js
  assert.strictEqual(found.length, 11);   // было
  assert.strictEqual(found.length, 12);   // стало
```

Это не ослабление утверждения, а обновление числа, которое и есть предмет
изменения: карточек в ряду итогов стало на одну больше. Остальные
утверждения того теста не трогать.

Проверки раскладки ниже (`columnsFor(11, …)`) править **не нужно**:
`columnsFor` — чистая функция, число карточек приходит ей доводом, а не из
реального ряда. Комментарий над ними говорит «одиннадцать карточек» про
собственные числа теста, а не про страницу.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/labels.test.js tests/js/cards.test.js`
Expected: FAIL — подпись равна самому ключу, карточки нет.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/labels.js`, в `LABELS` рядом с соседями:

```js
    "patches-": "патчи ушли", "patches~": "патчи переписаны",
```

В `CALM_MARKS`:

```js
                       "patches~": "warn",
```

В `GROUPS.diff`, группа `change` — сразу после `patches-`:

```js
        keys: ["changed", "patches+", "patches-", "patches~", "repackaged",
               "branch-changed", "tag-changed"] }
```

В `dashboard/assets/js/cards.js`, в `spec` — сразу после карточки
`patches-`:

```js
      ['patches~', c.patches_rewritten, 'патчи переписаны',
       'Файл остался под тем же именем, а содержимое другое: сравнение идёт '
       + 'по blob sha. Снапшоты, собранные до 2.3.0, sha не несут — в паре '
       + 'с таким снапшотом число всегда ноль.'],
```

- [ ] **Step 4: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add dashboard/assets/js/labels.js dashboard/assets/js/cards.js \
        tests/js/labels.test.js tests/js/cards.test.js
git commit -m "Метка, фильтр и карточка переписанных патчей"
```

---

### Task 6: знак и цвет в списке «стало»

**Files:**
- Modify: `dashboard/assets/js/markup.js` (`signHtml`, `patchesChangeHtml`)
- Modify: `dashboard/assets/css/table.css`
- Modify: `tests/js/markup.test.js`

**Interfaces:**
- Consumes: `sha` в словаре патча из Задачи 4.
- Produces: строка переписанного патча получает класс `is-rewritten` и знак
  `~`; сторона «было» не метится ничем.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `tests/js/markup.test.js`:

```js
function withSha(name, sha) {
  return { path: 'PATCH/' + name, name: name, 'class': 'CVE', cves: [],
           url: 'https://gl/' + name, sha: sha };
}

test('переписанный патч помечен знаком и классом', function () {
  var html = markup.patchesChangeHtml([withSha('a.patch', 'aaa')],
                                      [withSha('a.patch', 'bbb')], '');
  assert.match(html, /class="is-rewritten"/);
  assert.match(html, /<span class="sign">~<\/span>/);
});

test('тот же sha не метится ничем', function () {
  var html = markup.patchesChangeHtml([withSha('a.patch', 'aaa')],
                                      [withSha('a.patch', 'aaa')], '');
  assert.strictEqual(html.indexOf('is-rewritten'), -1);
});

test('sha только с одной стороны — не метится', function () {
  var html = markup.patchesChangeHtml([withSha('a.patch', undefined)],
                                      [withSha('a.patch', 'bbb')], '');
  assert.strictEqual(html.indexOf('is-rewritten'), -1);
});

test('сторона «было» по-прежнему не метится', function () {
  var html = markup.patchesHtml([withSha('a.patch', 'aaa')], '');
  assert.strictEqual(html.indexOf('is-rewritten'), -1);
  assert.strictEqual(html.indexOf('class="sign"'), -1);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `node --test tests/js/markup.test.js`
Expected: FAIL — класса `is-rewritten` в разметке нет.

- [ ] **Step 3: Реализовать**

В `dashboard/assets/js/markup.js` — знак третий, поэтому таблицей, а не
тернарником:

```js
  /* Знак дублирует цвет — на случай, если цвет не различим. Их три:
     пришёл, ушёл, переписан. */
  const SIGNS = { 'is-added': '+', 'is-removed': '−', 'is-rewritten': '~' };

  function signHtml(markCls) {
    return `<span class="sign">${SIGNS[markCls] || '−'}</span>`;
  }
```

В `patchesChangeHtml`, цикл по старой стороне:

```js
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

- [ ] **Step 4: Цвет строки**

В `dashboard/assets/css/table.css`, рядом с правилами `.plist li.is-added`
и `.plist li.is-removed`:

```css
/* Переписанный патч: имя то же, содержимое другое. Янтарный — тот же цвет,
   которым покрашены «сменил ветку» и «ветка +N»: он на этой странице уже
   значит «разъехалось, но ничего не потеряно». Зелёный и красный заняты
   приходом и уходом, лавандовый — составом RPM. */
.plist li.is-rewritten, .plist li.is-rewritten a { color: var(--major); }
```

Правило про ссылку стоит рядом по той же причине, что у `is-added` и
`is-removed`: без него синий цвет ссылки съедает единственный сигнал.

- [ ] **Step 5: Посмотреть глазами**

```bash
python3 -m dashboard page -o /tmp/dash.html
```

Открыть, загрузить `tests/fixtures/rich-drift.json` и
`tests/fixtures/rich-caught-up.json` (после Задачи 7 в них будет
переписанный патч), перейти на «Изменения», раскрыть `nginx` и убедиться:
знак `~` стоит, цвет отличим от зелёного и красного, строка читается как
изменённая, а не как потерянная.

- [ ] **Step 6: Прогнать обе сюиты**

Run: `node --test tests/js/*.test.js`
Expected: PASS
Run: `python3 -m unittest discover -s tests`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add dashboard/assets/js/markup.js dashboard/assets/css/table.css \
        tests/js/markup.test.js
git commit -m "Переписанный патч виден знаком и цветом"
```

---

### Task 7: демонстрационная пара, документация, версия 2.3.0

**Files:**
- Modify: `tests/fixtures/make_rich_fixtures.py`
- Modify: `tests/fixtures/rich-drift.json`, `rich-caught-up.json` (перегенерация)
- Modify: `tests/test_fixtures.py`
- Modify: `README.md`, `CHANGELOG.md`, `dashboard/__init__.py:8`

**Interfaces:**
- Consumes: всё, сделанное в Задачах 1–6.
- Produces: пара, где компонент пересобран и один патч переписан при том же
  имени; версия `2.3.0`.

- [ ] **Step 1: Дать демонстрационной цепочке sha**

В `tests/fixtures/make_rich_fixtures.py` помощник `pat` получает
необязательный `sha`:

```python
def pat(project, ref, name, cls, cves=(), ghost=None, sha=None):
```

и передаёт его в `Patch(..., sha=sha)`.

Sha выписываются постоянными рядом с хешами коммитов — по той же причине,
по которой там стоят они: одно и то же значение встречается в двух
снапшотах, и разъехавшись, они превратили бы историю в бессмыслицу.

```python
# Blob sha демонстрационной цепочки. У distsuffix их два: до пересборки в
# пакете лежит прежняя редакция, после — та, что уже была в ветке. На этой
# паре и видно исход «патч переписан», которого до 2.3.0 не существовало.
BLOB_CVE_3010 = "1a2b3c4d5e6f70819293a4b5c6d7e8f900112233"
BLOB_CVE_3011 = "2b3c4d5e6f70819293a4b5c6d7e8f90011223344"
BLOB_DIST_OLD = "3c4d5e6f70819293a4b5c6d7e8f9001122334455"
BLOB_DIST_NEW = "4d5e6f70819293a4b5c6d7e8f900112233445566"
```

Раздать их у `nginx` в обоих снапшотах. В `drift_snapshot`:

```python
                  patches=[
                      pat("web/nginx", NGINX_BUILT, "CVE-2026-3010.patch",
                          "CVE", ["CVE-2026-3010"], sha=BLOB_CVE_3010),
                      pat("web/nginx", NGINX_BUILT, "nginx-distsuffix.patch",
                          "DISTSUFFIX", sha=BLOB_DIST_OLD),
                  ],
                  ghost_patches=[
                      pat("web/nginx", tag, "CVE-2026-3011.patch", "CVE",
                          ["CVE-2026-3011"], ghost="branch",
                          sha=BLOB_CVE_3011),
                      # сторона changed читается с вершины ветки, где уже
                      # лежит новая редакция, — её же билд и получит,
                      # когда его пересоберут
                      pat("web/nginx", tag, "nginx-distsuffix.patch",
                          "DISTSUFFIX", ghost="changed", sha=BLOB_DIST_NEW),
                  ],
```

В `caught_up_snapshot`:

```python
                  patches=[
                      pat("web/nginx", NGINX_HEAD, "CVE-2026-3010.patch",
                          "CVE", ["CVE-2026-3010"], sha=BLOB_CVE_3010),
                      pat("web/nginx", NGINX_HEAD, "CVE-2026-3011.patch",
                          "CVE", ["CVE-2026-3011"], sha=BLOB_CVE_3011),
                      pat("web/nginx", NGINX_HEAD, "nginx-distsuffix.patch",
                          "DISTSUFFIX", sha=BLOB_DIST_NEW),
                  ],
```

Так пара drift → caught-up даёт разом все три исхода: `CVE-2026-3011.patch`
пришёл, `nginx-distsuffix.patch` переписан, ушедших нет. Остальным
компонентам цепочки sha не раздаём — довольно одного показательного, а
лишние значения в фикстуре только удлинили бы её.

`rich-legacy.json` sha не получает: он изображает снапшот, собранный до
этой работы, и пара legacy → drift показывает как раз молчание.

- [ ] **Step 2: Перегенерировать и проверить**

```bash
python3 tests/fixtures/make_rich_fixtures.py
git diff --stat tests/fixtures/
```

Expected: изменились `make_rich_fixtures.py`, `rich-drift.json` и
`rich-caught-up.json`; `rich-old.json` и `rich-new.json` — нет.

- [ ] **Step 3: Закрепить случай тестом**

Дописать в `tests/test_fixtures.py`, в класс `DriftChainTest`:

```python
    def test_a_patch_is_rewritten_between_the_two_new_snapshots(self):
        # Пересборка с вершины: имя то же, содержимое другое. До 2.3.0
        # такой патч был неотличим от уцелевшего.
        before = snapshot("rich-drift.json").by_name()["nginx"]
        after = snapshot("rich-caught-up.json").by_name()["nginx"]
        was = {p.name: p.sha for p in before.patches}
        now = {p.name: p.sha for p in after.patches}
        self.assertEqual(was["CVE-2026-3010.patch"],
                         now["CVE-2026-3010.patch"])
        self.assertNotEqual(was["nginx-distsuffix.patch"],
                            now["nginx-distsuffix.patch"])
        # ghost-сторона changed несёт ту редакцию, что уже лежала в ветке,
        # — и она же оказалась в пакете после пересборки
        ghost = {p.name: p.sha for p in before.ghost_patches
                 if p.ghost == "changed"}
        self.assertEqual(ghost["nginx-distsuffix.patch"],
                         now["nginx-distsuffix.patch"])

    def test_legacy_carries_no_sha_at_all(self):
        # молчание в паре со старым снапшотом — тоже случай, и он тут
        for build in snapshot("rich-legacy.json").builds:
            for patch in build.patches:
                self.assertIsNone(patch.sha, patch.name)
```

- [ ] **Step 4: README**

- Раздел с полями патча: `sha` — blob sha файла, `null`, если снапшот
  собран до 2.3.0 или дерево не прочиталось.
- Раздел про «Изменения»: третий исход, условие «sha известен с обеих
  сторон», и прямо сказанное следствие — в паре со снапшотом до 2.3.0
  переписанные патчи не видны, и отсутствие метки там не значит, что их не
  было.
- Разделы меток и фильтров: `patches~`.
- Описание демонстрационного набора: у пары drift → caught-up теперь виден
  и переписанный патч.

- [ ] **Step 5: Версия и CHANGELOG**

`dashboard/__init__.py`:

```python
__version__ = "2.3.0"
```

В `CHANGELOG.md` новая запись перед `## 2.2.0`:

```markdown
## 2.3.0 — 2026-08-09

**Дифф видит переписанный патч.** Раньше «Изменения» сравнивали патчи по
одним путям, и файл, сохранивший имя, был неотличим от уцелевшего — что бы
с ним внутри ни сделали. Для дашборда патчей CVE это тот же опасный
недосмотр, что и в 2.2.0, только этажом выше: ghost-сторона «в пакете
старый» сравнивала содержимое внутри одного снапшота, а между двумя
снапшотами сравнивались имена. Теперь у патча есть `sha` — blob sha его
файла, тот же объект, что git кладёт в дерево, — и рядом с «патчи пришли» и
«патчи ушли» появился третий исход, «патчи переписаны»: своя метка, свой
фильтр и своя карточка в ряду итогов. В списке «стало» такой патч помечен
знаком `~` и янтарным цветом — тем, которым на странице уже покрашено
«разъехалось, но ничего не потеряно».

Запросов не прибавилось ни одного: blob sha приезжал в ответе GitLab и
раньше, просто выбрасывался после подсчёта ghost-патчей.

**Молчание, когда сравнивать нечем.** Снапшоты, собранные до 2.3.0, sha не
несут, и в паре с таким снапшотом переписанные патчи не показываются вовсе.
Отсутствие метки там не значит, что их не было, — значит, что содержимое не
сравнивалось.

Формат снапшота совместим: `schema` по-прежнему `1`, поле `sha`
необязательное. Снапшоты до 2.3.0 читаются как раньше.
```

- [ ] **Step 6: Прогнать всё и посмотреть страницу**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard --version
python3 -m dashboard page -o /tmp/dash.html
```

Expected: обе сюиты зелёные, версия `dashboard 2.3.0`, на «Изменениях» в
паре drift → caught-up у `nginx` стоит метка «патчи переписаны», а в паре
legacy → drift её нет.

- [ ] **Step 7: Коммит**

```bash
git add tests/fixtures tests/test_fixtures.py README.md CHANGELOG.md \
        dashboard/__init__.py
git commit -m "Демонстрационная пара с переписанным патчем и версия 2.3.0"
```

---

## После всех задач

- [ ] Прогнать обе сюиты начисто на чистом дереве.
- [ ] Прогнать `collect` по настоящему тегу и сравнить размер снапшота с
      прежним: ожидание — плюс порядка сорока байт на патч, и если вышло
      заметно больше, разобраться почему.
- [ ] Загрузить рядом снапшот, собранный до 2.3.0, и новый: убедиться, что
      страница молчит про переписанные патчи, а не показывает их нулём там,
      где их не считали.
- [ ] Отдать ветку на апрув человеку. В `develop` не вливать самому.
