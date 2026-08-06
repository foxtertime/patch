/* Архитектура RPM и порядок пакетов в списках. Порядок нужен и в строках
   таблицы, и в выравнивании «было/стало», поэтому он один на всех. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.KP = root.KP || {}; root.KP.rpms = factory(); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* src и noarch — не «ещё одна архитектура», а исходник и пакет, которому
     архитектура не нужна. Остальные идут по алфавиту. */
  const LEADING = ['src', 'noarch'];

  function archOf(nvra) {
    const index = String(nvra).lastIndexOf('.');
    return index === -1 ? '?' : String(nvra).slice(index + 1);
  }

  function archRank(arch) {
    const index = LEADING.indexOf(arch);
    return index === -1 ? LEADING.length : index;
  }

  function compareArch(a, b) {
    const ra = archRank(a), rb = archRank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    /* Внутри ведущей группы имя уже определено рангом; сравнивать нечего. */
    if (ra < LEADING.length) return 0;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function compareNvra(a, b) {
    const byArch = compareArch(archOf(a), archOf(b));
    if (byArch) return byArch;
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function sortRpms(items) {
    return (items || []).slice().sort(compareNvra);
  }

  return { archOf, compareArch, compareNvra, sortRpms };
}));
