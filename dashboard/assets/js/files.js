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
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Сообщение о загрузке — событие, а не состояние страницы: файл
     отвергнут, состав снапшотов прежний, и через минуту эта строка
     сообщает только о том, что человек и так уже понял. Поэтому гаснет
     сама. Десяти секунд хватает прочитать две строки, а не хватит —
     сообщение повторится, стоит поднести файл снова.

     Предупреждение о разных хабах в соседнем блоке так не гасят, и это
     не забывчивость: оно описывает не событие, а то, что на экране
     сейчас, и правдиво ровно до смены состава. */
  var ERRORS_LIFE = 10000;
  var ERRORS_FADE = 400;

  function create(deps) {
    var store = deps.store, esc = deps.text.esc;
    var input = deps.dom.input, dropZone = deps.dom.drop;
    var errorsBox = deps.dom.errors, pickBtn = deps.dom.pick;
    var timers = [];

    function stopTimers() {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    function showErrors(errors) {
      var out = '', i;
      for (i = 0; i < errors.length; i++) out += '<li>' + esc(errors[i]) + '</li>';
      /* Свежее сообщение начинает свой срок с нуля: догорающий чужой таймер
         погасил бы его раньше, чем человек успел прочитать. */
      stopTimers();
      errorsBox.className = 'problems loaderrors';
      errorsBox.innerHTML = out;
      if (!out) return;
      /* Два независимых таймера, а не вложенных: гашение и уборка — разные
         события, и заводить второе изнутри первого значит связать их
         порядком выполнения там, где связи нет. */
      timers.push(setTimeout(function () {
        errorsBox.className = 'problems loaderrors fading';
      }, ERRORS_LIFE));
      timers.push(setTimeout(function () {
        errorsBox.innerHTML = '';
        errorsBox.className = 'problems loaderrors';
      }, ERRORS_LIFE + ERRORS_FADE));
    }

    function loadFiles(list) {
      var errors = [], pending = list.length, i;
      if (!pending) return;
      function done() {
        pending -= 1;
        if (pending) return;
        showErrors(errors);
      }
      for (i = 0; i < list.length; i++) {
        (function (file) {
          var reader = new FileReader();
          reader.onload = function () {
            var parsed = store.parseText(String(reader.result), file.name);
            if (!parsed.ok) errors.push(parsed.error);
            else {
              var res = store.add(parsed.snapshots, file.name);
              errors = errors.concat(res.rejected);
            }
            done();
          };
          /* Нечитаемый файл — не повод молчать: без этой ветки страница
             просто ничего не сделала бы в ответ на выбор. */
          reader.onerror = function () {
            errors.push(file.name + ': файл не читается');
            done();
          };
          reader.readAsText(file);
        }(list[i]));
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
      var data = e.dataTransfer, types = data && data.types, i;
      if (!data) return false;
      if (data.files && data.files.length) return true;
      for (i = 0; types && i < types.length; i++) {
        if (types[i] === 'Files') return true;
      }
      return false;
    }

    pickBtn.addEventListener('click', openPicker);

    input.addEventListener('change', function () {
      loadFiles(input.files);
      /* Тот же файл, выбранный второй раз, не даёт события, пока в поле
         лежит его прежнее значение. */
      input.value = '';
    });

    /* Ронять файл можно на всю страницу, а не только на зону: браузер по
       умолчанию открывает брошенный файл вместо страницы, и без
       preventDefault на dragover дашборд просто заменился бы содержимым JSON. */
    document.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      markOver(true);
    });
    document.addEventListener('dragleave', function (e) {
      /* Уход за пределы окна: внутри страницы dragleave приходит на каждой
         границе, и снимать подсветку по ним значило бы мигать ею. */
      if (!e.relatedTarget) markOver(false);
    });
    document.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      markOver(false);
      loadFiles(e.dataTransfer.files);
    });

    return { openPicker: openPicker };
  }

  return { create: create };
}));
