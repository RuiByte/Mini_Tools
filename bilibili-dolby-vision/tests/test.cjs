const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(process.env.P84_SCRIPT || path.join(__dirname, '..', 'bilibili-dolby-vision.user.js'), 'utf8');
// Metadata-only fixtures extracted from the credited public Jellyfin samples.
// See fixtures/THIRD_PARTY_NOTICES.md; no full test-video download is required.
const p84 = fs.readFileSync(path.join(__dirname, 'fixtures', 'p84-init.bin'));
const p5 = fs.readFileSync(path.join(__dirname, 'fixtures', 'p5-init.bin'));
const cfg = Math.max(p84.indexOf(Buffer.from('dvcC')), p84.indexOf(Buffer.from('dvvC')));
const hdr = Buffer.from(p84); hdr.write('free', cfg);
const p81 = Buffer.from(p84); p81[cfg + 8] = 0x10;
const noRpu = Buffer.from(p84); noRpu[cfg + 7] &= ~4;
const mime = 'video/mp4;codecs="hvc1.2.4.L153.90"';
const apiUrl = 'https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1AnotherClip&cid=123';
const mediaUrl = 'https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/23/01/123/123-1-30126.m4s?deadline=100&token=a';
function payload({ ambiguous = false, url = mediaUrl, more = [] } = {}) {
  return { data: { support_formats: [{ quality: 126, codecs: ['hvc1.2.4.L153.90'] },
    { quality: ambiguous ? 125 : 120, codecs: [ambiguous ? 'hvc1.2.4.L153.90' : 'avc1.640034'] }],
    dash: { video: [{ id: 126, codecs: 'hvc1.2.4.L153.90', baseUrl: url, width: 1920, height: 1080,
      SegmentBase: { Initialization: `0-${p84.length - 1}` } }, ...more] } } };
}
function env({ store = new Map(), supported = true, rejectCreate = false, part = 1, ambiguous = false,
  ssr = false, probe = 'fail', fixture = p84, url = mediaUrl, more = [], paused = true,
  playerReady = true, navigateDuringSwitch = false, rejectSwitch = false, noBody = false,
  hiddenRange = false, slowProbe = false, routeInNativeReload = false } = {}) {
  const events = [], tasks = new Map(); let tick = 0, seq = 0, quality = 126;
  class SourceBuffer {
    constructor() { this.updating = false; }
    changeType(type) { events.push({ kind: 'change', type }); throw new DOMException('codec switching prohibited', 'NotSupportedError'); }
    appendBuffer(data) {
      if (this.updating) throw new DOMException('busy', 'InvalidStateError');
      events.push({ kind: 'append', data });
    }
  }
  class MediaSource {
    static isTypeSupported() { return supported; }
    addSourceBuffer(type) {
      events.push({ kind: 'create', type });
      if (rejectCreate && type.includes('dvh1')) throw new DOMException('unsupported', 'NotSupportedError');
      return new SourceBuffer();
    }
  }
  class XMLHttpRequest {
    constructor() { this.listeners = []; this.readyState = 0; }
    addEventListener(name, cb) { if (name === 'readystatechange') this.listeners.push(cb); }
    open(method, url) { this.url = url; }
    complete(json, text = false) {
      this.readyState = 4; this.responseType = text ? '' : 'json'; this.response = json;
      this.responseText = JSON.stringify(json); for (const cb of this.listeners) cb();
    }
  }
  const data = payload({ ambiguous, url, more });
  const initial = { bvid: 'BV1AnotherClip', cid: part === 1 ? 123 : 456,
    videoData: { bvid: 'BV1AnotherClip', pages: [{ page: 1, cid: 123 }, { page: 2, cid: 456 }] } };
  const location = new URL(`https://www.bilibili.com/video/BV1AnotherClip/?p=${part}`);
  location.reload = () => { events.push({ kind: 'PAGE_RELOAD' }); throw Error('Unexpected page reload'); };
  const video = { paused, currentTime: 87.5, pause() { this.paused = true; events.push({ kind: 'pause' }); },
    async play() { this.paused = false; events.push({ kind: 'play' }); } };
  const browserEvents = new EventTarget();
  class History {
    pushState(state, unused, url) { if (url != null) location.href = new URL(url, location.href).href; }
    replaceState(state, unused, url) { if (url != null) location.href = new URL(url, location.href).href; }
  }
  const nativePush = History.prototype.pushState, nativeReplace = History.prototype.replaceState;
  const history = new History();
  const window = { MediaSource, SourceBuffer, XMLHttpRequest, __INITIAL_STATE__: initial, history,
    addEventListener: browserEvents.addEventListener.bind(browserEvents),
    removeEventListener: browserEvents.removeEventListener.bind(browserEvents),
    dispatchEvent: browserEvents.dispatchEvent.bind(browserEvents) };
  const response = { ok: true, async json() { return data; }, clone() { return { async json() { return data; } }; } };
  window.fetch = async (input, options) => {
    if (String(input).includes('/playurl?')) { events.push({ kind: 'api', input, options }); return response; }
    if (String(input).includes('/x/web-interface/view?')) {
      const bv = new URL(input).searchParams.get('bvid'); events.push({ kind: 'view', bvid: bv });
      return { ok: true, async json() { return { code: 0, data: { bvid: bv,
        pages: [{ page: 1, cid: bv === 'BV1ThirdClip' ? 901 : 789 }, { page: 2, cid: 790 }] } }; } };
    }
    events.push({ kind: 'probe', input, options });
    if (probe === 'fail') throw new TypeError('CORS/network unavailable');
    if (probe === 'timeout') return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))));
    if (noBody) return { status: 200, ok: true, body: null };
    if (slowProbe) await new Promise(resolve => { const id = ++seq; tasks.set(id, { fn: resolve, at: tick + 500 }); });
    return new Response(fixture, { status: 206, headers: hiddenRange ? {} : { 'content-range': `bytes 0-${fixture.length - 1}/${fixture.length}` } });
  };
  if (ssr) window.__playinfo__ = data;
  const player = {
    getQuality() { return { nowQ: quality }; }, mediaElement() { return video; },
    async connect() {
      events.push({ kind: 'connect' });
      new MediaSource().addSourceBuffer(mime).appendBuffer(fixture);
      return 'connected';
    },
    async reload(config) {
      events.push({ kind: 'playerReload', config });
      if (rejectSwitch) throw Error('player reload rejected');
      if (navigateDuringSwitch) { location.search = '?p=2'; return true; }
      if (routeInNativeReload && config?.bvid) history.replaceState(null, '', `/video/${config.bvid}/?p=${config.p || 1}`);
      video.currentTime = 0; video.paused = false;
      new MediaSource().addSourceBuffer(mime).appendBuffer(fixture);
      return true;
    },
    async seek(time) { events.push({ kind: 'seek', time }); video.currentTime = time; },
    async requestQuality(q, audio) {
      events.push({ kind: 'quality', q, audio });
      if (rejectSwitch) throw Error('player switch rejected');
      quality = q;
      if (navigateDuringSwitch && q !== 126) location.search = '?p=2';
      if (q === 126) new MediaSource().addSourceBuffer(mime).appendBuffer(fixture);
    }
  };
  if (playerReady) window.player = player;
  const document = { querySelector() { return video; } };
  class ClockDate extends Date { static now() { return 1800000000000 + tick; } }
  const context = vm.createContext({ window, document, location, Date: ClockDate,
    URL, ArrayBuffer, Uint8Array, DataView, DOMException, AbortController,
    setTimeout(fn, ms) { const id = ++seq; tasks.set(id, { fn, at: tick + ms }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    localStorage: { getItem(k) { return store.get(k) || null; }, setItem(k, v) { store.set(k, v); } },
    console: { info() {}, warn() {} } });
  const nativeAdd = MediaSource.prototype.addSourceBuffer;
  vm.runInContext(source, context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  async function advance(ms) {
    const target = tick + ms; await settle();
    for (let n = 0; n < 1000; n++) {
      const next = [...tasks].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      tick = next[1].at; tasks.delete(next[0]); next[1].fn(); await settle();
    }
    tick = target; await settle();
  }
  function api(requestUrl = apiUrl, value = data, text = false) {
    const request = new XMLHttpRequest(); request.open('GET', requestUrl); request.complete(value, text); return request;
  }
  return { window, MediaSource, SourceBuffer, events, store, context, api, response, nativeAdd, player, data, video,
    advance, settle, location, history, nativePush, nativeReplace,
    setQuality(q) { quality = q; }, records: window.__BILI_DV_P84_AUTO__.records };
}
function learn(store = new Map()) {
  const e = env({ store }); e.api(); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84); return e;
}
let n = 0;
async function run(name, test) {
  if (process.env.P84_REGRESSION_ONLY && !name.startsWith('V6:')) return;
  await test(); n++; console.log('PASS:', name);
}
(async () => {
  await run('Cold fetch: actual metadata is verified before returning playurl; first buffer is DV without reload', async () => {
    const e = env({ probe: 'ok' }); assert.equal(await e.window.fetch(apiUrl), e.response);
    new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    await e.advance(300); assert(!e.events.some(x => ['change', 'PAGE_RELOAD', 'quality'].includes(x.kind)));
    assert(e.records.some(x => x.status === 'p84-preverified'));
  });
  await run('Cold XHR fallback replaces the media pipeline once and restores position/pause, without quality-switch assumptions', async () => {
    const e = learn(); await e.advance(1000);
    assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
    assert(!e.events.some(x => x.kind === 'quality'));
    assert.match(e.events.filter(x => x.kind === 'create').at(-1).type, /dvh1\.08\.05/);
    assert(!e.events.some(x => ['change', 'PAGE_RELOAD'].includes(x.kind)));
    assert.equal(e.video.currentTime, 87.5); assert.equal(e.video.paused, true);
    assert(e.records.some(x => x.status === 'p84-player-rebuilt'));
    new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84); await e.advance(1000);
    assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
  });
  await run('Verified cache survives 48 hours, a new script instance and query signature rotation', async () => {
    const store = new Map(); learn(store);
    const e = env({ store, url: mediaUrl.replace('deadline=100&token=a', 'deadline=999&token=b') });
    await e.advance(48 * 3600000); e.api();
    new e.MediaSource().addSourceBuffer(mime);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(!e.events.some(x => x.kind === 'probe'));
  });
  await run('Changed stream pathname invalidates cache rather than reusing old DV metadata', () => {
    const store = new Map(); learn(store); const e = env({ store, url: mediaUrl.replace('30126.m4s', '30126-new.m4s') }); e.api();
    new e.MediaSource().addSourceBuffer(mime); assert.equal(e.events.find(x => x.kind === 'create').type, mime);
  });
  await run('Actual ordinary HDR, P8.1, P5 and no-RPU fixtures are never promoted to P8.4', async () => {
    for (const fixture of [hdr, p81, p5, noRpu]) {
      const e = env({ fixture, probe: 'ok' }); await e.window.fetch(apiUrl);
      new e.MediaSource().addSourceBuffer(mime).appendBuffer(fixture); await e.advance(300);
      assert.equal(e.events.find(x => x.kind === 'create').type, mime);
      assert(!e.events.some(x => x.kind === 'quality'));
      assert(!e.records.some(x => x.status === 'p84-preverified'));
    }
  });
  await run('Codec shared with ordinary HDR stays unchanged even after real DV initialization arrives', async () => {
    const e = env({ ambiguous: true, probe: 'ok' }); e.api();
    new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84); await e.advance(500);
    assert.equal(e.events.find(x => x.kind === 'create').type, mime);
    assert(!e.events.some(x => ['probe', 'quality'].includes(x.kind)));
  });
  await run('Two different DV stream identities sharing one codec block ambiguous promotion', async () => {
    const extra = payload({ url: mediaUrl.replace('30126.m4s', '30126-other.m4s') }).data.dash.video[0];
    const e = env({ more: [extra], probe: 'ok' }); e.api();
    new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84); await e.advance(300);
    assert(!e.events.some(x => ['probe', 'quality'].includes(x.kind)));
  });
  await run('Sibling CID prefetch and part changes cannot authorize the current page', () => {
    const store = new Map(); learn(store); const e = env({ store });
    e.api(apiUrl.replace('cid=123', 'cid=456')); new e.MediaSource().addSourceBuffer(mime);
    assert.equal(e.events[0].type, mime);
    const second = env({ store, part: 2 }); second.api(apiUrl.replace('cid=123', 'cid=456'));
    new second.MediaSource().addSourceBuffer(mime); assert.equal(second.events.find(x => x.kind === 'create').type, mime);
  });
  await run('User ordinary-quality choice cancels automatic quality switching', async () => {
    const e = learn(); e.setQuality(120); await e.advance(500);
    assert(!e.events.some(x => ['quality', 'playerReload'].includes(x.kind)));
  });
  await run('Navigation during player rebuild prevents seeking or changing the new video', async () => {
    const e = env({ navigateDuringSwitch: true }); e.api(); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    await e.advance(500); assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
    assert(!e.events.some(x => ['seek', 'quality', 'pause', 'play'].includes(x.kind)));
  });
  await run('Temporarily absent player interface is retried without page reload', async () => {
    const e = env({ playerReady: false }); e.api(); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    await e.advance(300); e.window.player = e.player; await e.advance(500);
    assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
  });
  await run('Player rejection stops without a quality-switch loop', async () => {
    const e = env({ rejectSwitch: true }); e.api(); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    await e.advance(10000); assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
    assert(e.records.some(x => x.status === 'player-rebuild-unavailable'));
  });
  await run('Native capability failure and native DV construction rejection retain HEVC fallback', async () => {
    const store = new Map(); learn(store);
    const e = env({ store, supported: false }); e.api(); new e.MediaSource().addSourceBuffer(mime);
    assert.equal(e.events.find(x => x.kind === 'create').type, mime);
    const r = env({ store, rejectCreate: true }); r.api(); new r.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    assert.deepEqual(r.events.filter(x => x.kind === 'create').map(x => x.type), ['video/mp4;codecs="dvh1.08.05"', mime]);
  });
  await run('Timeout cancels metadata request and returns original API response unchanged', async () => {
    const e = env({ probe: 'timeout' }); const task = e.window.fetch(apiUrl);
    await e.settle(); await e.advance(5100); assert.equal(await task, e.response);
    assert(e.events.find(x => x.kind === 'probe').options.signal.aborted);
  });
  await run('Untrusted media hosts and absent stream body cannot authorize DV', async () => {
    const e = env({ probe: 'ok', url: 'https://untrusted.example/media.mp4' }); await e.window.fetch(apiUrl);
    assert(!e.events.some(x => x.kind === 'probe'));
    const r = env({ probe: 'ok', noBody: true }); await r.window.fetch(apiUrl);
    new r.MediaSource().addSourceBuffer(mime); assert.equal(r.events.find(x => x.kind === 'create').type, mime);
  });
  await run('SSR startup race and metadata arriving before manifest both recover without refresh', async () => {
    const e = env({ ssr: true }); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    await e.advance(500); assert(e.records.some(x => x.status === 'p84-player-rebuilt'));
    const r = env(); new r.MediaSource().addSourceBuffer(mime).appendBuffer(p84); r.api();
    await r.advance(500); assert(r.records.some(x => x.status === 'p84-player-rebuilt'));
  });
  await run('Stale same-identity metadata is cleared if actual initialization contradicts it', () => {
    const store = new Map(); learn(store); const e = env({ store }); e.api();
    const b = new e.MediaSource().addSourceBuffer(mime);
    assert.throws(() => b.appendBuffer(hdr), { name: 'NotSupportedError' });
    assert(e.records.some(x => x.status === 'cache-mismatch'));
  });
  await run('Truncated metadata remains untouched; native append errors and restore remain intact', async () => {
    const e = env(); e.api(); const b = new e.MediaSource().addSourceBuffer(mime);
    b.appendBuffer(p84.subarray(0, p84.length - 2));
    b.updating = true; assert.throws(() => b.appendBuffer(p84), { name: 'InvalidStateError' });
    assert(!e.store.size); e.window.__BILI_DV_P84_AUTO__.restore();
    await e.advance(10000); assert.equal(e.MediaSource.prototype.addSourceBuffer, e.nativeAdd);
    assert(!e.events.some(x => x.kind === 'quality'));
    assert(!source.includes('location.reload')); assert(!source.includes('86400000'));
  });
  await run('Regression: CORS-hidden Content-Range does not discard a valid offset-zero initialization segment', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    await e.window.fetch(apiUrl); new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.records.some(x => x.status === 'p84-preverified'));
  });
  await run('First player.connect waits for a cold delayed metadata probe, then the very first buffer uses DV', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, slowProbe: true });
    const connected = e.window.player.connect();
    await e.settle(); assert(!e.events.some(x => x.kind === 'connect'));
    await e.advance(600); assert.equal(await connected, 'connected');
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(!e.events.some(x => ['quality', 'playerReload', 'PAGE_RELOAD', 'change'].includes(x.kind)));
    assert(e.events.find(x => x.kind === 'api').options.credentials === 'include');
    assert(e.events.find(x => x.kind === 'probe').options.credentials === 'omit');
    assert(e.records.some(x => x.status === 'startup-precheck-ready' && x.verified));
  });
  await run('Global player assignment is intercepted before the page immediately invokes connect', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, playerReady: false });
    e.window.player = e.player;
    await e.window.player.connect();
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
  });
  await run('SSR connect waits for the original observation task rather than racing a duplicate precheck', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, slowProbe: true, ssr: true });
    const task = e.window.player.connect(); await e.settle(); await e.advance(600); await task;
    assert.equal(e.events.filter(x => x.kind === 'probe').length, 1);
    assert(!e.events.some(x => x.kind === 'api'));
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
  });
  await run('If startup precheck fails, native connect still runs and actual init triggers one in-player recovery', async () => {
    const e = env({ probe: 'fail', paused: false });
    await e.window.player.connect(); await e.advance(500);
    assert(e.events.some(x => x.kind === 'connect'));
    assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
    assert.equal(e.video.currentTime, 87.5); assert.equal(e.video.paused, false);
    assert(e.records.some(x => x.status === 'p84-player-rebuilt'));
  });
  await run('Restore preserves the latest global player and restores its original connect implementation', async () => {
    const e = env({ playerReady: false, probe: 'ok' });
    const nativeConnect = e.player.connect;
    e.window.player = e.player;
    assert.notEqual(e.window.player.connect, nativeConnect);
    e.window.__BILI_DV_P84_AUTO__.restore();
    assert.equal(e.window.player, e.player); assert.equal(e.window.player.connect, nativeConnect);
    assert.equal(typeof Object.getOwnPropertyDescriptor(e.window, 'player').value, 'object');
  });
  await run('V6: Recommendation reuses the player with stale initial state; native reload waits and its first buffer is DV', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, slowProbe: true });
    const config = { bvid: 'BV1Recommended', cid: 789, p: 1, t: 0, stats: { spmId: '333.788.0.0' } };
    e.history.pushState(null, '', '/video/BV1Recommended/');
    const task = e.player.reload(config); await e.settle();
    assert(!e.events.some(x => x.kind === 'playerReload'));
    await e.advance(1200); await task;
    assert.equal(e.window.__INITIAL_STATE__.videoData.bvid, 'BV1AnotherClip');
    assert.equal(e.events.filter(x => x.kind === 'playerReload').length, 1);
    assert.equal(e.events.find(x => x.kind === 'playerReload').config, config);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.records.some(x => x.status === 'navigation-precheck-ready' && x.page === 'BV1Recommended:1' && x.verified));
    assert(!e.events.some(x => ['PAGE_RELOAD', 'change'].includes(x.kind)));
  });
  await run('V6: Recommendation reload is requested before URL commit; explicit BV/CID still initializes the correct stream', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, routeInNativeReload: true });
    await e.player.reload({ bvid: 'BV1Recommended', cid: 789, p: 1 });
    assert.equal(e.location.pathname, '/video/BV1Recommended/');
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.events.some(x => x.kind === 'api' && new URL(x.input).searchParams.get('cid') === '789'));
    assert(e.records.some(x => x.status === 'p84-created' && x.page === 'BV1Recommended:1'));
  });
  await run('V6: Explicit reload target identifies new buffers even before the router commits the new URL', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    await e.player.reload({ bvid: 'BV1Recommended', cid: 789, p: 1 });
    assert.equal(e.location.pathname, '/video/BV1AnotherClip/');
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.records.some(x => x.status === 'p84-created' && x.page === 'BV1Recommended:1'));
    e.history.pushState(null, '', '/video/BV1Recommended/');
    assert.equal(JSON.parse(e.window.__BILI_DV_P84_AUTO__.diagnostics()).page, 'BV1Recommended:1');
  });
  await run('V6: Part switch uses the new CID and retains player.reload arguments', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    const config = { bvid: 'BV1AnotherClip', cid: 456, p: 2, t: 15 };
    e.history.replaceState(null, '', '/video/BV1AnotherClip/?p=2');
    await e.player.reload(config);
    assert(e.events.some(x => x.kind === 'api' && new URL(x.input).searchParams.get('cid') === '456'));
    assert.equal(e.events.find(x => x.kind === 'playerReload').config, config);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.records.some(x => x.status === 'p84-created' && x.page === 'BV1AnotherClip:2'));
  });
  await run('V6: A playurl response after SPA navigation resolves a fresh BV/part map instead of reading stale initial state', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    e.history.pushState(null, '', '/video/BV1Recommended/');
    await e.window.fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1Recommended&cid=789');
    new e.MediaSource().addSourceBuffer(mime).appendBuffer(p84);
    assert.equal(e.events.filter(x => x.kind === 'view').length, 1);
    assert.match(e.events.find(x => x.kind === 'create').type, /dvh1\.08\.05/);
    assert(e.records.some(x => x.status === 'manifest-observed' && x.page === 'BV1Recommended:1'));
  });
  await run('V6: Fast recommendation B then C cancels B before native reload, keeping only C', async () => {
    const e = env({ probe: 'ok', hiddenRange: true, slowProbe: true });
    e.history.pushState(null, '', '/video/BV1Recommended/');
    const b = e.player.reload({ bvid: 'BV1Recommended', cid: 789, p: 1 });
    e.history.pushState(null, '', '/video/BV1ThirdClip/');
    const c = e.player.reload({ bvid: 'BV1ThirdClip', cid: 901, p: 1 });
    await e.advance(1500); assert.equal(await b, false); assert.equal(await c, true);
    const calls = e.events.filter(x => x.kind === 'playerReload');
    assert.equal(calls.length, 1); assert.equal(calls[0].config.bvid, 'BV1ThirdClip');
    assert(e.records.some(x => x.status === 'p84-created' && x.page === 'BV1ThirdClip:1'));
    assert(!e.events.some(x => x.kind === 'PAGE_RELOAD'));
  });
  await run('V6: Wrong sibling CID cannot promote a recommendation even when BV matches', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    e.history.pushState(null, '', '/video/BV1Recommended/');
    await e.window.fetch('https://api.bilibili.com/x/player/wbi/playurl?bvid=BV1Recommended&cid=790');
    new e.MediaSource().addSourceBuffer(mime);
    assert.equal(e.events.find(x => x.kind === 'create').type, mime);
    assert(!e.records.some(x => x.status === 'manifest-observed' && x.page === 'BV1Recommended:1'));
  });
  await run('V6: popstate begins fresh navigation preparation, and restoring the patch restores history methods', async () => {
    const e = env({ probe: 'ok', hiddenRange: true });
    e.location.href = 'https://www.bilibili.com/video/BV1Recommended/';
    e.window.dispatchEvent(new Event('popstate'));
    await e.advance(100);
    assert(e.records.some(x => x.status === 'route-changed' && x.page === 'BV1Recommended:1'));
    assert(e.events.some(x => x.kind === 'view' && x.bvid === 'BV1Recommended'));
    e.window.__BILI_DV_P84_AUTO__.restore();
    assert.equal(e.history.pushState, e.nativePush); assert.equal(e.history.replaceState, e.nativeReplace);
  });
  console.log(`All ${n} tests passed. This verifies script logic, not live Edge video output.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
