'use strict';
/* Владение адресной строкой. Круговой ход «состояние уехало в адрес и
   вернулось» проверяется через всю страницу в ui.test.js; здесь — только
   два замка, которых оттуда не видно. */
var test = require('node:test');
var assert = require('node:assert');
var domstub = require('./domstub.js');
var hash = require('../../dashboard/assets/js/hash.js');
var addressmod = require('../../dashboard/assets/js/address.js');

/* Страница подставная: адресу от неё нужны ровно три вещи. */
function fakePage(restored) {
  return {
    st: { q: '' },
    hashParts: function () {
      return { tab: 'state', tag: 'os-9.2@2026-08-01T00:00:00+03:00',
               pair: null, filters: [], any: [], q: '',
               sort: { key: 'name', asc: true } };
    },
    restore: function (parsed) { if (restored) restored.push(parsed); }
  };
}

function make(dom, over) {
  over = over || {};
  return addressmod.create({
    page: over.page || fakePage(), hash: hash,
    dom: { search: dom.id('q'), clear: dom.id('q-clear') },
    onExternal: over.onExternal || function () {} });
}

test('своя запись в адрес не будит чтение обратно', function () {
  var dom = domstub.install();
  var external = 0;
  var addr = make(dom, { onExternal: function () { external += 1; } });
  addr.write();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 0, 'страница прочитала собственное эхо');
});

test('замок снимается, и следующая чужая ссылка проходит', async function () {
  /* Замок живёт до конца текущей макрозадачи: он про одну свою запись, а
     не про всё оставшееся время жизни страницы. */
  var dom = domstub.install();
  var external = 0;
  var addr = make(dom, { onExternal: function () { external += 1; } });
  addr.write();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 0);
  await dom.tick();
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 1, 'замок остался закрытым навсегда');
});

test('чужой hashchange доходит до восстановления', function () {
  var dom = domstub.install({ hash: '#tab=state&f=&sort=name' });
  var restored = [], external = 0;
  make(dom, { page: fakePage(restored),
              onExternal: function () { external += 1; } });
  dom.fireWindow('hashchange');
  assert.strictEqual(external, 1);
  assert.strictEqual(restored.length, 1);
  assert.strictEqual(restored[0].tab, 'state');
});

test('isOurs становится правдой только после своей записи', function () {
  var dom = domstub.install({ hash: '#tab=state&f=&sort=name' });
  var addr = make(dom);
  assert.strictEqual(addr.isOurs(), false,
                     'адрес пока тот, с которым страницу открыли');
  addr.write();
  assert.strictEqual(addr.isOurs(), true);
});
