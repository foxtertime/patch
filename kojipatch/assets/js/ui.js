/* Поведение страницы: загрузка снапшотов, разметка, фильтры, поиск,
   адресная строка. Считает данные viewmodel.js, а что именно считать —
   решает store.js; здесь это только рисуют и связывают с событиями. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./viewmodel.js'), require('./store.js'),
                             require('./rpms.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.ui = factory(root.KP.viewmodel, root.KP.store, root.KP.rpms);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (viewmodel, store, rpmsmod) {
  'use strict';

  /* Данные страницы считаются здесь же, из снапшотов, которые человек
     подгружает в дашборд сам. */
  var DATA = { generated: '', patch_classes: [], snapshots: [], pairs: [] };
  var SNAPS = [], PAIRS = [], CLASSES = [];

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
    var wantPair = picked.pair && PAIRS[st.pair] ? pairKey(st.pair) : null;
    var foundTag = false, foundPair = false;
    var ci;
    DATA = pageData;
    SNAPS = pageData.snapshots || [];
    PAIRS = pageData.pairs || [];
    CLASSES = pageData.patch_classes || [];
    /* Классы патчей задаются конфигом, поэтому подписи для них берём из
       данных. Ключ — тот же slug(), что стоит в теге строки и в карточке
       класса: имя вроде «C++» иначе дало бы три разных ключа и карточку
       без строк. Карта заводится заново: подпись класса из выгруженного
       снапшота пережила бы его и держала бы живым фильтр, которого на
       странице больше нет ни на одной карточке. */
    CLASS_LABELS = {};
    for (ci = 0; ci < CLASSES.length; ci++) {
      CLASS_LABELS[slug(CLASSES[ci])] = 'патчи ' + CLASSES[ci];
    }
    /* Умолчание: последний снапшот цепочки и самый широкий переход. Именно
       это обещает README, и обещание не должно зависеть от того, одним
       файлом человек подгрузил снапшоты или пятью. */
    st.tag = SNAPS.length ? SNAPS.length - 1 : 0;
    st.pair = PAIRS.length ? PAIRS.length - 1 : 0;
    for (ci = 0; wantTag !== null && ci < SNAPS.length; ci++) {
      if (snapKey(SNAPS[ci]) === wantTag) { st.tag = ci; foundTag = true; }
    }
    for (ci = 0; wantPair !== null && ci < PAIRS.length; ci++) {
      if (pairKey(ci) === wantPair) { st.pair = ci; foundPair = true; }
    }
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
    showTab(st.tab);
    rebuild();
    renderMeta();
  }

  /* Подписи фильтров: ключ приходит из данных (теги строк, статусы диффа),
     а по-русски он должен читаться и в чипе, и в подсказке. */
  var LABELS = {
    "all": "все",
    "has-patch": "с патчами", "problem": "с проблемами",
    "no-patch": "нет каталога PATCH", "no-source": "нет источника",
    "from-commit": "собран с коммита", "gitlab-error": "ошибка GitLab",
    "internal-error": "внутренняя ошибка",
    "inherited": "унаследован из другого тега",
    "tag-changed": "переехал между тегами",
    "added": "появился", "removed": "исчез", "unchanged": "версия та же",
    "upgraded": "версия выросла", "downgraded": "версия упала",
    "repackaged": "состав RPM изменился", "patches+": "патчи пришли",
    "patches-": "патчи ушли", "branch-changed": "сменил ветку",
    "changed": "что-то изменилось"
  };
  /* Подписи классов патчей живут отдельно от постоянных: классы приходят с
     данными и уходят вместе с ними, а LABELS — словарь самой страницы. */
  var CLASS_LABELS = {};
  var ARROW = { added: "+", removed: "−", upgraded: "↑",
                downgraded: "↓", unchanged: "=" };
  var KNOWN_CLASS = { "autogen": 1, "cve": 1, "sast": 1, "dast": 1,
                      "coverage": 1, "spec": 1, "changelog": 1, "files": 1,
                      "other": 1 };
  var CALM_TAGS = { "from-commit": "warn", "no-patch": "calm",
                    "no-source": "bad", "gitlab-error": "bad",
                    "internal-error": "bad", "inherited": "calm" };
  var STATUS_TAGS = { "added": 1, "removed": 1, "unchanged": 1, "upgraded": 1,
                      "downgraded": 1, "repackaged": 1 };

  var stateSection = document.getElementById('tab-state');
  var diffSection = document.getElementById('tab-diff');
  var controls = document.getElementById('controls');
  var chipsBox = document.getElementById('chips');
  var search = document.getElementById('q');
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
  var sourceList = document.getElementById('sourcelist');
  var loadErrors = document.getElementById('load-errors');
  var warningsBox = document.getElementById('warnings');
  var fileInput = document.getElementById('file-input');
  var dropZone = document.getElementById('drop');
  var pickBtn = document.getElementById('pick');
  var addMoreBtn = document.getElementById('add-more');
  var editBtn = document.getElementById('edit-sources');

  /* Всё состояние страницы в одном месте: отсюда же оно уезжает в
     location.hash и оттуда же восстанавливается при перезагрузке. */
  var st = {
    tab: 'state',
    /* Свежий тег и самую широкую пару выбирает applyData: до прихода
       данных выбирать не из чего. */
    tag: 0,
    pair: 0,
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

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* Экранирует и подсвечивает вхождения текущего запроса. Всё, что попадает
     в DOM из DATA, проходит либо через esc(), либо через hl(). */
  function hl(s, q) {
    s = String(s === null || s === undefined ? '' : s);
    if (!q) return esc(s);
    var low = s.toLowerCase(), out = '', from = 0, at;
    while ((at = low.indexOf(q, from)) !== -1) {
      out += esc(s.slice(from, at)) + '<span class="hit">'
          + esc(s.slice(at, at + q.length)) + '</span>';
      from = at + q.length;
    }
    return out + esc(s.slice(from));
  }

  /* Значение по ключу, который пришёл из данных. Голый объект несёт свойства
     Object.prototype, и на ключ «constructor» — а так может называться класс
     патчей, имена им задаёт конфиг — он отвечает функцией Object вместо
     «ничего нет». Она уезжает прямо на экран: подписью в карточке, числом в
     полоске (width:NaN%), именем css-класса. */
  function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function has(value, q) {
    return String(value === null || value === undefined ? '' : value)
      .toLowerCase().indexOf(q) !== -1;
  }

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  /* Класс патчей задаётся конфигом, а цвета в CSS перечислены поимённо.
     Незнакомый класс не должен остаться бесцветным — уводим его в c-x. */
  function classCls(name) {
    var key = slug(name);
    return own(KNOWN_CLASS, key) ? 'c-' + key : 'c-x';
  }

  function label(key) {
    return own(LABELS, key) || own(CLASS_LABELS, key) || key;
  }

  function plural(n, one, few, many) {
    var a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* Время сбора для подписи: обычно хватает даты, но два прогона одного тега
     случаются и в один день — тогда к дате добавляется время. Строку режем,
     а не разбираем: «неизвестно» из неё выдумывать нечего, а формат задан
     самим kojipatch. */
  function stampOf(value, withTime) {
    var text = String(value === null || value === undefined ? '' : value);
    return withTime ? text.slice(0, 16).replace('T', ' ') : text.slice(0, 10);
  }

  /* Подписи «когда собран» для списка снапшотов — по одной на элемент,
     пустая там, где дата не нужна. Дату получают только теги-двойники: у
     тега, который на странице один, она ничего не различает и мешает
     читать цепочку. */
  function whenLabels(items) {
    var byTag = {}, out = [], tag, group, seen, withTime, i, day;
    for (i = 0; i < items.length; i++) {
      out.push('');
      tag = items[i].tag;
      if (!byTag.hasOwnProperty(tag)) byTag[tag] = [];
      byTag[tag].push(i);
    }
    for (tag in byTag) {
      if (!byTag.hasOwnProperty(tag)) continue;
      group = byTag[tag];
      if (group.length < 2) continue;
      seen = {};
      withTime = false;
      for (i = 0; i < group.length; i++) {
        day = stampOf(items[group[i]].generated, false);
        if (seen.hasOwnProperty(day)) withTime = true;
        seen[day] = 1;
      }
      for (i = 0; i < group.length; i++) {
        out[group[i]] = stampOf(items[group[i]].generated, withTime);
      }
    }
    return out;
  }

  function keys(obj) {
    var out = [];
    for (var k in obj) { if (obj.hasOwnProperty(k)) out.push(k); }
    return out;
  }

  function setFrom(list) {
    var out = {};
    for (var i = 0; i < (list || []).length; i++) out[list[i]] = 1;
    return out;
  }

  /* Порядок классов: сначала как их перечислил классификатор, потом всё,
     что встретилось в данных, но в списке классов отсутствует. */
  function classOrder(counts) {
    var out = [], i;
    for (i = 0; i < CLASSES.length; i++) {
      if (own(counts, CLASSES[i])) out.push(CLASSES[i]);
    }
    var extra = keys(counts).sort();
    for (i = 0; i < extra.length; i++) {
      if (out.indexOf(extra[i]) === -1) out.push(extra[i]);
    }
    return out;
  }

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
      else if (row.tags.indexOf(key) === -1) return false;
    }
    return true;
  }

  function diffMatches(row) {
    var set = st.filters.diff, key;
    for (key in set) {
      if (!set.hasOwnProperty(key)) continue;
      if (key === 'changed') { if (!row.changed) return false; }
      else if (row.tags.indexOf(key) === -1) return false;
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
  function curPair() { return PAIRS[st.pair] || null; }

  /* Имя снапшота — тег и время сбора. Одного тега мало: один и тот же тег
     законно приходит из разных прогонов («тот же тег месяц назад против
     сегодняшнего» — самый частый способ сравнения), и по имени тега такие
     снапшоты неразличимы. Любое добавление, удаление или перестановка молча
     переводили бы выбор на другой прогон, а ссылка «tag=os-9.2» всегда
     открывала бы последний. */
  function snapKey(snap) {
    return snap ? snap.tag + '@' + (snap.generated || '') : '';
  }

  /* Номера снапшотов, которые сравнивает пара. Их задаёт diffChain: сперва
     соседи по цепочке в её порядке, затем — сводная пара «первый против
     последнего». Порядок пар здесь и порядок снапшотов — один и тот же,
     других пар в цепочке не бывает. */
  function pairEnds(index) {
    var pair = PAIRS[index];
    if (!pair) return null;
    if (pair.summary) return [0, SNAPS.length - 1];
    return [index, index + 1];
  }

  /* Имя перехода для адресной строки: имена обоих снапшотов, а не их тегов.
     У трёх прогонов одного тега все переходы назывались бы
     «os-9.2..os-9.2», и ссылка на любой из них открывала бы последний. */
  function pairKey(index) {
    var ends = pairEnds(index);
    if (!ends || !SNAPS[ends[0]] || !SNAPS[ends[1]]) return '';
    return snapKey(SNAPS[ends[0]]) + '..' + snapKey(SNAPS[ends[1]]);
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
    if (st.tab === 'diff') return 'diff:' + pairKey(st.pair) + ':' + row.name;
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

  function tagHtml(key) {
    var cls = 'tag';
    if (key === 'patches+') cls += ' added';
    else if (key === 'patches-') cls += ' removed';
    else if (key === 'branch-changed' || key === 'tag-changed') cls += ' warn';
    else if (own(CALM_TAGS, key)) cls += ' ' + CALM_TAGS[key];
    else if (own(STATUS_TAGS, key)) cls += ' ' + key;
    else cls += ' ' + classCls(key);   /* остаётся класс патчей */
    return '<span class="' + cls + '" data-filter="' + esc(key) + '" role="button"'
         + ' tabindex="0" data-tip="' + esc(label(key)) + '. Клик — фильтр.">'
         + esc(key) + '</span>';
  }

  /* Колонка «тег»: прочерк — билд затегован прямо в выбранный тег, имя —
     унаследован оттуда. Прочерк, а не повтор имени тега в каждой строке:
     в теге на восемьсот сборок повторов было бы восемьсот. */
  function taggedCell(row, q) {
    if (row.inherited === null) return '<span class="none">?</span>';
    if (!row.inherited) return '<span class="none">—</span>';
    return hl(row.tagged_in, q);
  }

  /* Время сборки в таблице: дата обычная, время бледнее. Колонку сканируют
     по дате — секунды нужны, когда до строки уже дошли. Снапшоты, собранные
     до появления времени, несут одну дату: тогда второй половины просто нет. */
  function builtHtml(value, q) {
    if (!value) return '';
    var date = value.slice(0, 10), time = value.slice(11);
    return hl(date, q)
         + (time ? ' <span class="tm">' + hl(time, q) + '</span>' : '');
  }

  function inheritedNote(inherited) {
    if (inherited === null) return '';
    return '<span class="note">(' + (inherited ? 'унаследован' : 'прямой')
         + ')</span>';
  }

  /* Тег, через который билд попал в этот снапшот. */
  function mainTagHtml(row, q) {
    if (!row.tagged_in) return '<span class="none">неизвестно</span>';
    return '<span class="ktag main">' + hl(row.tagged_in, q) + '</span>'
         + inheritedNote(row.inherited);
  }

  /* Остальные теги, в которых висит тот же билд. Строка остаётся на месте и
     когда их нет: блоки соседних раскрытых строк не должны разъезжаться. */
  function otherTagsHtml(row, q) {
    var all = row.koji_tags || [], list = [], i;
    for (i = 0; i < all.length; i++) {
      if (all[i] !== row.tagged_in) list.push(all[i]);
    }
    if (!list.length) return '<span class="none">—</span>';
    var out = '<div class="ktags">';
    for (i = 0; i < list.length; i++) {
      out += '<span class="ktag">' + hl(list[i], q) + '</span>';
    }
    return out + '</div>';
  }

  /* То же для сторон «было/стало»: там места на две строки нет. */
  function taggedText(taggedIn, inherited, q) {
    if (inherited === null || !taggedIn) {
      return '<span class="none">неизвестно</span>';
    }
    return '<span class="mono">' + hl(taggedIn, q) + '</span>'
         + inheritedNote(inherited);
  }

  function tagsHtml(tags) {
    var out = '';
    for (var i = 0; i < tags.length; i++) out += tagHtml(tags[i]);
    return out || '<span class="none">—</span>';
  }

  /* Адреса приходят из koji и GitLab, то есть снаружи. В href пускаем только
     http(s) и относительный путь: javascript: в ссылке нам ни к чему.
     «//host/x» — не относительный путь, а ссылка на чужой хост по текущей
     схеме, поэтому её тоже не пускаем. */
  function safeUrl(url) {
    if (!url) return null;
    return /^(https?:\/\/|\/(?!\/))/i.test(String(url)) ? String(url) : null;
  }

  function linkHtml(url, text) {
    var safe = safeUrl(url);
    if (!safe) return '';
    return '<a class="link" href="' + esc(safe) + '" target="_blank" rel="noopener">'
         + esc(text) + ' ↗</a>';
  }

  /* Полоска патчей: длина — размер стека относительно самого большого в
     выдаче, доли внутри — классы. Одна метка отвечает сразу на «много ли» и
     «чего именно», а точные числа даёт подсказка. */
  /* Полоска состава патчей. Ширина у неё постоянная, и это осознанно: раньше
     длина полоски означала «сколько патчей относительно самой обвешанной
     сборки», а доли цветов — состав, и две величины в одной картинке читались
     как одна непонятная. Сколько патчей — говорит число слева от полоски;
     полоска отвечает только на вопрос «из чего они». */
  function meterHtml(row) {
    var total = row.patches.length;
    if (!total) return '';
    var order = classOrder(row.patch_counts), parts = [], bars = '', i, n;
    for (i = 0; i < order.length; i++) {
      n = row.patch_counts[order[i]];
      parts.push(order[i] + ' ' + n);
      bars += '<i class="' + classCls(order[i]) + '" style="width:'
           + (100 * n / total).toFixed(2) + '%"></i>';
    }
    return '<span class="meter" data-tip="' + esc(parts.join(' · '))
         + ', всего ' + total + '">' + bars + '</span>';
  }

  function kv(k, v) {
    return '<div class="kv"><span class="k">' + esc(k) + '</span><span class="v">'
         + v + '</span></div>';
  }

  function signHtml(markCls) {
    return '<span class="sign">' + (markCls === 'is-added' ? '+' : '−') + '</span>';
  }

  /* Патчи одной стороны, сгруппированные по классам. mark — множество путей,
     которые нужно выделить как пришедшие или ушедшие. */
  function patchesHtml(patches, q, mark, markCls) {
    if (!patches.length) return '<div class="none">патчей нет</div>';
    var counts = {}, i, p, cls;
    for (i = 0; i < patches.length; i++) {
      cls = patches[i]['class'];
      counts[cls] = (own(counts, cls) || 0) + 1;
    }
    var order = classOrder(counts), out = '', ci, name;
    for (ci = 0; ci < order.length; ci++) {
      name = order[ci];
      out += '<div class="pgroup ' + classCls(name) + '">'
          + '<div class="pclass">' + esc(name) + ' <span class="n">'
          + counts[name] + '</span></div><ul class="plist">';
      for (i = 0; i < patches.length; i++) {
        p = patches[i];
        if (p['class'] !== name) continue;
        var hot = mark && mark[p.path];
        var li = hot ? ' class="' + markCls + '"' : '';
        var href = safeUrl(p.url);
        var title = href
          ? '<a href="' + esc(href) + '" target="_blank" rel="noopener">'
            + hl(p.name, q) + '</a>'
          : '<span class="mono">' + hl(p.name, q) + '</span>';
        out += '<li' + li + '>' + (hot ? signHtml(markCls) : '') + title
            + '<div class="ppath">' + hl(p.path, q) + '</div></li>';
      }
      out += '</ul></div>';
    }
    return out;
  }

  /* Архитектуру считает rpms.js — тот же модуль, что раскладывает пакеты по
     порядку. Своя копия здесь уже разошлась с ним и падала на пакете, который
     не строка: снапшот приходит из файла, который выбрал человек, а падало это
     не при отрисовке, а на раскрытии строки — там, где откатить нечего. */
  var archOf = rpmsmod.archOf;

  function rowArch(row) {
    return archOf(row[0] === null ? row[1] : row[0]);
  }

  function archGroupHtml(arch, count, body, cls) {
    return '<div class="pgroup arch"><div class="pclass">' + esc(arch)
         + ' <span class="n">' + count + '</span></div><ul class="rlist'
         + (cls || '') + '">' + body + '</ul></div>';
  }

  /* Пакеты приходят из Python уже разложенными: сначала src, потом noarch,
     дальше остальные архитектуры. Здесь список только режется на блоки по
     смене архитектуры — своего порядка фронтенд не заводит, иначе колонки
     «было» и «стало» разъехались бы. */
  function rpmsHtml(list, q) {
    if (!list.length) return '<div class="none">пакетов нет</div>';
    var out = '', i = 0;
    while (i < list.length) {
      var arch = archOf(list[i]), body = '', n = 0;
      while (i < list.length && archOf(list[i]) === arch) {
        body += '<li>' + hl(list[i], q) + '</li>';
        i++; n++;
      }
      out += archGroupHtml(arch, n, body, '');
    }
    return out;
  }

  /* Одна колонка выровненной таблицы пакетов. rows приходят из diff.js уже
     спаренными: [было, стало], где null означает «на этой стороне пакета
     нет». Обе стороны печатают одинаковое число строк и одинаковые блоки,
     поэтому один и тот же подпакет стоит слева и справа на одной высоте, а
     пустая ячейка напротив соседа читается как «пропал» или «пришёл».
     В заголовке блока — счётчик своей стороны, поэтому у исчезнувшей
     целиком архитектуры он честно показывает 0. */
  function rpmSideHtml(rows, at, q, markCls) {
    if (!rows.length) return '<div class="none">пакетов нет</div>';
    var out = '', i = 0;
    while (i < rows.length) {
      var arch = rowArch(rows[i]), body = '', n = 0;
      while (i < rows.length && rowArch(rows[i]) === arch) {
        var mine = rows[i][at], other = rows[i][1 - at];
        if (mine === null) {
          body += '<li class="rgap">·</li>';
        } else {
          var hot = other === null;
          body += '<li' + (hot ? ' class="' + markCls + '"' : '') + '>'
               + (hot ? signHtml(markCls) : '') + hl(mine, q) + '</li>';
          n++;
        }
        i++;
      }
      out += archGroupHtml(arch, n, body, ' fixed');
    }
    return out;
  }

  function rpmSideCount(rows, at) {
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i][at] !== null) n++;
    return n;
  }

  /* ---------- вкладка «Состояние» ---------- */

  function stateDetail(row, q) {
    var out = '<div class="detail">';

    out += '<div class="block"><div class="bl">koji</div>'
        + kv('NVR', '<span class="mono">' + hl(row.nvr, q) + '</span>')
        + kv('основной тег', mainTagHtml(row, q))
        + kv('другие теги', otherTagsHtml(row, q))
        + kv('собран', row.completed
              ? hl(row.completed, q) + (row.completed.length > 10
                  ? '<span class="note">МСК</span>' : '')
              : '<span class="none">—</span>')
        + kv('владелец', hl(row.owner || '—', q))
        + kv('build id', esc(row.build_id === null ? '—' : row.build_id))
        + kv('task id', esc(row.task_id === null ? '—' : row.task_id))
        + '</div>';

    var branch = row.branch
      ? '<span class="mono">' + hl(row.branch, q) + '</span>'
        + (row.ref_kind === 'commit' ? ' ' + tagHtml('from-commit') : '')
      : '<span class="none">источник неизвестен</span>';
    var dir = row.patch_dir_present === true ? 'есть'
            : (row.patch_dir_present === false ? 'нет' : 'не проверялся');
    out += '<div class="block"><div class="bl">gitlab</div>'
        + kv('проект', row.project
              ? '<span class="mono">' + hl(row.project, q) + '</span>'
              : '<span class="none">—</span>')
        + kv('ветка', branch)
        + kv('каталог PATCH', esc(dir))
        + kv('ссылка', row.source_url
              ? linkHtml(row.source_url, 'gitlab') : '<span class="none">—</span>')
        + '</div>';

    out += '<div class="block"><div class="bl">патчи · ' + row.patches.length
        + '</div>' + patchesHtml(row.patches, q, null, '') + '</div>';

    out += '<div class="block"><div class="bl">RPM · ' + row.rpms.length
        + '</div>' + rpmsHtml(row.rpms, q) + '</div>';

    if (row.problems.length) {
      out += '<div class="block wide"><div class="bl">проблемы</div>'
          + '<ul class="problems">';
      for (var i = 0; i < row.problems.length; i++) {
        out += '<li>' + hl(row.problems[i], q) + '</li>';
      }
      out += '</ul></div>';
    }
    return out + '</div>';
  }

  function stateRowsHtml(items) {
    var q = st.q, html = '', i, cols = colCount('state');
    for (i = 0; i < items.length; i++) {
      var row = items[i].row;
      var key = rowKey(row);
      var open = openOf(key, items[i].open);
      var bad = row.problems.length || row.tags.indexOf('no-source') !== -1;
      var patches = row.patches.length
        ? row.patches.length + meterHtml(row)
        : '<span class="zero">0</span>';
      html += '<tr class="main-row' + (bad ? ' bad' : '') + '" data-row="' + esc(key) + '">'
           + '<td class="src"><span class="chev" role="button" tabindex="0"'
           + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
           + (open ? '▾' : '▸') + '</span> ' + hl(row.name, q) + '</td>'
           /* Версии может не быть: снапшот приходит из файла, который выбрал
              человек, и прочерк здесь честнее пустой ячейки. */
           + '<td class="ver">' + (row.evr ? hl(row.evr, q)
                : '<span class="none">—</span>') + '</td>'
           + '<td class="tagged">' + taggedCell(row, q) + '</td>'
           + '<td class="branch">' + (row.branch ? hl(row.branch, q)
                : '<span class="none">—</span>') + '</td>'
           + '<td class="pat">' + patches + '</td>'
           + '<td class="num">' + row.rpms.length + '</td>'
           + '<td class="built">' + builtHtml(row.completed, q) + '</td>'
           + '<td class="tags">' + tagsHtml(row.tags) + '</td>'
           + '<td class="links">' + linkHtml(row.koji_url, 'koji')
           + linkHtml(row.source_url, 'git') + '</td></tr>';
      if (open) {
        html += '<tr class="detail-row"><td colspan="' + cols + '">'
             + stateDetail(row, q)
             + '</td></tr>';
      }
    }
    return html;
  }

  /* ---------- вкладка «Изменения» ---------- */

  /* Одна сторона «было/стало». Параметры собраны в объект: их тринадцать, и
     позиционным списком такой вызов читался бы как шифровка. */
  function side(s, q) {
    var out = '<div class="side"><div class="bl">' + esc(s.title) + ' · <b>'
            + esc(s.tag) + '</b></div>';
    out += kv('версия', s.evr ? '<span class="mono">' + hl(s.evr, q) + '</span>'
                              : '<span class="none">—</span>');
    out += kv('тег', s.tagChanged
      ? '<span class="' + s.markCls + '">'
        + taggedText(s.taggedIn, s.inherited, q) + '</span>'
      : taggedText(s.taggedIn, s.inherited, q));
    out += kv('ветка', s.branch
      ? '<span class="mono' + (s.branchChanged ? ' ' + s.markCls : '') + '">'
        + hl(s.branch, q) + '</span>'
      : '<span class="none">—</span>');
    out += '<div class="bl" style="margin-top:.7rem">патчи · ' + s.patches.length
        + '</div>' + patchesHtml(s.patches, q, s.mark, s.markCls);
    out += '<div class="bl" style="margin-top:.7rem">RPM · '
        + rpmSideCount(s.rpmRows, s.at)
        + '</div>' + rpmSideHtml(s.rpmRows, s.at, q, s.markCls);
    return out + '</div>';
  }

  function diffDetail(row, q) {
    var pair = curPair();
    var oldTag = pair ? pair.old : 'было', newTag = pair ? pair.new : 'стало';
    var branchChanged = row.tags.indexOf('branch-changed') !== -1;
    var tagChanged = row.tags.indexOf('tag-changed') !== -1;
    return '<div class="sides">'
      + side({ title: 'было', tag: oldTag, evr: row.old_evr,
               branch: row.old_branch, taggedIn: row.old_tagged_in,
               inherited: row.old_inherited, patches: row.old_patches,
               rpmRows: row.rpm_rows, at: 0, mark: setFrom(row.patches_removed),
               markCls: 'is-removed', branchChanged: branchChanged,
               tagChanged: tagChanged }, q)
      + side({ title: 'стало', tag: newTag, evr: row.new_evr,
               branch: row.new_branch, taggedIn: row.new_tagged_in,
               inherited: row.new_inherited, patches: row.new_patches,
               rpmRows: row.rpm_rows, at: 1, mark: setFrom(row.patches_added),
               markCls: 'is-added', branchChanged: branchChanged,
               tagChanged: tagChanged }, q)
      + '</div>';
  }

  function delta(added, removed) {
    if (!added && !removed) return '<span class="zero">—</span>';
    var out = '';
    if (added) out += '<span class="plus">+' + added + '</span> ';
    if (removed) out += '<span class="minus">−' + removed + '</span>';
    return out;
  }

  function diffRowsHtml(items) {
    var q = st.q, html = '', i, cols = colCount('diff');
    for (i = 0; i < items.length; i++) {
      var row = items[i].row;
      var key = rowKey(row);
      var open = openOf(key, items[i].open);
      html += '<tr class="main-row ' + esc(row.status) + '" data-row="' + esc(key) + '">'
           + '<td class="src"><span class="chev" role="button" tabindex="0"'
           + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
           + (open ? '▾' : '▸') + '</span> ' + hl(row.name, q) + '</td>'
           + '<td class="ver">' + (row.old_evr ? hl(row.old_evr, q) : '—') + '</td>'
           + '<td class="dir">' + (own(ARROW, row.status) || '') + '</td>'
           + '<td class="ver new">' + (row.new_evr ? hl(row.new_evr, q) : '—') + '</td>'
           + '<td class="pat">' + delta(row.patches_added.length,
                                        row.patches_removed.length) + '</td>'
           + '<td class="pat">' + delta(row.rpms_added.length,
                                        row.rpms_removed.length) + '</td>'
           + '<td class="tags">' + tagsHtml(row.tags) + '</td>'
           + '<td class="links">' + linkHtml(row.koji_url, 'koji')
           + linkHtml(row.source_url, 'git') + '</td></tr>';
      if (open) {
        html += '<tr class="detail-row"><td colspan="' + cols + '">'
             + diffDetail(row, q)
             + '</td></tr>';
      }
    }
    return html;
  }

  /* ---------- карточки, селекторы, чипы ---------- */

  function cardHtml(filter, big, number, unit, sub, text, tip, labelCls) {
    var cls = 'card' + (big ? ' big' : '') + (filter ? ' clickable' : '');
    var open = filter
      ? '<button type="button" class="' + cls + '" data-filter="' + esc(filter)
        + '" aria-pressed="false"'
      : '<div class="' + cls + '"';
    return open + ' data-tip="' + esc(tip) + '">'
      + (big ? '<div class="l' + (labelCls ? ' ' + labelCls : '') + '">' + esc(text) + '</div>' : '')
      + '<div class="n">' + esc(number)
      + (unit ? ' <span class="unit">' + esc(unit) + '</span>' : '') + '</div>'
      + '<div class="rpm">' + esc(sub || '') + '</div>'
      + (big ? '' : '<div class="l' + (labelCls ? ' ' + labelCls : '') + '">'
               + esc(text) + '</div>')
      + (filter ? '</button>' : '</div>');
  }

  function renderTagSelect() {
    var box = document.getElementById('tag-select'), out = '', i;
    /* У двух прогонов одного тега кнопки различает дата: без неё в селекторе
       стояли бы две одинаковые. */
    var when = whenLabels(SNAPS);
    for (i = 0; i < SNAPS.length; i++) {
      var s = SNAPS[i];
      out += '<button type="button" class="pick" data-tag="' + i + '" aria-pressed="'
          + (i === st.tag ? 'true' : 'false') + '" data-tip="Снимок тега '
          + esc(s.tag) + ' от ' + esc(s.generated) + '">' + esc(s.tag)
          + '<span class="sub">' + (when[i] ? esc(when[i]) + ' · ' : '')
          + s.counts.builds + ' '
          + plural(s.counts.builds, 'сборка', 'сборки', 'сборок') + '</span></button>';
    }
    box.innerHTML = out || '<span class="none">снимков нет</span>';
  }

  /* Подпись конца пары: тег, а у тегов-двойников — ещё и дата, иначе переход
     читался бы как «os-9.2 → os-9.2». Дату берём у того снапшота, который
     пара сравнивает, и только если тег на нём тот же: приписать тегу чужое
     время сбора значило бы соврать. */
  function endHtml(when, at, tag) {
    var mine = SNAPS[at] && SNAPS[at].tag === tag ? when[at] : '';
    return esc(tag) + (mine ? ' <span class="when">' + esc(mine) + '</span>' : '');
  }

  function renderPairSelect() {
    var box = document.getElementById('pair-select'), out = '', i;
    var when = whenLabels(SNAPS), ends;
    for (i = 0; i < PAIRS.length; i++) {
      var p = PAIRS[i];
      ends = pairEnds(i);
      out += '<button type="button" class="pick" data-pair="' + i + '" aria-pressed="'
          + (i === st.pair ? 'true' : 'false')
          + '" data-tip="' + (p.summary
              ? 'Сводная пара: первый тег прогона против последнего.'
              : 'Соседние теги прогона.')
          + ' Изменилось компонентов: ' + p.counts.changed + ' из ' + p.rows.length + '.">'
          + endHtml(when, ends[0], p.old) + ' → ' + endHtml(when, ends[1], p['new'])
          + (p.summary ? '<span class="sum">итог</span>' : '')
          + '<span class="sub">' + p.counts.changed + ' изм.</span></button>';
    }
    box.innerHTML = out || '<span class="none">сравнивать нечего</span>';
  }

  function renderStateCards() {
    var snap = curSnap();
    var big = document.getElementById('state-cards');
    var small = document.getElementById('class-cards');
    if (!snap) { big.innerHTML = ''; small.innerHTML = ''; return; }
    var c = snap.counts, rpms = 0, i;
    for (i = 0; i < snap.builds.length; i++) rpms += snap.builds[i].rpms.length;

    big.innerHTML =
        cardHtml('all', true, c.builds, plural(c.builds, 'сборка', 'сборки', 'сборок'),
          rpms + ' RPM', 'в теге',
          'Все последние сборки тега ' + snap.tag + ' и собранные из них бинарные '
          + 'пакеты. Клик снимает все фильтры.')
      + cardHtml('has-patch', true, c.with_patches,
          plural(c.with_patches, 'сборка', 'сборки', 'сборок'),
          c.patch_files + ' ' + plural(c.patch_files, 'файл', 'файла', 'файлов')
          + ' патчей', 'с патчами',
          'Сборки, у которых в каталоге PATCH ветки лежит хотя бы один файл. '
          + 'Клик оставит в таблице только их.')
      + cardHtml('inherited', true, c.inherited,
          plural(c.inherited, 'сборка', 'сборки', 'сборок'),
          c.direct + ' затегованы прямо', 'унаследованы',
          'Сборки, которые висят не в теге ' + snap.tag + ', а в одном из его '
          + 'родителей, и попали сюда наследованием. В колонке «тег» видно, '
          + 'из какого именно. Клик оставит в таблице только их.')
      + cardHtml('problem', true, c.problems,
          plural(c.problems, 'сборка', 'сборки', 'сборок'),
          c.without_patches + ' без каталога PATCH', 'с проблемами',
          'Сборки, при сборе данных по которым что-то пошло не так: нет исходника, '
          + 'GitLab ответил ошибкой, ветка исчезла. Клик оставит только их.');

    var order = classOrder(c.by_class), out = '';
    for (i = 0; i < order.length; i++) {
      var name = order[i], b = c.by_class[name];
      out += cardHtml(slug(name), false, b.builds,
        plural(b.builds, 'сборка', 'сборки', 'сборок'),
        b.files + ' ' + plural(b.files, 'файл', 'файла', 'файлов'),
        name, 'Сборки, где есть хотя бы один патч класса ' + name + ', и сколько '
        + 'таких файлов всего. Клик оставит в таблице только их.', classCls(name));
    }
    small.innerHTML = out;
  }

  function renderDiffCards() {
    var pair = curPair();
    var box = document.getElementById('diff-cards');
    if (!pair) { box.innerHTML = ''; return; }
    var c = pair.counts;
    var spec = [
      ['changed', c.changed, 'изменились',
       'Компоненты, у которых изменилось хоть что-нибудь: версия, набор патчей, '
       + 'состав RPM или ветка.'],
      ['added', c.added, 'появились', 'Компонентов не было в старом теге.'],
      ['removed', c.removed, 'исчезли', 'Компонентов нет в новом теге.'],
      ['upgraded', c.upgraded, 'версия выросла',
       'Сравнение version-release по правилам rpm.'],
      ['downgraded', c.downgraded, 'версия упала',
       'Версия в новом теге ниже, чем в старом. Обычно это откат.'],
      ['unchanged', c.unchanged, 'версия та же',
       'Version-release совпал. Патчи и состав RPM при этом могли измениться.'],
      ['patches+', c.patches_added, 'патчи пришли',
       'В каталоге PATCH появились новые файлы.'],
      ['patches-', c.patches_removed, 'патчи ушли',
       'Из каталога PATCH исчезли файлы. Стоит проверить, не потеряно ли исправление.'],
      ['repackaged', c.repackaged, 'состав RPM',
       'Компонент остался, но набор его бинарных пакетов изменился.'],
      ['branch-changed', c.branch_changed, 'сменили ветку',
       'Сборка приехала из другой ветки GitLab, чем в старом теге.'],
      ['tag-changed', c.tag_changed, 'переехали между тегами',
       'Билд теперь висит в другом koji-теге: был унаследован — стал '
       + 'затегован прямо, или наоборот. Обычное наследование сюда не '
       + 'попадает: сравнивается сам тег билда, а не то, каким он выглядит '
       + 'из выбранного.']
    ];
    var out = '';
    for (var i = 0; i < spec.length; i++) {
      out += cardHtml(spec[i][0], false, spec[i][1], 'из ' + pair.rows.length, '',
                      spec[i][2], spec[i][3] + ' Клик — фильтр.');
    }
    box.innerHTML = out;
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

  function renderChips() {
    var set = activeFilters(), list = keys(set).sort(), out = '';
    for (var i = 0; i < list.length; i++) {
      out += '<button type="button" class="chip" data-chip="' + esc(list[i]) + '"'
          + ' data-tip="Снять фильтр">' + esc(list[i]) + ' · '
          + esc(label(list[i])) + ' ✕</button>';
    }
    if (list.length > 1) {
      out += '<button type="button" class="chip clear" data-chip="all"'
          + ' data-tip="Снять все фильтры">сбросить всё</button>';
    }
    chipsBox.innerHTML = out;
  }

  /* ---------- рендер ---------- */

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

    if (!items.length) {
      body.innerHTML = '<tr><td class="empty" colspan="' + colCount(st.tab) + '">'
        + (total ? 'Под фильтры и запрос ничего не подходит'
                 : 'В этой выборке нет строк') + '</td></tr>';
    } else {
      body.innerHTML = st.tab === 'diff' ? diffRowsHtml(items) : stateRowsHtml(items);
    }
    writeHash();
  }

  /* Карточки и селекторы перерисовываются только при смене вкладки, тега или
     пары: иначе клик по карточке уничтожал бы её же вместе с фокусом. */
  function rebuild() {
    renderTagSelect();
    renderPairSelect();
    renderStateCards();
    renderDiffCards();
    render();
  }

  /* Сравнивать нечего — вкладки «Изменения» на странице нет вовсе. */
  function syncTabs() {
    for (var t = 0; t < tabBtns.length; t++) {
      if (tabBtns[t].getAttribute('data-tab') === 'diff') {
        tabBtns[t].hidden = !PAIRS.length;
      }
    }
  }

  function showTab(name) {
    if (name === 'diff' && !PAIRS.length) name = 'state';
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
    var anchor = host.querySelector('.tablewrap');
    host.insertBefore(controls, anchor);
    host.insertBefore(chipsBox, anchor);
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
    if (PAIRS.length) parts.push('pair=' + encodeURIComponent(pairKey(st.pair)));
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

  /* Токен фильтра из хеша мог устареть (тег пересобрали, класс переименовали).
     Свой мы узнаём по подписи, по классу патчей или по тегу живой строки;
     чужой молча выбрасываем, чтобы страница не показывала пустую таблицу под
     фильтр, которого не поставить и не снять — его нет ни на одной карточке. */
  function knownFilter(key) {
    var i;
    if (!key || key === 'all') return false;
    if (LABELS.hasOwnProperty(key)) return true;
    for (i = 0; i < CLASSES.length; i++) {
      if (slug(CLASSES[i]) === key) return true;
    }
    var host = st.tab === 'diff' ? curPair() : curSnap();
    var rows = host ? (st.tab === 'diff' ? host.rows : host.builds) : [];
    for (i = 0; i < rows.length; i++) {
      if (rows[i].tags.indexOf(key) !== -1) return true;
    }
    return false;
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
        /* Пар нет — вкладки «Изменения» на странице тоже нет. */
        tab = (val === 'diff' && PAIRS.length) ? 'diff' : 'state';
        if (val === 'diff' && !PAIRS.length) dropped = true;
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
        /* Не нашли такого перехода — остаёмся на паре по умолчанию.
           Форма «os-9.1..os-9.2» из одних тегов тоже принимается и по тому
           же правилу: при двойниках выигрывает последний переход. */
        for (var p = 0; p < PAIRS.length; p++) {
          if (pairKey(p) === val
              || PAIRS[p].old + '..' + PAIRS[p]['new'] === val) {
            st.pair = p;
            picked.pair = true;
          }
        }
      } else if (key === 'f') filters = val ? val.split(',') : [];
      else if (key === 'q') st.q = val.trim().toLowerCase();
      else if (key === 'sort') sort = val.split(':');
    }
    if (tab) st.tab = tab;
    /* Ссылка вела на «Изменения», но сравнивать в этом прогоне нечего. Фильтры
       из неё — диффовые; на вкладке состояния они дали бы пустую таблицу без
       единого намёка почему. */
    if (dropped) filters = null;
    if (filters) {
      var live = [];
      for (i = 0; i < filters.length; i++) {
        if (knownFilter(filters[i])) live.push(filters[i]);
      }
      st.filters[st.tab] = setFrom(live);
    }
    if (sort && sort[0]) {
      st.sort[st.tab] = { key: sort[0], asc: sort[1] !== 'desc' };
    }
    search.value = st.q;
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
        var tag = node.getAttribute('data-tag');
        if (tag !== null && tag !== undefined && node.className
            && String(node.className).indexOf('pick') !== -1) {
          st.tag = parseInt(tag, 10);
          picked.tag = true;
          renderTagSelect(); renderStateCards(); render();
          return;
        }
        var pair = node.getAttribute('data-pair');
        if (pair !== null && pair !== undefined) {
          st.pair = parseInt(pair, 10);
          picked.pair = true;
          renderPairSelect(); renderDiffCards(); render();
          return;
        }
        var tab = node.getAttribute('data-tab');
        if (tab) { showTab(tab); render(); return; }
        /* Список источников тоже перерисовывается целиком, поэтому его
           кнопки живут здесь же, а не на своих обработчиках. */
        var move = node.getAttribute('data-move');
        if (move) {
          var at = move.split(':');
          store.move(parseInt(at[0], 10), parseInt(at[1], 10));
          return;
        }
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

  search.addEventListener('input', function () {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      searchTimer = null;
      st.q = search.value.trim().toLowerCase();
      render();
    }, SEARCH_DELAY);
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
    if (readHash()) { showTab(st.tab); rebuild(); }
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
    var anchor = el.getBoundingClientRect();
    var box = tip.getBoundingClientRect();
    var left = Math.min(Math.max(8, anchor.left + (anchor.width - box.width) / 2),
                        window.innerWidth - box.width - 8);
    var top = anchor.bottom + 8;
    if (top + box.height > window.innerHeight - 8) top = anchor.top - box.height - 8;
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

  function renderSources() {
    var items = store.list(), parts = [], i;
    /* В цепочке у тегов-двойников стоит дата: «os-9.2 → os-9.2» не говорит
       человеку, что с чем сравнивается. */
    var when = whenLabels(items);
    for (i = 0; i < items.length; i++) {
      parts.push(esc(items[i].tag)
        + (when[i] ? ' <span class="when">' + esc(when[i]) + '</span>' : ''));
    }
    chainBox.innerHTML = parts.length
      ? '<span class="l">снапшоты:</span> ' + parts.join(' <span class="arrow">→</span> ')
      : '';
    var out = '';
    for (i = 0; i < items.length; i++) {
      out += '<li><span class="mono">' + esc(items[i].tag) + '</span>'
          + '<span class="sub">' + esc(items[i].generated) + ' · '
          + items[i].builds + ' ' + plural(items[i].builds, 'сборка', 'сборки', 'сборок')
          + ' · ' + esc(items[i].file) + '</span>'
          + '<button type="button" class="mini" data-move="' + i + ':-1"'
          + (i === 0 ? ' disabled' : '') + ' data-tip="Выше по цепочке">↑</button>'
          + '<button type="button" class="mini" data-move="' + i + ':1"'
          + (i === items.length - 1 ? ' disabled' : '') + ' data-tip="Ниже по цепочке">↓</button>'
          + '<button type="button" class="mini" data-drop-snap="' + i + '"'
          + ' data-tip="Убрать этот снапшот">✕</button></li>';
    }
    sourceList.innerHTML = out;
    var warns = store.warnings(), wout = '';
    for (i = 0; i < warns.length; i++) wout += '<div class="warn">' + esc(warns[i]) + '</div>';
    warningsBox.innerHTML = wout;
  }

  store.onChange(function () {
    applyData(viewmodel.buildPageData(store.snapshots()));
    renderSources();
    syncEmpty();
  });

  function showErrors(errors) {
    var out = '', i;
    for (i = 0; i < errors.length; i++) out += '<li>' + esc(errors[i]) + '</li>';
    loadErrors.innerHTML = out;
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
  addMoreBtn.addEventListener('click', openPicker);

  fileInput.addEventListener('change', function () {
    loadFiles(fileInput.files);
    /* Тот же файл, выбранный второй раз, не даёт события, пока в поле
       лежит его прежнее значение. */
    fileInput.value = '';
  });

  editBtn.addEventListener('click', function () {
    var open = sourceList.hidden;
    sourceList.hidden = !open;
    editBtn.setAttribute('aria-expanded', String(open));
  });

  function markOver(on) {
    dropZone.className = on ? 'drop over' : 'drop';
  }

  /* Ронять файл можно на всю страницу, а не только на зону: браузер по
     умолчанию открывает брошенный файл вместо страницы, и без
     preventDefault на dragover дашборд просто заменился бы содержимым JSON. */
  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    markOver(true);
  });
  document.addEventListener('dragleave', function (e) {
    /* Уход за пределы окна: внутри страницы dragleave приходит на каждой
       границе, и снимать подсветку по ним значило бы мигать ею. */
    if (!e.relatedTarget) markOver(false);
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    markOver(false);
    loadFiles(e.dataTransfer ? e.dataTransfer.files : []);
  });

  /* ---------- старт ---------- */

  /* Шапку рисует applyData, а не старт: набор снапшотов меняется на лету,
     и подпись обязана меняться вместе с ним. */
  function renderMeta() {
    var meta = document.getElementById('meta'), tags = [], i;
    /* Ничего не загружено — шапке нечего сказать. Три прочерка над зоной
       загрузки выглядели бы сломанной страницей, а не пустой. */
    if (!SNAPS.length) { meta.innerHTML = ''; return; }
    /* «теги: os-9.2, os-9.2» читается как опечатка, а не как два прогона
       одного тега, поэтому у двойников в скобках стоит время сбора. */
    var when = whenLabels(SNAPS);
    for (i = 0; i < SNAPS.length; i++) {
      tags.push(SNAPS[i].tag + (when[i] ? ' (' + when[i] + ')' : ''));
    }
    meta.innerHTML =
        '<div><b>теги:</b> ' + (tags.length ? esc(tags.join(', ')) : '—') + '</div>'
      + '<div><b>собрано:</b> ' + esc(DATA.generated || '—') + '</div>'
      + '<div><b>классы патчей:</b> ' + esc(CLASSES.join(', ') || '—') + '</div>';
  }

  (function start() {
    syncEmpty();
    renderSources();
    syncStickyOffset();
  }());

  return { applyData: applyData };
}));
