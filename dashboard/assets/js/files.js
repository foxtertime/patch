/* Загрузка снапшотов файлами: выбор через диалог, бросок на страницу и
   сообщения о том, что не приехало. Владеет полем выбора, зоной броска и
   плашкой сообщений; наружу отдаёт только openPicker — её зовёт призрачная
   кнопка рельса. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.files = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* Сообщение о загрузке — событие, а не состояние страницы: файл
     отвергнут, состав снапшотов прежний, и через минуту эта строка
     сообщает только о том, что человек и так уже понял. Поэтому гаснет
     сама. Десяти секунд хватает прочитать две строки, а не хватит —
     сообщение повторится, стоит поднести файл снова.

     Предупреждение о разных хабах в соседнем блоке так не гасят, и это
     не забывчивость: оно описывает не событие, а то, что на экране
     сейчас, и правдиво ровно до смены состава. */
  const ERRORS_LIFE = 10000;
  const ERRORS_FADE = 400;

  function create(deps) {
    const store = deps.store, esc = deps.text.esc;
    const input = deps.dom.input, dropZone = deps.dom.drop;
    const errorsBox = deps.dom.errors, pickBtn = deps.dom.pick;
    let timers = [];

    function stopTimers() {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    function showErrors(errors) {
      const out = errors.map((e) => `<li>${esc(e)}</li>`).join('');
      /* Свежее сообщение начинает свой срок с нуля: догорающий чужой таймер
         погасил бы его раньше, чем человек успел прочитать. */
      stopTimers();
      errorsBox.className = 'problems loaderrors';
      errorsBox.innerHTML = out;
      if (!out) return;
      /* Два независимых таймера, а не вложенных: гашение и уборка — разные
         события, и заводить второе изнутри первого значит связать их
         порядком выполнения там, где связи нет. */
      timers.push(setTimeout(() => {
        errorsBox.className = 'problems loaderrors fading';
      }, ERRORS_LIFE));
      timers.push(setTimeout(() => {
        errorsBox.innerHTML = '';
        errorsBox.className = 'problems loaderrors';
      }, ERRORS_LIFE + ERRORS_FADE));
    }

    /* Сообщение показываем одно на всю пачку и только когда прочитан
       последний файл: читаются они вразнобой, и по сообщению на каждый
       перебило бы предыдущее раньше, чем его успели прочесть. */
    function loadFiles(list) {
      let errors = [], pending = list.length;
      if (!pending) return;
      function done() {
        pending -= 1;
        if (pending) return;
        showErrors(errors);
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
