'use strict';
/* Страница целиком: ui.js на заглушке DOM из настоящего шаблона.
   Тесты здесь не про вид, а про связывание — что скрипт находит свои узлы,
   что загруженный снапшот доезжает до таблицы и что выгруженный уходит из
   неё без следа. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var store = require('../../dashboard/assets/js/store.js');
/* Модуль диффа тесты подменяют, чтобы считать расчёты переходов по
   требованию. Зачем это нужно и почему считается именно здесь — у
   countDiffs, рядом с тестами кэша. */
var diffmod = require('../../dashboard/assets/js/diff.js');
var realDiffSnapshots = diffmod.diffSnapshots;

var UI = require.resolve('../../dashboard/assets/js/ui.js');

function patch(name, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls, cves: [],
           web_url: null };
}

function has(over, key) {
  return Object.prototype.hasOwnProperty.call(over, key);
}

/* Текст всплывающих окошек. Читаем поддерево, а не innerHTML: окошки
   собраны узлами, и у заглушки innerHTML для них пустой. */
function deepText(node) {
  var out = node.textContent || '', i;
  for (i = 0; i < node.children.length; i++) {
    out += ' ' + deepText(node.children[i]);
  }
  return out;
}

function noteText(dom) {
  var out = '', list = dom.id('toasts').querySelectorAll('.toast'), i;
  for (i = 0; i < list.length; i++) out += ' ' + deepText(list[i]);
  return out.trim();
}

function build(name, over) {
  over = over || {};
  var version = has(over, 'version') ? over.version : '1.0';
  return { nvr: name + '-' + version + '-1.el9', name: name, version: version,
           release: has(over, 'release') ? over.release : '1.el9',
           epoch: null, build_id: 1, task_id: 2, tag_name: null, tags: [],
           owner: 'builder', completed: '2026-05-14 10:00:00',
           source: has(over, 'source') ? over.source : null,
           patch_dir_present: true, patches: over.patches || [],
           rpms: has(over, 'rpms') ? over.rpms : ['a.x86_64'], problems: [] };
}

function snap(tag, generated, over) {
  over = over || {};
  return { schema: 1, tag: tag, generated: generated,
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: over.classes || ['CVE', 'other'],
           builds: over.builds || [build('nginx')] };
}

/* Свежая страница и свежий ui.js: обработчики он вешает при загрузке, и на
   прошлом дереве они держали бы уже несуществующие узлы. */
function load(options) {
  var dom = domstub.install(options);
  store.reset();
  delete require.cache[UI];
  require(UI);
  return dom;
}

/* Кнопки рельса скрипт рисует через innerHTML, а заглушка разметку из строк
   не разбирает. Ставим такую же кнопку настоящим узлом: проверяется
   делегированный обработчик, а не то, как браузер её отрисует. */
function pressOnRail(dom, name, value) {
  var node = dom.document.createElement('button');
  node.setAttribute(name, value);
  dom.id('chain').appendChild(node);
  dom.fire(node, 'click', {});
}

/* Поддельный перенос: от настоящего нужны только types и setData. Файлов в
   нём нет — этим он и отличается от брошенного на страницу файла. */
function transfer() {
  var types = [];
  return { types: types, files: [],
           setData: function (kind) { types.push(kind); },
           effectAllowed: null };
}

/* Живого перетаскивания заглушка не даёт: события стреляем сами. Чипы тоже
   ставим настоящими узлами — по ним обработчик ищет номер и прямоугольник.
   Заглушка всем отдаёт один прямоугольник 0..100, поэтому «слева» — это
   курсор в 10, «справа» — в 90. */
function chipNode(dom, at) {
  var found = dom.id('chain').querySelectorAll('[data-node]'), i;
  for (i = 0; i < found.length; i++) {
    if (found[i].getAttribute('data-node') === String(at)) return found[i];
  }
  var node = dom.document.createElement('button');
  node.setAttribute('class', 'pick');
  node.setAttribute('data-node', String(at));
  dom.id('chain').appendChild(node);
  return node;
}

function dragNode(dom, from, to, side) {
  var data = transfer();
  dom.fire(chipNode(dom, from), 'dragstart', { dataTransfer: data });
  dom.fire(chipNode(dom, to), 'dragover',
           { dataTransfer: data, clientX: side === 'after' ? 90 : 10 });
  dom.fire(chipNode(dom, to), 'drop', { dataTransfer: data });
}

test('пустая страница показывает зону загрузки и прячет вкладки', function () {
  var dom = load();
  assert.strictEqual(dom.id('tab-empty').hidden, false);
  assert.strictEqual(dom.document.querySelector('.tabs').hidden, true);
  assert.strictEqual(dom.id('sources').hidden, true);
  assert.strictEqual(dom.id('tab-state').hidden, true);
  assert.strictEqual(dom.id('tab-diff').hidden, true);
});

test('каждый запрос скрипта находит свой узел', function () {
  /* Расхождение разметки и скрипта ничего не ломает в питоновских тестах,
     а страница просто перестаёт рисоваться. Загрузка ui.js на заглушке уже
     проверила getElementById; здесь — запросы селекторами. */
  var dom = load();
  var heads = dom.document.querySelectorAll('th[data-sort]'), i;
  assert.ok(dom.document.querySelector('.tabs'));
  assert.strictEqual(dom.document.querySelectorAll('.tab').length, 2);
  assert.strictEqual(heads.length, 13);
  for (i = 0; i < heads.length; i++) {
    assert.ok(heads[i].querySelector('.arrow'),
              'у колонки ' + heads[i].getAttribute('data-sort') + ' нет стрелки');
  }
  assert.ok(dom.id('tab-state').querySelector('.tablewrap'));
  assert.ok(dom.id('tab-diff').querySelector('.tablewrap'));
});

test('один снапшот — сравнивать нечего', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var tabs = dom.document.querySelectorAll('.tab'), i, diffTab = null;
  for (i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === 'diff') diffTab = tabs[i];
  }
  assert.strictEqual(diffTab.hidden, true);
  assert.ok(dom.id('chain').innerHTML.indexOf('os-9.1') !== -1);
});

test('второй снапшот включает «Изменения» и строит цепочку', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  var tabs = dom.document.querySelectorAll('.tab'), i, diffTab = null;
  for (i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === 'diff') diffTab = tabs[i];
  }
  assert.strictEqual(diffTab.hidden, false);
  var chain = dom.id('chain').innerHTML;
  assert.ok(chain.indexOf('os-9.1') < chain.indexOf('os-9.2'), chain);
});

test('перетаскивание узла разворачивает сравнение', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  dragNode(dom, 1, 0, 'before');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1']);
  var chain = dom.id('chain').innerHTML;
  assert.ok(chain.indexOf('os-9.2') < chain.indexOf('os-9.1'), chain);
  /* Направление сравнения задаёт порядок цепочки: «было» — тот, кто левее. */
  assert.match(dom.location.hash, /pair=os-9\.2%40[^.]*\.\.os-9\.1/,
               dom.location.hash);
});

/* Сторону вставки задаёт курсор: у левой половины узла — перед ним, у
   правой — за ним. Без этого узел можно было бы уронить только в одну
   сторону, и последним в цепочке никого было бы не сделать. */
function railTags() {
  return store.list().map(function (i) { return i.tag; });
}

test('узел встаёт с той стороны, с какой его поднесли', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-06-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-07-01T00:00:00+03:00')], 'b.json');
  store.add([snap('os-9.3', '2026-08-01T00:00:00+03:00')], 'c.json');
  dragNode(dom, 0, 2, 'after');
  assert.deepStrictEqual(railTags(), ['os-9.2', 'os-9.3', 'os-9.1']);
  dragNode(dom, 2, 1, 'before');
  assert.deepStrictEqual(railTags(), ['os-9.2', 'os-9.1', 'os-9.3']);
});

test('узел, брошенный на своё же место, порядок не меняет', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  dragNode(dom, 1, 1, 'before');
  assert.deepStrictEqual(railTags(), ['os-9.1', 'os-9.2']);
  dragNode(dom, 0, 0, 'after');
  assert.deepStrictEqual(railTags(), ['os-9.1', 'os-9.2']);
});

/* Узел, который тащат по рельсу, — не файл, который несут на страницу.
   Приёмник файлов зажигал бы под ним зону загрузки и обещал то, чего не
   будет: в переносе узла файлов нет. */
test('перетаскивание узла не зажигает зону загрузки', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  dom.fire(chipNode(dom, 0), 'dragstart', { dataTransfer: transfer() });
  dom.fire(chipNode(dom, 0), 'dragover',
           { dataTransfer: transfer(), clientX: 10 });
  assert.strictEqual(dom.id('drop').className, 'drop', dom.id('drop').className);
});

test('файл, поднесённый к странице, зону загрузки зажигает', function () {
  var dom = load();
  var data = transfer();
  data.types.push('Files');
  dom.fire(dom.id('drop'), 'dragover', { dataTransfer: data });
  assert.strictEqual(dom.id('drop').className, 'drop over');
});

test('✕ убирает снапшот, и «Изменения» снова нечего показывать', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  pressOnRail(dom, 'data-drop-snap', '1');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1']);
  var tabs = dom.document.querySelectorAll('.tab'), i, diffTab = null;
  for (i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === 'diff') diffTab = tabs[i];
  }
  assert.strictEqual(diffTab.hidden, true);
  assert.strictEqual(dom.id('tab-diff').hidden, true);
});

test('последний снапшот убрали — страница снова ждёт загрузки', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  pressOnRail(dom, 'data-drop-snap', '0');
  assert.strictEqual(dom.id('tab-empty').hidden, false);
  assert.strictEqual(dom.id('tab-state').hidden, true);
  assert.strictEqual(dom.document.querySelector('.tabs').hidden, true);
  /* Рельс от ушедшего снапшота — узел над зоной загрузки: так выглядит
     сломанная страница, а не пустая. */
  assert.strictEqual(dom.id('chain').innerHTML, '');
  assert.strictEqual(dom.id('sources').hidden, true);
});

/* Какой снапшот открыт, страница говорит нажатым узлом рельса — тем же
   aria-pressed, которым раньше говорил селектор тегов. Подпись узла стоит
   в разметке следом за атрибутом, оттуда и читаем тег. */
function openTag(html) {
  var m = /aria-pressed="true"[\s\S]*?class="nm">([^ <]+)/.exec(html);
  return m ? m[1] : null;
}

function chain(dom) { return dom.id('chain').innerHTML; }

test('выбранный тег держится именем, а не номером', async function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  clickNode(dom, 1);
  assert.strictEqual(openTag(chain(dom)), 'os-9.2', chain(dom));
  await dom.tick();
  dom.location.hash = '';        /* выбор должен держаться и без адреса */
  store.move(1, -1);             /* теперь последний в списке — os-9.1 */
  assert.strictEqual(openTag(chain(dom)), 'os-9.2', chain(dom));
});

/* Два прогона одного тега — самый частый способ сравнения: «тот же тег
   месяц назад против сегодняшнего». Различать их дашборд обязан не глазами
   человека, а сам: по тегу и времени сбора. */
var JUL = '2026-07-01T00:00:00+03:00';
var AUG = '2026-08-01T00:00:00+03:00';
var SEP = '2026-09-01T00:00:00+03:00';

/* Узлы рельса скрипт рисует через innerHTML, а заглушка разметку из строк
   не разбирает. Ставим такой же узел настоящим узлом: проверяется
   делегированный обработчик, а не то, как браузер его отрисует. */
function clickNode(dom, at) {
  var node = dom.document.createElement('button');
  node.setAttribute('data-node', String(at));
  dom.id('chain').appendChild(node);
  dom.fire(node, 'click', {});
}

test('выбор снапшота держится тегом и временем сбора', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-06-01T00:00:00+03:00',
                  { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', JUL, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('httpd')] })], 'c.json');
  clickNode(dom, 1);                                /* os-9.2 от 1 июля */
  assert.ok(dom.id('state-rows').innerHTML.indexOf('apache') !== -1,
            dom.id('state-rows').innerHTML);
  store.remove(0);                                  /* цепочка сдвинулась */
  assert.ok(dom.id('state-rows').innerHTML.indexOf('apache') !== -1,
            'выбор молча переехал на другой прогон того же тега: '
            + dom.id('state-rows').innerHTML);
});

test('в адресе у снапшота стоит и тег, и время сбора', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('httpd')] })], 'c.json');
  clickNode(dom, 0);
  assert.ok(dom.location.hash.indexOf(encodeURIComponent('os-9.2@' + JUL)) !== -1,
            dom.location.hash);
});

test('ссылка со временем сбора открывает тот же прогон', async function () {
  var dom = load();
  store.add([snap('os-9.2', JUL, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('httpd')] })], 'c.json');
  clickNode(dom, 1);                                /* открыт августовский */
  assert.ok(dom.id('state-rows').innerHTML.indexOf('httpd') !== -1);
  /* Свою же запись в адрес страница пропускает, и ждать её приходится
     тику: иначе присланная ссылка была бы прочитана как эхо. */
  await dom.tick();
  dom.location.hash = '#tab=state&tag='
                    + encodeURIComponent('os-9.2@' + JUL) + '&f=';
  dom.fireWindow('hashchange');
  assert.ok(dom.id('state-rows').innerHTML.indexOf('apache') !== -1,
            dom.id('state-rows').innerHTML);
});

/* Снапшот — это тег в определённый момент, и время сбора стоит у каждого
   узла, а не только у двойников: цепочка из одних тегов отвечает, что с чем
   сравнивается, но не отвечает, за какой срок. */
test('под каждым узлом стоит время сбора', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.match(chain(dom), /class="when">2026-07-01 00:00</, chain(dom));
  assert.match(chain(dom), /class="when">2026-08-01 00:00</, chain(dom));
});

test('одинаковые теги различает время сбора', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  assert.match(chain(dom), /class="when">2026-07-01 00:00</, chain(dom));
  assert.match(chain(dom), /class="when">2026-08-01 00:00</, chain(dom));
});

/* Над отрезком стоит расстояние во времени между его концами: рельс не
   только расставляет снапшоты по порядку, он показывает, какой кусок жизни
   тега лежит между ними. Единица крупная — под узлами и так полные даты. */
test('отрезок подписан расстоянием во времени', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.match(chain(dom), /class="gap">31 дн</, chain(dom));
});

test('часы и месяцы считаются своими единицами', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-07-01T07:00:00+03:00')], 'b.json');
  store.add([snap('os-9.3', '2026-12-01T07:00:00+03:00')], 'c.json');
  assert.match(chain(dom), /class="gap">7 ч</, chain(dom));
  assert.match(chain(dom), /class="gap">5 мес</, chain(dom));
});

/* Перестановка цепочки руками ставит поздний снапшот раньше раннего.
   Расстояние от этого не становится отрицательным: отрезок измеряет
   промежуток, а не разность в порядке кликов. */
test('расстояние не зависит от порядка снапшотов', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  store.move(1, -1);
  assert.match(chain(dom), /class="gap">31 дн</, chain(dom));
});

/* Рельс — единственный способ переключить снапшот: селектор-пилюли, стоявший
   раньше над карточками, ушёл. Клик по узлу на «Состоянии» открывает снапшот
   сразу, а не отмечает конец диапазона: диапазон живёт на «Изменениях». */
test('на «Состоянии» клик по узлу открывает снапшот', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('apache')] })], 'b.json');
  clickNode(dom, 0);
  assert.strictEqual(openTag(chain(dom)), 'os-9.1', chain(dom));
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1,
            dom.id('state-rows').innerHTML);
  assert.strictEqual(chain(dom).indexOf('anchor'), -1, chain(dom));
});

/* Отметка принадлежит «Изменениям», и клик на «Состоянии» не должен ей
   ничего оставлять: следующий клик там же — это выбор другого снапшота,
   а не второй конец начатого где-то диапазона. */
test('выбор снапшота не мешает следующему выбору диапазона', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  store.add([snap('os-9.3', SEP, { builds: [build('nginx')] })], 'c.json');
  clickNode(dom, 0);
  clickNode(dom, 1);
  assert.strictEqual(openTag(chain(dom)), 'os-9.2', chain(dom));
  pressTab(dom, 'diff');
  clickNode(dom, 1);
  clickNode(dom, 2);
  assert.match(dom.location.hash, /pair=os-9\.2%40[^.]*\.\.os-9\.3/,
               dom.location.hash);
});

/* Стороны перехода стоят над разрезами: сколько сборок в теге было и
   сколько стало. Считает их не таблица переходов, а сами снапшоты. */
test('над карточками диффа стоят стороны перехода', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG,
                  { builds: [build('nginx'), build('curl')] })], 'b.json');
  pressTab(dom, 'diff');
  var sides = dom.id('diff-sides').innerHTML;
  assert.match(sides, /class="l">было<\/div><div class="n">1 /, sides);
  assert.match(sides, /class="l">стало<\/div><div class="n">2 /, sides);
  assert.match(sides, /os-9\.1, 2026-07-01 00:00/, sides);
});

/* Выбор другого диапазона меняет и стороны: они про его концы, а не про
   цепочку целиком. */
test('смена диапазона переписывает стороны', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG,
                  { builds: [build('nginx'), build('curl')] })], 'b.json');
  store.add([snap('os-9.3', SEP,
                  { builds: [build('nginx'), build('curl'),
                             build('zlib')] })], 'c.json');
  pressTab(dom, 'diff');
  clickNode(dom, 1);
  clickNode(dom, 2);
  var sides = dom.id('diff-sides').innerHTML;
  assert.match(sides, /class="l">было<\/div><div class="n">2 /, sides);
  assert.match(sides, /class="l">стало<\/div><div class="n">3 /, sides);
});

/* Классы чипа по номеру узла: рельс рисуется строкой, и читать её удобнее
   разобранной. */
function nodeClass(dom, at) {
  var re = new RegExp('class="([^"]*)"[^>]*data-node="' + at + '"');
  var m = re.exec(chain(dom));
  return m ? m[1] : null;
}

/* Диапазон проходит не только через свои концы: снапшоты между ними в
   сравнение не попали, но лежат в его сроке, и рельс их помечает. */
test('узлы внутри диапазона помечены', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  store.add([snap('os-9.3', SEP)], 'c.json');
  store.add([snap('os-9.4', '2026-10-01T00:00:00+03:00')], 'd.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);
  clickNode(dom, 2);
  assert.doesNotMatch(nodeClass(dom, 0), /inside/, nodeClass(dom, 0));
  assert.match(nodeClass(dom, 1), /inside/, nodeClass(dom, 1));
  assert.doesNotMatch(nodeClass(dom, 2), /inside/, nodeClass(dom, 2));
  /* Узел за концом диапазона в него не входит. */
  assert.doesNotMatch(nodeClass(dom, 3), /inside/, nodeClass(dom, 3));
});

/* Соседние концы не оставляют между собой ничего, и помечать нечего. */
test('у соседней пары внутри диапазона пусто', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);
  clickNode(dom, 1);
  assert.strictEqual(chain(dom).indexOf('inside'), -1, chain(dom));
});

/* На «Состоянии» диапазона нет вовсе: там открыт один снапшот, и метка
   принадлежала бы выбору, которого на этой вкладке не делают. */
test('на «Состоянии» узлы внутри диапазона не помечаются', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  store.add([snap('os-9.3', SEP)], 'c.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);
  clickNode(dom, 2);
  assert.match(nodeClass(dom, 1), /inside/, nodeClass(dom, 1));
  pressTab(dom, 'state');
  assert.strictEqual(chain(dom).indexOf('inside'), -1, chain(dom));
});

/* Полосы прокрутки под рельсом нет — катят его колесом. Размеров у заглушки
   своих нет, поэтому тесная цепочка задаётся руками: рельсу тысяча
   пикселей, а видно четыреста. */
function tightRail(dom, at) {
  var chainBox = dom.id('chain');
  chainBox.scrollWidth = 1000;
  chainBox.clientWidth = 400;
  chainBox.scrollLeft = at || 0;
  return chainBox;
}

function wheel(dom, node, delta, over) {
  var event = { deltaY: delta, deltaX: 0, deltaMode: 0 };
  var key;
  for (key in over || {}) {
    if (Object.prototype.hasOwnProperty.call(over, key)) event[key] = over[key];
  }
  return dom.fire(node, 'wheel', event);
}

test('колесо катит рельс вбок', function () {
  var dom = load();
  var chainBox = tightRail(dom, 0);
  var event = wheel(dom, chainBox, 50);
  assert.strictEqual(event.defaultPrevented, true);
  assert.ok(chainBox.scrollLeft > 0, 'рельс не поехал: ' + chainBox.scrollLeft);
});

test('колесо назад катит рельс обратно', function () {
  var dom = load();
  var chainBox = tightRail(dom, 300);
  wheel(dom, chainBox, -50);
  assert.ok(chainBox.scrollLeft < 300,
            'рельс не поехал назад: ' + chainBox.scrollLeft);
});

/* Строчный шаг — то, чем колесо меряет в Firefox: в пикселях там приезжает
   не всё. Считать его пикселем значило бы возить рельс по три пикселя за
   щелчок. */
test('строчный шаг колеса считается строками, а не пикселями', function () {
  var dom = load();
  var chainBox = tightRail(dom, 0);
  wheel(dom, chainBox, 3, { deltaMode: 1 });
  var byLines = chainBox.scrollLeft;
  chainBox.scrollLeft = 0;
  wheel(dom, chainBox, 3, { deltaMode: 0 });
  assert.ok(byLines > chainBox.scrollLeft,
            byLines + ' против ' + chainBox.scrollLeft);
});

/* Докрученная до конца цепочка колесо странице не отдаёт: прокрутка,
   перескакивающая на страницу с последнего узла, уводит из-под курсора то
   самое, что человек разглядывает. */
test('на краю цепочки колесо остаётся рельсу', function () {
  var dom = load();
  var chainBox = tightRail(dom, 600);
  var event = wheel(dom, chainBox, 50);
  assert.strictEqual(event.defaultPrevented, true);
});

test('влезшую целиком цепочку колесо не трогает', function () {
  var dom = load();
  var chainBox = dom.id('chain');
  chainBox.scrollWidth = 400;
  chainBox.clientWidth = 400;
  var event = wheel(dom, chainBox, 50);
  assert.strictEqual(event.defaultPrevented, false);
  assert.strictEqual(chainBox.scrollLeft, 0);
});

/* Боком крутят тачпадом и с шифтом — такое колесо браузер разложит по
   рельсу сам, и перехватывать его значило бы считать шаг дважды. */
test('горизонтальное колесо рельс не перехватывает', function () {
  var dom = load();
  var chainBox = tightRail(dom, 100);
  var event = wheel(dom, chainBox, 5, { deltaX: 60 });
  assert.strictEqual(event.defaultPrevented, false);
  assert.strictEqual(chainBox.scrollLeft, 100);
});

/* Единственный снапшот переключать не на что, и узел там не кнопка:
   нажимается лишь то, что и правда что-то делает. */
test('на одном снапшоте узел рельса не нажимается', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  assert.strictEqual(chain(dom).indexOf('data-node'), -1, chain(dom));
  assert.ok(chain(dom).indexOf('os-9.1') !== -1, chain(dom));
});

test('пары одинаковых тегов различимы в адресе', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  store.add([snap('os-9.2', SEP)], 'd.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);
  clickNode(dom, 1);
  var first = dom.location.hash;
  clickNode(dom, 1);
  clickNode(dom, 2);
  assert.notStrictEqual(first, dom.location.hash,
                        'у двух разных переходов один и тот же адрес: ' + first);
});

test('ссылка на пару открывает тот же переход', async function () {
  var dom = load();
  /* Версии у прогонов разные, чтобы у двух диапазонов и таблицы были
     разные: совпадение адреса тут ничего не значило бы — его тест сам
     туда и присвоил. Смотреть надо на то, что страница нарисовала. */
  store.add([snap('os-9.2', JUL, { builds: [build('nginx', { version: '1.0' })] })],
            'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] })],
            'c.json');
  store.add([snap('os-9.2', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'd.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);
  clickNode(dom, 1);
  var link = dom.location.hash;
  var narrow = dom.id('diff-rows').innerHTML;
  clickNode(dom, 0);
  clickNode(dom, 2);
  assert.notStrictEqual(dom.id('diff-rows').innerHTML, narrow,
                        'два разных диапазона дали одну таблицу, сценарий '
                        + 'проверяет не то');
  await dom.tick();
  dom.location.hash = link;
  dom.fireWindow('hashchange');
  assert.strictEqual(dom.id('diff-rows').innerHTML, narrow,
                     dom.id('diff-rows').innerHTML);
});

function threeChain(dom) {
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
}

/* Клики в тестах приходят с подставного узла, поэтому саму разметку рельса
   надо проверить отдельно: скрипт может перестать рисовать кнопки, и
   делегированный обработчик останется зелёным, а страница — мёртвой. */
test('на «Изменениях» каждый узел рельса — кнопка', function () {
  var dom = load();
  threeChain(dom);
  var html = dom.id('chain').innerHTML;
  assert.match(html, /<button type="button" class="pick[^"]*" data-node="0"/,
               html);
  assert.strictEqual((html.match(/data-node="/g) || []).length, 3, html);
});

test('два клика по узлам задают диапазон', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 0);
  clickNode(dom, 1);
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.2/,
               dom.location.hash);
});

/* Карточки-счётчики скрипт рисует строкой, и достать из неё число можно
   только разбором: заглушка разметку из строк не ищет. Число стоит в
   первом «n» после своего data-filter — так их и пишет cardHtml. */
function cardNumber(dom, host, key) {
  var re = new RegExp('data-filter="' + key + '"[^>]*>.*?<div class="n">(\\d+)');
  var m = re.exec(dom.id(host).innerHTML);
  return m ? m[1] : null;
}

/* Счётчики диффа считаются по выбранной паре, а render() их не трогает:
   он только подсвечивает нажатые. Без явной перерисовки карточки остались
   бы от прошлого диапазона — и молча, потому что выглядят они одинаково. */
test('второй клик обновляет и счётчики диффа', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '2.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
  /* Умолчание — вся цепочка: 1.0 → 2.0, версия выросла. */
  assert.strictEqual(cardNumber(dom, 'diff-cards', 'upgraded'), '1',
                     dom.id('diff-cards').innerHTML);
  clickNode(dom, 1);
  clickNode(dom, 2);
  assert.match(dom.location.hash, /pair=os-9\.2%40[^.]*\.\.os-9\.3/,
               'диапазон не выбрался, сценарий проверяет не то: '
               + dom.location.hash);
  /* На 9.2→9.3 версия та же: выросших не осталось ни одного. */
  assert.strictEqual(cardNumber(dom, 'diff-cards', 'upgraded'), '0',
                     dom.id('diff-cards').innerHTML);
  assert.strictEqual(cardNumber(dom, 'diff-cards', 'unchanged'), '1',
                     dom.id('diff-cards').innerHTML);
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
  /* Между «pick» и «anchor» может стоять «on»: отмеченный узел бывает и
     концом того диапазона, который выбран сейчас. */
  assert.match(dom.id('chain').innerHTML, /class="pick[^"]*anchor"/,
               dom.id('chain').innerHTML);
});

test('повторный клик по отмеченному узлу снимает отметку', function () {
  var dom = load();
  threeChain(dom);
  /* Сперва выбираем узкий диапазон: отмена обязана вернуть страницу к
     нему, а не к умолчанию. На умолчании подмену было бы не видно. */
  clickNode(dom, 0);
  clickNode(dom, 1);
  var link = dom.location.hash, rows = dom.id('diff-rows').innerHTML;
  clickNode(dom, 2);
  clickNode(dom, 2);
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('anchor'), -1,
                     dom.id('chain').innerHTML);
  /* Отмена не выбирает ничего: ни адрес, ни таблица не трогаются. Без
     ветки снятия второй клик задал бы пару из одного и того же узла, а
     она молча читается как «вся цепочка». */
  assert.strictEqual(dom.location.hash, link, dom.location.hash);
  assert.strictEqual(dom.id('diff-rows').innerHTML, rows);
});

/* Отметка — шаг выбора, а не состояние страницы: пережив уход с вкладки,
   она встретила бы человека обведённым узлом, о котором он уже забыл. */
test('уход на другую вкладку снимает отметку', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 0);
  pressTab(dom, 'state');
  pressTab(dom, 'diff');
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('anchor'), -1,
                     dom.id('chain').innerHTML);
});

/* Отметка названа номером в цепочке, а после прихода файла тот же номер
   стоит у другого снапшота: сравнение вышло бы не то, что человек начал. */
test('приход снапшота снимает отметку', async function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 0);
  await dom.tick();
  store.add([snap('os-9.4', '2026-10-01T00:00:00+03:00',
                  { builds: [build('nginx', { version: '4.0' })] })], 'd.json');
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('anchor'), -1,
                     dom.id('chain').innerHTML);
});

/* Подпись рельса живёт в шапке панели и написана в шаблоне: она одна и та
   же при любых данных. Скрипт её не рисует — значит, ни отметка, ни смена
   вкладки, ни приход файла не могут её подменить или потерять. */
test('подпись рельса стоит в шаблоне, а не в разметке от скрипта', function () {
  var dom = load();
  var head = dom.document.querySelector('.srchead');
  assert.ok(head, 'в шаблоне нет шапки панели источников');
  assert.strictEqual(head.querySelector('.l').text, 'снапшоты');
  threeChain(dom);
  clickNode(dom, 1);
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('class="l"'), -1,
                     dom.id('chain').innerHTML);
});

/* Сводность диапазона — свойство данных, а не рельса: подписи «итог» на
   рельсе больше нет, и правило «вся цепочка, и только когда снапшотов
   больше двух» проверяется там, где живёт, — в page.test.js.

   Здесь остаётся то, что без страницы не проверить: что диапазон во всю
   цепочку и правда открыт по умолчанию. Двойник тега берётся нарочно — на
   нём пара в кэш предпосчитанного не попадает, и переход считается на
   месте. */
test('по умолчанию открыт диапазон во всю цепочку, даже при двойниках тега',
  function () {
    var dom = load();
    store.add([snap('os-9.2', JUL, { builds: [build('nginx', { version: '1.0' })] }),
               snap('os-9.3', AUG, { builds: [build('nginx', { version: '2.0' })] }),
               snap('os-9.2', SEP, { builds: [build('nginx', { version: '3.0' })] })],
              'a.json');
    pressTab(dom, 'diff');
    var html = dom.id('diff-rows').innerHTML;
    /* Открыт самый широкий диапазон, от первого прогона до последнего:
       1.0 → 3.0. Промежуточного 2.0 в таком сравнении нет. */
    assert.match(html, /1\.0/, html);
    assert.match(html, /3\.0/, html);
    assert.strictEqual(html.indexOf('2.0'), -1, html);
  });

/* Зачем возврат фокуса нужен странице: клик перерисовывает рельс целиком,
   и в браузере нажатая кнопка исчезает вместе с фокусом. Выбор
   двухшаговый, и без возврата второй конец пришлось бы искать табом
   заново, пройдя весь рельс сначала.

   Что из этого проверяет тест: после клика фокус стоит на узле с тем же
   номером. Узел при этом настоящий, перерисованный: запись в innerHTML
   заглушка разбирает тем же разбором, что и шаблон, поэтому подставная
   кнопка из clickNode до проверки не доживает — её уносит перерисовка
   рельса, ровно как в браузере. */
test('после клика фокус остаётся на том же узле', function () {
  var dom = load();
  threeChain(dom);
  clickNode(dom, 1);
  assert.strictEqual(dom.focused().getAttribute('data-node'), '1');
  /* Второй конец перерисовывает не только рельс, но и всю страницу. */
  clickNode(dom, 2);
  assert.strictEqual(dom.focused().getAttribute('data-node'), '2');
});

/* Теста на снятие подсказки при клике здесь намеренно нет. В браузере
   фокус сразу уезжает на перерисованный узел, focusin показывает
   подсказку заново, и «подсказки не видно» — неправда. Заглушка на
   focus() событий не поднимает, так что такой тест был бы зелён только
   в ней: уверенность без покрытия хуже, чем её отсутствие. */

/* Узел нажимается на обеих вкладках, но обещает разное: на «Изменениях» он
   конец диапазона, на «Состоянии» — выбор из ряда. Подсказка про отметку,
   уехавшая на «Состояние», звала бы делать то, чего там не делают. */
test('подсказка узла говорит то, что клик и сделает', function () {
  var dom = load();
  threeChain(dom);
  assert.match(chain(dom), /data-tip="Отметить началом сравнения\./, chain(dom));
  pressTab(dom, 'state');
  assert.strictEqual(chain(dom).indexOf('Отметить началом'), -1, chain(dom));
  assert.match(chain(dom), /data-tip="Открыть этот снапшот\./, chain(dom));
  assert.match(chain(dom), /aria-pressed="true" data-tip="Открыт сейчас\./,
               chain(dom));
});

/* Список источников ушёл, и то, что он один умел говорить, теперь говорит
   подсказка узла: сколько в снапшоте сборок и из какого файла он приехал. */
test('подсказка узла называет число сборок и файл', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx'), build('httpd')] })],
            'b.json');
  assert.match(chain(dom), /1 сборка, файл a\.json/, chain(dom));
  assert.match(chain(dom), /2 сборки, файл b\.json/, chain(dom));
});

/* Призрак стоит в конце рельса всегда: добавить снапшот можно в любой
   момент, и место, где это делают, не должно появляться и исчезать. */
test('призрак стоит в конце рельса при любом составе', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  assert.match(chain(dom), /data-add="1"/, chain(dom));
  assert.ok(chain(dom).indexOf('os-9.1') < chain(dom).indexOf('data-add'),
            chain(dom));
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.strictEqual((chain(dom).match(/data-add=/g) || []).length, 1,
                     chain(dom));
  assert.ok(chain(dom).indexOf('os-9.2') < chain(dom).indexOf('data-add'),
            chain(dom));
});

/* У каждого снапшота свой крестик, в том числе у единственного: убрать
   последний — законный ход, страница вернётся к зоне загрузки. */
test('крестик есть у каждого узла, включая единственный', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  assert.strictEqual((chain(dom).match(/data-drop-snap=/g) || []).length, 1,
                     chain(dom));
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.strictEqual((chain(dom).match(/data-drop-snap=/g) || []).length, 2,
                     chain(dom));
});

test('файл роняют на страницу — снапшот загружается', async function () {
  var dom = load();
  var text = JSON.stringify([snap('os-9.1', '2026-07-01T00:00:00+03:00')]);
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  await dom.tick();
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(noteText(dom), '');
  assert.strictEqual(dom.id('tab-empty').hidden, true);
});

test('файлы выбирают через input', async function () {
  var dom = load();
  var input = dom.id('file-input');
  var text = JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00'));
  input.files = [domstub.file('a.json', text)];
  dom.fire(input, 'change', {});
  await dom.tick();
  assert.strictEqual(store.list().length, 1);
  /* Повторный выбор того же файла обязан дать событие: значение сбрасывают. */
  assert.strictEqual(input.value, '');
});

test('не-JSON — строка ошибки, загруженное на месте', async function () {
  var dom = load();
  var good = JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00'));
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', good)] } });
  await dom.tick();
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('bad.json', '{ сломано')] } });
  await dom.tick();
  assert.ok(noteText(dom).indexOf('bad.json') !== -1, noteText(dom));
  assert.strictEqual(store.list().length, 1);
  assert.ok(dom.id('chain').innerHTML.indexOf('os-9.1') !== -1);
});

test('ошибку загрузки видно и когда дашборд уже не пуст', async function () {
  var dom = load();
  var good = JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00'));
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', good)] } });
  await dom.tick();
  /* Зона загрузки спрятана, как только появились данные. Окошко внутри
     неё было бы невидимо — и человек не узнал бы, что файл отвергнут. */
  var node = dom.id('toasts'), empty = dom.id('tab-empty');
  while (node) {
    assert.notStrictEqual(node, empty, 'ошибки спрятаны вместе с зоной загрузки');
    node = node.parentNode;
  }
  assert.strictEqual(empty.hidden, true);
});

test('нечитаемый файл не проходит молча', async function () {
  var dom = load();
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('x.json', '', true)] } });
  await dom.tick();
  assert.ok(noteText(dom).indexOf('x.json') !== -1, noteText(dom));
});

test('тот же файл дважды — отказ, цепочка не удваивается', async function () {
  var dom = load();
  var text = JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00'));
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  await dom.tick();
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  await dom.tick();
  assert.strictEqual(store.list().length, 1);
  assert.ok(noteText(dom).indexOf('уже загружен') !== -1, noteText(dom));
});

test('негодный снапшот не вешает страницу', async function () {
  /* Проверку при загрузке этот файл проходит: builds — массив. Падает
     отрисовка, и падает она внутри store.add, вызванного из FileReader.
     Раньше исключение уносило done(), панель источников и весь дашборд:
     страница выглядела нетронутой, а живой не была. */
  var dom = load();
  var poison = '{"schema": 1, "tag": "t", "generated": '
             + '"2026-08-01T00:00:00+03:00", "builds": [null]}';
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('bad.json', poison)] } });
  await dom.tick();
  assert.strictEqual(store.list().length, 0, 'негодный снапшот остался в хранилище');
  assert.ok(noteText(dom).indexOf('bad.json') !== -1,
            'причина не написана на экране: ' + noteText(dom));
  assert.strictEqual(dom.id('tab-empty').hidden, false);
  /* Дашборд должен остаться рабочим: следующий годный файл загружается. */
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json',
               JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00')))] } });
  await dom.tick();
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(dom.id('tab-empty').hidden, true);
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1);
});

test('негодный снапшот не уносит соседей по загрузке', async function () {
  /* Один файл из двух отравлен: второй обязан доехать, а первый —
     объясниться. Счётчик pending без этого застревал на первом же. */
  var dom = load();
  var poison = '{"schema": 1, "tag": "t", "generated": '
             + '"2026-08-01T00:00:00+03:00", "builds": [null]}';
  dom.fire(dom.id('drop'), 'drop', { dataTransfer: { files: [
    domstub.file('bad.json', poison),
    domstub.file('a.json',
                 JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00')))
  ] } });
  await dom.tick();
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1']);
  assert.ok(noteText(dom).indexOf('bad.json') !== -1, noteText(dom));
});

test('разные хабы — предупреждение на странице', function () {
  var dom = load();
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([other], 'b.json');
  assert.ok(noteText(dom).indexOf('хаба') !== -1, noteText(dom));
});

test('перестановка тех же снапшотов предупреждение не повторяет', function () {
  /* warnings() считается заново от состава, и на каждое перетаскивание
     набор строк там прежний. Показывать его снова значило бы твердить
     человеку одно и то же за то, что он двигает узлы. */
  var dom = load();
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([other], 'b.json');
  var before = dom.id('toasts').querySelectorAll('.toast').length;
  assert.strictEqual(before, 1, noteText(dom));
  dragNode(dom, 1, 0, 'before');
  assert.strictEqual(dom.id('toasts').querySelectorAll('.toast').length, before,
                     'предупреждение всплыло второй раз: ' + noteText(dom));
});

test('откатившаяся перестановка объясняется окошком', function () {
  /* У перестановки нет своего места для ошибок: причина уезжает в
     предупреждения хранилища. Состав после отката прежний, и не показать
     её значило бы промолчать о том, что действие не состоялось. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.onChange(function () {
    if (store.list()[0].tag === 'os-9.2') throw new Error('пара не рисуется');
  });
  store.move(1, -1);
  assert.ok(noteText(dom).indexOf('пара не рисуется') !== -1, noteText(dom));
});

/* Добавляют снапшоты с рельса: призрак в его конце открывает тот же
   файловый диалог, что и зона загрузки на пустой странице. */
test('призрак в конце рельса открывает файловый диалог', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var opened = 0;
  dom.id('file-input').addEventListener('click', function () { opened += 1; });
  pressOnRail(dom, 'data-add', '1');
  assert.strictEqual(opened, 1);
});

test('подписи классов не переживают выгрузку снапшота', async function () {
  /* LABELS раньше только копил подписи классов. Пока applyData звали один
     раз, это было незаметно; теперь фильтр из ушедшего снапшота остался бы
     «известным» и таблица молча стала бы пустой. */
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00',
                  { classes: ['SAST'],
                    builds: [build('nginx', { patches: [patch('s.patch', 'SAST')] })] })],
            'a.json');
  store.remove(0);
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00',
                  { classes: ['CVE'],
                    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
            'b.json');
  await dom.tick();
  dom.location.hash = '#tab=state&f=sast';
  dom.fireWindow('hashchange');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры',
                     'фильтр класса из выгруженного снапшота остался живым');
});

/* Карточки класса скрипт рисует через innerHTML, а заглушка разметку из
   строк не разбирает. Ставим такую же карточку настоящим узлом: проверяется
   делегированный обработчик, а не то, как браузер её отрисует. */
function pressCard(dom, host, key) {
  var node = dom.document.createElement('div');
  node.setAttribute('class', 'card');
  node.setAttribute('data-filter', key);
  dom.id(host).appendChild(node);
  dom.fire(node, 'click', {});
}

/* Тот же отсев, но на пути applyData: снапшоты человек выгружает и
   догружает, и класс патчей уходит вместе со своим снапшотом. Через
   hashchange это ловится, а через applyData — нет: адрес там свой,
   перечитывать его нельзя, и отсев без него не случался вовсе. */
test('фильтр по классу не переживает смену состава снапшотов',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL,
                  { classes: ['SAST'],
                    builds: [build('nginx', { patches: [patch('s.patch', 'SAST')] })] })],
            'a.json');
  await dom.tick();
  pressCard(dom, 'tab-state', 'sast');            /* человек включил фильтр */
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры · 1');
  store.remove(0);
  store.add([snap('os-9.2', AUG,
                  { classes: ['CVE'],
                    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
            'b.json');
  await dom.tick();
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры',
                     'фильтр класса из выгруженного снапшота остался живым');
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1,
            'таблица пуста под фильтр, которого нет ни на одной карточке: '
            + dom.id('state-rows').innerHTML);
});

/* Кнопка фильтров: и орган управления, и единственное место, где с
   закрытым меню видно, что фильтр вообще стоит. Раньше это говорила строка
   чипов. */
function filterBtn(dom) { return dom.id('filters'); }

/* Кнопку меню нажимаем настоящую — ту, которую нарисовал сам модуль.
   Заодно проверяется, что он её нарисовал: подставной узел сказал бы
   только про обработчик. Меню при этом обязано быть открыто. */
function menuBtn(dom, attr, value) {
  var list = dom.id('filtermenu').querySelectorAll('[' + attr + ']'), i;
  for (i = 0; i < list.length; i++) {
    if (list[i].getAttribute(attr) === value) return list[i];
  }
  throw new Error('в меню нет ' + attr + '="' + value + '"');
}

function pressMenu(dom, attr, value) {
  if (dom.id('filtermenu').hidden) dom.fire(filterBtn(dom), 'click', {});
  dom.fire(menuBtn(dom, attr, value), 'click', {});
}

test('меню не закрывается после клика по признаку', function () {
  /* Условий человек ставит несколько подряд, и переоткрывать меню на
     каждое — работа, которой он не просил. Своя разметка при этом
     перерисовывается, и узел, по которому щёлкнули, уходит из дерева: от
     него до плашки уже не дойти, и клик выглядит внешним. */
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE', 'SAST'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  dom.fire(filterBtn(dom), 'click', {});
  dom.fire(menuBtn(dom, 'data-fset', 'cve:1'), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, false,
                     'меню закрылось после первого же клика');
  dom.fire(menuBtn(dom, 'data-fset', 'sast:-1'), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, false);
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры · 2');
});

test('переключатель группы меню тоже не закрывает', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  dom.fire(filterBtn(dom), 'click', {});
  dom.fire(menuBtn(dom, 'data-fmode', 'classes:any'), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, false);
  dom.fire(menuBtn(dom, 'data-fclear', '1'), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, false);
});

test('после нажатия фокус остаётся на той же кнопке меню', function () {
  /* Разметка меню перерисовывается целиком, и нажатая кнопка исчезает
     вместе с фокусом: с клавиатуры второе условие пришлось бы искать табом
     с начала плашки. */
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  dom.fire(filterBtn(dom), 'click', {});
  dom.fire(menuBtn(dom, 'data-fset', 'cve:1'), 'click', {});
  assert.strictEqual(dom.focused().getAttribute('data-fset'), 'cve:1');
});

test('клик мимо меню его закрывает', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  dom.fire(filterBtn(dom), 'click', {});
  dom.fire(dom.id('state-rows'), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, true);
});

test('кнопка фильтров считает поставленные условия', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры');
  pressCard(dom, 'tab-state', 'cve');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры · 1');
});

test('меню открывается кнопкой и закрывается ею же', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  assert.strictEqual(dom.id('filtermenu').hidden, true);
  dom.fire(filterBtn(dom), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, false);
  assert.strictEqual(filterBtn(dom).getAttribute('aria-expanded'), 'true');
  dom.fire(filterBtn(dom), 'click', {});
  assert.strictEqual(dom.id('filtermenu').hidden, true);
});

test('Escape закрывает меню', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  dom.fire(filterBtn(dom), 'click', {});
  dom.fire(dom.document.body, 'keydown', { key: 'Escape' });
  assert.strictEqual(dom.id('filtermenu').hidden, true);
});

test('меню и плашка правят одно и то же состояние', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] }),
             build('curl')] })], 'a.json');
  pressMenu(dom, 'data-fset', 'cve:-1');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры · 1');
  assert.ok(dom.id('state-rows').innerHTML.indexOf('curl') !== -1,
            dom.id('state-rows').innerHTML);
  assert.strictEqual(dom.id('state-rows').innerHTML.indexOf('nginx'), -1,
                     'строка с CVE-патчем осталась под фильтром «нет»');
  /* Плашка того же признака снимает его в «неважно». */
  pressCard(dom, 'tab-state', 'cve');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры');
});

test('переключатель группы уезжает в адрес', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  pressMenu(dom, 'data-fmode', 'classes:any');
  assert.ok(dom.location.hash.indexOf('any=classes') !== -1,
            dom.location.hash);
});

test('«сбросить всё» снимает фильтры вкладки', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  pressCard(dom, 'tab-state', 'cve');
  pressMenu(dom, 'data-fclear', '1');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры');
});

/* Вкладки скрипт переключает делегированием, как карточки: кнопки в шаблоне
   есть, но обработчик один на документ. */
function pressTab(dom, name) {
  var nodes = dom.document.querySelectorAll('.tab'), i;
  for (i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('data-tab') === name) {
      dom.fire(nodes[i], 'click', {});
      return;
    }
  }
  throw new Error('в шаблоне нет вкладки ' + name);
}

/* Фильтры у вкладок свои, и мёртвым фильтр остаётся молча: пока человек на
   «Изменениях», отсев по одной текущей вкладке ничего не делает с
   «Состоянием», а один клик по вкладке возвращает и пустую таблицу, и
   поставленный фильтр на кнопке. */
test('мёртвый фильтр отсеивается и на той вкладке, где человека сейчас нет',
     async function () {
  var dom = load();
  function sast(tag, gen) {
    return snap(tag, gen, { classes: ['SAST'],
      builds: [build('nginx', { patches: [patch('s.patch', 'SAST')] })] });
  }
  function cve(tag, gen) {
    return snap(tag, gen, { classes: ['CVE'],
      builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] });
  }
  store.add([sast('os-9.1', JUL), sast('os-9.2', AUG)], 'a.json');
  await dom.tick();
  pressCard(dom, 'tab-state', 'sast');      /* фильтр поставлен на «Состоянии» */
  pressTab(dom, 'diff');                    /* и человек ушёл на «Изменения» */
  assert.strictEqual(dom.id('tab-diff').hidden, false);
  /* Пара на странице есть всё время, поэтому вкладка «Изменения» никуда не
     девается и остаётся текущей: снапшоты с SAST сперва заменяются, а
     потом уходят. */
  store.add([cve('os-9.3', SEP), cve('os-9.4', '2026-10-01T00:00:00+03:00')],
            'b.json');
  store.remove(0);
  store.remove(0);
  await dom.tick();
  assert.strictEqual(dom.id('tab-diff').hidden, false,
                     'человек уехал с «Изменений», сценарий проверяет не то');
  pressTab(dom, 'state');
  assert.strictEqual(filterBtn(dom).textContent, 'Фильтры',
                     'на невидимой вкладке фильтр пережил свой снапшот');
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1,
            'таблица пуста под фильтр, которого нет ни на одной карточке: '
            + dom.id('state-rows').innerHTML);
});

/* Файлы роняют на страницу по одному, и каждый — отдельный store.add, то
   есть отдельный applyData. Обещание README «открывается на последнем
   снапшоте цепочки и на самом широком переходе» обязано выполняться и
   так — иначе самый частый способ загрузки даёт самый узкий вид. */
test('снапшоты приехали по одному — открыт самый свежий и самый широкий переход',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  await dom.tick();
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  await dom.tick();
  store.add([snap('os-9.3', SEP, { builds: [build('nginx')] })], 'c.json');
  await dom.tick();
  assert.strictEqual(openTag(chain(dom)), 'os-9.3', chain(dom));
  /* Самый широкий переход — вся цепочка, от os-9.1 до os-9.3. */
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.3/,
               dom.location.hash);
});

/* Тот же вид обязан открываться и с одного файла на три снапшота: applyData
   здесь один, а не три, и умолчание не должно зависеть от числа вызовов. */
test('три снапшота одним файлом — тот же свежий снапшот и тот же широкий переход',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] }),
             snap('os-9.2', AUG, { builds: [build('nginx')] }),
             snap('os-9.3', SEP, { builds: [build('nginx')] })], 'all.json');
  await dom.tick();
  assert.strictEqual(openTag(chain(dom)), 'os-9.3', chain(dom));
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.3/,
               dom.location.hash);
});

test('свежий снапшот выбирается и когда файл пришёл вторым', function () {
  /* Порядок цепочки задаёт время сбора, а не порядок загрузки: последним
     в списке стоит августовский, его и надо открыть. */
  var dom = load();
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  assert.strictEqual(openTag(chain(dom)), 'os-9.2', chain(dom));
});

test('выбранный человеком снапшот переживает приход нового файла',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('apache')] })], 'b.json');
  clickNode(dom, 0);                                /* явный выбор: os-9.1 */
  await dom.tick();
  store.add([snap('os-9.3', SEP, { builds: [build('httpd')] })], 'c.json');
  await dom.tick();
  assert.strictEqual(openTag(chain(dom)), 'os-9.1', chain(dom));
});

test('выбранный человеком переход переживает приход нового файла',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  store.add([snap('os-9.3', SEP, { builds: [build('nginx')] })], 'c.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);                                /* явный выбор: 9.1→9.2 */
  clickNode(dom, 1);
  await dom.tick();
  store.add([snap('os-9.4', '2026-10-01T00:00:00+03:00',
                  { builds: [build('nginx')] })], 'd.json');
  await dom.tick();
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.2/,
               dom.location.hash);
});

/* Конец выбранного диапазона выгрузили — выбора больше нет, и дальше снова
   работает умолчание «вся цепочка».

   Проверить это сразу после выгрузки нечем: снятый выбор и выбор, у
   которого один конец пропал, дают на рельсе одно и то же — всю цепочку.
   Расходятся они на следующем файле: снятый уступает место новому
   умолчанию, а неснятый цепляется за прежние концы и остаётся. */
test('выгрузка конца диапазона откатывает выбор на всю цепочку',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);                                /* явный выбор: 9.1→9.2 */
  clickNode(dom, 1);
  await dom.tick();
  store.remove(1);                                  /* конец 9.2 выгрузили */
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.3/,
               dom.location.hash);
  await dom.tick();
  store.add([snap('os-9.4', '2026-10-01T00:00:00+03:00',
                  { builds: [build('nginx', { version: '4.0' })] })], 'd.json');
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.4/,
               'после выгрузки конца страница держится за снятый выбор: '
               + dom.location.hash);
});

/* Снапшот выгрузили и подгрузили обратно — тот же файл, то же имя. Выбор к
   этому моменту уже снят выгрузкой, и возвращение файла его не воскрешает:
   иначе человек получил бы диапазон, который выбирал до выгрузки и с тех
   пор успел забыть. */
test('вернувшийся снапшот не воскрешает снятый выбор', async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
  clickNode(dom, 0);                                /* явный выбор: 9.1→9.2 */
  clickNode(dom, 1);
  await dom.tick();
  store.remove(1);
  await dom.tick();
  store.add([snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] })],
            'b.json');
  assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.3/,
               'вернувшийся файл воскресил снятый выбор: ' + dom.location.hash);
});

/* Снапшоты переставляют руками, и порядок цепочки задаёт направление
   сравнения. Выбранный диапазон перестановку переживает — он назван
   именами концов, а не номерами, — но «было» и «стало» в нём меняются
   местами: слева снова тот, кто левее в новой цепочке. */
test('перестановка цепочки переворачивает направление, а не теряет выбор',
     function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
  clickNode(dom, 1);                                /* явный выбор: 9.2→9.3 */
  clickNode(dom, 2);
  store.move(2, -1);                                /* 9.3 поднялся выше 9.2 */
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1', 'os-9.3', 'os-9.2']);
  assert.match(dom.location.hash, /pair=os-9\.3%40[^.]*\.\.os-9\.2/,
               dom.location.hash);
  var html = dom.id('diff-rows').innerHTML;
  /* Сравниваются те же два конца, но теперь 3.0 → 2.0: версия упала.
     Умолчание «вся цепочка» дало бы здесь 1.0 → 2.0. */
  assert.match(html, /class="main-row downgraded"/, html);
  assert.match(html, /3\.0/, html);
  assert.strictEqual(html.indexOf('1.0'), -1, html);
});

test('выбранный снапшот убрали — снова открывается самый свежий', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.3', SEP, { builds: [build('httpd')] })], 'c.json');
  clickNode(dom, 0);
  store.remove(0);
  assert.strictEqual(openTag(chain(dom)), 'os-9.3', chain(dom));
});

/* Всё, что приходит из снапшота, попадает в разметку через innerHTML, и
   единственный барьер — esc()/hl(). Снапшот выбирает человек, а имя
   компонента в нём — любая строка, какую напишет чужой или испорченный
   файл. */
test('разметка из данных экранируется', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL,
                  { builds: [build('<img src=x>&"')] })], 'a.json');
  var html = dom.id('state-rows').innerHTML;
  assert.strictEqual(html.indexOf('<img'), -1, html);
  assert.ok(html.indexOf('&lt;img') !== -1, html);
  assert.ok(html.indexOf('&amp;') !== -1, html);
  assert.ok(html.indexOf('&quot;') !== -1, html);
});

test('подсветка поиска тоже экранирует, а не только режет строку',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL,
                  { builds: [build('<img src=x>')] })], 'a.json');
  await dom.tick();
  dom.location.hash = '#tab=state&q=src&f=';
  dom.fireWindow('hashchange');
  var html = dom.id('state-rows').innerHTML;
  assert.ok(html.indexOf('class="hit"') !== -1, 'запрос не применился: ' + html);
  assert.strictEqual(html.indexOf('<img'), -1, html);
});

test('в href пускают только http(s) и относительный путь', function () {
  var dom = load();
  var evil = { raw: 'git+ssh://git@h/g/x?#origin/main', host: 'h',
               project: 'g/x', ref: 'main', ref_kind: 'branch',
               web_url: 'javascript:alert(1)' };
  var patches = [
    { path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE', cves: [],
      web_url: 'javascript:alert(2)' },
    { path: 'PATCH/b.patch', name: 'b.patch', 'class': 'CVE', cves: [],
      web_url: '//evil.example/x' },
    { path: 'PATCH/c.patch', name: 'c.patch', 'class': 'CVE', cves: [],
      web_url: 'https://gl/blob/c.patch' }
  ];
  store.add([snap('os-9.1', JUL,
                  { builds: [build('nginx', { source: evil,
                                              patches: patches })] })],
            'a.json');
  dom.fire(dom.id('expand'), 'click', {});
  var html = dom.id('state-rows').innerHTML;
  assert.strictEqual(html.indexOf('javascript:'), -1, html);
  assert.strictEqual(html.indexOf('//evil.example'), -1, html);
  /* Годная ссылка при этом на месте: запрет не должен выключать ссылки. */
  assert.ok(html.indexOf('https://gl/blob/c.patch') !== -1, html);
});

test('пакет не строкой не роняет раскрытие строки', function () {
  /* Проверку хранилища такой снапшот проходит: builds — массив. Таблица
     рисуется, а падает уже действие человека, когда откатывать нечего. */
  var dom = load();
  store.add([snap('os-9.1', JUL,
                  { builds: [build('nginx', { rpms: [123] })] })], 'a.json');
  dom.fire(dom.id('expand'), 'click', {});
  var html = dom.id('state-rows').innerHTML;
  assert.ok(html.indexOf('detail-row') !== -1, html);
  assert.ok(html.indexOf('123') !== -1, html);
});

test('строка «ничего не найдено» шириной во всю таблицу', async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  await dom.tick();
  dom.location.hash = '#tab=state&q=такого-нет&f=';
  dom.fireWindow('hashchange');
  var cols = dom.id('state-table').querySelectorAll('th').length;
  var html = dom.id('state-rows').innerHTML;
  assert.ok(html.indexOf('class="empty" colspan="' + cols + '"') !== -1,
            'в таблице ' + cols + ' колонок, а в строке: ' + html);
});

test('«Изменения» открываются на изменившихся компонентах', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx'), build('curl')] })],
            'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx'),
                                            build('curl', { version: '1.1' })] })],
            'b.json');
  var tabs = dom.document.querySelectorAll('.tab'), i;
  for (i = 0; i < tabs.length; i++) {
    if (tabs[i].getAttribute('data-tab') === 'diff') dom.fire(tabs[i], 'click', {});
  }
  var html = dom.id('diff-rows').innerHTML;
  assert.ok(html.indexOf('curl') !== -1, html);
  assert.strictEqual(html.indexOf('nginx'), -1,
                     'неизменившийся компонент виден под фильтром «changed»: '
                     + html);
});

test('класс патчей с именем свойства Object рисуется как обычный', function () {
  /* Имена классов задаёт конфиг, и «constructor» в нём — законное имя.
     Голый объект-счётчик отдал бы на такой ключ функцию Object. */
  var dom = load();
  var one = build('nginx', { patches: [
    { path: 'PATCH/a.patch', name: 'a.patch', 'class': 'constructor',
      cves: [], web_url: null },
    { path: 'PATCH/b.patch', name: 'b.patch', 'class': 'other',
      cves: [], web_url: null }] });
  var two = build('curl', { patches: [
    { path: 'PATCH/c.patch', name: 'c.patch', 'class': 'other',
      cves: [], web_url: null }] });
  store.add([snap('os-9.1', JUL, { classes: ['constructor', 'other'],
                                   builds: [one, two] })], 'a.json');
  dom.fire(dom.id('expand'), 'click', {});
  var rows = dom.id('state-rows').innerHTML;
  var cards = dom.id('class-cards').innerHTML;
  assert.strictEqual(rows.indexOf('native code'), -1, rows);
  assert.strictEqual(rows.indexOf('NaN'), -1, rows);
  assert.strictEqual(cards.indexOf('native code'), -1, cards);
  assert.ok(cards.indexOf('constructor') !== -1, cards);
});

test('версии нет — в таблице прочерк, а не пустота', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00',
                  { builds: [build('nginx', { release: null })] })], 'a.json');
  var html = dom.id('state-rows').innerHTML;
  assert.ok(/<td class="ver">\s*<span class="none">—<\/span>/.test(html), html);
});

/* Порядок блоков в раскрытой строке несёт смысл: сетка в два столбца
   ставит их парами, и каждый оказывается под своим источником — RPM под
   koji, откуда они приезжают, патчи под gitlab, где они лежат. Без теста
   это держалось бы только на порядке двух строк в шаблоне. */
test('в раскрытой строке RPM стоят под koji, а патчи под gitlab', function () {
  var dom = load();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'a.json');
  dom.fire(dom.id('expand'), 'click', {});
  var blocks = [];
  dom.id('state-rows').innerHTML.replace(
    /<div class="bl">([^<·]*)/g,
    function (_, title) { blocks.push(title.trim()); return ''; });
  assert.deepStrictEqual(blocks.slice(0, 4),
                         ['koji', 'gitlab', 'RPM', 'патчи']);
});

/* Кнопка «наверх» появляется, только когда наверх действительно надо:
   на нетронутой странице она была бы лишним пятном поверх таблицы. */
test('кнопка «наверх» прячется на нетронутой странице', function () {
  var dom = load();
  assert.strictEqual(dom.id('totop').hidden, true);
});

test('кнопка «наверх» появляется ниже первого экрана и уходит обратно',
  function () {
    var dom = load();
    dom.window.pageYOffset = dom.window.innerHeight + 1;
    dom.fireWindow('scroll');
    assert.strictEqual(dom.id('totop').hidden, false);

    dom.window.pageYOffset = 0;
    dom.fireWindow('scroll');
    assert.strictEqual(dom.id('totop').hidden, true);
  });

test('щелчок по кнопке «наверх» поднимает страницу', function () {
  var dom = load();
  dom.window.pageYOffset = 2000;
  dom.fireWindow('scroll');
  dom.fire(dom.id('totop'), 'click', {});
  assert.strictEqual(dom.window.pageYOffset, 0);
});

/* Крестик в поле поиска. Нативный рисует только WebKit, в Firefox его нет
   вовсе — поэтому свой, одинаковый везде. */
function wait(ms) {
  return new Promise(function (done) { setTimeout(done, ms); });
}

test('крестик поиска прячется, когда поле пустое', function () {
  var dom = load();
  assert.strictEqual(dom.id('q-clear').hidden, true);
});

test('крестик появляется сразу при вводе, не дожидаясь перерисовки',
  function () {
    var dom = load();
    var field = dom.id('q');
    field.value = 'nginx';
    dom.fire(field, 'input', {});
    assert.strictEqual(dom.id('q-clear').hidden, false);
  });

test('щелчок по крестику очищает поле и снимает запрос', async function () {
  var dom = load();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'a.json');
  var field = dom.id('q');
  field.value = 'такого-компонента-нет';
  dom.fire(field, 'input', {});
  await wait(200);                       /* поиск отложен на 120 мс */
  assert.match(dom.location.hash, /q=/, 'запрос должен доехать до адреса');
  assert.match(dom.id('state-rows').innerHTML, /class="empty"/);

  dom.fire(dom.id('q-clear'), 'click', {});
  assert.strictEqual(field.value, '');
  assert.strictEqual(dom.id('q-clear').hidden, true);
  assert.doesNotMatch(dom.location.hash, /q=/, 'запрос обязан уйти из адреса');
  assert.doesNotMatch(dom.id('state-rows').innerHTML, /class="empty"/);
  assert.strictEqual(dom.focused(), field, 'курсор обязан вернуться в поле');
});

/* Между вводом и поиском 120 мс. Щелчок по крестику попадает в этот
   промежуток чаще, чем кажется: набрал, увидел, что не то, сразу стёр. */
test('крестик, нажатый до срабатывания поиска, не даёт запросу вернуться',
  async function () {
    var dom = load();
    store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'a.json');
    var field = dom.id('q');
    field.value = 'такого-компонента-нет';
    dom.fire(field, 'input', {});          /* поиск ещё не сработал */
    dom.fire(dom.id('q-clear'), 'click', {});
    await wait(200);                       /* переживаем отложенный вызов */
    assert.strictEqual(field.value, '');
    assert.doesNotMatch(dom.location.hash, /q=/);
    assert.doesNotMatch(dom.id('state-rows').innerHTML, /class="empty"/);
  });

/* Сообщения о загрузке — события, а не состояние: файл отвергнут, состав
   не изменился, читать это второй раз незачем. Раньше они висели до конца
   сеанса. */
function sameFileTwice(dom, t) {
  var text = JSON.stringify([snap('os-9.2', '2026-08-01T00:00:00+03:00')]);
  var drop = dom.id('drop');
  dom.fire(drop, 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  t.mock.timers.tick(1);
  dom.fire(drop, 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  t.mock.timers.tick(1);
}

test('повторно поднесённый снапшот объясняется и сообщение гаснет само',
  function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    var dom = load();
    sameFileTwice(dom, t);
    assert.match(noteText(dom), /os-9\.2/,
                 'человеку должны сказать, что именно отвергнуто');
    assert.strictEqual(store.list().length, 1, 'цепочка не удвоилась');

    t.mock.timers.tick(30000);
    assert.strictEqual(noteText(dom), '', 'сообщение обязано уйти само');
  });

test('новое сообщение продлевает срок, а не наследует остаток чужого',
  function (t) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    var dom = load();
    sameFileTwice(dom, t);
    t.mock.timers.tick(9000);                 /* почти догорело */
    dom.fire(dom.id('drop'), 'drop',
             { dataTransfer: { files: [domstub.file('b.json', '{ сломано')] } });
    t.mock.timers.tick(1);
    t.mock.timers.tick(9000);                 /* прежний срок уже истёк бы */
    assert.match(noteText(dom), /b\.json/,
                 'свежее сообщение не должно гаснуть по чужому таймеру');
  });

/* Рельс цепочки — единственное место, где видно сразу и что загружено, и
   что с чем сравнивается. Ошибись он отметкой — человек будет уверен, что
   смотрит не на тот снапшот. */
function threeSnapshots() {
  return [snap('os-9.1', '2026-06-01T00:00:00+03:00'),
          snap('os-9.2', '2026-07-01T00:00:00+03:00'),
          snap('os-9.3', '2026-08-01T00:00:00+03:00')];
}

test('на «Состоянии» рельс отмечает снапшот, который сейчас в таблице',
  function () {
    var dom = load();
    store.add(threeSnapshots(), 'a.json');
    var chain = dom.id('chain').innerHTML;
    /* Считаем по data-node, а не по классу: класс чипа носит ещё и призрак
       в конце рельса, и счёт по нему считал бы узлом место, где узла нет. */
    assert.strictEqual((chain.match(/data-node="/g) || []).length, 3,
                       'три узла на рельсе: ' + chain);
    /* Отмечен ровно один, и это свежий снапшот — тот, что открывается по
       умолчанию. Отрезки на «Состоянии» не подсвечиваются: сравнение
       живёт на другой вкладке. */
    assert.strictEqual(chain.split('class="pick on"').length - 1, 1, chain);
    assert.ok(chain.indexOf('class="pick on"') > chain.indexOf('os-9.2'),
              'отмечен должен быть os-9.3: ' + chain);
    assert.strictEqual(chain.indexOf('class="rl on"'), -1, chain);
  });

test('на «Изменениях» рельс отмечает отрезок сравниваемой пары',
  function () {
    var dom = load();
    store.add(threeSnapshots(), 'a.json');
    dom.fire(dom.document.querySelectorAll('.tab')[1], 'click', {});
    var chain = dom.id('chain').innerHTML;
    /* Пара по умолчанию — сводная: от первого снапшота до последнего,
       значит отмечены оба конца и оба отрезка между ними. */
    assert.strictEqual(chain.split('class="rl on"').length - 1, 2,
                       'оба отрезка сводной пары: ' + chain);
    assert.strictEqual(chain.split('class="pick on"').length - 1, 2,
                       'оба конца пары: ' + chain);
  });

/* Предпосчитаны только соседние переходы и сводный. Любой другой диапазон
   должен считаться на месте, иначе «выбрать любой диапазон» означало бы
   «увидеть пустую таблицу». Заходим через адрес: другого пути к такому
   диапазону в этой задаче ещё нет. */
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

/* Короткую форму адреса пишут руками, и порядок тегов в ней — часть
   смысла: слева «было». У двойников тега конец, найденный сам по себе,
   уводит на другое сравнение — и молча, потому что оба конца названы
   верно. Ссылка «os-9.2..os-9.3» на цепочке 9.2, 9.3, 9.2 обязана открыть
   первый переход, а не последний. */
test('короткая ссылка на переход читается в том порядке, в каком написана',
  function () {
    var dom = load({ hash: '#tab=diff&pair='
                           + encodeURIComponent('os-9.2..os-9.3') });
    store.add([snap('os-9.2', JUL, { builds: [build('nginx', { version: '1.0' })] }),
               snap('os-9.3', AUG, { builds: [build('nginx', { version: '2.0' })] }),
               snap('os-9.2', SEP, { builds: [build('nginx', { version: '3.0' })] })],
              'a.json');
    var html = dom.id('diff-rows').innerHTML;
    /* Июльский os-9.2 против августовского os-9.3: 1.0 → 2.0. Сентябрьского
       прогона в этом сравнении нет вовсе. */
    assert.match(html, /1\.0/, html);
    assert.match(html, /2\.0/, html);
    assert.strictEqual(html.indexOf('3.0'), -1, html);
    assert.ok(dom.location.hash.indexOf(
                encodeURIComponent('os-9.2@' + JUL + '..os-9.3@' + AUG)) !== -1,
              dom.location.hash);
  });

/* У двойников тега подходящих диапазонов несколько, и выбирается из них
   последний в написанном порядке: самый свежий левый конец, у которого
   правый ещё есть справа. Свежий прогон человек имеет в виду чаще, а
   порядок концов при этом остаётся тем, что он написал. */
test('короткая ссылка при двойниках тега берёт последний такой диапазон',
  function () {
    var dom = load({ hash: '#tab=diff&pair='
                           + encodeURIComponent('os-9.2..os-9.3') });
    store.add([snap('os-9.2', JUL, { builds: [build('nginx', { version: '1.0' })] }),
               snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
               snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
              'a.json');
    var html = dom.id('diff-rows').innerHTML;
    /* Августовский os-9.2 против os-9.3, а не июльский: 2.0 → 3.0. */
    assert.match(html, /2\.0/, html);
    assert.match(html, /3\.0/, html);
    assert.strictEqual(html.indexOf('1.0'), -1, html);
    assert.ok(dom.location.hash.indexOf(
                encodeURIComponent('os-9.2@' + AUG + '..os-9.3@' + SEP)) !== -1,
              dom.location.hash);
  });

/* Двойник тега бывает и справа, и правило договаривает случай до конца:
   при выбранном левом конце берётся самый свежий из подходящих правых.
   Иначе ссылка открывала бы сравнение с прогоном, который человек уже
   считает устаревшим, — и молча, потому что оба конца названы верно. */
test('короткая ссылка берёт самый свежий правый конец', function () {
  var dom = load({ hash: '#tab=diff&pair='
                         + encodeURIComponent('os-9.1..os-9.2') });
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.2', SEP, { builds: [build('nginx', { version: '3.0' })] })],
            'a.json');
  var html = dom.id('diff-rows').innerHTML;
  /* os-9.1 против сентябрьского os-9.2, а не августовского: 1.0 → 3.0. */
  assert.match(html, /1\.0/, html);
  assert.match(html, /3\.0/, html);
  assert.strictEqual(html.indexOf('2.0'), -1, html);
  assert.ok(dom.location.hash.indexOf(
              encodeURIComponent('os-9.1@' + JUL + '..os-9.2@' + SEP)) !== -1,
            dom.location.hash);
});

/* Ссылку писали, когда цепочка стояла иначе: снапшоты переставляют руками,
   и присланный адрес переживает перестановку. Прочитать его задом наперёд
   нельзя — «было» и «стало» поменялись бы местами, — поэтому концы
   разворачиваются по цепочке. Это запасной ход: он работает только там,
   где в написанном порядке диапазон не читается вовсе. */
test('ссылка, написанная против цепочки, разворачивается по ней',
  function () {
    var dom = load({ hash: '#tab=diff&pair='
                           + encodeURIComponent('os-9.2@' + AUG + '..os-9.1@' + JUL) });
    store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
               snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
               snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] })],
              'a.json');
    var html = dom.id('diff-rows').innerHTML;
    /* Названы концы 9.1 и 9.2, значит сравниваются они: 1.0 → 2.0.
       Умолчание «вся цепочка» дало бы 1.0 → 3.0. */
    assert.match(html, /1\.0/, html);
    assert.match(html, /2\.0/, html);
    assert.strictEqual(html.indexOf('3.0'), -1, html);
  });

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

/* Кэш переходов со страницы не виден: «отдали тот же объект» и «посчитали
   заново» рисуют одну и ту же таблицу, а дверь в ui.js ради одной проверки
   была бы хуже пробела. Виден зато сам расчёт — его и считаем, на границе
   модуля. diffChain внутри diff.js зовёт свою же функцию, а не свойство
   экспорта, поэтому в счётчик попадают только расчёты по требованию из
   pairFor: то, что посчитала загрузка, здесь не шумит. */
function countDiffs(fn) {
  var n = 0;
  diffmod.diffSnapshots = function () {
    n += 1;
    return realDiffSnapshots.apply(null, arguments);
  };
  try { fn(); } finally { diffmod.diffSnapshots = realDiffSnapshots; }
  return n;
}

/* Предпосчитанное при загрузке кладёт в кэш seedPairs, и соседний переход
   обязан приехать оттуда. Иначе каждый клик по рельсу пересчитывал бы то,
   что уже посчитано, — а страница зовёт pairFor на каждый рендер, и не по
   одному разу. */
test('предпосчитанный переход берётся из кэша, а не считается заново',
  function () {
    var dom = load();
    threeChain(dom);
    var n = countDiffs(function () {
      clickNode(dom, 0);
      clickNode(dom, 1);
    });
    assert.match(dom.location.hash, /pair=os-9\.1%40[^.]*\.\.os-9\.2/,
                 'диапазон не выбрался, сценарий проверяет не то: '
                 + dom.location.hash);
    assert.strictEqual(n, 0, 'соседний переход посчитан заново, расчётов: ' + n);
  });

/* Диапазон, которого нет среди предпосчитанных, считается один раз: на
   второй выбор его отдаёт кэш. Спека просит здесь «тот же объект»; со
   страницы объекты неразличимы, поэтому проверяем то же условие с другой
   стороны — что второго расчёта не случилось. */
test('повторный выбор того же диапазона не считает его заново', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx', { version: '1.0' })] }),
             snap('os-9.2', AUG, { builds: [build('nginx', { version: '2.0' })] }),
             snap('os-9.3', SEP, { builds: [build('nginx', { version: '3.0' })] }),
             snap('os-9.4', OCT, { builds: [build('nginx', { version: '4.0' })] })],
            'a.json');
  pressTab(dom, 'diff');
  var first = countDiffs(function () {
    clickNode(dom, 1);
    clickNode(dom, 3);
  });
  assert.ok(first > 0,
            'диапазон 9.2→9.4 оказался предпосчитан, сценарий проверяет не то');
  clickNode(dom, 0);                     /* уходим на другой диапазон */
  clickNode(dom, 1);
  var again = countDiffs(function () {
    clickNode(dom, 1);
    clickNode(dom, 3);
  });
  assert.strictEqual(again, 0,
                     'тот же диапазон посчитан во второй раз, расчётов: ' + again);
});

/* Кэш переходов заводится заново на каждую смену состава снапшотов —
   проверка живёт в page.test.js, где сам кэш и стоит. Со страницы её было
   видно по метке «итог» на рельсе; метки больше нет, а другого следа кэш
   на странице не оставляет. */

test('плашка показывает все три положения признака', function () {
  /* Плашки страница рисует через innerHTML, а состояние расставляет по
     готовым узлам: разметка карточек пересобирается только со сменой
     данных. Поэтому и здесь узел настоящий. */
  var dom = load();
  store.add([snap('os-9.1', JUL, { classes: ['CVE'],
    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
    'a.json');
  var node = dom.document.createElement('div');
  node.setAttribute('class', 'card');
  node.setAttribute('data-filter', 'cve');
  dom.id('tab-state').appendChild(node);

  pressMenu(dom, 'data-fset', 'cve:-1');
  assert.ok(String(node.className).indexOf('is-no') !== -1, node.className);
  assert.strictEqual(node.getAttribute('aria-pressed'), 'false');

  pressMenu(dom, 'data-fset', 'cve:1');
  assert.strictEqual(String(node.className).indexOf('is-no'), -1,
                     node.className);
  assert.strictEqual(node.getAttribute('aria-pressed'), 'true');

  pressMenu(dom, 'data-fset', 'cve:0');
  assert.strictEqual(String(node.className).indexOf('is-no'), -1,
                     node.className);
  assert.strictEqual(node.getAttribute('aria-pressed'), 'false');
});
