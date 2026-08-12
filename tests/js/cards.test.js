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
             direct: 1, problems: 0, warnings: 0, notes: 0,
             without_patches: 0,
             by_class: { CVE: { builds: 1, files: 3 } }
           }, over.counts || {}) };
}

/* Строка перехода несёт пять списков движения — по ним карточки «патчи» и
   «RPM» считают, сколько файлов сдвинулось. Пустые списки, а не отсутствие
   ключа: у настоящей строки они всегда есть, и подделка без них проверяла
   бы стойкость к данным, которых не бывает. */
function row(over) {
  over = over || {};
  return { patches_added: over.patches_added || [],
           patches_removed: over.patches_removed || [],
           patches_rewritten: over.patches_rewritten || [],
           rpms_added: over.rpms_added || [],
           rpms_removed: over.rpms_removed || [] };
}

function pair(over) {
  over = over || {};
  return { rows: over.rows || [row(), row()],
           counts: Object.assign({
             changed: 1, added: 0, removed: 0, upgraded: 1, downgraded: 0,
             unchanged: 0, patches_added: 0, patches_removed: 0,
             patches_rewritten: 0,
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

test('карточка «в теге» считает RPM по всем билдам', function () {
  var out = cards.stateCards(snapshot()).big;
  assert.match(out, /<div class="rpm">2 RPM<\/div>/);
});

test('счётчик склоняется вместе с числом', function () {
  var one = cards.stateCards(snapshot({ counts: { builds: 1 } })).big;
  var few = cards.stateCards(snapshot({ counts: { builds: 3 } })).big;
  assert.match(one, /<span class="unit">билд<\/span>/);
  assert.match(few, /<span class="unit">билда<\/span>/);
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

test('карточки диффа перечисляют все двенадцать срезов', function () {
  var out = cards.diffCards(pair());
  var found = out.match(/data-filter="/g) || [];
  assert.strictEqual(found.length, 12);
  assert.match(out, /data-filter="patches\+"/);
  assert.match(out, /data-filter="tag-changed"/);
});

test('ряд итогов считает переписанные патчи', function () {
  var out = cards.diffCards(pair({ counts: { patches_rewritten: 3 } }));
  assert.match(out, /data-filter="patches~"/);
  assert.match(out, /патчи переписаны/);
});

/* «3 из 105» не говорит, чего именно три: подпись под числом называет
   исход, а не меру. Мера — компоненты перехода, а не билды: у появившегося
   компонента билда нет в старом теге, у исчезнувшего — в новом. Слово
   стоит своей строкой, а не при «из»: одной строкой оно переносилось на
   узком окне. */
test('карточка диффа подписана «из скольких» и названа мерой', function () {
  var out = cards.diffCards(pair());
  assert.match(out, /<span class="unit">из 2<\/span>/);
  assert.match(out, /class="rpm">компонентов</);
  assert.match(cards.diffCards(pair({ rows: [row()] })),
               /class="rpm">компонента</);
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

/* Шесть, как итоги тега на «Состоянии»: ряд из двух в ширину полосы не
   ложится ничем — либо узкие плашки и пустота справа, либо два числа,
   растянутые в плакат. Счёт тот же, что на соседней вкладке, нарочно:
   ряд, который при переключении меняет счёт, читался бы как другая
   страница. */
test('итоги перехода — шесть больших карточек', function () {
  var out = cards.pairCards(pair(),
    side('os-9.1', '2026-07-01T00:00:00+03:00', 4),
    side('os-9.2', '2026-08-01T00:00:00+03:00', 6));
  assert.match(out, /class="l">было<\/div><div class="n">4 /, out);
  assert.match(out, /class="l">стало<\/div><div class="n">6 /, out);
  assert.strictEqual((out.match(/card big/g) || []).length, 6, out);
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
  assert.match(more, /class="n">\+2 <span class="unit">билда</, more);
  var less = cards.pairCards(pair(), side('a', '', 6), side('b', '', 4));
  assert.match(less, /class="n">−2 <span class="unit">билда</, less);
  var same = cards.pairCards(pair(), side('a', '', 4), side('b', '', 4));
  assert.match(same, /class="n">0 <span class="unit">билдов</, same);
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

/* Билды с оговоркой ищут ровно так же, как проблемные, — кликом по
   карточке. Своя карточка, а не строка в чужой подсказке: смешанные, они
   потерялись бы и те, и другие. */
test('у предупреждений своя карточка со своим фильтром', function () {
  var out = cards.stateCards(snapshot({ counts: { problems: 2, warnings: 5 } })).big;
  assert.match(out, /data-filter="warning"/, out);
  assert.match(out, /с предупреждениями/, out);
  assert.match(out, /data-filter="problem"/, out);
});

/* Раскладку держит css, и держится она на именах блоков: ряд итогов — три
   тематических блока, разрезы — две полосы. Числа и состав карточек при
   этом прежние, поэтому проверяем именно обёртки. */
test('ряд итогов разложен по трём плоскостям', function () {
  var out = cards.stateCards(snapshot()).big;
  assert.match(out, /<div class="cgroup lead">/, out);
  assert.strictEqual(out.split('class="cgroup').length - 1, 3, out);
});

/* Наследование — про состав тега, а не про содержимое билдов: стоять оно
   должно рядом с числом тега, а не с патчами. */
test('число тега и наследование — одна группа, патчи отдельно', function () {
  var out = cards.stateCards(snapshot()).big;
  var lead = out.slice(out.indexOf('cgroup lead'), out.indexOf('cgroup one'));
  assert.match(lead, /data-filter="all"/, lead);
  assert.match(lead, /data-filter="inherited"/, lead);
  assert.strictEqual(lead.split('class="card').length - 1, 2, lead);
  var one = out.slice(out.indexOf('cgroup one'), out.indexOf('cgroup health'));
  assert.match(one, /data-filter="has-patch"/, one);
  assert.strictEqual(one.split('class="card').length - 1, 1, one);
});

/* Уровня записей сбора три, и карточек столько же: каждая считает билды,
   у которых есть запись её уровня, а билд с записями двух уровней стоит в
   обеих. */
test('у каждого уровня записей своя карточка', function () {
  var out = cards.stateCards(snapshot({ counts: { problems: 2, warnings: 1,
                                                  notes: 3 } })).big;
  var health = out.slice(out.indexOf('cgroup health'));
  assert.match(health, /data-filter="problem"/, health);
  assert.match(health, /data-filter="warning"/, health);
  assert.match(health, /data-filter="note"/, health);
  assert.match(health, /с заметками/, health);
  assert.strictEqual(health.split('class="card').length - 1, 3, health);
});

test('стороны перехода и вспомогательные числа — разные группы',
  function () {
    var out = cards.pairCards(pair(), side('os-9.1', '', 1),
                              side('os-9.2', '', 2));
    assert.match(out, /<div class="cgroup major">/, out);
    assert.match(out, /<div class="cgroup scale">/, out);
    assert.match(out, /<div class="cgroup moved">/, out);
    assert.strictEqual(out.split('class="cgroup').length - 1, 3, out);
    var moved = out.slice(out.indexOf('cgroup moved'));
    assert.strictEqual(moved.split('class="card').length - 1, 2, moved);
  });

/* Число карточки — сумма колонки под ней, поэтому считается оно по тем же
   строкам, что стоят в таблице, и складывает все три исхода: пришло, ушло
   и переписано. */
test('движение файлов считается по строкам перехода', function () {
  var out = cards.pairCards(pair({ rows: [
    row({ patches_added: ['a.patch', 'b.patch'], rpms_added: ['x.rpm'] }),
    row({ patches_removed: ['c.patch'], patches_rewritten: ['d.patch'],
          rpms_removed: ['y.rpm', 'z.rpm'] })
  ] }), side('os-9.1', '', 1), side('os-9.2', '', 1));
  var moved = out.slice(out.indexOf('cgroup moved'));
  assert.match(moved, /class="n">4 <span class="unit">файла</, moved);
  assert.match(moved, /class="rpm">\+2 −1 ~1</, moved);
  assert.match(moved, /class="n">3 <span class="unit">пакета</, moved);
  assert.match(moved, /class="rpm">\+1 −2</, moved);
});

/* Ноль в знаках не пишется: три слота из нулей читаются как данные, а не
   сообщают ничего. Когда не двигалось ничего, остаётся прочерк — пустая
   строка выглядела бы недорисованной. */
test('неподвижный переход показывает прочерк, а не нули', function () {
  var out = cards.pairCards(pair(), side('os-9.1', '', 1),
                            side('os-9.2', '', 1));
  var moved = out.slice(out.indexOf('cgroup moved'));
  assert.strictEqual(moved.split('class="rpm">—<').length - 1, 2, moved);
  assert.strictEqual(moved.indexOf('+0'), -1, moved);
  assert.strictEqual(moved.indexOf('−0'), -1, moved);
});

/* Разрезы разложены по вопросам, на которые отвечают: что стало с самим
   компонентом, что стало с его версией, что с патчами, что со сборкой.
   Порядок чисел от этого не меняется — границы легли там, где один вопрос
   и так сменялся другим. */
test('разрезы идут четырьмя плоскостями, состав и порядок прежние',
  function () {
    var out = cards.diffCards(pair());
    assert.strictEqual(out.split('class="cgroup cut"').length - 1, 4, out);
    var keys = (out.match(/data-filter="([^"]+)"/g) || [])
      .map(function (m) { return m.slice(13, -1); });
    assert.deepStrictEqual(keys, ['changed', 'added', 'removed', 'upgraded',
                                  'downgraded', 'unchanged', 'patches+',
                                  'patches-', 'patches~', 'repackaged',
                                  'branch-changed', 'tag-changed']);
  });

/* Плоскость — вопрос, а не порядковый номер: в каждой ровно те три числа,
   что на него отвечают. Ряды складывает раскладка, по две плоскости в
   ряд, — скрипт о рядах не знает. */
test('в каждой плоскости разрезов свои три числа', function () {
  var planes = cards.diffCards(pair()).split('class="cgroup cut"').slice(1);
  assert.strictEqual(planes.length, 4);
  planes.forEach(function (plane) {
    assert.strictEqual(plane.split('data-filter="').length - 1, 3, plane);
  });
  assert.match(planes[1], /data-filter="upgraded"/, planes[1]);
  assert.match(planes[2], /data-filter="patches~"/, planes[2]);
});
