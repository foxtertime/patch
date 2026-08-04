# Разделение данных и представления в дашборде — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** снапшот становится единственным форматом данных, а дашборд —
самостоятельным представлением, которое само читает подгруженные файлы,
само считает диффы и включает вкладку «Изменения», когда снапшотов больше
одного.

**Architecture:** вычислительный слой представления (`rpmvercmp.py`,
`rpms.py`, `diff.py`, `render.py`) переносится в браузерные модули
`kojipatch/assets/js/*.js`. Python остаётся сборщиком данных (`collect`) и
получает команду `dashboard`, которая склеивает шаблон и скрипты в один
самодостаточный HTML. Порядок переноса защищён паритетным гейтом: JS обязан
выдать ровно тот же JSON, что нынешний Python, на общих фикстурах.

**Tech Stack:** Python 3.9 (stdlib, `unittest`), JavaScript ES5-стиля без
сборщиков и зависимостей, `node --test` (node v22) для тестов JS.

## Global Constraints

- Python 3.9: без `match`, без `X | Y` в аннотациях, без встроенных
  дженериков в рантайме (`List[str]` из `typing`).
- Никаких внешних зависимостей: ни pip-пакетов, ни npm-пакетов, ни CDN.
  Тест `test_no_external_resources` это проверяет и должен продолжать
  проходить.
- JS пишется в том же стиле, что нынешний `dashboard.html`: `var`, `function`,
  без стрелок, без `let`/`const`, без шаблонных строк, без `class`. Причина —
  единообразие с 1300 строками, которые переезжают как есть.
- Комментарии и сообщения — по-русски, как во всём проекте. Комментарий
  объясняет **почему**, а не пересказывает код.
- Версия схемы снапшота остаётся `SCHEMA = 1`. Новые поля только
  необязательные.
- «Неизвестно» никогда не выдаётся за определённое значение: `tag_name:
  null` — это `?`, а не «прямой»; пустой `patch_classes` — это «список не
  записан», а не «классов нет».
- Порядок и семантику решает модуль представления (`viewmodel.js`), а не
  место отрисовки: `ui.js` только режет готовые списки на блоки.
- Тесты Python: `python3 -m unittest discover -s tests -t . -q` из корня
  репозитория. Тесты JS: `node --test tests/js/` оттуда же.
- Каждая задача заканчивается зелёными обоими наборами и коммитом.

## Соглашение о модулях JS

Каждый файл в `kojipatch/assets/js/` — обычный скрипт (не ES-модуль:
`type="module"` браузер запрещает грузить с `file://`). Хвост
совместимости одинаковый во всех файлах:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vercmp.js'));   /* зависимости */
  } else {
    root.KP = root.KP || {};
    root.KP.diff = factory(root.KP.vercmp);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function (vercmp) {
  'use strict';
  /* ... тело модуля ... */
  return { diffChain: diffChain };
}));
```

Порядок подключения в собранном HTML фиксированный, по зависимостям:
`vercmp.js`, `rpms.js`, `diff.js`, `viewmodel.js`, `store.js`, `ui.js`.

## Ловушки порта Python → JS

Их надо держать в голове в задачах 3–6; каждая уже кусала в похожих
переносах.

1. **`null` против `undefined`.** `JSON.stringify` выбрасывает ключи со
   значением `undefined`, а Python пишет `null`. Везде, где Python отдаёт
   `None`, JS обязан отдать `null` явно. Паритетный тест сравнивает
   `JSON.parse(JSON.stringify(data))` с эталоном — пропущенный ключ он
   поймает.
2. **Порядок ключей объекта.** В JS целочисленные ключи объекта всплывают
   наверх независимо от порядка вставки. Там, где порядок вставки значим
   (ключи подпакетов в `diff.js`), используем `Map`, а не `{}`.
3. **Сортировка.** `Array.prototype.sort` без компаратора приводит элементы
   к строкам — для чисел это ломается. Компаратор указываем всегда. Строки
   сравниваем `a < b ? -1 : a > b ? 1 : 0` — это code-unit-порядок, тот же,
   что у Python, на всём, что встречается в именах пакетов.
4. **Кортежи-ключи сортировки.** Python сортирует по кортежу
   `(arch_key, nvra)`. В JS пишем компаратор, сравнивающий поля по очереди.
5. **`urllib.parse.quote`** оставляет `/` и `~` нетронутыми, а
   `encodeURIComponent` их экранирует. Для побайтового совпадения ссылок
   пишем свой `quote()` (код в задаче 6).
6. **Часовые пояса.** `to_msk` не должен зависеть от пояса машины: разбираем
   строку регуляркой и считаем через `Date.UTC`.
7. **`set` в Python неупорядочен, но `sorted(set(...))` детерминирован.**
   В JS каждое такое место — массив + явная сортировка.

---

## Файловая структура после всех задач

```
kojipatch/
  assets/
    dashboard.html          разметка, стили, плейсхолдер скриптов
    js/vercmp.js            сравнение версий по правилам rpm
    js/rpms.js              архитектура из NVRA и порядок пакетов
    js/diff.js              пара снапшотов, цепочка пар, выравнивание RPM
    js/viewmodel.js         строки таблиц, счётчики, метки, МСК, ссылки
    js/store.js             загруженные снапшоты: разбор, порядок, ошибки
    js/ui.js                рендер таблиц, фильтры, поиск, hash, подсказки
  build.py                  склейка HTML из шаблона и скриптов
  collect.py                (без изменений, кроме patch_classes)
  model.py                  (+ Snapshot.patch_classes)
  cli.py                    collect + dashboard
  classify.py config.py gitlabclient.py kojiclient.py logs.py sourceurl.py
tests/
  js/vercmp.test.js  rpms.test.js  diff.test.js  viewmodel.test.js
  js/store.test.js
  js/fixtures/page-data.golden.json
  fixtures/rich-old.json  rich-new.json  make_rich_fixtures.py
  test_build.py             (вместо части test_render.py)
```

Удаляются: `render.py`, `diff.py`, `rpms.py`, `rpmvercmp.py`,
`tests/test_render.py`, `tests/test_diff.py`, `tests/test_rpms.py`,
`tests/test_rpmvercmp.py`.

---

### Task 1: `patch_classes` в снапшоте

Дашборд, читающий голый снапшот, должен знать порядок классов патчей —
он задаёт порядок карточек и порядок меток в строке. Сейчас список
приходит из конфига в момент отрисовки.

**Files:**
- Modify: `kojipatch/model.py` (dataclass `Snapshot`, `snapshot_to_dict`,
  `snapshot_from_dict`)
- Modify: `kojipatch/collect.py:131-133` (конструирование `Snapshot`)
- Test: `tests/test_model.py`, `tests/test_collect.py`

**Interfaces:**
- Consumes: `Classifier.class_names() -> List[str]` из `kojipatch/classify.py`
- Produces: `Snapshot.patch_classes: List[str]`; ключ `patch_classes` в
  JSON снапшота

- [ ] **Step 1: Тест на сериализацию нового поля**

В `tests/test_model.py`, в класс с тестами `snapshot_to_dict` (найти по
существующим тестам сериализации):

```python
    def test_patch_classes_are_serialized(self):
        snapshot = sample_snapshot()
        snapshot.patch_classes = ["CVE", "SAST", "other"]
        data = snapshot_to_dict(snapshot)
        self.assertEqual(data["patch_classes"], ["CVE", "SAST", "other"])
        self.assertEqual(
            snapshot_from_dict(data).patch_classes, ["CVE", "SAST", "other"])

    def test_snapshot_without_patch_classes_still_reads(self):
        """Снапшот прежней версии обязан читаться: список классов в нём
        просто не записан, и выдумывать его нельзя."""
        data = snapshot_to_dict(sample_snapshot())
        del data["patch_classes"]
        self.assertEqual(snapshot_from_dict(data).patch_classes, [])
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `python3 -m unittest tests.test_model -v`
Expected: FAIL — `AttributeError: 'Snapshot' object has no attribute
'patch_classes'`

- [ ] **Step 3: Поле в модели**

В `kojipatch/model.py`, в dataclass `Snapshot` после `koji_web`:

```python
    # Имена классов патчей в порядке классификатора. Пустой список означает
    # «не записано» — так читаются снапшоты, собранные до появления поля.
    # Дашборду этот порядок нужен для карточек классов и меток строк, а
    # взять его больше неоткуда: конфига у него нет.
    patch_classes: List[str] = field(default_factory=list)
```

В `snapshot_to_dict` добавить в возвращаемый словарь:

```python
            "patch_classes": list(snapshot.patch_classes),
```

В `snapshot_from_dict`, в конструктор `Snapshot`:

```python
                        patch_classes=list(data.get("patch_classes") or []),
```

- [ ] **Step 4: Проверить, что тесты проходят**

Run: `python3 -m unittest tests.test_model -v`
Expected: PASS

- [ ] **Step 5: Тест на то, что collect заполняет поле**

В `tests/test_collect.py` (взять за образец соседний тест, который зовёт
`collect_tag` с фейками):

```python
    def test_snapshot_records_the_patch_classes(self):
        snapshot = self.collect()          # хелпер класса, зовёт collect_tag
        self.assertEqual(snapshot.patch_classes,
                         Classifier.from_config(self.cfg).class_names())
        self.assertIn("other", snapshot.patch_classes)
```

Если в `tests/test_collect.py` нет хелпера `self.collect()` и `self.cfg` —
использовать те же вызовы, что соседние тесты в этом файле, и импортировать
`Classifier` из `kojipatch.classify`.

- [ ] **Step 6: Убедиться, что тест падает**

Run: `python3 -m unittest tests.test_collect -v`
Expected: FAIL — `[] != ['AUTOGEN', 'CVE', ...]`

- [ ] **Step 7: Заполнить поле при сборе**

В `kojipatch/collect.py`, конструирование снапшота (около строки 131):

```python
    snapshot = Snapshot(tag=tag, generated=now or _now_iso(),
                        koji_hub=cfg.koji_hub, koji_web=cfg.koji_web,
                        patch_classes=classifier.class_names(),
                        builds=builds)
```

`classifier` в этой функции уже есть — он создаётся в начале `collect_tag`.

- [ ] **Step 8: Полный прогон**

Run: `python3 -m unittest discover -s tests -t . -q`
Expected: OK, 359 тестов

- [ ] **Step 9: Коммит**

```bash
git add kojipatch/model.py kojipatch/collect.py tests/test_model.py tests/test_collect.py
git commit -m "Снапшот несёт список классов патчей"
```

---

### Task 2: Богатые фикстуры и эталон паритета

Порт шестисот строк нельзя проверять глазами. Снимаем эталон с нынешнего
Python-рендера: JS обязан выдать ровно тот же JSON. Существующие фикстуры
для этого слишком бедны — по два билда без наследования, без эпох, без
половины классов.

**Files:**
- Create: `tests/fixtures/make_rich_fixtures.py`
- Create: `tests/fixtures/rich-old.json`, `tests/fixtures/rich-new.json`
  (генерируются скриптом, коммитятся)
- Create: `tests/js/fixtures/page-data.golden.json` (генерируется, коммитится)
- Create: `tests/test_parity.py`
- Test: `tests/test_parity.py`

**Interfaces:**
- Consumes: `Snapshot.patch_classes` из Task 1;
  `kojipatch.render.build_page_data(snapshots, pairs, classifier)`;
  `kojipatch.diff.diff_chain(snapshots)`
- Produces: `tests/js/fixtures/page-data.golden.json` — эталон, с которым
  сверяется `viewmodel.js` в Task 6

- [ ] **Step 1: Генератор фикстур**

Create `tests/fixtures/make_rich_fixtures.py`:

```python
"""Генератор богатых фикстур для паритетной сверки Python и JS.

Фикстуры коммитятся; скрипт нужен, чтобы их можно было пересобрать и
чтобы было видно, какие случаи они покрывают. Запуск из корня репозитория:

    python3 tests/fixtures/make_rich_fixtures.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from kojipatch.model import (Build, Patch, Snapshot, Source,  # noqa: E402
                             dump_snapshots)

CLASSES = ["AUTOGEN", "CVE", "SAST", "DAST", "COVERAGE", "SPEC",
           "CHANGELOG", "FILES", "other"]


def src(project, ref, kind="branch"):
    return Source(raw="git+https://gl/%s?#%s" % (project, ref), host="gl",
                  project=project, ref=ref, ref_kind=kind,
                  web_url="https://gl/%s/-/tree/%s" % (project, ref))


def patch(name, cls, cves=()):
    return Patch(path="PATCH/" + name, name=name, cls=cls, cves=list(cves),
                 web_url="https://gl/blob/PATCH/" + name)


def old_snapshot():
    return Snapshot(
        tag="os-9.1", generated="2026-07-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES),
        builds=[
            # прямой тег, три класса патчей, четыре архитектуры
            Build(nvr="nginx-1.24.0-3.el9", name="nginx", version="1.24.0",
                  release="3.el9", build_id=101, task_id=201, owner="builder",
                  completed="2026-05-14 21:30:00", tag_name="os-9.1",
                  tags=["os-9.1"], source=src("web/nginx", "os-9.1"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("autogen-sast-patches.inc.new", "AUTOGEN"),
                           patch("nginx.spec.patch", "SPEC")],
                  rpms=["nginx-1.24.0-3.el9.x86_64",
                        "nginx-core-1.24.0-3.el9.x86_64",
                        "nginx-1.24.0-3.el9.src",
                        "nginx-filesystem-1.24.0-3.el9.noarch"]),
            # унаследован из родителя, эпоха, сборка с коммита, ошибка GitLab
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.0", tags=["os-9.0", "os-9.1"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # тег неизвестен, внутренняя ошибка, дата без времени
            Build(nvr="vim-9.0-1.el9", name="vim", version="9.0",
                  release="1.el9", build_id=103, owner="editor",
                  completed="2026-05-14", tag_name=None, tags=[],
                  source=None, patch_dir_present=None,
                  patches=[patch("coverage-vim.patch", "COVERAGE")],
                  rpms=["vim-9.0-1.el9.x86_64"],
                  problems=["internal error: boom"]),
            # откат версии в новом теге, неразбираемое время
            Build(nvr="zlib-1.3-2.el9", name="zlib", version="1.3",
                  release="2.el9", build_id=104, owner="builder",
                  completed="никогда", tag_name="os-9.1", tags=["os-9.1"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-2.el9.x86_64", "zlib-1.3-2.el9.src"]),
        ])


def new_snapshot():
    return Snapshot(
        tag="os-9.2", generated="2026-08-01T00:00:00+03:00",
        koji_hub="https://hub/kojihub", koji_web="https://hub/koji",
        patch_classes=list(CLASSES),
        builds=[
            # версия выросла, патчи пришли и ушли, ветка сменилась,
            # подпакет исчез и появился на новой архитектуре
            Build(nvr="nginx-1.26.0-1.el9", name="nginx", version="1.26.0",
                  release="1.el9", build_id=111, task_id=211, owner="builder",
                  completed="2026-07-30 23:45:00", tag_name="os-9.2",
                  tags=["os-9.2"], source=src("web/nginx", "os-9.2"),
                  patch_dir_present=True,
                  patches=[patch("CVE-2024-7347.patch", "CVE",
                                 ["CVE-2024-7347"]),
                           patch("changelog.yaml", "CHANGELOG"),
                           patch("dast-fuzz.patch", "DAST")],
                  rpms=["nginx-1.26.0-1.el9.x86_64",
                        "nginx-core-1.26.0-1.el9.x86_64",
                        "nginx-1.26.0-1.el9.src",
                        "nginx-mod-http-1.26.0-1.el9.aarch64"]),
            # тот же билд переехал в другой тег: был унаследован — стал прямым
            Build(nvr="httpd-2.4.62-1.el9", name="httpd", version="2.4.62",
                  release="1.el9", epoch=1, build_id=102, task_id=202,
                  owner="apache", completed="2026-04-01 10:00:00",
                  tag_name="os-9.2", tags=["os-9.2"],
                  source=src("web/httpd", "abc123", kind="commit"),
                  patch_dir_present=False, patches=[],
                  rpms=["httpd-2.4.62-1.el9.x86_64"],
                  problems=["gitlab: 404 на дереве ветки"]),
            # откат: 1.3-2 → 1.3-1
            Build(nvr="zlib-1.3-1.el9", name="zlib", version="1.3",
                  release="1.el9", build_id=114, owner="builder",
                  completed="никогда", tag_name="os-9.2", tags=["os-9.2"],
                  source=src("core/zlib", "os-9.1"), patch_dir_present=True,
                  patches=[patch("sast-zlib.patch", "SAST"),
                           patch("weird.diff", "other")],
                  rpms=["zlib-1.3-1.el9.x86_64", "zlib-1.3-1.el9.src"]),
            # новый компонент
            Build(nvr="curl-8.0-1.el9", name="curl", version="8.0",
                  release="1.el9", build_id=115, owner="net",
                  completed="2026-07-31 00:10:00", tag_name="os-9.2",
                  tags=["os-9.2"], source=src("core/curl", "os-9.2"),
                  patch_dir_present=True,
                  patches=[patch("source.tar.gz", "FILES")],
                  rpms=["curl-8.0-1.el9.x86_64"]),
            # vim в новом теге отсутствует — компонент исчез
        ])


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    dump_snapshots([old_snapshot()], os.path.join(here, "rich-old.json"))
    dump_snapshots([new_snapshot()], os.path.join(here, "rich-new.json"))
    print("написаны rich-old.json и rich-new.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Сгенерировать фикстуры**

Run: `python3 tests/fixtures/make_rich_fixtures.py`
Expected: `написаны rich-old.json и rich-new.json`; оба файла на месте

- [ ] **Step 3: Тест паритета, который сам умеет обновлять эталон**

Create `tests/test_parity.py`:

```python
"""Эталон страницы: с ним сверяется порт представления в JS.

Пока представление считает Python, этот тест сторожит эталон от
незамеченного дрейфа. После переноса вычислений в браузер файл удаляется, а
эталон остаётся — по нему сверяется viewmodel.js.

Обновить эталон осознанно:  python3 -m tests.test_parity --update
"""
import json
import os
import sys
import unittest

from kojipatch.classify import Classifier
from kojipatch.config import load_config
from kojipatch.diff import diff_chain
from kojipatch.model import load_snapshots
from kojipatch.render import build_page_data

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = [os.path.join(ROOT, "tests", "fixtures", "rich-old.json"),
            os.path.join(ROOT, "tests", "fixtures", "rich-new.json")]
GOLDEN = os.path.join(ROOT, "tests", "js", "fixtures", "page-data.golden.json")


def page_data():
    snapshots = []
    for path in FIXTURES:
        snapshots.extend(load_snapshots(path))
    cfg = load_config(None, require_hub=False)
    return build_page_data(snapshots, diff_chain(snapshots),
                           Classifier.from_config(cfg))


def write_golden():
    os.makedirs(os.path.dirname(GOLDEN), exist_ok=True)
    with open(GOLDEN, "w", encoding="utf-8") as handle:
        json.dump(page_data(), handle, ensure_ascii=False, indent=1,
                  sort_keys=True)
        handle.write("\n")


class ParityGolden(unittest.TestCase):
    def test_golden_matches_the_current_render(self):
        with open(GOLDEN, "r", encoding="utf-8") as handle:
            golden = json.load(handle)
        self.assertEqual(page_data(), golden)

    def test_golden_covers_the_interesting_cases(self):
        """Эталон бесполезен, если в нём нет случаев, на которых порт
        ломается. Проверяем, что фикстуры их действительно несут."""
        data = page_data()
        pair = data["pairs"][0]
        statuses = set(row["status"] for row in pair["rows"])
        self.assertEqual(statuses,
                         {"added", "removed", "upgraded", "downgraded",
                          "unchanged"})
        self.assertTrue(pair["counts"]["tag_changed"])
        self.assertTrue(pair["counts"]["repackaged"])
        self.assertTrue(pair["counts"]["branch_changed"])
        rows = data["snapshots"][0]["builds"]
        self.assertIn(None, [row["tagged_in"] for row in rows])
        self.assertIn(True, [row["inherited"] for row in rows])


if __name__ == "__main__":
    if "--update" in sys.argv:
        write_golden()
        print("эталон обновлён:", GOLDEN)
    else:
        unittest.main()
```

- [ ] **Step 4: Убедиться, что тест падает без эталона**

Run: `python3 -m unittest tests.test_parity -v`
Expected: FAIL — `FileNotFoundError` на `page-data.golden.json`

- [ ] **Step 5: Снять эталон**

Run: `python3 -m tests.test_parity --update`
Expected: `эталон обновлён: …/tests/js/fixtures/page-data.golden.json`

- [ ] **Step 6: Проверить, что тесты проходят**

Run: `python3 -m unittest discover -s tests -t . -q`
Expected: OK, 361 тест

Если `test_golden_covers_the_interesting_cases` не прошёл — значит фикстуры
не покрывают перечисленное; править `make_rich_fixtures.py`, а не тест.

- [ ] **Step 7: Коммит**

```bash
git add tests/fixtures/make_rich_fixtures.py tests/fixtures/rich-old.json \
        tests/fixtures/rich-new.json tests/js/fixtures/page-data.golden.json \
        tests/test_parity.py
git commit -m "Эталон страницы и богатые фикстуры для паритета"
```

---

### Task 3: `vercmp.js` — сравнение версий

**Files:**
- Create: `kojipatch/assets/js/vercmp.js`
- Create: `tests/js/vercmp.test.js`
- Reference: `kojipatch/rpmvercmp.py` (порт), `tests/test_rpmvercmp.py`
  (тесты для переноса)

**Interfaces:**
- Consumes: ничего
- Produces: `KP.vercmp` / `module.exports` с
  `rpmvercmp(a: string, b: string) -> -1|0|1` и
  `compareEvr(a: [epoch, version, release], b: same) -> -1|0|1`,
  где `epoch` — число или `null`

- [ ] **Step 1: Первые тесты**

Create `tests/js/vercmp.test.js`:

```js
'use strict';
var test = require('node:test');
var assert = require('node:assert');
var vercmp = require('../../kojipatch/assets/js/vercmp.js');

test('одинаковые строки равны', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.0', '1.0'), 0);
});

test('числовые сегменты сравниваются как числа', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.10', '1.9'), 1);
  assert.strictEqual(vercmp.rpmvercmp('1.9', '1.10'), -1);
});

test('тильда сортируется раньше всего', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.0~rc1', '1.0'), -1);
  assert.strictEqual(vercmp.rpmvercmp('1.0', '1.0~rc1'), 1);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/`
Expected: FAIL — `Cannot find module '../../kojipatch/assets/js/vercmp.js'`

- [ ] **Step 3: Реализация**

Create `kojipatch/assets/js/vercmp.js` — построчный порт
`kojipatch/rpmvercmp.py`. Полный текст:

```js
/* Сравнение версий по алгоритму RPM, без внешних зависимостей. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.vercmp = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIGITS = /^(\d+)/;
  var ALPHA = /^([A-Za-z]+)/;

  /* Python-версия опирается на str.isalnum(), который шире \w: для «²» он
     истинен. Здесь ровно та же широта — Unicode-классы регулярки, — иначе
     на экзотическом символе две реализации разошлись бы. */
  var ALNUM = /[0-9A-Za-zÀ-￿]/;

  function stripSeparators(text) {
    var index = 0;
    while (index < text.length
           && !(ALNUM.test(text.charAt(index))
                || text.charAt(index) === '~' || text.charAt(index) === '^')) {
      index += 1;
    }
    return text.slice(index);
  }

  function rpmvercmp(a, b) {
    a = a || '';
    b = b || '';
    if (a === b) return 0;

    while (a || b) {
      a = stripSeparators(a);
      b = stripSeparators(b);

      if (a.charAt(0) === '~' || b.charAt(0) === '~') {
        if (a.charAt(0) !== '~') return 1;
        if (b.charAt(0) !== '~') return -1;
        a = a.slice(1); b = b.slice(1);
        continue;
      }

      if (a.charAt(0) === '^' || b.charAt(0) === '^') {
        if (!a) return -1;
        if (!b) return 1;
        if (a.charAt(0) !== '^') return 1;
        if (b.charAt(0) !== '^') return -1;
        a = a.slice(1); b = b.slice(1);
        continue;
      }

      if (!a || !b) break;

      var numeric = /[0-9]/.test(a.charAt(0));
      var re = numeric ? DIGITS : ALPHA;
      var matchA = re.exec(a), matchB = re.exec(b);

      if (matchA === null || matchB === null) {
        /* Разобрать нечем ни ту, ни другую сторону — выходим, чтобы не
           крутиться на месте вечно. */
        if (matchA === null && matchB === null) break;
        /* Цифры весомее букв; сторона, которая не разобралась, легче. */
        if (matchB === null) return numeric ? 1 : -1;
        return numeric ? -1 : 1;
      }

      var segA = matchA[1], segB = matchB[1];
      a = a.slice(segA.length);
      b = b.slice(segB.length);

      if (numeric) {
        segA = segA.replace(/^0+/, '') || '0';
        segB = segB.replace(/^0+/, '') || '0';
        if (segA.length !== segB.length) return segA.length > segB.length ? 1 : -1;
      }

      if (segA !== segB) return segA > segB ? 1 : -1;
    }

    if (!a && !b) return 0;
    return a ? 1 : -1;
  }

  function compareEvr(a, b) {
    var epochA = Number(a[0] || 0), epochB = Number(b[0] || 0);
    if (epochA !== epochB) return epochA > epochB ? 1 : -1;
    var result = rpmvercmp(a[1], b[1]);
    if (result) return result;
    return rpmvercmp(a[2], b[2]);
  }

  return { rpmvercmp: rpmvercmp, compareEvr: compareEvr };
}));
```

- [ ] **Step 4: Проверить, что тесты проходят**

Run: `node --test tests/js/`
Expected: PASS, 3 теста

- [ ] **Step 5: Перенести остальные тесты**

Дописать в `tests/js/vercmp.test.js` по одному тесту на каждый тест из
`tests/test_rpmvercmp.py` (18 штук; исходник с готовыми данными лежит
рядом, брать значения оттуда):

`test_equal`, `test_numeric_segments`, `test_leading_zeros_ignored`,
`test_digits_beat_letters`, `test_alpha_suffix_is_greater_than_bare`,
`test_separators_are_equivalent`, `test_tilde_sorts_before_everything`,
`test_caret_sorts_after_bare_but_before_next`, `test_empty_strings`,
`test_pseudo_digit_against_digit`, `test_pseudo_digit_against_letters`,
`test_two_pseudo_digits_do_not_hang`, `test_comparison_is_antisymmetric`,
`test_evr_with_a_pseudo_digit_does_not_raise`, `test_release_breaks_the_tie`,
`test_epoch_dominates`, `test_missing_epoch_equals_zero`,
`test_full_equality`.

Три из них уже написаны на шаге 1 (`test_equal`, `test_numeric_segments`,
`test_tilde_sorts_before_everything`) — их дублировать не нужно.

Тесты про «псевдоцифры» (`²`) обязательны: именно они ловят расхождение
`str.isdigit()` и `\d`, из-за которого порт может зациклиться. Пример:

```js
test('псевдоцифра против цифры не роняет и не зацикливает', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.²', '1.2'), -1);
  assert.strictEqual(vercmp.rpmvercmp('1.2', '1.²'), 1);
});

test('две псевдоцифры не подвешивают цикл', function () {
  assert.strictEqual(vercmp.rpmvercmp('²', '³'), 0);
});
```

Значения ожиданий сверять с `tests/test_rpmvercmp.py`: если Python и JS
расходятся, править **JS**, а не тест.

- [ ] **Step 6: Проверить**

Run: `node --test tests/js/`
Expected: PASS, 18 тестов

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/assets/js/vercmp.js tests/js/vercmp.test.js
git commit -m "Порт сравнения версий rpm в JS"
```

---

### Task 4: `rpms.js` — архитектуры и порядок пакетов

**Files:**
- Create: `kojipatch/assets/js/rpms.js`
- Create: `tests/js/rpms.test.js`
- Reference: `kojipatch/rpms.py`, `tests/test_rpms.py`

**Interfaces:**
- Consumes: ничего
- Produces: `KP.rpms` с `archOf(nvra) -> string`,
  `compareArch(a, b) -> -1|0|1`, `compareNvra(a, b) -> -1|0|1`,
  `sortRpms(list) -> Array<string>` (новый массив, исходный не трогает)

- [ ] **Step 1: Тесты**

Create `tests/js/rpms.test.js`:

```js
'use strict';
var test = require('node:test');
var assert = require('node:assert');
var rpms = require('../../kojipatch/assets/js/rpms.js');

test('архитектура — хвост после последней точки', function () {
  assert.strictEqual(rpms.archOf('nginx-1.24.0-3.el9.x86_64'), 'x86_64');
});

test('точки внутри версии не сбивают', function () {
  assert.strictEqual(rpms.archOf('kernel-5.14.0-611.34.1.el9_7.x86_64'),
                     'x86_64');
});

test('строка без точки', function () {
  assert.strictEqual(rpms.archOf('nginx'), '?');
});

test('сперва src, потом noarch, потом остальные по алфавиту', function () {
  assert.deepStrictEqual(
    rpms.sortRpms(['p-1-1.x86_64', 'p-1-1.noarch', 'p-1-1.src',
                   'p-1-1.aarch64']),
    ['p-1-1.src', 'p-1-1.noarch', 'p-1-1.aarch64', 'p-1-1.x86_64']);
});

test('группировка по архитектуре важнее имени', function () {
  assert.deepStrictEqual(
    rpms.sortRpms(['zzz-1-1.src', 'aaa-1-1.x86_64']),
    ['zzz-1-1.src', 'aaa-1-1.x86_64']);
});

test('пустой список', function () {
  assert.deepStrictEqual(rpms.sortRpms([]), []);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/rpms.test.js`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

Create `kojipatch/assets/js/rpms.js`:

```js
/* Архитектура RPM и порядок пакетов в списках. Порядок нужен и в строках
   таблицы, и в выравнивании «было/стало», поэтому он один на всех. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.rpms = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* src и noarch — не «ещё одна архитектура», а исходник и пакет, которому
     архитектура не нужна. Остальные идут по алфавиту. */
  var LEADING = ['src', 'noarch'];

  function archOf(nvra) {
    var index = String(nvra).lastIndexOf('.');
    return index === -1 ? '?' : String(nvra).slice(index + 1);
  }

  function archRank(arch) {
    var index = LEADING.indexOf(arch);
    return index === -1 ? LEADING.length : index;
  }

  function compareArch(a, b) {
    var ra = archRank(a), rb = archRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    /* Внутри ведущей группы имя уже определено рангом; сравнивать нечего. */
    if (ra < LEADING.length) return 0;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function compareNvra(a, b) {
    var byArch = compareArch(archOf(a), archOf(b));
    if (byArch) return byArch;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function sortRpms(items) {
    return (items || []).slice().sort(compareNvra);
  }

  return { archOf: archOf, compareArch: compareArch,
           compareNvra: compareNvra, sortRpms: sortRpms };
}));
```

- [ ] **Step 4: Проверить**

Run: `node --test tests/js/rpms.test.js`
Expected: PASS, 6 тестов

- [ ] **Step 5: Дописать оставшиеся тесты**

Перенести из `tests/test_rpms.py` те, что не покрыты шагом 1:
`test_source_rpm`, `test_key_without_version_release_also_works`,
`test_other_arches_go_alphabetically`,
`test_inside_an_arch_packages_are_sorted_by_name`. Итого 10 тестов, как в
Python.

- [ ] **Step 6: Проверить**

Run: `node --test tests/js/`
Expected: PASS, 28 тестов (18 из Task 3 + 10)

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/assets/js/rpms.js tests/js/rpms.test.js
git commit -m "Порт порядка RPM по архитектурам в JS"
```

---

### Task 5: `diff.js` — сравнение снапшотов

Самый объёмный порт после `viewmodel.js`. Работает с сырыми объектами
снапшота: `build` — это разобранный JSON, а не dataclass.

**Files:**
- Create: `kojipatch/assets/js/diff.js`
- Create: `tests/js/diff.test.js`
- Reference: `kojipatch/diff.py`, `tests/test_diff.py`

**Interfaces:**
- Consumes: `KP.vercmp.compareEvr`, `KP.rpms.archOf`, `KP.rpms.compareArch`
- Produces: `KP.diff` с:
  - `diffSnapshots(oldSnap, newSnap, isSummary) -> pair`
  - `diffChain(snapshots) -> Array<pair>`
  - `alignRpms(oldBuild, newBuild) -> Array<[string|null, string|null]>`
  - `pair` = `{old_tag, new_tag, is_summary, components, counts}`
  - `component` = `{name, status, old, new, patches_added, patches_removed,
    rpms_added, rpms_removed, branch_changed, repackaged, tag_changed,
    changed}` — где `old`/`new` — сырые объекты билдов или `null`, а
    `changed` — **булево поле**, а не метод (в Python это метод
    `ComponentDiff.changed()`)

- [ ] **Step 1: Тесты на статусы и дельты**

Create `tests/js/diff.test.js`:

```js
'use strict';
var test = require('node:test');
var assert = require('node:assert');
var diff = require('../../kojipatch/assets/js/diff.js');

function build(over) {
  var b = { nvr: 'nginx-1.0-1.el9', name: 'nginx', version: '1.0',
            release: '1.el9', epoch: null, tag_name: 'os-9.1', tags: [],
            source: { ref: 'os-9.1', ref_kind: 'branch' },
            patches: [], rpms: [], problems: [] };
  for (var key in over) if (over.hasOwnProperty(key)) b[key] = over[key];
  return b;
}

function snap(tag, builds) {
  return { tag: tag, generated: '2026-08-01T00:00:00+03:00',
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: ['CVE', 'other'], builds: builds };
}

function only(pair) { return pair.components[0]; }

test('компонент появился', function () {
  var pair = diff.diffSnapshots(snap('a', []), snap('b', [build({})]));
  assert.strictEqual(only(pair).status, 'added');
  assert.strictEqual(only(pair).old, null);
  assert.deepStrictEqual(only(pair).patches_added, []);
});

test('компонент исчез', function () {
  var pair = diff.diffSnapshots(snap('a', [build({})]), snap('b', []));
  assert.strictEqual(only(pair).status, 'removed');
  assert.strictEqual(only(pair).new, null);
});

test('версия выросла', function () {
  var pair = diff.diffSnapshots(
    snap('a', [build({})]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0' })]));
  assert.strictEqual(only(pair).status, 'upgraded');
});

test('состав подпакетов не изменился при росте версии', function () {
  var pair = diff.diffSnapshots(
    snap('a', [build({ rpms: ['nginx-1.0-1.el9.x86_64'] })]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0',
                       rpms: ['nginx-2.0-1.el9.x86_64'] })]));
  assert.strictEqual(only(pair).repackaged, false);
});

test('переезд между тегами — только при том же NVR', function () {
  var pair = diff.diffSnapshots(
    snap('a', [build({ tag_name: 'os-9.0' })]),
    snap('b', [build({ tag_name: 'os-9.2' })]));
  assert.strictEqual(only(pair).tag_changed, true);
  var upgraded = diff.diffSnapshots(
    snap('a', [build({ tag_name: 'os-9.0' })]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0',
                       tag_name: 'os-9.2' })]));
  assert.strictEqual(only(upgraded).tag_changed, false);
});

test('changed — булево, а не список', function () {
  var pair = diff.diffSnapshots(snap('a', [build({})]), snap('b', [build({})]));
  assert.strictEqual(only(pair).changed, false);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/diff.test.js`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

Create `kojipatch/assets/js/diff.js`. Порт `kojipatch/diff.py` целиком;
комментарии-обоснования из Python перенести — они объясняют, почему
сравнение устроено именно так, и без них следующий читатель «упростит»
`tagChanged` обратно в ложные срабатывания.

Каркас с точными сигнатурами (тела функций — перевод соответствующих
функций `diff.py`, строка в строку):

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vercmp.js'), require('./rpms.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.diff = factory(root.KP.vercmp, root.KP.rpms);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (vercmp, rpmsmod) {
  'use strict';

  var STATUSES = ['added', 'removed', 'unchanged', 'upgraded', 'downgraded'];

  function evr(build) { return [build.epoch, build.version, build.release]; }

  function status(oldB, newB) {           /* → diff.py:_status */ }
  function refOf(build) {                 /* → diff.py:_ref */ }
  function tagChanged(oldB, newB) {       /* → diff.py:_tag_changed */ }
  function rpmKey(build, nvra) {          /* → diff.py:_rpm_key */ }
  function rpmKeys(build) {               /* → diff.py:_rpm_keys, вернуть Map */ }
  function rpmDelta(source, other) {      /* → diff.py:_rpm_delta */ }
  function rpmRowPairs(left, right) {     /* → diff.py:_rpm_row_pairs */ }
  function alignRpms(oldB, newB) {        /* → diff.py:align_rpms */ }
  function isChanged(component) {         /* → ComponentDiff.changed */ }
  function counts(components) {           /* → diff.py:_counts */ }
  function diffSnapshots(oldSnap, newSnap, isSummary) { /* → diff_snapshots */ }
  function diffChain(snapshots) {         /* → diff.py:diff_chain */ }

  return { diffSnapshots: diffSnapshots, diffChain: diffChain,
           alignRpms: alignRpms };
}));
```

Точки, где перевод не механический:

- `rpmKeys` возвращает `Map`, а не объект: в `alignRpms` перебор идёт в
  порядке вставки, и целочисленные ключи объекта его бы нарушили.
- `_rpm_delta` в Python строит разность множеств и сортирует. В JS:
  собрать ключи `source`, которых нет в `other`, слить их массивы NVRA,
  отсортировать строковым компаратором.
- `set(old_rpms) != set(new_rpms)` для `repackaged` — сравнить размеры
  и наличие каждого ключа, не полагаясь на порядок.
- Множества путей патчей (`{p.path for p in build.patches}`) — `Set` из
  `build.patches.map(...)`; результат дельты сортировать явно.
- `sorted(set(old_map) | set(new_map))` для имён компонентов — собрать
  имена в `Set`, разложить в массив, отсортировать строковым
  компаратором.
- `component.changed` — поле, посчитанное один раз в `diffSnapshots`;
  `counts` читает это же поле.
- Порядок ключей в `counts` роли не играет: сравнение с эталоном
  структурное.

- [ ] **Step 4: Проверить**

Run: `node --test tests/js/diff.test.js`
Expected: PASS, 6 тестов

- [ ] **Step 5: Перенести остальные тесты**

Дописать в `tests/js/diff.test.js` по тесту на каждый из 43 тестов
`tests/test_diff.py`. Полный список (шесть из них уже покрыты шагом 1 —
`test_added`, `test_removed`, `test_upgraded`,
`test_version_bump_alone_is_not_repackaged`,
`test_retagged_directly_into_the_new_tag`,
`test_changed_returns_a_bool_not_a_list`):

`test_added`, `test_removed`, `test_unchanged`, `test_upgraded`,
`test_downgraded`, `test_release_only_change_is_an_upgrade`,
`test_epoch_dominates`, `test_patch_delta`, `test_rpm_delta_sets_repackaged`,
`test_version_bump_alone_is_not_repackaged`,
`test_new_subpackage_on_a_version_bump_is_repackaged`,
`test_release_only_bump_is_not_repackaged`, `test_arch_change_is_repackaged`,
`test_branch_change_is_flagged`, `test_same_branch_is_not_flagged`,
`test_changed_returns_a_bool_not_a_list`,
`test_added_component_has_no_deltas`,
`test_retagged_directly_into_the_new_tag`,
`test_same_tag_on_both_sides_is_not_a_change`,
`test_plain_inheritance_of_the_older_tag_is_not_a_change`,
`test_a_new_version_in_a_new_tag_is_not_a_move`,
`test_unknown_tag_on_either_side_is_not_a_change`,
`test_tag_change_alone_makes_the_component_changed`,
`test_counts_have_a_bucket`, `test_same_subpackage_stands_opposite_itself`,
`test_disappeared_subpackage_keeps_its_place`,
`test_new_subpackage_goes_to_the_bottom`, `test_left_column_is_sorted`,
`test_component_without_an_old_build`, `test_component_without_a_new_build`,
`test_no_builds_at_all`, `test_arch_split_is_two_rows`,
`test_rows_come_grouped_by_arch`,
`test_new_subpackage_goes_to_the_bottom_of_its_own_arch`,
`test_arch_present_on_one_side_only_still_keeps_its_group`,
`test_rows_agree_with_the_deltas`, `test_counts_cover_every_bucket`,
`test_tags_are_recorded`, `test_components_sorted_by_name`,
`test_single_snapshot_gives_no_pairs`,
`test_two_snapshots_give_one_pair_without_summary`,
`test_three_snapshots_give_two_steps_plus_summary`,
`test_summary_compares_endpoints_not_steps`.

Данные для каждого брать из одноимённого теста в `tests/test_diff.py`.

- [ ] **Step 6: Проверить**

Run: `node --test tests/js/`
Expected: PASS, 71 тест

- [ ] **Step 7: Коммит**

```bash
git add kojipatch/assets/js/diff.js tests/js/diff.test.js
git commit -m "Порт сравнения снапшотов в JS"
```

---

### Task 6: `viewmodel.js` — данные страницы, и сверка с эталоном

**Files:**
- Create: `kojipatch/assets/js/viewmodel.js`
- Create: `tests/js/viewmodel.test.js`
- Reference: `kojipatch/render.py:28-265`, `tests/test_render.py`

**Interfaces:**
- Consumes: `KP.diff.diffChain`, `KP.diff.alignRpms`, `KP.rpms.sortRpms`
- Produces: `KP.viewmodel` с:
  - `buildPageData(snapshots) -> {generated, patch_classes, snapshots, pairs}`
  - `slug(name) -> string`
  - `toMsk(value) -> string|null`
  - `patchClassesOf(snapshots) -> Array<string>`

  Важно: в Python `build_page_data(snapshots, pairs, classifier)` берёт три
  аргумента; в JS аргумент один — пары считаются внутри, а список классов
  берётся из самих снапшотов.

- [ ] **Step 1: Тесты на список классов, слаг и МСК**

Create `tests/js/viewmodel.test.js`:

```js
'use strict';
var test = require('node:test');
var assert = require('node:assert');
var vm = require('../../kojipatch/assets/js/viewmodel.js');

test('список классов берётся из первого снапшота', function () {
  var snaps = [{ patch_classes: ['CVE', 'SAST', 'other'], builds: [] },
               { patch_classes: ['CVE', 'other'], builds: [] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'SAST', 'other']);
});

test('классы из более поздних снапшотов дописываются в конец', function () {
  var snaps = [{ patch_classes: ['CVE'], builds: [] },
               { patch_classes: ['CVE', 'DAST'], builds: [] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'DAST']);
});

test('снапшот без списка: классы выводятся из патчей по алфавиту', function () {
  var snaps = [{ builds: [{ patches: [{ class: 'SAST' }, { class: 'CVE' }] }] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'SAST']);
});

test('слаг совпадает с правилом дашборда', function () {
  assert.strictEqual(vm.slug('C++'), 'c-');
  assert.strictEqual(vm.slug('CVE'), 'cve');
});

test('UTC становится МСК', function () {
  assert.strictEqual(vm.toMsk('2026-05-14 21:30:00'), '2026-05-15 00:30:00');
});

test('дата без времени не сдвигается', function () {
  assert.strictEqual(vm.toMsk('2026-05-14'), '2026-05-14');
});

test('неразбираемое значение остаётся как есть', function () {
  assert.strictEqual(vm.toMsk('никогда'), 'никогда');
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/viewmodel.test.js`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация**

Create `kojipatch/assets/js/viewmodel.js` — порт `kojipatch/render.py`
(всё, кроме `render_html` и `_encode`: они остаются питоновскими и
переезжают в `build.py`).

Функции, которые надо перенести, и их питоновские прообразы:

| JS | Python |
|---|---|
| `kojiUrl(kojiWeb, nvr)` | `_koji_url` |
| `evrOf(build)` | `_evr` |
| `slug(name)` | `slug` |
| `toMsk(value)` | `to_msk` |
| `inheritedIn(build, tag)` | `_inherited` |
| `tagSortKey(tag, classOrder)` | `_tag_sort_key` |
| `buildTags(build, tag, classOrder)` | `_build_tags` |
| `patchDict(patch)` | `_patch_dict` |
| `buildRow(build, kojiWeb, tag, classOrder)` | `_build_row` |
| `snapshotCounts(rows, classNames)` | `_snapshot_counts` |
| `diffTags(component)` | `_diff_tags` |
| `diffRow(component, kojiWeb, oldTag, newTag)` | `_diff_row` |
| `buildPageData(snapshots)` | `build_page_data` |

Куски, где перевод не механический — ниже полный текст, остальное
переводится строка в строку.

Ссылка на koji. `encodeURIComponent` экранирует `/`, `~`, `!`, `*`, `'`,
`(`, `)` не так, как `urllib.parse.quote`, и ссылки разошлись бы с
эталоном:

```js
  /* Повторяет urllib.parse.quote с safe='/': всё, кроме букв, цифр и
     _.-~/ , уходит в проценты. Своя функция, а не encodeURIComponent:
     тот экранирует «/» и не трогает «!*'()», и ссылки разъехались бы. */
  function quote(text) {
    return String(text).replace(/[^A-Za-z0-9_.\-~/]/g, function (ch) {
      var code = ch.charCodeAt(0), out = '', bytes, i;
      if (code < 128) return '%' + ('0' + code.toString(16).toUpperCase()).slice(-2);
      bytes = unescape(encodeURIComponent(ch));
      for (i = 0; i < bytes.length; i++) {
        out += '%' + ('0' + bytes.charCodeAt(i).toString(16).toUpperCase()).slice(-2);
      }
      return out;
    });
  }

  function kojiUrl(kojiWeb, nvr) {
    if (!kojiWeb) return null;
    return String(kojiWeb).replace(/\/+$/, '')
      + '/search?match=exact&type=build&terms=' + quote(nvr);
  }
```

Московское время. Считать через `Date.UTC`, иначе результат зависит от
пояса машины:

```js
  /* Москва — UTC+3 круглый год: перехода на летнее время в России нет с
     2014, поэтому смещение задано числом, а не через часовые пояса.
     Дата без часа не переводится: прибавив три часа к неизвестному
     времени, мы бы утверждали то, чего не знаем. */
  var MSK_SHIFT_MS = 3 * 60 * 60 * 1000;
  var STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toMsk(value) {
    if (!value || String(value).length <= 10) return value === undefined ? null : value;
    var m = STAMP.exec(String(value));
    if (!m) return value;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + MSK_SHIFT_MS;
    var d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-'
      + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':'
      + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }
```

Список классов. В Python приходил из конфига; здесь берётся из снапшотов:

```js
  /* Порядок классов задаёт и карточки, и метки в строке. Берём его из
     снапшота: конфига у дашборда нет. Первый снапшот задаёт порядок,
     остальные могут только дописать в конец то, чего в нём не было.
     Снапшот прежней версии списка не несёт — тогда выводим классы из
     самих патчей по алфавиту: выдумывать порядок конфига нельзя. */
  function patchClassesOf(snapshots) {
    var out = [], i, j, list;
    for (i = 0; i < snapshots.length; i++) {
      list = snapshots[i].patch_classes || [];
      for (j = 0; j < list.length; j++) {
        if (out.indexOf(list[j]) === -1) out.push(list[j]);
      }
    }
    if (out.length) return out;
    var seen = {}, derived = [], builds, patches, k;
    for (i = 0; i < snapshots.length; i++) {
      builds = snapshots[i].builds || [];
      for (j = 0; j < builds.length; j++) {
        patches = builds[j].patches || [];
        for (k = 0; k < patches.length; k++) {
          if (!seen[patches[k]['class']]) {
            seen[patches[k]['class']] = 1;
            derived.push(patches[k]['class']);
          }
        }
      }
    }
    return derived.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }
```

Точка входа. В Python пары приходили снаружи, здесь считаются внутри:

```js
  function buildPageData(snapshots) {
    snapshots = snapshots || [];
    var classNames = patchClassesOf(snapshots);
    var classOrder = [], i;
    for (i = 0; i < classNames.length; i++) classOrder.push(slug(classNames[i]));

    var blocks = [];
    for (i = 0; i < snapshots.length; i++) {
      var snap = snapshots[i];
      var rows = (snap.builds || []).map(function (b) {
        return buildRow(b, snap.koji_web, snap.tag, classOrder);
      }).sort(function (a, b) {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      blocks.push({ tag: snap.tag, generated: snap.generated,
                    koji_web: snap.koji_web || null,
                    counts: snapshotCounts(rows, classNames), builds: rows });
    }

    var pairs = [];
    var chain = diff.diffChain(snapshots);
    for (i = 0; i < chain.length; i++) {
      pairs.push(pairBlock(chain[i], snapshots));
    }

    return { generated: snapshots.length ? snapshots[0].generated : '',
             patch_classes: classNames, snapshots: blocks, pairs: pairs };
  }
```

`pairBlock(pair, snapshots)` собирает `{old, new, summary, counts, rows}`,
находя снапшоты по `pair.old_tag` / `pair.new_tag`, и для каждой строки
зовёт `diffRow(component, kojiWeb, pair.old_tag, pair.new_tag)`.

**Осознанное расхождение с Python:** `kojiWeb` для строки диффа берётся у
того снапшота, из которого пришёл показанный билд (нового, если он есть,
иначе старого), а не общий по первому снапшоту, как в `render.py:251`. При
одном прогоне это одно и то же, а при подгрузке файлов из разных прогонов
общий адрес вёл бы на чужой хаб. На эталоне расхождения не даёт: в
фикстурах `koji_web` одинаков. В коде это должно быть отмечено
комментарием — иначе следующий читатель сочтёт расхождение с эталоном
ошибкой.

- [ ] **Step 4: Проверить первые тесты**

Run: `node --test tests/js/viewmodel.test.js`
Expected: PASS, 7 тестов

- [ ] **Step 5: Паритетный тест**

Дописать в `tests/js/viewmodel.test.js`:

```js
var fs = require('node:fs');
var path = require('node:path');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
}

test('данные страницы совпадают с питоновским эталоном', function () {
  var snaps = [].concat(readJson('../fixtures/rich-old.json'),
                        readJson('../fixtures/rich-new.json'));
  /* Через JSON туда и обратно: так undefined превращается в отсутствие
     ключа и расходится с null эталона — ровно та ошибка, которую этот
     тест обязан ловить. */
  var actual = JSON.parse(JSON.stringify(vm.buildPageData(snaps)));
  assert.deepStrictEqual(actual, readJson('./fixtures/page-data.golden.json'));
});
```

- [ ] **Step 6: Гонять до зелёного паритета**

Run: `node --test tests/js/viewmodel.test.js`
Expected: сначала FAIL с расхождением — читать diff в выводе
`assert.deepStrictEqual` и править **JS**, пока не сойдётся. Эталон не
трогать: он снят с работающего Python.

Частые причины расхождений, по убыванию вероятности: `undefined` вместо
`null`; порядок в списках, полученных из множеств; `encodeURIComponent`
вместо `quote`; сдвиг времени, посчитанный локальным поясом.

- [ ] **Step 7: Перенести остальные тесты**

Дописать по тесту на каждый из тестов `tests/test_render.py`, относящихся
к данным страницы (32 штуки; остальные 18 проверяют HTML-шаблон и
переезжают в Task 7):

`test_patch_classes_come_from_classifier` (в JS —
`patchClassesOf` из снапшота), `test_snapshot_counts`,
`test_tags_keep_one_order_whatever_the_file_order`,
`test_classes_go_in_classifier_order_not_alphabetically`,
`test_state_tags_follow_a_fixed_order`,
`test_direct_and_inherited_builds_are_told_apart`,
`test_row_carries_the_other_koji_tags`,
`test_koji_tags_are_empty_when_the_snapshot_has_none`,
`test_inherited_builds_are_counted`,
`test_diff_tags_follow_a_fixed_order`, `test_pair_rows_carry_both_tags`,
`test_build_rpms_come_grouped_by_arch`, `test_builds_are_sorted_by_name`,
`test_build_row_fields`, `test_row_tags_for_patch_classes`,
`test_class_tag_uses_the_dashboard_slug_rule`,
`test_slug_matches_the_javascript_rule`, `test_gitlab_error_tag`,
`test_from_commit_tag`, `test_internal_error_tag`,
`test_gitlab_error_does_not_imply_internal_error`, `test_pairs_are_rendered`,
`test_pair_rows_carry_aligned_rpm_rows`, `test_summary_pair_is_marked`,
`test_utc_becomes_msk`, `test_conversion_crosses_midnight`,
`test_conversion_crosses_a_month`, `test_date_without_time_is_left_alone`,
`test_unparsable_value_survives_as_is`, `test_empty_values`,
`test_build_row_carries_moscow_time`,
`test_build_row_shifts_a_full_timestamp`.

Семь из них уже написаны на шаге 1.

- [ ] **Step 8: Проверить оба набора**

Run: `node --test tests/js/ && python3 -m unittest discover -s tests -t . -q`
Expected: PASS, 104 теста JS; OK, 361 тест Python

- [ ] **Step 9: Коммит**

```bash
git add kojipatch/assets/js/viewmodel.js tests/js/viewmodel.test.js
git commit -m "Порт данных страницы в JS, паритет с эталоном"
```

---

### Task 7: Разложить HTML, собрать его из кусков

Ядро переехало, но дашборд его ещё не зовёт. Здесь разбираем
`dashboard.html` на шаблон и `ui.js`, добавляем сборку и команду
`dashboard`. Вид и поведение не меняются — меняется только то, откуда
берутся данные: не запечённый `DATA`, а `KP.viewmodel.buildPageData`.

Данные на этом шаге всё ещё попадают в файл: `render` вставляет сырые
снапшоты прелюдией `window.KP_SNAPSHOTS = […]`. Это временно и уйдёт в
Task 9 — но без этого дашборд нечем открыть, пока нет загрузчика, и «до»
с «после» не сравнить.

**Files:**
- Create: `kojipatch/build.py`
- Create: `kojipatch/assets/js/ui.js`
- Modify: `kojipatch/assets/dashboard.html` (весь блок `<script>` → плейсхолдер)
- Modify: `kojipatch/cli.py` (подкоманда `dashboard`, `render` через `build_html`)
- Create: `tests/test_build.py`
- Modify: `tests/test_render.py` (удалить тесты HTML-шаблона, переехавшие
  в `tests/test_build.py`)

**Interfaces:**
- Consumes: `KP.viewmodel.buildPageData(snapshots)` из Task 6
- Produces:
  - `kojipatch.build.build_html(snapshots=None, template_path=None) -> str`
  - `kojipatch.build.BuildError`
  - `kojipatch.build.SCRIPTS: Tuple[str, ...]` — порядок подключения
  - в `ui.js`: `applyData(pageData)` — принимает данные страницы и
    перерисовывает всё; на этом шаге зовётся один раз при старте

- [ ] **Step 1: Тесты сборки**

Create `tests/test_build.py`:

```python
import json
import re
import unittest

from kojipatch.build import SCRIPTS, BuildError, build_html
from kojipatch.model import load_snapshots


class BuildHtml(unittest.TestCase):
    def test_no_placeholder_remains(self):
        html = build_html()
        self.assertNotIn("<!--__SCRIPTS__-->", html)

    def test_every_script_is_inlined(self):
        html = build_html()
        for name in SCRIPTS:
            self.assertIn("/* %s */" % name, html,
                          "в собранном файле нет %s" % name)

    def test_scripts_go_in_dependency_order(self):
        html = build_html()
        positions = [html.index("/* %s */" % name) for name in SCRIPTS]
        self.assertEqual(positions, sorted(positions))

    def test_no_external_resources(self):
        """Дашборд открывают там, где интернета нет."""
        html = build_html()
        self.assertNotIn("http://", html.split("<script")[0])
        self.assertNotRegex(html, r"<(script|link)[^>]+src=\"https?:")

    def test_empty_dashboard_carries_no_data(self):
        self.assertNotIn("KP_SNAPSHOTS", build_html())

    def test_snapshots_are_embedded_as_a_prelude(self):
        snapshots = load_snapshots("tests/fixtures/rich-old.json")
        html = build_html(snapshots)
        raw = re.search(r"window\.KP_SNAPSHOTS = (\[.*?\]);", html, re.S)
        self.assertIsNotNone(raw)
        self.assertEqual(json.loads(raw.group(1))[0]["tag"], "os-9.1")

    def test_script_close_tag_is_escaped(self):
        """«</script>» внутри строки данных закрыл бы блок и снёс страницу."""
        snapshots = load_snapshots("tests/fixtures/rich-old.json")
        snapshots[0].builds[0].problems = ["</script><b>oops"]
        self.assertNotIn("</script><b>", build_html(snapshots))

    def test_missing_template_is_reported(self):
        with self.assertRaises(BuildError):
            build_html(template_path="/nope/dashboard.html")
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `python3 -m unittest tests.test_build -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'kojipatch.build'`

- [ ] **Step 3: Модуль сборки**

Create `kojipatch/build.py`:

```python
"""Сборка дашборда: шаблон плюс скрипты в один самодостаточный файл."""
import json
import logging
import os
from typing import List, Optional

logger = logging.getLogger(__name__)

PLACEHOLDER = "<!--__SCRIPTS__-->"
ASSETS = os.path.join(os.path.dirname(__file__), "assets")
TEMPLATE_PATH = os.path.join(ASSETS, "dashboard.html")
# Порядок по зависимостям, а не по алфавиту: каждый следующий скрипт
# рассчитывает, что предыдущие уже положили себя в KP. store.js добавится
# сюда в Task 8 — перечислять файл, которого ещё нет, значит уронить сборку.
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "ui.js")


class BuildError(Exception):
    """Шаблон или скрипт не найден, либо в шаблоне нет плейсхолдера."""


def _read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read()
    except OSError as exc:
        raise BuildError("не прочитать %s: %s" % (path, exc))


def _encode(data) -> str:
    """JSON, безопасный внутри <script>.

    U+2028 и U+2029 для JS — разделители строк, внутри литерала их быть не
    должно. В самом исходнике они записаны escape-последовательностями:
    глазом такой символ не виден, а редактор, нормализующий переводы строк,
    его молча съест.
    """
    text = json.dumps(data, ensure_ascii=False, sort_keys=True)
    return (text.replace("</", "<\\/")
                .replace("\u2028", "\\u2028")
                .replace("\u2029", "\\u2029"))


def build_html(snapshots: Optional[List] = None,
               template_path: Optional[str] = None) -> str:
    """Собранная страница. snapshots=None — пустой дашборд."""
    path = template_path or TEMPLATE_PATH
    template = _read(path)
    if PLACEHOLDER not in template:
        raise BuildError("в шаблоне %s нет плейсхолдера %s"
                         % (path, PLACEHOLDER))

    blocks = []
    if snapshots:
        from .model import snapshot_to_dict
        payload = [snapshot_to_dict(s) for s in snapshots]
        blocks.append("<script>window.KP_SNAPSHOTS = %s;</script>"
                      % _encode(payload))
    for name in SCRIPTS:
        source = _read(os.path.join(ASSETS, "js", name))
        blocks.append("<script>\n/* %s */\n%s\n</script>" % (name, source))

    html = template.replace(PLACEHOLDER, "\n".join(blocks))
    logger.debug("страница: %d КБ", len(html) // 1024)
    return html
```

- [ ] **Step 4: Разложить шаблон и скрипт**

В `kojipatch/assets/dashboard.html`: вырезать всё от `<script>` до
`</script>` в конце файла и положить содержимое в
`kojipatch/assets/js/ui.js`, обернув хвостом совместимости. На месте
вырезанного оставить строку `<!--__SCRIPTS__-->`.

В `ui.js` заменить получение данных. Было (строки 397–401 старого файла):

```js
var DATA = /*__DATA__*/;
var SNAPS = (DATA && DATA.snapshots) || [];
var PAIRS = (DATA && DATA.pairs) || [];
var CLASSES = (DATA && DATA.patch_classes) || [];
```

Стало:

```js
  /* Данные страницы считаются здесь же, из снапшотов: и запечённых
     прелюдией, и подгруженных человеком — путь один и тот же. */
  var DATA = { generated: '', patch_classes: [], snapshots: [], pairs: [] };
  var SNAPS = [], PAIRS = [], CLASSES = [];

  function applyData(pageData) {
    DATA = pageData;
    SNAPS = pageData.snapshots || [];
    PAIRS = pageData.pairs || [];
    CLASSES = pageData.patch_classes || [];
    for (var ci = 0; ci < CLASSES.length; ci++) {
      LABELS[slug(CLASSES[ci])] = 'патчи ' + CLASSES[ci];
    }
    st.tag = SNAPS.length ? SNAPS.length - 1 : 0;
    st.pair = PAIRS.length ? PAIRS.length - 1 : 0;
    syncTabs();
    readHash();
    showTab(st.tab);
    rebuild();
  }
```

Цикл, который раньше заполнял `LABELS` на верхнем уровне (строки 421–423
старого файла), переезжает внутрь `applyData` — он больше не может
выполниться один раз при загрузке, потому что классы приходят с данными.

Инициализация `st.tag` и `st.pair` (строки 453–454) на верхнем уровне
меняется на `0`: настоящие значения проставит `applyData`.

Функция `syncTabs()` — то, что раньше делал цикл в `start()`, прятавший
вкладку «Изменения»:

```js
  /* Сравнивать нечего — вкладки «Изменения» на странице нет вовсе. */
  function syncTabs() {
    for (var t = 0; t < tabBtns.length; t++) {
      if (tabBtns[t].getAttribute('data-tab') === 'diff') {
        tabBtns[t].hidden = !PAIRS.length;
      }
    }
  }
```

Блок `start()` в конце `ui.js` меняется на:

```js
  /* ---------- старт ---------- */

  function renderMeta() {
    var meta = document.getElementById('meta'), tags = [], i;
    for (i = 0; i < SNAPS.length; i++) tags.push(SNAPS[i].tag);
    meta.innerHTML =
        '<div><b>теги:</b> ' + (tags.length ? esc(tags.join(', ')) : '—') + '</div>'
      + '<div><b>собрано:</b> ' + esc(DATA.generated || '—') + '</div>'
      + '<div><b>классы патчей:</b> ' + esc(CLASSES.join(', ') || '—') + '</div>';
  }

  (function start() {
    var raw = (typeof window !== 'undefined' && window.KP_SNAPSHOTS) || [];
    applyData(KP.viewmodel.buildPageData(raw));
    renderMeta();
    syncStickyOffset();
  }());
```

`renderMeta` вызывается и из `applyData` — в Task 8 набор снапшотов
меняется на лету, и шапка обязана меняться с ним. Чтобы не звать дважды на
старте, вызов оставить только внутри `applyData`, а из `start()` убрать.

- [ ] **Step 5: Подкоманда `dashboard`**

В `kojipatch/cli.py`, в `_parser()` после парсера `render`:

```python
    dashboard = subparsers.add_parser(
        "dashboard", help="положить дашборд на диск (данные подгружаются в нём)")
    dashboard.add_argument("-o", "--output", default="dashboard.html")
```

В `_load_config` конфиг не нужен ни `render`, ни `dashboard`:

```python
    return load_config(args.config, overrides,
                       require_hub=args.command not in ("render", "dashboard"))
```

В `main()`, перед веткой `render`:

```python
        if args.command == "dashboard":
            with open(args.output, "w", encoding="utf-8") as handle:
                handle.write(build_html())
            logger.info("написан %s", args.output)
            return EXIT_OK
```

`_render` переписать на новую сборку:

```python
def _render(snapshots, cfg, output) -> None:
    html = build_html(snapshots)
    with open(output, "w", encoding="utf-8") as handle:
        handle.write(html)
    logger.info("написан %s", output)
```

Импорты: убрать `from .diff import diff_chain`, `from .classify import
Classifier` (если больше не используется) и `from .render import
RenderError, render_html`; добавить `from .build import BuildError,
build_html`. В `main()` перехват `RenderError` заменить на `BuildError`.

- [ ] **Step 6: Развести тесты шаблона**

Перенести из `tests/test_render.py` в `tests/test_build.py` тесты,
проверяющие HTML: `test_html_has_both_tab_containers`,
`test_has_tab_navigation`, `test_has_search_and_expand_controls`,
`test_has_active_filter_chip_bar`, `test_has_copy_nvr_button`,
`test_reuses_ref_html_css_variables`, `test_supports_dark_theme`,
`test_diff_tab_starts_filtered_to_changed_rows`, `test_search_is_debounced`,
`test_pair_lives_in_the_hash_by_tag_names`,
`test_version_sort_is_documented_as_lexicographic`,
`test_tooltip_container_present`, `test_page_size_is_logged_at_debug`.

Они ищут строки в результате — заменить вызов `render_html(...)` на
`build_html()`. Тесты `test_embedded_json_parses`,
`test_line_separators_are_escaped` тоже переносятся, но проверяют теперь
прелюдию `window.KP_SNAPSHOTS`. Тесты `test_no_placeholder_remains`,
`test_script_close_tag_is_escaped`, `test_no_external_resources` уже
написаны на шаге 1 — старые копии удалить.

Остальные тесты `tests/test_render.py` пока остаются: `render.py` жив до
Task 9, и `tests/test_parity.py` на него опирается.

- [ ] **Step 7: Проверить синтаксис всех скриптов**

Run: `for f in kojipatch/assets/js/*.js; do node --check "$f" || echo "СЛОМАН $f"; done`
Expected: ни одного «СЛОМАН»

`ui.js` трогает DOM только внутри функций, поэтому `node --check` его
разбирает; запускать его в node не нужно и нельзя.

- [ ] **Step 8: Прогнать тесты**

Run: `python3 -m unittest discover -s tests -t . -q && node --test tests/js/`
Expected: OK Python; PASS 104 теста JS

- [ ] **Step 9: Проверить глазами**

```bash
python3 -m kojipatch render tests/fixtures/rich-old.json tests/fixtures/rich-new.json -o /tmp/after.html
```

Открыть `/tmp/after.html` в браузере и убедиться: обе вкладки на месте,
переключение тега работает, диффы считаются, раскрытие строк, поиск,
фильтры, подсказки, адресная строка — как раньше. Консоль браузера должна
быть пустой; любая ошибка в ней — незавершённый перенос.

- [ ] **Step 10: Коммит**

```bash
git add kojipatch/build.py kojipatch/assets/js/ui.js kojipatch/assets/dashboard.html \
        kojipatch/cli.py tests/test_build.py tests/test_render.py
git commit -m "Дашборд собирается из шаблона и скриптов, данные считает сам"
```

---

### Task 8: Загрузка снапшотов в дашборде

Ради этого всё и затевалось.

**Files:**
- Create: `kojipatch/assets/js/store.js`
- Create: `tests/js/store.test.js`
- Modify: `kojipatch/assets/dashboard.html` (экран загрузки, панель источников, стили)
- Modify: `kojipatch/assets/js/ui.js` (подписка на store, пустое состояние)
- Modify: `kojipatch/build.py` (`store.js` в `SCRIPTS`)
- Modify: `tests/test_build.py` (разметка загрузки присутствует)

**Interfaces:**
- Consumes: `KP.viewmodel.buildPageData(snapshots)`
- Produces: `KP.store` — состояние загруженного:
  - `parseText(text, fileName) -> {ok: true, snapshots: [...]} |
    {ok: false, error: string}`
  - `add(snapshots, fileName) -> {added: number, rejected: Array<string>}`
  - `remove(index) -> void`
  - `move(index, delta) -> void` — переставляет и включает ручной порядок
  - `list() -> Array<{tag, generated, builds, file}>`
  - `snapshots() -> Array<snapshot>` — в текущем порядке
  - `warnings() -> Array<string>`
  - `onChange(fn) -> void` — подписка; зовётся после любого изменения
  - `reset() -> void` — очистка; нужна тестам, чтобы они не влияли друг на
    друга, в браузере не используется

- [ ] **Step 1: Тесты хранилища**

Create `tests/js/store.test.js`:

```js
'use strict';
var test = require('node:test');
var assert = require('node:assert');
var store = require('../../kojipatch/assets/js/store.js');

function snap(tag, generated) {
  return { schema: 1, tag: tag, generated: generated,
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: ['CVE', 'other'], builds: [] };
}

test('разбирает список снапшотов', function () {
  var out = store.parseText(JSON.stringify([snap('os-9.1', '2026-07-01T00:00:00+03:00')]), 'a.json');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.snapshots.length, 1);
});

test('разбирает одиночный снапшот-объект', function () {
  var out = store.parseText(JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00')), 'a.json');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.snapshots[0].tag, 'os-9.1');
});

test('не JSON — понятная ошибка, а не исключение', function () {
  var out = store.parseText('{ сломано', 'a.json');
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /a\.json/);
});

test('чужая версия схемы отклоняется', function () {
  var bad = snap('os-9.1', '2026-07-01T00:00:00+03:00');
  bad.schema = 99;
  var out = store.parseText(JSON.stringify(bad), 'a.json');
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /схем/);
});

test('объект без builds — не снапшот', function () {
  var out = store.parseText('{"schema": 1, "tag": "os-9.1"}', 'a.json');
  assert.strictEqual(out.ok, false);
});

test('снапшоты встают по времени сбора, а не по порядку загрузки', function () {
  store.reset();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1', 'os-9.2']);
});

test('ручная перестановка отменяет автосортировку', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.move(0, 1);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1']);
  store.add([snap('os-9.3', '2026-09-01T00:00:00+03:00')], 'c.json');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1', 'os-9.3'],
                         'после ручной перестановки новый снапшот встаёт в конец');
});

test('точный дубликат отклоняется, повтор тега из другого прогона — нет', function () {
  store.reset();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  var again = store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.rejected.length, 1);
  var later = store.add([snap('os-9.2', '2026-08-02T00:00:00+03:00')], 'c.json');
  assert.strictEqual(later.added, 1);
  assert.strictEqual(store.list().length, 2);
});

test('разные хабы — предупреждение, но не отказ', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  var out = store.add([other], 'b.json');
  assert.strictEqual(out.added, 1);
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /хаб/);
});

test('удаление по номеру', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.remove(0);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2']);
});

test('подписчика зовут после изменения', function () {
  store.reset();
  var calls = 0;
  store.onChange(function () { calls += 1; });
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  assert.strictEqual(calls, 1);
});
```

`store.reset()` — очистка между тестами; в браузере не используется, но
без неё тесты влияют друг на друга.

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/js/store.test.js`
Expected: FAIL — модуль не найден

- [ ] **Step 3: Реализация хранилища**

Create `kojipatch/assets/js/store.js`:

```js
/* Загруженные снапшоты: разбор, порядок, дубликаты, предупреждения.
   Хранилище ничего не рисует и не знает про DOM — ровно поэтому его
   поведение проверяется в node, а не глазами в браузере. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.store = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var items = [];        /* {snapshot, file} в порядке цепочки */
  var warns = [];
  var manual = false;    /* человек переставил руками — не пересортировывать */
  var listeners = [];

  function isSnapshot(value) { /* schema === 1, строковые tag и generated,
                                  массив builds */ }
  function stamp(value) { /* Date.parse, при NaN — сама строка */ }
  function compareItems(a, b) { /* по stamp(generated), при равенстве — по tag */ }
  function fire() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  function parseText(text, fileName) { /* → {ok:true, snapshots} | {ok:false, error} */ }
  function add(snapshots, fileName) { /* → {added, rejected} */ }
  function remove(index) { }
  function move(index, delta) { manual = true; }
  function list() { }
  function snapshots() { }
  function warnings() { return warns.slice(); }
  function onChange(fn) { listeners.push(fn); }
  function reset() { items = []; warns = []; manual = false; listeners = []; }

  return { parseText: parseText, add: add, remove: remove, move: move,
           list: list, snapshots: snapshots, warnings: warnings,
           onChange: onChange, reset: reset };
}));
```

Требования, которые тесты фиксируют, и решения, которые они не видят:

- `parseText` не бросает: любая беда возвращается как
  `{ok: false, error: '…'}` с именем файла внутри. Одна опечатка в имени не
  должна отменять загрузку пяти.
- Проверка снапшота: `schema === 1`, есть строковые `tag` и `generated`,
  есть массив `builds`. Всё остальное необязательно — модель это допускает.
- Сортировка по `generated`: `Date.parse`; если `NaN` (а такое бывает у
  снапшота, собранного странной сборкой) — сравнивать строки. Молча
  ставить такой снапшот первым нельзя.
- Дубликат = совпали и `tag`, и `generated`. Один тег из разных прогонов —
  законный случай.
- Ручной порядок: флаг `manual`, включается в `move` и больше не
  сбрасывается. Новый снапшот при `manual` дописывается в конец.
- Предупреждение о разных `koji_hub` копится в `warnings()`, загрузку не
  отменяет: сравнивать такие обычно бессмысленно, но решать это не
  дашборду.

- [ ] **Step 4: Проверить**

Run: `node --test tests/js/store.test.js`
Expected: PASS, 11 тестов

- [ ] **Step 5: Подключить store к сборке**

В `kojipatch/build.py` дописать `store.js` в `SCRIPTS` — перед `ui.js`,
потому что `ui.js` на него рассчитывает:

```python
SCRIPTS = ("vercmp.js", "rpms.js", "diff.js", "viewmodel.js", "store.js",
           "ui.js")
```

Run: `python3 -m unittest tests.test_build -v`
Expected: PASS — `test_every_script_is_inlined` теперь проверяет и store.js

- [ ] **Step 6: Разметка пустого экрана и панели источников**

В `kojipatch/assets/dashboard.html`, сразу после `<div class="meta"
id="meta"></div>`:

```html
  <div class="sources" id="sources" hidden>
    <div class="chain" id="chain"></div>
    <button type="button" class="toggle" id="add-more">добавить</button>
    <button type="button" class="toggle" id="edit-sources" aria-expanded="false">изменить</button>
  </div>
  <ul class="sourcelist" id="sourcelist" hidden></ul>
  <div class="warnings" id="warnings"></div>
  <section id="tab-empty">
    <div class="drop" id="drop">
      <p class="dropmain">Перетащите снапшоты сюда</p>
      <p class="dropsub">или <button type="button" class="linkish" id="pick">выберите файлы</button>.
        Это JSON, который делает <span class="mono">kojipatch collect</span>.</p>
      <ul class="problems" id="load-errors"></ul>
    </div>
  </section>
  <input type="file" id="file-input" accept=".json,application/json" multiple hidden>
```

Стили: добавить в `<style>` правила для `.sources`, `.chain`,
`.sourcelist`, `.drop`, `.dropmain`, `.dropsub`, `.linkish`, `.warnings`,
`.drop.over`. Держаться существующих переменных (`--line`, `--muted`,
`--card`, `--accent`) — тест `test_reuses_ref_html_css_variables` следит,
чтобы палитра не расползалась. Зона `.drop`: пунктирная рамка
`2px dashed var(--line)`, `border-radius: 10px`, `padding: 3rem 1.5rem`,
текст по центру; в состоянии `.over` — `border-color: var(--accent)`.

- [ ] **Step 7: Связать store и ui**

В `kojipatch/assets/js/ui.js`:

```js
  var emptySection = document.getElementById('tab-empty');
  var sourcesBox = document.getElementById('sources');
  var chainBox = document.getElementById('chain');
  var sourceList = document.getElementById('sourcelist');
  var loadErrors = document.getElementById('load-errors');
  var warningsBox = document.getElementById('warnings');
  var fileInput = document.getElementById('file-input');
  var dropZone = document.getElementById('drop');

  /* Пустой дашборд показывает только зону загрузки: вкладки без данных
     обещали бы содержимое, которого нет. */
  function syncEmpty() {
    var has = KP.store.list().length > 0;
    emptySection.hidden = has;
    sourcesBox.hidden = !has;
    document.querySelector('.tabs').hidden = !has;
    if (!has) {
      stateSection.hidden = true;
      diffSection.hidden = true;
    }
  }

  function renderSources() {
    var items = KP.store.list(), parts = [], i;
    for (i = 0; i < items.length; i++) parts.push(esc(items[i].tag));
    chainBox.innerHTML = parts.length
      ? '<span class="l">снапшоты:</span> ' + parts.join(' <span class="arrow">→</span> ')
      : '';
    var out = '';
    for (i = 0; i < items.length; i++) {
      out += '<li><span class="mono">' + esc(items[i].tag) + '</span>'
          + '<span class="sub">' + esc(items[i].generated) + ' · '
          + items[i].builds + ' ' + plural(items[i].builds, 'сборка', 'сборки', 'сборок')
          + ' · ' + esc(items[i].file) + '</span>'
          + '<button type="button" class="mini" data-move="' + i + ':-1"'
          + (i === 0 ? ' disabled' : '') + ' data-tip="Выше по цепочке">↑</button>'
          + '<button type="button" class="mini" data-move="' + i + ':1"'
          + (i === items.length - 1 ? ' disabled' : '') + ' data-tip="Ниже по цепочке">↓</button>'
          + '<button type="button" class="mini" data-drop-snap="' + i + '"'
          + ' data-tip="Убрать этот снапшот">✕</button></li>';
    }
    sourceList.innerHTML = out;
    var warns = KP.store.warnings(), wout = '';
    for (i = 0; i < warns.length; i++) wout += '<div class="warn">' + esc(warns[i]) + '</div>';
    warningsBox.innerHTML = wout;
  }

  KP.store.onChange(function () {
    applyData(KP.viewmodel.buildPageData(KP.store.snapshots()));
    renderSources();
    syncEmpty();
  });

  function loadFiles(files) {
    var errors = [], pending = files.length, i;
    if (!pending) return;
    function done() {
      pending -= 1;
      if (pending) return;
      var out = '', j;
      for (j = 0; j < errors.length; j++) out += '<li>' + esc(errors[j]) + '</li>';
      loadErrors.innerHTML = out;
    }
    for (i = 0; i < files.length; i++) {
      (function (file) {
        var reader = new FileReader();
        reader.onload = function () {
          var parsed = KP.store.parseText(String(reader.result), file.name);
          if (!parsed.ok) errors.push(parsed.error);
          else {
            var res = KP.store.add(parsed.snapshots, file.name);
            errors = errors.concat(res.rejected);
          }
          done();
        };
        /* Нечитаемый файл — не повод молчать: без этой ветки страница
           просто ничего не сделала бы в ответ на выбор. */
        reader.onerror = function () {
          errors.push(file.name + ': файл не читается');
          done();
        };
        reader.readAsText(file);
      }(files[i]));
    }
  }
```

События: клик по `#pick` и `#add-more` → `fileInput.click()`; `change` на
`fileInput` → `loadFiles(fileInput.files)` и затем `fileInput.value = ''`
(иначе повторный выбор того же файла не даст события); `dragover` на
`#drop` и на `document` → `preventDefault()` и класс `over`; `drop` →
`loadFiles(e.dataTransfer.files)`; клик по `#edit-sources` → переключение
`sourceList.hidden` и `aria-expanded`; делегированные `data-move` и
`data-drop-snap` → `KP.store.move` / `KP.store.remove`.

Ронять файл можно на всю страницу, а не только на зону: браузер по
умолчанию открывает бро́шенный файл вместо страницы, и `dragover` на
`document` с `preventDefault()` обязателен — иначе дашборд просто
заменится содержимым JSON.

В `applyData` выбранный снапшот и пара восстанавливаются по именам, а не
по номерам:

```js
    /* Держим выбор именами: после перестановки или удаления номер
       показал бы другой тег, ничем не выдав подмены. */
    var wantTag = SNAPS[st.tag] ? SNAPS[st.tag].tag : null;
    var wantPair = PAIRS[st.pair] ? pairKey(PAIRS[st.pair]) : null;
```

— снять до присваивания `DATA`, после присваивания найти те же значения в
новых списках, а если не нашлись — взять последний элемент.

`start()` больше не читает `window.KP_SNAPSHOTS` напрямую, а кладёт их в
store:

```js
  (function start() {
    var raw = (typeof window !== 'undefined' && window.KP_SNAPSHOTS) || [];
    if (raw.length) KP.store.add(raw, 'встроено в файл');
    syncEmpty();
    renderSources();
    syncStickyOffset();
  }());
```

- [ ] **Step 8: Тест разметки**

В `tests/test_build.py`:

```python
    def test_has_a_drop_zone(self):
        html = build_html()
        self.assertIn('id="drop"', html)
        self.assertIn("Перетащите снапшоты сюда", html)

    def test_has_a_file_picker(self):
        self.assertIn('type="file"', build_html())

    def test_has_a_sources_panel(self):
        html = build_html()
        self.assertIn('id="sources"', html)
        self.assertIn('id="sourcelist"', html)
```

- [ ] **Step 9: Прогнать всё**

Run: `python3 -m unittest discover -s tests -t . -q && node --test tests/js/`
Expected: OK Python; PASS 115 тестов JS

- [ ] **Step 10: Проверить руками**

```bash
python3 -m kojipatch dashboard -o /tmp/dash.html
```

Открыть `/tmp/dash.html` и проверить:
1. Пустая страница показывает зону загрузки, вкладок нет.
2. Перетащить `tests/fixtures/rich-old.json` — появляется «Состояние»,
   вкладки «Изменения» нет.
3. Добавить `tests/fixtures/rich-new.json` — появляется «Изменения», в
   цепочке `os-9.1 → os-9.2`.
4. «Изменить» → ↑ у второго снапшота меняет направление на
   `os-9.2 → os-9.1`, дифф пересчитывается.
5. ✕ убирает снапшот, вкладка «Изменения» исчезает.
6. Бросить любой не-JSON — строка ошибки под зоной, уже загруженное на
   месте.
7. Бросить тот же файл дважды — отказ с пояснением, цепочка не удвоилась.
8. Консоль браузера пуста.

- [ ] **Step 11: Коммит**

```bash
git add kojipatch/assets/js/store.js kojipatch/assets/js/ui.js \
        kojipatch/assets/dashboard.html tests/js/store.test.js tests/test_build.py
git commit -m "Дашборд подгружает снапшоты сам"
```

---

### Task 9: Убрать питоновский слой представления

**Files:**
- Delete: `kojipatch/render.py`, `kojipatch/diff.py`, `kojipatch/rpms.py`,
  `kojipatch/rpmvercmp.py`
- Delete: `tests/test_render.py`, `tests/test_diff.py`, `tests/test_rpms.py`,
  `tests/test_rpmvercmp.py`, `tests/test_parity.py`
- Modify: `kojipatch/cli.py` (убрать `render` и `run`)
- Modify: `kojipatch/build.py` (убрать встраивание снапшотов)
- Modify: `kojipatch/assets/js/ui.js` (убрать чтение `window.KP_SNAPSHOTS`)
- Modify: `tests/test_build.py`, `tests/test_cli.py`

**Interfaces:**
- Consumes: всё из Task 8
- Produces: `build_html(template_path=None) -> str` — без параметра
  `snapshots`

- [ ] **Step 1: Убедиться, что удаляемое больше никем не зовётся**

Run: `grep -rn "render\|rpmvercmp\|from .diff\|from .rpms" kojipatch/ tests/ --include=*.py | grep -v "kojipatch/render.py\|kojipatch/diff.py\|kojipatch/rpms.py\|kojipatch/rpmvercmp.py\|tests/test_render.py\|tests/test_diff.py\|tests/test_rpms.py\|tests/test_rpmvercmp.py\|tests/test_parity.py"`
Expected: только упоминания подкоманды `render` в `cli.py` и `test_cli.py`

Если всплыло что-то ещё — разобраться до удаления, а не после.

- [ ] **Step 2: Тест на то, что команд больше нет**

В `tests/test_cli.py`:

```python
    def test_render_command_is_gone(self):
        """Дашборд больше не печёт данные внутрь себя: снапшоты в него
        подгружают. Молчаливо принять старую команду значило бы написать
        файл, в котором ничего нет."""
        with self.assertRaises(SystemExit):
            main(["render", "snapshot.json"])

    def test_dashboard_command_writes_the_page(self):
        path = os.path.join(self.tmp, "dash.html")
        self.assertEqual(main(["dashboard", "-o", path]), 0)
        with open(path, encoding="utf-8") as handle:
            self.assertIn("Перетащите снапшоты сюда", handle.read())
```

Второй тест мог быть добавлен ещё в Task 7 — тогда проверить, что он
по-прежнему проходит, и не дублировать. Хелперы `self.tmp` брать из
существующего класса тестов CLI.

- [ ] **Step 3: Убедиться, что первый тест падает**

Run: `python3 -m unittest tests.test_cli -v`
Expected: FAIL — `render` пока принимается

- [ ] **Step 4: Вырезать команды**

В `kojipatch/cli.py` удалить парсеры `render` и `run`, ветку `render` в
`main()`, функцию `_render`, ветку `else` с `--save-snapshots`. Остаются
`collect` и `dashboard`. Проверить, что `_collect` и `--max-problems`
по-прежнему работают: `--max-problems` теперь имеет смысл только для
`collect`.

`_load_config` упрощается:

```python
    return load_config(args.config, overrides,
                       require_hub=args.command != "dashboard")
```

- [ ] **Step 5: Убрать встраивание данных**

В `kojipatch/build.py` удалить параметр `snapshots`, функцию `_encode`,
импорт `json` и `snapshot_to_dict`. Сигнатура:
`def build_html(template_path: Optional[str] = None) -> str`.

В `kojipatch/assets/js/ui.js` в `start()` убрать чтение
`window.KP_SNAPSHOTS`:

```js
  (function start() {
    syncEmpty();
    renderSources();
    syncStickyOffset();
  }());
```

В `tests/test_build.py` удалить тесты, проверявшие прелюдию:
`test_snapshots_are_embedded_as_a_prelude`,
`test_script_close_tag_is_escaped`, `test_embedded_json_parses`,
`test_line_separators_are_escaped`. Тест
`test_empty_dashboard_carries_no_data` заменить на проверку, что
`KP_SNAPSHOTS` в файле не встречается вовсе.

- [ ] **Step 6: Удалить файлы**

```bash
git rm kojipatch/render.py kojipatch/diff.py kojipatch/rpms.py \
       kojipatch/rpmvercmp.py tests/test_render.py tests/test_diff.py \
       tests/test_rpms.py tests/test_rpmvercmp.py tests/test_parity.py
```

`tests/js/fixtures/page-data.golden.json` **не удалять**: эталон остаётся
регрессионной страховкой для `viewmodel.js`. С удалением `test_parity.py`
он перестаёт обновляться автоматически — это нормально, менять его теперь
можно только осознанно, руками.

- [ ] **Step 7: Прогнать всё**

Run: `python3 -m unittest discover -s tests -t . -q && node --test tests/js/`
Expected: OK Python (около 240 тестов — 121 переехал в JS); PASS 115 тестов JS

- [ ] **Step 8: Проверить, что дашборд собирается и работает**

```bash
python3 -m kojipatch dashboard -o /tmp/dash.html
```

Открыть, подгрузить обе богатые фикстуры, убедиться, что обе вкладки на
месте и консоль пуста.

- [ ] **Step 9: Коммит**

```bash
git add -A
git commit -m "Убрать питоновский слой представления"
```

---

### Task 10: Документация

**Files:**
- Modify: `README.md`
- Modify: `kojipatch.example.yaml`

- [ ] **Step 1: Переписать разделы README**

Найти и переписать:

1. Описание команд: убрать `render` и `run`, описать `dashboard`. Новый
   рабочий цикл: `collect` кладёт снапшоты, `dashboard` кладёт страницу,
   страница подгружает снапшоты.
2. Раздел про устройство проекта: `render.py`, `diff.py`, `rpms.py`,
   `rpmvercmp.py` больше нет; появились `build.py` и `assets/js/`.
   Объяснить, почему вычисления переехали в браузер: дифф между двумя
   произвольными подгруженными файлами взяться готовым не может.
3. Раздел про тесты: два набора, две команды —
   `python3 -m unittest discover -s tests -v` и `node --test tests/js/`.
   Сказать про эталон `page-data.golden.json`: что он такое и когда его
   правят.
4. Формат снапшота: добавить `patch_classes` и оговорку, что поле
   необязательное и снапшоты прежних версий читаются.
5. Раздел про то, как пользоваться дашбордом: загрузка перетаскиванием и
   выбором файлов, порядок цепочки и ручная перестановка, что данные живут
   только до перезагрузки страницы.

Строки не длиннее 79 символов, как во всём файле. После правки проверить:

Run: `awk 'length > 79 {print FILENAME": "FNR": "length}' README.md`
Expected: пусто

- [ ] **Step 2: Поправить пример конфига**

В `kojipatch.example.yaml` — если в комментариях упоминается `render` или
`run`, заменить на актуальные команды. Список `patch_classes` в примере
не меняется.

- [ ] **Step 3: Проверить, что примеры из README работают**

Выполнить каждую команду из README, которую можно выполнить без koji, и
убедиться, что она отрабатывает.

Run: `python3 -m kojipatch dashboard -o /tmp/readme-check.html && echo ОК`
Expected: `ОК`

- [ ] **Step 4: Коммит**

```bash
git add README.md kojipatch.example.yaml
git commit -m "README: снапшоты — данные, дашборд — представление"
```

---

## Самопроверка плана

**Покрытие спеки.** Контракт данных — Task 1. Перенос вычислений — Tasks
3–6. Файловая структура — Tasks 6–8. Командная строка — Tasks 7 и 9.
Экран загрузки — Task 8. Поток данных — Task 8. Ошибки — Task 8, шаги 1 и
3. Адресная строка — Task 8, шаг 6. Тесты и паритетный гейт — Tasks 2 и 6.
Порядок миграции — порядок задач.

**Расхождение с Python, отмеченное намеренно:** `koji_web` в строках
диффа берётся у снапшота показанного билда, а не общий по первому
(Task 6). На эталоне не проявляется, в коде отмечено комментарием.

**Что остаётся питоновским:** `collect`, `classify`, `config`, `model`,
клиенты koji и GitLab, `logs`, `sourceurl`, `build`. Их тесты не трогаются.
