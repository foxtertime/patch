/* Карточки-счётчики над таблицами и чипы поставленных фильтров. Возвращают
   строки: куда их положить, знает корень страницы, а не они. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'), require('./labels.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.cards = factory(root.KP.text, root.KP.labels);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this,
  function (text, labels) {
  'use strict';

  var esc = text.esc, plural = text.plural;

  function cardHtml(filter, big, number, unit, sub, label, tip, labelCls) {
    var cls = 'card' + (big ? ' big' : '') + (filter ? ' clickable' : '');
    var open = filter
      ? '<button type="button" class="' + cls + '" data-filter="' + esc(filter)
        + '" aria-pressed="false"'
      : '<div class="' + cls + '"';
    return open + ' data-tip="' + esc(tip) + '">'
      + (big ? '<div class="l' + (labelCls ? ' ' + labelCls : '') + '">'
               + esc(label) + '</div>' : '')
      + '<div class="n">' + esc(number)
      + (unit ? ' <span class="unit">' + esc(unit) + '</span>' : '') + '</div>'
      + '<div class="rpm">' + esc(sub || '') + '</div>'
      + (big ? '' : '<div class="l' + (labelCls ? ' ' + labelCls : '') + '">'
               + esc(label) + '</div>')
      + (filter ? '</button>' : '</div>');
  }

  /* Карточки вкладки «Состояние»: большие — про весь тег, мелкие — про
     классы патчей. Возвращаем обе строки сразу: считаются они по одному
     снапшоту, а кладут их в два разных узла. */
  function stateCards(snap) {
    if (!snap) return { big: '', classes: '' };
    var c = snap.counts, rpms = 0, i;
    for (i = 0; i < snap.builds.length; i++) rpms += snap.builds[i].rpms.length;

    var big =
        cardHtml('all', true, c.builds, plural(c.builds, 'сборка', 'сборки', 'сборок'),
          rpms + ' RPM', 'в теге',
          'Все последние сборки тега ' + snap.tag + ' и собранные из них бинарные '
          + 'пакеты. Клик снимает все фильтры.')
      + cardHtml('has-patch', true, c.with_patches,
          plural(c.with_patches, 'сборка', 'сборки', 'сборок'),
          c.patch_files + ' ' + plural(c.patch_files, 'файл', 'файла', 'файлов')
          + ' патчей', 'с патчами',
          'Сборки, у которых в каталоге PATCH ветки лежит хотя бы один файл. '
          + 'Клик оставит в таблице только их.')
      + cardHtml('inherited', true, c.inherited,
          plural(c.inherited, 'сборка', 'сборки', 'сборок'),
          c.direct + ' затегованы прямо', 'унаследованы',
          'Сборки, которые висят не в теге ' + snap.tag + ', а в одном из его '
          + 'родителей, и попали сюда наследованием. В колонке «тег» видно, '
          + 'из какого именно. Клик оставит в таблице только их.')
      + cardHtml('problem', true, c.problems,
          plural(c.problems, 'сборка', 'сборки', 'сборок'),
          c.without_patches + ' без каталога PATCH', 'с проблемами',
          'Сборки, при сборе данных по которым что-то пошло не так: нет исходника, '
          + 'GitLab ответил ошибкой, ветка исчезла. Клик оставит только их.');

    var order = labels.classOrder(c.by_class), out = '';
    for (i = 0; i < order.length; i++) {
      var name = order[i], b = c.by_class[name];
      out += cardHtml(text.slug(name), false, b.builds,
        plural(b.builds, 'сборка', 'сборки', 'сборок'),
        b.files + ' ' + plural(b.files, 'файл', 'файла', 'файлов'),
        name, 'Сборки, где есть хотя бы один патч класса ' + name + ', и сколько '
        + 'таких файлов всего. Клик оставит в таблице только их.',
        labels.classCls(name));
    }
    return { big: big, classes: out };
  }

  function diffCards(pair) {
    if (!pair) return '';
    var c = pair.counts;
    var spec = [
      ['changed', c.changed, 'изменились',
       'Компоненты, у которых изменилось хоть что-нибудь: версия, набор патчей, '
       + 'состав RPM или ветка.'],
      ['added', c.added, 'появились', 'Компонентов не было в старом теге.'],
      ['removed', c.removed, 'исчезли', 'Компонентов нет в новом теге.'],
      ['upgraded', c.upgraded, 'версия выросла',
       'Сравнение version-release по правилам rpm.'],
      ['downgraded', c.downgraded, 'версия упала',
       'Версия в новом теге ниже, чем в старом. Обычно это откат.'],
      ['unchanged', c.unchanged, 'версия та же',
       'Version-release совпал. Патчи и состав RPM при этом могли измениться.'],
      ['patches+', c.patches_added, 'патчи пришли',
       'В каталоге PATCH появились новые файлы.'],
      ['patches-', c.patches_removed, 'патчи ушли',
       'Из каталога PATCH исчезли файлы. Стоит проверить, не потеряно ли исправление.'],
      ['repackaged', c.repackaged, 'состав RPM',
       'Компонент остался, но набор его бинарных пакетов изменился.'],
      ['branch-changed', c.branch_changed, 'сменили ветку',
       'Сборка приехала из другой ветки GitLab, чем в старом теге.'],
      ['tag-changed', c.tag_changed, 'переехали между тегами',
       'Билд теперь висит в другом koji-теге: был унаследован — стал '
       + 'затегован прямо, или наоборот. Обычное наследование сюда не '
       + 'попадает: сравнивается сам тег билда, а не то, каким он выглядит '
       + 'из выбранного.']
    ];
    var out = '';
    for (var i = 0; i < spec.length; i++) {
      out += cardHtml(spec[i][0], false, spec[i][1], 'из ' + pair.rows.length, '',
                      spec[i][2], spec[i][3] + ' Клик — фильтр.');
    }
    return out;
  }

  /* Чипы поставленных фильтров. Набор приходит доводом: какая вкладка
     открыта, знает страница. */
  function chips(set) {
    var list = text.keys(set).sort(), out = '';
    for (var i = 0; i < list.length; i++) {
      out += '<button type="button" class="chip" data-chip="' + esc(list[i]) + '"'
          + ' data-tip="Снять фильтр">' + esc(list[i]) + ' · '
          + esc(labels.label(list[i])) + ' ✕</button>';
    }
    if (list.length > 1) {
      out += '<button type="button" class="chip clear" data-chip="all"'
          + ' data-tip="Снять все фильтры">сбросить всё</button>';
    }
    return out;
  }

  return { stateCards: stateCards, diffCards: diffCards, chips: chips };
}));
