# Дифф между любой парой снапшотов — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** во вкладке «Изменения» выбирать дифф между любыми двумя
загруженными снапшотами, кликая по узлам рельса цепочки.

**Architecture:** выбранный переход перестаёт быть номером в массиве
предпосчитанных пар и становится парой имён снапшотов (`тег@время-сбора`).
Переход, которого нет среди предпосчитанных, считается в момент выбора и
кладётся в кэш. Ряд кнопок-пар уходит, его работу берут на себя узлы
рельса.

**Tech Stack:** JavaScript ES5-стиля без сборщиков, `node --test` (node
v22) на заглушке DOM `tests/js/domstub.js`.

## Global Constraints

- JS в стиле нынешних файлов: `var`, `function`, без стрелок, без
  `let`/`const`, без шаблонных строк, без `class`.
- Никаких зависимостей и никаких внешних ресурсов в собранной странице.
- Комментарии по-русски, объясняют **почему**. Комментарий, обещающий то,
  чего код не делает, — дефект.
- «Неизвестно» не выдаётся за определённое значение.
- Состав `buildPageData` не меняется, `tests/js/fixtures/page-data.golden.json`
  не трогается. Тест сверки с эталоном обязан проходить без правок.
- Оба набора зелёные: `python3 -m unittest discover -s tests -t . -q`
  (263) и `node --test tests/js/*.test.js` (200).
- Направление перехода задаёт порядок цепочки, а не порядок кликов: «было»
  всегда левее.

---

## Файловая структура после всех задач

```
kojipatch/assets/js/viewmodel.js  + экспорт pairBlock
kojipatch/assets/js/ui.js         выбор пары именами, кэш, расчёт по
                                  требованию, выбор кликами по рельсу
kojipatch/assets/dashboard.html   без #pair-select, стили якоря на рельсе
tests/js/ui.test.js               тесты выбора пары переписаны на рельс
README.md                         раздел про вкладку «Изменения»
```

Удаляются: `renderPairSelect`, `endHtml`, `pairEnds`, `pairKey(index)` в
`ui.js`; блок `<div class="selector" id="pair-select">` в шаблоне.

---

### Task 1: переход выбирается именами снапшотов, а не номером

Пока — тот же селектор и те же переходы, что сейчас. Меняется только то,
чем переход назван внутри, и появляется расчёт по требованию: без него
key-модель не полна, потому что предпосчитанные пары названы тегами, а тег
в цепочке может встречаться дважды.

**Files:**
- Modify: `kojipatch/assets/js/viewmodel.js` (экспорт)
- Modify: `kojipatch/assets/js/ui.js`
- Test: `tests/js/ui.test.js`

**Interfaces:**
- Consumes: `KP.diff.diffSnapshots(oldSnap, newSnap, isSummary)` из
  `diff.js`; `store.snapshots()` — сырые снапшоты в порядке цепочки
- Produces: в `viewmodel` — `pairBlock(pair, snapshots)`; в `ui.js` —
  `currentEnds() -> [lo, hi] | null`, `pairKeyOf(ends) -> string`,
  `setPairEnds(lo, hi)`, `pairFor(ends) -> блок пары | null`

- [ ] **Step 1: Тест на переход, которого нет среди предпосчитанных**

Диапазон, которого нет в предпосчитанных, достижим через адресную строку:
её разбор в этой же задаче учится называть любой диапазон. Тестового
экспорта ради одной проверки не заводим — production-код не должен носить
дверь, которой пользуются только тесты.

Дописать в `tests/js/ui.test.js`:

```js
/* Предпосчитаны только соседние переходы и сводный. Любой другой диапазон
   должен считаться на месте, иначе «выбрать любой диапазон» означало бы
   «увидеть пустую таблицу». Заходим через адрес: другого пути к такому
   диапазону в этой задаче ещё нет. */
var SEP = '2026-09-01T00:00:00+03:00';
var OCT = '2026-10-01T00:00:00+03:00';

test('переход, которого нет в предпосчитанных, считается по требованию',
  function () {
    var want = 'os-9.2@' + AUG + '..os-9.4@' + OCT;
    var dom = load({ hash: '#tab=diff&pair=' + encodeURIComponent(want) });
    store.add([snap('os-9.1', JUL, { builds: [build('a', { version: '1.0' })] }),
               snap('os-9.2', AUG, { builds: [build('a', { version: '2.0' })] }),
               snap('os-9.3', SEP, { builds: [build('a', { version: '3.0' })] }),
               snap('os-9.4', OCT, { builds: [build('a', { version: '4.0' })] })],
              'a.json');
    /* Соседние переходы это 9.1→9.2, 9.2→9.3, 9.3→9.4, сводный — 9.1→9.4.
       Запрошенный 9.2→9.4 не совпадает ни с одним. */
    assert.doesNotMatch(dom.id('diff-rows').innerHTML, /class="empty"/,
                        dom.id('diff-rows').innerHTML);
    /* Версия выросла с 2.0 до 4.0 — значит сравнили именно эти концы, а не
       откатились на умолчание «вся цепочка», где было бы 1.0 → 4.0. */
    assert.match(dom.id('diff-rows').innerHTML, /2\.0/,
                 dom.id('diff-rows').innerHTML);
    assert.strictEqual(dom.id('diff-rows').innerHTML.indexOf('1.0'), -1,
                       dom.id('diff-rows').innerHTML);
  });
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `node --test tests/js/ui.test.js`
Expected: FAIL — адрес с таким диапазоном сейчас не разбирается, страница
показывает сводный переход 9.1 → 9.4, и в разметке есть `1.0`

- [ ] **Step 3: Экспорт pairBlock и расчёт по требованию**

В `kojipatch/assets/js/viewmodel.js` заменить строку экспорта:

```js
  return { buildPageData: buildPageData, slug: slug, toMsk: toMsk,
           patchClassesOf: patchClassesOf, pairBlock: pairBlock };
```

В `kojipatch/assets/js/ui.js` подключить `diff.js` — фабрика получает его
четвёртым:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./viewmodel.js'), require('./store.js'),
                             require('./rpms.js'), require('./diff.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.rpms,
                         root.KP.diff);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, rpmsmod, diffmod) {
```

Рядом с `var SNAPS = [], PAIRS = [], CLASSES = [];` добавить:

```js
  /* Выбранный переход — имена снапшотов, а не номер в массиве. Номер
     значил что-то, только пока переходы приходили готовым списком в
     известном порядке; с произвольными диапазонами он не значит ничего, а
     имя переживает и перестановку цепочки, и выгрузку соседа. */
  var pairSel = { from: null, to: null };
  /* Посчитанные переходы по имени диапазона. Заводится заново на каждую
     смену состава: снапшот с тем же именем — тот же файл, но набор вокруг
     него другой, и сводность диапазона могла измениться. */
  var pairCache = {};
```

Дальше — функции разрешения диапазона. Ставить их рядом с `snapKey`,
вместо удаляемых `pairEnds` и `pairKey`:

```js
  function snapIndexByKey(key) {
    for (var i = 0; i < SNAPS.length; i++) {
      if (snapKey(SNAPS[i]) === key) return i;
    }
    return -1;
  }

  /* Концы выбранного перехода в порядке цепочки. Направление задаёт
     цепочка, а не порядок кликов: «было» — то, что левее. Обратный порядок
     поменял бы местами «появился» и «исчез», причём молча.

     Ничего не выбрано или конец выгрузили — умолчание «вся цепочка»: то же
     самое, что дашборд показывал и раньше, просто названное иначе. */
  function currentEnds() {
    if (SNAPS.length < 2) return null;
    var a = snapIndexByKey(pairSel.from), b = snapIndexByKey(pairSel.to);
    if (a === -1 || b === -1 || a === b) return [0, SNAPS.length - 1];
    return a < b ? [a, b] : [b, a];
  }

  function pairKeyOf(ends) {
    if (!ends || !SNAPS[ends[0]] || !SNAPS[ends[1]]) return '';
    return snapKey(SNAPS[ends[0]]) + '..' + snapKey(SNAPS[ends[1]]);
  }

  function setPairEnds(lo, hi) {
    pairSel.from = snapKey(SNAPS[lo]);
    pairSel.to = snapKey(SNAPS[hi]);
    picked.pair = true;
  }

  /* Единственный тег в цепочке с таким именем, иначе -1. Предпосчитанные
     переходы названы тегами, а один тег законно приходит из двух прогонов;
     такую пару по имени не опознать, и в кэш она не попадёт — её посчитают
     по требованию. */
  function onlyIndexWithTag(tag) {
    var found = -1, i;
    for (i = 0; i < SNAPS.length; i++) {
      if (SNAPS[i].tag !== tag) continue;
      if (found !== -1) return -1;
      found = i;
    }
    return found;
  }

  /* Кэш наполняем тем, что уже посчитано при загрузке. Сопоставляем по
     именам концов, а не по раскладке diffChain: знать, что она кладёт
     сперва соседей, а потом сводную пару, здесь незачем — она может
     измениться, и молчаливый переезд был бы худшим из исходов. */
  function seedPairs() {
    pairCache = {};
    var i, lo, hi;
    for (i = 0; i < PAIRS.length; i++) {
      lo = onlyIndexWithTag(PAIRS[i].old);
      hi = onlyIndexWithTag(PAIRS[i]['new']);
      if (lo === -1 || hi === -1 || lo >= hi) continue;
      pairCache[pairKeyOf([lo, hi])] = PAIRS[i];
    }
  }

  /* Переход для этих концов: из кэша, а если его там нет — считаем и
     кладём. Расчёт синхронный: это один дифф, столько же работы, сколько
     страница уже делает на загрузке для каждого соседнего перехода. */
  function pairFor(ends) {
    if (!ends) return null;
    var key = pairKeyOf(ends);
    if (own(pairCache, key)) return pairCache[key];
    var raw = store.snapshots();
    if (!raw[ends[0]] || !raw[ends[1]]) return null;
    /* Сводным считается диапазон во всю цепочку, и только когда снапшотов
       больше двух: на двух единственный переход и есть вся цепочка, и
       подписывать его итогом значит сообщать очевидное. */
    var summary = ends[0] === 0 && ends[1] === SNAPS.length - 1
      && SNAPS.length > 2;
    var block = viewmodel.pairBlock(
      diffmod.diffSnapshots(raw[ends[0]], raw[ends[1]], summary), raw);
    pairCache[key] = block;
    return block;
  }
```

`curPair` переписывается на новую модель:

```js
  function curPair() { return pairFor(currentEnds()); }
```

Удалить целиком `pairEnds` и `pairKey`. Все их вызовы заменить:

| было | стало |
|---|---|
| `pairEnds(st.pair)` в `renderChain` | `currentEnds()` |
| `pairEnds(i)` в `renderPairSelect` | `[i, i + 1]` при `!p.summary`, иначе `[0, SNAPS.length - 1]` |
| `pairKey(st.pair)` в `writeHash` и `rowKey` | `pairKeyOf(currentEnds())` |
| `pairKey(ci)`/`pairKey(p)` в `applyData` и `readHash` | см. ниже |

В `renderPairSelect` знание раскладки остаётся до Task 2, где сам селектор
удаляется; чтобы не тащить его в общие функции, посчитать концы прямо в
цикле рендера. Там же чинится отметка нажатой кнопки: сравнения
`i === st.pair` больше нет, вместо него — совпадение посчитанных концов с
`currentEnds()`. Без этого нажатой не окажется ни одна кнопка, и тест,
который ищет `data-pair="N" aria-pressed="true"`, покраснеет — а править
его в этой задаче нельзя.

В `applyData` восстановление выбора:

```js
    var wantPair = picked.pair ? pairKeyOf(currentEnds()) : null;
```

и после присваивания `SNAPS`/`PAIRS`:

```js
    seedPairs();
    /* Умолчание: вся цепочка. Выбор восстанавливаем, только если оба его
       конца ещё на странице; иначе снова работает умолчание. */
    var foundPair = false;
    if (wantPair) {
      var parts = wantPair.split('..');
      if (snapIndexByKey(parts[0]) !== -1 && snapIndexByKey(parts[1]) !== -1) {
        pairSel.from = parts[0];
        pairSel.to = parts[1];
        foundPair = true;
      }
    }
    if (!foundPair) { pairSel.from = null; pairSel.to = null; }
```

Строку `st.pair = PAIRS.length ? PAIRS.length - 1 : 0;` удалить, поле
`pair` из объекта `st` удалить.

В `readHash`, разбор `pair=`:

```js
    } else if (key === 'pair') {
      var ends = endsFromHash(val);
      if (ends) { pairSel.from = snapKey(SNAPS[ends[0]]);
                  pairSel.to = snapKey(SNAPS[ends[1]]); picked.pair = true; }
    }
```

и рядом — разбор имени диапазона, полного и короткого:

```js
  /* Имя диапазона из адреса. Полная форма называет прогоны
     («os-9.2@2026-08-01T00:00:00+03:00»), короткая — теги; короткую
     оставляем читаемой, потому что её пишут руками и присылают в
     переписке. У двойников тега она выбирает последний подходящий — так
     было и раньше. */
  function endsFromHash(value) {
    var at = String(value).indexOf('..');
    if (at === -1) return null;
    var left = value.slice(0, at), right = value.slice(at + 2);
    var lo = snapIndexByKey(left), hi = snapIndexByKey(right), i;
    if (lo === -1) { for (i = 0; i < SNAPS.length; i++) {
      if (SNAPS[i].tag === left) lo = i; } }
    if (hi === -1) { for (i = 0; i < SNAPS.length; i++) {
      if (SNAPS[i].tag === right) hi = i; } }
    if (lo === -1 || hi === -1 || lo === hi) return null;
    return lo < hi ? [lo, hi] : [hi, lo];
  }
```

В `syncTabs` и `showTab` условие наличия вкладки заменить с `PAIRS.length`
на `SNAPS.length > 1`: переход теперь есть всегда, когда снапшотов больше
одного, и предпосчитанный список этого больше не решает. В `readHash`
заменить так же.

Обработчик клика по кнопке селектора (`data-pair`) переписать:

```js
      var pair = node.getAttribute('data-pair');
      if (pair !== null && pair !== undefined) {
        var at = parseInt(pair, 10), p = PAIRS[at];
        if (p) {
          setPairEnds.apply(null, p.summary ? [0, SNAPS.length - 1]
                                            : [at, at + 1]);
        }
        renderPairSelect(); renderDiffCards(); render();
        return;
      }
```

- [ ] **Step 4: Прогнать оба набора**

Run: `node --test tests/js/*.test.js && python3 -m unittest discover -s tests -t . -q`
Expected: PASS 201 (200 прежних + новый), OK 263

**Ни один существующий тест править нельзя.** Это рефакторинг: снаружи
ничего не изменилось, и если тест покраснел — изменилось поведение, а не
тест устарел. Разберитесь до конца, прежде чем трогать тесты.

- [ ] **Step 5: Тест на цепочку с двойниками тега**

```js
/* Предпосчитанные переходы названы тегами, а два прогона одного тега —
   законный случай. Опознать такую пару по имени нельзя, и в кэш она не
   попадёт: её обязан посчитать расчёт по требованию, иначе вкладка
   «Изменения» на таких цепочках опустела бы. */
test('переход между двумя прогонами одного тега считается и не пуст',
  function () {
    var dom = load();
    store.add([snap('os-9.2', JUL, { builds: [build('nginx', { version: '1.0' })] }),
               snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] })],
              'a.json');
    dom.fire(dom.document.querySelectorAll('.tab')[1], 'click', {});
    assert.doesNotMatch(dom.id('diff-rows').innerHTML, /class="empty"/,
                        dom.id('diff-rows').innerHTML);
  });
```

- [ ] **Step 6: Прогнать**

Run: `node --test tests/js/*.test.js`
Expected: PASS 202

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/assets/js/viewmodel.js kojipatch/assets/js/ui.js tests/js/ui.test.js
git commit -m "Переход выбирается именами снапшотов, а не номером"
```

---

### Task 2: диапазон выбирается кликами по рельсу

**Files:**
- Modify: `kojipatch/assets/js/ui.js`
- Modify: `kojipatch/assets/dashboard.html`
- Test: `tests/js/ui.test.js`

**Interfaces:**
- Consumes: `currentEnds()`, `setPairEnds(lo, hi)`, `pairKeyOf(ends)` из
  Task 1
- Produces: узлы рельса с атрибутом `data-node="<номер>"` на вкладке
  «Изменения»

- [ ] **Step 1: Тесты выбора диапазона**

Дописать в `tests/js/ui.test.js`:

```js
/* Узлы рельса скрипт рисует через innerHTML, а заглушка разметку из строк
   не разбирает. Ставим такой же узел настоящим узлом: проверяется
   делегированный обработчик, а не то, как браузер его отрисует. */
function clickNode(dom, at) {
  var node = dom.document.createElement('button');
  node.setAttribute('data-node', String(at));
  dom.id('chain').appendChild(node);
  dom.fire(node, 'click', {});
}

function threeChain(dom) {
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', '2026-09-01T00:00:00+03:00',
                  { builds: [build('nginx', { version: '3.0' })] })], 'a.json');
  dom.fire(dom.document.querySelectorAll('.tab')[1], 'click', {});
}

test('два клика по узлам задают диапазон', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 0);
  clickNode(dom, 1);
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.2/,
               dom.location.hash);
});

test('порядок кликов не меняет направление перехода', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 2);
  clickNode(dom, 0);
  /* Кликнули справа налево, а «было» всё равно слева: направление задаёт
     цепочка. Иначе «появился» и «исчез» поменялись бы местами. */
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.3/,
               dom.location.hash);
});

test('первый клик только отмечает узел и таблицу не трогает', function () {
  var dom = load();
  threeChain(dom);
  var before = dom.id('diff-rows').innerHTML;
  clickNode(dom, 0);
  assert.strictEqual(dom.id('diff-rows').innerHTML, before);
  assert.match(dom.id('chain').innerHTML, /class="stop anchor"/,
               dom.id('chain').innerHTML);
});

test('повторный клик по отмеченному узлу снимает отметку', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 0);
  clickNode(dom, 0);
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('anchor'), -1,
                     dom.id('chain').innerHTML);
});

test('пока отметка стоит, рельс просит выбрать второй конец', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 1);
  assert.match(dom.id('chain').innerHTML, /выберите второй конец/,
               dom.id('chain').innerHTML);
});

test('диапазон во всю цепочку помечен итогом, а соседний — нет',
  function () {
    var dom = load();
    threeChain(dom);
    clickNode(dom, 0);
    clickNode(dom, 2);
    assert.match(dom.id('chain').innerHTML, /class="sum">итог/,
                 dom.id('chain').innerHTML);
    clickNode(dom, 0);
    clickNode(dom, 1);
    assert.strictEqual(dom.id('chain').innerHTML.indexOf('итог'), -1,
                       dom.id('chain').innerHTML);
  });

test('на вкладке «Состояние» узлы рельса не нажимаются', function () {
  var dom = load();
  threeChain(dom);
  dom.fire(dom.document.querySelectorAll('.tab')[0], 'click', {});
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('data-node'), -1,
                     dom.id('chain').innerHTML);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/ui.test.js`
Expected: FAIL — узлы не нажимаются, `anchor` в разметке нет

- [ ] **Step 3: Якорь и клики по рельсу**

В `ui.js` рядом с `pairSel` добавить:

```js
  /* Отмеченный первым кликом узел, пока второй не выбран. Живёт только до
     следующего клика, смены вкладки или смены состава снапшотов: это шаг
     выбора, а не состояние страницы. */
  var anchor = null;
```

`renderChain` переписать: узлы становятся кнопками на вкладке
«Изменения», получают подсказку, отметку якоря и метку итога.

```js
  function renderChain() {
    var items = store.list(), when = whenLabels(items), out = '', i, here;
    var live = st.tab === 'diff';
    var ends = live ? currentEnds() : null;
    if (!items.length) { chainBox.innerHTML = ''; return; }
    for (i = 0; i < items.length; i++) {
      if (i) {
        out += '<span class="rl'
            + (ends && i > ends[0] && i <= ends[1] ? ' on' : '') + '"></span>';
      }
      here = ends ? (i === ends[0] || i === ends[1]) : i === st.tag;
      out += stopHtml(i, items[i].tag, when[i], here, live);
    }
    var label = anchor === null ? 'цепочка' : 'выберите второй конец';
    var sum = live && ends && ends[0] === 0 && ends[1] === items.length - 1
      && items.length > 2 ? '<span class="sum">итог</span>' : '';
    chainBox.innerHTML = '<span class="l">' + esc(label) + '</span>' + out + sum;
  }

  function stopHtml(at, tag, when, here, live) {
    var cls = 'stop' + (here ? ' on' : '') + (anchor === at ? ' anchor' : '');
    var body = '<span class="node"></span><span class="nm">' + esc(tag)
      + (when ? ' <span class="when">' + esc(when) + '</span>' : '')
      + '</span>';
    if (!live) return '<span class="' + cls + '">' + body + '</span>';
    var tip = anchor === null ? 'Отметить началом сравнения'
      : (anchor === at ? 'Снять отметку' : 'Сравнить с отмеченным');
    return '<button type="button" class="' + cls + '" data-node="' + at
      + '" data-tip="' + esc(tip) + '">' + body + '</button>';
  }
```

Обработчик клика — в делегированный обработчик документа, рядом с
`data-pair`:

```js
        var at = node.getAttribute('data-node');
        if (at !== null && at !== undefined) {
          pickNode(parseInt(at, 10));
          return;
        }
```

и сама функция:

```js
  /* Диапазон выбирается двумя кликами: первый отмечает конец, второй
     задаёт пару. Клик по отмеченному узлу снимает отметку — иначе из
     начатого выбора нельзя было бы выйти, не выбрав чего-нибудь. */
  function pickNode(at) {
    if (anchor === null) { anchor = at; renderChain(); return; }
    if (anchor === at) { anchor = null; renderChain(); return; }
    var lo = Math.min(anchor, at), hi = Math.max(anchor, at);
    anchor = null;
    setPairEnds(lo, hi);
    renderDiffCards();
    render();
  }
```

Якорь сбрасывается при смене вкладки и при смене данных. В `showTab`
первой строкой и в `applyData` рядом с восстановлением выбора:

```js
    anchor = null;
```

- [ ] **Step 4: Прогнать**

Run: `node --test tests/js/ui.test.js`
Expected: PASS — все семь новых тестов зелёные

- [ ] **Step 5: Удалить селектор пар**

В `kojipatch/assets/dashboard.html` удалить строку:

```html
    <div class="selector" id="pair-select"></div>
```

В `ui.js` удалить функции `renderPairSelect` и `endHtml`, их вызовы и
ветку обработчика клика по `data-pair`. Проверить, что `whenLabels`
остаётся — она нужна рельсу.

В `tests/js/ui.test.js` переписать тесты, которые жали кнопки селектора,
на `clickNode`. Найти их по строке `pair-select`. Утверждения про
`pressedPair` заменить на проверку адресной строки — она называет
выбранный диапазон и переживает перестановку. Хелперы `pressPick` для
`pair-select` и `pressedPair` после этого станут не нужны: удалить, если
на них не останется вызовов.

- [ ] **Step 6: Прогнать оба набора**

Run: `node --test tests/js/*.test.js && python3 -m unittest discover -s tests -t . -q`
Expected: PASS, OK 263

- [ ] **Step 7: Стили якоря**

В `kojipatch/assets/dashboard.html`, рядом с правилами `.stop`:

```css
/* Узел, отмеченный первым кликом: обведён, но не залит — залитый значит
   «выбрано», а выбор ещё не сделан. */
.stop.anchor .node { box-shadow: 0 0 0 3px var(--card), 0 0 0 4px var(--fg); }
.stop { border: 0; background: none; box-shadow: none; padding: .1rem .2rem;
  border-radius: var(--r-1); font: inherit; }
button.stop { cursor: pointer; }
button.stop:hover { background: var(--card); color: var(--fg); }
```

- [ ] **Step 8: Проверить собранную страницу**

Run: `python3 -m kojipatch dashboard -o /tmp/range.html && grep -c "pair-select" /tmp/range.html`
Expected: `0`

Браузера в среде нет. Прогнать сценарий на заглушке: загрузить три
фикстуры (`tests/fixtures/rich-old.json`, `rich-new.json`,
`rich-newer.json`), кликнуть узлы 0 и 2, убедиться, что в таблице строки
сводного диапазона. В отчёте отдельным разделом перечислить, что осталось
непроверенным без браузера.

- [ ] **Step 9: Коммит**

```bash
git add kojipatch/assets/js/ui.js kojipatch/assets/dashboard.html tests/js/ui.test.js
git commit -m "Диапазон сравнения выбирается кликами по рельсу"
```

---

### Task 3: документация

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Переписать раздел про вкладку «Изменения»**

Найти в README место, где описан выбор пары («соседние теги прогона» и
сводная пара), и переписать: сравнить можно любые два загруженных
снапшота, выбор — двумя кликами по узлам рельса, направление задаёт
цепочка, метка «итог» стоит у диапазона во всю цепочку при трёх и больше
снапшотах. Упомянуть, что ссылка `pair=` называет любой диапазон и
короткая форма по тегам по-прежнему читается.

Строки не длиннее 79 **символов** (не байтов; `awk` на кириллице врёт
втрое — считать символами, например питоном).

- [ ] **Step 2: Проверить длину строк**

Run: `python3 -c "import pathlib; print([i+1 for i,l in enumerate(pathlib.Path('README.md').read_text(encoding='utf-8').split(chr(10))) if len(l)>79 and 'рельс' in l] or 'нет')"`
Expected: `нет`

- [ ] **Step 3: Коммит**

```bash
git add README.md
git commit -m "README: сравнение любых двух снапшотов"
```

---

## Самопроверка плана

**Покрытие спеки.** Выбор кликами по рельсу — Task 2. Якорь, его снятие и
подсказка «выберите второй конец» — Task 2, шаги 1 и 3. Направление по
цепочке — Task 1 (`currentEnds`) и тест в Task 2. Удаление ряда кнопок —
Task 2, шаг 5. Метка «итог» и условие «больше двух снапшотов» — Task 2.
Подсказки узлов — Task 2, `stopHtml`. Состояние именами снапшотов и
закрытие хвоста `pairEnds` — Task 1. Адресная строка, включая короткую
форму, — Task 1, `endsFromHash`. Расчёт по требованию и неприкосновенность
эталона — Task 1. Крайние случаи: выгрузка конца и перестановка цепочки —
Task 1 (`applyData`, `currentEnds`); меньше двух снапшотов — Task 1
(`syncTabs`); клик по якорю — Task 2.

**Расхождение со спекой, требующее внимания.** Спека обещает тест
«повторный выбор того же диапазона отдаёт тот же объект, а не считает
заново». В плане его нет: `pairFor` кладёт результат в `pairCache` и
отдаёт его же, но проверять это через разметку нечем, а тестовый экспорт
ради одной проверки — дверь в production-коде, которой пользуются только
тесты. Кэш проверяется косвенно — тестом Task 1, шаг 5, где без
него вкладка была бы пуста. Если это не устраивает, добавьте в Task 1
шаг с прямым сравнением `dom.pairFor(0, 2) === dom.pairFor(0, 2)`.

**Что остаётся как было.** `pairBlock` ищет сторону перехода по имени
тега, и у двойников тега адрес koji может оказаться от чужого прогона.
Это известный хвост, он не расширяется этой задачей и не чинится ею.
