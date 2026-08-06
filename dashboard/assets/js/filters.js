/* Фильтры: кнопка в панели управления и плашка меню под ней. Владеет
   обоими узлами и своими слушателями; наружу отдаёт sync и close.

   Признак трёхпозиционный, и меню — единственное место, где видно все три
   положения сразу: плашка умеет только «есть» и «неважно». Отсюда же
   переключается режим группы — складывать её по И или по ИЛИ.

   Числа рядом с признаками считаются при открытии меню, а не на каждую
   перерисовку страницы: это проход по всем строкам вкладки, и делать его
   ради закрытой плашки незачем. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.filters = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* Порядок положений — от самого слабого к самому сильному: «неважно»
     слева, потому что это умолчание, и глаз ищет его на месте начала. */
  const STATES = [[0, 'неважно'], [1, 'есть'], [-1, 'нет']];

  function create(deps) {
    const box = deps.box, button = deps.button;
    const page = deps.page, labels = deps.labels, text = deps.text;
    const app = deps.app, esc = deps.text.esc;
    let open = false;

    function syncButton() {
      const n = text.keys(page.activeFilters()).length;
      button.textContent = n ? `Фильтры · ${n}` : 'Фильтры';
      button.className = n ? 'toggle on' : 'toggle';
    }

    function stateHtml(key) {
      const at = page.filterState(key);
      return `<span class="fset" role="group"`
        + ` aria-label="${esc(labels.label(key))}">`
        + STATES.map((pair) =>
            `<button type="button" data-fset="${esc(key)}:${pair[0]}"`
            + ` aria-pressed="${at === pair[0]}">${pair[1]}</button>`).join('')
        + '</span>';
    }

    function rowHtml(key, counts) {
      const n = text.own(counts, key);
      return '<div class="frow">'
        + `<span class="fl">${esc(labels.label(key))}</span>`
        + `<span class="fn">${esc(n === undefined ? '' : n)}</span>`
        + stateHtml(key) + '</div>';
    }

    function modeHtml(id) {
      const mode = page.groupMode(id);
      return '<span class="fmode" role="group" aria-label="как складывать">'
        + `<button type="button" data-fmode="${esc(id)}:all"`
        + ` aria-pressed="${mode === 'all'}">все</button>`
        + `<button type="button" data-fmode="${esc(id)}:any"`
        + ` aria-pressed="${mode === 'any'}">любой из</button></span>`;
    }

    function groupHtml(group, counts) {
      return '<div class="fgroup"><div class="fghead">'
        + `<span class="fgname">${esc(group.label)}</span>`
        + modeHtml(group.id) + '</div>'
        + group.keys.map((key) => rowHtml(key, counts)).join('') + '</div>';
    }

    function menuHtml() {
      const groups = labels.groups(page.st.tab);
      if (!groups.length) return '<div class="fnone">фильтровать нечего</div>';
      const counts = page.filterCounts();
      return '<div class="fhead"><span class="fl">фильтры</span>'
        + '<button type="button" class="fclear" data-fclear="1">'
        + 'сбросить всё</button></div>'
        + groups.map((group) => groupHtml(group, counts)).join('');
    }

    function draw() { box.innerHTML = menuHtml(); }

    function sync() {
      syncButton();
      /* Закрытую плашку не перерисовываем: её содержимое всё равно
         собирается заново при открытии, а счётчики стоят прохода по всем
         строкам вкладки. */
      if (open) draw();
    }

    function show(on) {
      open = Boolean(on);
      box.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) draw();
    }

    function close() { if (open) show(false); }

    button.addEventListener('click', (e) => {
      e.preventDefault();
      show(!open);
    });

    box.addEventListener('click', (e) => {
      let node = e.target, bits;
      while (node && node !== box) {
        if (node.getAttribute) {
          if (node.getAttribute('data-fclear')) {
            page.toggleFilter('all');
            app.render();
            return;
          }
          const set = node.getAttribute('data-fset');
          if (set) {
            bits = set.split(':');
            page.setFilter(bits[0], parseInt(bits[1], 10));
            app.render();
            return;
          }
          const mode = node.getAttribute('data-fmode');
          if (mode) {
            bits = mode.split(':');
            page.setGroupMode(bits[0], bits[1]);
            app.render();
            return;
          }
        }
        node = node.parentNode;
      }
    });

    /* Клик мимо закрывает: плашка лежит поверх таблицы, и оставлять её
       открытой, когда человек уже работает со строками, значит закрывать
       ему то, ради чего он фильтр и ставил. Свои клики доходят до документа
       тоже, поэтому спрашиваем, откуда пришло событие. */
    document.addEventListener('click', (e) => {
      if (!open) return;
      let node = e.target;
      while (node && node !== document) {
        if (node === box || node === button) return;
        node = node.parentNode;
      }
      show(false);
    });

    document.addEventListener('keydown', (e) => {
      if (open && e.key === 'Escape') show(false);
    });

    return { sync, close };
  }

  return { create };
}));
