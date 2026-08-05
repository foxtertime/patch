# Полный рефакторинг — план работ

> **Исполнителю:** план идёт задача за задачей. Шаги помечены `- [ ]`.
> Спецификация: `docs/superpowers/specs/2026-08-05-full-refactor-design.md`.

**Цель:** разложить `dashboard/assets/js/ui.js` (2105 строк) по модулям с
одной ответственностью каждый, перевести скрипты на современный синтаксис,
вынести стили из шаблона, упаковать питон-пакет и прибрать корень
репозитория — не сдвинув поведения страницы.

**Устройство:** три вида модулей. Чистые (`text`, `labels`, `markup`,
`tables`, `cards`, `hash`) получают данные доводами и возвращают строки.
Владельцы участков DOM (`rail`, `files`, `tips`) создаются фабрикой
`create(deps)` и держат свои обработчики. Состояние страницы живёт в
`page`, а `ui.js` остаётся корнем сборки: ссылки на DOM,
`render`/`rebuild`/`showTab` и раздача их остальным через объект `app`.

**Чем работаем:** Python 3.9+, стандартная библиотека и `unittest`;
браузерные скрипты — свои, без зависимостей, обёртка UMD вокруг `KP`;
тесты скриптов — `node --test` на заглушке DOM `tests/js/domstub.js`.

## Общие ограничения

Действуют в каждой задаче, повторять в шагах не нужно.

- **Ветвление по гитфлоу.** Каждая задача — своя ветка от свежего
  `develop`, имя дано в задаче. Влитие только `--no-ff`, слитая ветка
  сносится локально и на `origin`. В `master` не лить.
- **Обе сюиты зелёные перед каждым влитием:**
  `python3 -m unittest discover -s tests` (277 тестов) и
  `node --test tests/js/*.test.js` (232 теста). Числа растут по мере
  добавления модульных тестов; падать не должно ничего.
- **Золотая фикстура** `tests/js/fixtures/page-data.golden.json` не
  правится ни в одной задаче. Её нельзя перегенерировать.
- **Формат снапшота** (`schema: 1`) и **ключи в ссылке**
  (`tab`, `tag`, `pair`, `f`, `q`, `sort` и имена фильтров внутри `f=`)
  не меняются.
- **Собранная страница остаётся одним файлом** без внешних запросов.
  Это проверяет `tests/test_build.py`.
- **Перенос дословный.** Задачи 1–4 не переписывают перенесённый код: тело
  функции и её комментарии переезжают как есть. Меняется только то, что
  названо в задаче явно. Комментарии в этом репозитории объясняют, почему
  код такой, а не какой он, — потерять их дороже, чем переписать код.
- **Версию не поднимать.** 2.0.0 не выпущена и лежит в `develop`; записи
  идут в её абзац CHANGELOG. Запись в CHANGELOG делается один раз, в
  задаче 8.

## Раскладка файлов

Создаются (`dashboard/assets/js/`):

| файл | ответственность |
|---|---|
| `text.js` | строки и числа: экранирование, подсветка, склонение, время |
| `labels.js` | как страница называет ключи из данных |
| `markup.js` | куски разметки, общие для обеих таблиц |
| `tables.js` | строки и детали таблиц «Состояние» и «Изменения» |
| `cards.js` | карточки-счётчики и чипы фильтров |
| `page.js` | состояние страницы и всё, что из него считается |
| `hash.js` | разбор и сборка строки адреса |
| `rail.js` | рельс цепочки: разметка, выбор, перестановка |
| `files.js` | загрузка снапшотов файлами |
| `tips.js` | подсказки |

Создаются (`dashboard/assets/css/`): `base.css`, `layout.css`,
`table.css`, `cards.css`, `rail.css`, `tip.css`.

Создаются в корне: `pyproject.toml`.
Создаётся: `dashboard/httpclient.py`.

Правятся: `dashboard/assets/js/ui.js` (худеет до ~260 строк),
`dashboard/assets/dashboard.html`, `dashboard/build.py`,
`dashboard/gitlabclient.py`, `tests/test_build.py`, `README.md`,
`CHANGELOG.md`.

Переезжают: `task` → `docs/task.md`, `ref.html` → `docs/ref.html`.

---

## Задача 1: чистая разметка

**Ветка:** `feature/js-pure`

**Файлы:**
- Создать: `dashboard/assets/js/text.js`
- Создать: `dashboard/assets/js/labels.js`
- Создать: `dashboard/assets/js/markup.js`
- Создать: `dashboard/assets/js/tables.js`
- Создать: `dashboard/assets/js/cards.js`
- Править: `dashboard/assets/js/ui.js`
- Править: `dashboard/build.py` (список `SCRIPTS`)
- Тесты: `tests/js/text.test.js`, `tests/js/labels.test.js`,
  `tests/js/markup.test.js`, `tests/js/tables.test.js`,
  `tests/js/cards.test.js`

**Интерфейсы:**

Отдаёт наружу (на это опираются задачи 2–5):

```js
KP.text = {
  esc(s), hl(s, q), own(map, key), has(value, q), keys(obj),
  setFrom(list), slug(s), plural(n, one, few, many),
  stampOf(value), gapLabel(from, to), safeUrl(url)
};

KP.labels = {
  setClasses(list),        // запоминает классы патчей и строит их подписи
  classes(),               // текущий список, в порядке классификатора
  label(key),              // подпись ключа фильтра или класса
  classCls(name),          // имя css-класса: 'c-cve', незнакомое — 'c-x'
  classOrder(counts),      // порядок классов для конкретного набора
  LABELS, ARROW, KNOWN_CLASS, CALM_MARKS, STATUS_MARKS
};

KP.markup = {
  markHtml(key), marksHtml(marks), linkHtml(url, text), kv(k, v),
  signHtml(markCls), meterHtml(row),
  patchesHtml(patches, q, mark, markCls),
  rpmsHtml(list, q), rpmSideHtml(rows, at, q, markCls),
  rpmSideCount(rows, at),
  taggedCell(row, q), builtHtml(value, q), inheritedNote(inherited),
  mainTagHtml(row, q), otherTagsHtml(row, q),
  taggedText(taggedIn, inherited, q), delta(added, removed)
};

KP.tables = {
  stateRows(items, opt),   // opt: {q, cols, keyOf, openOf}
  diffRows(items, opt),    // opt: {q, cols, keyOf, openOf, oldTag, newTag}
  stateDetail(row, q),
  diffDetail(row, q, oldTag, newTag)
};

KP.cards = {
  stateCards(snap),        // -> {big: '<html>', classes: '<html>'}
  diffCards(pair),         // -> '<html>'
  chips(set)               // -> '<html>', set — объект активных фильтров
};
```

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/js-pure
```

- [ ] **Шаг 2: `text.js`**

Новый файл с обёрткой UMD без зависимостей:

```js
/* Строки и числа: экранирование, подсветка запроса, склонение, время.
   Ничего не знает ни о данных страницы, ни о DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.text = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* сюда переезжают функции */
  return { esc: esc, hl: hl, own: own, has: has, keys: keys,
           setFrom: setFrom, slug: slug, plural: plural,
           stampOf: stampOf, gapLabel: gapLabel, safeUrl: safeUrl };
}));
```

Переехать дословно из `ui.js`: `esc` (191), `hl` (199), `own` (216),
`has` (220), `slug` (225), `plural` (240), `stampOf` (252), константы
`MINUTE`/`HOUR`/`DAY` и `gapLabel` (257–275), `keys` (277),
`setFrom` (283), `safeUrl` (677). Вместе с комментариями над ними.

- [ ] **Шаг 3: `labels.js`**

Зависит от `text` (нужны `own`, `slug`, `keys`). Переезжают: `LABELS`
(110), `CLASS_LABELS` (126), `ARROW` (127), `KNOWN_CLASS` (129),
`CALM_MARKS` (132), `STATUS_MARKS` (135), `classCls` (231), `label` (236),
`classOrder` (291).

Новое — `setClasses`, вынутое из `applyData` (строки 57–66 `ui.js`)
вместе с его комментарием:

```js
  var CLASSES = [];

  function setClasses(list) {
    CLASSES = list || [];
    CLASS_LABELS = {};
    for (var i = 0; i < CLASSES.length; i++) {
      CLASS_LABELS[text.slug(CLASSES[i])] = 'патчи ' + CLASSES[i];
    }
  }

  function classes() { return CLASSES; }
```

`classOrder` берёт список из `CLASSES` этого модуля, а не из `ui.js`.

- [ ] **Шаг 4: `markup.js`**

Зависит от `text`, `labels`, `rpms`. Переезжают: `markHtml` (598),
`taggedCell` (614), `builtHtml` (623), `inheritedNote` (630),
`mainTagHtml` (637), `otherTagsHtml` (645), `taggedText` (659),
`marksHtml` (667), `linkHtml` (682), `meterHtml` (697), `kv` (711),
`signHtml` (716), `patchesHtml` (722), `archOf`/`rowArch` (757–761),
`archGroupHtml` (763), `rpmsHtml` (773), `rpmSideHtml` (794),
`rpmSideCount` (816), `delta` (961).

`archGroupHtml` и `rowArch` наружу не отдаются — они частные.

- [ ] **Шаг 5: `tables.js`**

Зависит от `text`, `labels`, `markup`. Переезжают: `stateDetail` (824),
`stateRowsHtml` (877), `side` (919), `diffDetail` (940),
`diffRowsHtml` (969).

Переименования и развязка со состоянием — единственное, что меняется:

- `stateRowsHtml(items)` → `stateRows(items, opt)`. Вместо `st.q`,
  `colCount('state')`, `rowKey(row)` и `openOf(...)` берутся `opt.q`,
  `opt.cols`, `opt.keyOf(row)`, `opt.openOf(key, deep)`.
- `diffRowsHtml(items)` → `diffRows(items, opt)`, так же; плюс
  `opt.oldTag`/`opt.newTag` вместо обращения к `curPair()` внутри
  `diffDetail`.
- `diffDetail(row, q)` → `diffDetail(row, q, oldTag, newTag)`; строки
  941–942 (`var pair = curPair(); var oldTag = ...`) уезжают к
  вызывающему.

- [ ] **Шаг 6: `cards.js`**

Зависит от `text`, `labels`. Переезжают: `cardHtml` (1000),
`renderStateCards` (1016), `renderDiffCards` (1059), `renderChips` (1110).

Развязка с DOM: функции больше не пишут в `innerHTML`, а возвращают
строки.

```js
  /* Карточки вкладки «Состояние»: большие — про весь тег, мелкие — про
     классы патчей. Возвращаем обе строки сразу: считаются они по одному
     снапшоту, а кладут их в два разных узла. */
  function stateCards(snap) {
    if (!snap) return { big: '', classes: '' };
    /* ... тело прежнего renderStateCards без document.getElementById ... */
    return { big: big, classes: out };
  }
```

`diffCards(pair)` возвращает `''`, когда `pair` пуст.
`chips(set)` принимает объект активных фильтров и возвращает строку;
прежний `renderChips` брал его сам из `activeFilters()`.

`syncCards` (1098) остаётся в `ui.js` — она читает DOM, а не строит его.

- [ ] **Шаг 7: `ui.js` зовёт новые модули**

В `ui.js` удаляются все перенесённые функции. Вместо них — короткие
местные псевдонимы, чтобы тела оставшихся функций не пришлось править:

```js
  var esc = text.esc, hl = text.hl, own = text.own, has = text.has,
      keys = text.keys, setFrom = text.setFrom, slug = text.slug,
      plural = text.plural, stampOf = text.stampOf,
      gapLabel = text.gapLabel, safeUrl = text.safeUrl;
  var label = labels.label, classCls = labels.classCls,
      classOrder = labels.classOrder;
  var markHtml = markup.markHtml, marksHtml = markup.marksHtml,
      linkHtml = markup.linkHtml;
```

Места вызова, которые правятся по существу:

```js
  function render() {
    /* ... */
    body.innerHTML = st.tab === 'diff'
      ? tables.diffRows(items, rowOpts())
      : tables.stateRows(items, rowOpts());
  }

  /* Что таблицам нужно знать о странице: запрос, ширина таблицы, ключ
     строки и её раскрытость. Собрано в одном месте, чтобы обе таблицы
     получали одно и то же. */
  function rowOpts() {
    var pair = st.tab === 'diff' ? curPair() : null;
    return { q: st.q, cols: colCount(st.tab), keyOf: rowKey, openOf: openOf,
             oldTag: pair ? pair.old : 'было',
             newTag: pair ? pair['new'] : 'стало' };
  }

  function renderStateCards() {
    var out = cards.stateCards(curSnap());
    document.getElementById('state-cards').innerHTML = out.big;
    document.getElementById('class-cards').innerHTML = out.classes;
  }

  function renderDiffCards() {
    document.getElementById('diff-cards').innerHTML = cards.diffCards(curPair());
  }

  function renderChips() { chipsBox.innerHTML = cards.chips(activeFilters()); }
```

В `applyData` строки 57–66 заменяются на `labels.setClasses(CLASSES)`.

Обёртка UMD `ui.js` получает новые доводы: `text`, `labels`, `markup`,
`tables`, `cards`.

- [ ] **Шаг 8: `build.py`**

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "labels.js", "markup.js", "tables.js", "cards.js",
           "ui.js")
```

- [ ] **Шаг 9: прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидание: всё зелено, числа те же. `tests/test_build.py` перебирает
`SCRIPTS` сам, править его не нужно.

- [ ] **Шаг 10: модульные тесты на новые модули**

Пять файлов. Пишутся не «на всё подряд», а на то, что раньше было не
достать без DOM. Обязательный минимум:

```js
/* tests/js/text.test.js */
test('подсветка экранирует и то, что подсветила', function () {
  assert.strictEqual(text.hl('<b>ab</b>', 'b'),
    '&lt;<span class="hit">b</span>&gt;ab&lt;/<span class="hit">b</span>&gt;');
});

test('расстояние между снапшотами берёт крупную единицу', function () {
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-09-01T00:00:00+03:00'), '2 мес');
});

test('порядок концов не важен', function () {
  assert.strictEqual(text.gapLabel('2026-09-01T00:00:00+03:00',
                                   '2026-07-01T00:00:00+03:00'), '2 мес');
});

test('меньше минуты не подписывается вовсе', function () {
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-07-01T00:00:30+03:00'), '');
});

test('в href пускают только http и относительный путь', function () {
  assert.strictEqual(text.safeUrl('javascript:alert(1)'), null);
  assert.strictEqual(text.safeUrl('//evil/x'), null);
  assert.strictEqual(text.safeUrl('/rel/x'), '/rel/x');
});
```

```js
/* tests/js/labels.test.js */
test('класс патчей с именем constructor не отвечает функцией', function () {
  labels.setClasses(['constructor']);
  assert.strictEqual(labels.label('constructor'), 'патчи constructor');
  assert.strictEqual(labels.classCls('constructor'), 'c-x');
});

test('смена набора снапшотов уносит подписи прежних классов', function () {
  labels.setClasses(['CVE']);
  labels.setClasses(['SAST']);
  assert.strictEqual(labels.label('cve'), 'cve');
});
```

```js
/* tests/js/cards.test.js — карточки строятся без единого узла DOM */
test('без снапшота карточек нет', function () {
  assert.deepStrictEqual(cards.stateCards(null), { big: '', classes: '' });
});

test('чип несёт ключ фильтра и его подпись', function () {
  var out = cards.chips({ 'no-patch': 1 });
  assert.match(out, /data-chip="no-patch"/);
  assert.match(out, /нет каталога PATCH/);
});

test('второй фильтр добавляет кнопку сброса', function () {
  assert.match(cards.chips({ 'no-patch': 1, 'inherited': 1 }), /сбросить всё/);
});
```

Для `markup.test.js` и `tables.test.js` — по три-четыре проверки на то,
что строится строка, а не на её точную форму: наличие класса `c-cve` в
полоске, прочерк в пустой ячейке тегов, `colspan` из `opt.cols`.

- [ ] **Шаг 11: прогнать сюиты и влить**

```bash
node --test tests/js/*.test.js
python3 -m unittest discover -s tests
git add -A && git commit -m "Чистая разметка уехала из ui.js"
git checkout develop && git merge --no-ff feature/js-pure
git push origin develop && git branch -d feature/js-pure
```

---

## Задача 2: состояние страницы

**Ветка:** `feature/js-page`

**Файлы:**
- Создать: `dashboard/assets/js/page.js`
- Править: `dashboard/assets/js/ui.js`, `dashboard/build.py`
- Тесты: `tests/js/page.test.js`

**Интерфейсы:**

Берёт из задачи 1: `KP.text`, `KP.labels`.
Отдаёт (на это опираются задачи 3–5):

```js
KP.page.create({ viewmodel, diffmod, store, labels, text }) -> {
  st,                        // объект состояния: tab, tag, q, filters, sort
  picked,                    // {tag: bool, pair: bool}
  applyData(pageData),       // только состояние; DOM не трогает
  snapshots(),               // текущий массив снапшотов
  curSnap(), curPair(),
  snapKey(snap), snapIndexByKey(key), snapNamed(at, name),
  currentEnds(), pairKey(ends), pairFor(ends),
  setPairEnds(a, b), selectSnapshot(at),
  anchor(), setAnchor(at),
  activeFilters(), toggleFilter(key),
  visibleRows(), totalRows(), sortRows(items),
  rowKey(row), openOf(key, deep), setOpen(key, on),
  knownFilter(key, tab), dropDeadFilters(),
  lastEndsNamed(left, right), endsFromName(value),
  restore(parsed)            // применяет разобранный адрес; см. задачу 3
}
```

`create` — фабрика, а не синглтон: тесты заводят свежую страницу без
`delete require.cache`.

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/js-page
```

- [ ] **Шаг 2: перенести состояние и запросы к нему**

Из `ui.js` в `page.js` переезжают дословно: `DATA`/`SNAPS`/`PAIRS` (19–20),
`pairSel` (25), `pairCache` (29), `anchor` (33), `st` (162), `expanded`
(179), `picked` (184), `activeFilters` (305), `toggleFilter` (307) без
вызова `render()`, `stateMatches` (321), `diffMatches` (332),
`scanState` (347), `scanDiff` (372), `curSnap`/`curPair` (398–399),
`snapKey` (407), `snapIndexByKey` (411), `currentEnds` (424),
`pairKey` (434), `setPairEnds` (441), `onlyIndexWithTag` (451),
`seedPairs` (465), `pairFor` (479), `visibleRows` (496), `totalRows` (522),
`rowKey` (531), `openOf` (540), `sortValue` (550), `sortRows` (563),
`knownFilter` (1266), `dropDeadFilters` (1286), `snapNamed` (1302),
`lastEndsNamed` (1317), `endsFromHash` (1335, переименовать в
`endsFromName`).

Все комментарии над ними переезжают вместе с ними — там записаны причины,
которые из кода не видны.

- [ ] **Шаг 3: развязать `applyData` с отрисовкой**

Строки 91–105 (`syncTabs`, `readHash`, `dropDeadFilters`, `showTab`,
`rebuild`) из `applyData` убираются: `page.applyData` считает состояние и
останавливается. Порядок вместе с комментариями переезжает в `ui.js`, в
подписчика `store.onChange`:

```js
  store.onChange(function () {
    page.applyData(viewmodel.buildPageData(store.snapshots()));
    syncTabs();
    /* Адрес читаем, только пока он чужой — тот, с которым страницу
       открыли. Дальше в нём лежит наша же прошлая запись, и она вернула бы
       прежний выбор в обход picked, снова похоронив умолчание. Ссылку,
       присланную позже, приносит hashchange. */
    if (!hashIsOurs) readHash();
    page.dropDeadFilters();
    showTab(page.st.tab);
    rebuild();
    renderSources();
    syncEmpty();
  });
```

Новые функции `page`, вынутые из мест, где раньше стояла прямая запись в
состояние:

```js
  /* Явный выбор снапшота человеком: дальше страница держит его именем, и
     приход соседнего снапшота не переселит таблицу на другой прогон. */
  function selectSnapshot(at) { st.tag = at; picked.tag = true; }

  function setOpen(key, on) { expanded[key] = on; }

  function anchorAt() { return anchor; }
  function setAnchor(at) { anchor = at; }
```

- [ ] **Шаг 4: `ui.js` переходит на `page`**

Псевдонимы сверху, как в задаче 1:

```js
  var page = KP.page.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text });
  var st = page.st, picked = page.picked;
  var curSnap = page.curSnap, curPair = page.curPair;
  var visibleRows = page.visibleRows, sortRows = page.sortRows;
  var rowKey = page.rowKey, openOf = page.openOf;
```

`toggleFilter` в `ui.js` становится обёрткой, потому что перерисовка —
дело корня:

```js
  function toggleFilter(key) { page.toggleFilter(key); render(); }
```

Так же обёртками становятся `toggleRow` (1454) и обработчик сортировки
(1522): вычисление уходит в `page`, `render()` остаётся здесь.

- [ ] **Шаг 5: `build.py`** — `page.js` встаёт после `store.js`, до
  `markup.js`.

- [ ] **Шаг 6: сюиты**

```bash
python3 -m unittest discover -s tests && node --test tests/js/*.test.js
```

- [ ] **Шаг 7: `tests/js/page.test.js`**

То, что до сих пор проверялось только через всю страницу и заглушку DOM,
а теперь проверяется прямо:

```js
function make() {
  return KP.page.create({ viewmodel: viewmodel, diffmod: diffmod,
                          store: store, labels: labels, text: text });
}

test('умолчание — последний снапшот и вся цепочка', function () {
  var p = make();
  p.applyData(viewmodel.buildPageData([snapA, snapB, snapC]));
  assert.strictEqual(p.st.tag, 2);
  assert.deepStrictEqual(p.currentEnds(), [0, 2]);
});

test('выбранный человеком снапшот переживает приход соседа', function () {
  var p = make();
  p.applyData(viewmodel.buildPageData([snapA, snapB]));
  p.selectSnapshot(0);
  p.applyData(viewmodel.buildPageData([snapA, snapB, snapC]));
  assert.strictEqual(p.st.tag, 0);
});

test('выгруженный конец диапазона возвращает умолчание', function () {
  var p = make();
  p.applyData(viewmodel.buildPageData([snapA, snapB, snapC]));
  p.setPairEnds(0, 1);
  p.applyData(viewmodel.buildPageData([snapB, snapC]));
  assert.deepStrictEqual(p.currentEnds(), [0, 1]);
});

test('фильтр, которому не осталось строк, снимается', function () {
  var p = make();
  p.applyData(viewmodel.buildPageData([snapA]));
  p.st.filters.state['no-patch'] = 1;
  p.applyData(viewmodel.buildPageData([snapWithAllPatches]));
  p.dropDeadFilters();
  assert.deepStrictEqual(p.activeFilters(), {});
});
```

- [ ] **Шаг 8: сюиты, коммит, влитие** — как в задаче 1, ветка
  `feature/js-page`, сообщение «Состояние страницы уехало из ui.js».

---

## Задача 3: адресная строка

**Ветка:** `feature/js-hash`

**Файлы:**
- Создать: `dashboard/assets/js/hash.js`
- Править: `dashboard/assets/js/ui.js`, `dashboard/assets/js/page.js`,
  `dashboard/build.py`
- Тесты: `tests/js/hash.test.js`

**Интерфейсы:**

Берёт из задачи 2: `page.restore`, `page.snapKey`, `page.pairKey`,
`page.currentEnds`.

```js
KP.hash = {
  /* Только разбор строки. О снапшотах, фильтрах и данных не знает
     ничего: имена оставляет строками, разрешать их — дело page. */
  parse(raw),    // -> {tab, tag, pair, filters, q, sort} — поля, которых
                 //    в строке не было, приходят null
  format(parts)  // -> '#tab=state&tag=…&pair=…&f=…&q=…&sort=name'
};
```

`parse` возвращает: `tab` — строка или `null`; `tag` — строка или `null`;
`pair` — строка или `null`; `filters` — массив или `null` (пустой массив
значит «фильтров нет», это не то же, что `null`); `q` — строка или `null`;
`sort` — `{key, asc}` или `null`.

`format(parts)` принимает `{tab, tag, pair, filters, q, sort}`, где `tag`
и `pair` — уже готовые имена, а `sort` — `{key, asc}`.

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/js-hash
```

- [ ] **Шаг 2: `hash.js`**

`dec` (1256) переезжает как есть. `parse` собирается из тела `readHash`
(1342–1396) — из него берётся только разбор, а всё, что трогает `SNAPS`,
`st` и поля ввода, остаётся вызывающему:

```js
  function parse(raw) {
    var out = { tab: null, tag: null, pair: null, filters: null,
                q: null, sort: null };
    var body = String(raw).replace(/^#/, '');
    if (!body) return out;
    var parts = body.split('&'), i, kvp, key, val;
    for (i = 0; i < parts.length; i++) {
      kvp = parts[i].split('=');
      key = kvp[0];
      val = dec(kvp.slice(1).join('=') || '');
      if (val === null) continue;   /* битый кусок пропускаем, остальные читаем */
      if (key === 'tab') out.tab = val;
      else if (key === 'tag') out.tag = val;
      else if (key === 'pair') out.pair = val;
      else if (key === 'f') out.filters = val ? val.split(',') : [];
      else if (key === 'q') out.q = val.trim().toLowerCase();
      else if (key === 'sort') {
        var bits = val.split(':');
        if (bits[0]) out.sort = { key: bits[0], asc: bits[1] !== 'desc' };
      }
    }
    return out;
  }
```

`format` собирается из `writeHash` (1221–1239) — из него берётся склейка
строки, а `history.replaceState` остаётся вызывающему:

```js
  function format(parts) {
    var out = ['tab=' + parts.tab];
    if (parts.tag) out.push('tag=' + encodeURIComponent(parts.tag));
    if (parts.pair) out.push('pair=' + encodeURIComponent(parts.pair));
    /* f= пишем всегда, в том числе пустой: у вкладки «Изменения» фильтр по
       умолчанию непустой, и без явного «фильтров нет» ссылка на таблицу со
       снятым фильтром при открытии снова показывала бы только изменившиеся. */
    out.push('f=' + encodeURIComponent((parts.filters || []).join(',')));
    if (parts.q) out.push('q=' + encodeURIComponent(parts.q));
    out.push('sort=' + parts.sort.key + (parts.sort.asc ? '' : ':desc'));
    return '#' + out.join('&');
  }
```

- [ ] **Шаг 3: `page.restore`**

В `page.js` заводится единственное место, где разобранный адрес
превращается в состояние. Сюда переезжают куски `readHash`, которые
знают о цепочке (1352–1390) — вместе с их комментариями:

```js
  /* Разобранный адрес превращается в состояние страницы. Имена снапшотов
     сопоставляются с цепочкой здесь, а не при разборе: разбор не должен
     знать, что за снапшоты сейчас на странице. */
  function restore(parsed) {
    var dropped = false, filters = parsed.filters, j;
    if (parsed.tab !== null) {
      /* Сравнивать нечего — вкладки «Изменения» на странице тоже нет. */
      if (parsed.tab === 'diff' && SNAPS.length < 2) dropped = true;
      st.tab = (parsed.tab === 'diff' && SNAPS.length > 1) ? 'diff' : 'state';
    }
    /* ... tag, pair — дословно из readHash ... */
    if (dropped) filters = null;
    if (filters) st.filters[st.tab] = setFrom(filters);
    if (parsed.sort) st.sort[st.tab] = parsed.sort;
    if (parsed.q !== null) st.q = parsed.q;
  }
```

- [ ] **Шаг 4: `ui.js` — связывание**

В корне остаётся то, что и должно: чтение `location.hash`, запись через
`history.replaceState`, признаки `hashLock`/`hashIsOurs` и поля ввода.

```js
  function readHash() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) return false;
    page.restore(hash.parse(raw));
    search.value = page.st.q;
    /* Запрос мог приехать из ссылки — крестик обязан появиться вместе
       с ним, а не ждать первого касания клавиатуры. */
    clearBtn.hidden = !search.value;
    return true;
  }

  function writeHash() {
    var snaps = page.snapshots();
    var next = hash.format({
      tab: page.st.tab,
      tag: snaps.length ? page.snapKey(snaps[page.st.tag]) : null,
      pair: snaps.length > 1 ? page.pairKey(page.currentEnds()) : null,
      filters: text.keys(page.activeFilters()).sort(),
      q: page.st.q,
      sort: page.st.sort[page.st.tab]
    });
    hashIsOurs = true;
    if (location.hash === next) return;
    /* ... прежние hashLock и replaceState дословно ... */
  }
```

- [ ] **Шаг 5: `build.py`** — `hash.js` после `page.js`.

- [ ] **Шаг 6: сюиты**

```bash
python3 -m unittest discover -s tests && node --test tests/js/*.test.js
```

- [ ] **Шаг 7: `tests/js/hash.test.js`**

Разбор ссылки — самое хрупкое место страницы, и теперь его видно целиком:

```js
test('битый процент не уносит разбор целиком', function () {
  var out = hash.parse('#tab=diff&q=%zz&sort=name');
  assert.strictEqual(out.tab, 'diff');
  assert.strictEqual(out.q, null);
  assert.deepStrictEqual(out.sort, { key: 'name', asc: true });
});

test('пустой f= значит «фильтров нет», а не «фильтров не было»', function () {
  assert.deepStrictEqual(hash.parse('#f=').filters, []);
  assert.strictEqual(hash.parse('#tab=state').filters, null);
});

test('знак равенства внутри значения переживает разбор', function () {
  assert.strictEqual(hash.parse('#q=a%3Db').q, 'a=b');
});

test('сборка и разбор сходятся', function () {
  var parts = { tab: 'diff', tag: 'os-9.2@2026-07-01T00:00:00+03:00',
                pair: 'a..b', filters: ['changed'], q: 'nginx',
                sort: { key: 'name', asc: false } };
  var back = hash.parse(hash.format(parts));
  assert.strictEqual(back.tab, 'diff');
  assert.strictEqual(back.tag, parts.tag);
  assert.deepStrictEqual(back.filters, ['changed']);
  assert.deepStrictEqual(back.sort, { key: 'name', asc: false });
});

test('f= пишется даже пустым', function () {
  assert.match(hash.format({ tab: 'state', tag: null, pair: null,
                             filters: [], q: '',
                             sort: { key: 'name', asc: true } }), /&f=&/);
});
```

- [ ] **Шаг 8: сюиты, коммит, влитие** — ветка `feature/js-hash`,
  сообщение «Адресная строка разобрана отдельно от состояния».

---

## Задача 4: владельцы участков DOM

**Ветка:** `feature/js-components`

**Файлы:**
- Создать: `dashboard/assets/js/rail.js`, `dashboard/assets/js/files.js`,
  `dashboard/assets/js/tips.js`
- Править: `dashboard/assets/js/ui.js`, `dashboard/build.py`
- Тесты: `tests/js/ui.test.js` (существующие, править не надо)

**Интерфейсы:**

```js
KP.rail.create({ box, page, store, text, app, hideTip }) -> {
  render(),           // перерисовать рельс целиком
  pickNode(at)        // клик по узлу: смысл зависит от вкладки
};

KP.files.create({ store, text, dom }) -> {
  openPicker()        // остальное — свои обработчики, наружу не торчат
};
// dom: {input, drop, errors, pick} — сообщения об отвергнутых файлах
// модуль пишет в dom.errors сам, наружу о них не сообщает

KP.tips.create({ node }) -> { hide() };
```

`app` — объект корня с `render()` и `rebuild()`. Заводится в `ui.js`
пустым до определения методов и заполняется по ходу; модули берут метод в
момент вызова.

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/js-components
```

- [ ] **Шаг 2: `rail.js`**

Переезжают дословно: `renderChain` (1721), `railHtml` (1753),
`stopHtml` (1768), `nodeTip` (1790), `source` (1796), `ghostHtml` (1806),
`focusNode` (1817), `pickNode` (1832), `NODE_MIME`/`dragFrom`/`dropAt`
(1870–1874), `chipOf` (1876), `marks` (1891), `clearMarks` (1896),
`endDrag` (1901) и четыре обработчика `dragstart`/`dragover`/`drop`/
`dragend` (1903–1952).

Правки: `st.tab` → `page.st.tab`, `st.tag` → `page.st.tag`,
`anchor` → `page.anchor()`/`page.setAnchor()`, `render()` → `app.render()`,
`renderStateCards()`/`renderDiffCards()` → `app.rebuildCards()`,
`hideTip()` → `deps.hideTip()`.

- [ ] **Шаг 3: `files.js`**

Переезжают дословно: `ERRORS_LIFE`/`ERRORS_FADE`/`errorsTimers`
(1979–1981), `stopErrorsTimers` (1983), `showErrors` (1988),
`loadFiles` (2009), `openPicker` (2040), обработчик `change` на поле
(2044), `markOver` (2051), `hasFiles` (2062) и три обработчика
`dragover`/`dragleave`/`drop` на документе (2075–2090).

`syncEmpty` (1694) остаётся в `ui.js`: она прячет и показывает вкладки,
а вкладки — не забота загрузчика.

- [ ] **Шаг 4: `tips.js`**

Переезжают: `TIP_DELAY` (1596), `tipAnchor` (1601), `placeTip` (1609),
`hideTip` (1624) и пять слушателей (1632–1651). Наружу — только `hide`,
потому что её зовут `render` и `pickNode`.

- [ ] **Шаг 5: `ui.js` собирает всех**

```js
  /* Корень заполняется по ходу: модули берут метод в момент вызова, а не
     в момент создания, и порядок объявлений здесь ничего не решает. */
  var app = {};
  var tips = KP.tips.create({ node: document.getElementById('tip') });
  var rail = KP.rail.create({ box: chainBox, page: page, store: store,
                              text: text, app: app, hideTip: tips.hide });
  var files = KP.files.create({ store: store, text: text,
    dom: { input: fileInput, drop: dropZone, errors: loadErrors,
           pick: pickBtn } });
  app.render = render;
  app.rebuild = rebuild;
  app.rebuildCards = function () { renderStateCards(); renderDiffCards(); };
```

- [ ] **Шаг 6: `build.py`** — `rail.js`, `files.js`, `tips.js` перед
  `ui.js`.

- [ ] **Шаг 7: сюиты**

```bash
python3 -m unittest discover -s tests && node --test tests/js/*.test.js
```

`ui.test.js` не правится: он проверяет страницу снаружи, и если после
переезда обработчиков хоть один клик перестал доезжать — он это скажет.

- [ ] **Шаг 8: снимок страницы**

Сюиты не видят вёрстки. Собрать страницу, открыть в headless Firefox с
двумя-тремя снапшотами, посмотреть рельс, таблицу и подсказку:

```bash
python3 -m dashboard page -o /tmp/claude-1000/dash.html
```

- [ ] **Шаг 9: коммит и влитие** — ветка `feature/js-components`,
  сообщение «Рельс, загрузка и подсказки стали отдельными модулями».
  В этот же коммит — обновлённая шапка `ui.js`: она больше не «поведение
  страницы», а корень сборки.

---

## Задача 5: современный синтаксис

**Ветка:** `feature/js-es2015`

**Файлы:** все `dashboard/assets/js/*.js`, все `tests/js/*.test.js`.

Механический проход. Ничего не переезжает, ни одна функция не меняет
места — иначе диффа этой задачи не прочитать.

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/js-es2015
```

- [ ] **Шаг 2: по одному файлу за раз, снизу вверх по зависимостям**

Порядок: `vercmp`, `rpms`, `diff`, `viewmodel`, `store`, `text`, `labels`,
`page`, `markup`, `tables`, `cards`, `hash`, `rail`, `files`, `tips`, `ui`.

Что делается в каждом:

- `var` → `const`, а где значение переприсваивается — `let`.
- Склейка разметки через `+` → шаблонные строки. Это главное: в
  `markup.js`, `tables.js` и `cards.js` она занимает больше половины
  файла.
- Анонимные `function () {}` в обработчиках и колбэках → стрелки. Именованные
  функции остаются функциями: имя видно в стеке.
- `for (var i = 0; i < list.length; i++)` по массиву → `for (const x of list)`
  там, где номер не нужен.
- `Array.prototype.slice.call(nodeList)` → `Array.from(nodeList)`.
- Доводы-объекты → деструктуризация в сигнатуре:
  `function stateRows(items, { q, cols, keyOf, openOf })`.

Чего **не** делается: классы вместо фабрик, `Map`/`Set` вместо голых
объектов (голые объекты уезжают в `JSON.stringify` и приезжают из него),
`?.` и `??` — незачем, а поддержку сужают.

- [ ] **Шаг 3: после каждого файла — обе сюиты**

```bash
node --test tests/js/*.test.js && python3 -m unittest discover -s tests
```

Файл за файлом, а не всё разом: упавший тест должен указывать на один
файл.

- [ ] **Шаг 4: коммит по файлу**

`git commit -m "Современный синтаксис: <имя>.js"` — шестнадцать коммитов.
Так диффы читаются, и откатить можно один файл.

- [ ] **Шаг 5: снимок страницы и влитие** — ветка `feature/js-es2015`,
  сообщение «Скрипты на современном синтаксисе».

---

## Задача 6: стили из шаблона

**Ветка:** `feature/css-split`

**Файлы:**
- Создать: `dashboard/assets/css/base.css`, `layout.css`, `table.css`,
  `cards.css`, `rail.css`, `tip.css`
- Править: `dashboard/assets/dashboard.html`, `dashboard/build.py`,
  `tests/test_build.py`

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/css-split
```

- [ ] **Шаг 2: разложить `<style>` (строки 10–640 шаблона)**

- `base.css` — `:root` с переменными, сброс, шрифты, `body`, `h1`,
  общие `.mono`, `.none`, `.note`, `.hit`, ссылки.
- `layout.css` — шапка, `.panel`, `.tabs`, `#controls`, `.chips`,
  `.drop`, `.problems`, `#totop`, `.srchead`.
- `table.css` — `table`, `th`, `td`, `.main-row`, `.detail`, `.block`,
  `.kv`, `.pgroup`, `.plist`, `.rlist`, `.sides`, `.side`, `.meter`,
  `.patcell`, `.mark`.
- `cards.css` — `.cards`, `.card` и всё внутри неё.
- `rail.css` — `.chain`, `.stop`, `.pick`, `.kill`, `.ghost`, `.rl`,
  `.gap`, `.sum`, пометки перетаскивания `before`/`after`/`moving`.
- `tip.css` — `#tip`.

Правило разреза: селектор едет туда, где живёт узел, к которому он
относится. Спорные — в `base.css`.

- [ ] **Шаг 3: шаблон**

Вместо блока `<style>…</style>` — одна строка:

```html
<!--__STYLES__-->
```

- [ ] **Шаг 4: `build.py`**

```python
STYLE_PLACEHOLDER = "<!--__STYLES__-->"
# Порядок тот же, что был в шаблоне: каскад решает порядком, и
# перестановка файлов молча меняет вид страницы.
STYLES = ("base.css", "layout.css", "table.css", "cards.css", "rail.css",
          "tip.css")
```

В `build_html` — проверка на плейсхолдер (как для `__SCRIPTS__`) и
подстановка одним `<style>` с комментарием-именем перед каждым файлом,
как это сделано для скриптов.

- [ ] **Шаг 5: `tests/test_build.py`**

Добавить три проверки по образцу существующих для скриптов:

```python
    def test_every_style_is_inlined(self):
        html = build_html()
        for name in STYLES:
            self.assertIn("/* %s */" % name, html)

    def test_styles_keep_cascade_order(self):
        html = build_html()
        positions = [html.index("/* %s */" % name) for name in STYLES]
        self.assertEqual(positions, sorted(positions))

    def test_missing_style_placeholder_is_an_error(self):
        with self.assertRaises(BuildError):
            build_html(self.template_without("<!--__STYLES__-->"))
```

- [ ] **Шаг 6: проверить `domstub.js`**

Заглушка разбирает шаблон и раньше пропускала содержимое `<style>`.
Теперь на его месте комментарий. Прогнать `node --test tests/js/*.test.js`
и, если заглушка споткнулась о комментарий, научить её его пропускать.

- [ ] **Шаг 7: сюиты и снимок**

Собрать страницу, открыть, сверить с прежним видом. Здесь ошибка
каскада — единственный настоящий риск задачи, и сюиты её не увидят.

- [ ] **Шаг 8: влитие** — ветка `feature/css-split`, сообщение «Стили
  выехали из шаблона».

---

## Задача 7: упаковка питона

**Ветка:** `feature/py-packaging`

**Файлы:**
- Создать: `pyproject.toml`, `dashboard/httpclient.py`
- Править: `dashboard/gitlabclient.py`, `README.md`
- Тесты: `tests/test_httpclient.py` (новый),
  `tests/test_gitlabclient.py` (правится)

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/py-packaging
```

- [ ] **Шаг 2: `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "dashboard"
description = "Дашборд патчей koji и GitLab"
requires-python = ">=3.9"
dynamic = ["version"]

[project.scripts]
dashboard = "dashboard.cli:main"

[tool.setuptools]
packages = ["dashboard"]

[tool.setuptools.package-data]
dashboard = ["assets/*.html", "assets/js/*.js", "assets/css/*.css"]

[tool.setuptools.dynamic]
version = {attr = "dashboard.__version__"}
```

`version` берётся из `dashboard/__init__.py`: номер и дальше записан в
одном месте.

Зависимости в `[project]` не перечисляются: `koji`, `requests` и `PyYAML`
ставят системой, и прибивать их версии здесь значило бы драться с
пакетным менеджером дистрибутива. Это стоит сказать в README.

- [ ] **Шаг 3: проверить, что пакет ставится**

```bash
python3 -m pip install --user -e . && dashboard --version
```

Ожидание: печатает номер версии, выходит с кодом 0.

- [ ] **Шаг 4: `httpclient.py`**

Из `gitlabclient.py` переезжают: `_RETRY_STATUSES` (11), `_BODY_LIMIT`
(15), `HttpTransport` (21–44), `_Response` (46–51),
`_get_with_retries` (230–285), `_delay` (286–297), `_message` (304),
`_params_note` (311), `_body_note` (322).

`_scrub` (67–97) переезжает тоже: чистка токена из сообщений — свойство
транспорта, а не клиента GitLab. Токен передаётся в конструктор:

```python
class HttpClient:
    """HTTP с повторами, паузами и чисткой секретов из сообщений."""

    def __init__(self, transport=None, token=None, tries=4):
```

`GitlabClient` получает `HttpClient` и остаётся при своём API:
`patch_files`, `tree_url`, `blob_url` не меняются, тесты на них — тоже.

- [ ] **Шаг 5: тесты**

Проверки из `tests/test_gitlabclient.py`, которые на самом деле про
повторы, паузы и чистку токена, переезжают в `tests/test_httpclient.py`
как есть. Что остаётся в `test_gitlabclient.py` — проверки про дерево,
ветки и адреса.

- [ ] **Шаг 6: сюиты и влитие** — ветка `feature/py-packaging`,
  сообщение «Пакет ставится, HTTP отделён от GitLab».

---

## Задача 8: уборка корня

**Ветка:** `feature/repo-tidy`

**Файлы:**
- Переместить: `task` → `docs/task.md`, `ref.html` → `docs/ref.html`
- Править: `README.md`, `CHANGELOG.md`

- [ ] **Шаг 1: ветка**

```bash
git checkout develop && git pull --ff-only && git checkout -b feature/repo-tidy
```

- [ ] **Шаг 2: переезд**

```bash
git mv task docs/task.md
git mv ref.html docs/ref.html
```

В начало `docs/task.md` — строка о том, что это исходная постановка от
2026-08-03, сохранённая как есть.

- [ ] **Шаг 3: README**

Новый раздел «Как разложены скрипты и стили» — таблица из спецификации:
файл и за что отвечает. Плюс строка о том, что пакет ставится
`pip install -e .` и даёт команду `dashboard`.

- [ ] **Шаг 4: прибрать `ui.test.js`**

Переезд закончен, и часть его 94 проверок теперь дословно повторяется
модульными тестами. Пройти файл сверху вниз и убрать из него ровно те,
у которых в `text.test.js`, `labels.test.js`, `cards.test.js`,
`hash.test.js` или `page.test.js` есть близнец с тем же утверждением.

Всё, что проверяет связывание — что клик доехал, что узел нашёлся, что
загруженный снапшот появился в таблице, — остаётся: проверять это больше
нечем. Если сомневаешься, повтор перед тобой или нет — оставляй.

После правки прогнать `node --test tests/js/*.test.js`: общее число
тестов должно упасть ровно на число убранных.

- [ ] **Шаг 5: CHANGELOG**

В абзац невыпущенной 2.0.0 — запись о рефакторинге: `ui.js` разложен по
модулям, стили выехали из шаблона, пакет ставится. Отдельной строкой —
каждая мелочь поведения, если по дороге что-то починилось.

- [ ] **Шаг 6: сюиты и влитие** — ветка `feature/repo-tidy`, сообщение
  «Корень репозитория прибран».

---

## После всех задач

`develop` содержит невыпущенную 2.0.0 с рефакторингом. Релиз — слияние в
`master` и тег `v2.0.0` — делается **только по отдельной просьбе**.
