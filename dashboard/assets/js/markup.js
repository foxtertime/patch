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

  const esc = text.esc, hl = text.hl, own = text.own, safeUrl = text.safeUrl;

  function markHtml(key) {
    let cls = 'mark';
    if (key === 'patches+') cls += ' added';
    else if (key === 'patches-') cls += ' removed';
    else if (key === 'branch-changed' || key === 'tag-changed') cls += ' warn';
    else if (own(labels.CALM_MARKS, key)) cls += ` ${labels.CALM_MARKS[key]}`;
    else if (own(labels.STATUS_MARKS, key)) cls += ` ${key}`;
    else cls += ` ${labels.classCls(key)}`;   /* остаётся класс патчей */
    return `<span class="${cls}" data-filter="${esc(key)}" role="button"`
         + ` tabindex="0" data-tip="${esc(labels.label(key))}. Клик — фильтр.">`
         + `${esc(key)}</span>`;
  }

  function marksHtml(marks) {
    const out = marks.map(markHtml).join('');
    return out || '<span class="none">—</span>';
  }

  /* Колонка «тег»: прочерк — билд затегован прямо в выбранный тег, имя —
     унаследован оттуда. Прочерк, а не повтор имени тега в каждой строке:
     в теге на восемьсот билдов повторов было бы восемьсот. */
  function taggedCell(row, q) {
    if (row.inherited === null) return '<span class="none">?</span>';
    if (!row.inherited) return '<span class="none">—</span>';
    return hl(row.tagged_in, q);
  }

  /* Время сборки билда в таблице: дата обычная, время бледнее. Колонку сканируют
     по дате — секунды нужны, когда до строки уже дошли. Снапшоты, собранные
     до появления времени, несут одну дату: тогда второй половины просто нет. */
  function builtHtml(value, q) {
    if (!value) return '';
    const date = value.slice(0, 10), time = value.slice(11);
    return hl(date, q)
         + (time ? ` <span class="tm">${hl(time, q)}</span>` : '');
  }

  function inheritedNote(inherited) {
    if (inherited === null) return '';
    return `<span class="note">(${inherited ? 'унаследован' : 'прямой'})</span>`;
  }

  /* Тег, через который билд попал в этот снапшот. */
  function mainTagHtml(row, q) {
    if (!row.tagged_in) return '<span class="none">неизвестно</span>';
    return `<span class="ktag main">${hl(row.tagged_in, q)}</span>`
         + inheritedNote(row.inherited);
  }

  /* Остальные теги, в которых висит тот же билд. Строка остаётся на месте и
     когда их нет: блоки соседних раскрытых строк не должны разъезжаться. */
  function otherTagsHtml(row, q) {
    const list = (row.koji_tags || []).filter((t) => t !== row.tagged_in);
    if (!list.length) return '<span class="none">—</span>';
    const tags = list.map((t) => `<span class="ktag">${hl(t, q)}</span>`);
    return `<div class="ktags">${tags.join('')}</div>`;
  }

  /* То же для сторон «было/стало»: там места на две строки нет. */
  function taggedText(taggedIn, inherited, q) {
    if (inherited === null || !taggedIn) {
      return '<span class="none">неизвестно</span>';
    }
    return `<span class="mono">${hl(taggedIn, q)}</span>`
         + inheritedNote(inherited);
  }

  function linkHtml(url, label) {
    const safe = safeUrl(url);
    if (!safe) return '';
    return `<a class="link" href="${esc(safe)}" target="_blank"`
         + ` rel="noopener">${esc(label)} ↗</a>`;
  }

  /* Полоска состава патчей. Ширина у неё постоянная, и это осознанно: раньше
     длина полоски означала «сколько патчей относительно самого
     обвешанного билда», а доли цветов — состав, и две величины в одной картинке читались
     как одна непонятная. Сколько патчей — говорит число слева от полоски;
     полоска отвечает только на вопрос «из чего они». */
  function meterHtml(row) {
    const total = row.patches.length;
    if (!total) return '';
    const order = labels.classOrder(row.patch_counts);
    const parts = order.map((name) => `${name} ${row.patch_counts[name]}`);
    const bars = order.map((name) => {
      const share = (100 * row.patch_counts[name] / total).toFixed(2);
      return `<i class="${labels.classCls(name)}" style="width:${share}%"></i>`;
    });
    return `<span class="meter" data-tip="${esc(parts.join(' · '))}`
         + `, всего ${total}">${bars.join('')}</span>`;
  }

  function kv(k, v) {
    return `<div class="kv"><span class="k">${esc(k)}</span>`
         + `<span class="v">${v}</span></div>`;
  }

  function signHtml(markCls) {
    return `<span class="sign">${markCls === 'is-added' ? '+' : '−'}</span>`;
  }

  /* Путь патча второй строкой — только когда он что-то добавляет к имени.
     Почти всегда путь это «PATCH/<имя>», то есть имя, повторённое с
     приставкой: строка вдвое длиннее, а нового в ней ноль. Показываем путь
     у патчей из подкаталога — и тогда вторая строка сама становится
     сигналом «этот лежит не там, где все».

     Второй случай — поиск попал в путь, но не в имя: спрятать строку,
     из-за которой патч оказался в выдаче, значит соврать, почему он тут. */
  function pathAdds(p, q) {
    const tail = `/${p.name}`;
    const path = String(p.path || '');
    if (!path.endsWith(tail)) return true;
    const dir = path.slice(0, -tail.length);
    if (dir.indexOf('/') !== -1) return true;
    return Boolean(q) && text.has(path, q) && !text.has(p.name, q);
  }

  function patchItem(p, q, markCls) {
    const href = safeUrl(p.url);
    const title = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">`
        + `${hl(p.name, q)}</a>`
      : `<span class="mono">${hl(p.name, q)}</span>`;
    const path = pathAdds(p, q)
      ? `<div class="ppath">${hl(p.path, q)}</div>` : '';
    return `<li${markCls ? ` class="${markCls}"` : ''}>`
         + `${markCls ? signHtml(markCls) : ''}${title}${path}</li>`;
  }

  function classGroupHtml(name, count, body) {
    return `<div class="pgroup ${labels.classCls(name)}">`
         + `<div class="pclass">${esc(name)} <span class="n">${count}</span>`
         + `</div><ul class="plist">${body}</ul></div>`;
  }

  /* Патчи как они есть, без единой пометки: так набрана вкладка состояния
     и сторона «было» — там ничего не менялось, метить нечего. */
  function patchesHtml(patches, q) {
    if (!patches.length) return '<div class="none">патчей нет</div>';
    const counts = {};
    for (const p of patches) {
      counts[p['class']] = (own(counts, p['class']) || 0) + 1;
    }
    return labels.classOrder(counts).map((name) => classGroupHtml(
      name, counts[name],
      patches.filter((p) => p['class'] === name)
             .map((p) => patchItem(p, q, '')).join(''))).join('');
  }

  /* Патчи стороны «стало»: новое состояние и весь переход к нему разом.
     Ушедшее зачёркнуто на своём прежнем месте среди уцелевших, пришедшее
     дописано внизу своей группы.

     Дифф живёт только здесь. В «было» его половины не место: то состояние
     не менялось, и вычеркнутая в нём строка утверждала бы, будто менялось.

     Класс, ушедший целиком, остаётся с нулём и одной зачёркнутой строкой:
     «был и кончился» — тоже ответ, и молчать о нём нельзя. */
  function patchesChangeHtml(oldPatches, newPatches, q) {
    const inNew = {}, inOld = {};
    for (const p of newPatches) inNew[p.path] = p;
    for (const p of oldPatches) inOld[p.path] = p;
    const items = [];
    for (const p of oldPatches) {
      const kept = own(inNew, p.path);
      /* Уцелевший берём из нового состояния: класс или ссылка могли
         поменяться, и показывать надо то, что есть сейчас. */
      items.push({ p: kept || p, cls: kept ? '' : 'is-removed' });
    }
    for (const p of newPatches) {
      if (!own(inOld, p.path)) items.push({ p: p, cls: 'is-added' });
    }
    if (!items.length) return '<div class="none">патчей нет</div>';
    /* Счётчик считает новое состояние: зачёркнутого в нём уже нет. */
    const counts = {};
    for (const item of items) {
      const name = item.p['class'];
      if (own(counts, name) === undefined) counts[name] = 0;
      if (item.cls !== 'is-removed') counts[name] += 1;
    }
    return labels.classOrder(counts).map((name) => classGroupHtml(
      name, counts[name],
      items.filter((item) => item.p['class'] === name)
           .map((item) => patchItem(item.p, q, item.cls)).join(''))).join('');
  }

  /* Архитектуру считает rpms.js — тот же модуль, что раскладывает пакеты по
     порядку. Своя копия здесь уже разошлась с ним и падала на пакете, который
     не строка: снапшот приходит из файла, который выбрал человек, а падало это
     не при отрисовке, а на раскрытии строки — там, где откатить нечего. */
  const archOf = rpmsmod.archOf;

  function rowArch(row) {
    return archOf(row[0] === null ? row[1] : row[0]);
  }

  function archGroupHtml(arch, count, body) {
    return `<div class="pgroup arch"><div class="pclass">${esc(arch)} `
         + `<span class="n">${count}</span></div>`
         + `<ul class="rlist">${body}</ul></div>`;
  }

  /* Пакеты приходят из Python уже разложенными: сначала src, потом noarch,
     дальше остальные архитектуры. Здесь список только режется на блоки по
     смене архитектуры — своего порядка фронтенд не заводит. */
  function rpmsHtml(list, q) {
    if (!list.length) return '<div class="none">пакетов нет</div>';
    let out = '', i = 0;
    while (i < list.length) {
      const arch = archOf(list[i]);
      let body = '', n = 0;
      while (i < list.length && archOf(list[i]) === arch) {
        body += `<li>${hl(list[i], q)}</li>`;
        i++; n++;
      }
      out += archGroupHtml(arch, n, body);
    }
    return out;
  }

  /* Пакеты одной стороны плоским списком. rows приходят из diff.js
     спаренными: [было, стало], где null значит «на этой стороне пакета
     нет». Пары уже разложены по архитектурам и по порядку, так что
     выбранная сторона получается готовым списком. */
  function rpmSideList(rows, at) {
    const out = [];
    for (const row of rows) {
      if (row[at] !== null) out.push(row[at]);
    }
    return out;
  }

  /* Пакеты стороны «стало»: то же правило, что и у патчей. Ушедший пакет
     зачёркнут на своём прежнем месте, пришедший стоит внизу своей группы —
     именно так их и разложил alignRpms в diff.js.

     Счётчик блока считает новое состояние, поэтому у архитектуры, из
     которой ушёл последний пакет, он показывает 0. */
  function rpmsChangeHtml(rows, q) {
    if (!rows.length) return '<div class="none">пакетов нет</div>';
    let out = '', i = 0;
    while (i < rows.length) {
      const arch = rowArch(rows[i]);
      let body = '', n = 0;
      while (i < rows.length && rowArch(rows[i]) === arch) {
        const was = rows[i][0], now = rows[i][1];
        if (now === null) {
          body += `<li class="is-removed">${signHtml('is-removed')}`
               + `${hl(was, q)}</li>`;
        } else {
          const cls = was === null ? 'is-added' : '';
          body += `<li${cls ? ` class="${cls}"` : ''}>`
               + `${cls ? signHtml(cls) : ''}${hl(now, q)}</li>`;
          n++;
        }
        i++;
      }
      out += archGroupHtml(arch, n, body);
    }
    return out;
  }

  function delta(added, removed) {
    if (!added && !removed) return '<span class="zero">—</span>';
    return (added ? `<span class="plus">+${added}</span> ` : '')
         + (removed ? `<span class="minus">−${removed}</span>` : '');
  }

  return { markHtml, marksHtml, linkHtml, kv, signHtml, meterHtml, pathAdds,
           patchesHtml, patchesChangeHtml, rpmsHtml, rpmsChangeHtml,
           rpmSideList,
           taggedCell, builtHtml, inheritedNote, mainTagHtml, otherTagsHtml,
           taggedText, delta };
}));
