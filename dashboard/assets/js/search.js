/* Поиск по строке таблицы: совпало ли и достаточно ли этого совпадения,
   чтобы строку не разворачивать.

   Поиск идёт и по видимым полям строки, и по её деталям. Если совпало
   только в деталях, строка не просто остаётся — она сразу разворачивается,
   иначе непонятно, почему она в выдаче.

   Ни состояния страницы, ни DOM здесь нет: строка и запрос приходят
   доводами, а решает, что делать с ответом, page.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.search = factory(root.KP.text);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (text) => {
  'use strict';

  const has = text.has;

  /* Есть ли совпадение в этом списке патчей: имя, путь, класс или любой из
     CVE. Один обход на три места — патчи билда, ghost-патчи и обе стороны
     диффа. Списки разные, правило одно, и записано оно теперь один раз. */
  function patchesHit(list, q) {
    for (const p of list || []) {
      if (has(p.name, q) || has(p.path, q) || has(p['class'], q)) return true;
      for (const cve of p.cves || []) {
        if (has(cve, q)) return true;
      }
    }
    return false;
  }

  function scanState(row, q) {
    if (!q) return { show: true, deep: false };
    /* Видимое в самой строке — мелкое совпадение: разворачивать её незачем,
       человек и так видит, за что она попала в выдачу. Владелец и время
       сборки билда стоят в своих колонках, поэтому они здесь, а не ниже. */
    const shallow = has(row.name, q) || has(row.nvr, q) || has(row.branch, q)
               || has(row.evr, q) || has(row.tagged_in, q)
               || has(row.owner, q) || has(row.completed, q);
    /* Ghost-патчи — то самое место, где живёт «влито в ветку, не собрано»:
       без них запрос по имени CVE не находил бы строку вовсе, хотя вопрос
       дашборда патчей CVE как раз «какие пакеты его ещё ждут». Секция
       ghost-ов лежит в раскрытии, поэтому совпадение здесь тоже глубокое —
       строка обязана открыться, а не просто остаться в выдаче. */
    const deep = has(row.project, q)
              || (row.koji_tags || []).some((t) => has(t, q))
              || patchesHit(row.patches, q)
              || patchesHit(row.ghosts, q)
              || row.rpms.some((r) => has(r, q))
              || row.problems.some((p) => has(p, q));
    return { show: shallow || deep, deep: !shallow && deep };
  }

  function scanDiff(row, q) {
    if (!q) return { show: true, deep: false };
    const shallow = has(row.name, q) || has(row.old_evr, q)
                 || has(row.new_evr, q);
    const deep = has(row.old_branch, q) || has(row.new_branch, q)
              || has(row.old_tagged_in, q) || has(row.new_tagged_in, q)
              || patchesHit(row.old_patches, q)
              || patchesHit(row.new_patches, q)
              || row.rpm_rows.some((pair) => (pair[0] && has(pair[0], q))
                                          || (pair[1] && has(pair[1], q)));
    return { show: shallow || deep, deep: !shallow && deep };
  }

  return { scanState: scanState, scanDiff: scanDiff };
}));
