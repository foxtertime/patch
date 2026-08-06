/* Данные страницы: снапшоты и пары, готовые к отрисовке.
   Порт dashboard/render.py (всё, кроме сборки самого HTML). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./diff.js'), require('./rpms.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.viewmodel = factory(root.KP.diff, root.KP.rpms);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (diff, rpmsmod) {
  'use strict';

  /* Снапшот приходит из файла, который выбрал человек, а store.js
     проверяет его только неглубоко — полей билда внутри может не быть
     вовсе. ui.js на «неизвестно» местами сравнивает строго (=== null,
     например у build_id и task_id): undefined мимо такой проверки
     проходит молча и печатается пустой строкой вместо прочерка.
     orNull держит этот договор — неизвестное всегда null, никогда
     undefined. Заодно тем же спасается сверка с JSON-эталоном в
     тестах: undefined пропадает из объекта при сериализации, а null
     остаётся. */
  function orNull(value) { return value === undefined ? null : value; }

  /* Ключи здешних словарей — имена классов патчей, а их задаёт конфиг. У
     голого объекта есть свойства Object.prototype, и на ключ «constructor»
     он отвечает функцией, а не «ничего нет»: счётчик тогда становится
     строкой «function Object() { [native code] }1», а класс, выведенный из
     патчей, молча пропадает из списка. Та же охрана уже стоит в
     snapshotCounts — здесь она доведена до остальных мест. */
  function own(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
  }

  function bump(counts, key) {
    counts[key] = (own(counts, key) || 0) + 1;
  }

  /* Повторяет urllib.parse.quote с safe='/': всё, кроме букв, цифр и
     _.-~/ , уходит в проценты. Своя функция, а не encodeURIComponent:
     тот экранирует «/» и не трогает «!*'()», и ссылки разъехались бы. */
  function quote(text) {
    return String(text).replace(/[^A-Za-z0-9_.\-~/]/g, (ch) => {
      let code = ch.charCodeAt(0), out = '', bytes, i;
      if (code < 128) return '%' + ('0' + code.toString(16).toUpperCase()).slice(-2);
      bytes = unescape(encodeURIComponent(ch));
      for (i = 0; i < bytes.length; i++) {
        out += '%' + ('0' + bytes.charCodeAt(i).toString(16).toUpperCase()).slice(-2);
      }
      return out;
    });
  }

  /* Снапшот приходит из файла, который выбрал человек, а не только из
     питоновской модели: в нём может не быть ни nvr, ни version с release.
     Неизвестное остаётся null и рисуется прочерком — ссылка на поиск по
     «undefined» и версия «undefined-undefined» выдавали бы незнание за
     данные. Проверка живёт здесь, а не в загрузчике: через viewmodel
     проходит любой снапшот, какой бы файл человек ни подгрузил. */
  function kojiUrl(kojiWeb, nvr) {
    if (!kojiWeb || nvr === null || nvr === undefined || nvr === '') {
      return null;
    }
    return String(kojiWeb).replace(/\/+$/, '')
      + '/search?match=exact&type=build&terms=' + quote(nvr);
  }

  function missing(value) { return value === null || value === undefined; }

  function evrOf(build) {
    if (missing(build.version) || missing(build.release)) return null;
    const prefix = build.epoch ? build.epoch + ':' : '';
    return prefix + build.version + '-' + build.release;
  }

  /* То же правило, что и slug() в дашборде: ключ фильтра из имени класса
     патчей. Считать его по-разному на двух сторонах нельзя — карточка
     класса вроде «C++» не нашла бы ни одной строки. */
  function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  /* Москва — UTC+3 круглый год: перехода на летнее время в России нет с
     2014, поэтому смещение задано числом, а не через часовые пояса.
     Дата без часа не переводится: прибавив три часа к неизвестному
     времени, мы бы утверждали то, чего не знаем. */
  const MSK_SHIFT_MS = 3 * 60 * 60 * 1000;
  const STAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* Через Date.UTC, а не через локальный конструктор Date: иначе к
     смещению примешался бы пояс машины, на которой открыт дашборд. */
  function toMsk(value) {
    if (!value || String(value).length <= 10) return value === undefined ? null : value;
    const m = STAMP.exec(String(value));
    if (!m) return value;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + MSK_SHIFT_MS;
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-'
      + pad(d.getUTCDate()) + ' ' + pad(d.getUTCHours()) + ':'
      + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
  }

  /* Унаследован ли билд в этот тег. null — тег билда неизвестен.
     Неизвестность отдельным значением, а не false: снапшот прежней версии
     не знает про tag_name, и объявить такие билды прямыми значило бы
     показать в дашборде утверждение, которого никто не проверял. */
  function inheritedIn(build, tag) {
    if (build.tag_name === null || build.tag_name === undefined || !tag) {
      return null;
    }
    return build.tag_name !== tag;
  }

  /* Порядок меток состояния после классов патчей. Он же порядок в колонке
     «метки»: сперва откуда билд, потом что не так с патчами, потом ошибки. */
  const STATE_TAG_ORDER = ['inherited', 'no-source', 'from-commit', 'no-patch',
                           'gitlab-error', 'internal-error'];

  /* Позиция метки в строке. Классы патчей идут первыми, в порядке списка
     классов — том же, в каком стоят карточки классов. */
  function tagSortKey(tag, classOrder) {
    if (classOrder.indexOf(tag) !== -1) return [0, classOrder.indexOf(tag), ''];
    if (STATE_TAG_ORDER.indexOf(tag) !== -1) {
      return [1, STATE_TAG_ORDER.indexOf(tag), ''];
    }
    return [2, 0, tag];
  }

  function compareKeys(a, b) {
    let i;
    for (i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }

  /* Метки строки, всегда в одном и том же порядке.

     Порядок здесь позиционный: колонку «метки» читают по месту, а порядок
     файлов в каталоге PATCH задаёт GitLab и он разный от репозитория к
     репозиторию. Без сортировки у одной строки первым стоял бы cve, у
     соседней sast, и колонка перестала бы читаться. */
  function buildMarks(build, tag, classOrder) {
    classOrder = classOrder || [];
    let marks = [], patches = build.patches || [], problems = build.problems || [];
    let i, key, gitlabError = false, internalError = false;
    for (i = 0; i < patches.length; i++) {
      key = slug(patches[i]['class']);
      if (marks.indexOf(key) === -1) marks.push(key);
    }
    if (inheritedIn(build, tag)) marks.push('inherited');
    if (!build.source) marks.push('no-source');
    else if (build.source.ref_kind === 'commit') marks.push('from-commit');
    if (build.patch_dir_present === false) marks.push('no-patch');
    for (i = 0; i < problems.length; i++) {
      if (problems[i].indexOf('gitlab:') === 0
          || problems[i].indexOf('bad source') === 0) gitlabError = true;
      if (problems[i].indexOf('internal error') === 0) internalError = true;
    }
    if (gitlabError) marks.push('gitlab-error');
    if (internalError) marks.push('internal-error');
    return marks.sort((a, b) => {
      return compareKeys(tagSortKey(a, classOrder), tagSortKey(b, classOrder));
    });
  }

  function patchDict(patch) {
    return { path: orNull(patch.path), name: orNull(patch.name),
             'class': orNull(patch['class']), cves: (patch.cves || []).slice(),
             url: orNull(patch.web_url) };
  }

  function patchDicts(patches) {
    let out = [], i;
    for (i = 0; i < patches.length; i++) out.push(patchDict(patches[i]));
    return out;
  }

  function buildRow(build, kojiWeb, tag, classOrder) {
    let counts = {}, patches = build.patches || [], i;
    for (i = 0; i < patches.length; i++) bump(counts, patches[i]['class']);
    let source = build.source || null;
    return {
      name: orNull(build.name), nvr: orNull(build.nvr),
      version: orNull(build.version), release: orNull(build.release),
      evr: evrOf(build),
      branch: source ? orNull(source.ref) : null,
      ref_kind: source ? orNull(source.ref_kind) : 'none',
      project: source ? orNull(source.project) : null,
      source_url: source ? orNull(source.web_url) : null,
      koji_url: kojiUrl(kojiWeb, build.nvr),
      completed: toMsk(build.completed), owner: orNull(build.owner),
      build_id: orNull(build.build_id), task_id: orNull(build.task_id),
      // koji_tags — это теги koji, а marks рядом — метки строки,
      // которые страница считает сама; путать их нельзя, оттого и разные
      // имена
      tagged_in: orNull(build.tag_name), inherited: inheritedIn(build, tag),
      koji_tags: (build.tags || []).slice(),
      patches: patchDicts(patches),
      // порядок задаём здесь: дашборд режет список на блоки по смене
      // архитектуры и сам ничего не пересортировывает
      patch_counts: counts, rpms: rpmsmod.sortRpms(build.rpms || []),
      patch_dir_present: orNull(build.patch_dir_present),
      problems: (build.problems || []).slice(),
      marks: buildMarks(build, tag, classOrder)
    };
  }

  function snapshotCounts(rows, classNames) {
    let byClass = {}, i, name, row, counts, bucket;
    for (i = 0; i < classNames.length; i++) {
      byClass[classNames[i]] = { builds: 0, files: 0 };
    }
    let withPatches = 0, withoutPatches = 0, problems = 0, files = 0;
    let inherited = 0, direct = 0;
    for (i = 0; i < rows.length; i++) {
      row = rows[i];
      if (row.inherited === true) inherited += 1;
      else if (row.inherited === false) direct += 1;
      if (row.patches.length) withPatches += 1;
      if (row.patch_dir_present === false) withoutPatches += 1;
      if (row.problems.length) problems += 1;
      files += row.patches.length;
      counts = row.patch_counts;
      for (name in counts) {
        if (!Object.prototype.hasOwnProperty.call(counts, name)) continue;
        if (!Object.prototype.hasOwnProperty.call(byClass, name)) {
          byClass[name] = { builds: 0, files: 0 };
        }
        bucket = byClass[name];
        bucket.builds += 1;
        bucket.files += counts[name];
      }
    }
    return { builds: rows.length, with_patches: withPatches,
             inherited: inherited, direct: direct,
             without_patches: withoutPatches, problems: problems,
             patch_files: files, by_class: byClass };
  }

  function diffMarks(component) {
    const marks = [component.status];
    if (component.repackaged) marks.push('repackaged');
    if (component.patches_added.length) marks.push('patches+');
    if (component.patches_removed.length) marks.push('patches-');
    if (component.branch_changed) marks.push('branch-changed');
    if (component.tag_changed) marks.push('tag-changed');
    return marks;
  }

  function diffRow(component, kojiWeb, oldTag, newTag) {
    const old = component.old || null, fresh = component['new'] || null;
    const shown = fresh || old;
    return {
      old_tagged_in: old ? orNull(old.tag_name) : null,
      new_tagged_in: fresh ? orNull(fresh.tag_name) : null,
      old_inherited: old ? inheritedIn(old, oldTag) : null,
      new_inherited: fresh ? inheritedIn(fresh, newTag) : null,
      name: component.name, status: component.status,
      changed: Boolean(component.changed),
      old_evr: old ? evrOf(old) : null,
      new_evr: fresh ? evrOf(fresh) : null,
      old_branch: (old && old.source) ? orNull(old.source.ref) : null,
      new_branch: (fresh && fresh.source) ? orNull(fresh.source.ref) : null,
      patches_added: component.patches_added.slice(),
      patches_removed: component.patches_removed.slice(),
      rpms_added: component.rpms_added.slice(),
      rpms_removed: component.rpms_removed.slice(),
      old_patches: patchDicts(old ? (old.patches || []) : []),
      new_patches: patchDicts(fresh ? (fresh.patches || []) : []),
      // выровненные строки «было/стало» вместо двух отдельных списков:
      // так один и тот же подпакет стоит в обеих колонках на одной высоте,
      // и NVRA не дублируются в данных страницы
      rpm_rows: diff.alignRpms(old, fresh),
      // Своё у каждой стороны: раскрытая строка показывает не сравнение, а
      // две карточки одной сборки, и «кто собрал» с «когда» у них разные.
      old_owner: old ? orNull(old.owner) : null,
      new_owner: fresh ? orNull(fresh.owner) : null,
      old_completed: old ? toMsk(old.completed) : null,
      new_completed: fresh ? toMsk(fresh.completed) : null,
      old_project: (old && old.source) ? orNull(old.source.project) : null,
      new_project: (fresh && fresh.source) ? orNull(fresh.source.project) : null,
      old_koji_url: old ? kojiUrl(kojiWeb, old.nvr) : null,
      new_koji_url: fresh ? kojiUrl(kojiWeb, fresh.nvr) : null,
      old_source_url: (old && old.source) ? orNull(old.source.web_url) : null,
      new_source_url: (fresh && fresh.source)
        ? orNull(fresh.source.web_url) : null,
      // Ссылки строки — одной стороны, той, что показана в таблице: колонка
      // «ссылки» ведёт к тому билду, о котором строка и рассказывает.
      koji_url: shown ? kojiUrl(kojiWeb, shown.nvr) : null,
      source_url: (shown && shown.source) ? orNull(shown.source.web_url) : null,
      marks: diffMarks(component)
    };
  }

  /* Порядок классов задаёт и карточки, и метки в строке. Берём его из
     снапшота: конфига у дашборда нет. Первый снапшот задаёт порядок,
     остальные могут только дописать в конец то, чего в нём не было.
     Снапшот прежней версии списка не несёт — тогда выводим классы из
     самих патчей по алфавиту: выдумывать порядок конфига нельзя. */
  function patchClassesOf(snapshots) {
    let out = [], i, j, list;
    for (i = 0; i < snapshots.length; i++) {
      list = snapshots[i].patch_classes || [];
      for (j = 0; j < list.length; j++) {
        if (out.indexOf(list[j]) === -1) out.push(list[j]);
      }
    }
    if (out.length) return out;
    let seen = {}, derived = [], builds, patches, k;
    for (i = 0; i < snapshots.length; i++) {
      builds = snapshots[i].builds || [];
      for (j = 0; j < builds.length; j++) {
        patches = builds[j].patches || [];
        for (k = 0; k < patches.length; k++) {
          if (!own(seen, patches[k]['class'])) {
            seen[patches[k]['class']] = 1;
            derived.push(patches[k]['class']);
          }
        }
      }
    }
    return derived.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }

  /* Снапшот по имени тега. Тег не уникален: два прогона одного тега —
     штатный случай (дашборд для того и открывает несколько файлов), и тогда
     сюда попадает первый совпавший, а не тот, который сравнивает пара. */
  function snapshotByTag(snapshots, tag) {
    let i;
    for (i = 0; i < snapshots.length; i++) {
      if (snapshots[i].tag === tag) return snapshots[i];
    }
    return null;
  }

  function pairBlock(pair, snapshots) {
    const oldSnap = snapshotByTag(snapshots, pair.old_tag);
    const newSnap = snapshotByTag(snapshots, pair.new_tag);
    let rows = [], i, component, source;
    for (i = 0; i < pair.components.length; i++) {
      component = pair.components[i];
      /* Расхождение с render.py, где хаб брался у первого снапшота: адрес
         koji берём у той стороны пары, из которой пришёл показанный билд.
         За один прогон это одно и то же, но дашборд умеет открыть файлы
         разных прогонов, и тогда общий адрес вёл бы на чужой хаб.

         Сторону ищем по имени тега, а два прогона одного тега — законный
         случай, и адрес тогда берётся у первого прогона с таким тегом,
         то есть может оказаться чужим. Заметно это только когда у прогонов
         разный koji_web; предупреждения на это нет — хранилище сравнивает
         koji_hub, а не koji_web. Чинить это здесь нечем: пара приходит
         названной тегами, и починка меняет данные страницы, а с ними и
         питоновский эталон. */
      source = component['new'] ? newSnap : oldSnap;
      rows.push(diffRow(component, source ? source.koji_web : null,
                        pair.old_tag, pair.new_tag));
    }
    /* Счётчики копируем: в данных страницы не должно остаться ссылки на
       внутренний объект пары — правка одного молча меняла бы другое. */
    let counts = {}, key;
    for (key in pair.counts) {
      if (Object.prototype.hasOwnProperty.call(pair.counts, key)) {
        counts[key] = pair.counts[key];
      }
    }
    return { old: pair.old_tag, 'new': pair.new_tag,
             summary: Boolean(pair.is_summary),
             counts: counts, rows: rows };
  }

  /* Собирает всё, что нужно странице, в один сериализуемый объект.
     Пары считаются здесь же, а не приходят снаружи, как в render.py: у
     дашборда на входе только сами снапшоты. */
  function buildPageData(snapshots) {
    snapshots = snapshots || [];
    const classNames = patchClassesOf(snapshots);
    // метки классов в строке — те же slug'и, что и ключи карточек классов
    let classOrder = [], i;
    for (i = 0; i < classNames.length; i++) classOrder.push(slug(classNames[i]));

    const blocks = [];
    for (i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      // порядок билдов в снапшоте не гарантирован — сортируем здесь
      const rows = (snap.builds || []).map((b) => {
        return buildRow(b, snap.koji_web, snap.tag, classOrder);
      }).sort((a, b) => {
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
      blocks.push({ tag: orNull(snap.tag), generated: orNull(snap.generated),
                    koji_web: snap.koji_web || null,
                    counts: snapshotCounts(rows, classNames), builds: rows });
    }

    const pairs = [];
    const chain = diff.diffChain(snapshots);
    for (i = 0; i < chain.length; i++) {
      pairs.push(pairBlock(chain[i], snapshots));
    }

    return { generated: snapshots.length ? orNull(snapshots[0].generated) : '',
             patch_classes: classNames, snapshots: blocks, pairs: pairs };
  }

  return { buildPageData: buildPageData, slug: slug, toMsk: toMsk,
           patchClassesOf: patchClassesOf, pairBlock: pairBlock };
}));
