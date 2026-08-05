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
                             require('./tips.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.diff,
                         root.KP.text, root.KP.labels, root.KP.markup,
                         root.KP.tables, root.KP.cards, root.KP.page,
                         root.KP.hash, root.KP.rail, root.KP.files,
                         root.KP.tips);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, diffmod, text, labels, markup, tables, cards,
            pagemod, hash, railmod, filesmod, tipsmod) {
  'use strict';

  /* Состояние страницы живёт в page.js: там же и всё, что из него
     считается — выбор снапшота, диапазон сравнения, фильтры, поиск,
     сортировка. Здесь — короткие имена для того, что зовут отсюда чаще
     всего. */
  var page = pagemod.create({ viewmodel: viewmodel, diffmod: diffmod,
                              store: store, labels: labels, text: text });
  var st = page.st;
  var curSnap = page.curSnap, curPair = page.curPair;
  var visibleRows = page.visibleRows, sortRows = page.sortRows;
  var rowKey = page.rowKey, openOf = page.openOf;
  var activeFilters = page.activeFilters, totalRows = page.totalRows;
  var snapshots = page.snapshots;

  var stateSection = document.getElementById('tab-state');
  var diffSection = document.getElementById('tab-diff');
  var controls = document.getElementById('controls');
  var chipsBox = document.getElementById('chips');
  var search = document.getElementById('q');
  var clearBtn = document.getElementById('q-clear');
  var counter = document.getElementById('count');
  var expandBtn = document.getElementById('expand');
  var copyBtn = document.getElementById('copy-nvr');
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tab'));
  var stateBody = document.getElementById('state-rows');
  var diffBody = document.getElementById('diff-rows');
  var tabsNav = document.querySelector('.tabs');
  var emptySection = document.getElementById('tab-empty');
  var sourcesBox = document.getElementById('sources');
  var chainBox = document.getElementById('chain');
  var loadErrors = document.getElementById('load-errors');
  var warningsBox = document.getElementById('warnings');
  var fileInput = document.getElementById('file-input');
  var dropZone = document.getElementById('drop');
  var pickBtn = document.getElementById('pick');

  var hashLock = false;
  /* Писала ли страница адрес сама. С этого мгновения location.hash — её
     собственное эхо, а не то, с чем её открыли. */
  var hashIsOurs = false;

  /* ---------- вспомогательное ---------- */

  /* Считалки строк живут в text.js. Здесь — короткие имена для тех, кого
     зовут отсюда: тела оставшихся функций читаются лучше, когда в них стоит
     esc(), а не text.esc(). */
  var esc = text.esc, own = text.own, keys = text.keys, plural = text.plural;

  /* Фильтр ставит и снимает page — он один знает правило про «версия та же»
     и «что-то изменилось». Перерисовка остаётся здесь: страницу рисует
     корень. */
  function toggleFilter(key) {
    page.toggleFilter(key);
    render();
  }

  /* ---------- сортировка ---------- */

  function syncArrows() {
    var table = document.getElementById(st.tab === 'diff' ? 'diff-table' : 'state-table');
    var cfg = st.sort[st.tab];
    var ths = Array.prototype.slice.call(table.querySelectorAll('th[data-sort]'));
    for (var i = 0; i < ths.length; i++) {
      var span = ths[i].querySelector('.arrow');
      if (!span) continue;
      span.textContent = ths[i].getAttribute('data-sort') === cfg.key
        ? (cfg.asc ? '▲' : '▼') : '';
    }
  }

  /* ---------- сколько колонок ---------- */

  /* Сколько колонок в таблице вкладки. Считаем по самой разметке: строка на
     всю ширину (деталь, «ничего не найдено») пишется числом, а колонку в
     шаблон добавляют отдельно — и число молча остаётся от прежней таблицы. */
  function colCount(tab) {
    var table = document.getElementById(tab === 'diff' ? 'diff-table'
                                                      : 'state-table');
    return table.querySelectorAll('th').length;
  }

  /* ---------- карточки, селекторы, чипы ---------- */

  function renderStateCards() {
    var out = cards.stateCards(curSnap());
    document.getElementById('state-cards').innerHTML = out.big;
    document.getElementById('class-cards').innerHTML = out.classes;
  }

  function renderDiffCards() {
    document.getElementById('diff-cards').innerHTML = cards.diffCards(curPair());
  }

  function syncCards() {
    var set = activeFilters();
    var host = st.tab === 'diff' ? diffSection : stateSection;
    var nodes = Array.prototype.slice.call(host.querySelectorAll('.card[data-filter]'));
    var empty = !keys(set).length;
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute('data-filter');
      nodes[i].setAttribute('aria-pressed',
        String(key === 'all' ? empty : Boolean(own(set, key))));
    }
  }

  function renderChips() { chipsBox.innerHTML = cards.chips(activeFilters()); }


  /* ---------- рендер ---------- */

  /* Что таблицам нужно знать о странице: запрос, ширина таблицы, ключ строки
     и её раскрытость. Собрано в одном месте, чтобы обе таблицы получали одно
     и то же — разойдись они здесь, разъехались бы и colspan у деталей. */
  function rowOpts() {
    var pair = st.tab === 'diff' ? curPair() : null;
    return { q: st.q, cols: colCount(st.tab), keyOf: rowKey, openOf: openOf,
             oldTag: pair ? pair.old : 'было',
             newTag: pair ? pair['new'] : 'стало' };
  }

  /* Считаем по тому же правилу, что и рендер, иначе подпись кнопки обещала бы
     одно, а нажатие делало другое. */
  function allOpen(items) {
    if (!items.length) return false;
    for (var i = 0; i < items.length; i++) {
      if (!openOf(rowKey(items[i].row), items[i].open)) return false;
    }
    return true;
  }

  function render() {
    /* Подсказка привязана к узлу, а таблица сейчас будет перерисована:
       без этого она пережила бы свой якорь и висела бы над пустым местом. */
    hideTip();
    var items = sortRows(visibleRows());
    var total = totalRows();
    var body = st.tab === 'diff' ? diffBody : stateBody;
    var word = st.tab === 'diff'
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
    for (var t = 0; t < tabBtns.length; t++) {
      if (tabBtns[t].getAttribute('data-tab') === 'diff') {
        tabBtns[t].hidden = snapshots().length < 2;
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
    for (var i = 0; i < tabBtns.length; i++) {
      var on = tabBtns[i].getAttribute('data-tab') === name;
      tabBtns[i].setAttribute('aria-selected', String(on));
    }
    stateSection.hidden = name !== 'state';
    diffSection.hidden = name !== 'diff';
    /* Панель поиска одна на страницу и переезжает к активной таблице:
       два одинаковых поля с разными id путали бы и пользователя, и hash. */
    var host = name === 'diff' ? diffSection : stateSection;
    /* Не anchor: так зовётся отмеченный узел рельса, и локальная переменная
       с тем же именем забирала бы себе его сброс строкой выше. */
    var wrap = host.querySelector('.tablewrap');
    host.insertBefore(controls, wrap);
    host.insertBefore(chipsBox, wrap);
    search.placeholder = name === 'diff'
      ? 'Компонент, версия, тег, ветка, патч, CVE, RPM…'
      : 'Компонент, тег, ветка, патч, CVE, RPM…';
  }

  /* ---------- состояние в адресной строке ---------- */

  function writeHash() {
    var next = hash.format(page.hashParts());
    hashIsOurs = true;
    if (location.hash === next) return;
    hashLock = true;
    try {
      if (history && history.replaceState) history.replaceState(null, '', next);
      else location.hash = next;
    } catch (e) {
      location.hash = next;
    }
    setTimeout(function () { hashLock = false; }, 0);
  }

  function readHash() {
    var raw = location.hash.replace(/^#/, '');
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
    var evr = row.new_evr || row.old_evr;
    return evr ? row.name + '-' + String(evr).replace(/^[0-9]+:/, '') : row.name;
  }

  /* Подпись кнопки берём один раз при загрузке: если запомнить текущую, то
     второй клик подряд запомнит «Скопировано» и вернёт кнопку к нему навсегда. */
  var COPY_LABEL = copyBtn.textContent;
  var flashTimer = null;

  function flash(text) {
    copyBtn.textContent = text;
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      flashTimer = null;
      copyBtn.textContent = COPY_LABEL;
    }, 1400);
  }

  function copyFallback(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    flash(ok ? 'Скопировано' : 'Не вышло');
  }

  function copyNvr() {
    var items = sortRows(visibleRows()), lines = [], i;
    for (i = 0; i < items.length; i++) lines.push(nvrOf(items[i].row));
    var text = lines.join('\n');
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { flash('Скопировано ' + lines.length); },
        function () { copyFallback(text); });
    } else {
      copyFallback(text);
    }
  }

  /* ---------- события ---------- */

  /* Переключаем от того состояния, которое человек видит на экране, а не от
     наличия ключа: строку, раскрытую поиском, иначе не свернуть. */
  function toggleRow(key) {
    var items = visibleRows(), deep = false, i;
    for (i = 0; i < items.length; i++) {
      if (rowKey(items[i].row) === key) { deep = items[i].open; break; }
    }
    page.setOpen(key, !openOf(key, deep));
    render();
  }

  function bodyHandler(e) {
    var node = e.target, body = e.currentTarget;
    while (node && node !== body) {
      /* Ссылка внутри строки ведёт наружу и не должна разворачивать строку. */
      if (node.tagName === 'A') return;
      if (node.getAttribute) {
        var filter = node.getAttribute('data-filter');
        if (filter) { e.preventDefault(); toggleFilter(filter); return; }
        var key = node.getAttribute('data-row');
        if (key) { e.preventDefault(); toggleRow(key); return; }
      }
      node = node.parentNode;
    }
  }

  function bindBody(body) {
    body.addEventListener('click', bodyHandler);
    body.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') bodyHandler(e);
    });
  }
  bindBody(stateBody);
  bindBody(diffBody);

  /* Карточки, чипы и селекторы — делегированием: их разметка перерисовывается. */
  document.addEventListener('click', function (e) {
    var node = e.target;
    while (node && node !== document) {
      if (node.getAttribute) {
        var chip = node.getAttribute('data-chip');
        if (chip !== null && chip !== undefined) { toggleFilter(chip); return; }
        if (node.className && String(node.className).indexOf('card') !== -1) {
          var f = node.getAttribute('data-filter');
          if (f) { toggleFilter(f); return; }
        }
        var stop = node.getAttribute('data-node');
        if (stop !== null && stop !== undefined) {
          rail.pickNode(parseInt(stop, 10));
          return;
        }
        var tab = node.getAttribute('data-tab');
        if (tab) { showTab(tab); render(); return; }
        /* Крестик и призрак живут на рельсе, а он перерисовывается целиком,
           поэтому их обработчики здесь, а не на самих кнопках. */
        if (node.getAttribute('data-add')) { files.openPicker(); return; }
        var gone = node.getAttribute('data-drop-snap');
        if (gone !== null && gone !== undefined) {
          store.remove(parseInt(gone, 10));
          return;
        }
      }
      node = node.parentNode;
    }
  });

  /* Сортировка. Шапки статичны, поэтому обработчики можно навесить один раз. */
  var sortHeads = Array.prototype.slice.call(document.querySelectorAll('th[data-sort]'));
  for (var hi = 0; hi < sortHeads.length; hi++) {
    (function (th) {
      function fire() {
        page.sortBy(th.getAttribute('data-sort'));
        render();
      }
      th.setAttribute('tabindex', '0');
      th.addEventListener('click', fire);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault(); fire();
        }
      });
    }(sortHeads[hi]));
  }

  /* Каждое нажатие перестраивает весь tbody вместе с раскрытыми деталями, а
     тег — это тысячи сборок. Ждём паузы в наборе. */
  var SEARCH_DELAY = 120;
  var searchTimer = null;

  /* Крестик следует за полем без задержки: перерисовку таблицы откладывают
     ради тысяч строк, а показать крестик ничего не стоит, и запаздывать
     ему не за чем. */
  function syncClear() {
    clearBtn.hidden = !search.value;
  }

  search.addEventListener('input', function () {
    syncClear();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      st.q = search.value.trim().toLowerCase();
      render();
    }, SEARCH_DELAY);
  });

  clearBtn.addEventListener('click', function () {
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

  expandBtn.addEventListener('click', function () {
    var items = visibleRows();
    var collapse = allOpen(items);
    /* Пишем явное false, а не удаляем ключ: иначе строки, раскрытые поиском,
       остались бы раскрытыми, а подпись кнопки уже сменилась бы. */
    for (var i = 0; i < items.length; i++) {
      page.setOpen(rowKey(items[i].row), !collapse);
    }
    render();
  });

  copyBtn.addEventListener('click', copyNvr);

  window.addEventListener('hashchange', function () {
    if (hashLock) return;
    if (readHash()) { page.dropDeadFilters(); showTab(st.tab); rebuild(); }
  });

  /* ---------- владельцы участков страницы ---------- */

  /* Корень заполняется по ходу: рельс берёт метод в момент вызова, а не в
     момент создания, и порядок объявлений здесь ничего не решает. Городить
     ради одного подписчика шину событий незачем — страница перерисовывается
     целиком. */
  var app = {};
  var tips = tipsmod.create({ node: document.getElementById('tip') });
  var hideTip = tips.hide;
  var rail = railmod.create({ box: chainBox, page: page, store: store,
                              text: text, app: app, hideTip: hideTip });
  var files = filesmod.create({ store: store, text: text,
    dom: { input: fileInput, drop: dropZone, errors: loadErrors,
           pick: pickBtn } });
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

  var toTop = document.getElementById('totop');

  /* Порог — высота окна, а не круглое число точек: «ниже первого экрана»
     человек видит глазами, а «ниже шестисот точек» ни о чём не говорит и
     на разных окнах срабатывает по-разному. */
  function syncToTop() {
    toTop.hidden = window.pageYOffset <= window.innerHeight;
  }

  toTop.addEventListener('click', function () {
    /* Плавную прокрутку понимают не все браузеры, и её отдельно просят
       отключить те, кому от движения плохо. В обоих случаях поднимаемся
       прыжком: доехать важнее, чем доехать красиво. */
    var smooth = 'scrollBehavior' in document.documentElement.style
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
    var has = store.list().length > 0;
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
    var warns = store.warnings(), wout = '', i;
    for (i = 0; i < warns.length; i++) wout += '<div class="warn">' + esc(warns[i]) + '</div>';
    warningsBox.innerHTML = wout;
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

  store.onChange(function () {
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
