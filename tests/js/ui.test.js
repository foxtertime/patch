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

function has(over, key) {
  return Object.prototype.hasOwnProperty.call(over, key);
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
  assert.ok(dom.id('chips').innerHTML.indexOf('sast') !== -1,
            dom.id('chips').innerHTML);
  store.remove(0);
  store.add([snap('os-9.2', AUG,
                  { classes: ['CVE'],
                    builds: [build('nginx', { patches: [patch('c.patch', 'CVE')] })] })],
            'b.json');
  await dom.tick();
  assert.strictEqual(dom.id('chips').innerHTML, '',
                     'фильтр класса из выгруженного снапшота остался живым');
  assert.ok(dom.id('state-rows').innerHTML.indexOf('nginx') !== -1,
            'таблица пуста под фильтр, которого нет ни на одной карточке: '
            + dom.id('state-rows').innerHTML);
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
   «sast · sast» в чипе. */
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
  assert.strictEqual(dom.id('chips').innerHTML, '',
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
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.3',
                     dom.id('tag-select').innerHTML);
  /* Пар три: os-9.1→os-9.2, os-9.2→os-9.3 и сводная os-9.1→os-9.3. */
  assert.strictEqual(pressedPair(dom.id('pair-select').innerHTML), '2',
                     dom.id('pair-select').innerHTML);
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
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.3',
                     dom.id('tag-select').innerHTML);
  assert.strictEqual(pressedPair(dom.id('pair-select').innerHTML), '2',
                     dom.id('pair-select').innerHTML);
});

test('свежий снапшот выбирается и когда файл пришёл вторым', function () {
  /* Порядок цепочки задаёт время сбора, а не порядок загрузки: последним
     в списке стоит августовский, его и надо открыть. */
  var dom = load();
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.2',
                     dom.id('tag-select').innerHTML);
});

test('выбранный человеком снапшот переживает приход нового файла',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('apache')] })], 'b.json');
  pressPick(dom, 'tag-select', 'data-tag', '0');   /* явный выбор: os-9.1 */
  await dom.tick();
  store.add([snap('os-9.3', SEP, { builds: [build('httpd')] })], 'c.json');
  await dom.tick();
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.1',
                     dom.id('tag-select').innerHTML);
});

test('выбранный человеком переход переживает приход нового файла',
     async function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('nginx')] })], 'b.json');
  store.add([snap('os-9.3', SEP, { builds: [build('nginx')] })], 'c.json');
  pressPick(dom, 'pair-select', 'data-pair', '0');  /* явный выбор: 9.1→9.2 */
  await dom.tick();
  store.add([snap('os-9.4', '2026-10-01T00:00:00+03:00',
                  { builds: [build('nginx')] })], 'd.json');
  await dom.tick();
  assert.strictEqual(pressedPair(dom.id('pair-select').innerHTML), '0',
                     dom.id('pair-select').innerHTML);
});

test('выбранный снапшот убрали — снова открывается самый свежий', function () {
  var dom = load();
  store.add([snap('os-9.1', JUL, { builds: [build('nginx')] })], 'a.json');
  store.add([snap('os-9.2', AUG, { builds: [build('apache')] })], 'b.json');
  store.add([snap('os-9.3', SEP, { builds: [build('httpd')] })], 'c.json');
  pressPick(dom, 'tag-select', 'data-tag', '0');
  store.remove(0);
  assert.strictEqual(pressedTag(dom.id('tag-select').innerHTML), 'os-9.3',
                     dom.id('tag-select').innerHTML);
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
    assert.match(dom.id('load-errors').innerHTML, /os-9\.2/,
                 'человеку должны сказать, что именно отвергнуто');
    assert.strictEqual(store.list().length, 1, 'цепочка не удвоилась');

    t.mock.timers.tick(30000);
    assert.strictEqual(dom.id('load-errors').innerHTML, '',
                       'сообщение обязано уйти само');
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
    assert.match(dom.id('load-errors').innerHTML, /b\.json/,
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
    assert.strictEqual(chain.split('class="stop').length - 1, 3,
                       'три узла на рельсе: ' + chain);
    /* Отмечен ровно один, и это свежий снапшот — тот, что открывается по
       умолчанию. Отрезки на «Состоянии» не подсвечиваются: сравнение
       живёт на другой вкладке. */
    assert.strictEqual(chain.split('class="stop on"').length - 1, 1, chain);
    assert.ok(chain.indexOf('class="stop on"') > chain.indexOf('os-9.2'),
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
    assert.strictEqual(chain.split('class="stop on"').length - 1, 2,
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
