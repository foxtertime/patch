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
           old_branch: 'os-9.2', new_branch: 'os-9.3',
           old_tagged_in: 'os-9.2', new_tagged_in: 'os-9.3',
           old_inherited: false, new_inherited: false,
           old_patches: [], new_patches: [], rpm_rows: [],
           patches_added: [], patches_removed: [],
           rpms_added: [], rpms_removed: [],
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

test('сборка с коммита помечена прямо в детали', function () {
  var out = tables.stateDetail(stateRow({ }), '');
  assert.doesNotMatch(out, /from-commit/);
  var row = stateRow();
  row.ref_kind = 'commit';
  assert.match(tables.stateDetail(row, ''), /data-filter="from-commit"/);
});

test('блок проблем появляется только когда они есть', function () {
  assert.doesNotMatch(tables.stateDetail(stateRow(), ''), /проблемы/);
  assert.match(tables.stateDetail(stateRow({ problems: ['нет ветки'] }), ''),
               /<li>нет ветки<\/li>/);
});
