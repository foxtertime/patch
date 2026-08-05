'use strict';
/* Состояние страницы: какой снапшот открыт, какой диапазон сравнивается,
   какие фильтры живы. До выделения page.js всё это проверялось только через
   страницу целиком на заглушке DOM; здесь страница не нужна вовсе, и каждый
   тест поднимает своё состояние с нуля. */
var test = require('node:test');
var assert = require('node:assert');
var viewmodel = require('../../dashboard/assets/js/viewmodel.js');
var diffmod = require('../../dashboard/assets/js/diff.js');
var storemod = require('../../dashboard/assets/js/store.js');
var labels = require('../../dashboard/assets/js/labels.js');
var text = require('../../dashboard/assets/js/text.js');
var pagemod = require('../../dashboard/assets/js/page.js');

function patch(name, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls, cves: [],
           web_url: null };
}

function build(name, over) {
  over = over || {};
  return { nvr: name + '-1.0-1.el9', name: name, version: '1.0',
           release: '1.el9', epoch: null, build_id: 1, task_id: 2,
           tag_name: over.tag_name || null, tags: [], owner: 'builder',
           completed: '2026-05-14 10:00:00', source: null,
           patch_dir_present: true, patches: over.patches || [],
           rpms: ['a.x86_64'], problems: over.problems || [] };
}

function snap(tag, generated, over) {
  over = over || {};
  return { schema: 1, tag: tag, generated: generated,
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: over.classes || ['CVE', 'other'],
           builds: over.builds || [build('nginx')] };
}

var JUL = '2026-07-01T00:00:00+03:00';
var AUG = '2026-08-01T00:00:00+03:00';
var SEP = '2026-09-01T00:00:00+03:00';

/* Свежая страница: свой стор и своё состояние, ничего не делят с соседним
   тестом. Переходы считает page по требованию, и стор ему для этого нужен
   настоящий — он хранит исходные снапшоты, а не посчитанные строки. */
function make(snapshots) {
  storemod.reset();
  if (snapshots) storemod.add(snapshots, 'проба.json');
  var p = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                           store: storemod, labels: labels, text: text });
  if (snapshots) p.applyData(viewmodel.buildPageData(storemod.snapshots()));
  return p;
}

test('умолчание — последний снапшот цепочки', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  assert.strictEqual(p.st.tag, 2);
  assert.strictEqual(p.curSnap().tag, 'os-9.3');
});

test('умолчание перехода — вся цепочка', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  assert.deepStrictEqual(p.currentEnds(), [0, 2]);
});

test('сравнивать нечего — концов нет вовсе', function () {
  assert.strictEqual(make([snap('os-9.1', JUL)]).currentEnds(), null);
});

test('выбранный человеком снапшот переживает приход соседа', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  p.selectSnapshot(0);
  storemod.add([snap('os-9.3', SEP)], 'ещё.json');
  p.applyData(viewmodel.buildPageData(storemod.snapshots()));
  assert.strictEqual(p.curSnap().tag, 'os-9.1');
});

test('невыбранный снапшот уступает умолчанию при приходе соседа', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  storemod.add([snap('os-9.3', SEP)], 'ещё.json');
  p.applyData(viewmodel.buildPageData(storemod.snapshots()));
  assert.strictEqual(p.curSnap().tag, 'os-9.3');
});

test('выбранный диапазон переживает приход соседа', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  p.setPairEnds(0, 1);
  storemod.add([snap('os-9.4', '2026-10-01T00:00:00+03:00')], 'ещё.json');
  p.applyData(viewmodel.buildPageData(storemod.snapshots()));
  assert.deepStrictEqual(p.currentEnds(), [0, 1]);
});

test('концы принимаются в любом порядке, направление задаёт цепочка',
  function () {
    var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG),
                  snap('os-9.3', SEP)]);
    p.setPairEnds(2, 0);
    assert.deepStrictEqual(p.currentEnds(), [0, 2]);
  });

test('имя снапшота — тег и время сбора', function () {
  var p = make([snap('os-9.1', JUL)]);
  assert.strictEqual(p.snapKey(p.curSnap()), 'os-9.1@' + JUL);
});

test('два прогона одного тега различаются именем', function () {
  var p = make([snap('os-9.2', JUL), snap('os-9.2', SEP)]);
  assert.notStrictEqual(p.snapKey(p.snapshots()[0]),
                        p.snapKey(p.snapshots()[1]));
});

test('короткое имя из ссылки берёт последний прогон тега', function () {
  var p = make([snap('os-9.2', JUL), snap('os-9.3', AUG), snap('os-9.2', SEP)]);
  assert.strictEqual(p.snapNamed(0, 'os-9.2'), true);
  assert.strictEqual(p.snapNamed(2, 'os-9.2'), true);
  assert.strictEqual(p.snapNamed(1, 'os-9.2'), false);
});

test('диапазон по тегам ищется парой, а не концами по отдельности',
  function () {
    /* На цепочке 9.2, 9.3, 9.2 самый свежий os-9.2 стоит правее os-9.3:
       независимый поиск концов открыл бы обратное сравнение. */
    var p = make([snap('os-9.2', JUL), snap('os-9.3', AUG),
                  snap('os-9.2', SEP)]);
    assert.deepStrictEqual(p.endsFromName('os-9.2..os-9.3'), [0, 1]);
  });

test('ссылка задом наперёд разворачивается по цепочке', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  assert.deepStrictEqual(p.endsFromName('os-9.2..os-9.1'), [0, 1]);
});

test('имя без разделителя — не диапазон', function () {
  assert.strictEqual(make([snap('os-9.1', JUL)]).endsFromName('os-9.1'), null);
});

test('«версия та же» снимает «что-то изменилось», а не складывается с ним',
  function () {
    var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
    p.st.tab = 'diff';
    assert.deepStrictEqual(p.activeFilters(), { changed: 1 });
    p.toggleFilter('unchanged');
    assert.deepStrictEqual(p.activeFilters(), { unchanged: 1 });
  });

test('повторный клик по фильтру снимает его', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.toggleFilter('has-patch');
  p.toggleFilter('has-patch');
  assert.deepStrictEqual(p.activeFilters(), {});
});

test('«все» снимает разом все фильтры вкладки', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.toggleFilter('has-patch');
  p.toggleFilter('problem');
  p.toggleFilter('all');
  assert.deepStrictEqual(p.activeFilters(), {});
});

test('фильтр, которому не осталось строк, признаётся мёртвым', function () {
  var p = make([snap('os-9.1', JUL)]);
  assert.strictEqual(p.knownFilter('чужой-ключ', 'state'), false);
  assert.strictEqual(p.knownFilter('no-patch', 'state'), true);
});

test('класс патчей из данных фильтр не роняет', function () {
  var p = make([snap('os-9.1', JUL, { classes: ['CVE'] })]);
  assert.strictEqual(p.knownFilter('cve', 'state'), true);
});

test('мёртвые фильтры уходят с обеих вкладок сразу', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.st.filters.state = { 'чужой': 1, 'no-patch': 1 };
  p.st.filters.diff = { 'тоже-чужой': 1 };
  p.dropDeadFilters();
  assert.deepStrictEqual(p.st.filters.state, { 'no-patch': 1 });
  assert.deepStrictEqual(p.st.filters.diff, {});
});

test('поиск по видимому полю не разворачивает строку', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.st.q = 'nginx';
  var items = p.visibleRows();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].open, false);
});

test('совпадение только в деталях разворачивает строку', function () {
  var p = make([snap('os-9.1', JUL,
    { builds: [build('nginx', { patches: [patch('cve.patch', 'CVE')] })] })]);
  p.st.q = 'cve.patch';
  var items = p.visibleRows();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].open, true);
});

test('под запрос не подошло ничего — строк нет, но всего их столько же',
  function () {
    var p = make([snap('os-9.1', JUL)]);
    p.st.q = 'ничего-такого';
    assert.strictEqual(p.visibleRows().length, 0);
    assert.strictEqual(p.totalRows(), 1);
  });

test('ключ раскрытия несёт полное имя снапшота', function () {
  var p = make([snap('os-9.1', JUL)]);
  assert.strictEqual(p.rowKey({ name: 'nginx' }),
                     'state:os-9.1@' + JUL + ':nginx');
});

test('раскрытость по умолчанию решает поиск, явный выбор — сильнее',
  function () {
    var p = make([snap('os-9.1', JUL)]);
    assert.strictEqual(p.openOf('k', true), true);
    p.setOpen('k', false);
    assert.strictEqual(p.openOf('k', true), false);
  });

test('сортировка по той же колонке переворачивает порядок', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.sortBy('name');
  assert.deepStrictEqual(p.st.sort.state, { key: 'name', asc: false });
  p.sortBy('name');
  assert.deepStrictEqual(p.st.sort.state, { key: 'name', asc: true });
});

test('сортировка по другой колонке начинается по возрастанию', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.sortBy('name');
  p.sortBy('patches');
  assert.deepStrictEqual(p.st.sort.state, { key: 'patches', asc: true });
});

test('отметка узла живёт в состоянии и снимается', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  assert.strictEqual(p.anchor(), null);
  p.setAnchor(1);
  assert.strictEqual(p.anchor(), 1);
  p.setAnchor(null);
  assert.strictEqual(p.anchor(), null);
});

/* Разобранный адрес встречается с цепочкой ровно здесь: hash.js имён не
   разрешает, а page — не разбирает строк. */
function parsed(over) {
  var out = { tab: null, tag: null, pair: null, filters: null,
              q: null, sort: null };
  for (var k in over) { if (over.hasOwnProperty(k)) out[k] = over[k]; }
  return out;
}

test('ссылка на снапшот — такой же выбор, как клик по узлу', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  p.restore(parsed({ tag: 'os-9.1' }));
  assert.strictEqual(p.curSnap().tag, 'os-9.1');
  assert.strictEqual(p.picked.tag, true);
});

test('короткая форма tag= у двойников берёт последний прогон', function () {
  var p = make([snap('os-9.2', JUL), snap('os-9.3', AUG), snap('os-9.2', SEP)]);
  p.restore(parsed({ tag: 'os-9.2' }));
  assert.strictEqual(p.st.tag, 2);
});

test('неизвестное имя в ссылке оставляет умолчание', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  p.restore(parsed({ tag: 'os-9.9' }));
  assert.strictEqual(p.curSnap().tag, 'os-9.2');
});

test('ссылка на диапазон восстанавливает оба конца', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  p.restore(parsed({ pair: 'os-9.1..os-9.2' }));
  assert.deepStrictEqual(p.currentEnds(), [0, 1]);
});

test('ссылка на «Изменения» без второго снапшота уводит на состояние',
  function () {
    var p = make([snap('os-9.1', JUL)]);
    p.restore(parsed({ tab: 'diff', filters: ['changed'] }));
    assert.strictEqual(p.st.tab, 'state');
    /* Фильтры из такой ссылки — диффовые: на вкладке состояния они дали бы
       пустую таблицу без единого намёка почему. */
    assert.deepStrictEqual(p.activeFilters(), {});
  });

test('фильтры из ссылки заменяют прежние, а не добавляются к ним', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.toggleFilter('problem');
  p.restore(parsed({ filters: ['no-patch'] }));
  assert.deepStrictEqual(p.activeFilters(), { 'no-patch': 1 });
});

test('чего в ссылке не было, то и не трогается', function () {
  var p = make([snap('os-9.1', JUL)]);
  p.toggleFilter('problem');
  p.st.q = 'nginx';
  p.restore(parsed({ tab: 'state' }));
  assert.deepStrictEqual(p.activeFilters(), { problem: 1 });
  assert.strictEqual(p.st.q, 'nginx');
});

test('части для ссылки называют снапшот полным именем', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  var parts = p.hashParts();
  assert.strictEqual(parts.tab, 'state');
  assert.strictEqual(parts.tag, 'os-9.2@' + AUG);
  assert.strictEqual(parts.pair, 'os-9.1@' + JUL + '..os-9.2@' + AUG);
});

test('на единственном снапшоте диапазона в ссылке нет', function () {
  assert.strictEqual(make([snap('os-9.1', JUL)]).hashParts().pair, null);
});

/* Сводность диапазона: правило «вся цепочка, и только когда снапшотов
   больше двух». На двух снапшотах единственный переход и есть вся цепочка,
   и звать его итогом значит сообщать очевидное.

   На рельсе это больше не подписано, но в данных страницы поле остаётся:
   pairFor кладёт его в блок перехода, а сам блок сверяется с золотой
   фикстурой. Так что правило проверяется здесь — там, где оно и живёт. */
test('диапазон во всю цепочку сводный, а соседний — нет', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  assert.strictEqual(p.pairFor([0, 2]).summary, true);
  assert.strictEqual(p.pairFor([0, 1]).summary, false);
});

test('на двух снапшотах сводного диапазона нет вовсе', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  assert.strictEqual(p.pairFor([0, 1]).summary, false);
});

/* Два прогона одного тега в кэш предпосчитанных пар не попадают: по имени
   тега такую пару не опознать. Значит, переход считается на месте, и
   сводность решает уже pairFor — то самое правило, которое на разных тегах
   сторожит diff.js. */
test('сводность считается на месте и когда тег в цепочке двоится',
  function () {
    var p = make([snap('os-9.2', JUL), snap('os-9.3', AUG),
                  snap('os-9.2', SEP)]);
    assert.strictEqual(p.pairFor([0, 2]).summary, true);
    assert.strictEqual(p.pairFor([1, 2]).summary, false);
  });

/* Снапшот с тем же именем — тот же файл, но набор вокруг него другой:
   диапазон 9.1→9.3 был всей цепочкой, а с приходом четвёртого файла быть
   ею перестал. Кэш, переживший смену состава, отдал бы прежний блок — со
   сводностью, которой у этого диапазона уже нет. */
test('смена состава снапшотов заводит кэш переходов заново', function () {
  var p = make([snap('os-9.1', JUL), snap('os-9.2', AUG), snap('os-9.3', SEP)]);
  assert.strictEqual(p.pairFor([0, 2]).summary, true,
                     'диапазон во всю цепочку не сводный, сценарий '
                     + 'проверяет не то');
  storemod.add([snap('os-9.4', '2026-10-01T00:00:00+03:00')], 'd.json');
  p.applyData(viewmodel.buildPageData(storemod.snapshots()));
  assert.strictEqual(p.pairFor([0, 2]).summary, false);
});

test('две страницы не делят состояния', function () {
  var a = make([snap('os-9.1', JUL), snap('os-9.2', AUG)]);
  var b = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                           store: storemod, labels: labels, text: text });
  b.applyData(viewmodel.buildPageData(storemod.snapshots()));
  a.selectSnapshot(0);
  assert.strictEqual(a.st.tag, 0);
  assert.strictEqual(b.st.tag, 1);
});
