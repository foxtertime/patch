'use strict';
/* Поиск по строке: совпало ли, и стоит ли ради этого совпадения строку
   разворачивать. Страница здесь не нужна вовсе — на входе строка и
   запрос, на выходе два булевых значения. */
var test = require('node:test');
var assert = require('node:assert');
var search = require('../../dashboard/assets/js/search.js');

test('пустой запрос показывает строку и не разворачивает её', function () {
  var out = search.scanState({ name: 'nginx' }, '');
  assert.deepStrictEqual(out, { show: true, deep: false });
});

test('поиск по видимому полю не разворачивает строку', function () {
  var row = { name: 'nginx', patches: [], rpms: [], problems: [] };
  var out = search.scanState(row, 'nginx');
  assert.strictEqual(out.show, true);
  assert.strictEqual(out.deep, false);
});

test('поиск по владельцу строку не разворачивает', function () {
  /* Владелец стоит в самой строке, и разворачивать её незачем: правило
     «развернуть» — про совпадения, которых в строке не видно. */
  var row = { name: 'nginx', owner: 'builder', patches: [], rpms: [],
              problems: [] };
  var out = search.scanState(row, 'builder');
  assert.strictEqual(out.show, true);
  assert.strictEqual(out.deep, false);
});

test('поиск по времени сборки билда строку тоже не разворачивает', function () {
  var row = { name: 'nginx', completed: '2026-05-14 10:00:00',
              patches: [], rpms: [], problems: [] };
  var out = search.scanState(row, '2026-05-14');
  assert.strictEqual(out.show, true);
  assert.strictEqual(out.deep, false);
});

test('совпадение только в деталях разворачивает строку', function () {
  var row = { name: 'nginx',
              patches: [{ name: 'cve.patch', path: 'PATCH/cve.patch',
                          'class': 'CVE', cves: [] }],
              rpms: [], problems: [] };
  var out = search.scanState(row, 'cve.patch');
  assert.strictEqual(out.show, true);
  assert.strictEqual(out.deep, true);
});

test('совпадение только в ghost-патче находит строку и разворачивает её',
  function () {
    /* Ghost-патч — это «влито в ветку, не собрано»: патча нет в самом
       билде, он лежит только в ghosts, а секция с ним — в раскрытии.
       Не найти строку по нему значило бы, что вопрос «какие пакеты ещё
       ждут CVE-2026-1234» дашборд не отвечает вовсе. */
    var row = { name: 'nginx', patches: [], rpms: [], problems: [],
                ghosts: [{ name: 'CVE-2026-1234.patch',
                           path: 'PATCH/CVE-2026-1234.patch',
                           'class': 'CVE', cves: [] }] };
    var out = search.scanState(row, 'cve-2026-1234');
    assert.strictEqual(out.show, true);
    assert.strictEqual(out.deep, true);
  });
