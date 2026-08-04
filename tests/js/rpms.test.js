'use strict';
var test = require('node:test');
var assert = require('node:assert');
var rpms = require('../../kojipatch/assets/js/rpms.js');

test('архитектура — хвост после последней точки', function () {
  assert.strictEqual(rpms.archOf('nginx-1.24.0-3.el9.x86_64'), 'x86_64');
});

test('точки внутри версии не сбивают', function () {
  assert.strictEqual(rpms.archOf('kernel-5.14.0-611.34.1.el9_7.x86_64'),
                     'x86_64');
});

test('строка без точки', function () {
  assert.strictEqual(rpms.archOf('nginx'), '?');
});

test('сперва src, потом noarch, потом остальные по алфавиту', function () {
  assert.deepStrictEqual(
    rpms.sortRpms(['p-1-1.x86_64', 'p-1-1.noarch', 'p-1-1.src',
                   'p-1-1.aarch64']),
    ['p-1-1.src', 'p-1-1.noarch', 'p-1-1.aarch64', 'p-1-1.x86_64']);
});

test('группировка по архитектуре важнее имени', function () {
  assert.deepStrictEqual(
    rpms.sortRpms(['zzz-1-1.src', 'aaa-1-1.x86_64']),
    ['zzz-1-1.src', 'aaa-1-1.x86_64']);
});

test('пустой список', function () {
  assert.deepStrictEqual(rpms.sortRpms([]), []);
});

test('src — тоже архитектура в понимании archOf', function () {
  // tests/test_rpms.py: test_source_rpm
  assert.strictEqual(rpms.archOf('httpd-2.4.62-4.el9.src'), 'src');
});

test('ключ подпакета из diff — тот же name.arch', function () {
  // tests/test_rpms.py: test_key_without_version_release_also_works
  assert.strictEqual(rpms.archOf('httpd-core.noarch'), 'noarch');
});

test('прочие архитектуры идут по алфавиту', function () {
  // tests/test_rpms.py: test_other_arches_go_alphabetically
  var got = rpms.sortRpms(['a-1-1.x86_64', 'a-1-1.aarch64', 'a-1-1.ppc64le']);
  assert.deepStrictEqual(got.map(function (x) { return rpms.archOf(x); }),
                          ['aarch64', 'ppc64le', 'x86_64']);
});

test('внутри архитектуры пакеты сортируются по имени', function () {
  // tests/test_rpms.py: test_inside_an_arch_packages_are_sorted_by_name
  assert.deepStrictEqual(
    rpms.sortRpms(['zlib-1-1.x86_64', 'acl-1-1.x86_64', 'mc-1-1.x86_64']),
    ['acl-1-1.x86_64', 'mc-1-1.x86_64', 'zlib-1-1.x86_64']);
});
