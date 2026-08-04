'use strict';
/* Мини-DOM поверх настоящего kojipatch/assets/dashboard.html.
   Нужен, чтобы прогонять ui.js в node: браузера в сборке нет, а
   расхождение разметки и скрипта ничем себя не выдаёт — страница просто
   перестаёт рисоваться. Дерево строится из самого шаблона, поэтому
   пропавший id или селектор роняет тест, а не молча меняет вид страницы.

   Это заглушка, а не реализация DOM: innerHTML здесь обычная строка, и
   разметка, которую скрипт рисует сам, селекторами не ищется. Всё, что
   ui.js ищет запросами, стоит в шаблоне статически. */
var fs = require('node:fs');
var path = require('node:path');

var TEMPLATE = path.join(__dirname, '..', '..', 'kojipatch', 'assets',
                         'dashboard.html');
var VOID = { meta: 1, input: 1, br: 1, hr: 1, img: 1, link: 1, source: 1 };

function Node(tag, attrs) {
  this.tagName = tag.toUpperCase();
  this.attrs = attrs || {};
  this.children = [];
  this.parentNode = null;
  this.text = '';
  this.innerHTML = '';
  this.hidden = Object.prototype.hasOwnProperty.call(this.attrs, 'hidden');
  this.className = this.attrs['class'] || '';
  this.disabled = false;
  this.value = '';
  this.placeholder = this.attrs.placeholder || '';
  this.style = { setProperty: function () {} };
  this.handlers = {};
}

Node.prototype.getAttribute = function (name) {
  if (name === 'class') return this.className || null;
  return Object.prototype.hasOwnProperty.call(this.attrs, name)
    ? this.attrs[name] : null;
};

Node.prototype.setAttribute = function (name, value) {
  if (name === 'class') this.className = String(value);
  else this.attrs[name] = String(value);
};

Node.prototype.appendChild = function (node) {
  node.parentNode = this;
  this.children.push(node);
  return node;
};

Node.prototype.removeChild = function (node) {
  var at = this.children.indexOf(node);
  if (at !== -1) this.children.splice(at, 1);
  node.parentNode = null;
  return node;
};

Node.prototype.insertBefore = function (node, anchor) {
  if (node.parentNode) node.parentNode.removeChild(node);
  var at = anchor ? this.children.indexOf(anchor) : -1;
  if (at === -1) this.children.push(node);
  else this.children.splice(at, 0, node);
  node.parentNode = this;
  return node;
};

Object.defineProperty(Node.prototype, 'textContent', {
  get: function () { return this.text; },
  set: function (value) { this.text = String(value); }
});

Node.prototype.getBoundingClientRect = function () {
  return { top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 };
};

Node.prototype.addEventListener = function (type, fn) {
  if (!this.handlers[type]) this.handlers[type] = [];
  this.handlers[type].push(fn);
};

Node.prototype.click = function () { dispatch(this, 'click', {}); };

/* Селекторы разбираем ровно те, что нужны ui.js: тег, классы и наличие
   атрибута, без комбинаторов. Больше в скрипте не встречается, а полный
   разбор селекторов в заглушке был бы отдельной программой. */
function parseSelector(selector) {
  var m = /^([a-zA-Z0-9-]*)((?:\.[a-zA-Z0-9_-]+)*)((?:\[[^\]]+\])*)$/
    .exec(selector.trim());
  if (!m) throw new Error('заглушка не понимает селектор: ' + selector);
  var classes = m[2] ? m[2].slice(1).split('.') : [];
  var attrs = m[3] ? m[3].slice(1, -1).split('][') : [];
  return { tag: m[1] ? m[1].toUpperCase() : '', classes: classes,
           attrs: attrs };
}

function matches(node, spec) {
  var i, list = String(node.className || '').split(/\s+/);
  if (spec.tag && node.tagName !== spec.tag) return false;
  for (i = 0; i < spec.classes.length; i++) {
    if (list.indexOf(spec.classes[i]) === -1) return false;
  }
  for (i = 0; i < spec.attrs.length; i++) {
    if (node.getAttribute(spec.attrs[i]) === null) return false;
  }
  return true;
}

function collect(node, spec, out) {
  for (var i = 0; i < node.children.length; i++) {
    if (matches(node.children[i], spec)) out.push(node.children[i]);
    collect(node.children[i], spec, out);
  }
  return out;
}

Node.prototype.querySelectorAll = function (selector) {
  return collect(this, parseSelector(selector), []);
};

Node.prototype.querySelector = function (selector) {
  var all = this.querySelectorAll(selector);
  return all.length ? all[0] : null;
};

/* Событие поднимается от узла к document — на этом держатся все
   делегированные обработчики страницы. */
function dispatch(node, type, extra) {
  var event = { type: type, target: node, defaultPrevented: false,
                preventDefault: function () { this.defaultPrevented = true; },
                stopPropagation: function () {} };
  var key;
  for (key in extra) {
    if (Object.prototype.hasOwnProperty.call(extra, key)) event[key] = extra[key];
  }
  var at = node, i, list;
  while (at) {
    list = at.handlers ? at.handlers[type] : null;
    if (list) {
      event.currentTarget = at;
      for (i = 0; i < list.length; i++) list[i].call(at, event);
    }
    at = at.parentNode;
  }
  return event;
}

function findTagEnd(html, from) {
  var i = from + 1, quote = null, ch;
  while (i < html.length) {
    ch = html.charAt(i);
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
    i += 1;
  }
  return html.length;
}

function parseAttrs(raw) {
  var out = {}, re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*"([^"]*)")?/g, m;
  while ((m = re.exec(raw)) !== null) {
    out[m[1]] = m[2] === undefined ? '' : m[2];
  }
  return out;
}

function parse(html) {
  var root = new Node('#root', {});
  var stack = [root], i = 0, lt, gt, raw, tag, node, close, m;
  while (i < html.length) {
    lt = html.indexOf('<', i);
    if (lt === -1) break;
    stack[stack.length - 1].text += html.slice(i, lt).trim();
    if (html.substr(lt, 4) === '<!--') {
      i = html.indexOf('-->', lt) + 3;
      continue;
    }
    if (html.charAt(lt + 1) === '!') {
      i = html.indexOf('>', lt) + 1;
      continue;
    }
    gt = findTagEnd(html, lt);
    raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.charAt(0) === '/') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    m = /^([a-zA-Z0-9-]+)([\s\S]*)$/.exec(raw);
    if (!m) continue;
    tag = m[1].toLowerCase();
    node = new Node(tag, parseAttrs(m[2]));
    stack[stack.length - 1].appendChild(node);
    if (VOID[tag] || /\/$/.test(raw)) continue;
    /* Внутри style и script стоит не разметка: в CSS есть «>», и разбирать
       его как теги значило бы развалить дерево. */
    if (tag === 'style' || tag === 'script') {
      close = html.indexOf('</' + tag, i);
      if (close === -1) close = html.length;
      node.text = html.slice(i, close);
      i = html.indexOf('>', close) + 1;
      continue;
    }
    stack.push(node);
  }
  return root;
}

function byId(node, id, found) {
  for (var i = 0; i < node.children.length; i++) {
    if (node.children[i].getAttribute('id') === id) found.push(node.children[i]);
    byId(node.children[i], id, found);
  }
  return found;
}

/* Файл в терминах страницы: имя, текст и признак нечитаемого файла.
   Чтение асинхронное, как в браузере, — иначе порядок, ради которого в
   loadFiles заведён счётчик pending, тест бы не проверял. */
function file(name, text, broken) {
  return { name: name, text: text, broken: Boolean(broken) };
}

function FileReader() { this.result = null; }

FileReader.prototype.readAsText = function (source) {
  var self = this;
  setTimeout(function () {
    if (source.broken) {
      if (self.onerror) self.onerror();
      return;
    }
    self.result = source.text;
    if (self.onload) self.onload();
  }, 0);
};

/* Ставит свежую страницу в глобальные переменные node: ui.js обращается к
   document, window, location и history по именам, как в браузере. */
function install(options) {
  options = options || {};
  var root = parse(fs.readFileSync(TEMPLATE, 'utf8'));
  var document = {
    isDocument: true,
    handlers: {},
    children: root.children,
    parentNode: null,
    addEventListener: Node.prototype.addEventListener,
    querySelector: Node.prototype.querySelector,
    querySelectorAll: Node.prototype.querySelectorAll,
    getElementById: function (id) {
      var found = byId(root, id, []);
      return found.length ? found[0] : null;
    },
    createElement: function (tag) { return new Node(tag, {}); },
    body: root.querySelector('body') || new Node('body', {}),
    documentElement: { style: { setProperty: function () {} } }
  };
  var i;
  for (i = 0; i < root.children.length; i++) root.children[i].parentNode = document;
  var window = {
    handlers: {},
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: Node.prototype.addEventListener
  };
  var location = { hash: options.hash || '' };
  var history = { replaceState: function (state, title, url) {
    location.hash = String(url).replace(/^[^#]*/, '');
  } };

  global.document = document;
  global.window = window;
  global.location = location;
  global.history = history;
  /* navigator в node свой и только для чтения; ui.js смотрит на него
     лишь в копировании NVR, которое заглушкой не проверяется. */
  global.FileReader = FileReader;
  delete global.ResizeObserver;

  return {
    document: document, window: window, location: location,
    id: function (name) {
      var node = document.getElementById(name);
      if (!node) throw new Error('в шаблоне нет id="' + name + '"');
      return node;
    },
    fire: function (node, type, extra) { return dispatch(node, type, extra); },
    fireWindow: function (type) {
      var list = window.handlers[type] || [], j;
      for (j = 0; j < list.length; j++) list[j]({ type: type });
    },
    /* Ждём макрозадачи: столько же живёт чтение файла в заглушке. */
    tick: function () {
      return new Promise(function (done) { setTimeout(done, 1); });
    }
  };
}

module.exports = { install: install, file: file, Node: Node, parse: parse };
