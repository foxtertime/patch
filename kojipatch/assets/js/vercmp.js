/* Сравнение версий по алгоритму RPM, без внешних зависимостей. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.vercmp = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIGITS = /^(\d+)/;
  var ALPHA = /^([A-Za-z]+)/;

  /* Python-версия опирается на str.isalnum(), который шире \w: для «²» он
     истинен. Здесь ровно та же широта — Unicode-классы регулярки, — иначе
     на экзотическом символе две реализации разошлись бы. */
  var ALNUM = /[0-9A-Za-zÀ-￿]/;

  function stripSeparators(text) {
    var index = 0;
    while (index < text.length
           && !(ALNUM.test(text.charAt(index))
                || text.charAt(index) === '~' || text.charAt(index) === '^')) {
      index += 1;
    }
    return text.slice(index);
  }

  function rpmvercmp(a, b) {
    a = a || '';
    b = b || '';
    if (a === b) return 0;

    while (a || b) {
      a = stripSeparators(a);
      b = stripSeparators(b);

      if (a.charAt(0) === '~' || b.charAt(0) === '~') {
        if (a.charAt(0) !== '~') return 1;
        if (b.charAt(0) !== '~') return -1;
        a = a.slice(1); b = b.slice(1);
        continue;
      }

      if (a.charAt(0) === '^' || b.charAt(0) === '^') {
        if (!a) return -1;
        if (!b) return 1;
        if (a.charAt(0) !== '^') return 1;
        if (b.charAt(0) !== '^') return -1;
        a = a.slice(1); b = b.slice(1);
        continue;
      }

      if (!a || !b) break;

      var numeric = /[0-9]/.test(a.charAt(0));
      var re = numeric ? DIGITS : ALPHA;
      var matchA = re.exec(a), matchB = re.exec(b);

      if (matchA === null || matchB === null) {
        /* Разобрать нечем ни ту, ни другую сторону — выходим, чтобы не
           крутиться на месте вечно. */
        if (matchA === null && matchB === null) break;
        /* Цифры весомее букв; сторона, которая не разобралась, легче. */
        if (matchB === null) return numeric ? 1 : -1;
        return numeric ? -1 : 1;
      }

      var segA = matchA[1], segB = matchB[1];
      a = a.slice(segA.length);
      b = b.slice(segB.length);

      if (numeric) {
        segA = segA.replace(/^0+/, '') || '0';
        segB = segB.replace(/^0+/, '') || '0';
        if (segA.length !== segB.length) return segA.length > segB.length ? 1 : -1;
      }

      if (segA !== segB) return segA > segB ? 1 : -1;
    }

    if (!a && !b) return 0;
    return a ? 1 : -1;
  }

  function compareEvr(a, b) {
    var epochA = Number(a[0] || 0), epochB = Number(b[0] || 0);
    if (epochA !== epochB) return epochA > epochB ? 1 : -1;
    var result = rpmvercmp(a[1], b[1]);
    if (result) return result;
    return rpmvercmp(a[2], b[2]);
  }

  return { rpmvercmp: rpmvercmp, compareEvr: compareEvr };
}));
