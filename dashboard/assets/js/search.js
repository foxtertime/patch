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

  function scanState(row, q) {
    if (!q) return { show: true, deep: false };
    /* Видимое в самой строке — мелкое совпадение: разворачивать её незачем,
       человек и так видит, за что она попала в выдачу. Владелец и время
       сборки билда стоят в своих колонках, поэтому они здесь, а не ниже. */
    const shallow = has(row.name, q) || has(row.nvr, q) || has(row.branch, q)
               || has(row.evr, q) || has(row.tagged_in, q)
               || has(row.owner, q) || has(row.completed, q);
    let deep = has(row.project, q);
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
    /* Ghost-патчи — то самое место, где живёт «влито в ветку, не
       собрано»: без них запрос по имени CVE не находил бы строку вовсе,
       хотя вопрос дашборда патчей CVE как раз «какие пакеты его ещё
       ждут». Секция ghost-ов лежит в раскрытии, поэтому совпадение здесь
       тоже глубокое — строка обязана открыться, а не просто остаться в
       выдаче. */
    for (i = 0; !deep && i < (row.ghosts || []).length; i++) {
      p = row.ghosts[i];
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

  return { scanState: scanState, scanDiff: scanDiff };
}));
