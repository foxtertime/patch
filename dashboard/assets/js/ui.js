/* Поведение страницы: загрузка снапшотов, фильтры, поиск, адресная строка.
   Считает данные viewmodel.js, а что именно считать — решает store.js;
   разметку строит tables.js с cards.js, а здесь её кладут в узлы и
   связывают с событиями. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./viewmodel.js'), require('./store.js'),
                             require('./diff.js'), require('./text.js'),
                             require('./labels.js'), require('./markup.js'),
                             require('./tables.js'), require('./cards.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.diff,
                         root.KP.text, root.KP.labels, root.KP.markup,
                         root.KP.tables, root.KP.cards);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, diffmod, text, labels, markup, tables, cards) {
  'use strict';

  /* Данные страницы считаются здесь же, из снапшотов, которые человек
     подгружает в дашборд сам. */
  var DATA = { generated: '', patch_classes: [], snapshots: [], pairs: [] };
  var SNAPS = [], PAIRS = [];
  /* Выбранный переход — имена снапшотов, а не номер в массиве. Номер
     значил что-то, только пока переходы приходили готовым списком в
     известном порядке; с произвольными диапазонами он не значит ничего, а
     имя переживает и перестановку цепочки, и выгрузку соседа. */
  var pairSel = { from: null, to: null };
  /* Посчитанные переходы по имени диапазона. Заводится заново на каждую
     смену состава: снапшот с тем же именем — тот же файл, но набор вокруг
     него другой, и сводность диапазона могла измениться. */
  var pairCache = {};
  /* Отмеченный первым кликом узел, пока второй не выбран. Живёт только до
     следующего клика, смены вкладки или смены состава снапшотов: это шаг
     выбора, а не состояние страницы. */
  var anchor = null;

  /* Единственная дверь для данных: сюда приходит то, что посчитал
     viewmodel.js, отсюда перерисовывается страница. Зовётся при каждом
     изменении набора снапшотов, поэтому всё, что зависит от их состава,
     здесь именно пересчитывается, а не дописывается. */
  function applyData(pageData) {
    /* Держим выбор именами: после перестановки или удаления номер
       показал бы другой снапшот, ничем не выдав подмены. Имя — полное,
       с временем сбора: одного тега мало, см. snapKey().

       Восстанавливаем только то, что человек выбрал сам. Снапшоты приезжают
       по одному файлу, каждый файл — свой applyData, и «прежним выбором»
       без picked оказывался бы тот, который дашборд выбрал сам на прошлом
       шаге: после первого же файла умолчание «свежий снапшот и самый
       широкий переход» не срабатывало бы больше никогда. */
    var wantTag = picked.tag && SNAPS[st.tag] ? snapKey(SNAPS[st.tag]) : null;
    var wantPair = picked.pair ? pairKey(currentEnds()) : null;
    var foundTag = false, foundPair = false;
    var ci;
    DATA = pageData;
    SNAPS = pageData.snapshots || [];
    PAIRS = pageData.pairs || [];
    labels.setClasses(pageData.patch_classes || []);
    /* Умолчание: последний снапшот цепочки и самый широкий переход. Именно
       это обещает README, и обещание не должно зависеть от того, одним
       файлом человек подгрузил снапшоты или пятью. */
    st.tag = SNAPS.length ? SNAPS.length - 1 : 0;
    for (ci = 0; wantTag !== null && ci < SNAPS.length; ci++) {
      if (snapKey(SNAPS[ci]) === wantTag) { st.tag = ci; foundTag = true; }
    }
    seedPairs();
    /* Умолчание: вся цепочка. Выбор восстанавливаем, только если оба его
       конца ещё на странице; иначе снова работает умолчание. */
    if (wantPair) {
      var parts = wantPair.split('..');
      if (snapIndexByKey(parts[0]) !== -1 && snapIndexByKey(parts[1]) !== -1) {
        pairSel.from = parts[0];
        pairSel.to = parts[1];
        foundPair = true;
      }
    }
    if (!foundPair) { pairSel.from = null; pairSel.to = null; }
    /* Выбранного больше нет на странице — значит, нет и выбора: дальше снова
       работает умолчание. Иначе следующий файл открылся бы «прежним
       выбором», которого человек не делал. */
    if (picked.tag && !foundTag) picked.tag = false;
    if (picked.pair && !foundPair) picked.pair = false;
    syncTabs();
    /* Адрес читаем, только пока он чужой — тот, с которым страницу открыли.
       Дальше в нём лежит наша же прошлая запись, и она вернула бы прежний
       выбор в обход picked, снова похоронив умолчание. Ссылку, присланную
       позже, приносит hashchange. */
    if (!hashIsOurs) readHash();
    /* Фильтр переживает смену состава снапшотов, а его предмет — нет: класс
       патчей уходит вместе со своим снапшотом, тег строки — вместе с
       последней такой строкой. Зовём отдельно от readHash(), который выше
       зовут уже не всегда: иначе страница показывала бы пустую таблицу под
       фильтр, которого не поставить и не снять — карточки с ним не осталось
       ни одной, а в чипе вместо подписи стоял бы сам ключ. */
    dropDeadFilters();
    showTab(st.tab);
    rebuild();
  }


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

  /* Всё состояние страницы в одном месте: отсюда же оно уезжает в
     location.hash и оттуда же восстанавливается при перезагрузке. */
  var st = {
    tab: 'state',
    /* Свежий тег выбирает applyData: до прихода данных выбирать не из чего.
       Переход здесь не хранится вовсе — его концы названы именами
       снапшотов и лежат в pairSel. */
    tag: 0,
    q: '',
    /* «Изменения» открываются на изменившихся компонентах: неизменившиеся
       строки в этой таблице — шум, из-за которого не видно изменившихся.
       Фильтр обычный, он виден чипом и снимается как любой другой. */
    filters: { state: {}, diff: { 'changed': 1 } },
    sort: { state: { key: 'name', asc: true }, diff: { key: 'name', asc: true } }
  };
  /* Раскрытие строк: ключи вида "state:os-9.2:nginx", значения true/false.
     Состояние трёхзначное — отсутствие ключа значит «решает поиск»: строку,
     которая попала в выдачу только совпадением в деталях, разворачивает сам
     поиск. Явный ключ всегда сильнее: иначе такую строку было бы не свернуть. */
  var expanded = {};
  var hashLock = false;
  /* Выбрал ли снапшот и переход человек — кликом по селектору или адресом,
     который он открыл. Пока не выбрал, при каждом изменении состава действует
     умолчание; см. applyData(). */
  var picked = { tag: false, pair: false };
  /* Писала ли страница адрес сама. С этого мгновения location.hash — её
     собственное эхо, а не то, с чем её открыли. */
  var hashIsOurs = false;

  /* ---------- вспомогательное ---------- */

  /* Считалки строк, подписи и куски разметки живут в своих модулях. Здесь
     только короткие имена для тех, кого зовут отсюда: тела оставшихся
     функций читаются лучше, когда в них стоит esc(), а не text.esc(). */
  var esc = text.esc, own = text.own, has = text.has, keys = text.keys,
      setFrom = text.setFrom, slug = text.slug, plural = text.plural,
      stampOf = text.stampOf, gapLabel = text.gapLabel;


  /* ---------- фильтры ---------- */

  function activeFilters() { return st.filters[st.tab]; }

  function toggleFilter(key) {
    var set = activeFilters();
    if (key === 'all') { st.filters[st.tab] = {}; }
    else if (own(set, key)) { delete set[key]; }
    else {
      /* «версия та же» — не уточнение к «что-то изменилось», а другой срез
         той же таблицы. Складывать их по И значит показать «версия не
         менялась, но что-то другое поехало» — не то, что просит карточка. */
      if (key === 'unchanged') delete set['changed'];
      set[key] = 1;
    }
    render();
  }

  function stateMatches(row) {
    var set = st.filters.state, key;
    for (key in set) {
      if (!set.hasOwnProperty(key)) continue;
      if (key === 'has-patch') { if (!row.patches.length) return false; }
      else if (key === 'problem') { if (!row.problems.length) return false; }
      else if (row.marks.indexOf(key) === -1) return false;
    }
    return true;
  }

  function diffMatches(row) {
    var set = st.filters.diff, key;
    for (key in set) {
      if (!set.hasOwnProperty(key)) continue;
      if (key === 'changed') { if (!row.changed) return false; }
      else if (row.marks.indexOf(key) === -1) return false;
    }
    return true;
  }

  /* ---------- поиск ---------- */

  /* Поиск идёт и по видимым полям строки, и по её деталям. Если совпало
     только в деталях, строка не просто остаётся — она сразу разворачивается,
     иначе непонятно, почему она в выдаче. */
  function scanState(row, q) {
    if (!q) return { show: true, deep: false };
    var shallow = has(row.name, q) || has(row.nvr, q) || has(row.branch, q)
               || has(row.evr, q) || has(row.tagged_in, q);
    var deep = has(row.project, q) || has(row.completed, q) || has(row.owner, q);
    var i, j, p;
    for (i = 0; !deep && i < (row.koji_tags || []).length; i++) {
      if (has(row.koji_tags[i], q)) deep = true;
    }
    for (i = 0; !deep && i < row.patches.length; i++) {
      p = row.patches[i];
      if (has(p.name, q) || has(p.path, q) || has(p['class'], q)) deep = true;
      for (j = 0; !deep && j < (p.cves || []).length; j++) {
        if (has(p.cves[j], q)) deep = true;
      }
    }
    for (i = 0; !deep && i < row.rpms.length; i++) {
      if (has(row.rpms[i], q)) deep = true;
    }
    for (i = 0; !deep && i < row.problems.length; i++) {
      if (has(row.problems[i], q)) deep = true;
    }
    return { show: shallow || deep, deep: !shallow && deep };
  }

  function scanDiff(row, q) {
    if (!q) return { show: true, deep: false };
    var shallow = has(row.name, q) || has(row.old_evr, q) || has(row.new_evr, q);
    var deep = has(row.old_branch, q) || has(row.new_branch, q)
            || has(row.old_tagged_in, q) || has(row.new_tagged_in, q);
    var lists = [row.old_patches, row.new_patches];
    var i, j, k, p;
    for (i = 0; !deep && i < lists.length; i++) {
      for (j = 0; !deep && j < lists[i].length; j++) {
        p = lists[i][j];
        if (has(p.name, q) || has(p.path, q) || has(p['class'], q)) deep = true;
        for (k = 0; !deep && k < (p.cves || []).length; k++) {
          if (has(p.cves[k], q)) deep = true;
        }
      }
    }
    for (i = 0; !deep && i < row.rpm_rows.length; i++) {
      for (j = 0; !deep && j < 2; j++) {
        if (row.rpm_rows[i][j] && has(row.rpm_rows[i][j], q)) deep = true;
      }
    }
    return { show: shallow || deep, deep: !shallow && deep };
  }

  /* ---------- какие строки видны ---------- */

  function curSnap() { return SNAPS[st.tag] || null; }
  function curPair() { return pairFor(currentEnds()); }

  /* Имя снапшота — тег и время сбора. Одного тега мало: один и тот же тег
     законно приходит из разных прогонов («тот же тег месяц назад против
     сегодняшнего» — самый частый способ сравнения), и по имени тега такие
     снапшоты неразличимы. Любое добавление, удаление или перестановка молча
     переводили бы выбор на другой прогон, а ссылка «tag=os-9.2» всегда
     открывала бы последний. */
  function snapKey(snap) {
    return snap ? snap.tag + '@' + (snap.generated || '') : '';
  }

  function snapIndexByKey(key) {
    for (var i = 0; i < SNAPS.length; i++) {
      if (snapKey(SNAPS[i]) === key) return i;
    }
    return -1;
  }

  /* Концы выбранного перехода в порядке цепочки. Направление задаёт
     цепочка, а не порядок кликов: «было» — то, что левее. Обратный порядок
     поменял бы местами «появился» и «исчез», причём молча.

     Ничего не выбрано или конец выгрузили — умолчание «вся цепочка»: то же
     самое, что дашборд показывал и раньше, просто названное иначе. */
  function currentEnds() {
    if (SNAPS.length < 2) return null;
    var a = snapIndexByKey(pairSel.from), b = snapIndexByKey(pairSel.to);
    if (a === -1 || b === -1 || a === b) return [0, SNAPS.length - 1];
    return a < b ? [a, b] : [b, a];
  }

  /* Имя перехода для адресной строки: имена обоих снапшотов, а не их тегов.
     У трёх прогонов одного тега все переходы назывались бы
     «os-9.2..os-9.2», и ссылка на любой из них открывала бы последний. */
  function pairKey(ends) {
    if (!ends || !SNAPS[ends[0]] || !SNAPS[ends[1]]) return '';
    return snapKey(SNAPS[ends[0]]) + '..' + snapKey(SNAPS[ends[1]]);
  }

  /* Концы принимаются в любом порядке: направление задаёт цепочка, и
     выправляет его currentEnds(). */
  function setPairEnds(a, b) {
    pairSel.from = snapKey(SNAPS[a]);
    pairSel.to = snapKey(SNAPS[b]);
    picked.pair = true;
  }

  /* Единственный тег в цепочке с таким именем, иначе -1. Предпосчитанные
     переходы названы тегами, а один тег законно приходит из двух прогонов;
     такую пару по имени не опознать, и в кэш она не попадёт — её посчитают
     по требованию. */
  function onlyIndexWithTag(tag) {
    var found = -1, i;
    for (i = 0; i < SNAPS.length; i++) {
      if (SNAPS[i].tag !== tag) continue;
      if (found !== -1) return -1;
      found = i;
    }
    return found;
  }

  /* Кэш наполняем тем, что уже посчитано при загрузке. Сопоставляем по
     именам концов, а не по раскладке diffChain: знать, что она кладёт
     сперва соседей, а потом сводную пару, здесь незачем — она может
     измениться, и молчаливый переезд был бы худшим из исходов. */
  function seedPairs() {
    pairCache = {};
    var i, lo, hi;
    for (i = 0; i < PAIRS.length; i++) {
      lo = onlyIndexWithTag(PAIRS[i].old);
      hi = onlyIndexWithTag(PAIRS[i]['new']);
      if (lo === -1 || hi === -1 || lo >= hi) continue;
      pairCache[pairKey([lo, hi])] = PAIRS[i];
    }
  }

  /* Переход для этих концов: из кэша, а если его там нет — считаем и
     кладём. Расчёт синхронный: это один дифф, столько же работы, сколько
     страница уже делает на загрузке для каждого соседнего перехода. */
  function pairFor(ends) {
    if (!ends) return null;
    var key = pairKey(ends);
    if (own(pairCache, key)) return pairCache[key];
    var raw = store.snapshots();
    if (!raw[ends[0]] || !raw[ends[1]]) return null;
    /* Сводным считается диапазон во всю цепочку, и только когда снапшотов
       больше двух: на двух единственный переход и есть вся цепочка, и
       подписывать его итогом значит сообщать очевидное. */
    var summary = ends[0] === 0 && ends[1] === SNAPS.length - 1
      && SNAPS.length > 2;
    var block = viewmodel.pairBlock(
      diffmod.diffSnapshots(raw[ends[0]], raw[ends[1]], summary), raw);
    pairCache[key] = block;
    return block;
  }

  function visibleRows() {
    var q = st.q, out = [], i, row, scan;
    if (st.tab === 'diff') {
      var pair = curPair();
      var rows = pair ? pair.rows : [];
      for (i = 0; i < rows.length; i++) {
        row = rows[i];
        if (!diffMatches(row)) continue;
        scan = scanDiff(row, q);
        if (!scan.show) continue;
        out.push({ row: row, open: scan.deep });
      }
      return out;
    }
    var snap = curSnap();
    var builds = snap ? snap.builds : [];
    for (i = 0; i < builds.length; i++) {
      row = builds[i];
      if (!stateMatches(row)) continue;
      scan = scanState(row, q);
      if (!scan.show) continue;
      out.push({ row: row, open: scan.deep });
    }
    return out;
  }

  function totalRows() {
    if (st.tab === 'diff') { var p = curPair(); return p ? p.rows.length : 0; }
    var s = curSnap();
    return s ? s.builds.length : 0;
  }

  /* Ключ раскрытой строки. Снапшот и пара названы полными именами по той же
     причине, что и в адресе: у двух прогонов одного тега иначе было бы одно
     состояние раскрытия на двоих. */
  function rowKey(row) {
    if (st.tab === 'diff') {
      return 'diff:' + pairKey(currentEnds()) + ':' + row.name;
    }
    return 'state:' + snapKey(curSnap()) + ':' + row.name;
  }

  /* Единственное место, где решается, раскрыта ли строка: явно выбранное
     человеком состояние, а если его нет — то, что предложил поиск (deep). */
  function openOf(key, deep) {
    return expanded.hasOwnProperty(key) ? expanded[key] : Boolean(deep);
  }

  /* ---------- сортировка ---------- */

  /* Версии сравниваются как строки, а не по правилам rpm, и это осознанно:
     в соседних строках стоят версии разных компонентов, так что «правильный»
     порядок между ними всё равно ничего не значит. Про 1.10 выше 1.9
     предупреждает подсказка на заголовке колонки. */
  function sortValue(row, key) {
    if (st.tab === 'diff') {
      if (key === 'old') return row.old_evr || '';
      if (key === 'new') return row.new_evr || '';
      if (key === 'dpatch') return row.patches_added.length + row.patches_removed.length;
      if (key === 'drpm') return row.rpms_added.length + row.rpms_removed.length;
      return row.name || '';
    }
    if (key === 'patches') return row.patches.length;
    if (key === 'rpms') return row.rpms.length;
    return row[key] || '';
  }

  function sortRows(items) {
    var cfg = st.sort[st.tab];
    items.sort(function (a, b) {
      var x = sortValue(a.row, cfg.key), y = sortValue(b.row, cfg.key), res;
      if (typeof x === 'number' || typeof y === 'number') res = (x || 0) - (y || 0);
      else res = x < y ? -1 : (x > y ? 1 : 0);
      if (res === 0) res = a.row.name < b.row.name ? -1 : (a.row.name > b.row.name ? 1 : 0);
      return cfg.asc ? res : -res;
    });
    return items;
  }

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

  /* ---------- кусочки разметки ---------- */

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
    renderChain();

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
        tabBtns[t].hidden = SNAPS.length < 2;
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
    anchor = null;
    if (name === 'diff' && SNAPS.length < 2) name = 'state';
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
    var parts = ['tab=' + st.tab];
    /* Снапшот храним именем, а не номером: набор снапшотов на странице
       меняется, и присланная ссылка «tag=1» показала бы другой снапшот,
       ничем не выдав подмены. Имя полное, с временем сбора, — иначе два
       прогона одного тега на такую ссылку отвечали бы одинаково. */
    if (SNAPS.length) parts.push('tag=' + encodeURIComponent(snapKey(SNAPS[st.tag])));
    if (SNAPS.length > 1) {
      parts.push('pair=' + encodeURIComponent(pairKey(currentEnds())));
    }
    /* f= пишем всегда, в том числе пустой: у вкладки «Изменения» фильтр по
       умолчанию непустой, и без явного «фильтров нет» ссылка на таблицу со
       снятым фильтром при открытии снова показывала бы только изменившиеся. */
    var f = keys(activeFilters()).sort();
    parts.push('f=' + encodeURIComponent(f.join(',')));
    if (st.q) parts.push('q=' + encodeURIComponent(st.q));
    var cfg = st.sort[st.tab];
    parts.push('sort=' + cfg.key + (cfg.asc ? '' : ':desc'));
    var next = '#' + parts.join('&');
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

  /* Хеш правят руками и присылают в переписке, поэтому «100%», «%zz» и обрезанная
     многобайтовая последовательность в нём — норма, а не исключение.
     decodeURIComponent на таком бросает URIError; без этой обёртки он унёс бы
     разбор целиком, а вместе с ним и первый рендер страницы. */
  function dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  /* Токен фильтра мог устареть — приехать из чужого хеша или пережить свой
     снапшот. Свой мы узнаём по подписи, по классу патчей или по тегу живой
     строки; чужой молча выбрасываем, чтобы страница не показывала пустую
     таблицу под фильтр, которого не поставить и не снять — его нет ни на
     одной карточке. Вкладка приходит доводом, а не берётся из st: судить
     приходится и о той, на которой человека сейчас нет. */
  function knownFilter(key, tab) {
    var classes = labels.classes(), i;
    if (!key || key === 'all') return false;
    if (labels.LABELS.hasOwnProperty(key)) return true;
    for (i = 0; i < classes.length; i++) {
      if (slug(classes[i]) === key) return true;
    }
    var host = tab === 'diff' ? curPair() : curSnap();
    var rows = host ? (tab === 'diff' ? host.rows : host.builds) : [];
    for (i = 0; i < rows.length; i++) {
      if (rows[i].marks.indexOf(key) !== -1) return true;
    }
    return false;
  }

  /* Единственное место, где обещание knownFilter выполняется: и для фильтров
     из хеша, и для тех, что человек поставил кликом, а данные под ними
     сменились. Обе вкладки сразу: наборы фильтров у них свои, и мёртвый
     фильтр на невидимой сейчас вкладке встретил бы человека той же пустой
     таблицей через один клик по ней. */
  function dropDeadFilters() {
    var tabs = ['state', 'diff'], t, i, tab, from, live;
    for (t = 0; t < tabs.length; t++) {
      tab = tabs[t];
      from = keys(st.filters[tab]);
      live = [];
      for (i = 0; i < from.length; i++) {
        if (knownFilter(from[i], tab)) live.push(from[i]);
      }
      st.filters[tab] = setFrom(live);
    }
  }

  /* Так ли назван этот снапшот. Полное имя, с временем сбора, называет
     прогон и однозначно; голый тег у двойников подходит нескольким.
     Спутать их нельзя: в полном имени есть «@», в теге его не бывает. */
  function snapNamed(index, name) {
    return snapKey(SNAPS[index]) === name || SNAPS[index].tag === name;
  }

  /* Последний диапазон, концы которого названы в этом порядке: левый конец
     левее правого. Ищем именно парой, а не каждый конец сам по себе:
     у двойников тега «os-9.2..os-9.3» на цепочке 9.2, 9.3, 9.2 самый
     свежий os-9.2 стоит правее os-9.3, и независимый поиск открыл бы
     обратное сравнение, поменяв местами «появился» и «исчез».

     Последний — значит с самым свежим левым концом, у которого правый ещё
     есть справа, а при нём с самым свежим правым. Не то же, что «tag=»,
     которая берёт последний прогон и всё: на цепочке 9.2, 9.3, 9.2 левым
     концом «os-9.2..os-9.3» будет первый прогон 9.2, потому что за
     последним никакого 9.3 уже нет. */
  function lastEndsNamed(left, right) {
    var lo, hi, found = null;
    for (lo = 0; lo < SNAPS.length; lo++) {
      if (!snapNamed(lo, left)) continue;
      for (hi = lo + 1; hi < SNAPS.length; hi++) {
        if (snapNamed(hi, right)) found = [lo, hi];
      }
    }
    return found;
  }

  /* Имя диапазона из адреса. Полная форма называет прогоны, короткая —
     теги; короткую оставляем читаемой, потому что её пишут руками и
     присылают в переписке.

     Ссылку, написанную задом наперёд, разворачиваем по цепочке — но только
     когда в этом порядке она не читается вовсе. Иначе разворот молча
     подменял бы сравнение, которое человек назвал сам. */
  function endsFromHash(value) {
    var at = String(value).indexOf('..');
    if (at === -1) return null;
    var left = value.slice(0, at), right = value.slice(at + 2);
    return lastEndsNamed(left, right) || lastEndsNamed(right, left);
  }

  function readHash() {
    var raw = location.hash.replace(/^#/, '');
    if (!raw) return false;
    var parts = raw.split('&'), i, kvp, key, val;
    var tab = null, filters = null, sort = null, dropped = false;
    for (i = 0; i < parts.length; i++) {
      kvp = parts[i].split('=');
      key = kvp[0];
      val = dec(kvp.slice(1).join('=') || '');
      if (val === null) continue;   /* битый кусок пропускаем, остальные читаем */
      if (key === 'tab') {
        /* Сравнивать нечего — вкладки «Изменения» на странице тоже нет. */
        tab = (val === 'diff' && SNAPS.length > 1) ? 'diff' : 'state';
        if (val === 'diff' && SNAPS.length < 2) dropped = true;
      } else if (key === 'tag') {
        /* Ссылку правят руками, и «tag=os-9.2» без времени сбора — её
           законная форма. Два прогона одного тега она не различает: берём
           последний по цепочке, самый свежий. Сама страница пишет всегда
           полное имя, поэтому её ссылки однозначны. */
        for (var j = 0; j < SNAPS.length; j++) {
          /* Ссылка — такой же выбор человека, как клик по кнопке: он должен
             пережить приход следующего файла. */
          if (snapKey(SNAPS[j]) === val || SNAPS[j].tag === val) {
            st.tag = j;
            picked.tag = true;
          }
        }
      } else if (key === 'pair') {
        /* Не разобрали — остаёмся на переходе по умолчанию. Ссылка — такой
           же выбор человека, как клик по кнопке: он должен пережить приход
           следующего файла. */
        var ends = endsFromHash(val);
        if (ends) { pairSel.from = snapKey(SNAPS[ends[0]]);
                    pairSel.to = snapKey(SNAPS[ends[1]]); picked.pair = true; }
      } else if (key === 'f') filters = val ? val.split(',') : [];
      else if (key === 'q') st.q = val.trim().toLowerCase();
      else if (key === 'sort') sort = val.split(':');
    }
    if (tab) st.tab = tab;
    /* Ссылка вела на «Изменения», но сравнивать в этом прогоне нечего. Фильтры
       из неё — диффовые; на вкладке состояния они дали бы пустую таблицу без
       единого намёка почему. */
    if (dropped) filters = null;
    /* Что из этого живое, решает dropDeadFilters() — его зовут оба, кто
       читает хеш, и оба по той же причине, что и после смены данных. */
    if (filters) st.filters[st.tab] = setFrom(filters);
    if (sort && sort[0]) {
      st.sort[st.tab] = { key: sort[0], asc: sort[1] !== 'desc' };
    }
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
    expanded[key] = !openOf(key, deep);
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
          pickNode(parseInt(stop, 10));
          return;
        }
        var tab = node.getAttribute('data-tab');
        if (tab) { showTab(tab); render(); return; }
        /* Крестик и призрак живут на рельсе, а он перерисовывается целиком,
           поэтому их обработчики здесь, а не на самих кнопках. */
        if (node.getAttribute('data-add')) { openPicker(); return; }
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
        var key = th.getAttribute('data-sort');
        var cfg = st.sort[st.tab];
        if (cfg.key === key) cfg.asc = !cfg.asc;
        else { cfg.key = key; cfg.asc = true; }
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
      expanded[rowKey(items[i].row)] = !collapse;
    }
    render();
  });

  copyBtn.addEventListener('click', copyNvr);

  window.addEventListener('hashchange', function () {
    if (hashLock) return;
    if (readHash()) { dropDeadFilters(); showTab(st.tab); rebuild(); }
  });

  /* ---------- подсказки ---------- */

  var TIP_DELAY = 450;
  var tip = document.getElementById('tip');
  var tipTimer = null;
  var tipNode = null;

  function tipAnchor(node) {
    while (node && node.getAttribute) {
      if (node.getAttribute('data-tip')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function placeTip(el) {
    tip.textContent = el.getAttribute('data-tip');
    tip.style.visibility = 'hidden';
    tip.style.display = 'block';
    var host = el.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, host.left + (host.width - box.width) / 2),
                        window.innerWidth - box.width - 8);
    var top = host.bottom + 8;
    if (top + box.height > window.innerHeight - 8) top = host.top - box.height - 8;
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(Math.max(8, top)) + 'px';
    tip.style.visibility = 'visible';
  }

  function hideTip() {
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
    tipNode = null;
    tip.style.display = 'none';
  }

  /* Делегирование, а не обход всех [data-tip]: строки таблицы и карточки
     перерисовываются, и навешенные обработчики умирали бы вместе с ними. */
  document.addEventListener('mouseover', function (e) {
    var el = tipAnchor(e.target);
    if (el === tipNode) return;
    hideTip();
    tipNode = el;
    if (el) {
      tipTimer = setTimeout(function () {
        if (tipNode === el) placeTip(el);
      }, TIP_DELAY);
    }
  });
  document.addEventListener('mouseleave', hideTip);
  /* С клавиатуры ждать незачем — показываем сразу. */
  document.addEventListener('focusin', function (e) {
    var el = tipAnchor(e.target);
    hideTip();
    if (el) { tipNode = el; placeTip(el); }
  });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, true);

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

  /* Рельс цепочки: снапшоты — узлы на линии, идущей слева направо, от
     старого к новому. На «Состоянии» залит узел, который сейчас в
     таблице; на «Изменениях» — отрезок между концами сравниваемой пары,
     включая сводную, растянутую на всю цепочку. Одна картинка отвечает
     сразу на три вопроса: что загружено, в каком порядке сравнивается и
     где я сейчас нахожусь.

     Под тегом у каждого узла стоит время сбора: снапшот — это тег в
     определённый момент, и два прогона одного тега различает только оно.
     Раньше дату получали одни двойники, теперь её видно у всех: цепочка
     из тегов без дат отвечает, что сравнивается, но не отвечает, за какой
     срок.

     Рельс ещё и выбирает — он на странице единственный, кто это делает:
     на «Состоянии» один клик открывает снапшот, на «Изменениях» два
     задают любой диапазон цепочки. */
  function renderChain() {
    var items = store.list(), out = '', i, here;
    var live = st.tab === 'diff';
    var ends = live ? currentEnds() : null;
    if (!items.length) { chainBox.innerHTML = ''; return; }
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
       для посчитанных на месте пар в pairFor, для предпосчитанных в
       diff.js. Двух копий и так на одну больше, чем надо; третья, тут,
       разошлась бы с обеими молча. */
    var pair = ends ? pairFor(ends) : null;
    var sum = pair && pair.summary ? '<span class="sum">итог</span>' : '';
    /* Подпись рельса стоит в шапке панели и написана прямо в шаблоне: она
       одна и та же при любых данных, и рисовать её заново на каждую
       перерисовку значило бы каждый раз доказывать, что она не изменилась. */
    chainBox.innerHTML = out + sum;
  }

  /* Отрезок между соседними узлами, с расстоянием во времени над ним. */
  function railHtml(from, to, on) {
    var gap = gapLabel(from.generated, to.generated);
    return '<span class="rl' + (on ? ' on' : '') + '">'
      + (gap ? '<span class="gap">' + esc(gap) + '</span>' : '') + '</span>';
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
    var cls = 'pick' + (here ? ' on' : '') + (anchor === at ? ' anchor' : '');
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

  function nodeTip(at, here, live) {
    if (!live) return here ? 'Открыт сейчас.' : 'Открыть этот снапшот.';
    if (anchor === null) return 'Отметить началом сравнения.';
    return anchor === at ? 'Снять отметку.' : 'Сравнить с отмеченным.';
  }

  function source(item) {
    return item.builds + ' '
      + plural(item.builds, 'сборка', 'сборки', 'сборок') + ', файл '
      + item.file;
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

  /* Рельс перерисовывается целиком, и нажатая кнопка исчезает вместе с
     фокусом. Выбор здесь двухшаговый: без возврата фокуса второй конец
     пришлось бы искать табом заново, пройдя весь рельс сначала. */
  function focusNode(at) {
    var nodes = chainBox.querySelectorAll('[data-node]'), i;
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
      st.tag = at;
      /* Выбор стал явным, и дальше страница держит его именем: приход или
         уход соседнего снапшота не должен молча переселить таблицу на
         другой прогон. */
      picked.tag = true;
      renderStateCards();
      render();
      focusNode(at);
      return;
    }
    if (anchor === null) { anchor = at; renderChain(); }
    else if (anchor === at) { anchor = null; renderChain(); }
    else {
      /* Концы отдаём в порядке кликов: направление задаёт цепочка, и
         выправляет его currentEnds() — единственное место, где это правило
         записано. Второе такое же здесь однажды разошлось бы с ним. */
      var mark = anchor;
      anchor = null;
      setPairEnds(mark, at);
      renderDiffCards();
      render();
    }
    /* Рельс перерисован в любой из веток, и нажатый узел в нём уже новый. */
    focusNode(at);
  }

  /* ---------- перестановка узлов ---------- */

  /* Свой тип переноса: данные из него браузер отдаёт только на drop, а вот
     types видны и раньше — по ним приёмник файлов на странице узнаёт, что
     тащат не файл. */
  var NODE_MIME = 'text/x-dashboard-node';
  /* Номер узла, который тащат, и промежуток, куда его поставят. Промежуток
     считается в границах между узлами: 0 — перед первым, items.length —
     за последним. */
  var dragFrom = null, dropAt = null;

  function chipOf(target) {
    var node = target;
    while (node && node !== chainBox) {
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
  function marks(node, add) {
    var base = String(node.className).replace(/\s*\b(before|after|moving)\b/g, '');
    node.className = add ? base + ' ' + add : base;
  }

  function clearMarks() {
    var nodes = chainBox.querySelectorAll('[data-node]'), i;
    for (i = 0; i < nodes.length; i++) marks(nodes[i], '');
  }

  function endDrag() { dragFrom = null; dropAt = null; clearMarks(); }

  chainBox.addEventListener('dragstart', function (e) {
    var chip = chipOf(e.target);
    if (!chip) return;
    dragFrom = parseInt(chip.getAttribute('data-node'), 10);
    dropAt = null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(NODE_MIME, String(dragFrom));
    }
    marks(chip, 'moving');
  });

  /* Место вставки — по ближнему краю узла, к которому подносят: курсор в
     левой половине значит «перед ним», в правой — «за ним». */
  chainBox.addEventListener('dragover', function (e) {
    if (dragFrom === null) return;
    var chip = chipOf(e.target);
    if (!chip) return;
    /* Без preventDefault браузер считает, что сюда ронять нельзя, и drop
       не случится вовсе. */
    e.preventDefault();
    var at = parseInt(chip.getAttribute('data-node'), 10);
    var box = chip.getBoundingClientRect();
    var after = e.clientX > box.left + box.width / 2;
    clearMarks();
    marks(chip, after ? 'after' : 'before');
    if (dragFrom !== null) {
      var moved = chainBox.querySelectorAll('[data-node="' + dragFrom + '"]');
      if (moved.length) marks(moved[0], 'moving');
    }
    dropAt = at + (after ? 1 : 0);
  });

  chainBox.addEventListener('drop', function (e) {
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
  chainBox.addEventListener('dragend', endDrag);

  /* Состав снапшотов весь живёт на рельсе: там его показывают, там же
     добавляют, переставляют и убирают. Отдельного списка источников с теми
     же строками у страницы больше нет. */
  function renderSources() {
    renderChain();
    var warns = store.warnings(), wout = '', i;
    for (i = 0; i < warns.length; i++) wout += '<div class="warn">' + esc(warns[i]) + '</div>';
    warningsBox.innerHTML = wout;
  }

  store.onChange(function () {
    applyData(viewmodel.buildPageData(store.snapshots()));
    renderSources();
    syncEmpty();
  });

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
  var errorsTimers = [];

  function stopErrorsTimers() {
    for (var i = 0; i < errorsTimers.length; i++) clearTimeout(errorsTimers[i]);
    errorsTimers = [];
  }

  function showErrors(errors) {
    var out = '', i;
    for (i = 0; i < errors.length; i++) out += '<li>' + esc(errors[i]) + '</li>';
    /* Свежее сообщение начинает свой срок с нуля: догорающий чужой таймер
       погасил бы его раньше, чем человек успел прочитать. */
    stopErrorsTimers();
    loadErrors.className = 'problems loaderrors';
    loadErrors.innerHTML = out;
    if (!out) return;
    /* Два независимых таймера, а не вложенных: гашение и уборка — разные
       события, и заводить второе изнутри первого значит связать их
       порядком выполнения там, где связи нет. */
    errorsTimers.push(setTimeout(function () {
      loadErrors.className = 'problems loaderrors fading';
    }, ERRORS_LIFE));
    errorsTimers.push(setTimeout(function () {
      loadErrors.innerHTML = '';
      loadErrors.className = 'problems loaderrors';
    }, ERRORS_LIFE + ERRORS_FADE));
  }

  function loadFiles(files) {
    var errors = [], pending = files.length, i;
    if (!pending) return;
    function done() {
      pending -= 1;
      if (pending) return;
      showErrors(errors);
    }
    for (i = 0; i < files.length; i++) {
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
      }(files[i]));
    }
  }

  function openPicker() { fileInput.click(); }

  pickBtn.addEventListener('click', openPicker);

  fileInput.addEventListener('change', function () {
    loadFiles(fileInput.files);
    /* Тот же файл, выбранный второй раз, не даёт события, пока в поле
       лежит его прежнее значение. */
    fileInput.value = '';
  });

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
