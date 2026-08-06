/* Загрузка снапшотов файлами: выбор через диалог и бросок на страницу.
   Владеет полем выбора и зоной броска; наружу отдаёт только openPicker —
   её зовёт призрачная кнопка рельса. О том, что не приехало, модуль
   рассказывает окошком, но не рисует его: показывать сообщения — дело
   toasts, а дело этого модуля — читать файлы. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.files = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(deps) {
    const store = deps.store, toasts = deps.toasts;
    const input = deps.dom.input, dropZone = deps.dom.drop;
    const pickBtn = deps.dom.pick;

    function loadFiles(list) {
      let errors = [], pending = list.length;
      if (!pending) return;
      /* Сообщение показываем одно на всю пачку и только когда прочитан
         последний файл: читаются они вразнобой, и по сообщению на каждый
         залепило бы угол экрана раньше, чем первое успели прочесть.

         Число в заголовке — число причин, а не файлов: один файл несёт
         несколько снапшотов и получает отказ на каждый. */
      function done() {
        pending -= 1;
        if (pending) return;
        if (!errors.length) return;
        toasts.show({ kind: 'error',
                      title: `Не загружено: ${errors.length}`,
                      lines: errors });
      }
      /* file объявлен на каждый виток, поэтому обработчики читателя видят
         свой файл, а не последний из пачки. Раньше это делала обёртка-IIFE. */
      for (const file of list) {
        const reader = new FileReader();
        reader.onload = () => {
          const parsed = store.parseText(String(reader.result), file.name);
          if (!parsed.ok) errors.push(parsed.error);
          else {
            const res = store.add(parsed.snapshots, file.name);
            errors = errors.concat(res.rejected);
          }
          done();
        };
        /* Нечитаемый файл — не повод молчать: без этой ветки страница
           просто ничего не сделала бы в ответ на выбор. */
        reader.onerror = () => {
          errors.push(`${file.name}: файл не читается`);
          done();
        };
        reader.readAsText(file);
      }
    }

    function openPicker() { input.click(); }

    function markOver(on) {
      dropZone.className = on ? 'drop over' : 'drop';
    }

    /* Тащат файл или узел рельса — разные вещи, и путать их нельзя: узел,
       принятый за файл, зажигал бы зону загрузки и уезжал в loadFiles, где
       файлов нет.

       Спрашиваем два признака, потому что до отпускания доступен только
       первый: пока перенос идёт, сами файлы браузер прячет и о них говорит
       одна запись Files в types; на drop появляются и файлы. */
    function hasFiles(e) {
      const data = e.dataTransfer;
      if (!data) return false;
      if (data.files && data.files.length) return true;
      return Array.from(data.types || []).indexOf('Files') !== -1;
    }

    pickBtn.addEventListener('click', openPicker);

    input.addEventListener('change', () => {
      loadFiles(input.files);
      /* Тот же файл, выбранный второй раз, не даёт события, пока в поле
         лежит его прежнее значение. */
      input.value = '';
    });

    /* Ронять файл можно на всю страницу, а не только на зону: браузер по
       умолчанию открывает брошенный файл вместо страницы, и без
       preventDefault на dragover дашборд просто заменился бы содержимым JSON. */
    document.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      markOver(true);
    });
    document.addEventListener('dragleave', (e) => {
      /* Уход за пределы окна: внутри страницы dragleave приходит на каждой
         границе, и снимать подсветку по ним значило бы мигать ею. */
      if (!e.relatedTarget) markOver(false);
    });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      markOver(false);
      loadFiles(e.dataTransfer.files);
    });

    return { openPicker };
  }

  return { create };
}));
