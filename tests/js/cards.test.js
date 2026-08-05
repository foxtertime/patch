'use strict';
/* Карточки-счётчики и чипы. Раньше они сами лезли в document за своими
   узлами, и позвать их в тесте было нельзя; теперь они возвращают строку. */
var test = require('node:test');
var assert = require('node:assert');
var labels = require('../../dashboard/assets/js/labels.js');
var cards = require('../../dashboard/assets/js/cards.js');

function snapshot(over) {
  over = over || {};
  return { tag: over.tag || 'os-9.2',
           builds: over.builds || [{ rpms: ['a.x86_64', 'b.x86_64'] }],
           counts: Object.assign({
             builds: 1, with_patches: 1, patch_files: 3, inherited: 0,
             direct: 1, problems: 0, without_patches: 0,
             by_class: { CVE: { builds: 1, files: 3 } }
           }, over.counts || {}) };
}

function pair(over) {
  over = over || {};
  return { rows: over.rows || [{}, {}],
           counts: Object.assign({
             changed: 1, added: 0, removed: 0, upgraded: 1, downgraded: 0,
             unchanged: 0, patches_added: 0, patches_removed: 0,
             repackaged: 0, branch_changed: 0, tag_changed: 0
           }, over.counts || {}) };
}

test('без снапшота карточек нет', function () {
  assert.deepStrictEqual(cards.stateCards(null), { big: '', classes: '' });
});

test('без пары карточек диффа нет', function () {
  assert.strictEqual(cards.diffCards(null), '');
});

test('большие карточки — кнопки со своим фильтром', function () {
  var out = cards.stateCards(snapshot()).big;
  assert.match(out, /data-filter="all"/);
  assert.match(out, /data-filter="has-patch"/);
  assert.match(out, /data-filter="inherited"/);
  assert.match(out, /data-filter="problem"/);
});

test('карточка «в теге» считает RPM по всем сборкам', function () {
  var out = cards.stateCards(snapshot()).big;
  assert.match(out, /<div class="rpm">2 RPM<\/div>/);
});

test('счётчик склоняется вместе с числом', function () {
  var one = cards.stateCards(snapshot({ counts: { builds: 1 } })).big;
  var few = cards.stateCards(snapshot({ counts: { builds: 3 } })).big;
  assert.match(one, /<span class="unit">сборка<\/span>/);
  assert.match(few, /<span class="unit">сборки<\/span>/);
});

test('карточка класса патчей красится его цветом', function () {
  labels.setClasses(['CVE']);
  var out = cards.stateCards(snapshot()).classes;
  assert.match(out, /data-filter="cve"/);
  assert.match(out, /class="l c-cve"/);
});

test('класс с именем constructor не роняет карточки', function () {
  labels.setClasses(['constructor']);
  var out = cards.stateCards(snapshot({
    counts: { by_class: { constructor: { builds: 1, files: 1 } } } })).classes;
  assert.match(out, /data-filter="constructor"/);
  assert.match(out, /class="l c-x"/);
});

test('карточки диффа перечисляют все одиннадцать срезов', function () {
  var out = cards.diffCards(pair());
  var found = out.match(/data-filter="/g) || [];
  assert.strictEqual(found.length, 11);
  assert.match(out, /data-filter="patches\+"/);
  assert.match(out, /data-filter="tag-changed"/);
});

test('карточка диффа подписана «из скольких»', function () {
  assert.match(cards.diffCards(pair()), /<span class="unit">из 2<\/span>/);
});

test('чип несёт ключ фильтра и его подпись', function () {
  var out = cards.chips({ 'no-patch': 1 });
  assert.match(out, /data-chip="no-patch"/);
  assert.match(out, /нет каталога PATCH/);
});

test('один фильтр обходится без кнопки сброса', function () {
  assert.doesNotMatch(cards.chips({ 'no-patch': 1 }), /сбросить всё/);
});

test('второй фильтр добавляет кнопку сброса', function () {
  assert.match(cards.chips({ 'no-patch': 1, 'inherited': 1 }), /сбросить всё/);
});

test('без фильтров чипов нет вовсе', function () {
  assert.strictEqual(cards.chips({}), '');
});
