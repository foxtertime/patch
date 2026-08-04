'use strict';
var test = require('node:test');
var assert = require('node:assert');
var diff = require('../../kojipatch/assets/js/diff.js');

function build(over) {
  var b = { nvr: 'nginx-1.0-1.el9', name: 'nginx', version: '1.0',
            release: '1.el9', epoch: null, tag_name: 'os-9.1', tags: [],
            source: { ref: 'os-9.1', ref_kind: 'branch' },
            patches: [], rpms: [], problems: [] };
  for (var key in over) if (over.hasOwnProperty(key)) b[key] = over[key];
  return b;
}

function snap(tag, builds) {
  return { tag: tag, generated: '2026-08-01T00:00:00+03:00',
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: ['CVE', 'other'], builds: builds };
}

function only(pair) { return pair.components[0]; }

test('компонент появился', function () {
  var pair = diff.diffSnapshots(snap('a', []), snap('b', [build({})]));
  assert.strictEqual(only(pair).status, 'added');
  assert.strictEqual(only(pair).old, null);
  assert.deepStrictEqual(only(pair).patches_added, []);
});

test('компонент исчез', function () {
  var pair = diff.diffSnapshots(snap('a', [build({})]), snap('b', []));
  assert.strictEqual(only(pair).status, 'removed');
  assert.strictEqual(only(pair).new, null);
});

test('версия выросла', function () {
  var pair = diff.diffSnapshots(
    snap('a', [build({})]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0' })]));
  assert.strictEqual(only(pair).status, 'upgraded');
});

test('состав подпакетов не изменился при росте версии', function () {
  // tests/test_diff.py: test_version_bump_alone_is_not_repackaged —
  // чистая пересборка: подпакеты те же, поехала только версия
  var pair = diff.diffSnapshots(
    snap('a', [build({ rpms: ['nginx-1.0-1.el9.x86_64'] })]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0',
                       rpms: ['nginx-2.0-1.el9.x86_64'] })]));
  var component = only(pair);
  assert.strictEqual(component.status, 'upgraded');
  assert.strictEqual(component.repackaged, false);
  assert.deepStrictEqual(component.rpms_added, []);
  assert.deepStrictEqual(component.rpms_removed, []);
});

test('переезд между тегами — только при том же NVR', function () {
  var pair = diff.diffSnapshots(
    snap('a', [build({ tag_name: 'os-9.0' })]),
    snap('b', [build({ tag_name: 'os-9.2' })]));
  assert.strictEqual(only(pair).tag_changed, true);
  var upgraded = diff.diffSnapshots(
    snap('a', [build({ tag_name: 'os-9.0' })]),
    snap('b', [build({ nvr: 'nginx-2.0-1.el9', version: '2.0',
                       tag_name: 'os-9.2' })]));
  assert.strictEqual(only(upgraded).tag_changed, false);
});

test('changed — булево, а не список', function () {
  var pair = diff.diffSnapshots(snap('a', [build({})]), snap('b', [build({})]));
  assert.strictEqual(only(pair).changed, false);
  // tests/test_diff.py: test_changed_returns_a_bool_not_a_list — на входе,
  // где реально есть изменение, поле обязано быть строго true, а не
  // непустым списком причин
  var changedPair = diff.diffSnapshots(
    snap('a', [build({ patches: [{ path: 'a.patch' }] })]),
    snap('b', [build({ patches: [{ path: 'a.patch' }, { path: 'b.patch' }] })]));
  assert.strictEqual(only(changedPair).changed, true);
});

/* Остальные 37 тестов — перенос tests/test_diff.py по одному на каждый
   питоновский тест; данные берутся из одноимённых тестов. Билдеры ниже
   воспроизводят model.Build/Snapshot как сырые объекты, без своих значений
   по умолчанию из шага 1. */

function nvra2(sub, version, release, arch) {
  arch = arch || 'x86_64';
  return sub + '-' + version + '-' + release + '.' + arch;
}

function build2(name, opts) {
  opts = opts || {};
  var version = opts.version || '1.0';
  var release = opts.release || '1.el9';
  var patches = opts.patches || [];
  var rpms = opts.rpms || [];
  var ref = opts.ref === undefined ? 'main' : opts.ref;
  var epoch = opts.epoch === undefined ? null : opts.epoch;
  var tagName = opts.tag_name === undefined ? null : opts.tag_name;
  if (opts.subpackages) {
    rpms = opts.subpackages.map(function (sub) {
      return nvra2(sub, version, release);
    });
  }
  return {
    nvr: name + '-' + version + '-' + release, name: name, version: version,
    release: release, epoch: epoch, tag_name: tagName,
    source: { raw: 'r', host: 'h', project: 'g/' + name, ref: ref,
              ref_kind: 'branch' },
    patch_dir_present: true,
    patches: patches.map(function (p) {
      return { path: 'PATCH/' + p, name: p,
               cls: p.indexOf('CVE') === 0 ? 'CVE' : 'other', cves: [] };
    }),
    rpms: rpms.slice(), problems: []
  };
}

function snap2(tag, builds) {
  return { tag: tag, generated: 'g', koji_hub: 'h', koji_web: null,
           builds: builds.slice() };
}

function byName(pair) {
  var map = {};
  pair.components.forEach(function (c) { map[c.name] = c; });
  return map;
}

function diffOf(oldBuilds, newBuilds) {
  return byName(diff.diffSnapshots(snap2('a', oldBuilds), snap2('b', newBuilds)));
}

function diffOfTags(oldTag, oldBuilds, newTag, newBuilds) {
  return byName(diff.diffSnapshots(snap2(oldTag, oldBuilds), snap2(newTag, newBuilds)));
}

/* StatusTest */
// test_added и test_removed уже покрыты шагом 1 («компонент появился»,
// «компонент исчез»); test_upgraded — тестом «версия выросла».

test('test_unchanged', function () {
  var got = diffOf([build2('nginx')], [build2('nginx')]);
  assert.strictEqual(got.nginx.status, 'unchanged');
});

test('test_downgraded', function () {
  var got = diffOf([build2('nginx', { version: '1.1' })],
                    [build2('nginx', { version: '1.0' })]);
  assert.strictEqual(got.nginx.status, 'downgraded');
});

test('test_release_only_change_is_an_upgrade', function () {
  var got = diffOf([build2('nginx', { version: '1.0', release: '1.el9' })],
                    [build2('nginx', { version: '1.0', release: '2.el9' })]);
  assert.strictEqual(got.nginx.status, 'upgraded');
});

test('test_epoch_dominates', function () {
  var got = diffOf([build2('nginx', { version: '9.0', epoch: null })],
                    [build2('nginx', { version: '1.0', epoch: 1 })]);
  assert.strictEqual(got.nginx.status, 'upgraded');
});

/* DetailsTest */

test('test_patch_delta', function () {
  var got = diffOf(
    [build2('nginx', { patches: ['CVE-2024-1111.patch', 'old.patch'] })],
    [build2('nginx', { patches: ['CVE-2024-1111.patch', 'new.patch'] })]);
  var component = got.nginx;
  assert.deepStrictEqual(component.patches_added, ['PATCH/new.patch']);
  assert.deepStrictEqual(component.patches_removed, ['PATCH/old.patch']);
});

test('test_rpm_delta_sets_repackaged', function () {
  var got = diffOf(
    [build2('nginx', { subpackages: ['nginx', 'nginx-mod'] })],
    [build2('nginx', { subpackages: ['nginx', 'nginx-core'] })]);
  var component = got.nginx;
  assert.deepStrictEqual(component.rpms_added, ['nginx-core-1.0-1.el9.x86_64']);
  assert.deepStrictEqual(component.rpms_removed, ['nginx-mod-1.0-1.el9.x86_64']);
  assert.strictEqual(component.repackaged, true);
});

// test_version_bump_alone_is_not_repackaged уже покрыт шагом 1 (тест
// «состав подпакетов не изменился при росте версии», усилен всеми
// проверками из питоновского теста).

test('test_new_subpackage_on_a_version_bump_is_repackaged', function () {
  var got = diffOf(
    [build2('nginx', { version: '1.24.0', subpackages: ['nginx', 'nginx-core'] })],
    [build2('nginx', { version: '1.25.0',
                        subpackages: ['nginx', 'nginx-core', 'nginx-mod-mail'] })]);
  var component = got.nginx;
  assert.strictEqual(component.repackaged, true);
  // наружу отдаём полный NVRA — по нему дашборд красит строку «стало»
  assert.deepStrictEqual(component.rpms_added,
                          ['nginx-mod-mail-1.25.0-1.el9.x86_64']);
  assert.deepStrictEqual(component.rpms_removed, []);
});

test('test_release_only_bump_is_not_repackaged', function () {
  var got = diffOf(
    [build2('nginx', { version: '1.24.0', release: '1.el9', subpackages: ['nginx'] })],
    [build2('nginx', { version: '1.24.0', release: '2.el9', subpackages: ['nginx'] })]);
  assert.strictEqual(got.nginx.repackaged, false);
});

test('test_arch_change_is_repackaged', function () {
  var got = diffOf(
    [build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'x86_64')] })],
    [build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'aarch64')] })]);
  assert.strictEqual(got.nginx.repackaged, true);
});

test('test_branch_change_is_flagged', function () {
  var got = diffOf([build2('nginx', { ref: 'br-9.1' })],
                    [build2('nginx', { ref: 'br-9.2' })]);
  assert.strictEqual(got.nginx.branch_changed, true);
});

test('test_same_branch_is_not_flagged', function () {
  var got = diffOf([build2('nginx')], [build2('nginx')]);
  assert.strictEqual(got.nginx.branch_changed, false);
});

// test_changed_returns_a_bool_not_a_list уже покрыт шагом 1 (тест
// «changed — булево, а не список», усилен проверкой true-случая).

test('test_added_component_has_no_deltas', function () {
  var got = diffOf([], [build2('nginx', { patches: ['a.patch'] })]);
  assert.deepStrictEqual(got.nginx.patches_added, []);
  assert.strictEqual(got.nginx.repackaged, false);
});

/* TagChangedTest — переезд билда между тегами. Сравнивается сам tag_name, а
   не «прямой/унаследованный»: последнее зависит от того, какой тег мы
   сейчас рассматриваем, и меняется само собой при обычном наследовании. */

// test_retagged_directly_into_the_new_tag уже покрыт шагом 1 (первая
// часть теста «переезд между тегами — только при том же NVR»).

test('test_same_tag_on_both_sides_is_not_a_change', function () {
  var got = diffOfTags('os-9.1', [build2('nginx', { tag_name: 'os-9-base' })],
                        'os-9.2', [build2('nginx', { tag_name: 'os-9-base' })]);
  assert.strictEqual(got.nginx.tag_changed, false);
});

test('test_plain_inheritance_of_the_older_tag_is_not_a_change', function () {
  // os-9.2 наследует os-9.1: нетронутый билд в старом снапшоте прямой,
  // в новом — унаследованный, но сам он никуда не переезжал, и
  // помечать такое переездом значило бы пометить полтега
  var got = diffOfTags('os-9.1', [build2('nginx', { tag_name: 'os-9.1' })],
                        'os-9.2', [build2('nginx', { tag_name: 'os-9.1' })]);
  assert.strictEqual(got.nginx.tag_changed, false);
});

test('test_a_new_version_in_a_new_tag_is_not_a_move', function () {
  // обновлённый компонент — это другой билд, и лежать в новом теге для
  // него нормально. Пометить такое переездом значило бы поставить
  // метку каждому обновлению в теге
  var got = diffOfTags('os-9.1', [build2('nginx', { version: '1.0', tag_name: 'os-9.1' })],
                        'os-9.2', [build2('nginx', { version: '1.1', tag_name: 'os-9.2' })]);
  assert.strictEqual(got.nginx.status, 'upgraded');
  assert.strictEqual(got.nginx.tag_changed, false);
});

test('test_unknown_tag_on_either_side_is_not_a_change', function () {
  // снапшот прежней версии: сказать нечего, и выдумывать нельзя
  var got = diffOfTags('os-9.1', [build2('nginx', { tag_name: null })],
                        'os-9.2', [build2('nginx', { tag_name: 'os-9.2' })]);
  assert.strictEqual(got.nginx.tag_changed, false);
});

test('test_tag_change_alone_makes_the_component_changed', function () {
  var got = diffOfTags('os-9.1', [build2('nginx', { tag_name: 'os-9-base' })],
                        'os-9.2', [build2('nginx', { tag_name: 'os-9.2' })]);
  assert.strictEqual(got.nginx.changed, true);
});

test('test_counts_have_a_bucket', function () {
  var pair = diff.diffSnapshots(
    snap2('os-9.1', [build2('nginx', { tag_name: 'os-9-base' }),
                      build2('curl', { tag_name: 'os-9-base' })]),
    snap2('os-9.2', [build2('nginx', { tag_name: 'os-9.2' }),
                      build2('curl', { tag_name: 'os-9-base' })]));
  assert.strictEqual(pair.counts.tag_changed, 1);
});

/* AlignRpmsTest — строки «было/стало» для подпакетов: один подпакет — одна
   строка. */

test('test_same_subpackage_stands_opposite_itself', function () {
  // версия билда поехала, NVRA слева и справа разные — но это один и
  // тот же подпакет, и он обязан стоять на одной высоте
  var rows = diff.alignRpms(
    build2('nginx', { version: '1.24.0', subpackages: ['nginx'] }),
    build2('nginx', { version: '1.25.0', subpackages: ['nginx'] }));
  assert.deepStrictEqual(rows, [['nginx-1.24.0-1.el9.x86_64',
                                  'nginx-1.25.0-1.el9.x86_64']]);
});

test('test_disappeared_subpackage_keeps_its_place', function () {
  var rows = diff.alignRpms(
    build2('nginx', { subpackages: ['nginx', 'nginx-mod'] }),
    build2('nginx', { subpackages: ['nginx'] }));
  assert.deepStrictEqual(rows, [['nginx-1.0-1.el9.x86_64', 'nginx-1.0-1.el9.x86_64'],
                                 ['nginx-mod-1.0-1.el9.x86_64', null]]);
});

test('test_new_subpackage_goes_to_the_bottom', function () {
  // «aaa» встал бы первым по алфавиту, но пришедшее место
  // существующих строк не сдвигает — иначе поедет выравнивание
  var rows = diff.alignRpms(
    build2('nginx', { subpackages: ['nginx'] }),
    build2('nginx', { subpackages: ['aaa-tool', 'nginx'] }));
  assert.deepStrictEqual(rows, [['nginx-1.0-1.el9.x86_64', 'nginx-1.0-1.el9.x86_64'],
                                 [null, 'aaa-tool-1.0-1.el9.x86_64']]);
});

test('test_left_column_is_sorted', function () {
  var rows = diff.alignRpms(
    build2('nginx', { subpackages: ['zzz', 'aaa', 'mmm'] }),
    build2('nginx', { subpackages: ['zzz', 'aaa', 'mmm'] }));
  assert.deepStrictEqual(rows.map(function (row) { return row[0].split('-1.0-')[0]; }),
                          ['aaa', 'mmm', 'zzz']);
});

test('test_component_without_an_old_build', function () {
  var rows = diff.alignRpms(null, build2('nginx', { subpackages: ['nginx'] }));
  assert.deepStrictEqual(rows, [[null, 'nginx-1.0-1.el9.x86_64']]);
});

test('test_component_without_a_new_build', function () {
  var rows = diff.alignRpms(build2('nginx', { subpackages: ['nginx'] }), null);
  assert.deepStrictEqual(rows, [['nginx-1.0-1.el9.x86_64', null]]);
});

test('test_no_builds_at_all', function () {
  assert.deepStrictEqual(diff.alignRpms(null, null), []);
});

test('test_arch_split_is_two_rows', function () {
  // один и тот же name в двух архитектурах — разные ключи, разные
  // строки: иначе aarch64 «превратился бы» в x86_64
  var rows = diff.alignRpms(
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'aarch64'),
                              nvra2('nginx', '1.0', '1.el9', 'x86_64')] }),
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'x86_64')] }));
  assert.deepStrictEqual(rows, [['nginx-1.0-1.el9.aarch64', null],
                                 ['nginx-1.0-1.el9.x86_64', 'nginx-1.0-1.el9.x86_64']]);
});

test('test_rows_come_grouped_by_arch', function () {
  // дашборд рисует группы, просто разрезая строки по смене
  // архитектуры, — значит порядок обязан задавать этот код
  var both = [nvra2('nginx', '1.0', '1.el9', 'x86_64'),
              nvra2('nginx', '1.0', '1.el9', 'src'),
              nvra2('nginx-doc', '1.0', '1.el9', 'noarch')];
  var rows = diff.alignRpms(build2('nginx', { rpms: both }), build2('nginx', { rpms: both }));
  var rpms = require('../../kojipatch/assets/js/rpms.js');
  assert.deepStrictEqual(rows.map(function (row) { return rpms.archOf(row[0]); }),
                          ['src', 'noarch', 'x86_64']);
});

test('test_new_subpackage_goes_to_the_bottom_of_its_own_arch', function () {
  // «вниз списка» — вниз своей группы, иначе пакет уедет под чужой
  // заголовок архитектуры
  var rows = diff.alignRpms(
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'noarch'),
                              nvra2('nginx', '1.0', '1.el9', 'x86_64')] }),
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'noarch'),
                              nvra2('aaa', '1.0', '1.el9', 'noarch'),
                              nvra2('nginx', '1.0', '1.el9', 'x86_64')] }));
  assert.deepStrictEqual(rows, [
    ['nginx-1.0-1.el9.noarch', 'nginx-1.0-1.el9.noarch'],
    [null, 'aaa-1.0-1.el9.noarch'],
    ['nginx-1.0-1.el9.x86_64', 'nginx-1.0-1.el9.x86_64']]);
});

test('test_arch_present_on_one_side_only_still_keeps_its_group', function () {
  var rows = diff.alignRpms(
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'aarch64')] }),
    build2('nginx', { rpms: [nvra2('nginx', '1.0', '1.el9', 'x86_64')] }));
  assert.deepStrictEqual(rows, [['nginx-1.0-1.el9.aarch64', null],
                                 [null, 'nginx-1.0-1.el9.x86_64']]);
});

test('test_rows_agree_with_the_deltas', function () {
  // выравнивание и rpms_added/rpms_removed считают одно и то же:
  // пустая ячейка справа — это ровно «ушедший» подпакет
  var old = build2('nginx', { subpackages: ['nginx', 'nginx-mod'] });
  var neu = build2('nginx', { subpackages: ['nginx', 'nginx-core'] });
  var component = byName(diff.diffSnapshots(snap2('a', [old]), snap2('b', [neu]))).nginx;
  var rows = diff.alignRpms(old, neu);
  assert.deepStrictEqual(
    rows.filter(function (r) { return r[1] === null; }).map(function (r) { return r[0]; }),
    component.rpms_removed);
  assert.deepStrictEqual(
    rows.filter(function (r) { return r[0] === null; }).map(function (r) { return r[1]; }),
    component.rpms_added);
});

/* CountsTest */

test('test_counts_cover_every_bucket', function () {
  var pair = diff.diffSnapshots(
    snap2('a', [build2('keep'), build2('gone'), build2('up', { version: '1.0' }),
                build2('down', { version: '2.0' }),
                build2('patched', { patches: ['old.patch'] })]),
    snap2('b', [build2('keep'), build2('new'), build2('up', { version: '1.1' }),
                build2('down', { version: '1.0' }),
                build2('patched', { patches: ['new.patch'] })]));
  var counts = pair.counts;
  assert.strictEqual(counts.added, 1);
  assert.strictEqual(counts.removed, 1);
  assert.strictEqual(counts.upgraded, 1);
  assert.strictEqual(counts.downgraded, 1);
  assert.strictEqual(counts.unchanged, 2);
  assert.strictEqual(counts.patches_added, 1);
  assert.strictEqual(counts.patches_removed, 1);
  assert.strictEqual(counts.repackaged, 0);
  assert.strictEqual(counts.branch_changed, 0);
});

test('test_tags_are_recorded', function () {
  var pair = diff.diffSnapshots(snap2('t1', []), snap2('t2', []));
  assert.strictEqual(pair.old_tag, 't1');
  assert.strictEqual(pair.new_tag, 't2');
  assert.strictEqual(pair.is_summary, false);
});

test('test_components_sorted_by_name', function () {
  var pair = diff.diffSnapshots(snap2('a', [build2('zzz'), build2('aaa')]),
                                 snap2('b', [build2('aaa'), build2('zzz')]));
  assert.deepStrictEqual(pair.components.map(function (c) { return c.name; }),
                          ['aaa', 'zzz']);
});

/* ChainTest */

test('test_single_snapshot_gives_no_pairs', function () {
  assert.deepStrictEqual(diff.diffChain([snap2('a', [])]), []);
});

test('test_two_snapshots_give_one_pair_without_summary', function () {
  var pairs = diff.diffChain([snap2('a', []), snap2('b', [])]);
  assert.strictEqual(pairs.length, 1);
  assert.strictEqual(pairs[0].is_summary, false);
});

test('test_three_snapshots_give_two_steps_plus_summary', function () {
  var pairs = diff.diffChain([snap2('a', []), snap2('b', []), snap2('c', [])]);
  assert.deepStrictEqual(
    pairs.map(function (p) { return [p.old_tag, p.new_tag, p.is_summary]; }),
    [['a', 'b', false], ['b', 'c', false], ['a', 'c', true]]);
});

test('test_summary_compares_endpoints_not_steps', function () {
  // компонент удалён на шаге 2 и вернулся на шаге 3 — в итоге он неизменен
  var pairs = diff.diffChain([snap2('a', [build2('nginx')]), snap2('b', []),
                               snap2('c', [build2('nginx')])]);
  var summary = pairs[pairs.length - 1];
  var component = byName(summary).nginx;
  assert.strictEqual(component.status, 'unchanged');
});
