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
                             require('./tips.js'), require('./notes.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.diff,
                         root.KP.text, root.KP.labels, root.KP.markup,
                         root.KP.tables, root.KP.cards, root.KP.page,
                         root.KP.hash, root.KP.rail, root.KP.files,
                         root.KP.tips, root.KP.notes);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, diffmod, text, labels, markup, tables, cards,
            pagemod, hash, railmod, filesmod, tipsmod, notesmod) {
  'use strict';

  /* Состояние страницы живёт в page.js: там же и всё, что из него
     считается — выбор снапшота, диапазон сравнения, фильтры, поиск,
     сортировка. Здесь — короткие имена для того, что зовут отсюда чаще
     всего. */
  let page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text });
  const st = page.st;
  const curSnap = page.curSnap, curPair = page.curPair;
  const visibleRows = page.visibleRows, sortRows = page.sortRows;
  const rowKey = page.rowKey, openOf = page.openOf;
  const activeFilters = page.activeFilters, totalRows = page.totalRows;
  const snapshots = page.snapshots;

  const stateSection = document.getElementById('tab-state');
  const diffSection = document.getElementById('tab-diff');
  let controls = document.getElementById('controls');
  const chipsBox = document.getElementById('chips');
  const search = document.getElementById('q');
  const clearBtn = document.getElementById('q-clear');
  const counter = document.getElementById('count');
  const expandBtn = document.getElementById('expand');
  const copyBtn = document.getElementById('copy-nvr');
  const tabBtns = Array.from(document.querySelectorAll('.tab'));
  const stateBody = document.getElementById('state-rows');
  const diffBody = document.getElementById('diff-rows');
  const tabsNav = document.querySelector('.tabs');
  const emptySection = document.getElementById('tab-empty');
  const sourcesBox = document.getElementById('sources');
  const chainBox = document.getElementById('chain');
  const warningsBox = document.getElementById('warnings');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop');
  const pickBtn = document.getElementById('pick');

  let hashLock = false;
  /* Писала ли страница адрес сама. С этого мгновения location.hash — её
     собственное эхо, а не то, с чем её открыли. */
  let hashIsOurs = false;

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

  function renderStateCards() {
    const out = cards.stateCards(curSnap());
    document.getElementById('state-cards').innerHTML = out.big;
    document.getElementById('class-cards').innerHTML = out.classes;
  }

  function renderDiffCards() {
    document.getElementById('diff-cards').innerHTML = cards.diffCards(curPair());
  }

  function syncCards() {
    const set = activeFilters();
    const host = st.tab === 'diff' ? diffSection : stateSection;
    const empty = !keys(set).length;
    for (const node of host.querySelectorAll('.card[data-filter]')) {
      const key = node.getAttribute('data-filter');
      node.setAttribute('aria-pressed',
        String(key === 'all' ? empty : Boolean(own(set, key))));
    }
  }

  function renderChips() { chipsBox.innerHTML = cards.chips(activeFilters()); }


  /* ---------- рендер ---------- */

  /* Что таблицам нужно знать о странице: запрос, ширина таблицы, ключ строки
     и её раскрытость. Собрано в одном месте, чтобы обе таблицы получали одно
     и то же — разойдись они здесь, разъехались бы и colspan у деталей. */
  function rowOpts() {
    const pair = st.tab === 'diff' ? curPair() : null;
    return { q: st.q, cols: colCount(st.tab), keyOf: rowKey, openOf: openOf,
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
      : plural(total, 'сборка', 'сборки', 'сборок');

    counter.textContent = items.length + ' / ' + total + ' ' + word;
    expandBtn.textContent = allOpen(items) ? 'Collapse all' : 'Expand all';
    expandBtn.disabled = !items.length;
    copyBtn.disabled = !items.length;

    syncCards();
    renderChips();
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
    writeHash();
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
    /* Панель поиска одна на страницу и переезжает к активной таблице:
       два одинаковых поля с разными id путали бы и пользователя, и hash. */
    const host = name === 'diff' ? diffSection : stateSection;
    /* Не anchor: так зовётся отмеченный узел рельса, и локальная переменная
       с тем же именем забирала бы себе его сброс строкой выше. */
    const wrap = host.querySelector('.tablewrap');
    host.insertBefore(controls, wrap);
    host.insertBefore(chipsBox, wrap);
    search.placeholder = name === 'diff'
      ? 'Компонент, версия, тег, ветка, патч, CVE, RPM…'
      : 'Компонент, тег, ветка, патч, CVE, RPM…';
  }

  /* ---------- состояние в адресной строке ---------- */

  function writeHash() {
    const next = hash.format(page.hashParts());
    hashIsOurs = true;
    if (location.hash === next) return;
    hashLock = true;
    try {
      if (history && history.replaceState) history.replaceState(null, '', next);
      else location.hash = next;
    } catch (e) {
      location.hash = next;
    }
    setTimeout(() => { hashLock = false; }, 0);
  }

  function readHash() {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return false;
    page.restore(hash.parse(raw));
    search.value = st.q;
    /* Запрос мог приехать из ссылки — крестик обязан появиться вместе
       с ним, а не ждать первого касания клавиатуры. */
    clearBtn.hidden = !search.value;
    return true;
  }

  /* ---------- копирование ---------- */

  /* NVR диффа собирается из имени и evr: evr — это «epoch:version-release»,
     а в NVR эпохи нет, поэтому ведущее «N:» отбрасываем. */
  function nvrOf(row) {
    if (row.nvr) return row.nvr;
    const evr = row.new_evr || row.old_evr;
    return evr ? row.name + '-' + String(evr).replace(/^[0-9]+:/, '') : row.name;
  }

  /* Подпись кнопки берём один раз при загрузке: если запомнить текущую, то
     второй клик подряд запомнит «Скопировано» и вернёт кнопку к нему навсегда. */
  const COPY_LABEL = copyBtn.textContent;
  let flashTimer = null;

  function flash(text) {
    copyBtn.textContent = text;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      copyBtn.textContent = COPY_LABEL;
    }, 1400);
  }

  function copyFallback(text) {
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

  function copyNvr() {
    let items = sortRows(visibleRows()), lines = [], i;
    for (i = 0; i < items.length; i++) lines.push(nvrOf(items[i].row));
    const text = lines.join('\n');
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => { flash(`Скопировано ${lines.length}`); },
        () => { copyFallback(text); });
    } else {
      copyFallback(text);
    }
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

  /* Карточки, чипы и селекторы — делегированием: их разметка перерисовывается. */
  document.addEventListener('click', (e) => {
    let node = e.target;
    while (node && node !== document) {
      if (node.getAttribute) {
        const chip = node.getAttribute('data-chip');
        if (chip !== null && chip !== undefined) { toggleFilter(chip); return; }
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
     тег — это тысячи сборок. Ждём паузы в наборе. */
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
      st.q = search.value.trim().toLowerCase();
      render();
    }, SEARCH_DELAY);
  });

  clearBtn.addEventListener('click', () => {
    /* Отложенный поиск отменяем не ради правильности — сработав, он
       прочитал бы уже пустое поле и ничего не испортил, — а ради работы:
       это лишняя перерисовка всей таблицы через 120 мс после той, что мы
       делаем прямо сейчас. На теге в тысячу сборок она заметна. */
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

  copyBtn.addEventListener('click', copyNvr);

  window.addEventListener('hashchange', () => {
    if (hashLock) return;
    if (readHash()) { page.dropDeadFilters(); showTab(st.tab); rebuild(); }
  });

  /* ---------- владельцы участков страницы ---------- */

  /* Корень заполняется по ходу: рельс берёт метод в момент вызова, а не в
     момент создания, и порядок объявлений здесь ничего не решает. Городить
     ради одного подписчика шину событий незачем — страница перерисовывается
     целиком. */
  const app = {};
  const tips = tipsmod.create({ node: document.getElementById('tip') });
  const hideTip = tips.hide;
  const notes = notesmod.create({ node: document.getElementById('notes') });
  let rail = railmod.create({ box: chainBox, page: page, store: store,
                              text: text, app: app, hideTip: hideTip });
  let files = filesmod.create({ store: store, notes: notes,
    dom: { input: fileInput, drop: dropZone, pick: pickBtn } });
  app.render = render;
  app.renderStateCards = renderStateCards;
  app.renderDiffCards = renderDiffCards;


  /* ---------- «липкая» шапка ---------- */

  function syncStickyOffset() {
    if (!controls || !document.documentElement.style.setProperty) return;
    document.documentElement.style.setProperty(
      '--controls-h', controls.getBoundingClientRect().height + 'px');
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncStickyOffset).observe(controls);
  } else {
    window.addEventListener('resize', syncStickyOffset);
  }

  /* ---------- кнопка «наверх» ---------- */

  const toTop = document.getElementById('totop');

  /* Порог — высота окна, а не круглое число точек: «ниже первого экрана»
     человек видит глазами, а «ниже шестисот точек» ни о чём не говорит и
     на разных окнах срабатывает по-разному. */
  function syncToTop() {
    toTop.hidden = window.pageYOffset <= window.innerHeight;
  }

  toTop.addEventListener('click', () => {
    /* Плавную прокрутку понимают не все браузеры, и её отдельно просят
       отключить те, кому от движения плохо. В обоих случаях поднимаемся
       прыжком: доехать важнее, чем доехать красиво. */
    const smooth = 'scrollBehavior' in document.documentElement.style
      && !(window.matchMedia
           && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (smooth) window.scrollTo({ top: 0, behavior: 'smooth' });
    else window.scrollTo(0, 0);
  });

  window.addEventListener('scroll', syncToTop);

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
    warningsBox.innerHTML = store.warnings()
      .map((w) => `<div class="warn">${esc(w)}</div>`).join('');
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
       позже, приносит hashchange. */
    if (!hashIsOurs) readHash();
    /* Фильтр переживает смену состава снапшотов, а его предмет — нет: класс
       патчей уходит вместе со своим снапшотом, метка строки — вместе с
       последней такой строкой. Зовём отдельно от readHash(), который выше
       зовут уже не всегда: иначе страница показывала бы пустую таблицу под
       фильтр, которого не поставить и не снять — карточки с ним не осталось
       ни одной, а в чипе вместо подписи стоял бы сам ключ. */
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
    syncStickyOffset();
    /* Браузер восстанавливает прокрутку при перезагрузке, и страница может
       открыться уже внизу — тогда кнопка нужна сразу, не дожидаясь, пока
       человек тронет колесо. */
    syncToTop();
  }());

  return { applyData: applyData };
}));
