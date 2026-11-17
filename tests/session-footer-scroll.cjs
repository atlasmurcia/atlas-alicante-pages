const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const index = fs.readFileSync('index.html', 'utf8');
const agenda = fs.readFileSync('modules/agenda.html', 'utf8');

assert.ok(index.includes('height:calc(100dvh - var(--atlas-session-footer-space,48px))!important'), 'Shell uses the dynamic viewport height');
assert.match(index, /agenda:'\.\/modules\/agenda\.html\?v=187'/);
assert.match(agenda, /\.modalback\.open\{overflow-y:auto;overscroll-behavior:contain/);
assert.match(agenda, /\.modal\{[^}]*max-height:calc\(100dvh - 24px[^}]*!important/);
assert.match(agenda, /\.modal\{[^}]*overflow:auto/);

const measureScript = index.match(/<script id="atlas-session-footer-measure-v232">([\s\S]*?)<\/script>/)?.[1];
assert.ok(measureScript, 'Session footer measurement script exists');

let observed;
let resizeListener;
let visualViewportResizeListener;
const styleValues = new Map();
const bar = {
  hidden: true,
  display: 'none',
  height: 48,
  getBoundingClientRect() { return { height: this.height }; },
};
const context = {
  document: {
    getElementById(id) { return id === 'atlasUserBar' ? bar : null; },
    documentElement: { style: { setProperty(name, value) { styleValues.set(name, value); } } },
  },
  getComputedStyle(element) { return { display: element.display }; },
  ResizeObserver: class { constructor(callback) { observed = callback; } observe() {} },
  window: {
    ResizeObserver: class { constructor(callback) { observed = callback; } observe() {} },
    addEventListener(type, callback) { if (type === 'resize') resizeListener = callback; },
    visualViewport: { addEventListener(type, callback) { if (type === 'resize') visualViewportResizeListener = callback; } },
  },
};
vm.runInNewContext(measureScript, context);
assert.equal(styleValues.get('--atlas-session-footer-space'), '0px', 'Hidden footer reserves no space');

bar.hidden = false;
bar.display = 'flex';
bar.height = 57;
observed();
assert.equal(styleValues.get('--atlas-session-footer-space'), '57px', 'Visible footer reserves its rendered height');

bar.height = 64;
resizeListener();
assert.equal(styleValues.get('--atlas-session-footer-space'), '64px', 'Viewport resize refreshes the reservation');

bar.display = 'none';
visualViewportResizeListener();
assert.equal(styleValues.get('--atlas-session-footer-space'), '0px', 'A temporarily hidden footer does not reduce the viewport');

console.log('Session footer and dialog scroll checks passed.');
