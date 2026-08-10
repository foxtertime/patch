# Регулярка в поле поиска — план работ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить поле поиска регулярным выражениям, включаемым кнопкой рядом с полем.

**Architecture:** Новый модуль `query.js` превращает набранную строку и положение кнопки в матчер — объект, который умеет сказать «совпало» и «вот куда ставить подсветку». Запрос, который сегодня ходит по коду строкой, становится этим матчером; `text.has` и `text.hl` начинают его принимать, а разбор запроса и ответ «не разобралось, вот причина» живут в одном месте.

**Tech Stack:** ES2015+ без сборщика, UMD-обёртки вокруг пространства `KP`, `node --test`.

## Global Constraints

- **Обе сюиты зелёные после каждой задачи.** Точка отсчёта: `python3 -m unittest discover -s tests` → 360, `node --test tests/js/*.test.js` → 520.
- **Python не трогается вовсе.** Ни один файл `dashboard/*.py`, кроме `build.py` (список скриптов) и `__init__.py` (версия, Задача 6). Схема снапшота, формат данных страницы и CLI не меняются.
- **Фикстуры и эталон не правятся:** `tests/fixtures/rich-*.json` и `tests/js/fixtures/page-data.golden.json` за всю ветку не трогаются ни разу. Захотелось — значит что-то пошло не по плану, остановиться и сказать.
- **Регистр не учитывается никогда.** Флаг `i` у регулярки стоит всегда; обычный поиск приводит к нижнему регистру обе стороны.
- **Флагов у регулярки нет** — без слешей их негде написать, и заводить для них синтаксис не надо.
- **Подсветка обычного поиска обязана остаться байт в байт.** Тридцать один вызов `hl`, и регресс там ничем не ловится, если не запинить разметку нарочно.
- **Комментарии по-русски**, разговорным регистром, объясняют «почему», а не «что». Ни один существующий комментарий не пропадает; если он ссылается на переименованное — правится только имя.
- **`SCRIPTS` в `dashboard/build.py`** собирается по зависимостям. Новый файл дописывается в той же задаче, где заводится, иначе `dashboard page` соберёт страницу без него, и сюиты этого не заметят.
- **Версию поднимает Задача 6**, и никакая другая.

---

## Файлы

**Создаётся:**

| файл | ответственность |
|---|---|
| `dashboard/assets/js/query.js` | во что превращается набранное в поле: совпало ли и куда ставить подсветку |
| `tests/js/query.test.js` | тесты матчера |

**Правится:**

| файл | что меняется |
|---|---|
| `dashboard/assets/js/text.js` | `hl` и `has` принимают матчер вместо строки |
| `dashboard/assets/js/search.js` | охрана `if (!q)` → `if (q.empty)` ×2 |
| `dashboard/assets/js/markup.js` | `Boolean(q) &&` → `!q.empty &&` |
| `dashboard/assets/js/page.js` | `st.regex`, `matcher()`, `pick`, `restore`, `hashParts` |
| `dashboard/assets/js/hash.js` | ключ `re`, снятие `toLowerCase` |
| `dashboard/assets/js/ui.js` | матчер в `rowOpts`, кнопка, сообщение, снятие `toLowerCase` |
| `dashboard/assets/dashboard.html` | кнопка `#q-re`, строка `#q-bad` |
| `dashboard/assets/css/layout.css` | `.toggle.on`, `.qbad` |
| `dashboard/assets/css/filters.css` | `#filters.on` уезжает в общее правило |
| `dashboard/build.py` | `query.js` в `SCRIPTS` |
| `README.md`, `CHANGELOG.md`, `dashboard/__init__.py` | Задача 6 |

**Тесты правятся:** `tests/js/text.test.js`, `markup.test.js`, `tables.test.js`, `search.test.js`, `page.test.js`, `ui.test.js`.

---

## Задача 1: модуль `query.js`

Матчер сам по себе, без единой связи со страницей. Ничего ещё не подключено — модуль просто появляется и работает.

**Files:**
- Create: `dashboard/assets/js/query.js`, `tests/js/query.test.js`
- Modify: `dashboard/build.py` (`SCRIPTS`)

**Interfaces:**
- Consumes: ничего
- Produces: `KP.query.compile(raw, regex)` → `{ empty, problem, test(value), ranges(str) }`
  - `empty` — булево: совпадает со всем (пустой запрос **или** непонятый шаблон)
  - `problem` — `null` либо строка от браузера
  - `test(value)` — булево; `value` уже строка, приведение — забота вызывающего
  - `ranges(str)` — массив пар `[от, до]`, полуинтервалы, в порядке появления

- [ ] **Шаг 1: Написать падающие тесты**

`tests/js/query.test.js`:

```js
'use strict';
/* Матчер запроса. Страница здесь не нужна вовсе: на входе строка и
   положение кнопки, на выходе — «совпало» и «где». */
var test = require('node:test');
var assert = require('node:assert');
var query = require('../../dashboard/assets/js/query.js');

test('пустой запрос совпадает со всем и молчит', function () {
  var m = query.compile('', false);
  assert.strictEqual(m.empty, true);
  assert.strictEqual(m.problem, null);
  assert.strictEqual(m.test('что угодно'), true);
  assert.deepStrictEqual(m.ranges('что угодно'), []);
});

test('пустой запрос в режиме регулярки — тот же пустой запрос', function () {
  var m = query.compile('', true);
  assert.strictEqual(m.empty, true);
  assert.strictEqual(m.problem, null);
});

test('обычный поиск ищет вхождение и не смотрит на регистр', function () {
  var m = query.compile('NGINX', false);
  assert.strictEqual(m.test('nginx-1.24.0'), true);
  assert.strictEqual(m.test('httpd'), false);
});

test('обычный поиск не считает шаблон шаблоном', function () {
  /* Точка в обычном поиске — точка, а не «любой символ»: иначе запрос
     1.24 находил бы 1x24, и человек об этом бы не догадался. */
  var m = query.compile('1.24', false);
  assert.strictEqual(m.test('nginx-1.24.0'), true);
  assert.strictEqual(m.test('nginx-1x24.0'), false);
});

test('регулярка ищет шаблоном и тоже не смотрит на регистр', function () {
  var m = query.compile('^PYTHON3?-', true);
  assert.strictEqual(m.test('python3-libs'), true);
  assert.strictEqual(m.test('python-libs'), true);
  assert.strictEqual(m.test('libs-python3-x'), false);
});

test('непонятая регулярка совпадает со всем и несёт причину', function () {
  /* Не фильтруем и говорим прямо: пустая таблица на каждой недописанной
     скобке была бы неотличима от «ничего не нашлось». */
  var m = query.compile('^python(', true);
  assert.strictEqual(m.empty, true);
  assert.ok(m.problem && m.problem.length > 0, 'причина обязана быть');
  assert.strictEqual(m.test('что угодно'), true);
  assert.deepStrictEqual(m.ranges('что угодно'), []);
});

test('ranges обычного поиска даёт все вхождения по порядку', function () {
  var m = query.compile('ab', false);
  assert.deepStrictEqual(m.ranges('abXab'), [[0, 2], [3, 5]]);
});

test('ranges регулярки даёт все совпадения по порядку', function () {
  var m = query.compile('a.', true);
  assert.deepStrictEqual(m.ranges('axaybz'), [[0, 2], [2, 4]]);
});

test('совпадение нулевой длины не зацикливает', function () {
  /* x* совпадает с пустотой в каждой позиции и сам lastIndex не двигает.
     Без явного сдвига этот вызов не вернулся бы никогда. */
  var m = query.compile('x*', true);
  var out = m.ranges('axb');
  assert.ok(out.length > 0);
  assert.ok(out.every(function (r) { return r[0] <= r[1]; }));
});

test('ranges не тащит позицию между вызовами', function () {
  /* lastIndex — состояние на самом объекте регулярки, и один экземпляр,
     поделённый между отбором строк и тремя десятками мест подсветки, начал
     бы пропускать совпадения через раз. */
  var m = query.compile('a', true);
  var first = m.ranges('aaa');
  var second = m.ranges('aaa');
  assert.deepStrictEqual(second, first);
});

test('test не тащит позицию между вызовами', function () {
  var m = query.compile('a', true);
  assert.strictEqual(m.test('a'), true);
  assert.strictEqual(m.test('a'), true);
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/query.test.js
```

Ожидается: `Cannot find module '../../dashboard/assets/js/query.js'`.

- [ ] **Шаг 3: Завести `dashboard/assets/js/query.js`**

```js
/* Язык запроса: во что превращается набранное в поле поиска.

   Модуль отвечает на два вопроса — совпало ли значение и куда ставить
   подсветку. Ни состояния страницы, ни DOM здесь нет.

   Почему отдельно от text.js: там живёт то, что проверяется одним вызовом,
   а здесь разбор запроса и ответ «не разобралось, вот причина». Доложить
   об этом из text.has было бы некому. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.query = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* Совпадает со всем и молчит. Им отвечает пустой запрос — и он же лежит
     в основе ответа на непонятый шаблон. */
  const ALL = {
    empty: true, problem: null,
    test: function () { return true; },
    ranges: function () { return []; }
  };

  function plain(raw) {
    /* Приводим к нижнему регистру один раз здесь, а не на каждое значение:
       обычный поиск регистр игнорирует, и делать это тысячи раз за
       перерисовку незачем. */
    const needle = raw.toLowerCase();
    return {
      empty: false, problem: null,
      test: function (value) {
        return String(value).toLowerCase().indexOf(needle) !== -1;
      },
      ranges: function (str) {
        const low = String(str).toLowerCase(), out = [];
        let at = 0, found;
        while ((found = low.indexOf(needle, at)) !== -1) {
          out.push([found, found + needle.length]);
          at = found + needle.length;
        }
        return out;
      }
    };
  }

  function regexp(raw) {
    let one, all;
    try {
      /* Две регулярки на один шаблон, и это не расточительство. lastIndex —
         состояние на самом объекте: у экземпляра с флагом g он ползёт от
         вызова к вызову, и один объект, поделённый между отбором строк и
         тремя десятками мест подсветки, начал бы пропускать совпадения
         через раз. Поэтому test ходит по экземпляру без g, а ranges — по
         своему, с g.

         Флаг i стоит всегда: обычный поиск регистр игнорирует, и регулярка,
         которая вела бы себя иначе, молча теряла бы половину на именах
         вроде CVE-2026 против cve-2026. Отключить его изнутри шаблона в
         JavaScript нечем, и это осознанная цена. */
      one = new RegExp(raw, 'i');
      all = new RegExp(raw, 'gi');
    } catch (exc) {
      /* Не разобралось — совпадаем со всем и несём причину: отбор строк
         увидит пустой запрос и покажет всё, а страница объяснит, почему.
         Причину берём у браузера дословно: у Firefox и Chrome тексты
         разные, но оба называют место ошибки, а общий текст от меня не
         назвал бы его вовсе. */
      return {
        empty: true,
        problem: exc && exc.message ? String(exc.message) : String(exc),
        test: ALL.test, ranges: ALL.ranges
      };
    }
    return {
      empty: false, problem: null,
      test: function (value) { return one.test(String(value)); },
      ranges: function (str) {
        const s = String(str), out = [];
        let found;
        all.lastIndex = 0;
        while ((found = all.exec(s)) !== null) {
          out.push([found.index, found.index + found[0].length]);
          /* Совпадение нулевой длины стоит на месте и lastIndex не двигает.
             Без этого сдвига цикл вечен, а вкладка мертва. */
          if (found[0].length === 0) all.lastIndex += 1;
        }
        return out;
      }
    };
  }

  /* raw — что набрано в поле, regex — нажата ли кнопка режима. */
  function compile(raw, regex) {
    const typed = String(raw === null || raw === undefined ? '' : raw);
    if (!typed) return ALL;
    return regex ? regexp(typed) : plain(typed);
  }

  return { compile: compile };
}));
```

- [ ] **Шаг 4: Прогнать тесты**

```bash
node --test tests/js/query.test.js
```

Ожидается: все зелёные. Тест про нулевую длину обязан **вернуться** — если он висит, сдвиг `lastIndex` не работает, и это ровно та ловушка, ради которой тест написан.

- [ ] **Шаг 5: Дописать в `SCRIPTS`**

`dashboard/build.py`. Было:

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "labels.js", "hash.js", "search.js", "page.js",
```

Стало (`query.js` сразу за `text.js` — он его сосед по назначению и ни от чего не зависит):

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "text.js", "query.js", "labels.js", "hash.js", "search.js", "page.js",
```

- [ ] **Шаг 6: Прогнать обе сюиты и собрать страницу**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html && grep -c 'KP.query' /tmp/check.html
```

Ожидается: 360 Python, 520 + 11 новых JS, `grep` даёт не меньше 1.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/assets/js/query.js tests/js/query.test.js dashboard/build.py
git commit -m "Завести матчер запроса"
```

---

## Задача 2: запрос ходит по коду матчером, а не строкой

Поведение не меняется ни на волос: регулярки ещё нет, включить её нечем. Меняется то, **что** передаётся под именем `q`.

**Files:**
- Modify: `dashboard/assets/js/text.js` (`hl`, `has`), `search.js` (2 охраны), `markup.js:154`, `page.js` (`deps`, `matcher()`, `pick`), `ui.js` (`rowOpts`, обработчик поля, `pagemod.create`), `hash.js` (снятие `toLowerCase`)
- Test: `tests/js/text.test.js`, `markup.test.js`, `tables.test.js`, `search.test.js`, `page.test.js`

**Interfaces:**
- Consumes: `query.compile(raw, regex)` из Задачи 1
- Produces:
  - `text.has(value, q)` и `text.hl(s, q)` — вторым доводом **матчер**, не строка
  - `page.matcher()` → матчер, посчитанный по `st.q`; помнит последний
  - `page.create(deps)` начинает требовать `deps.query`

- [ ] **Шаг 1: Запинить разметку обычного поиска**

Это первое, что надо сделать, и не для галочки: `hl` зовут из тридцати одного места, и регресс в ней тестами не ловится, если не сверить строку целиком. В `tests/js/text.test.js`:

```js
/* Подсветка обычного поиска — то, что видно на каждой строке таблицы.
   Сверяем строку целиком, а не по кускам: правка hl не имеет права
   поменять ни один символ разметки. */
test('подсветка обычного поиска — разметка целиком', function () {
  var m = query.compile('ab', false);
  assert.strictEqual(text.hl('xabyab', m),
    'x<span class="hit">ab</span>y<span class="hit">ab</span>');
  assert.strictEqual(text.hl('<b>ab</b>', m),
    '&lt;b&gt;<span class="hit">ab</span>&lt;/b&gt;');
  assert.strictEqual(text.hl('ничего', m), 'ничего');
});
```

и в шапку файла — `var query = require('../../dashboard/assets/js/query.js');`.

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/text.test.js
```

Ожидается: падает — сегодня `hl` ждёт строку, а `m.empty` для неё не определено; функция уйдёт в цикл `indexOf` с объектом и вернёт не то.

- [ ] **Шаг 3: Переписать `hl` и `has`**

`dashboard/assets/js/text.js`. Было:

```js
  /* Экранирует и подсвечивает вхождения текущего запроса. Всё, что попадает
     в DOM из данных, проходит либо через esc(), либо через hl(). */
  function hl(s, q) {
    s = String(s === null || s === undefined ? '' : s);
    if (!q) return esc(s);
    let low = s.toLowerCase(), out = '', from = 0, at;
    while ((at = low.indexOf(q, from)) !== -1) {
      out += esc(s.slice(from, at)) + '<span class="hit">'
          + esc(s.slice(at, at + q.length)) + '</span>';
      from = at + q.length;
    }
    return out + esc(s.slice(from));
  }
```

Стало:

```js
  /* Экранирует и подсвечивает совпадения текущего запроса. Всё, что
     попадает в DOM из данных, проходит либо через esc(), либо через hl().

     Запрос приходит матчером, а не строкой: где именно совпало, знает он,
     а дело этой функции — экранировать и обернуть. Порядок здесь
     обязателен: позиции считаются по сырой строке, потому что по
     экранированной они бы поехали — «&amp;» длиннее «&», и подсветка
     встала бы не на то место. */
  function hl(s, q) {
    s = String(s === null || s === undefined ? '' : s);
    if (q.empty) return esc(s);
    let out = '', from = 0;
    for (const range of q.ranges(s)) {
      /* Совпадение нулевой длины подсвечивать нечем: пустой span только
         замусорил бы разметку. Такие даёт, например, шаблон x*. */
      if (range[1] <= range[0]) continue;
      out += esc(s.slice(from, range[0])) + '<span class="hit">'
          + esc(s.slice(range[0], range[1])) + '</span>';
      from = range[1];
    }
    return out + esc(s.slice(from));
  }
```

`has` было:

```js
  function has(value, q) {
    return String(value === null || value === undefined ? '' : value)
      .toLowerCase().indexOf(q) !== -1;
  }
```

стало:

```js
  /* Совпало ли значение. Как именно — знает матчер; здесь только
     приведение неизвестного к строке: null и undefined ищутся как пустая
     строка, а не роняют поиск. */
  function has(value, q) {
    return q.test(String(value === null || value === undefined ? '' : value));
  }
```

- [ ] **Шаг 4: Поправить три охраны**

`search.js`, обе функции: `if (!q) return { show: true, deep: false };` → `if (q.empty) return { show: true, deep: false };`

`markup.js:154`, было:

```js
    return Boolean(q) && text.has(path, q) && !text.has(p.name, q);
```

стало:

```js
    return !q.empty && text.has(path, q) && !text.has(p.name, q);
```

- [ ] **Шаг 5: Завести `matcher()` в `page.js`**

В `create(deps)`, к строке с зависимостями:

```js
    const scanState = deps.search.scanState, scanDiff = deps.search.scanDiff;
    const querymod = deps.query;
```

и рядом с `pick`:

```js
    /* Матчер запроса, посчитанный один раз на отрисовку. Компилировать его
       заново на каждую строку таблицы значило бы делать это тысячи раз за
       перерисовку, а на регулярке это ещё и разбор шаблона. Помним
       последний вход и отдаём готовое. */
    let lastQuery = null, lastMatcher = null;
    function matcher() {
      if (lastMatcher === null || lastQuery !== st.q) {
        lastQuery = st.q;
        lastMatcher = querymod.compile(st.q, false);
      }
      return lastMatcher;
    }
```

`pick` было:

```js
    function pick(rows, matches, scan) {
      const out = [];
      for (const row of rows) {
        if (!matches(row)) continue;
        const found = scan(row, st.q);
```

стало:

```js
    function pick(rows, matches, scan) {
      const out = [];
      const q = matcher();
      for (const row of rows) {
        if (!matches(row)) continue;
        const found = scan(row, q);
```

И `matcher` дописывается в возвращаемый объект `create`, рядом с `visibleRows, totalRows`.

- [ ] **Шаг 6: `ui.js` и `hash.js`**

`ui.js`, `rowOpts` было `return { q: st.q, cols: ... }` → стало `return { q: page.matcher(), cols: ... }`.

`ui.js`, обработчик поля — снимаем приведение к нижнему регистру: оно ломало бы шаблоны в Задаче 3 (`\S` стал бы `\s`), а регистронезависимость теперь живёт в матчере:

```js
      st.q = search.value.trim();
```

`ui.js`, создание страницы — новая зависимость:

```js
  let page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text,
                              search: searchmod, query: querymod });
```

и `query.js` дописывается в **обе** ветки UMD-обёртки `ui.js`, доводом `querymod`.

`hash.js:50` было `else if (key === 'q') out.q = val.trim().toLowerCase();` → стало `else if (key === 'q') out.q = val.trim();`

- [ ] **Шаг 7: Починить тесты, которые передавали строку**

Найти все места:

```bash
grep -rn "hl(\|has(\|scanState(\|scanDiff(\|patchesHtml(\|patchesChangeHtml(\|q:" tests/js/
```

В каждом файле, где такие вызовы есть, завести один помощник рядом с остальными и заменить им строки:

```js
var query = require('../../dashboard/assets/js/query.js');
function q(typed) { return query.compile(typed || '', false); }
```

Пустая строка `''` становится `q()`, строка `'nginx'` — `q('nginx')`. В `tests/js/tables.test.js` запрос идёт через помощник `opts()` — там правка одна, в его теле.

**Ожидания тестов при этом не трогаются.** Поменялся тип довода, а не поведение; поехало ожидание — значит поехало и поведение, и это надо назвать, а не подогнать.

- [ ] **Шаг 8: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: 360 Python, 531 + 1 новый JS (пиннинг из Шага 1).

- [ ] **Шаг 9: Коммит**

```bash
git add dashboard/assets/js dashboard/build.py tests/js
git commit -m "Запрос ходит по коду матчером, а не строкой"
```

---

## Задача 3: режим в состоянии и в адресе

Регулярку уже можно включить — пока только рукописной ссылкой `#…&re=1`. Кнопки нет, она в Задаче 5.

**Files:**
- Modify: `dashboard/assets/js/page.js` (`st`, `matcher`, `restore`, `hashParts`), `hash.js` (`parse`, `format`)
- Test: `tests/js/page.test.js`, `tests/js/hash.test.js`

**Interfaces:**
- Consumes: `page.matcher()` из Задачи 2
- Produces: `st.regex` (булево); `hashParts().re` (булево); `hash.parse()` отдаёт `re` строкой или `null`

- [ ] **Шаг 1: Написать падающие тесты**

`tests/js/hash.test.js`:

```js
test('режим регулярки уезжает в адрес и возвращается', function () {
  assert.match(hash.format({ tab: 'state', tag: null, pair: null,
                             filters: [], any: [], q: '^py', re: true,
                             sort: { key: 'name', asc: true } }),
               /(^|&)re=1(&|$)/);
  assert.strictEqual(hash.parse('tab=state&q=%5Epy&re=1&f=&sort=name').re, '1');
});

test('выключенный режим в адрес не пишется вовсе', function () {
  /* Умолчание — выключен, и ключ на каждой ссылке был бы шумом.
     Отсутствие ключа значит ровно «выключен» и ничего больше. */
  assert.doesNotMatch(hash.format({ tab: 'state', tag: null, pair: null,
                                    filters: [], any: [], q: 'nginx', re: false,
                                    sort: { key: 'name', asc: true } }),
                      /re=/);
  assert.strictEqual(hash.parse('tab=state&q=nginx&f=&sort=name').re, null);
});
```

`tests/js/page.test.js` (помощники `make`, `snap`, `build` в файле уже есть):

```js
test('режим регулярки переживает круг через адрес', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.st.q = '^ngi';
  p.st.regex = true;
  assert.strictEqual(p.hashParts().re, true);
  p.st.regex = false;
  p.restore({ tab: null, tag: null, pair: null, filters: null, any: null,
              q: '^ngi', re: '1', sort: null });
  assert.strictEqual(p.st.regex, true);
});

test('ссылка без re= выключает режим', function () {
  /* Отсутствие ключа — не молчание, а «выключено»: у булева признака с
     известным умолчанием другого прочтения нет. */
  var p = make([snap('os-9.1', JUL)]);
  p.st.regex = true;
  p.restore({ tab: null, tag: null, pair: null, filters: null, any: null,
              q: 'nginx', re: null, sort: null });
  assert.strictEqual(p.st.regex, false);
});

test('матчер пересчитывается при смене режима, а не только запроса', function () {
  /* Запрос тот же, режим другой — памятка обязана это заметить, иначе
     нажатие кнопки ничего не изменит. */
  var p = make([snap('os-9.1', JUL)]);
  p.st.q = 'a.c';
  p.st.regex = false;
  assert.strictEqual(p.matcher().test('abc'), false);
  p.st.regex = true;
  assert.strictEqual(p.matcher().test('abc'), true);
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/hash.test.js tests/js/page.test.js
```

Ожидается: падают все три новых в `page.test.js` и оба в `hash.test.js`.

- [ ] **Шаг 3: `st.regex` и памятка матчера**

`page.js`, в объект `st` рядом с `q`:

```js
      q: '',
      /* Идёт ли содержимое поля в регулярное выражение. Не по вкладкам:
         поле поиска на странице одно на обе, и его признак живёт так же. */
      regex: false,
```

`matcher()` — памятка учитывает и режим:

```js
    let lastQuery = null, lastRegex = null, lastMatcher = null;
    function matcher() {
      if (lastMatcher === null || lastQuery !== st.q || lastRegex !== st.regex) {
        lastQuery = st.q;
        lastRegex = st.regex;
        lastMatcher = querymod.compile(st.q, st.regex);
      }
      return lastMatcher;
    }
```

- [ ] **Шаг 4: Адрес**

`page.js`, `hashParts()` — рядом с `q: st.q`:

```js
        q: st.q,
        re: st.regex,
```

`page.js`, `restore()` — рядом с `if (parsed.q !== null) st.q = parsed.q;`:

```js
      if (parsed.q !== null) st.q = parsed.q;
      /* Присутствие ключа значит «включён», отсутствие — «выключен», и
         третьего прочтения тут нет: умолчание известно, признак булев.
         Поэтому ставим всегда, а не только когда ключ есть. */
      st.regex = parsed.re !== null && parsed.re !== undefined;
```

`hash.js`, `parse` — в объявление `out` добавить `re: null`, и рядом с разбором `q`:

```js
      else if (key === 're') out.re = val;
```

`hash.js`, `format` — сразу за строкой про `q`:

```js
    if (parts.q) out.push('q=' + encodeURIComponent(parts.q));
    /* re= пишем, только когда режим включён: выключен — это умолчание, и
       ключ на каждой ссылке был бы шумом. Отсутствие читается однозначно. */
    if (parts.re) out.push('re=1');
```

- [ ] **Шаг 5: Прогнать обе сюиты**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
```

Ожидается: зелёное, +5 тестов. Существующие тесты не правятся.

- [ ] **Шаг 6: Проверить руками**

```bash
python3 -m dashboard page -o /tmp/check.html
```

Открыть, подгрузить любой снапшот из `tests/fixtures/`, дописать в адрес `&q=%5Engi&re=1` и убедиться, что таблица отобрала строки по `^ngi`, а не по вхождению.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/assets/js/page.js dashboard/assets/js/hash.js tests/js
git commit -m "Режим регулярки в состоянии и в адресе"
```

---

## Задача 4: сообщение о непонятом шаблоне

**Files:**
- Modify: `dashboard/assets/dashboard.html` (после `#count`), `dashboard/assets/css/layout.css`, `dashboard/assets/js/ui.js` (`render`)
- Test: `tests/js/ui.test.js`

**Interfaces:**
- Consumes: `page.matcher().problem`
- Produces: узел `#q-bad`

- [ ] **Шаг 1: Написать падающие тесты**

`tests/js/ui.test.js`. Помощники `load(options)` и `wait(ms)` в файле уже есть; `load` передаёт `options` в `domstub.install`, а тот кладёт `options.hash` в `location.hash` — значит режим включается ссылкой, кнопки-то ещё нет (она в Задаче 5).

```js
/* Непонятый шаблон не фильтрует и объясняет себя. Пустая таблица на каждой
   недописанной скобке была бы неотличима от «ничего не нашлось». Режим
   включаем адресом: кнопки на этот момент ещё нет. */
test('непонятая регулярка показывает все строки и называет причину',
  function () {
    var dom = load({ hash: '#tab=state&q=&re=1&f=&sort=name' });
    store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
    dom.id('q').value = '^python(';
    dom.fire(dom.id('q'), 'input', {});
    return wait(200).then(function () {
      assert.strictEqual(dom.id('q-bad').hidden, false);
      assert.match(dom.id('q-bad').textContent, /не разбирается/);
      assert.doesNotMatch(dom.id('state-rows').innerHTML, /class="empty"/,
                          'строки обязаны остаться на месте');
    });
  });

test('починенная регулярка убирает сообщение', function () {
  var dom = load({ hash: '#tab=state&q=&re=1&f=&sort=name' });
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  dom.id('q').value = '^nginx';
  dom.fire(dom.id('q'), 'input', {});
  return wait(200).then(function () {
    assert.strictEqual(dom.id('q-bad').hidden, true);
  });
});

test('обычный поиск сообщения не показывает никогда', function () {
  /* Подстрока не разбирается и испортиться не может: у неё problem всегда
     null, и строка сообщения обязана молчать даже на том, что в режиме
     регулярки её бы уронило. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  dom.id('q').value = '^python(';
  dom.fire(dom.id('q'), 'input', {});
  return wait(200).then(function () {
    assert.strictEqual(dom.id('q-bad').hidden, true);
  });
});
```

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/ui.test.js
```

Ожидается: `в шаблоне нет id="q-bad"`.

- [ ] **Шаг 3: Узел в шаблоне**

`dashboard/assets/dashboard.html`, сразу за `<span class="count" id="count"></span>`:

```html
      <!-- Причина, по которой шаблон не стал регулярным выражением. Стоит
           рядом со счётчиком, потому что объясняет ровно его: почему строк
           показано столько же, сколько всего. -->
      <span class="qbad" id="q-bad" hidden></span>
```

- [ ] **Шаг 4: Стиль**

`dashboard/assets/css/layout.css`, сразу за правилом `.count`:

```css
/* Причина непонятого шаблона. Красным не красим: это не поломка страницы,
   а сообщение о том, что человек ещё дописывает шаблон, — приглушённого
   довольно. Длину ограничиваем: сообщения браузеров бывают в строку и
   растянули бы всю панель; целиком его показывает подсказка. */
.qbad { color: var(--major); font-size: .8rem; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 28rem; }
```

- [ ] **Шаг 5: Показать сообщение**

`ui.js`, к узлам рядом с `counter`:

```js
  const qbad = document.getElementById('q-bad');
```

`ui.js`, в `render()`, сразу за строкой `counter.textContent = …`:

```js
    /* Шаблон не разобрался: строки не фильтруются, и надо сказать почему.
       Текст берём у браузера дословно — он называет место ошибки, а общий
       текст от нас не назвал бы. Подсказкой даём его целиком: в строке он
       обрезан. */
    const problem = page.matcher().problem;
    qbad.hidden = !problem;
    qbad.textContent = problem
      ? 'регулярка не разбирается: ' + problem + ' — показаны все строки' : '';
    if (problem) qbad.setAttribute('data-tip', problem);
```

- [ ] **Шаг 6: Прогнать обе сюиты и посмотреть глазами**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html
```

Открыть, подгрузить снапшот, дописать в адрес `&re=1`, набрать `^python(` — строки на месте, рядом со счётчиком причина.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/assets/dashboard.html dashboard/assets/css/layout.css \
        dashboard/assets/js/ui.js tests/js/ui.test.js
git commit -m "Сказать, почему шаблон не стал регулярным выражением"
```

---

## Задача 5: кнопка

**Files:**
- Modify: `dashboard/assets/dashboard.html` (за `.searchbox`), `dashboard/assets/css/layout.css` (`.toggle.on`), `dashboard/assets/css/filters.css` (`#filters.on` уезжает), `dashboard/assets/js/ui.js`
- Test: `tests/js/ui.test.js`

**Interfaces:**
- Consumes: `st.regex` из Задачи 3
- Produces: узел `#q-re`

- [ ] **Шаг 1: Написать падающие тесты**

```js
/* Кнопка меняет смысл соседнего поля, а не делает что-то сама. */
test('кнопка режима переключает поиск на регулярку', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00'),
             snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'a.json');
  assert.strictEqual(dom.id('q-re').getAttribute('aria-pressed'), 'false');
  dom.fire(dom.id('q-re'), 'click', {});
  assert.strictEqual(dom.id('q-re').getAttribute('aria-pressed'), 'true');
  assert.match(dom.location.hash, /(^|&)re=1(&|$)/);
});

test('нажатая кнопка меняет отбор строк без задержки', function () {
  /* Набор в поле откладывается на 120 мс ради тысяч строк; клик один, и
     откладывать его незачем — таблица обязана перерисоваться сразу. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00',
                  { builds: [build('nginx'), build('unginx')] })], 'a.json');
  dom.id('q').value = '^nginx';
  dom.fire(dom.id('q'), 'input', {});
  return wait(200).then(function () {
    var before = dom.id('count').textContent;
    dom.fire(dom.id('q-re'), 'click', {});
    assert.notStrictEqual(dom.id('count').textContent, before,
                          'таблица не перерисовалась сразу после клика');
  });
});

test('режим переживает смену вкладки', function () {
  /* Поле поиска на странице одно на обе вкладки, и его признак живёт так
     же: переключение таблицы к способу поиска отношения не имеет. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00'),
             snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'a.json');
  dom.fire(dom.id('q-re'), 'click', {});
  pressTab(dom, 'diff');
  assert.strictEqual(dom.id('q-re').getAttribute('aria-pressed'), 'true');
});

test('крестик чистит запрос, но режим не выключает', function () {
  /* Крестиком чистят, чтобы набрать другой шаблон, а не чтобы вернуться к
     поиску подстроки. Режим — это режим. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  dom.fire(dom.id('q-re'), 'click', {});
  dom.id('q').value = '^ngi';
  dom.fire(dom.id('q'), 'input', {});
  return wait(200).then(function () {
    dom.fire(dom.id('q-clear'), 'click', {});
    assert.strictEqual(dom.id('q').value, '');
    assert.strictEqual(dom.id('q-re').getAttribute('aria-pressed'), 'true');
  });
});

test('отжатая кнопка убирает сообщение о непонятом шаблоне', function () {
  /* Шаблон остался в поле, но искать его теперь буквально — жаловаться
     больше не на что. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  dom.fire(dom.id('q-re'), 'click', {});
  dom.id('q').value = '^python(';
  dom.fire(dom.id('q'), 'input', {});
  return wait(200).then(function () {
    assert.strictEqual(dom.id('q-bad').hidden, false);
    dom.fire(dom.id('q-re'), 'click', {});
    assert.strictEqual(dom.id('q-bad').hidden, true);
  });
});
```

`pressTab(dom, name)` в `tests/js/ui.test.js` уже объявлен — своего заводить не надо.

- [ ] **Шаг 2: Прогнать и убедиться, что падает**

```bash
node --test tests/js/ui.test.js
```

Ожидается: `в шаблоне нет id="q-re"`.

- [ ] **Шаг 3: Кнопка в шаблоне**

`dashboard/assets/dashboard.html`, сразу за закрывающим `</div>` блока `.searchbox`:

```html
      <!-- Подпись знаком, а не словом: три соседние кнопки — самостоятельные
           действия, и слово на них читается как глагол. Эта ничего не делает
           сама, она меняет смысл соседнего поля, и знак читается как признак
           поля. Тем, кто читает страницу не глазами, знака мало — для них
           aria-label и подсказка написаны словами. -->
      <button type="button" id="q-re" class="toggle mono" aria-pressed="false"
              aria-label="Искать регулярным выражением"
              data-tip="Искать регулярным выражением: в поле лежит сам шаблон, без слешей. Регистр не учитывается никогда. Недописанный шаблон ничего не прячет — под полем будет сказано, что с ним не так.">.*</button>
```

- [ ] **Шаг 4: Стиль нажатой кнопки — общий вместо именного**

Сегодня нажатое состояние покрашено через **id**: `filters.css:9` — `#filters.on { border-color: var(--accent); color: var(--accent); }`. Второй такой же копией для `#q-re` мы завели бы дубль правила, а ровно от них проект избавлялся в 2.4.0.

`dashboard/assets/css/filters.css:9` — строку **удалить**.

`dashboard/assets/css/layout.css`, сразу за `.toggle[disabled]`:

```css
/* Нажатый переключатель. Правило общее, а не именное: нажатых
   переключателей в панели уже два — фильтры и режим поиска, — и красить их
   двумя одинаковыми правилами по id значит завести дубль, который разойдётся
   молча. Селектор слабее прежнего (класс вместо id), и это ничего не ломает:
   спорить с ним нечему — button:hover слабее обоих. */
.toggle.on { border-color: var(--accent); color: var(--accent); }
```

Проверить глазами, что кнопка «Фильтры» в нажатом виде выглядит как прежде.

- [ ] **Шаг 5: Привязать кнопку**

`ui.js`, к узлам:

```js
  const reBtn = document.getElementById('q-re');
```

рядом с `syncClear`:

```js
  /* Вид кнопки считается от состояния, а не переключается на месте: режим
     приезжает и из адреса, и кнопка обязана показывать его тоже. */
  function syncRe() {
    reBtn.setAttribute('aria-pressed', String(st.regex));
    reBtn.className = st.regex ? 'toggle mono on' : 'toggle mono';
  }

  reBtn.addEventListener('click', () => {
    st.regex = !st.regex;
    render();
  });
```

и в `render()`, рядом с `syncCards();`:

```js
    syncRe();
```

- [ ] **Шаг 6: Прогнать обе сюиты и посмотреть глазами**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard page -o /tmp/check.html
```

Открыть, подгрузить снапшот: кнопка отжата, поиск как раньше; нажать — `^ngi` отбирает по началу имени; нажать «Фильтры» и убедиться, что она по-прежнему подсвечивается нажатой.

- [ ] **Шаг 7: Коммит**

```bash
git add dashboard/assets/dashboard.html dashboard/assets/css \
        dashboard/assets/js/ui.js tests/js/ui.test.js
git commit -m "Кнопка режима регулярки у поля поиска"
```

---

## Задача 6: README, CHANGELOG, версия 2.5.0

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `dashboard/__init__.py`

- [ ] **Шаг 1: README**

Найти раздел про поиск:

```bash
grep -n "поиск\|Поиск" README.md | head -20
```

Дописать туда четыре вещи, и каждую проверить по коду, открыв файл, а не по памяти — на этом проект уже спотыкался, когда README сообщал про пустой коммит из-за ошибки GitLab, чего код не делает никогда:

1. Кнопка `.*` у поля включает режим регулярки; в поле лежит сам шаблон, без слешей.
2. Регистр не учитывается никогда, и **отключить это нельзя**: флаг `i` стоит всегда, а `(?-i:…)` JavaScript не знает. Отличить `SAST` от `sast` невозможно.
3. Флагов нет — их негде написать.
4. Недописанный шаблон ничего не прячет: показываются все строки, а рядом со счётчиком стоит причина.

И оговорка про катастрофический откат: шаблон вида `(a+)+$` способен подвесить вкладку, остановить регулярку в браузере нечем; спасает то, что ищем по коротким строкам — именам, путям, NVR.

Список модулей страницы в README пополняется `query.js`; счётчик файлов в `assets/js/`, если он там есть, пересчитывается (`ls dashboard/assets/js | wc -l`).

- [ ] **Шаг 2: Версия**

`dashboard/__init__.py`: `__version__ = "2.4.0"` → `"2.5.0"`.

- [ ] **Шаг 3: CHANGELOG**

Тем же коммитом, что и бамп. Взять за образец форму соседних записей: жирная ведущая фраза, потом объяснение «почему». Содержание: поле поиска умеет регулярки по кнопке; регистр не учитывается и обратно не отключается; непонятый шаблон показывает всё и объясняет причину; язык запроса живёт в новом `query.js`. Отдельно — что формат снапшота, данные страницы и CLI не менялись, а ссылки со старым `q=` работают как работали.

- [ ] **Шаг 4: Прогнать всё**

```bash
python3 -m unittest discover -s tests
node --test tests/js/*.test.js
python3 -m dashboard --version
```

Ожидается `dashboard 2.5.0`.

- [ ] **Шаг 5: Коммит**

```bash
git add README.md CHANGELOG.md dashboard/__init__.py
git commit -m "Выпуск 2.5.0"
```

---

## Итоговая проверка перед вливанием

- [ ] Обе сюиты зелёные: Python 360, JS 520 + новые.
- [ ] `git diff --name-only develop` не показывает ни `dashboard/model.py`, ни `tests/fixtures/rich-*.json`, ни `tests/js/fixtures/page-data.golden.json`, ни одного `dashboard/*.py` кроме `build.py` и `__init__.py`.
- [ ] Страница собирается, `KP.query` в ней есть.
- [ ] Глазами на любом снапшоте: обычный поиск как раньше; `^ngi` при нажатой кнопке отбирает по началу имени и подсвечивает совпадения; `^python(` показывает все строки и причину; кнопка «Фильтры» в нажатом виде выглядит как прежде.
- [ ] `dashboard --version` → `2.5.0`.
