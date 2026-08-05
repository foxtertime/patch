/* Строка адреса: разобрать её на части и собрать обратно. О снапшотах,
   фильтрах и данных страницы здесь не знают ничего — имена остаются
   строками, а разрешать их в цепочку умеет page.js.

   Хеш правят руками и присылают в переписке, поэтому «100%», «%zz» и
   обрезанная многобайтовая последовательность в нём — норма, а не
   исключение; отсюда и обёртка вокруг decodeURIComponent. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KP = root.KP || {};
    root.KP.hash = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  /* decodeURIComponent на битом куске бросает URIError; без этой обёртки он
     унёс бы разбор целиком, а вместе с ним и первый рендер страницы. */
  function dec(s) {
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  /* Разбор строки адреса. Поля, которых в ней не было, приходят null —
     и это не то же самое, что пустое значение: пустой f= значит «фильтров
     нет», а отсутствующий — «о фильтрах ссылка не говорит».

     Ничего не проверяется по данным: годится ли эта вкладка, есть ли такой
     снапшот и жив ли такой фильтр, решает тот, у кого данные есть. */
  function parse(raw) {
    let out = { tab: null, tag: null, pair: null, filters: null,
                q: null, sort: null };
    const body = String(raw === null || raw === undefined ? '' : raw)
      .replace(/^#/, '');
    if (!body) return out;
    let parts = body.split('&'), i, kvp, key, val, bits;
    for (i = 0; i < parts.length; i++) {
      kvp = parts[i].split('=');
      key = kvp[0];
      val = dec(kvp.slice(1).join('=') || '');
      if (val === null) continue;   /* битый кусок пропускаем, остальные читаем */
      if (key === 'tab') out.tab = val;
      else if (key === 'tag') out.tag = val;
      else if (key === 'pair') out.pair = val;
      else if (key === 'f') out.filters = val ? val.split(',') : [];
      else if (key === 'q') out.q = val.trim().toLowerCase();
      else if (key === 'sort') {
        bits = val.split(':');
        if (bits[0]) out.sort = { key: bits[0], asc: bits[1] !== 'desc' };
      }
    }
    return out;
  }

  /* Сборка строки обратно. Имена снапшота и диапазона приходят готовыми:
     как они устроены, знает page.js. */
  function format(parts) {
    const out = ['tab=' + parts.tab];
    /* Снапшот храним именем, а не номером: набор снапшотов на странице
       меняется, и присланная ссылка «tag=1» показала бы другой снапшот,
       ничем не выдав подмены. Имя полное, с временем сбора, — иначе два
       прогона одного тега на такую ссылку отвечали бы одинаково. */
    if (parts.tag) out.push('tag=' + encodeURIComponent(parts.tag));
    if (parts.pair) out.push('pair=' + encodeURIComponent(parts.pair));
    /* f= пишем всегда, в том числе пустой: у вкладки «Изменения» фильтр по
       умолчанию непустой, и без явного «фильтров нет» ссылка на таблицу со
       снятым фильтром при открытии снова показывала бы только изменившиеся. */
    out.push('f=' + encodeURIComponent((parts.filters || []).join(',')));
    if (parts.q) out.push('q=' + encodeURIComponent(parts.q));
    out.push('sort=' + parts.sort.key + (parts.sort.asc ? '' : ':desc'));
    return '#' + out.join('&');
  }

  return { parse: parse, format: format };
}));
