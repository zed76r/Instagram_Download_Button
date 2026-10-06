const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
  path.join(__dirname, 'instagram-download-button-enhanced.user.js'),
  'utf8',
);
const storyMediaMatch = source.match(/^  const STORY_MEDIA_RE = (.+);$/m);
const storyStart = source.indexOf('  function bestImageCandidate(');
const storyResolver = source.indexOf('  async function resolveStoryMedia()');
const storyEnd = source.indexOf('  function safeName(', storyResolver);
assert.ok(storyMediaMatch && storyStart >= 0 && storyResolver > storyStart && storyEnd > storyResolver);
const storyCode = source.slice(storyStart, storyEnd);

function videoFiber(videoFBID, depth = 2) {
  let fiber = {
    memoizedProps: {
      coreVideoPlayerMetaData: { videoFBID },
    },
  };
  for (let i = 0; i < depth; i++) fiber = { return: fiber };
  return fiber;
}

function makeVideo(videoFBID, { depth = 2, hideFiber = true } = {}) {
  const attributes = new Map();
  const pageVideo = {
    tagName: 'VIDEO',
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
  };
  if (videoFBID != null) {
    Object.defineProperty(pageVideo, '__reactFiber$fixture', {
      value: videoFiber(videoFBID, depth),
      configurable: true,
      enumerable: true,
    });
  }

  const contentVideo = hideFiber
    ? new Proxy(pageVideo, {
        ownKeys(target) {
          return Reflect.ownKeys(target).filter(key => !String(key).startsWith('__reactFiber$'));
        },
      })
    : pageVideo;
  return { attributes, contentVideo, pageVideo };
}

function storyHarness({ pathname, selected, videos = [selected], responses = {}, domUrl = 'blob:visible-story' }) {
  const apiCalls = [];
  const scripts = [];
  let currentDomUrl = domUrl;
  let context;
  const document = {
    querySelector(selector) {
      return selector === 'script[nonce]' ? { nonce: 'fixture-nonce' } : null;
    },
    querySelectorAll(selector) {
      if (selector !== 'video[data-igdl26-story-target]') return [];
      return videos
        .map(video => video.pageVideo)
        .filter(video => video.getAttribute('data-igdl26-story-target') !== null);
    },
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {
        tagName: 'SCRIPT',
        textContent: '',
        nonce: '',
        removed: false,
        remove() {
          this.removed = true;
        },
      };
    },
    documentElement: {
      appendChild(script) {
        scripts.push(script);
        vm.runInContext(script.textContent, context);
        return script;
      },
    },
  };

  context = vm.createContext({
    document,
    location: { pathname },
    findVisibleMedia(scope, story) {
      assert.equal(scope, document);
      assert.equal(story, true);
      return selected?.contentVideo || null;
    },
    async fetchInfo(mediaId) {
      if (!mediaId) return null;
      apiCalls.push(mediaId);
      return Object.hasOwn(responses, mediaId) ? responses[mediaId] : null;
    },
    domMediaUrl(scope, story) {
      assert.equal(scope, document);
      assert.equal(story, true);
      return currentDomUrl;
    },
  });

  const functions = vm.runInContext(
    `const STORY_MEDIA_RE = ${storyMediaMatch[1]};\n${storyCode}\n({ resolveStoryMedia })`,
    context,
  );
  return {
    apiCalls,
    scripts,
    resolveStoryMedia: functions.resolveStoryMedia,
    setDomUrl(url) {
      currentDomUrl = url;
    },
  };
}

test('resolves a story video from its visible video fiber and cleans the bridge', async () => {
  const selected = makeVideo('9876543210');
  const harness = storyHarness({
    pathname: '/stories/alice/',
    selected,
    responses: {
      '9876543210': {
        items: [{
          video_versions: [
            { width: 640, height: 360, url: 'https://cdn.example/story-small.mp4' },
            { width: 1280, height: 720, url: 'https://cdn.example/story-medium.mp4' },
            { width: 1920, height: 1080, url: 'https://cdn.example/story-full.mp4' },
          ],
        }],
      },
    },
  });

  const result = await harness.resolveStoryMedia();

  assert.deepEqual(harness.apiCalls, ['9876543210']);
  assert.equal(result.url, 'https://cdn.example/story-full.mp4');
  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.scripts[0].nonce, 'fixture-nonce');
  assert.equal(harness.scripts[0].removed, true);
  assert.deepEqual([...selected.attributes.keys()], []);
});

test('keeps using the media ID from a story URL without running the page bridge', async () => {
  const selected = makeVideo('9876543210');
  const harness = storyHarness({
    pathname: '/stories/alice/1234567890/',
    selected,
    responses: {
      '1234567890': {
        items: [{ video_versions: [{ width: 1280, height: 720, url: 'https://cdn.example/url-id.mp4' }] }],
      },
    },
  });

  const result = await harness.resolveStoryMedia();

  assert.deepEqual(harness.apiCalls, ['1234567890']);
  assert.equal(result.url, 'https://cdn.example/url-id.mp4');
  assert.equal(harness.scripts.length, 0);
});

test('falls back to the visible DOM media when the API has no story item', async () => {
  const selected = makeVideo(null);
  const harness = storyHarness({
    pathname: '/stories/alice/1234567890/',
    selected,
    responses: { '1234567890': { items: [] } },
    domUrl: 'blob:visible-fallback',
  });

  const result = await harness.resolveStoryMedia();

  assert.deepEqual(harness.apiCalls, ['1234567890']);
  assert.equal(result.url, 'blob:visible-fallback');
});

test('rejects a nonnumeric videoFBID and falls back to the visible DOM media', async () => {
  const selected = makeVideo('123abc');
  const harness = storyHarness({
    pathname: '/stories/alice/',
    selected,
    domUrl: 'blob:invalid-id-fallback',
  });

  const result = await harness.resolveStoryMedia();

  assert.deepEqual(harness.apiCalls, []);
  assert.equal(result.url, 'blob:invalid-id-fallback');
  assert.equal(harness.scripts.length, 1);
  assert.deepEqual([...selected.attributes.keys()], []);
});

test('reads the selected video when other preloaded videos are present', async () => {
  const preloaded = makeVideo('1111111111');
  const selected = makeVideo('2222222222');
  const harness = storyHarness({
    pathname: '/stories/alice/',
    selected,
    videos: [preloaded, selected],
    responses: {
      '2222222222': {
        items: [{ video_versions: [{ width: 1920, height: 1080, url: 'https://cdn.example/selected.mp4' }] }],
      },
    },
  });

  const result = await harness.resolveStoryMedia();

  assert.deepEqual(harness.apiCalls, ['2222222222']);
  assert.equal(result.url, 'https://cdn.example/selected.mp4');
  assert.deepEqual([...preloaded.attributes.keys()], []);
  assert.deepEqual([...selected.attributes.keys()], []);
});

test('keeps the DOM fallback from the selected story while the API request is pending', async () => {
  const selected = makeVideo('3333333333');
  let resolveApi;
  const apiResponse = new Promise(resolve => {
    resolveApi = resolve;
  });
  const harness = storyHarness({
    pathname: '/stories/alice/',
    selected,
    responses: { '3333333333': apiResponse },
    domUrl: 'blob:story-a',
  });

  const resultPromise = harness.resolveStoryMedia();
  harness.setDomUrl('blob:story-b');
  resolveApi({ items: [] });

  const result = await resultPromise;

  assert.equal(result.url, 'blob:story-a');
});
