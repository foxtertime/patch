/* Состояние страницы и всё, что из него считается: какой снапшот открыт,
   какой диапазон сравнивается, какие фильтры стоят, что ищут и какие строки
   после этого видны. DOM отсюда не виден вовсе — перерисовкой распоряжается
   корень страницы.

   Заводится фабрикой, а не живёт синглтоном: тест поднимает свежую страницу
   одним вызовом, не выкидывая модуль из кэша require. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.page = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  function create(deps) {
    const viewmodel = deps.viewmodel, diffmod = deps.diffmod;
    const store = deps.store, labels = deps.labels, text = deps.text;
    const own = text.own, keys = text.keys;
    const slug = text.slug;
    /* Поиск живёт отдельным модулем: он ничего не знает ни о состоянии, ни
       о данных страницы — только о строке и запросе. */
    const scanState = deps.search.scanState, scanDiff = deps.search.scanDiff;
    const querymod = deps.query;

    /* Данные страницы считаются не здесь: сюда приходит уже посчитанное
       viewmodel.js по снапшотам, которые человек подгрузил сам. */
    let DATA = { generated: '', patch_classes: [], snapshots: [], pairs: [] };
    let SNAPS = [], PAIRS = [];
    /* Выбранный переход — имена снапшотов, а не номер в массиве. Номер
       значил что-то, только пока переходы приходили готовым списком в
       известном порядке; с произвольными диапазонами он не значит ничего, а
       имя переживает и перестановку цепочки, и выгрузку соседа. */
    const pairSel = { from: null, to: null };
    /* Посчитанные переходы по имени диапазона. Заводится заново на каждую
       смену состава: снапшот с тем же именем — тот же файл, но набор вокруг
       него другой, и сводность диапазона могла измениться. */
    let pairCache = {};
    /* Отмеченный первым кликом узел, пока второй не выбран. Живёт только до
       следующего клика, смены вкладки или смены состава снапшотов: это шаг
       выбора, а не состояние страницы. */
    let anchor = null;

    /* Всё состояние страницы в одном месте. Живёт оно ровно столько,
       сколько открыта вкладка: наружу не уезжает вовсе и при перезагрузке
       начинается с умолчаний. */
    const st = {
      tab: 'state',
      /* Свежий тег выбирает applyData: до прихода данных выбирать не из чего.
         Переход здесь не хранится вовсе — его концы названы именами
         снапшотов и лежат в pairSel. */
      tag: 0,
      q: '',
      /* Идёт ли содержимое поля в регулярное выражение. Не по вкладкам:
         поле поиска на странице одно на обе, и его признак живёт так же.
         Меняется только кнопкой: замер показал, что шаблон вроде «(a+)+$»
         способен подвесить вкладку на десятки секунд, и включать такое
         должен человек, а не что-то за него. */
      regex: false,
      /* «Изменения» открываются на изменившихся компонентах: неизменившиеся
         строки в этой таблице — шум, из-за которого не видно изменившихся.
         Фильтр обычный: он виден на кнопке фильтров и снимается как любой
         другой.

         Значение — 1 («есть») или -1 («нет»); отсутствие ключа значит
         «неважно». */
      filters: { state: {}, diff: { 'changed': 1 } },
      /* Режим группы признаков: 'any' значит «любой из», отсутствие ключа —
         «все», то есть И. Умолчание у всех групп одно, поэтому хранить его
         незачем. */
      modes: { state: {}, diff: {} },
      sort: { state: { key: 'name', asc: true },
              diff: { key: 'name', asc: true } }
    };
    /* Раскрытие строк: ключи вида "state:os-9.2:nginx", значения true/false.
       Состояние трёхзначное — отсутствие ключа значит «решает поиск»: строку,
       которая попала в выдачу только совпадением в деталях, разворачивает сам
       поиск. Явный ключ всегда сильнее: иначе такую строку было бы не свернуть. */
    const expanded = {};
    /* Выбрал ли снапшот и переход человек — кликом по рельсу. Пока не выбрал,
       при каждом изменении состава действует умолчание; см. applyData(). */
    const picked = { tag: false, pair: false };

    /* ---------- имена снапшотов и диапазонов ---------- */

    /* Имя снапшота — тег и время сбора. Одного тега мало: один и тот же тег
       законно приходит из разных прогонов («тот же тег месяц назад против
       сегодняшнего» — самый частый способ сравнения), и по имени тега такие
       снапшоты неразличимы. Любое добавление, удаление или перестановка молча
       переводили бы выбор на другой прогон. */
    function snapKey(snap) {
      return snap ? snap.tag + '@' + (snap.generated || '') : '';
    }

    function snapIndexByKey(key) {
      for (let i = 0; i < SNAPS.length; i++) {
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
      const a = snapIndexByKey(pairSel.from), b = snapIndexByKey(pairSel.to);
      if (a === -1 || b === -1 || a === b) return [0, SNAPS.length - 1];
      return a < b ? [a, b] : [b, a];
    }

    /* Имя перехода: имена обоих снапшотов, а не их тегов. У трёх прогонов
       одного тега все переходы назывались бы «os-9.2..os-9.2», и выбор любого
       из них было бы не отличить от выбора последнего. */
    function pairKey(ends) {
      if (!ends || !SNAPS[ends[0]] || !SNAPS[ends[1]]) return '';
      return snapKey(SNAPS[ends[0]]) + '..' + snapKey(SNAPS[ends[1]]);
    }

    /* ---------- выбор ---------- */

    /* Концы принимаются в любом порядке: направление задаёт цепочка, и
       выправляет его currentEnds(). */
    function setPairEnds(a, b) {
      pairSel.from = snapKey(SNAPS[a]);
      pairSel.to = snapKey(SNAPS[b]);
      picked.pair = true;
    }

    /* Явный выбор снапшота человеком — кликом по узлу. Дальше
       страница держит его именем: приход или уход соседнего снапшота не
       должен молча переселить таблицу на другой прогон. */
    function selectSnapshot(at) {
      st.tag = at;
      picked.tag = true;
    }

    function anchorAt() { return anchor; }
    function setAnchor(at) { anchor = at; }

    /* ---------- переходы ---------- */

    /* Единственный тег в цепочке с таким именем, иначе -1. Предпосчитанные
       переходы названы тегами, а один тег законно приходит из двух прогонов;
       такую пару по имени не опознать, и в кэш она не попадёт — её посчитают
       по требованию. */
    function onlyIndexWithTag(tag) {
      let found = -1, i;
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
      let i, lo, hi;
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
      let key = pairKey(ends);
      if (own(pairCache, key)) return pairCache[key];
      const raw = store.snapshots();
      if (!raw[ends[0]] || !raw[ends[1]]) return null;
      /* Сводным считается диапазон во всю цепочку, и только когда снапшотов
         больше двух: на двух единственный переход и есть вся цепочка, и
         подписывать его итогом значит сообщать очевидное. */
      const summary = ends[0] === 0 && ends[1] === SNAPS.length - 1
        && SNAPS.length > 2;
      const block = viewmodel.pairBlock(
        diffmod.diffSnapshots(raw[ends[0]], raw[ends[1]], summary), raw);
      pairCache[key] = block;
      return block;
    }

    function curSnap() { return SNAPS[st.tag] || null; }
    function curPair() { return pairFor(currentEnds()); }

    /* ---------- фильтры ---------- */

    function activeFilters() { return st.filters[st.tab]; }

    function filterState(key) {
      const at = st.filters[st.tab][key];
      return at === 1 || at === -1 ? at : 0;
    }

    function setFilter(key, state) {
      const set = st.filters[st.tab];
      if (state === 1 || state === -1) set[key] = state;
      else delete set[key];
    }

    /* Клик по плашке: «есть» ↔ «неважно». Из «нет» клик тоже уводит в
       «неважно» — получить с плашки обратный срез нельзя, а уйти из него
       можно. Все три положения показывает меню. */
    function toggleFilter(key) {
      if (key === 'all') { st.filters[st.tab] = {}; return; }
      setFilter(key, filterState(key) === 0 ? 1 : 0);
    }

    /* Режим любой вкладки, а не только текущей: судить приходится и о той,
       на которой человека сейчас нет. */
    function modeOf(tab, id) {
      return st.modes[tab][id] === 'any' ? 'any' : 'all';
    }

    function groupMode(id) { return modeOf(st.tab, id); }

    function setGroupMode(id, mode) {
      if (mode === 'any') st.modes[st.tab][id] = 'any';
      else delete st.modes[st.tab][id];
    }

    /* Есть ли у строки этот признак. Два ключа считаются, остальные просто
       стоят в её метках — и это единственное место, где такое знание нужно:
       и совпадение, и счётчики меню спрашивают отсюда. */
    function rowHas(row, key, tab) {
      if (tab === 'diff') {
        if (key === 'changed') return Boolean(row.changed);
        return row.marks.indexOf(key) !== -1;
      }
      if (key === 'has-patch') return row.patches.length > 0;
      /* Признак строки — её уровень, а не наличие записей в problems: билд
         с одним предупреждением стоит под «с предупреждениями», а не под
         «с проблемами», и попадает ровно в одну из двух выборок. Заметка не
         даёт ни того, ни другого — она ни о чём не предупреждает. */
      if (key === 'problem') return row.level === 'error';
      if (key === 'warning') return row.level === 'warning';
      if (key === 'note') return row.level === 'note';
      return row.marks.indexOf(key) !== -1;
    }

    /* Совпадение строки с набором фильтров.

       Внутри группы: «нет» — запрет, он действует всегда; «есть»
       складываются по И или по ИЛИ, смотря какой у группы режим. Группы
       между собой всегда по И.

       Ключ, не попавший ни в одну группу, проверяется по И. Сейчас таких
       нет — группы покрывают все метки, которые ставит viewmodel, — но
       набор меток задаётся данными, и молча не применять неизвестный фильтр
       нельзя: он стоял бы в меню и не действовал, ничем себя не выдав. */
    function matches(row, tab) {
      const set = st.filters[tab];
      const groups = labels.groups(tab);
      const seen = {};
      let key;
      for (const group of groups) {
        let positives = 0, hit = false;
        for (const name of group.keys) {
          seen[name] = 1;
          if (own(set, name) === undefined) continue;
          if (set[name] === -1) {
            if (rowHas(row, name, tab)) return false;
            continue;
          }
          positives += 1;
          if (rowHas(row, name, tab)) hit = true;
          else if (modeOf(tab, group.id) === 'all') return false;
        }
        if (positives && !hit) return false;
      }
      for (key in set) {
        if (own(set, key) === undefined || seen[key]) continue;
        if (set[key] === -1) { if (rowHas(row, key, tab)) return false; }
        else if (!rowHas(row, key, tab)) return false;
      }
      return true;
    }

    function stateMatches(row) { return matches(row, 'state'); }
    function diffMatches(row) { return matches(row, 'diff'); }

    /* Строки вкладки. Правило «откуда их брать» одно на четверых —
       счётчики меню, отсев мёртвых фильтров, видимые строки и общее
       число, — и все четверо обязаны спрашивать в одном месте. Вкладка
       приходит доводом: судить приходится и о той, на которой человека
       сейчас нет. */
    function rowsOf(tab) {
      const host = tab === 'diff' ? curPair() : curSnap();
      if (!host) return [];
      return tab === 'diff' ? host.rows : host.builds;
    }

    /* Сколько строк вкладки подходит под каждый признак само по себе, без
       оглядки на другие фильтры: так же считают плашки. Зовут это при
       открытии меню, а не на каждую перерисовку — иначе лишний проход по
       всем строкам на каждый клик. */
    function filterCounts() {
      const tab = st.tab;
      const list = rowsOf(tab);
      const out = {};
      for (const group of labels.groups(tab)) {
        for (const key of group.keys) {
          let n = 0;
          for (const row of list) { if (rowHas(row, key, tab)) n += 1; }
          out[key] = n;
        }
      }
      return out;
    }

    /* Токен фильтра мог устареть — приехать из чужого хеша или пережить свой
       снапшот. Свой мы узнаём по подписи, по классу патчей или по метке живой
       строки; чужой молча выбрасываем, чтобы страница не показывала пустую
       таблицу под фильтр, которого не поставить и не снять — его нет ни на
       одной карточке. Вкладка приходит доводом, а не берётся из st: судить
       приходится и о той, на которой человека сейчас нет. */
    function knownFilter(key, tab) {
      let classes = labels.classes(), i;
      if (!key || key === 'all') return false;
      if (labels.LABELS.hasOwnProperty(key)) return true;
      for (i = 0; i < classes.length; i++) {
        if (slug(classes[i]) === key) return true;
      }
      const rows = rowsOf(tab);
      for (i = 0; i < rows.length; i++) {
        if (rows[i].marks.indexOf(key) !== -1) return true;
      }
      return false;
    }

    /* Единственное место, где обещание knownFilter выполняется: фильтр
       человек поставил кликом, а данные под ним сменились. Обе вкладки сразу: наборы фильтров у них свои, и мёртвый
       фильтр на невидимой сейчас вкладке встретил бы человека той же пустой
       таблицей через один клик по ней. */
    function dropDeadFilters() {
      for (const tab of ['state', 'diff']) {
        const from = st.filters[tab], live = {};
        /* Переносим значение, а не единицу: у пережившего отсев фильтра
           «нет» обязано остаться «нет». */
        for (const key of keys(from)) {
          if (knownFilter(key, tab)) live[key] = from[key];
        }
        st.filters[tab] = live;
      }
    }

    /* ---------- какие строки видны ---------- */

    /* Матчер запроса, посчитанный один раз на отрисовку. Компилировать его
       заново на каждую строку таблицы значило бы делать это тысячи раз за
       перерисовку, а на регулярке это ещё и разбор шаблона. Помним
       последний вход и отдаём готовое. */
    let lastQuery = null, lastRegex = null, lastMatcher = null;
    function matcher() {
      if (lastMatcher === null || lastQuery !== st.q || lastRegex !== st.regex) {
        lastQuery = st.q;
        lastRegex = st.regex;
        lastMatcher = querymod.compile(st.q, st.regex);
      }
      return lastMatcher;
    }

    /* Строки одной вкладки: сперва фильтры, потом поиск. Правило одно на
       обе, разные у них только источник строк и пара считалок. */
    function pick(rows, matches, scan) {
      const out = [];
      const q = matcher();
      for (const row of rows) {
        if (!matches(row)) continue;
        const found = scan(row, q);
        if (!found.show) continue;
        out.push({ row, open: found.deep });
      }
      return out;
    }

    function visibleRows() {
      if (st.tab === 'diff') return pick(rowsOf('diff'), diffMatches, scanDiff);
      return pick(rowsOf('state'), stateMatches, scanState);
    }

    function totalRows() {
      return rowsOf(st.tab).length;
    }

    /* Ключ раскрытой строки. Снапшот и пара названы полными именами: у двух
       прогонов одного тега иначе было бы одно состояние раскрытия на двоих. */
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

    function setOpen(key, on) { expanded[key] = on; }

    /* ---------- сортировка ---------- */

    /* Версии сравниваются как строки, а не по правилам rpm, и это осознанно:
       в соседних строках стоят версии разных компонентов, так что «правильный»
       порядок между ними всё равно ничего не значит. Про 1.10 выше 1.9
       предупреждает подсказка на заголовке колонки. */
    function sortValue(row, key) {
      if (st.tab === 'diff') {
        if (key === 'old') return row.old_evr || '';
        if (key === 'new') return row.new_evr || '';
        if (key === 'dpatch') {
          return row.patches_added.length + row.patches_removed.length
               + (row.patches_rewritten || []).length;
        }
        if (key === 'drpm') return row.rpms_added.length + row.rpms_removed.length;
        return row.name || '';
      }
      if (key === 'patches') return row.patches.length;
      if (key === 'rpms') return row.rpms.length;
      return row[key] || '';
    }

    function sortRows(items) {
      const cfg = st.sort[st.tab];
      items.sort((a, b) => {
        let x = sortValue(a.row, cfg.key), y = sortValue(b.row, cfg.key), res;
        if (typeof x === 'number' || typeof y === 'number') res = (x || 0) - (y || 0);
        else res = x < y ? -1 : (x > y ? 1 : 0);
        if (res === 0) res = a.row.name < b.row.name ? -1 : (a.row.name > b.row.name ? 1 : 0);
        return cfg.asc ? res : -res;
      });
      return items;
    }

    /* Сортировка по той же колонке переворачивает порядок, по другой —
       начинает сначала по возрастанию. */
    function sortBy(key) {
      const cfg = st.sort[st.tab];
      if (cfg.key === key) cfg.asc = !cfg.asc;
      else { cfg.key = key; cfg.asc = true; }
    }

    /* ---------- приход данных ---------- */

    /* Единственная дверь для данных: сюда приходит то, что посчитал
       viewmodel.js. Зовётся при каждом изменении набора снапшотов, поэтому
       всё, что зависит от их состава, здесь именно пересчитывается, а не
       дописывается. Перерисовку отсюда не заказывают — этим распоряжается
       корень страницы, который один знает про DOM. */
    function applyData(pageData) {
      /* Держим выбор именами: после перестановки или удаления номер
         показал бы другой снапшот, ничем не выдав подмены. Имя — полное,
         с временем сбора: одного тега мало, см. snapKey().

         Восстанавливаем только то, что человек выбрал сам. Снапшоты приезжают
         по одному файлу, каждый файл — свой applyData, и «прежним выбором»
         без picked оказывался бы тот, который дашборд выбрал сам на прошлом
         шаге: после первого же файла умолчание «свежий снапшот и самый
         широкий переход» не срабатывало бы больше никогда. */
      const wantTag = picked.tag && SNAPS[st.tag] ? snapKey(SNAPS[st.tag]) : null;
      const wantPair = picked.pair ? pairKey(currentEnds()) : null;
      let foundTag = false, foundPair = false;
      let ci;
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
        const parts = wantPair.split('..');
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
    }

    function snapshots() { return SNAPS; }
    function data() { return DATA; }

    return {
      st, picked,
      applyData, snapshots, data,
      curSnap, curPair,
      snapKey, snapIndexByKey,
      currentEnds, pairKey, pairFor,
      setPairEnds, selectSnapshot,
      anchor: anchorAt, setAnchor,
      activeFilters, filterState, setFilter, toggleFilter,
      groupMode, setGroupMode, filterCounts,
      knownFilter, dropDeadFilters,
      visibleRows, totalRows, matcher,
      sortRows, sortBy,
      rowKey, openOf, setOpen
    };
  }

  return { create };
}));
