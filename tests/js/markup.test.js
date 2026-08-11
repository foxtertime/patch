'use strict';
/* Куски разметки, общие для обеих таблиц. Проверяется не точная форма
   строки — она меняется вместе с вёрсткой, — а то, что в неё попало:
   нужный css-класс, экранирование, прочерк на месте пустоты. */
var test = require('node:test');
var assert = require('node:assert');
var labels = require('../../dashboard/assets/js/labels.js');
var markup = require('../../dashboard/assets/js/markup.js');
var query = require('../../dashboard/assets/js/query.js');

function q(typed) { return query.compile(typed || '', false); }

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

test('колонка тега называет тег и у прямого билда, и у унаследованного',
  function () {
    assert.strictEqual(markup.taggedCell({ inherited: false,
                                           tagged_in: 'os-9.2' }, q()),
                       'os-9.2');
    assert.strictEqual(markup.taggedCell({ inherited: true,
                                           tagged_in: 'os-9.1' }, q()),
                       'os-9.1');
    /* Тега не записывал сам снапшот — вопросительный знак, а не имя
       выбранного тега: «неизвестно» и «прямой» не одно и то же. */
    assert.match(markup.taggedCell({ inherited: null }, q()), /\?/);
    assert.match(markup.taggedCell({ inherited: null,
                                     tagged_in: null }, q()), /\?/);
  });

/* Дата и время — два уровня одной ячейки, и пробела между ними нет: время
   встаёт блоком, а пробел висел бы в хвосте первой строки. */
test('время сборки билда делится на дату и бледное время', function () {
  var out = markup.builtHtml('2026-05-14 10:00:00', q());
  assert.match(out, /^2026-05-14<span class="tm">10:00:00<\/span>$/);
});

test('снапшот без времени сборки билда несёт одну дату', function () {
  assert.strictEqual(markup.builtHtml('2026-05-14', q()), '2026-05-14');
});

test('патчи группируются по классам и считаются', function () {
  labels.setClasses(['CVE', 'other']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE'),
                                patch('b.patch', 'other'),
                                patch('c.patch', 'CVE')], q(), null, '');
  assert.match(out, /<div class="pgroup c-cve">/);
  assert.match(out, /CVE <span class="n">2<\/span>/);
  assert.match(out, /other <span class="n">1<\/span>/);
});

/* Путь второй строкой — только когда он что-то добавляет. Почти всегда он
   «PATCH/<имя>», то есть имя, повторённое с приставкой: список патчей из-за
   этого был вдвое длиннее, а нового в нём ноль. */
test('путь, повторяющий имя, второй строкой не печатается', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], q(), null, '');
  assert.doesNotMatch(out, /ppath/, out);
});

test('патч из подкаталога путь показывает', function () {
  labels.setClasses(['CVE']);
  var p = patch('a.patch', 'CVE');
  p.path = 'PATCH/sub/a.patch';
  var out = markup.patchesHtml([p], q(), null, '');
  assert.match(out, /class="ppath">PATCH\/sub\/a\.patch</, out);
});

test('путь показывается, если поиск попал в него, а не в имя', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], q('patch/a'), null, '');
  assert.match(out, /ppath/, out);
});

test('поиск по имени лишней строки не добавляет', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], q('a.pat'), null, '');
  assert.doesNotMatch(out, /ppath/, out);
});

test('путь, устроенный не как «каталог/имя», печатается целиком',
  function () {
    labels.setClasses(['CVE']);
    var p = patch('a.patch', 'CVE');
    p.path = 'совсем-другое';
    assert.match(markup.patchesHtml([p], q(), null, ''), /ppath/);
  });

/* Дифф патчей живёт только в стороне «стало»: там и новое состояние, и
   весь переход к нему. В «было» пометок нет вовсе — то состояние не
   менялось. */
test('в «стало» пришедший патч помечен знаком и стоит внизу группы',
  function () {
    labels.setClasses(['CVE']);
    var was = [patch('a.patch', 'CVE')];
    var now = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
    var out = markup.patchesChangeHtml(was, now, [], q());
    assert.match(out, /<li class="is-added"><span class="sign">\+<\/span>/);
    assert.ok(out.indexOf('a.patch') < out.indexOf('b.patch'),
              'пришедший должен стоять ниже уцелевшего: ' + out);
  });

test('в «стало» ушедший патч зачёркнут на своём месте', function () {
  labels.setClasses(['CVE']);
  var was = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
  var now = [patch('b.patch', 'CVE')];
  var out = markup.patchesChangeHtml(was, now, [], q());
  assert.match(out, /<li class="is-removed"><span class="sign">−<\/span>/);
  assert.ok(out.indexOf('a.patch') < out.indexOf('b.patch'),
            'ушедший должен остаться на своём прежнем месте: ' + out);
});

test('счётчик группы считает новое состояние, не считая зачёркнутых',
  function () {
    labels.setClasses(['CVE']);
    var was = [patch('a.patch', 'CVE'), patch('b.patch', 'CVE')];
    var out = markup.patchesChangeHtml(was, [patch('b.patch', 'CVE')], [], q());
    assert.match(out, /CVE <span class="n">1<\/span>/, out);
  });

test('класс, ушедший целиком, остаётся с нулём и зачёркнутой строкой',
  function () {
    labels.setClasses(['CVE', 'SAST']);
    var was = [patch('a.patch', 'CVE'), patch('s.patch', 'SAST')];
    var out = markup.patchesChangeHtml(was, [patch('a.patch', 'CVE')], [], q());
    assert.match(out, /SAST <span class="n">0<\/span>/, out);
    assert.match(out, /is-removed/, out);
  });

test('в «было» пометок нет ни одной', function () {
  labels.setClasses(['CVE']);
  var out = markup.patchesHtml([patch('a.patch', 'CVE')], q());
  assert.doesNotMatch(out, /is-added|is-removed|class="sign"/, out);
});

function withSha(name, sha) {
  return { path: 'PATCH/' + name, name: name, 'class': 'CVE', cves: [],
           url: 'https://gl/' + name, sha: sha };
}

test('переписанный патч помечен знаком и классом', function () {
  var html = markup.patchesChangeHtml([withSha('a.patch', 'aaa')],
                                      [withSha('a.patch', 'bbb')],
                                      ['PATCH/a.patch'], q());
  assert.match(html, /class="is-rewritten"/);
  assert.match(html, /<span class="sign">~<\/span>/);
});

/* Правило «переписан» живёт в diff.js и только там. Разметка красит то,
   что ей сказали: патч с разными sha, которого нет в списке, остаётся
   непомеченным, а патч из списка помечается, какими бы ни были его sha.
   Иначе правило снова окажется записанным дважды. */
test('переписанные приходят списком, а не выводятся заново', function () {
  var was = [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
               cves: [], url: null, sha: 'aaa' }];
  var now = [{ path: 'PATCH/a.patch', name: 'a.patch', 'class': 'CVE',
               cves: [], url: null, sha: 'bbb' }];
  labels.setClasses(['CVE']);

  var silent = markup.patchesChangeHtml(was, now, [], q());
  assert.doesNotMatch(silent, /is-rewritten/,
    'sha разные, но списка нет — разметка не имеет права решать сама');

  var told = markup.patchesChangeHtml(was, now, ['PATCH/a.patch'], q());
  assert.match(told, /is-rewritten/);
  assert.match(told, /class="sign">~/);
});

test('сторона «было» по-прежнему не метится', function () {
  var html = markup.patchesHtml([withSha('a.patch', 'aaa')], q());
  assert.strictEqual(html.indexOf('is-rewritten'), -1);
  assert.strictEqual(html.indexOf('class="sign"'), -1);
});

test('пакеты режутся на блоки по смене архитектуры', function () {
  var out = markup.rpmsHtml(['p-1-1.src', 'p-1-1.x86_64', 'q-1-1.x86_64'], q());
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
       [null, 'fresh-1-1.x86_64']], q());
    assert.match(out, /<li class="is-removed"><span class="sign">−<\/span>gone/);
    assert.match(out, /<li class="is-added"><span class="sign">\+<\/span>fresh/);
    assert.match(out, /<li>p-1-2\.x86_64<\/li>/, out);
  });

test('счётчик архитектуры считает новое состояние', function () {
  /* Из архитектуры ушёл последний пакет: блок остаётся с нулём и одной
     зачёркнутой строкой — «была и кончилась» тоже ответ. */
  var out = markup.rpmsChangeHtml([['gone-1-1.noarch', null]], q());
  assert.match(out, /noarch <span class="n">0<\/span>/, out);
});

test('в «было» пакеты идут без пометок', function () {
  var rows = [['p-1-1.x86_64', null]];
  var out = markup.rpmsHtml(markup.rpmSideList(rows, 0), q());
  assert.doesNotMatch(out, /is-removed|is-added|class="sign"/, out);
  assert.match(out, /x86_64 <span class="n">1<\/span>/, out);
});

test('дельта без изменений — прочерк, а не «+0 −0»', function () {
  assert.strictEqual(markup.delta(0, 0), '<span class="zero">—</span>');
  assert.match(markup.delta(2, 1), /\+2.*−1/);
});

/* Третий довод строго дописывается: той же delta рисуется колонка Δ RPM,
   где третьего исхода не бывает и не будет, и любая правка её разметки
   поехала бы вместе с этой. */
test('delta с двумя доводами даёт ровно то же, что и раньше', function () {
  assert.strictEqual(markup.delta(0, 0), '<span class="zero">—</span>');
  assert.strictEqual(markup.delta(1, 0), '<span class="plus">+1</span> ');
  assert.strictEqual(markup.delta(0, 1), '<span class="minus">−1</span>');
  assert.strictEqual(markup.delta(1, 1),
    '<span class="plus">+1</span> <span class="minus">−1</span>');
});

test('delta показывает переписанные третьим знаком', function () {
  assert.strictEqual(markup.delta(0, 0, 2), '<span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(0, 1, 2),
    '<span class="minus">−1</span> <span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(1, 0, 2),
    '<span class="plus">+1</span> <span class="tilde">~2</span>');
  assert.strictEqual(markup.delta(1, 1, 2),
    '<span class="plus">+1</span> <span class="minus">−1</span>'
    + ' <span class="tilde">~2</span>');
});

test('бейдж отставания есть только когда есть отставание', function () {
  assert.strictEqual(markup.aheadHtml({ commits_ahead: 0, branch: 'br' }), '');
  assert.strictEqual(markup.aheadHtml({ commits_ahead: null, branch: 'br' }), '');
  var html = markup.aheadHtml({ commits_ahead: 3, branch: 'br' });
  assert.match(html, /ветка \+3/);
  assert.match(html, /data-tip="[^"]*br[^"]*"/);
});

function ghost(name, side, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls || 'CVE',
           cves: [], url: 'https://gl/' + name, ghost: side };
}

test('без ghost-патчей секции нет', function () {
  assert.strictEqual(markup.ghostsHtml([], q()), '');
});

test('стороны идут в одном порядке и подписаны по-разному', function () {
  // порядок задаёт разметка, а не порядок в снапшоте: на вход стороны
  // поданы вперемешку
  var html = markup.ghostsHtml([ghost('c.patch', 'build'),
                                ghost('a.patch', 'branch'),
                                ghost('b.patch', 'changed')], q());
  var order = ['нет в пакете', 'в пакете старый', 'нет в ветке'];
  var at = order.map(function (t) { return html.indexOf(t); });
  assert.ok(at[0] !== -1 && at[0] < at[1] && at[1] < at[2]);
});

test('черта на всю секцию одна, а не по одной на сторону', function () {
  var html = markup.ghostsHtml([ghost('a.patch', 'branch'),
                                ghost('b.patch', 'changed'),
                                ghost('c.patch', 'build')], q());
  assert.strictEqual(html.split('class="ghosts"').length - 1, 1);
});

test('у каждой стороны свой счётчик и своя подсказка', function () {
  var html = markup.ghostsHtml([ghost('a.patch', 'branch'),
                                ghost('b.patch', 'branch')], q());
  assert.match(html,
    /<div class="gside" data-tip="[^"]+">нет в пакете<span class="n">2</);
});

test('полоса списка серая: цвет полосы значит класс, а его тут нет',
     function () {
       var html = markup.ghostsHtml([ghost('a.patch', 'branch')], q());
       assert.match(html, /<ul class="glist">/);
       assert.strictEqual(html.indexOf('class="plist"'), -1);
     });

test('строка с незнакомой стороной не рисуется и в счёт не идёт', function () {
  assert.strictEqual(markup.ghostsHtml([ghost('a.patch', 'нечто')], q()), '');
  var html = markup.ghostsHtml([ghost('a.patch', 'branch'),
                                ghost('b.patch', 'нечто')], q());
  assert.match(html, /нет в пакете<span class="n">1</);
  assert.strictEqual(html.indexOf('b.patch'), -1);
});

test('класс патча виден и покрашен', function () {
  var html = markup.ghostsHtml([ghost('a.patch', 'branch', 'SAST')], q());
  assert.match(html, /SAST/);
  assert.match(html, /class="pcls [^"]+"/);
});

/* Блок проблемы: подпись сверху, текст под ней, полоса слева — её рисует
   css по классу .prob. Здесь проверяется, что в разметку попало и чем
   набрано. */
test('проблема рисуется блоком из подписи и текста', function () {
  var out = markup.problemHtml('gitlab: ветка os-9.6 не найдена', q());
  assert.match(out, /class="prob"/);
  assert.match(out, /class="pkind">GitLab</);
  assert.match(out, /class="ptext">ветка os-9\.6 не найдена</);
});

test('у проблемы без текста подписи хватает одной', function () {
  var out = markup.problemHtml('no source url', q());
  assert.match(out, /class="pkind">нет ссылки на источник</);
  assert.doesNotMatch(out, /class="ptext"/);
});

/* Подсветка обещает «запрос нашёлся здесь». Подпись знакомого источника —
   слово самой страницы, а не данные: подсветив её, страница обещала бы
   найденное там, где искать нечего. Незнакомая подпись приехала из
   снапшота, и её подсвечиваем наравне с текстом. */
test('подсветка не трогает подпись знакомого источника', function () {
  var out = markup.problemHtml('gitlab: gitlab не ответил', q('gitlab'));
  assert.match(out, /class="pkind">GitLab</);
  assert.match(out, /class="ptext"><span class="hit">gitlab<\/span> не ответил</);
});

test('незнакомая подпись подсвечивается как данные', function () {
  var out = markup.problemHtml('mock: сборка упала', q('mock'));
  assert.match(out, /class="pkind"><span class="hit">mock<\/span></);
});

test('разметка из проблемы экранируется', function () {
  var out = markup.problemsHtml(['<img src=x>: <b>бум</b>'], q());
  assert.strictEqual(out.indexOf('<img'), -1, out);
  assert.strictEqual(out.indexOf('<b>'), -1, out);
});
