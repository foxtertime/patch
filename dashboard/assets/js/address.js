/* Владение адресной строкой: когда её читать и когда писать.

   Формат строки знает hash.js и не знает ничего про страницу; здесь
   наоборот — про формат не знают вовсе, зато знают, чей сейчас адрес.
   Замок нужен ровно затем, чтобы отличить собственную запись от чужой, и
   держать его в одном месте, а единственного его читателя в другом
   значило бы приглашать расхождение — потому слушатель hashchange живёт
   здесь же. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.address = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(deps) {
    const page = deps.page, hash = deps.hash;
    const search = deps.dom.search, clear = deps.dom.clear;
    const onExternal = deps.onExternal;

    let locked = false;
    /* Писала ли страница адрес сама. С этого мгновения location.hash — её
       собственное эхо, а не то, с чем её открыли. */
    let ours = false;

    function write() {
      const next = hash.format(page.hashParts());
      ours = true;
      if (location.hash === next) return;
      locked = true;
      try {
        if (history && history.replaceState) history.replaceState(null, '', next);
        else location.hash = next;
      } catch (e) {
        location.hash = next;
      }
      setTimeout(() => { locked = false; }, 0);
    }

    function read() {
      const raw = location.hash.replace(/^#/, '');
      if (!raw) return false;
      page.restore(hash.parse(raw));
      search.value = page.st.q;
      /* Запрос мог приехать из ссылки — крестик обязан появиться вместе
         с ним, а не ждать первого касания клавиатуры. */
      clear.hidden = !search.value;
      return true;
    }

    window.addEventListener('hashchange', () => {
      if (locked) return;
      if (read()) onExternal();
    });

    return { write: write, read: read, isOurs: () => ours };
  }

  return { create };
}));
