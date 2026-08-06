/* Сравнение снапшотов тегов. Порт dashboard/diff.py. */
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

  const STATUSES = ['added', 'removed', 'unchanged', 'upgraded', 'downgraded'];

  function evr(build) { return [build.epoch, build.version, build.release]; }

  function status(oldB, newB) {
    const result = vercmp.compareEvr(evr(oldB), evr(newB));
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
    const name = String(nvra);
    const tail = `-${build.version}-${build.release}.`;
    const index = name.lastIndexOf(tail);
    if (index === -1) return name;
    return `${name.slice(0, index)}.${name.slice(index + tail.length)}`;
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
    const keys = new Map();
    for (const nvra of build.rpms || []) {
      const key = rpmKey(build, nvra);
      if (!keys.has(key)) keys.set(key, []);
      keys.get(key).push(nvra);
    }
    return keys;
  }

  function rpmDelta(source, other) {
    let out = [];
    source.forEach((nvras, key) => {
      if (!other.has(key)) out = out.concat(nvras);
    });
    return out.sort();
  }

  function rpmRowPairs(left, right) {
    left = left.slice().sort();
    right = right.slice().sort();
    const rows = [];
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i += 1) {
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
    const oldKeys = oldB ? rpmKeys(oldB) : new Map();
    const newKeys = newB ? rpmKeys(newB) : new Map();

    const archSet = new Set();
    oldKeys.forEach((_v, key) => { archSet.add(rpmsmod.archOf(key)); });
    newKeys.forEach((_v, key) => { archSet.add(rpmsmod.archOf(key)); });
    const arches = Array.from(archSet).sort(rpmsmod.compareArch);

    /* Порядок внутри группы — по первому NVRA ключа: он же стоит в списке
       пакетов, и две колонки обязаны разрезаться одинаково. */
    const byFirstNvra = (map) => (a, b) => {
      const minA = map.get(a).slice().sort()[0];
      const minB = map.get(b).slice().sort()[0];
      return minA < minB ? -1 : minA > minB ? 1 : 0;
    };

    let rows = [];
    for (const arch of arches) {
      const kept = [];
      oldKeys.forEach((_v, key) => {
        if (rpmsmod.archOf(key) === arch) kept.push(key);
      });
      kept.sort(byFirstNvra(oldKeys));
      for (const key of kept) {
        rows = rows.concat(rpmRowPairs(oldKeys.get(key),
                                       newKeys.has(key) ? newKeys.get(key) : []));
      }

      const fresh = [];
      newKeys.forEach((_v, key) => {
        if (!oldKeys.has(key) && rpmsmod.archOf(key) === arch) fresh.push(key);
      });
      fresh.sort(byFirstNvra(newKeys));
      for (const key of fresh) {
        rows = rows.concat(rpmRowPairs([], newKeys.get(key)));
      }
    }
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
    const result = {};
    for (const s of STATUSES) result[s] = 0;
    result.patches_added = 0;
    result.patches_removed = 0;
    result.repackaged = 0;
    result.branch_changed = 0;
    result.tag_changed = 0;
    result.changed = 0;
    for (const component of components) {
      result[component.status] += 1;
      if (component.patches_added.length) result.patches_added += 1;
      if (component.patches_removed.length) result.patches_removed += 1;
      if (component.repackaged) result.repackaged += 1;
      if (component.branch_changed) result.branch_changed += 1;
      if (component.tag_changed) result.tag_changed += 1;
      if (component.changed) result.changed += 1;
    }
    return result;
  }

  function byName(snapshot) {
    const map = {};
    for (const b of snapshot.builds || []) map[b.name] = b;
    return map;
  }

  function setMinus(a, b) {
    const out = [];
    a.forEach((item) => { if (!b.has(item)) out.push(item); });
    return out.sort();
  }

  /* Сравнивает два снапшота по именам компонентов. */
  function diffSnapshots(oldSnap, newSnap, isSummary) {
    isSummary = Boolean(isSummary);
    const oldMap = byName(oldSnap);
    const newMap = byName(newSnap);
    const names = new Set(Object.keys(oldMap).concat(Object.keys(newMap)));

    const components = [];
    for (const name of Array.from(names).sort()) {
      const oldBuild = Object.prototype.hasOwnProperty.call(oldMap, name)
        ? oldMap[name] : null;
      const newBuild = Object.prototype.hasOwnProperty.call(newMap, name)
        ? newMap[name] : null;

      let component;
      if (oldBuild === null) {
        component = { name, status: 'added', old: null, new: newBuild,
                       patches_added: [], patches_removed: [],
                       rpms_added: [], rpms_removed: [],
                       branch_changed: false, repackaged: false,
                       tag_changed: false };
      } else if (newBuild === null) {
        component = { name, status: 'removed', old: oldBuild, new: null,
                       patches_added: [], patches_removed: [],
                       rpms_added: [], rpms_removed: [],
                       branch_changed: false, repackaged: false,
                       tag_changed: false };
      } else {
        const oldPatches = new Set((oldBuild.patches || []).map((p) => p.path));
        const newPatches = new Set((newBuild.patches || []).map((p) => p.path));
        const oldRpms = rpmKeys(oldBuild);
        const newRpms = rpmKeys(newBuild);
        const repackaged = oldRpms.size !== newRpms.size
          || Array.from(oldRpms.keys()).some((key) => !newRpms.has(key));

        component = {
          name, status: status(oldBuild, newBuild),
          old: oldBuild, new: newBuild,
          patches_added: setMinus(newPatches, oldPatches),
          patches_removed: setMinus(oldPatches, newPatches),
          rpms_added: rpmDelta(newRpms, oldRpms),
          rpms_removed: rpmDelta(oldRpms, newRpms),
          branch_changed: refOf(oldBuild) !== refOf(newBuild),
          repackaged,
          tag_changed: tagChanged(oldBuild, newBuild)
        };
      }
      component.changed = isChanged(component);
      components.push(component);
    }

    return { old_tag: oldSnap.tag, new_tag: newSnap.tag,
             is_summary: isSummary, components,
             counts: counts(components) };
  }

  /* Пары подряд идущих снапшотов плюс сводная пара первый→последний. */
  function diffChain(snapshots) {
    if (snapshots.length < 2) return [];
    const pairs = [];
    for (let i = 0; i < snapshots.length - 1; i += 1) {
      pairs.push(diffSnapshots(snapshots[i], snapshots[i + 1], false));
    }
    if (snapshots.length > 2) {
      pairs.push(diffSnapshots(snapshots[0], snapshots[snapshots.length - 1], true));
    }
    return pairs;
  }

  return { diffSnapshots, diffChain, alignRpms };
}));
