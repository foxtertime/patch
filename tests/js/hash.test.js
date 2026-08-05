'use strict';
/* Строка адреса. Её правят руками и присылают в переписке, поэтому битые
   куски в ней — норма, а не исключение. Раньше разбор жил внутри страницы
   и проверялся только через неё целиком; теперь обе половины чистые. */
var test = require('node:test');
var assert = require('node:assert');
var hash = require('../../dashboard/assets/js/hash.js');

test('пустой адрес не говорит ни о чём', function () {
  assert.deepStrictEqual(hash.parse(''),
    { tab: null, tag: null, pair: null, filters: null, q: null, sort: null });
  assert.deepStrictEqual(hash.parse('#'), hash.parse(''));
});

test('решётка в начале необязательна', function () {
  assert.strictEqual(hash.parse('#tab=diff').tab, 'diff');
  assert.strictEqual(hash.parse('tab=diff').tab, 'diff');
});

test('битый процент не уносит разбор целиком', function () {
  var out = hash.parse('#tab=diff&q=%zz&sort=name');
  assert.strictEqual(out.tab, 'diff');
  assert.strictEqual(out.q, null);
  assert.deepStrictEqual(out.sort, { key: 'name', asc: true });
});

test('незнакомый ключ просто пропускается', function () {
  assert.strictEqual(hash.parse('#чужое=1&tab=state').tab, 'state');
});

test('пустой f= значит «фильтров нет», а не «фильтров не было»', function () {
  assert.deepStrictEqual(hash.parse('#f=').filters, []);
  assert.strictEqual(hash.parse('#tab=state').filters, null);
});

test('фильтры приезжают списком', function () {
  assert.deepStrictEqual(hash.parse('#f=inherited,no-patch').filters,
                         ['inherited', 'no-patch']);
});

test('знак равенства внутри значения переживает разбор', function () {
  assert.strictEqual(hash.parse('#q=a%3Db').q, 'a=b');
});

test('запрос приводится к нижнему регистру и обрезается', function () {
  assert.strictEqual(hash.parse('#q=%20NGINX%20').q, 'nginx');
});

test('порядок сортировки по умолчанию — по возрастанию', function () {
  assert.deepStrictEqual(hash.parse('#sort=patches').sort,
                         { key: 'patches', asc: true });
  assert.deepStrictEqual(hash.parse('#sort=patches:desc').sort,
                         { key: 'patches', asc: false });
});

test('sort без имени колонки — не сортировка', function () {
  assert.strictEqual(hash.parse('#sort=').sort, null);
  assert.strictEqual(hash.parse('#sort=:desc').sort, null);
});

test('имя снапшота со временем сбора остаётся строкой', function () {
  assert.strictEqual(
    hash.parse('#tag=os-9.2%402026-07-01T00%3A00%3A00%2B03%3A00').tag,
    'os-9.2@2026-07-01T00:00:00+03:00');
});

test('f= пишется даже пустым', function () {
  assert.match(hash.format({ tab: 'state', tag: null, pair: null,
                             filters: [], q: '',
                             sort: { key: 'name', asc: true } }),
               /&f=&/);
});

test('пустой запрос в ссылку не пишется', function () {
  assert.doesNotMatch(hash.format({ tab: 'state', tag: null, pair: null,
                                    filters: [], q: '',
                                    sort: { key: 'name', asc: true } }),
                      /q=/);
});

test('сборка и разбор сходятся', function () {
  var parts = { tab: 'diff', tag: 'os-9.2@2026-07-01T00:00:00+03:00',
                pair: 'os-9.1@a..os-9.2@b', filters: ['changed'], q: 'nginx',
                sort: { key: 'name', asc: false } };
  var back = hash.parse(hash.format(parts));
  assert.strictEqual(back.tab, 'diff');
  assert.strictEqual(back.tag, parts.tag);
  assert.strictEqual(back.pair, parts.pair);
  assert.deepStrictEqual(back.filters, ['changed']);
  assert.strictEqual(back.q, 'nginx');
  assert.deepStrictEqual(back.sort, { key: 'name', asc: false });
});

test('амперсанд в запросе не рвёт ссылку надвое', function () {
  var out = hash.format({ tab: 'state', tag: null, pair: null, filters: [],
                          q: 'a&f=x', sort: { key: 'name', asc: true } });
  assert.strictEqual(hash.parse(out).q, 'a&f=x');
});
