/* Строки и раскрытые детали обеих таблиц. Всё, что таблицам нужно знать о
   странице — запрос, ширина таблицы, ключ строки и её раскрытость, — приходит
   объектом opt: сами они ни состояния, ни DOM не видят. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./labels.js'),
                             require('./markup.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.tables = factory(root.KP.text, root.KP.labels, root.KP.markup);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (text, labels, markup) {
  'use strict';

  const esc = text.esc, hl = text.hl, own = text.own, setFrom = text.setFrom;
  const kv = markup.kv;

  /* Стрелка раскрытия: одна и та же в обеих таблицах, и состояние на ней
     дублируется для тех, кто читает страницу не глазами.

     Глиф один, а раскрытость показывает поворот: подмена «▸» на «▾» меняла
     ширину знака и дёргала имя компонента вправо-влево на каждом клике. */
  function chevron(open) {
    return `<span class="chev" role="button" tabindex="0"`
         + ` aria-expanded="${open ? 'true' : 'false'}">▸</span>`;
  }

  /* Подпись блока в развёрнутой строке: имя и, если есть что считать,
     счётчик сразу за ним. */
  function blockHead(title, count) {
    return `<div class="bl">${esc(title)}`
      + (count === undefined ? '' : `<span class="n">· ${count}</span>`)
      + '</div>';
  }

  function linksCell(row) {
    return `<td class="links">${markup.linkHtml(row.koji_url, 'koji')}`
         + `${markup.linkHtml(row.source_url, 'git')}</td>`;
  }

  /* Раскрытая строка — не отдельная карточка, а продолжение своей строки:
     полоса слева идёт через обе и делает из них один предмет. У сборки с
     проблемой полоса красная — та же, что метит саму строку. */
  function detailRow(cols, body, bad) {
    return `<tr class="detail-row${bad ? ' bad' : ''}">`
      + `<td colspan="${cols}">${body}</td></tr>`;
  }

  /* ---------- вкладка «Состояние» ---------- */

  function stateDetail(row, q) {
    const branch = row.branch
      ? `<span class="mono">${hl(row.branch, q)}</span>`
        + (row.ref_kind === 'commit' ? ` ${markup.markHtml('from-commit')}` : '')
      : '<span class="none">источник неизвестен</span>';
    const dir = row.patch_dir_present === true ? 'есть'
              : (row.patch_dir_present === false ? 'нет' : 'не проверялся');

    let out = '<div class="detail">'
      + `<div class="block">${blockHead('koji')}`
      + kv('NVR', `<span class="mono">${hl(row.nvr, q)}</span>`)
      + kv('основной тег', markup.mainTagHtml(row, q))
      + kv('другие теги', markup.otherTagsHtml(row, q))
      + kv('собран', row.completed
            ? hl(row.completed, q) + (row.completed.length > 10
                ? '<span class="note">МСК</span>' : '')
            : '<span class="none">—</span>')
      + kv('владелец', hl(row.owner || '—', q))
      + kv('build id', esc(row.build_id === null ? '—' : row.build_id))
      + kv('task id', esc(row.task_id === null ? '—' : row.task_id))
      + '</div>'

      + `<div class="block">${blockHead('gitlab')}`
      + kv('проект', row.project
            ? `<span class="mono">${hl(row.project, q)}</span>`
            : '<span class="none">—</span>')
      + kv('ветка', branch)
      + kv('каталог PATCH', esc(dir))
      + kv('ссылка', row.source_url
            ? markup.linkHtml(row.source_url, 'gitlab')
            : '<span class="none">—</span>')
      + '</div>'

      /* Порядок блоков — не косметика: сетка в два столбца ставит их под
         предыдущей парой, и каждый оказывается под своим источником. RPM
         приезжают из koji, патчи лежат в GitLab, поэтому RPM идут первыми
         и встают под koji, а патчи — под gitlab. */
      + `<div class="block">${blockHead('RPM', row.rpms.length)}`
      + `${markup.rpmsHtml(row.rpms, q)}</div>`

      + `<div class="block">${blockHead('патчи', row.patches.length)}`
      + `${markup.patchesHtml(row.patches, q, null, '')}</div>`;

    if (row.problems.length) {
      const items = row.problems.map((p) => `<li>${hl(p, q)}</li>`).join('');
      out += `<div class="block wide">`
           + `${blockHead('проблемы', row.problems.length)}`
           + `<ul class="problems">${items}</ul></div>`;
    }
    return `${out}</div>`;
  }

  function stateRows(items, opt) {
    const q = opt.q;
    return items.map((item) => {
      const row = item.row;
      const key = opt.keyOf(row);
      const open = opt.openOf(key, item.open);
      const bad = row.problems.length || row.marks.indexOf('no-source') !== -1;
      /* Число и полоска разведены по краям ячейки, а не стоят подряд:
         подробности — у .patcell в стилях. */
      const patches = row.patches.length
        ? `<span class="patcell">${row.patches.length}${markup.meterHtml(row)}</span>`
        : '<span class="zero">0</span>';
      const main = `<tr class="main-row${open ? ' open' : ''}`
        + `${bad ? ' bad' : ''}" data-row="${esc(key)}">`
        + `<td class="src">${chevron(open)} ${hl(row.name, q)}</td>`
        /* Версии может не быть: снапшот приходит из файла, который выбрал
           человек, и прочерк здесь честнее пустой ячейки. */
        + `<td class="ver">${row.evr ? hl(row.evr, q)
             : '<span class="none">—</span>'}</td>`
        + `<td class="tagged">${markup.taggedCell(row, q)}</td>`
        + `<td class="branch">${row.branch ? hl(row.branch, q)
             : '<span class="none">—</span>'}</td>`
        + `<td class="pat">${patches}</td>`
        + `<td class="num">${row.rpms.length}</td>`
        + `<td class="built">${markup.builtHtml(row.completed, q)}</td>`
        + `<td class="marks">${markup.marksHtml(row.marks)}</td>`
        + `${linksCell(row)}</tr>`;
      return open ? main + detailRow(opt.cols, stateDetail(row, q), bad) : main;
    }).join('');
  }

  /* ---------- вкладка «Изменения» ---------- */

  /* Одна сторона «было/стало» разбита на четыре куска, и в разметку они
     уходят парами: сперва обе шапки, потом обе сводки, потом оба списка
     патчей, потом оба списка пакетов.

     Это не украшение. Пакеты приходят из diff.js спаренными, чтобы один и
     тот же подпакет стоял слева и справа на одной высоте, — а пока каждая
     сторона шла сплошным блоком, списки начинались на разной высоте:
     патчей слева три, справа пять, и вся пара уезжала вниз на два ряда.
     Выравнивание считалось и пропадало впустую. Парами куски встают в одну
     строку сетки, и высота у них общая.

     Параметры стороны собраны в объект: их тринадцать, и позиционным
     списком такой вызов читался бы как шифровка. */
  function sideHead(s) {
    return `<div class="bl side-head">${esc(s.title)} · `
      + `<b>${esc(s.tag)}</b></div>`;
  }

  function sideFacts(s, q) {
    const tagCell = markup.taggedText(s.taggedIn, s.inherited, q);
    return '<div class="side">'
      + kv('версия', s.evr ? `<span class="mono">${hl(s.evr, q)}</span>`
                           : '<span class="none">—</span>')
      + kv('тег', s.tagChanged
            ? `<span class="${s.markCls}">${tagCell}</span>` : tagCell)
      + kv('ветка', s.branch
            ? `<span class="mono${s.branchChanged ? ` ${s.markCls}` : ''}">`
              + `${hl(s.branch, q)}</span>`
            : '<span class="none">—</span>')
      + '</div>';
  }

  function sidePatches(s, q) {
    return `<div class="side">${blockHead('патчи', s.patches.length)}`
      + `${markup.patchesHtml(s.patches, q, s.mark, s.markCls)}</div>`;
  }

  function sideRpms(s, q) {
    const count = markup.rpmSideCount(s.rpmRows, s.at);
    return `<div class="side">${blockHead('RPM', count)}`
      + `${markup.rpmSideHtml(s.rpmRows, s.at, q, s.markCls)}</div>`;
  }

  /* Имена концов приходят доводами: какая пара сейчас выбрана, знает
     страница, а не таблица. */
  function diffDetail(row, q, oldTag, newTag) {
    const branchChanged = row.marks.indexOf('branch-changed') !== -1;
    const tagChanged = row.marks.indexOf('tag-changed') !== -1;
    const common = { branch: null, rpmRows: row.rpm_rows,
                     branchChanged, tagChanged };
    const was = Object.assign({}, common,
      { title: 'было', tag: oldTag, evr: row.old_evr,
        branch: row.old_branch, taggedIn: row.old_tagged_in,
        inherited: row.old_inherited, patches: row.old_patches,
        at: 0, mark: setFrom(row.patches_removed), markCls: 'is-removed' });
    const now = Object.assign({}, common,
      { title: 'стало', tag: newTag, evr: row.new_evr,
        branch: row.new_branch, taggedIn: row.new_tagged_in,
        inherited: row.new_inherited, patches: row.new_patches,
        at: 1, mark: setFrom(row.patches_added), markCls: 'is-added' });
    return '<div class="sides">'
      + sideHead(was) + sideHead(now)
      + sideFacts(was, q) + sideFacts(now, q)
      + sidePatches(was, q) + sidePatches(now, q)
      + sideRpms(was, q) + sideRpms(now, q)
      + '</div>';
  }

  function diffRows(items, opt) {
    const q = opt.q;
    return items.map((item) => {
      const row = item.row;
      const key = opt.keyOf(row);
      const open = opt.openOf(key, item.open);
      const main = `<tr class="main-row ${esc(row.status)}`
        + `${open ? ' open' : ''}" data-row="${esc(key)}">`
        + `<td class="src">${chevron(open)} ${hl(row.name, q)}</td>`
        + `<td class="ver">${row.old_evr ? hl(row.old_evr, q) : '—'}</td>`
        + `<td class="dir">${own(labels.ARROW, row.status) || ''}</td>`
        + `<td class="ver new">${row.new_evr ? hl(row.new_evr, q) : '—'}</td>`
        + `<td class="pat">${markup.delta(row.patches_added.length,
                                          row.patches_removed.length)}</td>`
        + `<td class="pat">${markup.delta(row.rpms_added.length,
                                          row.rpms_removed.length)}</td>`
        + `<td class="marks">${markup.marksHtml(row.marks)}</td>`
        + `${linksCell(row)}</tr>`;
      return open
        ? main + detailRow(opt.cols, diffDetail(row, q, opt.oldTag, opt.newTag))
        : main;
    }).join('');
  }

  return { stateRows, diffRows, stateDetail, diffDetail };
}));
