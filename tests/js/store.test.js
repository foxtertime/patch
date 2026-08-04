'use strict';
var test = require('node:test');
var assert = require('node:assert');
var store = require('../../kojipatch/assets/js/store.js');

function snap(tag, generated) {
  return { schema: 1, tag: tag, generated: generated,
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: ['CVE', 'other'], builds: [] };
}

test('разбирает список снапшотов', function () {
  var out = store.parseText(JSON.stringify([snap('os-9.1', '2026-07-01T00:00:00+03:00')]), 'a.json');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.snapshots.length, 1);
});

test('разбирает одиночный снапшот-объект', function () {
  var out = store.parseText(JSON.stringify(snap('os-9.1', '2026-07-01T00:00:00+03:00')), 'a.json');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.snapshots[0].tag, 'os-9.1');
});

test('не JSON — понятная ошибка, а не исключение', function () {
  var out = store.parseText('{ сломано', 'a.json');
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /a\.json/);
});

test('чужая версия схемы отклоняется', function () {
  var bad = snap('os-9.1', '2026-07-01T00:00:00+03:00');
  bad.schema = 99;
  var out = store.parseText(JSON.stringify(bad), 'a.json');
  assert.strictEqual(out.ok, false);
  assert.match(out.error, /схем/);
});

test('объект без builds — не снапшот', function () {
  var out = store.parseText('{"schema": 1, "tag": "os-9.1"}', 'a.json');
  assert.strictEqual(out.ok, false);
});

test('снапшоты встают по времени сбора, а не по порядку загрузки', function () {
  store.reset();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1', 'os-9.2']);
});

test('ручная перестановка отменяет автосортировку', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.move(0, 1);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1']);
  store.add([snap('os-9.3', '2026-09-01T00:00:00+03:00')], 'c.json');
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1', 'os-9.3'],
                         'после ручной перестановки новый снапшот встаёт в конец');
});

test('точный дубликат отклоняется, повтор тега из другого прогона — нет', function () {
  store.reset();
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  var again = store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  assert.strictEqual(again.added, 0);
  assert.strictEqual(again.rejected.length, 1);
  var later = store.add([snap('os-9.2', '2026-08-02T00:00:00+03:00')], 'c.json');
  assert.strictEqual(later.added, 1);
  assert.strictEqual(store.list().length, 2);
});

test('разные хабы — предупреждение, но не отказ', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  var out = store.add([other], 'b.json');
  assert.strictEqual(out.added, 1);
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /хаб/);
});

test('удаление по номеру', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.remove(0);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2']);
});

test('подписчика зовут после изменения', function () {
  store.reset();
  var calls = 0;
  store.onChange(function () { calls += 1; });
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  assert.strictEqual(calls, 1);
});
