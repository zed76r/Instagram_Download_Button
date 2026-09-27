const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, 'instagram-download-button-enhanced.user.js'),
  'utf8',
);
const constants = source.slice(
  source.indexOf('  const ACTION_ICONS ='),
  source.indexOf('  const SVG_OPEN ='),
);
const detection = source.slice(
  source.indexOf('  function closestDirectChild('),
  source.indexOf('  function buildButton('),
);

function fixture(actions, { insideButton = false } = {}) {
  const scope = { querySelector: () => ({}) };
  const bar = {
    children: [],
    parentElement: scope,
    closest: () => insideButton ? {} : null,
    querySelector: () => null,
    getBoundingClientRect: () => ({ width: 240, height: 40 }),
    contains: node => bar.children.includes(node),
  };
  const labels = {
    like: '取消赞',
    comment: '评论',
    repost: '转发',
    share: '分享',
    save: '移除',
  };
  const icons = actions.map(kind => {
    const cell = {
      children: [],
      parentElement: bar,
      closest: () => null,
      querySelector: () => null,
      getBoundingClientRect: () => ({ width: 40, height: 40 }),
      contains: node => cell.children.includes(node),
    };
    const icon = {
      label: labels[kind],
      parentElement: cell,
      closest: selector => selector.includes('article') ? scope : null,
    };
    cell.children.push(icon);
    bar.children.push(cell);
    return icon;
  });
  const select = selector => icons.filter(icon =>
    selector.includes(`[aria-label="${icon.label}"]`));
  bar.querySelectorAll = select;
  const root = { querySelectorAll: select };
  const context = {
    PREFIX: 'igdl26',
    document: root,
    location: { pathname: '/p/example/' },
    shortcodeFrom: () => 'example',
    visible: () => true,
  };
  const { findActionBars, insertPointForBar } = vm.runInNewContext(
    `${constants}\n${detection}\n({ findActionBars, insertPointForBar })`,
    context,
  );
  return { bar, findActionBars, insertPointForBar };
}

test('finds a post toolbar without a comment action', () => {
  const { bar, findActionBars, insertPointForBar } = fixture([
    'like', 'repost', 'share', 'save',
  ]);
  assert.equal(findActionBars().length, 1);
  assert.equal(findActionBars()[0], bar);
  assert.equal(insertPointForBar(bar), bar.children[2]);
});

test('still finds a regular post toolbar', () => {
  const { bar, findActionBars } = fixture([
    'like', 'comment', 'share', 'save',
  ]);
  assert.equal(findActionBars()[0], bar);
});

test('does not treat an interactive wrapper as a toolbar', () => {
  const { findActionBars } = fixture(
    ['like', 'repost', 'share', 'save'],
    { insideButton: true },
  );
  assert.equal(findActionBars().length, 0);
});
