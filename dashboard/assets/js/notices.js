/* Какие предупреждения хранилища человеку ещё не показывали.

   Предупреждение всплывает, только когда состав снапшотов и правда стал
   другим, и только если такой строки на прошлом составе не было.

   Порядок из состава выкинут намеренно. Предупреждение про разные хабы
   называет тот снапшот, который выбивается из ряда, а выбивается — всегда
   не первый; от перестановки строка переписывается, хотя факт под ней тот
   же самый. Сравнивай мы строки, окошко вылезало бы на каждое
   перетаскивание узла и твердило человеку одно и то же за то, что он
   двигает рельс. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.notices = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(deps) {
    const store = deps.store, toasts = deps.toasts;
    let shownWarnings = [];
    let shownStock = '';

    function stockOf() {
      return store.list().map((item) => `${item.tag} ${item.generated}`)
        .sort().join('\n');
    }

    function sync() {
      const stock = stockOf();
      const now = store.warnings();
      const fresh = now.filter((line) => shownWarnings.indexOf(line) === -1);
      /* Состав тот же — показываем ровно то, на что список вырос: причина
         отказа дописывается в конец, а переписанное предупреждение про хабы
         длины не меняет. Иначе отказ перестановки, ради которого хранилище
         эту строку и заводит, остался бы непоказанным: после отката состав
         возвращается к прежнему. */
      const room = stock === shownStock
        ? Math.max(0, now.length - shownWarnings.length) : fresh.length;
      for (const line of fresh.slice(fresh.length - room)) {
        toasts.show({ kind: 'warn', lines: [line] });
      }
      shownWarnings = now;
      shownStock = stock;
    }

    return { sync: sync };
  }

  return { create };
}));
