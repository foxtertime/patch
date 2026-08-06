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

/* Итоги перехода: стороны, разница и срок. Числа сторон берём у снапшотов,
   а не по строкам таблицы: строка — это компонент перехода, и компонент,
   которого на этой стороне нет, в ней всё равно стоит. */
function side(tag, generated, builds) {
  return { tag: tag, generated: generated, builds: [],
           counts: { builds: builds } };
}

test('без концов перехода итогов нет', function () {
  assert.strictEqual(cards.pairCards(pair(), null, null), '');
  assert.strictEqual(cards.pairCards(null, side('os-9.1', '', 1),
                                     side('os-9.2', '', 2)), '');
});

/* Четыре, как итоги тега на «Состоянии»: ряд из двух в ширину полосы не
   ложится ничем — либо узкие плашки и пустота справа, либо два числа,
   растянутые в плакат. */
test('итоги перехода — четыре большие карточки', function () {
  var out = cards.pairCards(pair(),
    side('os-9.1', '2026-07-01T00:00:00+03:00', 4),
    side('os-9.2', '2026-08-01T00:00:00+03:00', 6));
  assert.match(out, /class="l">было<\/div><div class="n">4 /, out);
  assert.match(out, /class="l">стало<\/div><div class="n">6 /, out);
  assert.strictEqual((out.match(/card big/g) || []).length, 4, out);
});

/* Фильтра у них нет: итог перехода — не срез таблицы, а то, между чем
   считали. Кнопка обещала бы клик, которому нечего делать. */
test('карточки итогов не кнопки', function () {
  var out = cards.pairCards(pair(), side('os-9.1', '', 1), side('os-9.2', '', 1));
  assert.strictEqual(out.indexOf('data-filter'), -1, out);
  assert.strictEqual(out.indexOf('<button'), -1, out);
});

/* Тега мало: два прогона одного тега — законный случай, и без времени сбора
   «было os-9.4 → стало os-9.4» не сказало бы, какой из них какой. */
test('под числом стороны стоят тег и время сбора', function () {
  var out = cards.pairCards(pair(),
    side('os-9.4', '2026-09-01T08:15:00+03:00', 6),
    side('os-9.4', '2026-10-01T09:00:00+03:00', 7));
  assert.match(out, /class="rpm">os-9\.4, 2026-09-01 08:15</, out);
  assert.match(out, /class="rpm">os-9\.4, 2026-10-01 09:00</, out);
});

test('разница считается со знаком и склоняется', function () {
  var more = cards.pairCards(pair(), side('a', '', 4), side('b', '', 6));
  assert.match(more, /class="n">\+2 <span class="unit">сборки</, more);
  var less = cards.pairCards(pair(), side('a', '', 6), side('b', '', 4));
  assert.match(less, /class="n">−2 <span class="unit">сборки</, less);
  var same = cards.pairCards(pair(), side('a', '', 4), side('b', '', 4));
  assert.match(same, /class="n">0 <span class="unit">сборок</, same);
});

/* Под разницей стоит то, из чего она сложилась: ноль в ней не значит
   «ничего не менялось» — сколько ушло, столько могло и прийти. */
test('под разницей стоят появившиеся и исчезнувшие', function () {
  var out = cards.pairCards(pair({ counts: { added: 3, removed: 3 } }),
    side('a', '', 4), side('b', '', 4));
  assert.match(out, /class="rpm">появилось 3, исчезло 3</, out);
});

/* Срок — та же мера, что подписывает отрезок рельса: одна вещь в двух
   местах должна называться одинаково. */
test('срок между сборами считается как на рельсе', function () {
  var out = cards.pairCards(pair(),
    side('a', '2026-07-01T00:00:00+03:00', 1),
    side('b', '2026-08-01T00:00:00+03:00', 1));
  assert.match(out, /class="n">31 <span class="unit">дн<\/span>/, out);
  assert.match(out, /class="l">срок<\/div>/, out);
});

/* Время бывает и непрочитанным: у снапшота старого формата его нет вовсе,
   и карточка должна остаться карточкой. */
test('нечитаемое время сбора не роняет срок', function () {
  var out = cards.pairCards(pair(), side('a', '', 1), side('b', 'никогда', 1));
  assert.match(out, /class="n">—<\/div>/, out);
});
