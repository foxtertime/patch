/* Сравнение снапшотов тегов. Порт kojipatch/diff.py. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vercmp.js'), require('./rpms.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.diff = factory(root.KP.vercmp, root.KP.rpms);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (vercmp, rpmsmod) {
  'use strict';

  var STATUSES = ['added', 'removed', 'unchanged', 'upgraded', 'downgraded'];

  function evr(build) { return [build.epoch, build.version, build.release]; }

  function status(oldB, newB) {
    var result = vercmp.compareEvr(evr(oldB), evr(newB));
    if (result === 0) return 'unchanged';
    return result < 0 ? 'upgraded' : 'downgraded';
  }

  function refOf(build) {
    return (build && build.source) ? build.source.ref : null;
  }

  /* Один и тот же билд переехал между тегами.
   *
   * Три оговорки, каждая — против ложной пометки.
   *
   * Сравниваем сам tag_name, а не «прямой/унаследованный»: второе зависит от
   * того, какой тег мы сейчас смотрим. Когда os-9.2 наследует os-9.1,
   * нетронутый билд в старом снапшоте прямой, а в новом унаследованный — и
   * такое сравнение пометило бы переездом полтега.
   *
   * Сравниваем только при совпадающем NVR. Обновлённый компонент — это
   * другой билд, и лежать в другом теге для него нормально; про него всё уже
   * сказано меткой upgraded. Переезд интересен ровно тогда, когда сам билд
   * остался прежним: значит, его вытащили из родительского тега и затеговали
   * напрямую (или наоборот).
   *
   * Неизвестный тег (снапшот прежней версии) сравнивать не с чем: молчим.
   */
  function tagChanged(oldB, newB) {
    if (oldB.tag_name === null || oldB.tag_name === undefined
        || newB.tag_name === null || newB.tag_name === undefined) {
      return false;
    }
    if (oldB.nvr !== newB.nvr) return false;
    return oldB.tag_name !== newB.tag_name;
  }

  /* Ключ подпакета для сравнения: name.arch, без version-release.
   *
   * Сравнивать надо состав подпакетов, а не версии: иначе любое обновление
   * компонента выглядит как «состав RPM изменился». Все подпакеты одного
   * билда несут его же version-release, поэтому вырезать их из NVRA
   * надёжно.
   */
  function rpmKey(build, nvra) {
    /* String(), а не сам nvra: снапшот приходит из файла, который выбрал
       человек, и store.js проверяет его неглубоко — в rpms может лежать
       что угодно. Падение здесь случалось бы внутри store.add, а его
       откат отверг бы файл, принесённый вторым, тогда как виноват был бы
       первый, уже стоящий в цепочке. Ключ и так строка по смыслу. */
    var name = String(nvra);
    var tail = '-' + build.version + '-' + build.release + '.';
    var index = name.lastIndexOf(tail);
    if (index === -1) return name;
    return name.slice(0, index) + '.' + name.slice(index + tail.length);
  }

  /* Ключ подпакета → NVRA, под которыми он встретился в снапшоте.
   *
   * В снапшоте остаётся полный NVRA (так требует модель), поэтому наружу
   * отдаём именно его: строки в rpms_added/rpms_removed должны совпадать со
   * строками в old_rpms/new_rpms, по которым дашборд красит «было/стало».
   *
   * Map, а не объект: в alignRpms перебор идёт в порядке вставки, и
   * целочисленные ключи объекта его бы нарушили.
   */
  function rpmKeys(build) {
    var keys = new Map();
    var rpms = build.rpms || [];
    for (var i = 0; i < rpms.length; i += 1) {
      var nvra = rpms[i];
      var key = rpmKey(build, nvra);
      if (!keys.has(key)) keys.set(key, []);
      keys.get(key).push(nvra);
    }
    return keys;
  }

  function rpmDelta(source, other) {
    var out = [];
    source.forEach(function (nvras, key) {
      if (!other.has(key)) out = out.concat(nvras);
    });
    return out.sort();
  }

  function rpmRowPairs(left, right) {
    left = left.slice().sort();
    right = right.slice().sort();
    var rows = [];
    var max = Math.max(left.length, right.length);
    for (var i = 0; i < max; i += 1) {
      rows.push([i < left.length ? left[i] : null,
                 i < right.length ? right[i] : null]);
    }
    return rows;
  }

  /* Строки «было/стало» по подпакетам: одна строка — один подпакет.
   *
   * Один и тот же подпакет должен стоять слева и справа на одной высоте,
   * иначе версии не сравнить глазами. Строки собираются по ключу
   * (name.arch), а не по NVRA: NVRA несёт версию билда и с обновлением
   * меняется целиком. Пропавший подпакет остаётся на своём месте с пустой
   * правой ячейкой; пришедший уходит вниз своей группы, чтобы не сдвигать
   * всё, что стоит выше.
   *
   * Строки идут группами по архитектуре, в порядке compareArch. Дашборд
   * рисует блоки, просто разрезая список по смене архитектуры, — поэтому
   * порядок задаётся здесь, один раз и сразу для обеих колонок.
   */
  function alignRpms(oldB, newB) {
    var oldKeys = oldB ? rpmKeys(oldB) : new Map();
    var newKeys = newB ? rpmKeys(newB) : new Map();

    var archSet = new Set();
    oldKeys.forEach(function (_v, key) { archSet.add(rpmsmod.archOf(key)); });
    newKeys.forEach(function (_v, key) { archSet.add(rpmsmod.archOf(key)); });
    var arches = Array.from(archSet).sort(rpmsmod.compareArch);

    var rows = [];
    arches.forEach(function (arch) {
      var kept = [];
      oldKeys.forEach(function (_v, key) {
        if (rpmsmod.archOf(key) === arch) kept.push(key);
      });
      kept.sort(function (a, b) {
        var minA = oldKeys.get(a).slice().sort()[0];
        var minB = oldKeys.get(b).slice().sort()[0];
        return minA < minB ? -1 : minA > minB ? 1 : 0;
      });
      kept.forEach(function (key) {
        rows = rows.concat(rpmRowPairs(oldKeys.get(key),
                                        newKeys.has(key) ? newKeys.get(key) : []));
      });

      var fresh = [];
      newKeys.forEach(function (_v, key) {
        if (!oldKeys.has(key) && rpmsmod.archOf(key) === arch) fresh.push(key);
      });
      fresh.sort(function (a, b) {
        var minA = newKeys.get(a).slice().sort()[0];
        var minB = newKeys.get(b).slice().sort()[0];
        return minA < minB ? -1 : minA > minB ? 1 : 0;
      });
      fresh.forEach(function (key) {
        rows = rows.concat(rpmRowPairs([], newKeys.get(key)));
      });
    });
    return rows;
  }

  function isChanged(component) {
    return Boolean(component.status !== 'unchanged'
                   || component.patches_added.length
                   || component.patches_removed.length
                   || component.repackaged
                   || component.branch_changed
                   || component.tag_changed);
  }

  function counts(components) {
    var result = {};
    STATUSES.forEach(function (s) { result[s] = 0; });
    result.patches_added = 0;
    result.patches_removed = 0;
    result.repackaged = 0;
    result.branch_changed = 0;
    result.tag_changed = 0;
    result.changed = 0;
    components.forEach(function (component) {
      result[component.status] += 1;
      if (component.patches_added.length) result.patches_added += 1;
      if (component.patches_removed.length) result.patches_removed += 1;
      if (component.repackaged) result.repackaged += 1;
      if (component.branch_changed) result.branch_changed += 1;
      if (component.tag_changed) result.tag_changed += 1;
      if (component.changed) result.changed += 1;
    });
    return result;
  }

  function byName(snapshot) {
    var map = {};
    (snapshot.builds || []).forEach(function (b) { map[b.name] = b; });
    return map;
  }

  function setMinus(a, b) {
    var out = [];
    a.forEach(function (item) { if (!b.has(item)) out.push(item); });
    return out.sort();
  }

  /* Сравнивает два снапшота по именам компонентов. */
  function diffSnapshots(oldSnap, newSnap, isSummary) {
    isSummary = Boolean(isSummary);
    var oldMap = byName(oldSnap);
    var newMap = byName(newSnap);
    var names = new Set(Object.keys(oldMap).concat(Object.keys(newMap)));
    var sortedNames = Array.from(names).sort();

    var components = [];
    sortedNames.forEach(function (name) {
      var oldBuild = Object.prototype.hasOwnProperty.call(oldMap, name)
        ? oldMap[name] : null;
      var newBuild = Object.prototype.hasOwnProperty.call(newMap, name)
        ? newMap[name] : null;

      var component;
      if (oldBuild === null) {
        component = { name: name, status: 'added', old: null, new: newBuild,
                       patches_added: [], patches_removed: [],
                       rpms_added: [], rpms_removed: [],
                       branch_changed: false, repackaged: false,
                       tag_changed: false };
      } else if (newBuild === null) {
        component = { name: name, status: 'removed', old: oldBuild, new: null,
                       patches_added: [], patches_removed: [],
                       rpms_added: [], rpms_removed: [],
                       branch_changed: false, repackaged: false,
                       tag_changed: false };
      } else {
        var oldPatches = new Set((oldBuild.patches || []).map(function (p) { return p.path; }));
        var newPatches = new Set((newBuild.patches || []).map(function (p) { return p.path; }));
        var oldRpms = rpmKeys(oldBuild);
        var newRpms = rpmKeys(newBuild);
        var repackaged = oldRpms.size !== newRpms.size
          || Array.from(oldRpms.keys()).some(function (key) { return !newRpms.has(key); });

        component = {
          name: name, status: status(oldBuild, newBuild),
          old: oldBuild, new: newBuild,
          patches_added: setMinus(newPatches, oldPatches),
          patches_removed: setMinus(oldPatches, newPatches),
          rpms_added: rpmDelta(newRpms, oldRpms),
          rpms_removed: rpmDelta(oldRpms, newRpms),
          branch_changed: refOf(oldBuild) !== refOf(newBuild),
          repackaged: repackaged,
          tag_changed: tagChanged(oldBuild, newBuild)
        };
      }
      component.changed = isChanged(component);
      components.push(component);
    });

    return { old_tag: oldSnap.tag, new_tag: newSnap.tag,
             is_summary: isSummary, components: components,
             counts: counts(components) };
  }

  /* Пары подряд идущих снапшотов плюс сводная пара первый→последний. */
  function diffChain(snapshots) {
    if (snapshots.length < 2) return [];
    var pairs = [];
    for (var i = 0; i < snapshots.length - 1; i += 1) {
      pairs.push(diffSnapshots(snapshots[i], snapshots[i + 1], false));
    }
    if (snapshots.length > 2) {
      pairs.push(diffSnapshots(snapshots[0], snapshots[snapshots.length - 1], true));
    }
    return pairs;
  }

  return { diffSnapshots: diffSnapshots, diffChain: diffChain,
           alignRpms: alignRpms };
}));
