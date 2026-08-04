'use strict';
var test = require('node:test');
var assert = require('node:assert');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('../../kojipatch/assets/js/viewmodel.js');

var CLASSES = ['CVE', 'SAST', 'DAST', 'other'];

function has(over, key) {
  return Object.prototype.hasOwnProperty.call(over, key);
}

function patch(name, cls) {
  return { path: 'PATCH/' + name, name: name, 'class': cls, cves: [],
           web_url: 'https://gl/blob/' + name };
}

/* Те же значения, что у помощников tests/test_render.py: тесты сравниваются
   построчно с питоновскими, и расхождение в фикстуре сбило бы сверку. */
function build(name, over) {
  over = over || {};
  var version = has(over, 'version') ? over.version : '1.0';
  var ref = has(over, 'ref') ? over.ref : 'main';
  var refKind = has(over, 'ref_kind') ? over.ref_kind : 'branch';
  var source = null;
  if (ref !== null) {
    source = { raw: 'git+ssh://git@h/g/' + name + '?#origin/' + ref,
               host: 'h', project: 'g/' + name, ref: ref, ref_kind: refKind,
               web_url: 'https://gl/tree' };
  }
  return { nvr: name + '-' + version + '-1.el9', name: name, version: version,
           release: '1.el9', epoch: null, build_id: 1, task_id: 2,
           tag_name: has(over, 'tag_name') ? over.tag_name : null,
           tags: has(over, 'tags') ? over.tags : [],
           owner: 'builder',
           completed: has(over, 'completed') ? over.completed : '2026-05-14',
           source: source,
           patch_dir_present: has(over, 'present') ? over.present : true,
           patches: has(over, 'patches') ? over.patches : [],
           rpms: has(over, 'rpms') ? over.rpms : ['a.x86_64'],
           problems: has(over, 'problems') ? over.problems : [] };
}

function snap(tag, builds, classes) {
  return { tag: tag, generated: '2026-08-03T13:20:00+03:00',
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: classes || CLASSES, builds: builds };
}

function fixture() {
  return snap('os-9.2', [
    build('nginx', { patches: [patch('CVE-2024-7347.patch', 'CVE'),
                               patch('sast-x.patch', 'SAST')] }),
    build('curl', { present: false }),
    build('vim', { ref: null, problems: ['no source url'], present: null })
  ]);
}

function data(snapshots) {
  return vm.buildPageData(snapshots || [fixture()]);
}

function byName(rows) {
  var map = {}, i;
  for (i = 0; i < rows.length; i += 1) map[rows[i].name] = rows[i];
  return map;
}

test('список классов берётся из первого снапшота', function () {
  // tests/test_render.py: test_patch_classes_come_from_classifier
  var snaps = [{ patch_classes: ['CVE', 'SAST', 'other'], builds: [] },
               { patch_classes: ['CVE', 'other'], builds: [] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'SAST', 'other']);
});

test('классы из более поздних снапшотов дописываются в конец', function () {
  var snaps = [{ patch_classes: ['CVE'], builds: [] },
               { patch_classes: ['CVE', 'DAST'], builds: [] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'DAST']);
});

test('снапшот без списка: классы выводятся из патчей по алфавиту', function () {
  var snaps = [{ builds: [{ patches: [{ 'class': 'SAST' },
                                      { 'class': 'CVE' }] }] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'SAST']);
});

test('данные страницы несут список классов из снапшота', function () {
  // tests/test_render.py: test_patch_classes_come_from_classifier
  assert.deepStrictEqual(data().patch_classes, ['CVE', 'SAST', 'DAST', 'other']);
});

test('счётчики снапшота', function () {
  // tests/test_render.py: test_snapshot_counts
  var counts = data().snapshots[0].counts;
  assert.strictEqual(counts.builds, 3);
  assert.strictEqual(counts.with_patches, 1);
  assert.strictEqual(counts.without_patches, 1);
  assert.strictEqual(counts.problems, 1);
  assert.strictEqual(counts.patch_files, 2);
  assert.deepStrictEqual(counts.by_class.CVE, { builds: 1, files: 1 });
  assert.deepStrictEqual(counts.by_class.DAST, { builds: 0, files: 0 });
});

test('несколько патчей одного класса считаются файлами, а не билдами', function () {
  var one = build('nginx', { patches: [patch('CVE-2024-1.patch', 'CVE'),
                                       patch('CVE-2024-2.patch', 'CVE'),
                                       patch('sast-x.patch', 'SAST')] });
  var block = data([snap('t', [one])]).snapshots[0];
  assert.deepStrictEqual(block.builds[0].patch_counts, { CVE: 2, SAST: 1 });
  assert.deepStrictEqual(block.counts.by_class.CVE, { builds: 1, files: 2 });
  assert.strictEqual(block.counts.patch_files, 3);
  // метка класса одна на билд, сколько бы файлов в нём ни было
  assert.deepStrictEqual(block.builds[0].tags, ['cve', 'sast']);
});

test('порядок меток не зависит от порядка файлов в каталоге', function () {
  // tests/test_render.py: test_tags_keep_one_order_whatever_the_file_order
  var forward = build('a', { patches: [patch('CVE-2024-7347.patch', 'CVE'),
                                       patch('sast-x.patch', 'SAST')] });
  var backward = build('b', { patches: [patch('SAST-x.patch', 'SAST'),
                                        patch('cve-2024-7347.patch', 'CVE')] });
  var rows = byName(data([snap('t', [forward, backward])]).snapshots[0].builds);
  assert.deepStrictEqual(rows.a.tags, ['cve', 'sast']);
  assert.deepStrictEqual(rows.b.tags, ['cve', 'sast']);
});

test('классы идут в порядке списка, а не по алфавиту', function () {
  // tests/test_render.py: test_classes_go_in_classifier_order_not_alphabetically
  var row = data([snap('t', [build('a', { patches: [
    patch('dast-x.patch', 'DAST'),
    patch('sast-x.patch', 'SAST'),
    patch('CVE-2024-7347.patch', 'CVE')] })])]).snapshots[0].builds[0];
  assert.deepStrictEqual(row.tags, ['cve', 'sast', 'dast']);
});

test('метки состояния идут в постоянном порядке', function () {
  // tests/test_render.py: test_state_tags_follow_a_fixed_order
  var row = data([snap('t', [build('a', {
    tag_name: 'parent', present: false,
    problems: ['gitlab: 404', 'internal error: boom'],
    patches: [patch('CVE-2024-7347.patch', 'CVE')] })])]).snapshots[0].builds[0];
  assert.deepStrictEqual(row.tags, ['cve', 'inherited', 'no-patch',
                                    'gitlab-error', 'internal-error']);
});

test('прямые и унаследованные билды различаются', function () {
  // tests/test_render.py: test_direct_and_inherited_builds_are_told_apart
  var rows = byName(data([snap('os-9.2', [
    build('nginx', { tag_name: 'os-9.2' }),
    build('curl', { tag_name: 'os-9-base' }),
    build('vim', { tag_name: null })])]).snapshots[0].builds);
  assert.strictEqual(rows.nginx.tagged_in, 'os-9.2');
  assert.strictEqual(rows.nginx.inherited, false);
  assert.strictEqual(rows.curl.tagged_in, 'os-9-base');
  assert.strictEqual(rows.curl.inherited, true);
  assert.ok(rows.curl.tags.indexOf('inherited') !== -1);
  assert.strictEqual(rows.nginx.tags.indexOf('inherited'), -1);
  // неизвестно — это не «прямой»: ни поля, ни метки
  assert.strictEqual(rows.vim.tagged_in, null);
  assert.strictEqual(rows.vim.inherited, null);
  assert.strictEqual(rows.vim.tags.indexOf('inherited'), -1);
});

test('строка несёт остальные теги koji', function () {
  // tests/test_render.py: test_row_carries_the_other_koji_tags
  var row = data([snap('os-9.2', [build('nginx', {
    tag_name: 'os-9-base',
    tags: ['os-9-base', 'os-9.2-candidate'] })])]).snapshots[0].builds[0];
  assert.deepStrictEqual(row.koji_tags, ['os-9-base', 'os-9.2-candidate']);
  assert.strictEqual(row.tagged_in, 'os-9-base');
});

test('без тегов в снапшоте список koji_tags пуст', function () {
  // tests/test_render.py: test_koji_tags_are_empty_when_the_snapshot_has_none
  var row = data([snap('os-9.2', [build('nginx', { tag_name: 'os-9.2' })])]
                ).snapshots[0].builds[0];
  assert.deepStrictEqual(row.koji_tags, []);
});

test('унаследованные билды считаются', function () {
  // tests/test_render.py: test_inherited_builds_are_counted
  var counts = data([snap('os-9.2', [
    build('nginx', { tag_name: 'os-9.2' }),
    build('curl', { tag_name: 'os-9-base' }),
    build('vim', { tag_name: 'os-9-base' })])]).snapshots[0].counts;
  assert.strictEqual(counts.inherited, 2);
  assert.strictEqual(counts.direct, 1);
});

test('метки пары идут в постоянном порядке', function () {
  // tests/test_render.py: test_diff_tags_follow_a_fixed_order
  var old = snap('os-9.1', [build('nginx', {
    ref: 'a', tag_name: 'os-9-base',
    patches: [patch('old.patch', 'other')],
    rpms: ['nginx-1.0-1.el9.x86_64'] })]);
  var fresh = snap('os-9.2', [build('nginx', {
    ref: 'b', tag_name: 'os-9.2',
    patches: [patch('new.patch', 'other')],
    rpms: ['nginx-1.0-1.el9.aarch64'] })]);
  var row = data([old, fresh]).pairs[0].rows[0];
  assert.deepStrictEqual(row.tags, ['unchanged', 'repackaged', 'patches+',
                                    'patches-', 'branch-changed',
                                    'tag-changed']);
});

test('строки пары несут оба тега', function () {
  // tests/test_render.py: test_pair_rows_carry_both_tags
  var old = snap('os-9.1', [build('nginx', { tag_name: 'os-9-base' })]);
  var fresh = snap('os-9.2', [build('nginx', { tag_name: 'os-9.2' })]);
  var row = data([old, fresh]).pairs[0].rows[0];
  assert.strictEqual(row.old_tagged_in, 'os-9-base');
  assert.strictEqual(row.new_tagged_in, 'os-9.2');
  assert.strictEqual(row.old_inherited, true);
  assert.strictEqual(row.new_inherited, false);
  assert.ok(row.tags.indexOf('tag-changed') !== -1);
});

test('rpm билда сгруппированы по архитектуре', function () {
  // tests/test_render.py: test_build_rpms_come_grouped_by_arch
  var page = data([snap('t', [build('nginx', { rpms: [
    'nginx-1.0-1.el9.x86_64', 'nginx-1.0-1.el9.src',
    'nginx-doc-1.0-1.el9.noarch', 'nginx-core-1.0-1.el9.x86_64'] })])]);
  assert.deepStrictEqual(page.snapshots[0].builds[0].rpms, [
    'nginx-1.0-1.el9.src', 'nginx-doc-1.0-1.el9.noarch',
    'nginx-1.0-1.el9.x86_64', 'nginx-core-1.0-1.el9.x86_64']);
});

test('билды отсортированы по имени', function () {
  // tests/test_render.py: test_builds_are_sorted_by_name
  var names = data().snapshots[0].builds.map(function (r) { return r.name; });
  assert.deepStrictEqual(names, ['curl', 'nginx', 'vim']);
});

test('поля строки билда', function () {
  // tests/test_render.py: test_build_row_fields
  var row = data().snapshots[0].builds[1];  // curl, nginx, vim
  assert.strictEqual(row.name, 'nginx');
  assert.strictEqual(row.evr, '1.0-1.el9');
  assert.strictEqual(row.branch, 'main');
  assert.deepStrictEqual(row.patch_counts, { CVE: 1, SAST: 1 });
  assert.ok(/nginx-1\.0-1\.el9$/.test(row.koji_url), row.koji_url);
});

test('ссылка на koji экранируется как urllib.parse.quote', function () {
  // эталон этого не ловит: в фикстурах NVR из букв, цифр, точек и дефисов.
  // Значение снято с kojipatch.render._koji_url на том же NVR
  var row = data([snap('t', [build('weird+name!~(x)*')])]).snapshots[0].builds[0];
  assert.strictEqual(row.koji_url,
    'https://hub/koji/search?match=exact&type=build&terms='
    + 'weird%2Bname%21~%28x%29%2A-1.0-1.el9');
});

test('без адреса koji ссылки нет', function () {
  var bare = snap('t', [build('nginx')]);
  bare.koji_web = null;
  var page = data([bare]);
  assert.strictEqual(page.snapshots[0].builds[0].koji_url, null);
  assert.strictEqual(page.snapshots[0].koji_web, null);
});

/* Снапшоты приходят из файла, который человек выбрал сам: питоновская
   модель без version, release и nvr их не делает, а чужой или обрезанный
   файл — запросто. Ниже — три места, где неизвестное могло бы уехать в
   страницу под видом определённого значения. */

test('билд без version — версии нет, а не «undefined-undefined»', function () {
  var bare = build('nginx');
  delete bare.version;
  var row = data([snap('t', [bare])]).snapshots[0].builds[0];
  assert.strictEqual(row.evr, null);
});

test('билд без release — версии нет', function () {
  var bare = build('nginx');
  bare.release = null;
  var row = data([snap('t', [bare])]).snapshots[0].builds[0];
  assert.strictEqual(row.evr, null);
});

test('билд без nvr — ссылки на koji нет, а не поиск по undefined', function () {
  var bare = build('nginx');
  delete bare.nvr;
  var row = data([snap('t', [bare])]).snapshots[0].builds[0];
  assert.strictEqual(row.koji_url, null);
});

test('в паре версии сторон тоже не выдумываются', function () {
  var oldB = build('nginx'), newB = build('nginx', { version: '1.1' });
  delete oldB.release;
  var page = data([snap('t1', [oldB]), snap('t2', [newB])]);
  var row = page.pairs[0].rows[0];
  assert.strictEqual(row.old_evr, null);
  assert.strictEqual(row.new_evr, '1.1-1.el9');
});

test('метки строки по классам патчей', function () {
  // tests/test_render.py: test_row_tags_for_patch_classes
  var rows = byName(data().snapshots[0].builds);
  assert.deepStrictEqual(rows.nginx.tags.slice().sort(), ['cve', 'sast']);
  assert.ok(rows.curl.tags.indexOf('no-patch') !== -1);
  assert.ok(rows.vim.tags.indexOf('no-source') !== -1);
});

test('метка класса считается правилом slug из дашборда', function () {
  // tests/test_render.py: test_class_tag_uses_the_dashboard_slug_rule
  var rows = data([snap('t', [build('x', { patches: [patch('a.cpp', 'C++')] })],
                       ['C++', 'other'])]).snapshots[0].builds;
  assert.ok(rows[0].tags.indexOf('c-') !== -1, rows[0].tags.join(','));
});

test('слаг совпадает с правилом дашборда', function () {
  // tests/test_render.py: test_slug_matches_the_javascript_rule
  assert.strictEqual(vm.slug('CVE'), 'cve');
  assert.strictEqual(vm.slug('C++'), 'c-');
  assert.strictEqual(vm.slug('Fix_it now'), 'fix-it-now');
  assert.strictEqual(vm.slug('DAST'), 'dast');
});

test('метка ошибки gitlab', function () {
  // tests/test_render.py: test_gitlab_error_tag
  var broken = build('bad', { problems: ['gitlab: 403 Forbidden'],
                              present: null });
  var rows = data([snap('t', [broken])]).snapshots[0].builds;
  assert.ok(rows[0].tags.indexOf('gitlab-error') !== -1);
});

test('метка сборки с коммита', function () {
  // tests/test_render.py: test_from_commit_tag
  var commit = build('c', { ref: 'a1b2c3d', ref_kind: 'commit' });
  var rows = data([snap('t', [commit])]).snapshots[0].builds;
  assert.ok(rows[0].tags.indexOf('from-commit') !== -1);
});

test('метка внутренней ошибки', function () {
  // tests/test_render.py: test_internal_error_tag
  var broken = build('bad', { problems: ['internal error: boom'],
                              present: null });
  var rows = data([snap('t', [broken])]).snapshots[0].builds;
  assert.ok(rows[0].tags.indexOf('internal-error') !== -1);
});

test('ошибка gitlab не означает внутреннюю ошибку', function () {
  // tests/test_render.py: test_gitlab_error_does_not_imply_internal_error
  var broken = build('bad', { problems: ['gitlab: 403 Forbidden'],
                              present: null });
  var rows = data([snap('t', [broken])]).snapshots[0].builds;
  assert.strictEqual(rows[0].tags.indexOf('internal-error'), -1);
});

test('пары попадают в данные страницы', function () {
  // tests/test_render.py: test_pairs_are_rendered
  var old = snap('os-9.1', [build('nginx', { version: '1.0' }),
                            build('gone')]);
  var fresh = snap('os-9.2', [build('nginx', { version: '1.1' }),
                              build('fresh')]);
  var pair = data([old, fresh]).pairs[0];
  assert.deepStrictEqual([pair.old, pair.new], ['os-9.1', 'os-9.2']);
  var rows = byName(pair.rows);
  assert.strictEqual(rows.nginx.old_evr, '1.0-1.el9');
  assert.strictEqual(rows.nginx.new_evr, '1.1-1.el9');
  assert.ok(rows.nginx.tags.indexOf('upgraded') !== -1);
  assert.strictEqual(rows.gone.status, 'removed');
  assert.strictEqual(pair.counts.added, 1);
});

test('неизменившийся компонент помечен changed: false', function () {
  // поле задаёт умолчательный фильтр вкладки «Изменения»: с ним человек
  // первым делом видит только изменившиеся строки. Эталон паритета этого
  // не сторожит — в нём изменились все пять компонентов
  var old = snap('os-9.1', [build('nginx'), build('curl')]);
  var fresh = snap('os-9.2', [build('nginx'), build('curl', { version: '1.1' })]);
  var pair = data([old, fresh]).pairs[0];
  var rows = byName(pair.rows);
  assert.strictEqual(rows.nginx.changed, false);
  assert.strictEqual(rows.curl.changed, true);
  assert.strictEqual(pair.counts.changed, 1);
});

/* Имена классов патчей приходят из конфига, а голый объект несёт свойства
   Object.prototype: счётчик по ключу «constructor» без охраны выдаёт не
   ноль, а функцию, и она уезжает на экран. */
test('класс патчей может называться свойством Object', function () {
  var one = build('nginx', { patches: [patch('a.patch', 'constructor'),
                                       patch('b.patch', 'constructor'),
                                       patch('c.patch', 'CVE')] });
  var block = data([snap('t', [one], ['constructor', 'CVE'])]).snapshots[0];
  assert.deepStrictEqual(block.builds[0].patch_counts,
                         { constructor: 2, CVE: 1 });
  assert.deepStrictEqual(block.counts.by_class.constructor,
                         { builds: 1, files: 2 });
  assert.strictEqual(block.counts.patch_files, 3);
});

test('класс с таким именем не теряется и при выводе из патчей', function () {
  var snaps = [{ builds: [{ patches: [{ 'class': 'constructor' },
                                      { 'class': 'CVE' }] }] }];
  assert.deepStrictEqual(vm.patchClassesOf(snaps), ['CVE', 'constructor']);
});

test('строки пары несут выровненные строки rpm', function () {
  // tests/test_render.py: test_pair_rows_carry_aligned_rpm_rows
  var old = snap('os-9.1', [build('nginx', {
    version: '1.0', rpms: ['nginx-1.0-1.el9.x86_64',
                           'nginx-mod-1.0-1.el9.x86_64'] })]);
  var fresh = snap('os-9.2', [build('nginx', {
    version: '1.1', rpms: ['nginx-1.1-1.el9.x86_64'] })]);
  var row = data([old, fresh]).pairs[0].rows[0];
  assert.deepStrictEqual(row.rpm_rows,
    [['nginx-1.0-1.el9.x86_64', 'nginx-1.1-1.el9.x86_64'],
     ['nginx-mod-1.0-1.el9.x86_64', null]]);
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'old_rpms'));
  assert.ok(!Object.prototype.hasOwnProperty.call(row, 'new_rpms'));
});

test('сводная пара помечена', function () {
  // tests/test_render.py: test_summary_pair_is_marked
  var snaps = [snap('a', []), snap('b', []), snap('c', [])];
  var pairs = data(snaps).pairs;
  assert.strictEqual(pairs[pairs.length - 1].summary, true);
});

test('UTC становится МСК', function () {
  // tests/test_render.py: test_utc_becomes_msk
  assert.strictEqual(vm.toMsk('2026-05-14 10:11:12'), '2026-05-14 13:11:12');
  assert.strictEqual(vm.toMsk('2026-05-14 21:30:00'), '2026-05-15 00:30:00');
});

test('перевод переходит через полночь', function () {
  // tests/test_render.py: test_conversion_crosses_midnight
  assert.strictEqual(vm.toMsk('2026-05-14 22:30:00'), '2026-05-15 01:30:00');
});

test('перевод переходит через месяц', function () {
  // tests/test_render.py: test_conversion_crosses_a_month
  assert.strictEqual(vm.toMsk('2026-05-31 23:00:00'), '2026-06-01 02:00:00');
});

test('дата без времени не сдвигается', function () {
  // tests/test_render.py: test_date_without_time_is_left_alone
  assert.strictEqual(vm.toMsk('2026-05-14'), '2026-05-14');
  // тот же день с известным часом сдвигается — значит дату оставили как есть
  // осознанно, а не потому, что функция вообще ничего не делает
  assert.strictEqual(vm.toMsk('2026-05-14 00:00:00'), '2026-05-14 03:00:00');
});

test('неразбираемое значение остаётся как есть', function () {
  // tests/test_render.py: test_unparsable_value_survives_as_is
  assert.strictEqual(vm.toMsk('когда-то давно'), 'когда-то давно');
  assert.strictEqual(vm.toMsk('никогда'), 'никогда');
});

test('пустые значения', function () {
  // tests/test_render.py: test_empty_values
  assert.strictEqual(vm.toMsk(null), null);
  assert.strictEqual(vm.toMsk(''), '');
  // undefined — то же «неизвестно», что и None в питоне: в JSON должен
  // получиться null, а не пропавший ключ
  assert.strictEqual(vm.toMsk(undefined), null);
});

test('строка билда несёт московское время', function () {
  // tests/test_render.py: test_build_row_carries_moscow_time
  var rows = data([snap('t', [build('nginx')])]).snapshots[0].builds;
  // фикстура собрана в 2026-05-14 без времени — остаётся как есть
  assert.strictEqual(rows[0].completed, '2026-05-14');
});

test('строка билда сдвигает полную метку времени', function () {
  // tests/test_render.py: test_build_row_shifts_a_full_timestamp
  var one = build('nginx', { completed: '2026-05-14 22:30:00' });
  var rows = data([snap('t', [one])]).snapshots[0].builds;
  assert.strictEqual(rows[0].completed, '2026-05-15 01:30:00');
});

test('снапшот прежней версии: пропущенные поля становятся null', function () {
  // в JSON undefined — это отсутствие ключа, а не «неизвестно». Дашборд
  // читает файл без питоновской модели, и её значений по умолчанию тут нет
  var bare = { name: 'bare', nvr: 'bare-1-1.el9', version: '1',
               release: '1.el9' };
  var row = JSON.parse(JSON.stringify(
    data([snap('t', [bare])]).snapshots[0].builds[0]));
  assert.strictEqual(row.branch, null);
  assert.strictEqual(row.ref_kind, 'none');
  assert.strictEqual(row.project, null);
  assert.strictEqual(row.source_url, null);
  assert.strictEqual(row.completed, null);
  assert.strictEqual(row.owner, null);
  assert.strictEqual(row.build_id, null);
  assert.strictEqual(row.task_id, null);
  assert.strictEqual(row.tagged_in, null);
  assert.strictEqual(row.inherited, null);
  assert.strictEqual(row.patch_dir_present, null);
  assert.deepStrictEqual(row.koji_tags, []);
  assert.deepStrictEqual(row.patches, []);
  assert.deepStrictEqual(row.rpms, []);
  assert.deepStrictEqual(row.problems, []);
  assert.deepStrictEqual(row.patch_counts, {});
});

test('ссылка строки пары ведёт на хаб своего снапшота', function () {
  // расхождение с render.py, где хаб брался у первого снапшота: файлы
  // разных прогонов открываются вместе, и общий адрес вёл бы на чужой хаб
  var old = snap('os-9.1', [build('nginx', { version: '1.0' }),
                            build('gone')]);
  var fresh = snap('os-9.2', [build('nginx', { version: '1.1' }),
                              build('added')]);
  old.koji_web = 'https://old/koji';
  fresh.koji_web = 'https://new/koji';
  var rows = byName(data([old, fresh]).pairs[0].rows);
  assert.ok(rows.gone.koji_url.indexOf('https://old/koji/') === 0,
            rows.gone.koji_url);
  assert.ok(rows.added.koji_url.indexOf('https://new/koji/') === 0,
            rows.added.koji_url);
  assert.ok(rows.nginx.koji_url.indexOf('https://new/koji/') === 0,
            rows.nginx.koji_url);
});

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, rel), 'utf8'));
}

/* page-data.golden.json порождён питоновским render.py на тех же
   фикстурах rich-old.json/rich-new.json — эталон паритета, с которым
   сверяется buildPageData. Раньше его пересчитывал и сторожил
   tests/test_parity.py (python3 -m tests.test_parity --update); тот
   файл ушёл вместе с render.py в Задаче 9 переноса представления в
   браузер, автоматического пересчёта больше нет. Править эталон теперь
   можно только руками и осознанно — тесты ниже об этом не предупредят,
   они лишь сверяют то, что в файле уже лежит. */
test('данные страницы совпадают с питоновским эталоном', function () {
  var snaps = [].concat(readJson('../fixtures/rich-old.json'),
                        readJson('../fixtures/rich-new.json'));
  /* Через JSON туда и обратно: так undefined превращается в отсутствие
     ключа и расходится с null эталона — ровно та ошибка, которую этот
     тест обязан ловить. */
  var actual = JSON.parse(JSON.stringify(vm.buildPageData(snaps)));
  assert.deepStrictEqual(actual, readJson('./fixtures/page-data.golden.json'));
});

test('эталон паритета содержит интересные случаи, а не только совпадает с собой', function () {
  // побайтовая сверка выше ничего не говорит о том, что в эталоне вообще
  // есть случаи, на которых порт способен сломаться — молчаливое обеднение
  // фикстур или эталона осталось бы незамеченным. Перенесено из
  // tests/test_parity.py: test_golden_covers_the_interesting_cases
  var golden = readJson('./fixtures/page-data.golden.json');
  var pair = golden.pairs[0];
  var statuses = {}, i;
  for (i = 0; i < pair.rows.length; i++) statuses[pair.rows[i].status] = true;
  assert.deepStrictEqual(Object.keys(statuses).sort(),
                         ['added', 'downgraded', 'removed', 'unchanged',
                          'upgraded']);
  assert.ok(pair.counts.tag_changed);
  assert.ok(pair.counts.repackaged);
  assert.ok(pair.counts.branch_changed);
  var rows = golden.snapshots[0].builds;
  assert.ok(rows.some(function (r) { return r.tagged_in === null; }));
  assert.ok(rows.some(function (r) { return r.inherited === true; }));
});
