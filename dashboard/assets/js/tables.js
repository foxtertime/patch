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

  var esc = text.esc, hl = text.hl, own = text.own, setFrom = text.setFrom;
  var kv = markup.kv;

  /* ---------- вкладка «Состояние» ---------- */

  function stateDetail(row, q) {
    var out = '<div class="detail">';

    out += '<div class="block"><div class="bl">koji</div>'
        + kv('NVR', '<span class="mono">' + hl(row.nvr, q) + '</span>')
        + kv('основной тег', markup.mainTagHtml(row, q))
        + kv('другие теги', markup.otherTagsHtml(row, q))
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
        + (row.ref_kind === 'commit' ? ' ' + markup.markHtml('from-commit') : '')
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
              ? markup.linkHtml(row.source_url, 'gitlab')
              : '<span class="none">—</span>')
        + '</div>';

    /* Порядок блоков — не косметика: сетка в два столбца ставит их под
       предыдущей парой, и каждый оказывается под своим источником. RPM
       приезжают из koji, патчи лежат в GitLab, поэтому RPM идут первыми
       и встают под koji, а патчи — под gitlab. */
    out += '<div class="block"><div class="bl">RPM · ' + row.rpms.length
        + '</div>' + markup.rpmsHtml(row.rpms, q) + '</div>';

    out += '<div class="block"><div class="bl">патчи · ' + row.patches.length
        + '</div>' + markup.patchesHtml(row.patches, q, null, '') + '</div>';

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

  function stateRows(items, opt) {
    var q = opt.q, html = '', i, cols = opt.cols;
    for (i = 0; i < items.length; i++) {
      var row = items[i].row;
      var key = opt.keyOf(row);
      var open = opt.openOf(key, items[i].open);
      var bad = row.problems.length || row.marks.indexOf('no-source') !== -1;
      /* Число и полоска разведены по краям ячейки, а не стоят подряд:
         подробности — у .patcell в стилях. */
      var patches = row.patches.length
        ? '<span class="patcell">' + row.patches.length
          + markup.meterHtml(row) + '</span>'
        : '<span class="zero">0</span>';
      html += '<tr class="main-row' + (bad ? ' bad' : '') + '" data-row="' + esc(key) + '">'
           + '<td class="src"><span class="chev" role="button" tabindex="0"'
           + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
           + (open ? '▾' : '▸') + '</span> ' + hl(row.name, q) + '</td>'
           /* Версии может не быть: снапшот приходит из файла, который выбрал
              человек, и прочерк здесь честнее пустой ячейки. */
           + '<td class="ver">' + (row.evr ? hl(row.evr, q)
                : '<span class="none">—</span>') + '</td>'
           + '<td class="tagged">' + markup.taggedCell(row, q) + '</td>'
           + '<td class="branch">' + (row.branch ? hl(row.branch, q)
                : '<span class="none">—</span>') + '</td>'
           + '<td class="pat">' + patches + '</td>'
           + '<td class="num">' + row.rpms.length + '</td>'
           + '<td class="built">' + markup.builtHtml(row.completed, q) + '</td>'
           + '<td class="marks">' + markup.marksHtml(row.marks) + '</td>'
           + '<td class="links">' + markup.linkHtml(row.koji_url, 'koji')
           + markup.linkHtml(row.source_url, 'git') + '</td></tr>';
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
        + markup.taggedText(s.taggedIn, s.inherited, q) + '</span>'
      : markup.taggedText(s.taggedIn, s.inherited, q));
    out += kv('ветка', s.branch
      ? '<span class="mono' + (s.branchChanged ? ' ' + s.markCls : '') + '">'
        + hl(s.branch, q) + '</span>'
      : '<span class="none">—</span>');
    out += '<div class="bl" style="margin-top:.7rem">патчи · ' + s.patches.length
        + '</div>' + markup.patchesHtml(s.patches, q, s.mark, s.markCls);
    out += '<div class="bl" style="margin-top:.7rem">RPM · '
        + markup.rpmSideCount(s.rpmRows, s.at)
        + '</div>' + markup.rpmSideHtml(s.rpmRows, s.at, q, s.markCls);
    return out + '</div>';
  }

  /* Имена концов приходят доводами: какая пара сейчас выбрана, знает
     страница, а не таблица. */
  function diffDetail(row, q, oldTag, newTag) {
    var branchChanged = row.marks.indexOf('branch-changed') !== -1;
    var tagChanged = row.marks.indexOf('tag-changed') !== -1;
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

  function diffRows(items, opt) {
    var q = opt.q, html = '', i, cols = opt.cols;
    for (i = 0; i < items.length; i++) {
      var row = items[i].row;
      var key = opt.keyOf(row);
      var open = opt.openOf(key, items[i].open);
      html += '<tr class="main-row ' + esc(row.status) + '" data-row="' + esc(key) + '">'
           + '<td class="src"><span class="chev" role="button" tabindex="0"'
           + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
           + (open ? '▾' : '▸') + '</span> ' + hl(row.name, q) + '</td>'
           + '<td class="ver">' + (row.old_evr ? hl(row.old_evr, q) : '—') + '</td>'
           + '<td class="dir">' + (own(labels.ARROW, row.status) || '') + '</td>'
           + '<td class="ver new">' + (row.new_evr ? hl(row.new_evr, q) : '—') + '</td>'
           + '<td class="pat">' + markup.delta(row.patches_added.length,
                                        row.patches_removed.length) + '</td>'
           + '<td class="pat">' + markup.delta(row.rpms_added.length,
                                        row.rpms_removed.length) + '</td>'
           + '<td class="marks">' + markup.marksHtml(row.marks) + '</td>'
           + '<td class="links">' + markup.linkHtml(row.koji_url, 'koji')
           + markup.linkHtml(row.source_url, 'git') + '</td></tr>';
      if (open) {
        html += '<tr class="detail-row"><td colspan="' + cols + '">'
             + diffDetail(row, q, opt.oldTag, opt.newTag)
             + '</td></tr>';
      }
    }
    return html;
  }

  return { stateRows: stateRows, diffRows: diffRows,
           stateDetail: stateDetail, diffDetail: diffDetail };
}));
