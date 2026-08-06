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

    /* Плашка длинная — классов патчей бывает десяток, — а панель управления
       липкая. Не влезает вниз: двигаем страницу ровно на недостачу, панель
       доезжает до верха окна и утягивает плашку за собой. Не в начало
       страницы: человек смотрел на свои строки, и терять это место незачем. */
    function fit() {
      if (!box.getBoundingClientRect || !window.scrollBy) return;
      /* Меряем от исходного места: прошлое открытие могло сдвинуть плашку,
         а окно с тех пор изменилось. */
      box.style.left = '0px';
      box.style.maxHeight = '';
      let rect = box.getBoundingClientRect();
      const under = rect.bottom - window.innerHeight + 8;
      if (under > 0) window.scrollBy(0, under);
      rect = box.getBoundingClientRect();
      /* Что не отыграла прокрутка, забирает высота: на короткой странице
         двигать нечего, и плашка обязана ужаться сама, а не уехать за край
         окна. Нижний предел — чтобы в самом тесном окне она осталась
         плашкой, а не щелью. */
      box.style.maxHeight = Math.max(140, window.innerHeight - rect.top - 12)
        + 'px';
      /* Плашка шире кнопки, и от её левого края на узком окне уходит за
         правый край страницы. Двигаем влево ровно на недостачу и не дальше
         левого края окна: вылезти с другой стороны — не починка. */
      const past = rect.right - window.innerWidth + 8;
      if (past > 0) {
        box.style.left = -Math.min(past, Math.max(0, rect.left - 8)) + 'px';
      }
    }

    function show(on) {
      open = Boolean(on);
      box.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      if (open) { draw(); fit(); }
    }

    function close() { if (open) show(false); }

    button.addEventListener('click', (e) => {
      e.preventDefault();
      show(!open);
    });

    /* Событие, которое плашка уже признала своим. Условий человек ставит
       несколько подряд, а каждое перерисовывает меню — и узел, по которому
       щёлкнули, уходит из дерева раньше, чем очередь дойдёт до обработчика
       на документе. От оторванного узла до плашки не дойти, и клик выглядел
       бы внешним: меню закрывалось бы после первого же нажатия. Помним само
       событие, а не узел: оно живо ровно столько, сколько идёт всплытие. */
    let ours = null;

    /* Разметка меню перерисовывается на каждое нажатие, и кнопка, по которой
       щёлкнули, исчезает вместе с фокусом. Возвращаем его на её замену:
       иначе с клавиатуры второе условие пришлось бы искать табом с начала
       плашки. Так же поступает и рельс — там выбор тоже двухшаговый. */
    function refocus(attr, value) {
      for (const node of box.querySelectorAll(`[${attr}]`)) {
        if (node.getAttribute(attr) === value) { node.focus(); return; }
      }
    }

    function apply(e, attr, value, fn) {
      ours = e;
      fn();
      app.render();
      refocus(attr, value);
    }

    box.addEventListener('click', (e) => {
      let node = e.target, bits;
      while (node && node !== box) {
        if (node.getAttribute) {
          if (node.getAttribute('data-fclear')) {
            apply(e, 'data-fclear', '1', () => page.toggleFilter('all'));
            return;
          }
          const set = node.getAttribute('data-fset');
          if (set) {
            bits = set.split(':');
            apply(e, 'data-fset', set,
                  () => page.setFilter(bits[0], parseInt(bits[1], 10)));
            return;
          }
          const mode = node.getAttribute('data-fmode');
          if (mode) {
            bits = mode.split(':');
            apply(e, 'data-fmode', mode,
                  () => page.setGroupMode(bits[0], bits[1]));
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
      if (!open || e === ours) return;
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
