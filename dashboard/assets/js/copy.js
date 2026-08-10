/* Список NVR видимых строк в буфер обмена. Владеет кнопкой и таймером её
   подписи; строки приходят доводом — какие из них видны, знает страница.

   Про page здесь не знают ничего: на входе список строк, на выходе текст в
   буфере и подпись на кнопке. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.copy = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const FLASH = 1400;

  function create(deps) {
    const button = deps.button, rowsOf = deps.rowsOf;

    /* Подпись берём один раз при загрузке: если запомнить текущую, то
       второй клик подряд запомнит «Скопировано» и вернёт кнопку к нему
       навсегда. */
    const LABEL = button.textContent;
    let timer = null;

    /* NVR диффа собирается из имени и evr: evr — это
       «epoch:version-release», а в NVR эпохи нет, поэтому ведущее «N:»
       отбрасываем. */
    function nvrOf(row) {
      if (row.nvr) return row.nvr;
      const evr = row.new_evr || row.old_evr;
      return evr ? row.name + '-' + String(evr).replace(/^[0-9]+:/, '') : row.name;
    }

    function flash(text) {
      button.textContent = text;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        button.textContent = LABEL;
      }, FLASH);
      /* В node таймер держит процесс живым, и сюита досиживала бы полторы
         секунды на каждом тесте копирования. В браузере setTimeout отдаёт
         число, у которого unref нет, и строка ничего не делает. Так же
         поступает toasts.js — по той же причине. */
      if (timer && timer.unref) timer.unref();
    }

    function fallback(text) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', 'readonly');
      area.style.position = 'fixed';
      area.style.left = '-9999px';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(area);
      flash(ok ? 'Скопировано' : 'Не вышло');
    }

    function copy() {
      let items = rowsOf(), lines = [], i;
      for (i = 0; i < items.length; i++) lines.push(nvrOf(items[i]));
      const text = lines.join('\n');
      if (!text) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => { flash(`Скопировано ${lines.length}`); },
          () => { fallback(text); });
      } else {
        fallback(text);
      }
    }

    button.addEventListener('click', copy);

    return { copy: copy };
  }

  return { create };
}));
