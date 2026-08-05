/* Рельс цепочки: снапшоты — узлы на линии, идущей слева направо, от
   старого к новому. На «Состоянии» залит узел, который сейчас в таблице;
   на «Изменениях» — отрезок между концами сравниваемой пары, включая
   сводную, растянутую на всю цепочку. Одна картинка отвечает сразу на три
   вопроса: что загружено, в каком порядке сравнивается и где я сейчас
   нахожусь.

   Под тегом у каждого узла стоит время сбора: снапшот — это тег в
   определённый момент, и два прогона одного тега различает только оно.

   Рельс ещё и выбирает — он на странице единственный, кто это делает: на
   «Состоянии» один клик открывает снапшот, на «Изменениях» два задают
   любой диапазон цепочки. Здесь же и перестановка перетаскиванием: свой
   узел рельс держит целиком, вместе со всеми его событиями. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.rail = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* Свой тип переноса: данные из него браузер отдаёт только на drop, а вот
     types видны и раньше — по ним приёмник файлов на странице узнаёт, что
     тащат не файл. */
  var NODE_MIME = 'text/x-dashboard-node';

  function create(deps) {
    var box = deps.box, page = deps.page, store = deps.store, app = deps.app;
    var hideTip = deps.hideTip;
    var esc = deps.text.esc, plural = deps.text.plural;
    var stampOf = deps.text.stampOf, gapLabel = deps.text.gapLabel;
    var st = page.st;

    /* Номер узла, который тащат, и промежуток, куда его поставят. Промежуток
       считается в границах между узлами: 0 — перед первым, items.length —
       за последним. */
    var dragFrom = null, dropAt = null;

    /* ---------- разметка ---------- */

    /* Отрезок между соседними узлами, с расстоянием во времени над ним. */
    function railHtml(from, to, on) {
      var gap = gapLabel(from.generated, to.generated);
      return '<span class="rl' + (on ? ' on' : '') + '">'
        + (gap ? '<span class="gap">' + esc(gap) + '</span>' : '') + '</span>';
    }

    function nodeTip(at, here, live) {
      if (!live) return here ? 'Открыт сейчас.' : 'Открыть этот снапшот.';
      if (page.anchor() === null) return 'Отметить началом сравнения.';
      return page.anchor() === at ? 'Снять отметку.' : 'Сравнить с отмеченным.';
    }

    function source(item) {
      return item.builds + ' '
        + plural(item.builds, 'сборка', 'сборки', 'сборок') + ', файл '
        + item.file;
    }

    /* Узел рельса — обёртка вокруг чипа и крестика: чипом снапшот открывают
       и таскают, крестиком убирают. Чип нажимается, пока снапшот на странице
       не один: на единственном переключать нечего и сравнивать не с чем, а
       кнопка, которая ничего не делает, обещает лишнее. Крестик есть всегда —
       убрать последний снапшот законно, страница вернётся к зоне загрузки.

       На «Состоянии» чип — выбор из ряда, и aria-pressed говорит, какой
       снапшот открыт. На «Изменениях» нажатого чипа нет: там выбирают не
       узел, а отрезок, и концы диапазона показаны заливкой. */
    function stopHtml(at, item, when, here, live, hot) {
      var cls = 'pick' + (here ? ' on' : '')
        + (page.anchor() === at ? ' anchor' : '');
      var body = '<span class="node"></span><span class="nm">' + esc(item.tag)
        + '</span><span class="when">' + esc(when) + '</span>';
      var chip;
      if (!hot) chip = '<span class="' + cls + '">' + body + '</span>';
      else {
        /* Подсказка называет сперва то, что сделает клик, а следом — то, что
           раньше стояло строкой в списке источников: сколько сборок и из
           какого файла снапшот приехал. */
        chip = '<button type="button" class="' + cls + '" data-node="' + at
          + '" draggable="true"'
          + (live ? '' : ' aria-pressed="' + (here ? 'true' : 'false') + '"')
          + ' data-tip="' + esc(nodeTip(at, here, live) + ' ' + source(item))
          + '">' + body + '</button>';
      }
      return '<span class="stop">' + chip
        + '<button type="button" class="kill" data-drop-snap="' + at
        + '" aria-label="Убрать снапшот ' + esc(item.tag)
        + '" data-tip="Убрать этот снапшот">✕</button></span>';
    }

    /* Место, куда цепочка может продолжиться. Набран призрак как узел и
       классом узла: он стоит с узлами в одном ряду, и ряд этот держится на
       том, что все в нём одного роста. Второй строкой у узла время сбора, у
       призрака — откуда возьмётся снапшот. */
    function ghostHtml() {
      return '<span class="rl dash"></span>'
        + '<button type="button" class="ghost pick" data-add="1"'
        + ' data-tip="Добавить снапшоты из файлов">'
        + '<span class="sign">+</span><span class="nm">добавить</span>'
        + '<span class="when">снапшот</span></button>';
    }

    function render() {
      var items = store.list(), out = '', i, here;
      var live = st.tab === 'diff';
      var ends = live ? page.currentEnds() : null;
      if (!items.length) { box.innerHTML = ''; return; }
      for (i = 0; i < items.length; i++) {
        if (i) {
          out += railHtml(items[i - 1], items[i],
                          ends && i > ends[0] && i <= ends[1]);
        }
        here = ends ? (i === ends[0] || i === ends[1]) : i === st.tag;
        out += stopHtml(i, items[i], stampOf(items[i].generated), here,
                        live, items.length > 1);
      }
      /* Призрак идёт последним и всегда: добавить снапшот можно в любой
         момент, а место, где это делают, не должно ни появляться, ни
         исчезать от того, сколько их уже загружено. */
      out += ghostHtml();
      /* Сводность спрашиваем у самого перехода, а не считаем заново: правило
         «вся цепочка, и только когда снапшотов больше двух» уже сказано —
         для посчитанных на месте пар в page.pairFor, для предпосчитанных в
         diff.js. Двух копий и так на одну больше, чем надо; третья, тут,
         разошлась бы с обеими молча. */
      var pair = ends ? page.pairFor(ends) : null;
      var sum = pair && pair.summary ? '<span class="sum">итог</span>' : '';
      /* Подпись рельса стоит в шапке панели и написана прямо в шаблоне: она
         одна и та же при любых данных, и рисовать её заново на каждую
         перерисовку значило бы каждый раз доказывать, что она не изменилась. */
      box.innerHTML = out + sum;
    }

    /* ---------- выбор ---------- */

    /* Рельс перерисовывается целиком, и нажатая кнопка исчезает вместе с
       фокусом. Выбор здесь двухшаговый: без возврата фокуса второй конец
       пришлось бы искать табом заново, пройдя весь рельс сначала. */
    function focusNode(at) {
      var nodes = box.querySelectorAll('[data-node]'), i;
      for (i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute('data-node') === String(at)) {
          nodes[i].focus();
          return;
        }
      }
    }

    /* Клик по узлу значит на вкладках разное: на «Состоянии» открывает
       снапшот одним кликом, на «Изменениях» выбирает диапазон двумя. Первый
       клик отмечает конец, второй задаёт пару; клик по отмеченному узлу
       снимает отметку — иначе из начатого выбора нельзя было бы выйти, не
       выбрав чего-нибудь. */
    function pickNode(at) {
      /* Подсказка привязана к узлу, которого через строку не станет. Обычно
         её обновит focusin — фокус уезжает на новый узел тут же, ниже. Но
         если узла с таким номером в рельсе не нашлось, focusin не случится,
         и снимать её будет некому. */
      hideTip();
      if (st.tab !== 'diff') {
        page.selectSnapshot(at);
        app.renderStateCards();
        app.render();
        focusNode(at);
        return;
      }
      if (page.anchor() === null) { page.setAnchor(at); render(); }
      else if (page.anchor() === at) { page.setAnchor(null); render(); }
      else {
        /* Концы отдаём в порядке кликов: направление задаёт цепочка, и
           выправляет его page.currentEnds() — единственное место, где это
           правило записано. Второе такое же здесь однажды разошлось бы с ним. */
        var mark = page.anchor();
        page.setAnchor(null);
        page.setPairEnds(mark, at);
        app.renderDiffCards();
        app.render();
      }
      /* Рельс перерисован в любой из веток, и нажатый узел в нём уже новый. */
      focusNode(at);
    }

    /* ---------- перестановка узлов ---------- */

    function chipOf(target) {
      var node = target;
      while (node && node !== box) {
        if (node.getAttribute && node.getAttribute('data-node') !== null
            && node.getAttribute('data-node') !== undefined) {
          return node;
        }
        node = node.parentNode;
      }
      return null;
    }

    /* Пометки живут прямо на узлах, а не в состоянии страницы: перерисовать
       рельс посреди перетаскивания значило бы убрать из-под курсора то, что
       он тащит. */
    function mark(node, add) {
      var base = String(node.className).replace(/\s*\b(before|after|moving)\b/g, '');
      node.className = add ? base + ' ' + add : base;
    }

    function clearMarks() {
      var nodes = box.querySelectorAll('[data-node]'), i;
      for (i = 0; i < nodes.length; i++) mark(nodes[i], '');
    }

    function endDrag() { dragFrom = null; dropAt = null; clearMarks(); }

    box.addEventListener('dragstart', function (e) {
      var chip = chipOf(e.target);
      if (!chip) return;
      dragFrom = parseInt(chip.getAttribute('data-node'), 10);
      dropAt = null;
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(NODE_MIME, String(dragFrom));
      }
      mark(chip, 'moving');
    });

    /* Место вставки — по ближнему краю узла, к которому подносят: курсор в
       левой половине значит «перед ним», в правой — «за ним». */
    box.addEventListener('dragover', function (e) {
      if (dragFrom === null) return;
      var chip = chipOf(e.target);
      if (!chip) return;
      /* Без preventDefault браузер считает, что сюда ронять нельзя, и drop
         не случится вовсе. */
      e.preventDefault();
      var at = parseInt(chip.getAttribute('data-node'), 10);
      var rect = chip.getBoundingClientRect();
      var after = e.clientX > rect.left + rect.width / 2;
      clearMarks();
      mark(chip, after ? 'after' : 'before');
      if (dragFrom !== null) {
        var moved = box.querySelectorAll('[data-node="' + dragFrom + '"]');
        if (moved.length) mark(moved[0], 'moving');
      }
      dropAt = at + (after ? 1 : 0);
    });

    box.addEventListener('drop', function (e) {
      if (dragFrom === null) return;
      /* Узел, брошенный на рельс, — не файл, брошенный на страницу: без
         остановки всплытия его принял бы приёмник файлов. */
      e.preventDefault();
      e.stopPropagation();
      var from = dragFrom, place = dropAt;
      endDrag();
      if (place === null) return;
      /* Узел сначала вынимают, и промежутки правее него сдвигаются на один. */
      var to = place > from ? place - 1 : place;
      if (to !== from) store.move(from, to - from);
    });

    /* Перетаскивание может кончиться и мимо рельса — пометки снимаются в
       любом случае, а порядок меняет только drop. */
    box.addEventListener('dragend', endDrag);

    return { render: render, pickNode: pickNode };
  }

  return { create: create };
}));
