'use strict';
/* Всплывающие сообщения без страницы: модулю нужен только узел-контейнер
   и часы, а часы тест даёт свои — иначе проверка «через десять секунд
   гаснет» и правда шла бы десять секунд. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub');
var notesmod = require('../../dashboard/assets/js/notes');

function clock() {
  var pending = [], next = 1;
  return {
    set: function (fn, ms) {
      pending.push({ id: next, fn: fn, at: ms });
      return next++;
    },
    clear: function (id) {
      pending = pending.filter(function (t) { return t.id !== id; });
    },
    /* Стреляем всем, чей срок вышел, и остальным укорачиваем ожидание:
       у окошка два таймера — на гашение и на уборку, — и тесту нужно
       уметь дойти до каждого по отдельности. */
    tick: function (ms) {
      var due = pending.filter(function (t) { return t.at <= ms; });
      pending = pending.filter(function (t) { return t.at > ms; })
        .map(function (t) { return { id: t.id, fn: t.fn, at: t.at - ms }; });
      due.forEach(function (t) { t.fn(); });
    },
    count: function () { return pending.length; }
  };
}

function setup() {
  var dom = domstub.install();
  var box = dom.document.createElement('div');
  var clk = clock();
  return { dom: dom, box: box, clk: clk,
           notes: notesmod.create({ node: box, clock: clk }) };
}

/* Весь текст поддерева: окошко собрано узлами, и innerHTML у заглушки
   пустой — читать надо textContent детей. */
function textOf(node) {
  var out = node.textContent || '';
  for (var i = 0; i < node.children.length; i++) {
    out += ' ' + textOf(node.children[i]);
  }
  return out;
}

function boxes(box) { return box.querySelectorAll('.note'); }

test('окошко показывает заголовок и строки', function () {
  var s = setup();
  s.notes.show({ kind: 'error', title: 'Не загружено: 2',
                 lines: ['a.json: это не снапшот', 'b.json: уже загружен'] });
  var list = boxes(s.box);
  assert.strictEqual(list.length, 1);
  var text = textOf(list[0]);
  assert.ok(text.indexOf('Не загружено: 2') !== -1, text);
  assert.ok(text.indexOf('a.json: это не снапшот') !== -1, text);
  assert.ok(text.indexOf('b.json: уже загружен') !== -1, text);
});

test('вид попадает в класс окошка', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.notes.show({ kind: 'warn', lines: ['два'] });
  var list = boxes(s.box);
  assert.ok(list[0].className.indexOf('error') !== -1, list[0].className);
  assert.ok(list[1].className.indexOf('warn') !== -1, list[1].className);
});

test('незнакомый вид считается предупреждением', function () {
  var s = setup();
  s.notes.show({ kind: 'что-то ещё', lines: ['раз'] });
  assert.ok(boxes(s.box)[0].className.indexOf('warn') !== -1);
});

test('пустой список ничего не показывает', function () {
  var s = setup();
  s.notes.show({ kind: 'error', title: 'Не загружено: 0', lines: [] });
  assert.strictEqual(boxes(s.box).length, 0);
});

test('без заголовка окошко состоит из одних строк', function () {
  var s = setup();
  s.notes.show({ kind: 'warn', lines: ['разные хабы'] });
  assert.strictEqual(s.box.querySelectorAll('.note-t').length, 0);
  assert.ok(textOf(boxes(s.box)[0]).indexOf('разные хабы') !== -1);
});

test('длинный список режется и говорит, сколько строк скрыто', function () {
  var s = setup(), lines = [], i;
  for (i = 1; i <= 9; i++) lines.push('строка ' + i);
  s.notes.show({ kind: 'error', lines: lines });
  var text = textOf(boxes(s.box)[0]);
  assert.ok(text.indexOf('строка 6') !== -1, text);
  assert.ok(text.indexOf('строка 7') === -1, text);
  assert.ok(text.indexOf('и ещё 3') !== -1, text);
});

test('семь строк показываются все: «и ещё 1» занял бы место строки',
  function () {
    var s = setup(), lines = [], i;
    for (i = 1; i <= 7; i++) lines.push('строка ' + i);
    s.notes.show({ kind: 'error', lines: lines });
    var text = textOf(boxes(s.box)[0]);
    assert.ok(text.indexOf('строка 7') !== -1, text);
    assert.ok(text.indexOf('и ещё') === -1, text);
  });

test('пятое окошко выталкивает самое старое', function () {
  var s = setup(), i;
  for (i = 1; i <= 5; i++) s.notes.show({ kind: 'warn', lines: ['n' + i] });
  var list = boxes(s.box);
  assert.strictEqual(list.length, 4);
  var text = list.map(textOf).join(' ');
  assert.ok(text.indexOf('n1') === -1, text);
  assert.ok(text.indexOf('n5') !== -1, text);
});

test('крестик убирает своё окошко и не трогает соседей', function () {
  var s = setup();
  s.notes.show({ kind: 'warn', lines: ['первое'] });
  s.notes.show({ kind: 'warn', lines: ['второе'] });
  s.box.querySelectorAll('.note-x')[0].click();
  var list = boxes(s.box);
  assert.strictEqual(list.length, 1);
  assert.ok(textOf(list[0]).indexOf('второе') !== -1);
});

test('текст причины не становится разметкой', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['<b>bad</b>.json: не читается'] });
  assert.strictEqual(s.box.querySelectorAll('b').length, 0);
  assert.ok(textOf(boxes(s.box)[0]).indexOf('<b>bad</b>.json') !== -1);
});

test('окошко гаснет по своему сроку и уходит из дерева', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.clk.tick(10000);
  assert.ok(boxes(s.box)[0].className.indexOf('fading') !== -1,
            boxes(s.box)[0].className);
  s.clk.tick(400);
  assert.strictEqual(boxes(s.box).length, 0);
});

test('под курсором отсчёт стоит, а после ухода идёт заново', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.dom.fire(boxes(s.box)[0], 'mouseenter', {});
  s.clk.tick(10000);
  assert.strictEqual(boxes(s.box).length, 1, 'окошко ушло из-под курсора');
  s.dom.fire(boxes(s.box)[0], 'mouseleave', {});
  s.clk.tick(9999);
  assert.strictEqual(boxes(s.box).length, 1, 'срок не начался заново');
  s.clk.tick(1);
  s.clk.tick(400);
  assert.strictEqual(boxes(s.box).length, 0);
});

test('фокус внутри окошка держит его так же, как курсор', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.dom.fire(s.box.querySelectorAll('.note-x')[0], 'focusin', {});
  s.clk.tick(10000);
  assert.strictEqual(boxes(s.box).length, 1);
});

test('курсор на догорающем окошке возвращает его к жизни', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.clk.tick(10000);
  s.dom.fire(boxes(s.box)[0], 'mouseenter', {});
  s.clk.tick(400);
  assert.strictEqual(boxes(s.box).length, 1);
  assert.strictEqual(boxes(s.box)[0].className.indexOf('fading'), -1);
});

test('убранное окошко таймеров за собой не оставляет', function () {
  var s = setup();
  s.notes.show({ kind: 'error', lines: ['раз'] });
  s.box.querySelectorAll('.note-x')[0].click();
  assert.strictEqual(s.clk.count(), 0);
});
