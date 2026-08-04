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

/* Проверяет обе стороны сравнения разом — как check() в
   tests/test_rpmvercmp.py: rpmvercmp должен быть антисимметричен. */
function check(a, b, expected) {
  /* assert.strictEqual сравнивает через Object.is, а он различает 0 и -0;
     унарный минус нуля даёт -0, поэтому нуль обрабатываем отдельно. */
  assert.strictEqual(vercmp.rpmvercmp(a, b), expected, a + ' vs ' + b);
  assert.strictEqual(vercmp.rpmvercmp(b, a), expected === 0 ? 0 : -expected, b + ' vs ' + a);
}

test('лишние нули в начале сегмента не учитываются', function () {
  check('1.007', '1.7', 0);
});

test('цифры весомее букв', function () {
  check('1.1', '1.a', 1);
});

test('буквенный суффикс больше версии без него', function () {
  check('1.0a', '1.0', 1);
});

test('разделители взаимозаменяемы', function () {
  check('1.0.1', '1_0-1', 0);
});

test('каретка сортируется после голой версии, но перед следующей', function () {
  check('1.0^20240101', '1.0', 1);
  check('1.0.1', '1.0^20240101', 1);
});

test('пустые строки', function () {
  assert.strictEqual(vercmp.rpmvercmp('', ''), 0);
  assert.strictEqual(vercmp.rpmvercmp('1', ''), 1);
  assert.strictEqual(vercmp.rpmvercmp('', '1'), -1);
});

/* str.isdigit() в Python шире, чем \d: «²» (надстрочная двойка) — цифра
   по isdigit(), но не по \d. Наивный порт либо падает, либо зацикливается
   на таком символе. */
var SUP = '²'; // надстрочная двойка «²»
var CUBE = '³'; // надстрочная тройка «³»

test('псевдоцифра против цифры не роняет и не зацикливает', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.' + SUP, '1.2'), -1);
  assert.strictEqual(vercmp.rpmvercmp('1.2', '1.' + SUP), 1);
});

test('псевдоцифра против буквы не роняет и не зацикливает', function () {
  assert.ok(Number.isInteger(vercmp.rpmvercmp(SUP, 'a')));
  assert.ok(Number.isInteger(vercmp.rpmvercmp('a', SUP)));
});

test('две псевдоцифры не подвешивают цикл', function () {
  assert.ok(Number.isInteger(vercmp.rpmvercmp(SUP, CUBE)));
  assert.strictEqual(vercmp.rpmvercmp(SUP, SUP), 0);
});

test('сравнение антисимметрично и на псевдоцифре', function () {
  assert.strictEqual(vercmp.rpmvercmp('1.' + SUP, '1.2'),
                      -vercmp.rpmvercmp('1.2', '1.' + SUP));
});

test('compareEvr с псевдоцифрой не роняет', function () {
  assert.ok(Number.isInteger(
    vercmp.compareEvr([null, '1.' + SUP, '1.el9'], [null, '1.2', '1.el9'])));
});

test('release решает исход при равных version', function () {
  assert.strictEqual(
    vercmp.compareEvr([null, '1.0', '2.el9'], [null, '1.0', '1.el9']), 1);
});

test('epoch важнее version', function () {
  assert.strictEqual(
    vercmp.compareEvr([1, '1.0', '1'], [null, '9.0', '1']), 1);
});

test('отсутствующий epoch равен нулю', function () {
  assert.strictEqual(
    vercmp.compareEvr([null, '1.0', '1'], [0, '1.0', '1']), 0);
});

test('полное равенство evr', function () {
  assert.strictEqual(
    vercmp.compareEvr([0, '1.0', '1.el9'], [0, '1.0', '1.el9']), 0);
});
