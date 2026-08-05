'use strict';
/* Куски разметки, общие для обеих таблиц. Проверяется не точная форма
   строки — она меняется вместе с вёрсткой, — а то, что в неё попало:
   нужный css-класс, экранирование, прочерк на месте пустоты. */
var test = require('node:test');
var assert = require('node:assert');
var labels = require('../../dashboard/assets/js/labels.js');
var markup = require('../../dashboard/assets/js/markup.js');

function patch(name, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls, cves: [],
           url: null };
}

test('метка несёт ключ фильтра и свою подсказку', function () {
  var out = markup.markHtml('no-patch');
  assert.match(out, /data-filter="no-patch"/);
  assert.match(out, /нет каталога PATCH\. Клик — фильтр\./);
  assert.match(out, /class="mark calm"/);
});

test('метка класса патчей красится классом, а не статусом', function () {
  labels.setClasses(['CVE']);
  assert.match(markup.markHtml('cve'), /class="mark c-cve"/);
});

test('строки без меток показывают прочерк', function () {
  assert.strictEqual(markup.marksHtml([]), '<span class="none">—</span>');
});

test('полоска патчей делит ширину по классам', function () {
  labels.setClasses(['CVE', 'other']);
  var out = markup.meterHtml({ patches: [1, 2, 3, 4],
                               patch_counts: { CVE: 1, other: 3 } });
  assert.match(out, /class="c-cve" style="width:25\.00%"/);
  assert.match(out, /class="c-other" style="width:75\.00%"/);
  assert.match(out, /всего 4/);
});

test('без патчей полоски нет вовсе', function () {
  assert.strictEqual(markup.meterHtml({ patches: [], patch_counts: {} }), '');
});

test('ссылка с недопустимой схемой не рисуется', function () {
  assert.strictEqual(markup.linkHtml('javascript:alert(1)', 'koji'), '');
  assert.match(markup.linkHtml('https://hub/x', 'koji'), /href="https:\/\/hub\/x"/);
});

test('колонка тега: прочерк для прямого, имя для унаследованного', function () {
  assert.match(markup.taggedCell({ inherited: false }, ''), /—/);
  assert.match(markup.taggedCell({ inherited: null }, ''), /\?/);
  assert.strictEqual(markup.taggedCell({ inherited: true, tagged_in: 'os-9.1' },
                                       ''), 'os-9.1');
});

test('время сборки делится на дату и бледное время', function () {
  var out = markup.builtHtml('2026-05-14 10:00:00', '');
  assert.match(out, /^2026-05-14 <span class="tm">10:00:00<\/span>$/);
});

test('снапшот без времени сборки несёт одну дату', function () {
  assert.strictEqual(markup.builtHtml('2026-05-14', ''), '2026-05-14');
});

test('патчи группируются по классам и считаются', function () {
  labels.setClasses(['CVE', 'other']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE'),
                                patch('b.patch', 'other'),
                                patch('c.patch', 'CVE')], '', null, '');
  assert.match(out, /<div class="pgroup c-cve">/);
  assert.match(out, /CVE <span class="n">2<\/span>/);
  assert.match(out, /other <span class="n">1<\/span>/);
});

/* Путь второй строкой — только когда он что-то добавляет. Почти всегда он
   «PATCH/<имя>», то есть имя, повторённое с приставкой: список патчей из-за
   этого был вдвое длиннее, а нового в нём ноль. */
test('путь, повторяющий имя, второй строкой не печатается', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], '', null, '');
  assert.doesNotMatch(out, /ppath/, out);
});

test('патч из подкаталога путь показывает', function () {
  labels.setClasses(['CVE']);
  var p = patch('a.patch', 'CVE');
  p.path = 'PATCH/sub/a.patch';
  var out = markup.patchesHtml([p], '', null, '');
  assert.match(out, /class="ppath">PATCH\/sub\/a\.patch</, out);
});

test('путь показывается, если поиск попал в него, а не в имя', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], 'patch/a', null, '');
  assert.match(out, /ppath/, out);
});

test('поиск по имени лишней строки не добавляет', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], 'a.pat', null, '');
  assert.doesNotMatch(out, /ppath/, out);
});

test('путь, устроенный не как «каталог/имя», печатается целиком',
  function () {
    labels.setClasses(['CVE']);
    var p = patch('a.patch', 'CVE');
    p.path = 'совсем-другое';
    assert.match(markup.patchesHtml([p], '', null, ''), /ppath/);
  });

/* Дифф патчей живёт только в стороне «стало»: там и новое состояние, и
   весь переход к нему. В «было» пометок нет вовсе — то состояние не
   менялось. */
test('в «стало» пришедший патч помечен знаком и стоит внизу группы',
  function () {
    labels.setClasses(['CVE']);
    var was = [patch('a.patch', 'CVE')];
    var now = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
    var out = markup.patchesChangeHtml(was, now, '');
    assert.match(out, /<li class="is-added"><span class="sign">\+<\/span>/);
    assert.ok(out.indexOf('a.patch') < out.indexOf('b.patch'),
              'пришедший должен стоять ниже уцелевшего: ' + out);
  });

test('в «стало» ушедший патч зачёркнут на своём месте', function () {
  labels.setClasses(['CVE']);
  var was = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
  var now = [patch('b.patch', 'CVE')];
  var out = markup.patchesChangeHtml(was, now, '');
  assert.match(out, /<li class="is-removed"><span class="sign">−<\/span>/);
  assert.ok(out.indexOf('a.patch') < out.indexOf('b.patch'),
            'ушедший должен остаться на своём прежнем месте: ' + out);
});

test('счётчик группы считает новое состояние, не считая зачёркнутых',
  function () {
    labels.setClasses(['CVE']);
    var was = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
    var out = markup.patchesChangeHtml(was, [patch('b.patch', 'CVE')], '');
    assert.match(out, /CVE <span class="n">1<\/span>/, out);
  });

test('класс, ушедший целиком, остаётся с нулём и зачёркнутой строкой',
  function () {
    labels.setClasses(['CVE', 'SAST']);
    var was = [patch('a.patch', 'CVE'), patch('s.patch', 'SAST')];
    var out = markup.patchesChangeHtml(was, [patch('a.patch', 'CVE')], '');
    assert.match(out, /SAST <span class="n">0<\/span>/, out);
    assert.match(out, /is-removed/, out);
  });

test('в «было» пометок нет ни одной', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], '');
  assert.doesNotMatch(out, /is-added|is-removed|class="sign"/, out);
});

test('пакеты режутся на блоки по смене архитектуры', function () {
  var out = markup.rpmsHtml(['p-1-1.src', 'p-1-1.x86_64', 'q-1-1.x86_64'], '');
  assert.match(out, /src <span class="n">1<\/span>/);
  assert.match(out, /x86_64 <span class="n">2<\/span>/);
});

test('сторона достаётся из пар готовым списком', function () {
  var rows = [['p-1-1.x86_64', 'p-1-2.x86_64'], [null, 'q-1-1.x86_64']];
  assert.deepStrictEqual(markup.rpmSideList(rows, 0), ['p-1-1.x86_64']);
  assert.deepStrictEqual(markup.rpmSideList(rows, 1),
                         ['p-1-2.x86_64', 'q-1-1.x86_64']);
});

test('в «стало» ушедший пакет зачёркнут, пришедший помечен плюсом',
  function () {
    var out = markup.rpmsChangeHtml(
      [['p-1-1.x86_64', 'p-1-2.x86_64'],
       ['gone-1-1.x86_64', null],
       [null, 'fresh-1-1.x86_64']], '');
    assert.match(out, /<li class="is-removed"><span class="sign">−<\/span>gone/);
    assert.match(out, /<li class="is-added"><span class="sign">\+<\/span>fresh/);
    assert.match(out, /<li>p-1-2\.x86_64<\/li>/, out);
  });

test('счётчик архитектуры считает новое состояние', function () {
  /* Из архитектуры ушёл последний пакет: блок остаётся с нулём и одной
     зачёркнутой строкой — «была и кончилась» тоже ответ. */
  var out = markup.rpmsChangeHtml([['gone-1-1.noarch', null]], '');
  assert.match(out, /noarch <span class="n">0<\/span>/, out);
});

test('в «было» пакеты идут без пометок', function () {
  var rows = [['p-1-1.x86_64', null]];
  var out = markup.rpmsHtml(markup.rpmSideList(rows, 0), '');
  assert.doesNotMatch(out, /is-removed|is-added|class="sign"/, out);
  assert.match(out, /x86_64 <span class="n">1<\/span>/, out);
});

test('дельта без изменений — прочерк, а не «+0 −0»', function () {
  assert.strictEqual(markup.delta(0, 0), '<span class="zero">—</span>');
  assert.match(markup.delta(2, 1), /\+2.*−1/);
});
