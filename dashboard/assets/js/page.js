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
    const own = text.own, keys = text.keys, setFrom = text.setFrom;
    const has = text.has, slug = text.slug;

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

    /* Всё состояние страницы в одном месте: отсюда же оно уезжает в
       location.hash и оттуда же восстанавливается при перезагрузке. */
    const st = {
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
      sort: { state: { key: 'name', asc: true },
              diff: { key: 'name', asc: true } }
    };
    /* Раскрытие строк: ключи вида "state:os-9.2:nginx", значения true/false.
       Состояние трёхзначное — отсутствие ключа значит «решает поиск»: строку,
       которая попала в выдачу только совпадением в деталях, разворачивает сам
       поиск. Явный ключ всегда сильнее: иначе такую строку было бы не свернуть. */
    const expanded = {};
    /* Выбрал ли снапшот и переход человек — кликом по рельсу или адресом,
       который он открыл. Пока не выбрал, при каждом изменении состава действует
       умолчание; см. applyData(). */
    const picked = { tag: false, pair: false };

    /* ---------- имена снапшотов и диапазонов ---------- */

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
      let lo, hi, found = null;
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
    function endsFromName(value) {
      const at = String(value).indexOf('..');
      if (at === -1) return null;
      const left = value.slice(0, at), right = value.slice(at + 2);
      return lastEndsNamed(left, right) || lastEndsNamed(right, left);
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

    /* Имя перехода для адресной строки: имена обоих снапшотов, а не их тегов.
       У трёх прогонов одного тега все переходы назывались бы
       «os-9.2..os-9.2», и ссылка на любой из них открывала бы последний. */
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

    /* Явный выбор снапшота человеком — кликом по узлу или ссылкой. Дальше
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

    function toggleFilter(key) {
      const set = activeFilters();
      if (key === 'all') { st.filters[st.tab] = {}; }
      else if (own(set, key)) { delete set[key]; }
      else {
        /* «версия та же» — не уточнение к «что-то изменилось», а другой срез
           той же таблицы. Складывать их по И значит показать «версия не
           менялась, но что-то другое поехало» — не то, что просит карточка. */
        if (key === 'unchanged') delete set['changed'];
        set[key] = 1;
      }
    }

    function stateMatches(row) {
      let set = st.filters.state, key;
      for (key in set) {
        if (!set.hasOwnProperty(key)) continue;
        if (key === 'has-patch') { if (!row.patches.length) return false; }
        else if (key === 'problem') { if (!row.problems.length) return false; }
        else if (row.marks.indexOf(key) === -1) return false;
      }
      return true;
    }

    function diffMatches(row) {
      let set = st.filters.diff, key;
      for (key in set) {
        if (!set.hasOwnProperty(key)) continue;
        if (key === 'changed') { if (!row.changed) return false; }
        else if (row.marks.indexOf(key) === -1) return false;
      }
      return true;
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
      const host = tab === 'diff' ? curPair() : curSnap();
      const rows = host ? (tab === 'diff' ? host.rows : host.builds) : [];
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
      let tabs = ['state', 'diff'], t, i, tab, from, live;
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

    /* ---------- поиск ---------- */

    /* Поиск идёт и по видимым полям строки, и по её деталям. Если совпало
       только в деталях, строка не просто остаётся — она сразу разворачивается,
       иначе непонятно, почему она в выдаче. */
    function scanState(row, q) {
      if (!q) return { show: true, deep: false };
      const shallow = has(row.name, q) || has(row.nvr, q) || has(row.branch, q)
                 || has(row.evr, q) || has(row.tagged_in, q);
      let deep = has(row.project, q) || has(row.completed, q) || has(row.owner, q);
      let i, j, p;
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
      const shallow = has(row.name, q) || has(row.old_evr, q) || has(row.new_evr, q);
      let deep = has(row.old_branch, q) || has(row.new_branch, q)
              || has(row.old_tagged_in, q) || has(row.new_tagged_in, q);
      const lists = [row.old_patches, row.new_patches];
      let i, j, k, p;
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

    function visibleRows() {
      let q = st.q, out = [], i, row, scan;
      if (st.tab === 'diff') {
        let pair = curPair();
        const rows = pair ? pair.rows : [];
        for (i = 0; i < rows.length; i++) {
          row = rows[i];
          if (!diffMatches(row)) continue;
          scan = scanDiff(row, q);
          if (!scan.show) continue;
          out.push({ row: row, open: scan.deep });
        }
        return out;
      }
      const snap = curSnap();
      const builds = snap ? snap.builds : [];
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
      const s = curSnap();
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
        if (key === 'dpatch') return row.patches_added.length + row.patches_removed.length;
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

    /* Разобранный адрес превращается в состояние страницы. Имена снапшотов
       сопоставляются с цепочкой здесь, а не при разборе: разбор не должен
       знать, что за снапшоты сейчас на странице. */
    function restore(parsed) {
      let filters = parsed.filters, dropped = false, j;
      if (parsed.tab !== null) {
        /* Сравнивать нечего — вкладки «Изменения» на странице тоже нет. */
        if (parsed.tab === 'diff' && SNAPS.length < 2) dropped = true;
        st.tab = (parsed.tab === 'diff' && SNAPS.length > 1) ? 'diff' : 'state';
      }
      if (parsed.tag !== null) {
        /* Ссылку правят руками, и «tag=os-9.2» без времени сбора — её
           законная форма. Два прогона одного тега она не различает: берём
           последний по цепочке, самый свежий. Сама страница пишет всегда
           полное имя, поэтому её ссылки однозначны.

           Ссылка — такой же выбор человека, как клик по узлу: он должен
           пережить приход следующего файла, потому и selectSnapshot. */
        for (j = 0; j < SNAPS.length; j++) {
          if (snapNamed(j, parsed.tag)) selectSnapshot(j);
        }
      }
      if (parsed.pair !== null) {
        /* Не разобрали — остаёмся на переходе по умолчанию. */
        const ends = endsFromName(parsed.pair);
        if (ends) setPairEnds(ends[0], ends[1]);
      }
      /* Ссылка вела на «Изменения», но сравнивать в этом прогоне нечего.
         Фильтры из неё — диффовые; на вкладке состояния они дали бы пустую
         таблицу без единого намёка почему. */
      if (dropped) filters = null;
      /* Что из этого живое, решает dropDeadFilters() — его зовут оба, кто
         читает хеш, и оба по той же причине, что и после смены данных. */
      if (filters) st.filters[st.tab] = setFrom(filters);
      if (parsed.sort) st.sort[st.tab] = parsed.sort;
      if (parsed.q !== null) st.q = parsed.q;
    }

    /* Части текущего состояния под сборку ссылки: имена уже разрешены, а
       склеивать из них строку — дело hash.js. */
    function hashParts() {
      return {
        tab: st.tab,
        tag: SNAPS.length ? snapKey(SNAPS[st.tag]) : null,
        pair: SNAPS.length > 1 ? pairKey(currentEnds()) : null,
        filters: keys(activeFilters()).sort(),
        q: st.q,
        sort: st.sort[st.tab]
      };
    }

    function snapshots() { return SNAPS; }
    function data() { return DATA; }

    return {
      st: st, picked: picked,
      applyData: applyData, snapshots: snapshots, data: data,
      curSnap: curSnap, curPair: curPair,
      snapKey: snapKey, snapIndexByKey: snapIndexByKey, snapNamed: snapNamed,
      currentEnds: currentEnds, pairKey: pairKey, pairFor: pairFor,
      lastEndsNamed: lastEndsNamed, endsFromName: endsFromName,
      setPairEnds: setPairEnds, selectSnapshot: selectSnapshot,
      anchor: anchorAt, setAnchor: setAnchor,
      activeFilters: activeFilters, toggleFilter: toggleFilter,
      knownFilter: knownFilter, dropDeadFilters: dropDeadFilters,
      visibleRows: visibleRows, totalRows: totalRows,
      sortRows: sortRows, sortBy: sortBy,
      rowKey: rowKey, openOf: openOf, setOpen: setOpen,
      restore: restore, hashParts: hashParts
    };
  }

  return { create: create };
}));
