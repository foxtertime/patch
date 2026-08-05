'use strict';
/* Строковые считалки: их зовут из каждого куска разметки, и ошибка здесь
   уезжает сразу во все. */
var test = require('node:test');
var assert = require('node:assert');
var text = require('../../dashboard/assets/js/text.js');

test('экранируются все пять опасных знаков', function () {
  assert.strictEqual(text.esc('<a href="x" \'y\'>&'),
                     '&lt;a href=&quot;x&quot; &#39;y&#39;&gt;&amp;');
});

test('пустое значение — пустая строка, а не «null»', function () {
  assert.strictEqual(text.esc(null), '');
  assert.strictEqual(text.esc(undefined), '');
});

test('подсветка экранирует и то, что подсветила', function () {
  assert.strictEqual(text.hl('<b>ab</b>', 'b'),
    '&lt;<span class="hit">b</span>&gt;a<span class="hit">b</span>'
    + '&lt;/<span class="hit">b</span>&gt;');
});

test('без запроса подсветка — просто экранирование', function () {
  assert.strictEqual(text.hl('<b>', ''), '&lt;b&gt;');
});

test('ключ constructor не отвечает функцией Object', function () {
  assert.strictEqual(text.own({}, 'constructor'), undefined);
  assert.strictEqual(text.own({ constructor: 7 }, 'constructor'), 7);
});

test('склонение по русским правилам', function () {
  assert.strictEqual(text.plural(1, 'сборка', 'сборки', 'сборок'), 'сборка');
  assert.strictEqual(text.plural(3, 'сборка', 'сборки', 'сборок'), 'сборки');
  assert.strictEqual(text.plural(11, 'сборка', 'сборки', 'сборок'), 'сборок');
  assert.strictEqual(text.plural(21, 'сборка', 'сборки', 'сборок'), 'сборка');
  assert.strictEqual(text.plural(0, 'сборка', 'сборки', 'сборок'), 'сборок');
});

test('время сбора режется до минуты, а не разбирается', function () {
  assert.strictEqual(text.stampOf('2026-08-05T14:23:59+03:00'),
                     '2026-08-05 14:23');
  assert.strictEqual(text.stampOf(null), '');
});

test('расстояние между снапшотами берёт крупную единицу', function () {
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-09-01T00:00:00+03:00'), '2 мес');
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-07-11T00:00:00+03:00'), '10 дн');
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-07-01T05:00:00+03:00'), '5 ч');
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-07-01T00:30:00+03:00'), '30 мин');
});

test('порядок концов не важен: цепочку переставляют руками', function () {
  assert.strictEqual(text.gapLabel('2026-09-01T00:00:00+03:00',
                                   '2026-07-01T00:00:00+03:00'), '2 мес');
});

test('меньше минуты не подписывается вовсе', function () {
  assert.strictEqual(text.gapLabel('2026-07-01T00:00:00+03:00',
                                   '2026-07-01T00:00:30+03:00'), '');
});

test('неразобранное время не даёт подписи', function () {
  assert.strictEqual(text.gapLabel('никогда', '2026-07-01T00:00:00+03:00'), '');
});

test('в href пускают только http и относительный путь', function () {
  assert.strictEqual(text.safeUrl('javascript:alert(1)'), null);
  assert.strictEqual(text.safeUrl('//evil/x'), null);
  assert.strictEqual(text.safeUrl('/rel/x'), '/rel/x');
  assert.strictEqual(text.safeUrl('https://gitlab/x'), 'https://gitlab/x');
  assert.strictEqual(text.safeUrl(null), null);
});

test('slug сводит любое имя класса к одному ключу', function () {
  assert.strictEqual(text.slug('C++'), 'c-');
  assert.strictEqual(text.slug('CVE'), 'cve');
});

test('keys не приносит свойств прототипа', function () {
  assert.deepStrictEqual(text.keys({ a: 1 }).sort(), ['a']);
});

test('setFrom делает множество из списка', function () {
  assert.deepStrictEqual(text.setFrom(['a', 'b']), { a: 1, b: 1 });
  assert.deepStrictEqual(text.setFrom(null), {});
});
