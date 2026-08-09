'use strict';
/* Кнопка «наверх» и высота липкой шапки. Заглушка DOM здесь нужна — без
   окна с прокруткой проверять нечего, — а вот вся страница нет. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var viewportmod = require('../../dashboard/assets/js/viewport.js');

function load(options) {
  var dom = domstub.install(options);
  viewportmod.create({ controls: dom.id('controls'), toTop: dom.id('totop'),
                       onResize: function () {} });
  return dom;
}

/* Кнопка «наверх» появляется, только когда наверх действительно надо:
   на нетронутой странице она была бы лишним пятном поверх таблицы. */
test('кнопка «наверх» прячется на нетронутой странице', function () {
  var dom = load();
  assert.strictEqual(dom.id('totop').hidden, true);
});

test('кнопка «наверх» появляется ниже первого экрана и уходит обратно',
  function () {
    var dom = load();
    dom.window.pageYOffset = dom.window.innerHeight + 1;
    dom.fireWindow('scroll');
    assert.strictEqual(dom.id('totop').hidden, false);

    dom.window.pageYOffset = 0;
    dom.fireWindow('scroll');
    assert.strictEqual(dom.id('totop').hidden, true);
  });

test('щелчок по кнопке «наверх» поднимает страницу', function () {
  var dom = load();
  dom.window.pageYOffset = 2000;
  dom.fireWindow('scroll');
  dom.fire(dom.id('totop'), 'click', {});
  assert.strictEqual(dom.window.pageYOffset, 0);
});

/* Липкая шапка сегодня нигде больше не проверена: модуль ставит
   --controls-h сразу при создании, не дожидаясь первого resize. Заглушка
   style.setProperty в domstub.js — пустая функция, здесь подменяем её на
   запоминающую, чтобы увидеть вызов. */
test('высота липкой шапки выставляется при создании модуля', function () {
  var dom = domstub.install();
  var calls = [];
  dom.document.documentElement.style.setProperty = function (name, value) {
    calls.push([name, value]);
  };
  viewportmod.create({ controls: dom.id('controls'), toTop: dom.id('totop'),
                       onResize: function () {} });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], '--controls-h');
});
