/* Корень страницы: находит свои узлы, кладёт в них разметку, связывает
   события и раздаёт себя тем, кто держит свой участок сам.

   Что показывать — знает page.js, из чего строить разметку — tables.js с
   cards.js, что вообще есть на странице — store.js. Рельс, загрузка файлов
   и подсказки владеют своими узлами целиком; здесь про них известно только
   то, чем их зовут. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./viewmodel.js'), require('./store.js'),
                             require('./diff.js'), require('./text.js'),
                             require('./labels.js'), require('./markup.js'),
                             require('./tables.js'), require('./cards.js'),
                             require('./page.js'), require('./hash.js'),
                             require('./rail.js'), require('./files.js'),
                             require('./tips.js'), require('./toasts.js'),
                             require('./address.js'), require('./filters.js'),
                             require('./search.js'), require('./copy.js'),
                             require('./viewport.js'), require('./notices.js'),
                             require('./query.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.diff,
                         root.KP.text, root.KP.labels, root.KP.markup,
                         root.KP.tables, root.KP.cards, root.KP.page,
                         root.KP.hash, root.KP.rail, root.KP.files,
                         root.KP.tips, root.KP.toasts, root.KP.address,
                         root.KP.filters, root.KP.search, root.KP.copy,
                         root.KP.viewport, root.KP.notices, root.KP.query);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, diffmod, text, labels, markup, tables, cards,
            pagemod, hash, railmod, filesmod, tipsmod, toastsmod, addressmod,
            filtersmod, searchmod, copymod, viewportmod, noticesmod, querymod) {
  'use strict';

  /* Состояние страницы живёт в page.js: там же и всё, что из него
     считается — выбор снапшота, диапазон сравнения, фильтры, поиск,
     сортировка. Здесь — короткие имена для того, что зовут отсюда чаще
     всего. */
  let page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text,
                              search: searchmod, query: querymod });
  const st = page.st;
  const curSnap = page.curSnap, curPair = page.curPair;
  const visibleRows = page.visibleRows, sortRows = page.sortRows;
  const rowKey = page.rowKey, openOf = page.openOf;
  const activeFilters = page.activeFilters, totalRows = page.totalRows;
  const snapshots = page.snapshots;

  const stateSection = document.getElementById('tab-state');
  const diffSection = document.getElementById('tab-diff');
  let controls = document.getElementById('controls');
  const search = document.getElementById('q');
  const clearBtn = document.getElementById('q-clear');
  const counter = document.getElementById('count');
  const qbad = document.getElementById('q-bad');
  const expandBtn = document.getElementById('expand');
  const copyBtn = document.getElementById('copy-nvr');
  const tabBtns = Array.from(document.querySelectorAll('.tab'));
  const stateBody = document.getElementById('state-rows');
  const diffBody = document.getElementById('diff-rows');
  const tabsNav = document.querySelector('.tabs');
  const emptySection = document.getElementById('tab-empty');
  const sourcesBox = document.getElementById('sources');
  const chainBox = document.getElementById('chain');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop');
  const pickBtn = document.getElementById('pick');

  /* ---------- вспомогательное ---------- */

  /* Считалки строк живут в text.js. Здесь — короткие имена для тех, кого
     зовут отсюда: тела оставшихся функций читаются лучше, когда в них стоит
     esc(), а не text.esc(). */
  const esc = text.esc, own = text.own, keys = text.keys, plural = text.plural;

  /* Фильтр ставит и снимает page — он один знает правило про «версия та же»
     и «что-то изменилось». Перерисовка остаётся здесь: страницу рисует
     корень. */
  function toggleFilter(key) {
    page.toggleFilter(key);
    render();
  }

  /* ---------- сортировка ---------- */

  function syncArrows() {
    const table = document.getElementById(st.tab === 'diff' ? 'diff-table' : 'state-table');
    const cfg = st.sort[st.tab];
    for (const th of table.querySelectorAll('th[data-sort]')) {
      const span = th.querySelector('.arrow');
      if (!span) continue;
      span.textContent = th.getAttribute('data-sort') === cfg.key
        ? (cfg.asc ? '▲' : '▼') : '';
    }
  }

  /* ---------- сколько колонок ---------- */

  /* Сколько колонок в таблице вкладки. Считаем по самой разметке: строка на
     всю ширину (деталь, «ничего не найдено») пишется числом, а колонку в
     шаблон добавляют отдельно — и число молча остаётся от прежней таблицы. */
  function colCount(tab) {
    const table = document.getElementById(tab === 'diff' ? 'diff-table'
                                                      : 'state-table');
    return table.querySelectorAll('th').length;
  }

  /* ---------- карточки, селекторы, чипы ---------- */

  /* Ширина карточки-среза. Браузер набивает строку под завязку и про
     остаток не думает: двенадцать срезов при десяти влезающих дают вторую
     строку из двух карточек. Считаем, на сколько строк они делятся поровну,
     и задаём ширину числом — строка флексов растягивает то, что в ней стоит,
     поэтому короткая последняя строка занята целиком.

     Меряет тот, у кого есть раскладка: без неё (в тестах, у спрятанной
     вкладки) ширина нулевая, и трогать нечего — карточки останутся при
     своём минимуме из стилей. */
  function fitCards(box) {
    if (!box || !window.getComputedStyle || !box.clientWidth) return;
    const list = box.querySelectorAll('.card');
    if (!list.length) return;
    const style = window.getComputedStyle(box);
    const gap = parseFloat(style.columnGap) || 0;
    const min = parseFloat(style.getPropertyValue('--card-min')) || 1;
    const cols = cards.columnsFor(list.length, box.clientWidth, min, gap);
    /* Минус пиксель: при точном делении браузер иногда не пускает последнюю
       карточку в строку, и она уезжает вниз одна — ровно то, от чего
       считали. */
    const width = (box.clientWidth - (cols - 1) * gap) / cols - 1;
    box.style.setProperty('--card-w', Math.max(min, width) + 'px');
  }

  /* Все четыре ряда карточек: итоги и срезы на обеих вкладках. Правило одно
     на всех, и минимум своей ширины каждый ряд несёт в своих стилях. */
  const CARD_BOXES = ['state-cards', 'class-cards', 'diff-pair', 'diff-cards'];

  function fitAllCards() {
    for (const id of CARD_BOXES) fitCards(document.getElementById(id));
  }

  function renderStateCards() {
    const out = cards.stateCards(curSnap());
    document.getElementById('state-cards').innerHTML = out.big;
    document.getElementById('class-cards').innerHTML = out.classes;
    fitCards(document.getElementById('state-cards'));
    fitCards(document.getElementById('class-cards'));
  }

  function renderDiffCards() {
    const pair = curPair();
    /* Концы перехода берём у страницы, а не у самой пары: пара знает свои
       теги, но не то, каким сбором каждого из них она посчитана, — а именно
       это отличает два прогона одного тега друг от друга. */
    const ends = page.currentEnds(), snaps = snapshots();
    document.getElementById('diff-pair').innerHTML = ends
      ? cards.pairCards(pair, snaps[ends[0]], snaps[ends[1]]) : '';
    document.getElementById('diff-cards').innerHTML = cards.diffCards(pair);
    fitCards(document.getElementById('diff-pair'));
    fitCards(document.getElementById('diff-cards'));
  }

  /* Плашка показывает все три положения признака: нажата — «есть», класс
     is-no — «нет», ничего — «неважно». «Нет» нажатием быть не может: это не
     выбор этой плашки, а запрет, и показывать его тем же, чем показан
     выбор, значило бы называть разные вещи одним.

     Плашка «все» нажата, когда на вкладке не стоит ни одного фильтра. */
  function syncCards() {
    const host = st.tab === 'diff' ? diffSection : stateSection;
    const empty = !keys(activeFilters()).length;
    for (const node of host.querySelectorAll('.card[data-filter]')) {
      const key = node.getAttribute('data-filter');
      const state = key === 'all' ? (empty ? 1 : 0) : page.filterState(key);
      node.setAttribute('aria-pressed', String(state === 1));
      const base = String(node.className).replace(/\s*is-no\b/g, '');
      node.className = state === -1 ? `${base} is-no` : base;
    }
  }

  /* Меню одной вкладки на другой показывало бы чужие признаки: закрываем
     его вместе со сменой таблицы. */
  function closeFilters() { filters.close(); }


  /* ---------- рендер ---------- */

  /* Что таблицам нужно знать о странице: запрос, ширина таблицы, ключ строки
     и её раскрытость. Собрано в одном месте, чтобы обе таблицы получали одно
     и то же — разойдись они здесь, разъехались бы и colspan у деталей. */
  function rowOpts() {
    const pair = st.tab === 'diff' ? curPair() : null;
    return { q: page.matcher(), cols: colCount(st.tab), keyOf: rowKey, openOf: openOf,
             oldTag: pair ? pair.old : 'было',
             newTag: pair ? pair['new'] : 'стало' };
  }

  /* Считаем по тому же правилу, что и рендер, иначе подпись кнопки обещала бы
     одно, а нажатие делало другое. */
  function allOpen(items) {
    if (!items.length) return false;
    return items.every((item) => openOf(rowKey(item.row), item.open));
  }

  function render() {
    /* Подсказка привязана к узлу, а таблица сейчас будет перерисована:
       без этого она пережила бы свой якорь и висела бы над пустым местом. */
    hideTip();
    const items = sortRows(visibleRows());
    const total = totalRows();
    const body = st.tab === 'diff' ? diffBody : stateBody;
    const word = st.tab === 'diff'
      ? plural(total, 'компонент', 'компонента', 'компонентов')
      : plural(total, 'билд', 'билда', 'билдов');

    counter.textContent = items.length + ' / ' + total + ' ' + word;
    /* Шаблон не разобрался: строки не фильтруются, и надо сказать почему.
       Текст берём у браузера дословно — он называет место ошибки, а общий
       текст от нас не назвал бы. Подсказкой даём его целиком: в строке он
       обрезан. */
    const problem = page.matcher().problem;
    qbad.hidden = !problem;
    qbad.textContent = problem
      ? 'регулярка не разбирается: ' + problem + ' — показаны все строки' : '';
    if (problem) qbad.setAttribute('data-tip', problem);
    expandBtn.textContent = allOpen(items) ? 'Collapse all' : 'Expand all';
    expandBtn.disabled = !items.length;
    copyBtn.disabled = !items.length;

    syncCards();
    filters.sync();
    syncArrows();
    /* Рельс показывает текущий выбор, а он меняется и без смены состава:
       переключили тег, пару или вкладку — рельс обязан это отразить.
       Список источников при этом не трогаем: перерисовывать его на каждое
       нажатие клавиши в поиске значит забирать фокус с его кнопок. */
    rail.render();

    if (!items.length) {
      body.innerHTML = '<tr><td class="empty" colspan="' + colCount(st.tab) + '">'
        + (total ? 'Под фильтры и запрос ничего не подходит'
                 : 'В этой выборке нет строк') + '</td></tr>';
    } else {
      body.innerHTML = st.tab === 'diff' ? tables.diffRows(items, rowOpts())
                                         : tables.stateRows(items, rowOpts());
    }
    address.write();
  }

  /* Карточки перерисовываются только при смене вкладки, тега или пары:
     иначе клик по карточке уничтожал бы её же вместе с фокусом. */
  function rebuild() {
    renderStateCards();
    renderDiffCards();
    render();
  }

  /* Сравнивать нечего — вкладки «Изменения» на странице нет вовсе. Считаем
     по числу снапшотов, а не по длине предпосчитанного списка пар: переход
     есть у любых двух снапшотов, и предпосчитанные — лишь часть из них. */
  function syncTabs() {
    for (const btn of tabBtns) {
      if (btn.getAttribute('data-tab') === 'diff') {
        btn.hidden = snapshots().length < 2;
      }
    }
  }

  function showTab(name) {
    /* Единственное место, где снимается отметка: начатый выбор со сменой
       вкладки теряет смысл — на «Состоянии» клик по узлу открывает
       снапшот, и отметка ждала бы второго клика, которого там никто не
       сделает. Смена состава снапшотов проходит здесь же: applyData
       заканчивается showTab, а номер узла после прихода файла стоит уже
       у другого снапшота. */
    page.setAnchor(null);
    if (name === 'diff' && snapshots().length < 2) name = 'state';
    st.tab = name;
    for (const btn of tabBtns) {
      btn.setAttribute('aria-selected',
        String(btn.getAttribute('data-tab') === name));
    }
    stateSection.hidden = name !== 'state';
    diffSection.hidden = name !== 'diff';
    /* У спрятанной вкладки ширины нет, и посчитанная при её отрисовке
       ширина карточки была бы взята из нуля. Считаем, когда показали. */
    fitAllCards();
    /* Панель поиска одна на страницу и переезжает к активной таблице:
       два одинаковых поля с разными id путали бы и пользователя, и hash. */
    const host = name === 'diff' ? diffSection : stateSection;
    /* Не anchor: так зовётся отмеченный узел рельса, и локальная переменная
       с тем же именем забирала бы себе его сброс строкой выше. */
    const wrap = host.querySelector('.tablewrap');
    host.insertBefore(controls, wrap);
    closeFilters();
    search.placeholder = name === 'diff'
      ? 'Компонент, версия, тег, ветка, патч, CVE, RPM…'
      : 'Компонент, тег, ветка, патч, CVE, RPM…';
  }

  /* ---------- события ---------- */

  /* Переключаем от того состояния, которое человек видит на экране, а не от
     наличия ключа: строку, раскрытую поиском, иначе не свернуть. */
  function toggleRow(key) {
    let items = visibleRows(), deep = false, i;
    for (i = 0; i < items.length; i++) {
      if (rowKey(items[i].row) === key) { deep = items[i].open; break; }
    }
    page.setOpen(key, !openOf(key, deep));
    render();
  }

  function bodyHandler(e) {
    let node = e.target, body = e.currentTarget;
    while (node && node !== body) {
      /* Ссылка внутри строки ведёт наружу и не должна разворачивать строку. */
      if (node.tagName === 'A') return;
      if (node.getAttribute) {
        const filter = node.getAttribute('data-filter');
        if (filter) { e.preventDefault(); toggleFilter(filter); return; }
        const key = node.getAttribute('data-row');
        if (key) { e.preventDefault(); toggleRow(key); return; }
      }
      node = node.parentNode;
    }
  }

  function bindBody(body) {
    body.addEventListener('click', bodyHandler);
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') bodyHandler(e);
    });
  }
  bindBody(stateBody);
  bindBody(diffBody);

  /* Плашки и узлы рельса — делегированием: их разметку страница
     перерисовывает целиком. */
  document.addEventListener('click', (e) => {
    let node = e.target;
    while (node && node !== document) {
      if (node.getAttribute) {
        if (node.className && String(node.className).indexOf('card') !== -1) {
          const f = node.getAttribute('data-filter');
          if (f) { toggleFilter(f); return; }
        }
        const stop = node.getAttribute('data-node');
        if (stop !== null && stop !== undefined) {
          rail.pickNode(parseInt(stop, 10));
          return;
        }
        let tab = node.getAttribute('data-tab');
        if (tab) { showTab(tab); render(); return; }
        /* Крестик и призрак живут на рельсе, а он перерисовывается целиком,
           поэтому их обработчики здесь, а не на самих кнопках. */
        if (node.getAttribute('data-add')) { files.openPicker(); return; }
        const gone = node.getAttribute('data-drop-snap');
        if (gone !== null && gone !== undefined) {
          store.remove(parseInt(gone, 10));
          return;
        }
      }
      node = node.parentNode;
    }
  });

  /* Сортировка. Шапки статичны, поэтому обработчики можно навесить один раз.
     th объявлен на каждый виток, поэтому обработчики видят свою шапку, а не
     последнюю: раньше это делала обёртка-IIFE. */
  for (const th of document.querySelectorAll('th[data-sort]')) {
    function fire() {
      page.sortBy(th.getAttribute('data-sort'));
      render();
    }
    th.setAttribute('tabindex', '0');
    th.addEventListener('click', fire);
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault(); fire();
      }
    });
  }

  /* Каждое нажатие перестраивает весь tbody вместе с раскрытыми деталями, а
     тег — это тысячи билдов. Ждём паузы в наборе. */
  const SEARCH_DELAY = 120;
  let searchTimer = null;

  /* Крестик следует за полем без задержки: перерисовку таблицы откладывают
     ради тысяч строк, а показать крестик ничего не стоит, и запаздывать
     ему не за чем. */
  function syncClear() {
    clearBtn.hidden = !search.value;
  }

  search.addEventListener('input', () => {
    syncClear();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = null;
      st.q = search.value.trim();
      render();
    }, SEARCH_DELAY);
  });

  clearBtn.addEventListener('click', () => {
    /* Отложенный поиск отменяем не ради правильности — сработав, он
       прочитал бы уже пустое поле и ничего не испортил, — а ради работы:
       это лишняя перерисовка всей таблицы через 120 мс после той, что мы
       делаем прямо сейчас. На теге в тысячу билдов она заметна. */
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
    search.value = '';
    st.q = '';
    syncClear();
    /* Курсор обратно в поле: крестиком чаще всего чистят, чтобы набрать
       другое, а не чтобы уйти со страницы. */
    search.focus();
    render();
  });

  expandBtn.addEventListener('click', () => {
    const items = visibleRows();
    const collapse = allOpen(items);
    /* Пишем явное false, а не удаляем ключ: иначе строки, раскрытые поиском,
       остались бы раскрытыми, а подпись кнопки уже сменилась бы. */
    for (const item of items) page.setOpen(rowKey(item.row), !collapse);
    render();
  });

  /* ---------- владельцы участков страницы ---------- */

  /* Корень заполняется по ходу: рельс берёт метод в момент вызова, а не в
     момент создания, и порядок объявлений здесь ничего не решает. Городить
     ради одного подписчика шину событий незачем — страница перерисовывается
     целиком. */
  const app = {};
  const tips = tipsmod.create({ node: document.getElementById('tip') });
  const hideTip = tips.hide;
  const toasts = toastsmod.create({ node: document.getElementById('toasts') });
  const address = addressmod.create({
    page: page, hash: hash, dom: { search: search, clear: clearBtn },
    /* Ссылка, присланная позже, — это смена всего сразу: вкладки, выбора,
       фильтров. Что после неё перерисовать, знает корень. */
    onExternal: () => { page.dropDeadFilters(); showTab(st.tab); rebuild(); } });
  let rail = railmod.create({ box: chainBox, page: page, store: store,
                              text: text, app: app, hideTip: hideTip });
  let files = filesmod.create({ store: store, toasts: toasts,
    dom: { input: fileInput, drop: dropZone, pick: pickBtn } });
  const notices = noticesmod.create({ store: store, toasts: toasts });
  const filters = filtersmod.create({
    box: document.getElementById('filtermenu'),
    button: document.getElementById('filters'),
    page: page, labels: labels, text: text, app: app });
  app.render = render;
  app.renderStateCards = renderStateCards;
  app.renderDiffCards = renderDiffCards;
  const copier = copymod.create({
    button: copyBtn,
    rowsOf: () => sortRows(visibleRows()).map((item) => item.row) });


  viewportmod.create({ controls: controls, toTop: document.getElementById('totop'),
                       onResize: fitAllCards });

  /* ---------- загрузка снапшотов ---------- */

  /* Пустой дашборд показывает только зону загрузки: вкладки без данных
     обещали бы содержимое, которого нет. */
  function syncEmpty() {
    const has = store.list().length > 0;
    emptySection.hidden = has;
    sourcesBox.hidden = !has;
    tabsNav.hidden = !has;
    if (!has) {
      stateSection.hidden = true;
      diffSection.hidden = true;
    }
  }


  /* Состав снапшотов весь живёт на рельсе: там его показывают, там же
     добавляют, переставляют и убирают. Отдельного списка источников с теми
     же строками у страницы больше нет. */
  function renderSources() {
    rail.render();
    notices.sync();
  }

  /* Единственная дверь для данных. Порядок здесь не косметический, и стоит он
     в корне, а не в page.applyData: считать состояние — дело page, а решать,
     что после этого перерисовать, — дело того, кто владеет узлами. */
  function applyData(pageData) {
    page.applyData(pageData);
    syncTabs();
    /* Адрес читаем, только пока он чужой — тот, с которым страницу открыли.
       Дальше в нём лежит наша же прошлая запись, и она вернула бы прежний
       выбор в обход picked, снова похоронив умолчание. Ссылку, присланную
       позже, приносит hashchange внутри address. */
    if (!address.isOurs()) address.read();
    /* Фильтр переживает смену состава снапшотов, а его предмет — нет: класс
       патчей уходит вместе со своим снапшотом, метка строки — вместе с
       последней такой строкой. Зовём отдельно от address.read(), который
       выше зовут уже не всегда: иначе страница показывала бы пустую
       таблицу под фильтр, которого не поставить и не снять — карточки с
       ним не осталось ни одной, а в чипе вместо подписи стоял бы сам
       ключ. */
    page.dropDeadFilters();
    showTab(st.tab);
    rebuild();
  }

  store.onChange(() => {
    applyData(viewmodel.buildPageData(store.snapshots()));
    renderSources();
    syncEmpty();
  });


  /* ---------- старт ---------- */

  (function start() {
    syncEmpty();
    renderSources();
  }());

  return { applyData: applyData };
}));
