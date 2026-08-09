'use strict';
/* Предупреждения хранилища без страницы: модулю нужны только store и
   toasts. Рельс сюда не завозим — состав снапшотов и то, что человек
   двигает узлы, проверяет ui.test.js на настоящем DOM. */
var test = require('node:test');
var assert = require('node:assert');
var store = require('../../dashboard/assets/js/store.js');
var noticesmod = require('../../dashboard/assets/js/notices.js');

function build(name) {
  return { nvr: name + '-1.0-1.el9', name: name, version: '1.0',
           release: '1.el9', epoch: null, build_id: 1, task_id: 2,
           tag_name: null, tags: [], owner: 'builder',
           completed: '2026-05-14 10:00:00', source: null,
           patch_dir_present: true, patches: [], rpms: ['a.x86_64'],
           problems: [] };
}

function snap(tag, generated, over) {
  over = over || {};
  return { schema: 1, tag: tag, generated: generated,
           koji_hub: 'https://hub/kojihub', koji_web: 'https://hub/koji',
           patch_classes: over.classes || ['CVE', 'other'],
           builds: over.builds || [build('nginx')] };
}

/* Строки всех окошек, которые модуль успел показать подставным toasts. */
function shownText(shown) {
  return shown.map(function (spec) { return spec.lines.join(' '); }).join(' ');
}

/* Свежее хранилище и свежий модуль на нём: onChange зовёт sync() так же,
   как это делал бы renderSources() на странице. */
function setup() {
  store.reset();
  var shown = [];
  var toasts = { show: function (spec) { shown.push(spec); } };
  var notices = noticesmod.create({ store: store, toasts: toasts });
  store.onChange(notices.sync);
  return { notices: notices, shown: shown };
}

test('разные хабы — предупреждение на странице', function () {
  var s = setup();
  var other = snap('os-9.2', '2026-08-01T00:00:00+03:00');
  other.koji_hub = 'https://elsewhere/kojihub';
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([other], 'b.json');
  assert.ok(shownText(s.shown).indexOf('хаба') !== -1, shownText(s.shown));
});

test('откатившаяся перестановка объясняется окошком', function () {
  /* У перестановки нет своего места для ошибок: причина уезжает в
     предупреждения хранилища. Состав после отката прежний, и не показать
     её значило бы промолчать о том, что действие не состоялось. */
  var s = setup();
  store.add([snap('os-9.1', '2026-07-01T00:00:00+03:00')], 'a.json');
  store.add([snap('os-9.2', '2026-08-01T00:00:00+03:00')], 'b.json');
  store.onChange(function () {
    if (store.list()[0].tag === 'os-9.2') throw new Error('пара не рисуется');
  });
  store.move(1, -1);
  assert.ok(shownText(s.shown).indexOf('пара не рисуется') !== -1,
            shownText(s.shown));
});
