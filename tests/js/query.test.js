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
