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

  const esc = text.esc, hl = text.hl, own = text.own;
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
    /* Раскрытие — полная карточка сборки: сюда приходят, когда строки уже
       мало, и выкидывать поле из-за того, что оно есть и в строке, значит
       заставлять читать в двух местах сразу. Метки — исключение: у них своя
       колонка и своя же полоса в раскрытии не нужна.

       Подпись зависит от вида ссылки: значение здесь — либо имя ветки, либо
       хеш коммита, и назвать хеш веткой значит соврать. */
    const refName = row.ref_kind === 'commit' ? 'коммит' : 'ветка';
    const branch = row.branch
      ? `<span class="mono">${hl(row.branch, q)}</span>`
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
      + kv('владелец', row.owner ? hl(row.owner, q)
            : '<span class="none">—</span>')
      + kv('build id', esc(row.build_id === null ? '—' : row.build_id))
      + kv('task id', esc(row.task_id === null ? '—' : row.task_id))
      + kv('ссылка', row.koji_url
            ? markup.linkHtml(row.koji_url, 'koji')
            : '<span class="none">—</span>')
      + '</div>'

      + `<div class="block">${blockHead('gitlab')}`
      + kv('проект', row.project
            ? `<span class="mono">${hl(row.project, q)}</span>`
            : '<span class="none">—</span>')
      + kv(refName, branch)
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
      + `${markup.patchesHtml(row.patches, q)}</div>`;

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
        + `<td class="owner">${row.owner ? hl(row.owner, q)
             : '<span class="none">—</span>'}</td>`
        + `<td class="marks">${markup.marksHtml(row.marks)}</td>`
        + `${linksCell(row)}</tr>`;
      return open ? main + detailRow(opt.cols, stateDetail(row, q), bad) : main;
    }).join('');
  }

  /* ---------- вкладка «Изменения» ---------- */

  /* Сторона «было/стало» разбита на четыре куска, и в разметку они уходят
     парами: сперва обе шапки, потом обе сводки, потом оба списка патчей,
     потом оба списка пакетов. Пары встают в одну строку сетки и получают
     общую высоту — иначе списки начинались бы на разной, из-за списков
     патчей над ними.

     Дифф живёт только в «стало». «Было» — это состояние, а не половина
     сравнения: там ничего не происходило, и вычеркнутая строка утверждала
     бы, будто происходило. Что ушло и что пришло, целиком видно справа. */
  function sideHead(title, tag) {
    return `<div class="bl side-head">${esc(title)} · <b>${esc(tag)}</b></div>`;
  }

  /* Значение стороны: прочерк, если его нет, и пометка перехода, если оно
     изменилось. Помечаем только на стороне «стало» — там же, где и
     остальные переходы; «было» это состояние, в нём ничего не происходило. */
  function sideValue(value, changed, q, markCls, mono) {
    if (!value) return '<span class="none">—</span>';
    const cls = (mono ? 'mono' : '') + (markCls && changed
      ? `${mono ? ' ' : ''}${markCls}` : '');
    return cls ? `<span class="${cls}">${hl(value, q)}</span>` : hl(value, q);
  }

  /* Сводка стороны — полная карточка сборки, а не выжимка: «было» и «стало»
     это две карточки одного компонента, и уходить за остальным из раскрытия
     человеку негде. markCls пуст у «было» и назван у «стало».

     Время сборки не помечается никогда: у пересобранного компонента оно
     разное всегда, и пометка на нём не сообщала бы ничего. */
  function sideFacts(s, q, markCls) {
    const tagCell = markup.taggedText(s.taggedIn, s.inherited, q);
    return '<div class="side">'
      + kv('версия', sideValue(s.evr, false, q, '', true))
      + kv('тег', markCls && s.tagChanged
            ? `<span class="${markCls}">${tagCell}</span>` : tagCell)
      + kv('собран', s.completed
            ? hl(s.completed, q) + (s.completed.length > 10
                ? '<span class="note">МСК</span>' : '')
            : '<span class="none">—</span>')
      + kv('владелец', sideValue(s.owner, s.ownerChanged, q, markCls, false))
      + kv('ветка', sideValue(s.branch, s.branchChanged, q, markCls, true))
      + kv('проект', sideValue(s.project, s.projectChanged, q, markCls, true))
      + kv('ссылки', (s.kojiUrl || s.sourceUrl)
            ? markup.linkHtml(s.kojiUrl, 'koji')
              + markup.linkHtml(s.sourceUrl, 'git')
            : '<span class="none">—</span>')
      + '</div>';
  }

  function sideBlock(title, count, body) {
    return `<div class="side">${blockHead(title, count)}${body}</div>`;
  }

  /* Имена концов приходят доводами: какая пара сейчас выбрана, знает
     страница, а не таблица. */
  function diffDetail(row, q, oldTag, newTag) {
    const branchChanged = row.marks.indexOf('branch-changed') !== -1;
    const tagChanged = row.marks.indexOf('tag-changed') !== -1;
    /* У смены владельца и переезда проекта своей метки нет: это не повод
       для фильтра, а подробность, которую видно, только когда строку уже
       раскрыли. Поэтому сравниваем прямо здесь. */
    const ownerChanged = Boolean(row.old_owner && row.new_owner
      && row.old_owner !== row.new_owner);
    const projectChanged = Boolean(row.old_project && row.new_project
      && row.old_project !== row.new_project);
    const shared = { branchChanged, tagChanged, ownerChanged, projectChanged };
    const was = Object.assign({
      evr: row.old_evr, branch: row.old_branch,
      taggedIn: row.old_tagged_in, inherited: row.old_inherited,
      owner: row.old_owner, completed: row.old_completed,
      project: row.old_project, kojiUrl: row.old_koji_url,
      sourceUrl: row.old_source_url }, shared);
    const now = Object.assign({
      evr: row.new_evr, branch: row.new_branch,
      taggedIn: row.new_tagged_in, inherited: row.new_inherited,
      owner: row.new_owner, completed: row.new_completed,
      project: row.new_project, kojiUrl: row.new_koji_url,
      sourceUrl: row.new_source_url }, shared);
    const oldRpms = markup.rpmSideList(row.rpm_rows, 0);
    const newRpms = markup.rpmSideList(row.rpm_rows, 1);
    return '<div class="sides">'
      + sideHead('было', oldTag) + sideHead('стало', newTag)
      + sideFacts(was, q, '') + sideFacts(now, q, 'is-added')
      + sideBlock('патчи', row.old_patches.length,
                  markup.patchesHtml(row.old_patches, q))
      + sideBlock('патчи', row.new_patches.length,
                  markup.patchesChangeHtml(row.old_patches, row.new_patches, q))
      + sideBlock('RPM', oldRpms.length, markup.rpmsHtml(oldRpms, q))
      + sideBlock('RPM', newRpms.length, markup.rpmsChangeHtml(row.rpm_rows, q))
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
