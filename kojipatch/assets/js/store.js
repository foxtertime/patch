/* Загруженные снапшоты: разбор, порядок, дубликаты, предупреждения.
   Хранилище ничего не рисует и не знает про DOM — ровно поэтому его
   поведение проверяется в node, а не глазами в браузере. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.store = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var items = [];        /* {snapshot, file} в порядке цепочки */
  var warns = [];
  var manual = false;    /* человек переставил руками — не пересортировывать */
  var listeners = [];

  function isArray(value) {
    return Object.prototype.toString.call(value) === '[object Array]';
  }

  /* Минимум, при котором снапшот вообще можно показать. Глубже не лезем:
     модель почти все поля билда объявляет необязательными, и отказ от
     целого файла из-за одной сборки потерял бы все остальные. */
  function isSnapshot(value) {
    return Boolean(value) && typeof value === 'object' && !isArray(value)
        && value.schema === 1 && typeof value.tag === 'string'
        && typeof value.generated === 'string' && isArray(value.builds);
  }

  /* Время сбора для сортировки. Нечитаемая дата остаётся строкой: выдать её
     за ноль эпохи значило бы поставить такой снапшот первым в цепочке. */
  function stamp(value) {
    var ms = Date.parse(value);
    return isNaN(ms) ? String(value) : ms;
  }

  function compareItems(a, b) {
    var x = stamp(a.snapshot.generated), y = stamp(b.snapshot.generated);
    /* Читаемое время и нечитаемая строка несравнимы. Ставим непонятное в
       конец, а не туда, куда его случайно уронит сравнение разных типов. */
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
    if (x < y) return -1;
    if (x > y) return 1;
    return a.snapshot.tag < b.snapshot.tag
      ? -1 : (a.snapshot.tag > b.snapshot.tag ? 1 : 0);
  }

  function fire() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  /* Хаб у снапшотов разный — сравнивать их обычно бессмысленно, но бывает
     и наоборот (переезд хаба, зеркало), поэтому это предупреждение, а не
     отказ. Считаем заново от текущего состава: после удаления снапшота
     старое предупреждение могло стать неправдой. */
  function checkHubs() {
    var base = null, i, hub;
    warns = [];
    for (i = 0; i < items.length; i++) {
      hub = items[i].snapshot.koji_hub;
      if (!hub) continue;
      if (base === null) { base = hub; continue; }
      if (hub !== base) {
        warns.push(items[i].file + ': снапшот ' + items[i].snapshot.tag
                 + ' собран с другого хаба (' + hub + '), сравнение с '
                 + base + ' может ничего не значить');
      }
    }
  }

  function isDuplicate(snapshot) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].snapshot.tag === snapshot.tag
          && items[i].snapshot.generated === snapshot.generated) return true;
    }
    return false;
  }

  /* Разбор одного файла. Ничего не бросает: одна опечатка в имени тега не
     должна отменять загрузку остальных четырёх файлов. */
  function parseText(text, fileName) {
    var data, list, i, snapshot;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { ok: false,
               error: fileName + ': не разбирается как JSON — ' + e.message };
    }
    list = isArray(data) ? data : [data];
    if (!list.length) {
      return { ok: false, error: fileName + ': пустой список снапшотов' };
    }
    for (i = 0; i < list.length; i++) {
      snapshot = list[i];
      /* Чужую версию схемы называем прямо: «это не снапшот» сбило бы с
         толку человека, у которого файл сделан другой версией kojipatch. */
      if (snapshot && typeof snapshot === 'object' && !isArray(snapshot)
          && snapshot.schema !== undefined && snapshot.schema !== 1) {
        return { ok: false,
                 error: fileName + ': версия схемы ' + snapshot.schema
                      + ', а дашборд понимает только 1' };
      }
      if (!isSnapshot(snapshot)) {
        return { ok: false,
                 error: fileName + ': это не снапшот kojipatch — нужны tag, '
                      + 'generated и builds' };
      }
    }
    return { ok: true, snapshots: list };
  }

  function add(snapshots, fileName) {
    var added = 0, rejected = [], i, snapshot;
    snapshots = snapshots || [];
    for (i = 0; i < snapshots.length; i++) {
      snapshot = snapshots[i];
      /* add() зовут и мимо parseText — с прелюдией, запечённой сборщиком.
         Проверяем ещё раз здесь, чтобы негодное не попало в хранилище. */
      if (!isSnapshot(snapshot)) {
        rejected.push(fileName + ': это не снапшот kojipatch — нужны tag, '
                    + 'generated и builds');
        continue;
      }
      if (isDuplicate(snapshot)) {
        rejected.push(fileName + ': снапшот ' + snapshot.tag + ' от '
                    + snapshot.generated + ' уже загружен');
        continue;
      }
      items.push({ snapshot: snapshot, file: fileName });
      added += 1;
    }
    if (added && !manual) items.sort(compareItems);
    checkHubs();
    if (added) fire();
    return { added: added, rejected: rejected };
  }

  function remove(index) {
    if (index < 0 || index >= items.length) return;
    items.splice(index, 1);
    checkHubs();
    fire();
  }

  /* Ручной порядок включается только состоявшейся перестановкой: клик по
     крайней стрелке ничего не двигает и отменять автосортировку не должен. */
  function move(index, delta) {
    var to = index + delta, item;
    if (index < 0 || index >= items.length || to < 0 || to >= items.length) {
      return;
    }
    manual = true;
    item = items[index];
    items.splice(index, 1);
    items.splice(to, 0, item);
    fire();
  }

  function list() {
    var out = [], i;
    for (i = 0; i < items.length; i++) {
      out.push({ tag: items[i].snapshot.tag,
                 generated: items[i].snapshot.generated,
                 builds: (items[i].snapshot.builds || []).length,
                 file: items[i].file });
    }
    return out;
  }

  function snapshots() {
    var out = [], i;
    for (i = 0; i < items.length; i++) out.push(items[i].snapshot);
    return out;
  }

  function warnings() { return warns.slice(); }
  function onChange(fn) { listeners.push(fn); }
  function reset() { items = []; warns = []; manual = false; listeners = []; }

  return { parseText: parseText, add: add, remove: remove, move: move,
           list: list, snapshots: snapshots, warnings: warnings,
           onChange: onChange, reset: reset };
}));
