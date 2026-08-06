/* Как страница называет ключи, приехавшие из данных: метки строк, статусы
   диффа, классы патчей. Здесь же — цвет, которым класс рисуют, и порядок,
   в котором классы перечисляют. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./text.js'));
  } else {
    root.KP = root.KP || {};
    root.KP.labels = factory(root.KP.text);
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, (text) => {
  'use strict';

  /* Подписи фильтров: ключ приходит из данных (метки строк, статусы диффа),
     а по-русски он должен читаться и в чипе, и в подсказке. */
  const LABELS = {
    "all": "все",
    "has-patch": "с патчами", "problem": "с проблемами",
    "no-patch": "нет каталога PATCH", "no-source": "нет источника",
    "from-commit": "собран с коммита", "gitlab-error": "ошибка GitLab",
    "internal-error": "внутренняя ошибка",
    "inherited": "унаследован из другого тега",
    "tag-changed": "переехал между тегами",
    "added": "появился", "removed": "исчез", "unchanged": "версия та же",
    "upgraded": "версия выросла", "downgraded": "версия упала",
    "repackaged": "состав RPM изменился", "patches+": "патчи пришли",
    "patches-": "патчи ушли", "branch-changed": "сменил ветку",
    "changed": "что-то изменилось"
  };
  /* Подписи классов патчей живут отдельно от постоянных: классы приходят с
     данными и уходят вместе с ними, а LABELS — словарь самой страницы. */
  let CLASS_LABELS = {};
  let CLASSES = [];
  const ARROW = { added: "+", removed: "−", upgraded: "↑",
                  downgraded: "↓", unchanged: "=" };
  const KNOWN_CLASS = { "autogen": 1, "cve": 1, "sast": 1, "dast": 1,
                        "coverage": 1, "distsuffix": 1, "spec": 1,
                        "changelog": 1, "files": 1, "other": 1 };
  const CALM_MARKS = { "from-commit": "warn", "no-patch": "calm",
                       "no-source": "bad", "gitlab-error": "bad",
                       "internal-error": "bad", "inherited": "calm" };
  const STATUS_MARKS = { "added": 1, "removed": 1, "unchanged": 1,
                         "upgraded": 1, "downgraded": 1, "repackaged": 1 };

  /* Группы фильтров: чем признак является, а не где он нарисован. Группа —
     это и заголовок в меню, и область действия переключателя «все / любой
     из», поэтому её id уезжает в ссылку и меняться не может.

     Живут они здесь, а не в page.js, по той же причине, что и подписи:
     «к чему относится этот ключ» — вопрос словаря страницы, а не её
     состояния.

     keys: null — группа набирается из данных. Классы приходят со снапшотом
     и уходят вместе с ним, поэтому список собирается на каждый вызов, а не
     один раз при загрузке. */
  const GROUPS = {
    state: [
      { id: "classes", label: "классы патчей", keys: null },
      { id: "build", label: "свойства сборки",
        keys: ["has-patch", "inherited", "from-commit"] },
      { id: "trouble", label: "проблемы",
        keys: ["problem", "no-patch", "no-source", "gitlab-error",
               "internal-error"] }
    ],
    diff: [
      { id: "status", label: "статус",
        keys: ["added", "removed", "upgraded", "downgraded", "unchanged"] },
      { id: "change", label: "что изменилось",
        keys: ["changed", "patches+", "patches-", "repackaged",
               "branch-changed", "tag-changed"] }
    ]
  };

  /* Классы патчей задаются конфигом, поэтому подписи для них берём из
     данных. Ключ — тот же slug(), что стоит в метке строки и в карточке
     класса: имя вроде «C++» иначе дало бы три разных ключа и карточку
     без строк. Карта заводится заново: подпись класса из выгруженного
     снапшота пережила бы его и держала бы живым фильтр, которого на
     странице больше нет ни на одной карточке. */
  function setClasses(list) {
    CLASSES = list || [];
    CLASS_LABELS = {};
    for (const name of CLASSES) {
      CLASS_LABELS[text.slug(name)] = `патчи ${name}`;
    }
  }

  function classes() { return CLASSES; }

  /* Класс патчей задаётся конфигом, а цвета в CSS перечислены поимённо.
     Незнакомый класс не должен остаться бесцветным — уводим его в c-x. */
  function classCls(name) {
    const key = text.slug(name);
    return text.own(KNOWN_CLASS, key) ? 'c-' + key : 'c-x';
  }

  function label(key) {
    return text.own(LABELS, key) || text.own(CLASS_LABELS, key) || key;
  }

  /* Порядок классов: сначала как их перечислил классификатор, потом всё,
     что встретилось в данных, но в списке классов отсутствует.

     Спрашиваем про наличие ключа, а не про его значение: у класса, ушедшего
     из сборки целиком, счётчик нулевой, но в списке он остаться обязан — в
     стороне «стало» под ним стоит зачёркнутая строка. */
  function classOrder(counts) {
    let out = [], i;
    for (i = 0; i < CLASSES.length; i++) {
      if (text.own(counts, CLASSES[i]) !== undefined) out.push(CLASSES[i]);
    }
    const extra = text.keys(counts).sort();
    for (i = 0; i < extra.length; i++) {
      if (out.indexOf(extra[i]) === -1) out.push(extra[i]);
    }
    return out;
  }

  /* Порядок классов тот же, что у плашек классов: classOrder начинает с
     CLASSES, и слаги здесь идут оттуда же. */
  function groups(tab) {
    const out = [];
    for (const group of (GROUPS[tab] || [])) {
      const keys = group.keys || CLASSES.map((name) => text.slug(name));
      if (keys.length) {
        out.push({ id: group.id, label: group.label, keys: keys });
      }
    }
    return out;
  }

  return { setClasses: setClasses, classes: classes, label: label,
           classCls: classCls, classOrder: classOrder, groups: groups,
           LABELS: LABELS, ARROW: ARROW, KNOWN_CLASS: KNOWN_CLASS,
           CALM_MARKS: CALM_MARKS, STATUS_MARKS: STATUS_MARKS };
}));
