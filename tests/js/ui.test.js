'use strict';
/* Страница целиком: ui.js на заглушке DOM из настоящего шаблона.
   Тесты здесь не про вид, а про связывание — что скрипт находит свои узлы,
   что загруженный снапшот доезжает до таблицы и что выгруженный уходит из
   неё без следа. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var store = require('../../kojipatch/assets/js/store.js');

var UI = require.resolve('../../kojipatch/assets/js/ui.js');

function patch(name, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls, cves: [],
           web_url: null };
}

function build(name, over) {
  over = over || {};
  return { nvr: name + '-1.0-1.el9', name: name, version: '1.0',
           release: Object.prototype.hasOwnProperty.call(over, 'release')
             ? over.release : '1.el9',
           epoch: null, build_id: 1, task_id: 2, tag_name: null, tags: [],
           owner: 'builder', completed: '2026-05-14 10:00:00', source: null,
           patch_dir_present: true, patches: over.patches || [],
           rpms: ['a.x86_64'], problems: [] };
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

/* Кнопки панели источников скрипт рисует через innerHTML, а заглушка
   разметку из строк не разбирает. Ставим такую же кнопку настоящим узлом:
   проверяется делегированный обработчик, а не то, как браузер её отрисует. */
function pressInList(dom, name, value) {
  var node = dom.document.createElement('button');
  node.setAttribute(name, value);
  dom.id('sourcelist').appendChild(node);
  dom.fire(node, 'click', {});
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
  assert.strictEqual(heads.length, 12);
  for (i = 0; i < heads.length; i++) {
    assert.ok(heads[i].querySelector('.arrow'),
              'у колонки ' + heads[i].getAttribute('data-sort') + ' нет стрелки');
  }
  assert.ok(dom.id('tab-state').querySelector('.tablewrap'));
  assert.ok(dom.id('tab-diff').querySelector('.tablewrap'));
});

test('снапшот из прелюдии сразу оказывается в хранилище', function () {
  var dom = load({ snapshots: [snap('os-9.1', '2026-07-01T00:00:00+03:00')] });
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(dom.id('tab-empty').hidden, true);
  assert.strictEqual(dom.document.querySelector('.tabs').hidden, false);
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1,
            dom.id('state-rows').innerHTML);
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
  assert.ok(dom.id('pair-select').innerHTML.indexOf('os-9.1') !== -1);
});

test('стрелка в списке источников разворачивает сравнение', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  pressInList(dom, 'data-move', '1:-1');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1']);
  var chain = dom.id('chain').innerHTML;
  assert.ok(chain.indexOf('os-9.2') < chain.indexOf('os-9.1'), chain);
  assert.ok(dom.id('pair-select').innerHTML.indexOf('os-9.2 → os-9.1') !== -1,
            dom.id('pair-select').innerHTML);
});

test('✕ убирает снапшот, и «Изменения» снова нечего показывать', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  pressInList(dom, 'data-drop-snap', '1');
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
  pressInList(dom, 'data-drop-snap', '0');
  assert.strictEqual(dom.id('tab-empty').hidden, false);
  assert.strictEqual(dom.id('tab-state').hidden, true);
  assert.strictEqual(dom.document.querySelector('.tabs').hidden, true);
  /* Шапка от ушедшего снапшота — три прочерка над зоной загрузки: так
     выглядит сломанная страница, а не пустая. */
  assert.strictEqual(dom.id('meta').innerHTML, '');
});

function pressedTag(html) {
  var m = /aria-pressed="true" data-tip="Снимок тега ([^ ]+) /.exec(html);
  return m ? m[1] : null;
}

test('выбранный тег держится именем, а не номером', async function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  /* Селектор тегов скрипт тоже рисует строкой — кнопку ставим узлом. */
  var pick = dom.document.createElement('button');
  pick.setAttribute('class', 'pick');
  pick.setAttribute('data-tag', '1');
  dom.id('tag-select').appendChild(pick);
  dom.fire(pick, 'click', {});
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.2');
  await dom.tick();
  dom.location.hash = '';        /* выбор должен держаться и без адреса */
  store.move(1, -1);             /* теперь последний в списке — os-9.1 */
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.2');
});

/* Кнопки селекторов скрипт тоже рисует строкой — ставим такую же узлом.
   Проверяется делегированный обработчик, а не отрисовка кнопки. */
function pressPick(dom, host, name, value) {
  var node = dom.document.createElement('button');
  node.setAttribute('class', 'pick');
  node.setAttribute(name, value);
  dom.id(host).appendChild(node);
  dom.fire(node, 'click', {});
}

function pressedPair(html) {
  var m = /data-pair="(\d+)" aria-pressed="true"/.exec(html);
  return m ? m[1] : null;
}

/* Два прогона одного тега — самый частый способ сравнения: «тот же тег
   месяц назад против сегодняшнего». Различать их дашборд обязан не глазами
   человека, а сам: по тегу и времени сбора. */
var JUL = '2026-07-01T00:00:00+03:00';
var AUG = '2026-08-01T00:00:00+03:00';
var SEP = '2026-09-01T00:00:00+03:00';

test('выбор снапшота держится тегом и временем сбора', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-06-01T00:00:00+03:00',
                  { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', JUL, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('httpd')] })], 'c.json');
  pressPick(dom, 'tag-select', 'data-tag', '1');   /* os-9.2 от 1 июля */
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
  pressPick(dom, 'tag-select', 'data-tag', '0');
  assert.ok(dom.location.hash.indexOf(encodeURIComponent('os-9.2@' + JUL)) !== -1,
            dom.location.hash);
});

test('ссылка со временем сбора открывает тот же прогон', async function () {
  var dom = load();
  store.add([snap('os-9.2', JUL, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.2', AUG, { builds: [build('httpd')] })], 'c.json');
  pressPick(dom, 'tag-select', 'data-tag', '1');   /* открыт августовский */
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

test('одинаковые теги видно по датам в цепочке и в селекторе', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  var chain = dom.id('chain').innerHTML;
  assert.ok(/class="when">2026-07-01</.test(chain), chain);
  assert.ok(/class="when">2026-08-01</.test(chain), chain);
  var picks = dom.id('tag-select').innerHTML;
  assert.ok(/class="sub">2026-07-01/.test(picks), picks);
  assert.ok(/class="sub">2026-08-01/.test(picks), picks);
  /* В шапке «теги: os-9.2, os-9.2» выглядит опечаткой, а не двумя прогонами. */
  assert.ok(/теги:<\/b> os-9\.2 \(2026-07-01\), os-9\.2 \(2026-08-01\)/
              .test(dom.id('meta').innerHTML), dom.id('meta').innerHTML);
});

test('у разных тегов даты в подписи нет — она там шум', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.strictEqual(dom.id('chain').innerHTML.indexOf('class="when"'), -1,
                     dom.id('chain').innerHTML);
  /* В селекторе дата остаётся только в подсказке, а не в подписи кнопки. */
  assert.ok(!/class="sub">2026-/.test(dom.id('tag-select').innerHTML),
            dom.id('tag-select').innerHTML);
});

test('в селекторе пар одинаковые теги тоже подписаны датой', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  var picks = dom.id('pair-select').innerHTML;
  assert.ok(/class="when">2026-07-01</.test(picks), picks);
  assert.ok(/class="when">2026-08-01</.test(picks), picks);
});

test('у разных тегов в селекторе пар даты нет', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL)], 'a.json');
  store.add([snap('os-9.2', AUG)], 'b.json');
  assert.strictEqual(dom.id('pair-select').innerHTML.indexOf('class="when"'), -1,
                     dom.id('pair-select').innerHTML);
});

test('пары одинаковых тегов различимы в адресе', function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  store.add([snap('os-9.2', SEP)], 'd.json');
  pressPick(dom, 'pair-select', 'data-pair', '0');
  var first = dom.location.hash;
  pressPick(dom, 'pair-select', 'data-pair', '1');
  assert.notStrictEqual(first, dom.location.hash,
                        'у двух разных переходов один и тот же адрес: ' + first);
});

test('ссылка на пару открывает тот же переход', async function () {
  var dom = load();
  store.add([snap('os-9.2', JUL)], 'b.json');
  store.add([snap('os-9.2', AUG)], 'c.json');
  store.add([snap('os-9.2', SEP)], 'd.json');
  pressPick(dom, 'pair-select', 'data-pair', '0');
  var link = dom.location.hash;
  pressPick(dom, 'pair-select', 'data-pair', '2');
  await dom.tick();
  dom.location.hash = link;
  dom.fireWindow('hashchange');
  assert.strictEqual(pressedPair(dom.id('pair-select').innerHTML), '0',
                     dom.id('pair-select').innerHTML);
});

test('файл роняют на страницу — снапшот загружается', async function () {
  var dom = load();
  var text = JSON.stringify([snap('os-9.1', '2026-07-01T00:00:00+03:00')]);
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', text)] } });
  await dom.tick();
  assert.strictEqual(store.list().length, 1);
  assert.strictEqual(dom.id('load-errors').innerHTML, '');
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
  assert.ok(dom.id('load-errors').innerHTML.indexOf('bad.json') !== -1,
            dom.id('load-errors').innerHTML);
  assert.strictEqual(store.list().length, 1);
  assert.ok(dom.id('chain').innerHTML.indexOf('os-9.1') !== -1);
});

test('ошибку загрузки видно и когда дашборд уже не пуст', async function () {
  var dom = load();
  var good = JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00'));
  dom.fire(dom.id('drop'), 'drop',
           { dataTransfer: { files: [domstub.file('a.json', good)] } });
  await dom.tick();
  /* Зона загрузки спрятана, как только появились данные. Список ошибок
     внутри неё был бы невидим — и человек не узнал бы, что файл отвергнут. */
  var node = dom.id('load-errors'), empty = dom.id('tab-empty');
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
  assert.ok(dom.id('load-errors').innerHTML.indexOf('x.json') !== -1,
            dom.id('load-errors').innerHTML);
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
  assert.ok(dom.id('load-errors').innerHTML.indexOf('уже загружен') !== -1,
            dom.id('load-errors').innerHTML);
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
  assert.ok(dom.id('load-errors').innerHTML.indexOf('bad.json') !== -1,
            'причина не написана на экране: ' + dom.id('load-errors').innerHTML);
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

test('негодная прелюдия объясняется, а не пропадает молча', function () {
  /* Снапшот, запечённый сборщиком, проходит тот же путь через хранилище и
     так же может не отрисоваться. Пустая страница без единого слова о том,
     почему она пуста, — не ответ. */
  var dom = load({ snapshots: [{ schema: 1, tag: 't',
                                 generated: '2026-08-01T00:00:00+03:00',
                                 builds: [null] }] });
  assert.strictEqual(store.list().length, 0);
  assert.strictEqual(dom.id('tab-empty').hidden, false);
  assert.ok(dom.id('load-errors').innerHTML.indexOf('встроено в файл') !== -1,
            dom.id('load-errors').innerHTML);
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
  assert.ok(dom.id('load-errors').innerHTML.indexOf('bad.json') !== -1,
            dom.id('load-errors').innerHTML);
});

test('разные хабы — предупреждение на странице', function () {
  var dom = load();
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([other], 'b.json');
  assert.ok(dom.id('warnings').innerHTML.indexOf('хаба') !== -1,
            dom.id('warnings').innerHTML);
});

test('«изменить» раскрывает список источников', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var button = dom.id('edit-sources');
  assert.strictEqual(dom.id('sourcelist').hidden, true);
  dom.fire(button, 'click', {});
  assert.strictEqual(dom.id('sourcelist').hidden, false);
  assert.strictEqual(button.getAttribute('aria-expanded'), 'true');
  dom.fire(button, 'click', {});
  assert.strictEqual(dom.id('sourcelist').hidden, true);
  assert.strictEqual(button.getAttribute('aria-expanded'), 'false');
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
  assert.strictEqual(dom.id('chips').innerHTML, '',
                     'фильтр класса из выгруженного снапшота остался живым');
});

test('версии нет — в таблице прочерк, а не пустота', function () {
  var dom = load();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00',
                  { builds: [build('nginx', { release: null })] })], 'a.json');
  var html = dom.id('state-rows').innerHTML;
  assert.ok(/<td class="ver">\s*<span class="none">—<\/span>/.test(html), html);
});
