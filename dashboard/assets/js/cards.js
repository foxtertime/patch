/* Карточки-счётчики над таблицами. Возвращают строки: куда их положить,
   знает корень страницы, а не они. Какое из трёх положений сейчас у
   признака, плашка тоже не решает — это расставляет корень по готовым
   узлам, потому что разметка карточек пересобирается только со сменой
   данных, а фильтр меняется куда чаще. */
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

  const esc = text.esc, plural = text.plural;

  function cardHtml(filter, big, number, unit, sub, label, tip, labelCls) {
    const cls = `card${big ? ' big' : ''}${filter ? ' clickable' : ''}`;
    const open = filter
      ? `<button type="button" class="${cls}" data-filter="${esc(filter)}"`
        + ' aria-pressed="false"'
      : `<div class="${cls}"`;
    /* У большой карточки подпись стоит над числом, у мелкой — под ним:
       большие читают сверху вниз как заголовки, мелкие — как ряд значков. */
    const title = `<div class="l${labelCls ? ` ${labelCls}` : ''}">`
      + `${esc(label)}</div>`;
    return `${open} data-tip="${esc(tip)}">`
      + (big ? title : '')
      + `<div class="n">${esc(number)}`
      + (unit ? ` <span class="unit">${esc(unit)}</span>` : '') + '</div>'
      + `<div class="rpm">${esc(sub || '')}</div>`
      + (big ? '' : title)
      + (filter ? '</button>' : '</div>');
  }

  /* Карточки вкладки «Состояние»: большие — про весь тег, мелкие — про
     классы патчей. Возвращаем обе строки сразу: считаются они по одному
     снапшоту, а кладут их в два разных узла. */
  function stateCards(snap) {
    if (!snap) return { big: '', classes: '' };
    const c = snap.counts;
    let rpms = 0;
    for (const b of snap.builds) rpms += b.rpms.length;

    const big =
        cardHtml('all', true, c.builds, plural(c.builds, 'сборка', 'сборки', 'сборок'),
          `${rpms} RPM`, 'в теге',
          `Все последние сборки тега ${snap.tag} и собранные из них бинарные `
          + 'пакеты. Клик снимает все фильтры.')
      + cardHtml('has-patch', true, c.with_patches,
          plural(c.with_patches, 'сборка', 'сборки', 'сборок'),
          `${c.patch_files} `
          + `${plural(c.patch_files, 'файл', 'файла', 'файлов')} патчей`,
          'с патчами',
          'Сборки, у которых в каталоге PATCH ветки лежит хотя бы один файл. '
          + 'Клик оставит в таблице только их.')
      + cardHtml('inherited', true, c.inherited,
          plural(c.inherited, 'сборка', 'сборки', 'сборок'),
          `${c.direct} затегованы прямо`, 'унаследованы',
          `Сборки, которые висят не в теге ${snap.tag}, а в одном из его `
          + 'родителей, и попали сюда наследованием. В колонке «тег» видно, '
          + 'из какого именно. Клик оставит в таблице только их.')
      + cardHtml('problem', true, c.problems,
          plural(c.problems, 'сборка', 'сборки', 'сборок'),
          `${c.without_patches} без каталога PATCH`, 'с проблемами',
          'Сборки, при сборе данных по которым что-то пошло не так: нет исходника, '
          + 'GitLab ответил ошибкой, ветка исчезла. Клик оставит только их.');

    const classes = labels.classOrder(c.by_class).map((name) => {
      const b = c.by_class[name];
      return cardHtml(text.slug(name), false, b.builds,
        plural(b.builds, 'сборка', 'сборки', 'сборок'),
        `${b.files} ${plural(b.files, 'файл', 'файла', 'файлов')}`,
        name, `Сборки, где есть хотя бы один патч класса ${name}, и сколько `
        + 'таких файлов всего. Клик оставит в таблице только их.',
        labels.classCls(name));
    }).join('');
    return { big, classes };
  }

  /* Стороны перехода: сколько сборок было в теге и сколько стало. Крупно и
     первым рядом, как итоги тега на «Состоянии»: разрезы под ними — про то,
     что изменилось, а эти два числа про то, между чем считали.

     Число берётся у снапшота, а не по строкам таблицы: строка — это
     компонент перехода, и компонент, которого на этой стороне ещё (или уже)
     нет, в ней всё равно стоит.

     Под числом — тег и время сбора. Тега мало: два прогона одного тега —
     законный случай, и «было os-9.4 → стало os-9.4» без времени сбора не
     сказало бы, какой из них какой. */
  function sideCards(pair, from, to) {
    if (!pair || !from || !to) return '';
    const was = from.counts.builds, now = to.counts.builds;
    const delta = now - was;
    let move;
    if (delta === 0) move = 'Столько же, сколько было.';
    else {
      move = `На ${Math.abs(delta)} `
        + `${plural(Math.abs(delta), 'сборку', 'сборки', 'сборок')} `
        + `${delta > 0 ? 'больше' : 'меньше'}, чем было.`;
    }
    function side(snap, count, label, tip) {
      return cardHtml(null, true, count,
        plural(count, 'сборка', 'сборки', 'сборок'),
        `${snap.tag}, ${text.stampOf(snap.generated)}`, label, tip);
    }
    return side(from, was, 'было',
        `Сколько сборок было в теге на начало перехода — все последние `
        + `сборки ${from.tag} на момент того сбора.`)
      + side(to, now, 'стало',
        `Сколько сборок в теге на конец перехода. ${move} `
        + `Появилось ${pair.counts.added}, исчезло ${pair.counts.removed}.`);
  }

  function diffCards(pair) {
    if (!pair) return '';
    const c = pair.counts;
    const spec = [
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
    return spec.map(([key, count, label, tip]) =>
      cardHtml(key, false, count, `из ${pair.rows.length}`, '',
               label, `${tip} Клик — фильтр.`)).join('');
  }

  return { stateCards, sideCards, diffCards };
}));
