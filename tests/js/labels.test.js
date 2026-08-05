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
