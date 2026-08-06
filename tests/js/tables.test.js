'use strict';
/* Строки и детали таблиц. Всё, что раньше бралось из состояния страницы,
   теперь приходит объектом opt — и проверить таблицу можно, не поднимая
   ни страницы, ни заглушки DOM. */
var test = require('node:test');
var assert = require('node:assert');
var labels = require('../../dashboard/assets/js/labels.js');
var tables = require('../../dashboard/assets/js/tables.js');

labels.setClasses(['CVE', 'other']);

function opts(over) {
  over = over || {};
  return { q: over.q || '', cols: over.cols || 9,
           keyOf: function (row) { return 'k:' + row.name; },
           openOf: function (key, deep) {
             return over.open === undefined ? Boolean(deep) : over.open;
           },
           oldTag: over.oldTag || 'было', newTag: over.newTag || 'стало' };
}

function stateRow(over) {
  over = over || {};
  return { name: 'nginx', nvr: 'nginx-1.24.0-3.el9', evr: '1.24.0-3.el9',
           branch: 'os-9.2', tagged_in: 'os-9.2', inherited: false,
           koji_tags: ['os-9.2'], project: 'group/nginx', owner: 'builder',
           completed: '2026-05-14 10:00:00', build_id: 1, task_id: 2,
           ref_kind: 'branch', patch_dir_present: true, source_url: null,
           koji_url: null, patches: over.patches || [], patch_counts: {},
           rpms: over.rpms || ['nginx-1.24.0-3.el9.x86_64'],
           problems: over.problems || [], marks: over.marks || [] };
}

function diffRow(over) {
  over = over || {};
  return { name: 'nginx', status: over.status || 'upgraded',
           old_evr: '1.24.0-3.el9', new_evr: '1.24.0-4.el9',
           old_branch: 'os-9.2', new_branch: over.new_branch || 'os-9.3',
           old_ref_kind: over.old_ref_kind || 'branch',
           new_ref_kind: over.new_ref_kind || 'branch',
           old_tagged_in: 'os-9.2', new_tagged_in: 'os-9.3',
           old_inherited: false, new_inherited: false,
           old_patches: [], new_patches: [], rpm_rows: [],
           patches_added: [], patches_removed: [],
           rpms_added: [], rpms_removed: [],
           old_owner: over.old_owner || 'builder',
           new_owner: over.new_owner || 'builder',
           old_completed: '2026-05-14 10:00:00',
           new_completed: '2026-07-31 03:10:00',
           old_project: over.old_project || 'core/nginx',
           new_project: over.new_project || 'core/nginx',
           old_koji_url: 'https://koji/koji/buildinfo?buildID=1',
           new_koji_url: 'https://koji/koji/buildinfo?buildID=2',
           old_source_url: 'https://git/core/nginx/-/tree/os-9.2',
           new_source_url: 'https://git/core/nginx/-/tree/os-9.3',
           koji_url: null, source_url: null, marks: over.marks || [] };
}

test('свёрнутая строка не тащит за собой деталей', function () {
  var out = tables.stateRows([{ row: stateRow(), open: false }], opts());
  assert.match(out, /data-row="k:nginx"/);
  assert.match(out, /aria-expanded="false"/);
  assert.doesNotMatch(out, /detail-row/);
});

test('раскрытая строка добавляет деталь на всю ширину таблицы', function () {
  var out = tables.stateRows([{ row: stateRow(), open: true }],
                             opts({ cols: 9 }));
  assert.match(out, /<tr class="detail-row"><td colspan="9">/);
});

test('ширина деталей берётся из opt, а не угадывается', function () {
  var out = tables.diffRows([{ row: diffRow(), open: true }],
                            opts({ cols: 8 }));
  assert.match(out, /colspan="8"/);
});

test('строка с проблемой помечена классом bad', function () {
  var out = tables.stateRows(
    [{ row: stateRow({ problems: ['нет источника'] }), open: false }], opts());
  assert.match(out, /class="main-row bad"/);
});

test('строка без источника тоже помечена bad', function () {
  var out = tables.stateRows(
    [{ row: stateRow({ marks: ['no-source'] }), open: false }], opts());
  assert.match(out, /class="main-row bad"/);
});

test('число патчей и полоска разведены по краям ячейки', function () {
  var row = stateRow({ patches: [{ path: 'PATCH/a', name: 'a', 'class': 'CVE',
                                   cves: [], url: null }] });
  row.patch_counts = { CVE: 1 };
  var out = tables.stateRows([{ row: row, open: false }], opts());
  assert.match(out, /<span class="patcell">1<span class="meter"/);
});

test('без патчей в ячейке стоит бледный ноль', function () {
  var out = tables.stateRows([{ row: stateRow(), open: false }], opts());
  assert.match(out, /<span class="zero">0<\/span>/);
});

test('запрос подсвечивается прямо в строке', function () {
  var out = tables.stateRows([{ row: stateRow(), open: false }],
                             opts({ q: 'ngi' }));
  assert.match(out, /<span class="hit">ngi<\/span>nx/);
});

test('статус диффа даёт и класс строки, и стрелку', function () {
  var out = tables.diffRows([{ row: diffRow({ status: 'downgraded' }),
                               open: false }], opts());
  assert.match(out, /class="main-row downgraded"/);
  assert.match(out, /<td class="dir">↓<\/td>/);
});

test('незнакомый статус не рисует стрелки', function () {
  var out = tables.diffRows([{ row: diffRow({ status: 'constructor' }),
                               open: false }], opts());
  assert.match(out, /<td class="dir"><\/td>/);
});

/* Раскрытая строка и её детали — один предмет: полоса слева идёт через
   обе, и рисует её CSS по классам, которые ставит разметка. */
test('раскрытая строка помечена, свёрнутая — нет', function () {
  var open = tables.stateRows([{ row: stateRow(), open: true }],
                              opts({ open: true }));
  var shut = tables.stateRows([{ row: stateRow(), open: false }], opts());
  assert.match(open, /class="main-row open"/, open);
  assert.doesNotMatch(shut, /main-row open/, shut);
});

test('детали проблемного билда наследуют его тревожную полосу', function () {
  var out = tables.stateRows(
    [{ row: stateRow({ problems: ['нет источника'] }), open: true }],
    opts({ open: true }));
  assert.match(out, /class="detail-row bad"/, out);
});

test('детали обычного билда тревожной полосы не наследуют', function () {
  var out = tables.stateRows([{ row: stateRow(), open: true }],
                             opts({ open: true }));
  assert.match(out, /class="detail-row"/, out);
});

test('строка диффа тоже помечена раскрытой', function () {
  var out = tables.diffRows([{ row: diffRow(), open: true }],
                            opts({ open: true }));
  assert.match(out, /class="main-row upgraded open"/, out);
});

test('стрелка раскрытия — один глиф, состояние на aria', function () {
  var open = tables.stateRows([{ row: stateRow(), open: true }],
                              opts({ open: true }));
  var shut = tables.stateRows([{ row: stateRow(), open: false }], opts());
  assert.match(open, /aria-expanded="true">▸/, open);
  assert.match(shut, /aria-expanded="false">▸/, shut);
});

test('подпись блока несёт счётчик', function () {
  var out = tables.stateDetail(stateRow(), '');
  assert.match(out, /RPM<span class="n">· 1<\/span>/, out);
  assert.match(out, /патчи<span class="n">· 0<\/span>/, out);
});

/* Пакеты приходят спаренными, чтобы один и тот же подпакет стоял слева и
   справа на одной высоте. Держится это на том, что куски сторон уходят в
   разметку парами и встают в одну строку сетки: пойди они подряд — сперва
   вся левая сторона, потом вся правая, — списки начинались бы на разной
   высоте из-за списков патчей над ними, и выравнивание пропало бы. */
test('куски сторон идут парами: шапка, сводка, патчи, пакеты', function () {
  var out = tables.diffDetail(diffRow(), '', 'os-9.1', 'os-9.4');
  var order = (out.match(/side-head|class="side"/g) || []);
  assert.deepStrictEqual(order, ['side-head', 'side-head',
                                 'class="side"', 'class="side"',
                                 'class="side"', 'class="side"',
                                 'class="side"', 'class="side"'], out);
  assert.ok(out.indexOf('было') < out.indexOf('стало'),
            'левая сторона должна идти первой');
});

test('имена концов в детали диффа приходят доводами', function () {
  var out = tables.diffDetail(diffRow(), '', 'os-9.1', 'os-9.4');
  assert.match(out, /было · <b>os-9\.1<\/b>/);
  assert.match(out, /стало · <b>os-9\.4<\/b>/);
});

test('деталь состояния показывает оба источника', function () {
  var out = tables.stateDetail(stateRow(), '');
  assert.match(out, /<div class="bl">koji<\/div>/);
  assert.match(out, /<div class="bl">gitlab<\/div>/);
});

test('метку from-commit деталь не повторяет', function () {
  /* Она уже стоит в колонке меток той же строки, и вторая такая же внутри
     раскрытия сообщает то же самое второй раз. */
  var row = stateRow();
  row.ref_kind = 'commit';
  assert.doesNotMatch(tables.stateDetail(row, ''), /from-commit/);
});

test('владелец билда стоит в строке', function () {
  var out = tables.stateRows([{ row: stateRow(), open: false }], opts());
  assert.match(out, /<td class="owner">builder<\/td>/);
});

test('владельца нет — в ячейке прочерк, а не пустота', function () {
  var row = stateRow();
  row.owner = null;
  var out = tables.stateRows([{ row: row, open: false }], opts());
  assert.match(out, /<td class="owner"><span class="none">—<\/span><\/td>/);
});

test('владелец подсвечивается поиском', function () {
  var out = tables.stateRows([{ row: stateRow(), open: false }],
                             opts({ q: 'build' }));
  assert.match(out, /<td class="owner"><span class="hit">build<\/span>er<\/td>/);
});

test('в блоке koji стоят все поля билда', function () {
  /* Раскрытие — полная карточка билда, а не выжимка из того, чего нет в
     строке: сюда приходят, когда строки уже мало. */
  var row = stateRow();
  row.koji_url = 'https://koji.example.com/koji/buildinfo?buildID=1';
  var out = tables.stateDetail(row, '');
  assert.match(out, /NVR/);
  assert.match(out, /основной тег/);
  assert.match(out, /другие теги/);
  assert.match(out, /собран/);
  assert.match(out, /владелец[\s\S]*builder/);
  assert.match(out, /build id/);
  assert.match(out, /task id/);
  assert.match(out, /buildinfo\?buildID=1/, 'нет ссылки на билд в koji');
});

/* Билд из готового SRPM: в GitLab он не бывал вовсе, и блок раскрытия
   зовётся своим именем — иначе пустые «проект» и «ссылка» в блоке gitlab
   читались бы как недосмотр. */
test('билд из SRPM подписан srpm, а блок назван srpm', function () {
  var row = stateRow();
  row.ref_kind = 'srpm';
  row.branch = 'mc-4.8-1.el9.src.rpm';
  row.project = null;
  var out = tables.stateDetail(row, '');
  assert.match(out, /<span class="k">srpm<\/span>/, out);
  assert.match(out, /<div class="bl">srpm<\/div>/, out);
  assert.doesNotMatch(out, /<div class="bl">gitlab<\/div>/, out);
});

test('билд с коммита назван коммитом, а не веткой', function () {
  /* Значение в этой строке — не имя ветки, а хеш; подписать его «веткой»
     значит соврать. Метка from-commit сюда не ставится: она стоит в
     колонке меток той же строки. */
  var row = stateRow();
  row.ref_kind = 'commit';
  row.branch = 'abc1234';
  var out = tables.stateDetail(row, '');
  assert.match(out, /<span class="k">коммит<\/span>/);
  assert.doesNotMatch(out, /from-commit/);
  assert.doesNotMatch(tables.stateDetail(stateRow(), ''),
                      /<span class="k">коммит<\/span>/);
});

test('сводка стороны диффа несёт всю карточку билда', function () {
  /* «Было» и «стало» — это две карточки одного билда, и обрезать их до
     трёх строк значит заставлять уходить из раскрытия за остальным. */
  var out = tables.diffDetail(diffRow(), '', 'os-9.1', 'os-9.4');
  assert.match(out, /версия/);
  assert.match(out, /тег/);
  assert.match(out, /ветка/);
  assert.match(out, /проект/);
  assert.match(out, /собран/);
  assert.match(out, /владелец/);
  assert.match(out, /buildID=1/, 'нет ссылки на старый билд');
  assert.match(out, /buildID=2/, 'нет ссылки на новый билд');
  assert.match(out, /tree\/os-9\.2/, 'нет ссылки на старую ветку');
  assert.match(out, /tree\/os-9\.3/, 'нет ссылки на новую ветку');
});

/* Пересобранный из SRPM компонент рядом с прежним, собранным из ветки, —
   законная пара, и подпись у каждой стороны своя: одна «ветка», другая
   «srpm». Одним словом их не назвать, не соврав про одну из двух. */
test('стороны диффа подписаны каждая своим видом источника', function () {
  var out = tables.diffDetail(diffRow({ old_ref_kind: 'branch',
                                        new_ref_kind: 'srpm',
                                        new_branch: 'mc-4.8-1.el9.src.rpm' }),
                              '', 'os-9.1', 'os-9.4');
  assert.match(out, /<span class="k">ветка<\/span>/, out);
  assert.match(out, /<span class="k">srpm<\/span>/, out);
});

test('сменившийся владелец помечен на стороне «стало»', function () {
  var out = tables.diffDetail(diffRow({ old_owner: 'alice',
                                        new_owner: 'bob' }),
                              '', 'os-9.1', 'os-9.4');
  assert.match(out, /<span class="is-added">bob<\/span>/);
  assert.doesNotMatch(out, /<span class="is-added">alice<\/span>/);
});

test('переехавший проект помечен на стороне «стало»', function () {
  var out = tables.diffDetail(diffRow({ old_project: 'core/nginx',
                                        new_project: 'web/nginx' }),
                              '', 'os-9.1', 'os-9.4');
  assert.match(out, /is-added">web\/nginx</);
});

test('одинаковые владелец и проект ничем не помечены', function () {
  var out = tables.diffDetail(diffRow(), '', 'os-9.1', 'os-9.4');
  assert.doesNotMatch(out, /is-added">builder</);
  assert.doesNotMatch(out, /is-added">core\/nginx</);
});

test('блок проблем появляется только когда они есть', function () {
  assert.doesNotMatch(tables.stateDetail(stateRow(), ''), /проблемы/);
  assert.match(tables.stateDetail(stateRow({ problems: ['нет ветки'] }), ''),
               /<li>нет ветки<\/li>/);
});
