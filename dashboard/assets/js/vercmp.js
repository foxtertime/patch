/* Сравнение версий по алгоритму RPM, без внешних зависимостей. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.vercmp = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DIGITS = /^(\d+)/;
  const ALPHA = /^([A-Za-z]+)/;

  /* Python-версия опирается на str.isalnum(), который шире \w и включает,
     например, надстрочные цифры «²»/«³» (U+00B2/U+00B3). Этот диапазон
     ýже: À-￿ начинается с U+00C0 и не захватывает U+0080–U+00BF, так что
     «²»/«³» сюда не попадают и stripSeparators съедает их как разделители,
     а не как альфанумерики. Это осознанно не расширяли: на входах с такими
     символами у самого Python нет осмысленного/стабильного ответа (см.
     тест на rpmvercmp('²','³') в tests/js/vercmp.test.js и разбор в
     task-3-report.md) — воспроизводить его квирки бит в бит незачем, важно
     лишь не падать и не зацикливаться, а это обеспечено независимо от
     точных границ диапазона. */
  const ALNUM = /[0-9A-Za-zÀ-￿]/;

  function stripSeparators(text) {
    let index = 0;
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

      const numeric = /[0-9]/.test(a.charAt(0));
      const re = numeric ? DIGITS : ALPHA;
      const matchA = re.exec(a), matchB = re.exec(b);

      if (matchA === null || matchB === null) {
        /* Разобрать нечем ни ту, ни другую сторону — выходим, чтобы не
           крутиться на месте вечно. */
        if (matchA === null && matchB === null) break;
        /* Цифры весомее букв; сторона, которая не разобралась, легче. */
        if (matchB === null) return numeric ? 1 : -1;
        return numeric ? -1 : 1;
      }

      let segA = matchA[1], segB = matchB[1];
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
    const epochA = Number(a[0] || 0), epochB = Number(b[0] || 0);
    if (epochA !== epochB) return epochA > epochB ? 1 : -1;
    const result = rpmvercmp(a[1], b[1]);
    if (result) return result;
    return rpmvercmp(a[2], b[2]);
  }

  return { rpmvercmp, compareEvr };
}));
