'use strict';
/* Список NVR видимых строк. Ни страницы, ни заглушки DOM здесь не нужно:
   кнопка и буфер подделываются в несколько строк. */
var test = require('node:test');
var assert = require('node:assert');
var copymod = require('../../dashboard/assets/js/copy.js');

function fakeButton() {
  return { textContent: 'Копировать NVR',
           addEventListener: function () {} };
}

/* navigator на Node 22 — свойство с геттером: простое присваивание молча
   не срабатывает, и подмена оказалась бы мнимой. Только defineProperty. */
function withClipboard(fn) {
  var wrote = [];
  var had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: function (text) {
      wrote.push(text);
      return Promise.resolve();
    } } } });
  try {
    fn(wrote);
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

function copier(rows) {
  return copymod.create({ button: fakeButton(),
                          rowsOf: function () { return rows; } });
}

test('строка состояния отдаёт свой nvr как есть', function () {
  withClipboard(function (wrote) {
    copier([{ name: 'nginx', nvr: 'nginx-1.24.0-3.el9' }]).copy();
    assert.deepStrictEqual(wrote, ['nginx-1.24.0-3.el9']);
  });
});

test('NVR диффовой строки собирается из имени и версии без эпохи',
  function () {
    /* У строки «Изменений» своего nvr нет — только evr вида 1:1.24.0-4.el9,
       а в NVR эпохи не бывает. */
    withClipboard(function (wrote) {
      copier([{ name: 'nginx', new_evr: '1:1.24.0-4.el9' }]).copy();
      assert.deepStrictEqual(wrote, ['nginx-1.24.0-4.el9']);
    });
  });

test('строки уезжают в буфер по одной на строку', function () {
  withClipboard(function (wrote) {
    copier([{ nvr: 'a-1-1.el9' }, { nvr: 'b-2-1.el9' }]).copy();
    assert.deepStrictEqual(wrote, ['a-1-1.el9\nb-2-1.el9']);
  });
});

test('без строк в буфер не уходит ничего', function () {
  withClipboard(function (wrote) {
    copier([]).copy();
    assert.deepStrictEqual(wrote, []);
  });
});
