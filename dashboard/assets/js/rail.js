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
  const NODE_MIME = 'text/x-dashboard-node';

  function create(deps) {
    const { box, page, store, app, hideTip } = deps;
    const { esc, plural, stampOf, gapLabel } = deps.text;
    const st = page.st;

    /* Номер узла, который тащат, и промежуток, куда его поставят. Промежуток
       считается в границах между узлами: 0 — перед первым, items.length —
       за последним. */
    let dragFrom = null, dropAt = null;

    /* ---------- разметка ---------- */

    /* Отрезок между соседними узлами, с расстоянием во времени над ним. */
    function railHtml(from, to, on) {
      const gap = gapLabel(from.generated, to.generated);
      return `<span class="rl${on ? ' on' : ''}">`
        + (gap ? `<span class="gap">${esc(gap)}</span>` : '') + '</span>';
    }

    function nodeTip(at, here, live) {
      if (!live) return here ? 'Открыт сейчас.' : 'Открыть этот снапшот.';
      if (page.anchor() === null) return 'Отметить началом сравнения.';
      return page.anchor() === at ? 'Снять отметку.' : 'Сравнить с отмеченным.';
    }

    function source(item) {
      return `${item.builds} `
        + `${plural(item.builds, 'сборка', 'сборки', 'сборок')}, файл `
        + `${item.file}`;
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
      const cls = `pick${here ? ' on' : ''}`
        + `${page.anchor() === at ? ' anchor' : ''}`;
      const body = `<span class="node"></span><span class="nm">${esc(item.tag)}`
        + `</span><span class="when">${esc(when)}</span>`;
      let chip;
      if (!hot) chip = `<span class="${cls}">${body}</span>`;
      else {
        /* Подсказка называет сперва то, что сделает клик, а следом — то, что
           раньше стояло строкой в списке источников: сколько сборок и из
           какого файла снапшот приехал. */
        const tip = `${nodeTip(at, here, live)} ${source(item)}`;
        chip = `<button type="button" class="${cls}" data-node="${at}"`
          + ' draggable="true"'
          + (live ? '' : ` aria-pressed="${here ? 'true' : 'false'}"`)
          + ` data-tip="${esc(tip)}">${body}</button>`;
      }
      return `<span class="stop">${chip}`
        + `<button type="button" class="kill" data-drop-snap="${at}"`
        + ` aria-label="Убрать снапшот ${esc(item.tag)}"`
        + ' data-tip="Убрать этот снапшот">✕</button></span>';
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
      const items = store.list();
      const live = st.tab === 'diff';
      const ends = live ? page.currentEnds() : null;
      if (!items.length) { box.innerHTML = ''; return; }
      let out = '';
      for (let i = 0; i < items.length; i++) {
        if (i) {
          out += railHtml(items[i - 1], items[i],
                          ends && i > ends[0] && i <= ends[1]);
        }
        const here = ends ? (i === ends[0] || i === ends[1]) : i === st.tag;
        out += stopHtml(i, items[i], stampOf(items[i].generated), here,
                        live, items.length > 1);
      }
      /* Призрак идёт последним и всегда: добавить снапшот можно в любой
         момент, а место, где это делают, не должно ни появляться, ни
         исчезать от того, сколько их уже загружено. Он же и последнее, что
         на рельсе есть: метка «итог» стояла здесь, за призраком, и оттуда
         не читалась ни как подпись диапазона, ни как что-либо ещё.
         Сводность диапазона по-прежнему считается и лежит в данных
         страницы — просто рельс её больше не подписывает. */
      out += ghostHtml();
      /* Подпись рельса стоит в шапке панели и написана прямо в шаблоне: она
         одна и та же при любых данных, и рисовать её заново на каждую
         перерисовку значило бы каждый раз доказывать, что она не изменилась. */
      box.innerHTML = out;
    }

    /* ---------- выбор ---------- */

    /* Рельс перерисовывается целиком, и нажатая кнопка исчезает вместе с
       фокусом. Выбор здесь двухшаговый: без возврата фокуса второй конец
       пришлось бы искать табом заново, пройдя весь рельс сначала. */
    function focusNode(at) {
      for (const node of box.querySelectorAll('[data-node]')) {
        if (node.getAttribute('data-node') === String(at)) {
          node.focus();
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
        const anchored = page.anchor();
        page.setAnchor(null);
        page.setPairEnds(anchored, at);
        app.renderDiffCards();
        app.render();
      }
      /* Рельс перерисован в любой из веток, и нажатый узел в нём уже новый. */
      focusNode(at);
    }

    /* ---------- перестановка узлов ---------- */

    function chipOf(target) {
      let node = target;
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
      const base = String(node.className)
        .replace(/\s*\b(before|after|moving)\b/g, '');
      node.className = add ? `${base} ${add}` : base;
    }

    function clearMarks() {
      for (const node of box.querySelectorAll('[data-node]')) mark(node, '');
    }

    function endDrag() { dragFrom = null; dropAt = null; clearMarks(); }

    box.addEventListener('dragstart', (e) => {
      const chip = chipOf(e.target);
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
    box.addEventListener('dragover', (e) => {
      if (dragFrom === null) return;
      const chip = chipOf(e.target);
      if (!chip) return;
      /* Без preventDefault браузер считает, что сюда ронять нельзя, и drop
         не случится вовсе. */
      e.preventDefault();
      const at = parseInt(chip.getAttribute('data-node'), 10);
      const rect = chip.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      clearMarks();
      mark(chip, after ? 'after' : 'before');
      const moved = box.querySelectorAll(`[data-node="${dragFrom}"]`);
      if (moved.length) mark(moved[0], 'moving');
      dropAt = at + (after ? 1 : 0);
    });

    box.addEventListener('drop', (e) => {
      if (dragFrom === null) return;
      /* Узел, брошенный на рельс, — не файл, брошенный на страницу: без
         остановки всплытия его принял бы приёмник файлов. */
      e.preventDefault();
      e.stopPropagation();
      const from = dragFrom, place = dropAt;
      endDrag();
      if (place === null) return;
      /* Узел сначала вынимают, и промежутки правее него сдвигаются на один. */
      const to = place > from ? place - 1 : place;
      if (to !== from) store.move(from, to - from);
    });

    /* Перетаскивание может кончиться и мимо рельса — пометки снимаются в
       любом случае, а порядок меняет только drop. */
    box.addEventListener('dragend', endDrag);

    /* ---------- прокрутка колесом ---------- */

    /* Полосы прокрутки под рельсом нет: рельс — линия с узлами, и вторая
       линия под ней читалась бы как часть рисунка. Катят его колесом.

       Колесо крутят вертикальное, а едет рельс вбок: это не подмена оси, а
       единственное, что колесо может значить, пока курсор стоит на ряде,
       который тянется вбок и никуда не тянется вниз.

       Шаг умножен: узел рельса шириной с добрых две сотни пикселей, а
       щелчок колеса приносит около полусотни, и без множителя один снапшот
       уезжал бы за четыре щелчка. */
    const WHEEL = 2;
    const LINE = 16;

    box.addEventListener('wheel', (e) => {
      const room = box.scrollWidth - box.clientWidth;
      /* Цепочка влезла целиком — прокручивать нечего, и колесо принадлежит
         странице. */
      if (room <= 1) return;
      /* Боком крутят сами — тачпадом или с шифтом; такое колесо браузер
         разложит по рельсу и без нас. */
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      let step = e.deltaY;
      if (e.deltaMode === 1) step *= LINE;
      else if (e.deltaMode === 2) step *= box.clientWidth;
      step *= WHEEL;
      /* Докрутив до конца цепочки, колесо остаётся рельсу: прокрутка,
         которая на последнем узле перескакивает на страницу, уводит из-под
         курсора то самое, что человек в этот момент разглядывает. Уехать со
         страницей проще всего, отведя курсор с рельса, — полоса у него
         узкая. */
      e.preventDefault();
      box.scrollLeft = box.scrollLeft + step;
    }, { passive: false });

    return { render, pickNode };
  }

  return { create };
}));
