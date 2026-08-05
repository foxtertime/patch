/* Загруженные снапшоты: разбор, порядок, дубликаты, предупреждения.
   Хранилище ничего не рисует и не знает про DOM — ровно поэтому его
   поведение проверяется в node, а не глазами в браузере. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.store = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  let items = [];        /* {snapshot, file} в порядке цепочки */
  let warns = [];
  let manual = false;    /* человек переставил руками — не пересортировывать */
  let listeners = [];

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
    const ms = Date.parse(value);
    return isNaN(ms) ? String(value) : ms;
  }

  function compareItems(a, b) {
    const x = stamp(a.snapshot.generated), y = stamp(b.snapshot.generated);
    /* Читаемое время и нечитаемая строка несравнимы. Ставим непонятное в
       конец, а не туда, куда его случайно уронит сравнение разных типов. */
    if (typeof x !== typeof y) return typeof x === 'number' ? -1 : 1;
    if (x < y) return -1;
    if (x > y) return 1;
    return a.snapshot.tag < b.snapshot.tag
      ? -1 : (a.snapshot.tag > b.snapshot.tag ? 1 : 0);
  }

  function fire() { for (var i = 0; i < listeners.length; i++) listeners[i](); }

  /* Любое изменение состава — целиком или никак.

     Проверка снапшота при загрузке нарочно неглубокая (иначе одна кривая
     сборка отменяла бы файл на восемьсот годных), поэтому негодное внутри
     доезжает до отрисовки и роняет её: builds: [null] — это массив, значит
     «снапшот». Если такой снапшот останется в хранилище, страница застынет
     недорисованной, а каждое следующее действие будет падать на нём же —
     убрать его будет нечем. Поэтому подписчиков зовём под try: упали —
     возвращаем прежний состав и зовём ещё раз, уже на нём.

     Причину возвращаем строкой, а не бросаем дальше: она нужна человеку на
     экране, а не в консоли, которую он не открывал. У add для неё есть свой
     ответ, у remove и move ответа нет — им передают note, и причина уезжает
     в предупреждения, которые страница показывает всегда. Живёт она до
     следующей попытки что-либо изменить: предупреждения каждый раз
     считаются заново от текущего состава, поэтому строка про откат не
     переживёт ни удачную перестановку (иначе она врала бы про новый,
     правильный порядок), ни второй такой же отказ.

     change() возвращает, изменилось ли что-нибудь: на пустом изменении
     подписчиков звать незачем, а перерисовка тега — это тысячи строк. */
  function commit(change, note) {
    let prevItems = items.slice(), prevManual = manual, message;
    if (!change()) return null;
    try {
      fire();
    } catch (e) {
      items = prevItems;
      manual = prevManual;
      /* Предупреждения — от восстановленного состава, а не те, что были до
         попытки: старая строка про откат относилась бы к порядку, которого
         на странице нет. */
      checkHubs();
      message = e && e.message ? String(e.message) : String(e);
      if (note) warns.push(note + ' ' + message);
      /* Прежний состав уже был отрисован — на нём подписчик не падал.
         Если и он теперь падает, страница сломана не этим изменением, и
         скрыть это хранилище не может: исключение уходит наружу. */
      fire();
      return message;
    }
    return null;
  }

  /* Хаб у снапшотов разный — сравнивать их обычно бессмысленно, но бывает
     и наоборот (переезд хаба, зеркало), поэтому это предупреждение, а не
     отказ. Считаем заново от текущего состава: после удаления снапшота
     старое предупреждение могло стать неправдой. */
  function checkHubs() {
    let base = null, i, hub;
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
    let data, list, i, snapshot;
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
         толку человека, у которого файл сделан другой версией dashboard. */
      if (snapshot && typeof snapshot === 'object' && !isArray(snapshot)
          && snapshot.schema !== undefined && snapshot.schema !== 1) {
        return { ok: false,
                 error: fileName + ': версия схемы ' + snapshot.schema
                      + ', а дашборд понимает только 1' };
      }
      if (!isSnapshot(snapshot)) {
        return { ok: false,
                 error: fileName + ': это не снапшот dashboard — нужны tag, '
                      + 'generated и builds' };
      }
    }
    return { ok: true, snapshots: list };
  }

  function add(snapshots, fileName) {
    let added = 0, rejected = [], failure;
    snapshots = snapshots || [];
    failure = commit(() => {
      let i, snapshot;
      for (i = 0; i < snapshots.length; i++) {
        snapshot = snapshots[i];
        /* add() — публичная точка входа хранилища, а не только пара к
           parseText: полагаться на то, что снапшот уже проверен снаружи,
           значило бы держать вход в хранилище открытым для чужого кода. */
        if (!isSnapshot(snapshot)) {
          rejected.push(fileName + ': это не снапшот dashboard — нужны tag, '
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
      return added > 0;
    });
    if (failure) {
      /* Откат уже случился: в хранилище прежний состав, и отказ надо назвать
         так же, как любой другой отказ файлу — строкой рядом с его именем. */
      rejected.push(fileName + ': дашборд не смог показать эти данные — '
                  + failure + '; файл не загружен');
      added = 0;
    }
    return { added: added, rejected: rejected };
  }

  function remove(index) {
    commit(() => {
      if (index < 0 || index >= items.length) return false;
      items.splice(index, 1);
      checkHubs();
      return true;
    }, 'снапшот остался на месте: без него страница не рисуется —');
  }

  /* Ручной порядок включается только состоявшейся перестановкой: клик по
     крайней стрелке ничего не двигает и отменять автосортировку не должен. */
  function move(index, delta) {
    commit(() => {
      let to = index + delta, item;
      if (index < 0 || index >= items.length || to < 0 || to >= items.length) {
        return false;
      }
      manual = true;
      item = items[index];
      items.splice(index, 1);
      items.splice(to, 0, item);
      /* Предупреждения считает каждый путь, меняющий состав: порядок задаёт
         и то, чей хаб считается основным, и живёт ли здесь ещё строка про
         откат прошлой перестановки. */
      checkHubs();
      return true;
    }, 'порядок не изменён: в этом порядке страница не рисуется —');
  }

  function list() {
    let out = [], i;
    for (i = 0; i < items.length; i++) {
      out.push({ tag: items[i].snapshot.tag,
                 generated: items[i].snapshot.generated,
                 builds: (items[i].snapshot.builds || []).length,
                 file: items[i].file });
    }
    return out;
  }

  function snapshots() {
    let out = [], i;
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
