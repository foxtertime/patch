'use strict';
var test = require('node:test');
var assert = require('node:assert');
var store = require('../../dashboard/assets/js/store.js');

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

/* Схема 2 отличается от первой только тем, что проблема в ней объект с
   уровнем, а не строка: разбирать умеет и то, и другое, поэтому старые
   файлы страница читает наравне с новыми. */
test('снапшот прежней схемы читается наравне с нынешним', function () {
  var old = snap('os-9.1', '2026-07-01T00:00:00+03:00');
  old.schema = 1;
  old.builds = [{ name: 'nginx', nvr: 'nginx-1-1', problems: ['gitlab: 500'] }];
  var out = store.parseText(JSON.stringify(old), 'a.json');
  assert.strictEqual(out.ok, true, out.error);
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

test('снапшот, на котором падает отрисовка, в хранилище не остаётся', function () {
  /* Проверка при загрузке нарочно неглубокая, и негодный внутри снапшот её
     проходит: builds: [null] — это массив, значит «снапшот». Падает уже
     отрисовка, то есть подписчик. Без отката такой снапшот оставался бы в
     хранилище, а страница — недорисованной: убрать его было бы нечем. */
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  var seen = [];
  store.onChange(function () {
    seen.push(store.list().length);
    if (store.list().length > 1) {
      throw new TypeError("Cannot read properties of null (reading 'patches')");
    }
  });
  var out = store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  assert.strictEqual(out.added, 0);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1']);
  assert.strictEqual(out.rejected.length, 1);
  assert.match(out.rejected[0], /b\.json/);
  assert.match(out.rejected[0], /patches/, 'причина отказа потеряна');
  /* Подписчика позвали второй раз — на прежнем составе, иначе страница
     осталась бы с полурисованными данными отвергнутого снапшота. */
  assert.deepStrictEqual(seen, [2, 1]);
});

test('падение отрисовки при перестановке откатывается и объясняется', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.onChange(function () {
    if (store.list()[0].tag === 'os-9.2') throw new Error('пара не рисуется');
  });
  store.move(1, -1);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1', 'os-9.2']);
  /* У перестановки нет своего места для ошибок, поэтому причина уходит
     в предупреждения — они на странице видны всегда. */
  assert.match(store.warnings().join(' '), /пара не рисуется/);
});

test('удачная перестановка убирает предупреждение о неудачной', function () {
  /* Предупреждение об откате говорит о том порядке, которого на странице
     нет. Пережив удачную перестановку, оно висело бы над новым и
     правильным порядком и врало бы про него. */
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  var refuse = true;
  store.onChange(function () {
    if (refuse && store.list()[0].tag === 'os-9.2') throw new Error('не рисуется');
  });
  store.move(1, -1);
  assert.strictEqual(store.warnings().length, 1);
  refuse = false;
  store.move(1, -1);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.2', 'os-9.1']);
  assert.deepStrictEqual(store.warnings(), []);
});

test('вторая неудачная перестановка не копит вторую строку', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.onChange(function () {
    if (store.list()[0].tag === 'os-9.2') throw new Error('не рисуется');
  });
  store.move(1, -1);
  store.move(1, -1);
  store.move(1, -1);
  assert.strictEqual(store.warnings().length, 1, store.warnings().join(' | '));
});

function withBuild(tag, generated, over, refKind) {
  var s = snap(tag, generated);
  s.builds = [Object.assign({ nvr: 'n-1-1', name: 'n', version: '1',
                              release: '1',
                              source: { raw: 'git+https://gl/g/n#origin/br',
                                        ref: 'br',
                                        ref_kind: refKind || 'branch' } },
                            over || {})];
  return s;
}

test('снапшоты разных видов — предупреждение', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'b.json');
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /коммит/);
});

test('снапшоты одного вида (коммит) — тишина', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'def456' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('снапшоты одного вида (ветка) — тишина', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('снапшоты без patches_ref в счёт не идут', function () {
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('patches_ref есть, а source отсутствует вовсе — режим неизвестен', function () {
  /* Без source сравнивать patches_ref не с чем: билд не «коммитный» по
     умолчанию, а неизвестного вида, ровно как билд без patches_ref. Если
     бы это было не так, пара со вторым снапшотом, у которого патчи
     честно сняты с ветки, ложно поднимала бы предупреждение. */
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'abc123', source: undefined })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'b.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('source есть, но ref в нём null — patches_ref-хеш всё равно коммит', function () {
  /* source.ref == null законно значит «URL источника без фрагмента» — это
     не то же самое, что отсутствие самого source. Сравнение здесь
     состоятельно: непустой patches_ref не совпадает с null, и билд верно
     считается «коммитным», а не неизвестным. */
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'abc123',
                         source: { raw: 'git+https://gl/g/n',
                                   ref: null, ref_kind: null } })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'b.json');
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /коммит/);
});

test('одинокий from-commit билд не поднимает предупреждение о смешанных видах', function () {
  /* ref_kind: 'commit' — билд собран прямо с коммита, у него нет ветки
     вовсе, и source.ref равен тому же коммиту, что и patches_ref: это
     самый точный источник патчей, а не старая семантика вершины ветки. */
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'abc123',
                         source: { raw: 'git+ssh://gl/g/n#abc123',
                                   ref: 'abc123', ref_kind: 'commit' } })],
            'a.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('обычный билд и from-commit билд в одном снапшоте — не смешанные виды', function () {
  /* Воспроизведение находки ревью: снапшот с одним from-commit билдом и
     одним обычным (ветка, но хеш известен — patches_ref указывает на
     коммит, а не на имя ветки) не должен поднимать предупреждение сам по
     себе. До фикса ref === source.ref у from-commit билда (оба — тот же
     самый коммит) ошибочно читалось как «снят с вершины ветки». */
  store.reset();
  var s = withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                    { patches_ref: 'commit1' });
  s.builds.push(Object.assign({}, s.builds[0], { nvr: 'm-1-1', name: 'm',
    patches_ref: 'commit2',
    source: { raw: 'git+ssh://gl/g/m#commit2',
              ref: 'commit2', ref_kind: 'commit' } }));
  store.add([s], 'a.json');
  assert.deepStrictEqual(store.warnings(), []);
});

test('настоящая вершина ветки рядом с from-commit билдом — предупреждение остаётся', function () {
  /* Фикс не должен затыкать честное предупреждение: если рядом с
     from-commit билдом лежит билд, у которого патчи и правда сняты с
     вершины ветки (хеша не было), виды действительно разные. */
  store.reset();
  var s = withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                    { patches_ref: 'br' }); /* ref_kind branch, ref === patches_ref */
  s.builds.push(Object.assign({}, s.builds[0], { nvr: 'm-1-1', name: 'm',
    patches_ref: 'commit2',
    source: { raw: 'git+ssh://gl/g/m#commit2',
              ref: 'commit2', ref_kind: 'commit' } }));
  store.add([s], 'a.json');
  assert.strictEqual(store.warnings().length, 1);
  assert.match(store.warnings()[0], /коммит/);
});

test('предупреждение о смешанных видах говорит про билды, а не только про снапшоты', function () {
  /* Формулировка не должна утверждать «в одних снапшотах … в других»: смесь
     бывает и внутри одного и того же снапшота (см. тест выше), и текст
     обязан оставаться верным для обоих случаев. */
  store.reset();
  store.add([withBuild('os-9.1', '2026-07-01T00:00:00+03:00',
                       { patches_ref: 'br' })], 'a.json');
  store.add([withBuild('os-9.2', '2026-08-01T00:00:00+03:00',
                       { patches_ref: 'abc123' })], 'b.json');
  assert.match(store.warnings()[0], /билд/);
  assert.doesNotMatch(store.warnings()[0], /снапшоты двух видов/);
});

test('удаление, на котором падает отрисовка, откатывается', function () {
  store.reset();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.onChange(function () {
    if (store.list().length === 1) throw new Error('один снапшот не рисуется');
  });
  store.remove(0);
  assert.deepStrictEqual(store.list().map(function (i) { return i.tag; }),
                         ['os-9.1', 'os-9.2']);
  assert.match(store.warnings().join(' '), /один снапшот не рисуется/);
});
