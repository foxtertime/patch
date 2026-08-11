'use strict';
/* Подписи: то, чем страница называет ключи из данных. Классы патчей задаёт
   конфиг, поэтому здесь важнее всего, что незнакомое имя не ломает страницу
   и не переживает свой снапшот. */
var test = require('node:test');
var assert = require('node:assert');
var labels = require('../../dashboard/assets/js/labels.js');

test('постоянные подписи знают ключи фильтров', function () {
  assert.strictEqual(labels.label('no-patch'), 'нет каталога PATCH');
  assert.strictEqual(labels.label('changed'), 'что-то изменилось');
});

test('незнакомый ключ отвечает сам собой', function () {
  assert.strictEqual(labels.label('чего-то-этакое'), 'чего-то-этакое');
});

test('класс патчей с именем constructor не отвечает функцией', function () {
  labels.setClasses(['constructor']);
  assert.strictEqual(labels.label('constructor'), 'патчи constructor');
  assert.strictEqual(labels.classCls('constructor'), 'c-x');
});

test('подпись класса берётся по тому же slug, что стоит в метке', function () {
  labels.setClasses(['CVE']);
  assert.strictEqual(labels.label('cve'), 'патчи CVE');
});

test('смена набора снапшотов уносит подписи прежних классов', function () {
  labels.setClasses(['CVE']);
  labels.setClasses(['SAST']);
  assert.strictEqual(labels.label('cve'), 'cve');
  assert.strictEqual(labels.label('sast'), 'патчи SAST');
});

test('знакомый класс красится своим цветом, незнакомый — общим', function () {
  assert.strictEqual(labels.classCls('CVE'), 'c-cve');
  assert.strictEqual(labels.classCls('distsuffix'), 'c-distsuffix');
  assert.strictEqual(labels.classCls('C++'), 'c-x');
});

test('порядок классов — сперва как перечислил классификатор', function () {
  labels.setClasses(['CVE', 'SAST', 'other']);
  assert.deepStrictEqual(labels.classOrder({ other: 1, CVE: 2 }),
                         ['CVE', 'other']);
});

test('класс из данных, которого нет в списке, идёт следом по алфавиту',
  function () {
    labels.setClasses(['CVE']);
    assert.deepStrictEqual(labels.classOrder({ zzz: 1, CVE: 1, aaa: 1 }),
                           ['CVE', 'aaa', 'zzz']);
  });

test('группы «Состояния» перечислены в порядке показа', function () {
  labels.setClasses([]);
  var ids = labels.groups('state').map(function (g) { return g.id; });
  assert.deepStrictEqual(ids, ['build', 'trouble'],
                         'группа классов пуста и в список не попадает');
});

test('живые классы становятся группой', function () {
  labels.setClasses(['CVE', 'SAST']);
  var g = labels.groups('state')[0];
  assert.strictEqual(g.id, 'classes');
  assert.strictEqual(g.label, 'классы патчей');
  assert.deepStrictEqual(g.keys, ['cve', 'sast']);
});

test('класс уходит из группы вместе со своим снапшотом', function () {
  labels.setClasses(['CVE']);
  labels.setClasses([]);
  var ids = labels.groups('state').map(function (g) { return g.id; });
  assert.strictEqual(ids.indexOf('classes'), -1);
});

test('группы «Изменений» — статус и что изменилось', function () {
  labels.setClasses(['CVE']);
  var ids = labels.groups('diff').map(function (g) { return g.id; });
  assert.deepStrictEqual(ids, ['status', 'change']);
  /* Классов патчей у строки диффа нет: viewmodel их туда не кладёт, и
     группа классов на этой вкладке показывала бы фильтр, под который не
     попадает ни одна строка. */
  assert.strictEqual(ids.indexOf('classes'), -1);
});

test('branch-ahead подписан и лежит в группе свойств билда', function () {
  assert.strictEqual(labels.label('branch-ahead'), 'ветка ушла вперёд');
  var build = labels.groups('state').filter(function (g) {
    return g.id === 'build';
  })[0];
  assert.ok(build.keys.indexOf('branch-ahead') !== -1);
});

test('patches~ подписан и лежит в группе изменений', function () {
  assert.strictEqual(labels.label('patches~'), 'патчи переписаны');
  var change = labels.groups('diff').filter(function (g) {
    return g.id === 'change';
  })[0];
  assert.ok(change.keys.indexOf('patches~') !== -1);
});

test('каждый ключ группы называется по-русски', function () {
  labels.setClasses([]);
  ['state', 'diff'].forEach(function (tab) {
    labels.groups(tab).forEach(function (group) {
      group.keys.forEach(function (key) {
        assert.notStrictEqual(labels.label(key), key,
                              'ключ ' + key + ' без подписи');
      });
    });
  });
});

/* Проблема приезжает строкой «источник: что случилось», и страница режет её
   надвое: подпись блока и текст под ней. */
test('проблема делится по первому двоеточию, источник переводится',
  function () {
    var p = labels.problem('gitlab: ветка os-9.6 не найдена');
    assert.deepStrictEqual(p, { title: 'GitLab',
                                text: 'ветка os-9.6 не найдена',
                                known: true });
  });

test('двоеточие внутри текста проблему не делит второй раз', function () {
  var p = labels.problem("internal error: KeyError: 'source'");
  assert.strictEqual(p.title, 'внутренняя ошибка');
  assert.strictEqual(p.text, "KeyError: 'source'");
});

test('строка без двоеточия — знакомый источник целиком', function () {
  var p = labels.problem('no source url');
  assert.deepStrictEqual(p, { title: 'нет ссылки на источник', text: '',
                              known: true });
});

/* Снапшот собран версией, которая знает тип проблемы, а страница — нет:
   показать её техническим именем честнее, чем промолчать. Подписью тогда
   идут данные, и это помечено known: false — подсвечивать поиском можно
   только их. */
test('незнакомый источник идёт в подпись как есть', function () {
  var p = labels.problem('mock: сборка не воспроизводится');
  assert.deepStrictEqual(p, { title: 'mock',
                              text: 'сборка не воспроизводится',
                              known: false });
});

test('строка, которую нечем назвать, целиком идёт в текст', function () {
  var p = labels.problem('просто строка без источника');
  assert.deepStrictEqual(p, { title: '', text: 'просто строка без источника',
                              known: false });
});

/* Автоген обещает патчи класса, которых в билде нет: сбор пишет это
   предупреждение с префиксом autogen, и подпись у блока своя. */
test('автоген подписан по-русски', function () {
  var p = labels.problem('autogen: есть autogen-cve-patches.inc, но ни одного '
                         + 'патча класса CVE');
  assert.strictEqual(p.title, 'автоген');
  assert.strictEqual(p.known, true);
  assert.match(p.text, /^есть autogen-cve-patches\.inc/);
});
