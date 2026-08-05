/* Куски разметки, общие для обеих таблиц: метки, теги, ссылки, полоска
   состава патчей, списки патчей и RPM. Получают данные доводами, возвращают
   строки — ни состояния страницы, ни DOM здесь нет. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./labels.js'),
                             require('./rpms.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.markup = factory(root.KP.text, root.KP.labels, root.KP.rpms);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (text, labels, rpmsmod) {
  'use strict';

  var esc = text.esc, hl = text.hl, own = text.own, safeUrl = text.safeUrl;

  function markHtml(key) {
    var cls = 'mark';
    if (key === 'patches+') cls += ' added';
    else if (key === 'patches-') cls += ' removed';
    else if (key === 'branch-changed' || key === 'tag-changed') cls += ' warn';
    else if (own(labels.CALM_MARKS, key)) cls += ' ' + labels.CALM_MARKS[key];
    else if (own(labels.STATUS_MARKS, key)) cls += ' ' + key;
    else cls += ' ' + labels.classCls(key);   /* остаётся класс патчей */
    return '<span class="' + cls + '" data-filter="' + esc(key) + '" role="button"'
         + ' tabindex="0" data-tip="' + esc(labels.label(key)) + '. Клик — фильтр.">'
         + esc(key) + '</span>';
  }

  function marksHtml(marks) {
    var out = '';
    for (var i = 0; i < marks.length; i++) out += markHtml(marks[i]);
    return out || '<span class="none">—</span>';
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

  function linkHtml(url, label) {
    var safe = safeUrl(url);
    if (!safe) return '';
    return '<a class="link" href="' + esc(safe) + '" target="_blank" rel="noopener">'
         + esc(label) + ' ↗</a>';
  }

  /* Полоска состава патчей. Ширина у неё постоянная, и это осознанно: раньше
     длина полоски означала «сколько патчей относительно самой обвешанной
     сборки», а доли цветов — состав, и две величины в одной картинке читались
     как одна непонятная. Сколько патчей — говорит число слева от полоски;
     полоска отвечает только на вопрос «из чего они». */
  function meterHtml(row) {
    var total = row.patches.length;
    if (!total) return '';
    var order = labels.classOrder(row.patch_counts), parts = [], bars = '', i, n;
    for (i = 0; i < order.length; i++) {
      n = row.patch_counts[order[i]];
      parts.push(order[i] + ' ' + n);
      bars += '<i class="' + labels.classCls(order[i]) + '" style="width:'
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
    var order = labels.classOrder(counts), out = '', ci, name;
    for (ci = 0; ci < order.length; ci++) {
      name = order[ci];
      out += '<div class="pgroup ' + labels.classCls(name) + '">'
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

  function delta(added, removed) {
    if (!added && !removed) return '<span class="zero">—</span>';
    var out = '';
    if (added) out += '<span class="plus">+' + added + '</span> ';
    if (removed) out += '<span class="minus">−' + removed + '</span>';
    return out;
  }

  return { markHtml: markHtml, marksHtml: marksHtml, linkHtml: linkHtml,
           kv: kv, signHtml: signHtml, meterHtml: meterHtml,
           patchesHtml: patchesHtml, rpmsHtml: rpmsHtml,
           rpmSideHtml: rpmSideHtml, rpmSideCount: rpmSideCount,
           taggedCell: taggedCell, builtHtml: builtHtml,
           inheritedNote: inheritedNote, mainTagHtml: mainTagHtml,
           otherTagsHtml: otherTagsHtml, taggedText: taggedText,
           delta: delta };
}));
