// ==UserScript==
// @name         B站杜比视界P8.4自动识别修正
// @namespace    urn:codex:local:bilibili-dv-p84
// @version      6.0.0
// @description  支持推荐列表、分P及首次打开时预检P8.4；必要时自动恢复播放器，无24小时缓存期限。
// @match        https://www.bilibili.com/video/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// @updateURL    none
// @downloadURL  none
// ==/UserScript==

(() => {
  'use strict';
  const KEY = '__BILI_DV_P84_AUTO__';
  if (window[KEY] || location.hostname !== 'www.bilibili.com' || !location.pathname.startsWith('/video/')) return;
  const MS = window.MediaSource;
  const SB = window.SourceBuffer;
  if (!MS || !SB) return;
  const nativeAdd = MS.prototype.addSourceBuffer;
  const nativeAppend = SB.prototype.appendBuffer;
  const nativeChange = SB.prototype.changeType;
  if (typeof nativeAdd !== 'function' || typeof nativeAppend !== 'function' || typeof nativeChange !== 'function') {
    console.warn('[B站杜比P8.4] 当前浏览器缺少所需接口，保留原播放方式。');
    return;
  }
  const states = new WeakMap();
  const records = [];
  const hooks = [];
  const CACHE_KEY = '__bili_dv_p84_verified_v4__';
  const manifests = new Map();
  const pending = new Map();
  const probes = new Map();
  const rebuilds = new Set();
  const blocked = new Set();
  const timers = new Set();
  const controllers = new Set();
  const nativeFetch = typeof window.fetch === 'function' ? window.fetch : null;
  const xhrRequests = new WeakMap();
  const initialResponses = new WeakMap();
  const preparations = new Map();
  const armedPlayers = new WeakSet();
  const pageCids = new Map();
  const viewRequests = new Map();
  const cleanups = [];
  let playbackPage = null;
  let playbackOriginKey = null;
  let navigationVersion = 0;
  let reloadSerial = 0;
  let routeKey = identity()?.key;
  let restorePlayerSlot = null;
  const nativeParse = JSON.parse;
  let cache = {};
  try { cache = nativeParse(localStorage.getItem(CACHE_KEY) || '{}'); } catch (_) { /* The bounded metadata cache is optional. */ }
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) cache = {};
  const MAX_BOXES = 4096;
  const MAX_MOOV = 4 * 1024 * 1024;
  let active = true;
  function later(fn, ms) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (active) Promise.resolve().then(fn).catch(error => {
        if (active) record({ status: 'task-unavailable', reason: error.message });
      });
    }, ms);
    timers.add(timer);
    return timer;
  }
  function record(entry) {
    records.push(entry);
    if (records.length > 100) records.shift();
    console.info('[B站杜比P8.4]', entry);
  }
  function bytesOf(data) {
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new Uint8Array(data);
    return null;
  }
  function inspectInit(input) {
    const bytes = bytesOf(input);
    if (!bytes || bytes.byteLength < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let count = 0;
    const u32 = offset => view.getUint32(offset);
    function boxes(start, end, stopAfterType = null) {
      const result = [];
      while (start + 8 <= end) {
        if (++count > MAX_BOXES) throw new Error('box limit');
        let size = u32(start), header = 8;
        if (size === 1) {
          if (start + 16 > end) throw new Error('partial extended box');
          size = u32(start + 8) * 4294967296 + u32(start + 12);
          header = 16;
          if (!Number.isSafeInteger(size)) throw new Error('oversized box');
        } else if (size === 0) size = end - start;
        if (size < header || start + size > end) throw new Error('partial or invalid box');
        const type = String.fromCharCode(...bytes.subarray(start + 4, start + 8));
        result.push({ type, start, data: start + header, end: start + size });
        if (type === stopAfterType) return result;
        start += size;
      }
      if (start !== end) throw new Error('partial box header');
      return result;
    }
    const children = (parent, offset = 0) => boxes(parent.data + offset, parent.end);
    const child = (parent, type) => children(parent).find(box => box.type === type);
    try {
      // Only descend through the ISO BMFF video sample-description hierarchy.
      // Never search arbitrary media payload for matching byte sequences.
      const moov = boxes(0, bytes.byteLength, 'moov').find(box => box.type === 'moov');
      if (!moov || moov.end - moov.start > MAX_MOOV) return null;
      const videos = [];
      for (const track of children(moov).filter(box => box.type === 'trak')) {
        const mdia = child(track, 'mdia');
        const minf = mdia && child(mdia, 'minf');
        const stbl = minf && child(minf, 'stbl');
        const stsd = stbl && child(stbl, 'stsd');
        if (!stsd || stsd.end - stsd.data < 8) continue;
        const entries = children(stsd, 8);
        if (u32(stsd.data + 4) !== entries.length) return null;
        for (const sample of entries) {
          if (!['hvc1', 'hev1', 'dvh1', 'dvhe'].includes(sample.type)) continue;
          if (sample.end - sample.data < 78) return null;
          const configs = children(sample, 78).filter(box => ['dvcC', 'dvvC'].includes(box.type));
          if (configs.length > 1) return null;
          const config = configs[0];
          let dolby = null;
          if (config) {
            if (config.end - config.data < 5) return null;
            const c = config.data;
            dolby = {
              versionMajor: bytes[c],
              profile: bytes[c + 2] >> 1,
              level: ((bytes[c + 2] & 1) << 5) | (bytes[c + 3] >> 3),
              rpu: (bytes[c + 3] >> 2) & 1,
              enhancementLayer: (bytes[c + 3] >> 1) & 1,
              baseLayer: bytes[c + 3] & 1,
              compatibility: bytes[c + 4] >> 4
            };
          }
          videos.push({ sampleEntry: sample.type, dolby });
        }
      }
      // A mixed or ambiguous multi-video initialization segment is left alone.
      return videos.length === 1 ? videos[0] : null;
    } catch (_) {
      // Split or malformed initialization segments pass through unchanged.
      return null;
    }
  }
  function isHevcMime(type) {
    return typeof type === 'string' && /^video\/mp4\s*;/i.test(type) &&
      /\b(?:hvc1|hev1)(?:\.[a-z0-9]+)+/i.test(type);
  }
  function makeDolbyMime(type, dolby) {
    if (!dolby || dolby.versionMajor !== 1 || dolby.profile !== 8 || dolby.compatibility !== 4 ||
        dolby.rpu !== 1 || dolby.baseLayer !== 1 || dolby.enhancementLayer !== 0 ||
        !Number.isInteger(dolby.level) || dolby.level < 1 || dolby.level > 63) return null;
    const suffix = `08.${String(dolby.level).padStart(2, '0')}`;
    return type.replace(/\b(hvc1|hev1)(?:\.[a-z0-9]+)+/gi,
      (_, codec) => `${codec.toLowerCase() === 'hvc1' ? 'dvh1' : 'dvhe'}.${suffix}`);
  }
  function identity() {
    const match = /^\/video\/(BV[a-zA-Z0-9]+)\/?$/.exec(location.pathname);
    if (!match) return null;
    const part = Number(new URL(location.href).searchParams.get('p') || 1);
    if (!Number.isInteger(part) || part < 1) return null;
    return { bvid: match[1], part, key: `${match[1]}:${part}` };
  }
  function playingIdentity() {
    const route = identity();
    if (playbackPage && (route?.key === playbackPage.key || route?.key === playbackOriginKey)) return playbackPage;
    playbackPage = null;
    return route;
  }
  function knownCid(page) {
    if (!page) return null;
    const video = window.__INITIAL_STATE__?.videoData;
    const fromInitial = video?.bvid === page.bvid && video.pages?.find(p => Number(p.page) === page.part)?.cid;
    const cid = pageCids.get(page.key) || Number(fromInitial);
    return Number.isSafeInteger(cid) && cid > 0 ? cid : null;
  }
  async function resolveCid(page) {
    const known = knownCid(page);
    if (known || !nativeFetch) return known;
    if (!viewRequests.has(page.bvid)) {
      const task = (async () => {
        const controller = new AbortController(); controllers.add(controller);
        const timeout = setTimeout(() => controller.abort(), 3500);
        try {
          const response = await Reflect.apply(nativeFetch, window, [
            `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(page.bvid)}`,
            { credentials: 'include', signal: controller.signal }
          ]);
          if (!active || !response.ok) return;
          const value = await response.json();
          if (value?.code !== 0 || value.data?.bvid !== page.bvid || !Array.isArray(value.data.pages)) return;
          for (const part of value.data.pages) {
            const p = Number(part.page), cid = Number(part.cid);
            if (Number.isSafeInteger(p) && p > 0 && Number.isSafeInteger(cid) && cid > 0) pageCids.set(`${page.bvid}:${p}`, cid);
          }
        } catch (_) { /* A player.reload target can also supply the exact CID. */ }
        finally { clearTimeout(timeout); controllers.delete(controller); controller.abort(); }
      })();
      viewRequests.set(page.bvid, task);
      if (viewRequests.size > 64) viewRequests.delete(viewRequests.keys().next().value);
    }
    await viewRequests.get(page.bvid);
    return knownCid(page);
  }
  function codecOf(type) {
    return typeof type === 'string' ? type.match(/\b(?:hvc1|hev1)(?:\.[a-z0-9]+)+/i)?.[0].toLowerCase() : null;
  }
  function cacheId(page, type) { return `${page}|${codecOf(type)}`; }
  function saveCache() {
    // No clock-based expiry. A changed stream identity requires fresh verification.
    const entries = Object.entries(cache).filter(([, v]) => v && typeof v.fingerprint === 'string' && v.dolby)
      .sort((a, b) => (Number(b[1].time) || 0) - (Number(a[1].time) || 0)).slice(0, 512);
    cache = Object.fromEntries(entries);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_) { /* Keep an in-memory cache. */ }
  }
  function streamInfo(stream, cid) {
    const codec = codecOf(`video/mp4; codecs="${stream.codecs || ''}"`);
    if (Number(stream.id) !== 126 || !codec) return null;
    let url;
    try { url = new URL(stream.baseUrl || stream.base_url); } catch (_) { return null; }
    if (url.protocol !== 'https:' || url.username || url.password ||
        !/(?:^|\.)(?:bilivideo\.(?:com|cn|net)|hdslb\.com|akamaized\.net)$/.test(url.hostname)) return null;
    const range = String(stream.SegmentBase?.Initialization || stream.segment_base?.initialization || '0-65535');
    const match = /^(\d+)-(\d+)$/.exec(range);
    if (!match) return null;
    const start = Number(match[1]), end = Number(match[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start + 1 > MAX_MOOV) return null;
    // Signed query parameters and interchangeable CDN hosts are not stream identity.
    const fingerprint = JSON.stringify([String(cid), codec, url.pathname, `${start}-${end}`,
      stream.width || 0, stream.height || 0, stream.frameRate || stream.frame_rate || '']);
    return { codec, url: url.href, start, end, fingerprint };
  }
  function remember(page, type, dolby, fingerprint) {
    if (!fingerprint || !makeDolbyMime(type, dolby)) return;
    cache[cacheId(page, type)] = { time: Date.now(), fingerprint, dolby };
    saveCache();
  }
  async function probeStream(page, stream) {
    const type = `video/mp4; codecs="${stream.codec}"`;
    const cached = cache[cacheId(page, type)];
    if (cached?.fingerprint === stream.fingerprint && makeDolbyMime(type, cached.dolby)) return;
    if (!nativeFetch || blocked.has(stream.fingerprint)) return;
    if (probes.has(stream.fingerprint)) return probes.get(stream.fingerprint);
    const operation = (async () => {
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 5000);
      let reader;
      try {
        const response = await Reflect.apply(nativeFetch, window, [stream.url, {
          headers: { Range: `bytes=${stream.start}-${stream.end}` },
          credentials: 'omit', signal: controller.signal, cache: 'no-store'
        }]);
        if (!active || !response.ok || ![200, 206].includes(response.status) || !response.body ||
            (stream.start !== 0 && response.status !== 206)) return;
        if (response.status === 206) {
          const range = response.headers.get('content-range');
          // Content-Range is NOT CORS-safelisted: a successful CDN range response
          // can legitimately hide it. For offset zero, validate the actual BMFF
          // hierarchy instead; nonzero offsets still need an exposed range.
          if ((range && Number(/^bytes (\d+)-/i.exec(range)?.[1]) !== stream.start) ||
              (!range && stream.start !== 0)) return;
        }
        reader = response.body.getReader();
        const limit = stream.end - stream.start + 1;
        let bytes = new Uint8Array(0);
        while (active && bytes.length < limit) {
          const { done, value } = await reader.read();
          if (done || !active) break;
          const size = Math.min(value.byteLength, limit - bytes.length);
          const merged = new Uint8Array(bytes.length + size);
          merged.set(bytes); merged.set(value.subarray(0, size), bytes.length); bytes = merged;
          const init = inspectInit(bytes);
          if (init) {
            if (makeDolbyMime(type, init.dolby)) {
              remember(page, type, init.dolby, stream.fingerprint);
              record({ status: 'p84-preverified', page, codec: makeDolbyMime(type, init.dolby) });
              scheduleRebuild(page);
            } else {
              blocked.add(stream.fingerprint);
              delete cache[cacheId(page, type)]; saveCache();
            }
            return;
          }
        }
      } catch (error) {
        if (active) record({ status: 'probe-unavailable', page, reason: error.name,
          next: '改用实际初始化段识别，必要时自动重建播放器。' });
      } finally {
        clearTimeout(timeout); controllers.delete(controller);
        controller.abort();
        if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (_) { /* Already aborted. */ } }
      }
    })();
    probes.set(stream.fingerprint, operation);
    // A failed/cancelled probe may be retried using a fresh signed media URL.
    try { await operation; } finally { probes.delete(stream.fingerprint); }
  }
  function observePlayInfo(url, payload, expectedPage = null) {
    if (!active) return;
    const page = expectedPage || playingIdentity();
    if (!page) return;
    let request;
    try { request = new URL(url, location.href); } catch (_) { return; }
    if (!['api.bilibili.com', 'www.bilibili.com'].includes(request.hostname) || !/\/playurl$/.test(request.pathname)) return;
    // Associate a response with the exact current part, not preloaded sibling parts.
    const requestedBvid = request.searchParams.get('bvid');
    if (requestedBvid && requestedBvid !== page.bvid) return;
    const requestCid = Number(request.searchParams.get('cid'));
    if (!Number.isSafeInteger(requestCid) || requestCid <= 0) return;
    const expectedCid = knownCid(page);
    if (!expectedCid) {
      return resolveCid(page).then(cid => cid ? observePlayInfo(url, payload, page) : undefined);
    }
    if (requestCid !== expectedCid) return;
    const data = payload?.data || payload?.result;
    if (!data || !Array.isArray(data.support_formats)) return;
    const dv = new Set(), ordinary = new Set(), streams = new Map(), quality = new Set();
    for (const format of data.support_formats) {
      quality.add(Number(format.quality));
      for (const codec of format.codecs || []) {
        const normalized = codecOf(`video/mp4; codecs="${codec}"`);
        if (normalized) (Number(format.quality) === 126 ? dv : ordinary).add(normalized);
      }
    }
    for (const stream of data.dash?.video || []) {
      const normalized = codecOf(`video/mp4; codecs="${stream.codecs || ''}"`);
      if (normalized) (Number(stream.id) === 126 ? dv : ordinary).add(normalized);
      const info = streamInfo(stream, expectedCid);
      if (info) {
        if (!streams.has(info.codec)) streams.set(info.codec, []);
        if (!streams.get(info.codec).some(s => s.fingerprint === info.fingerprint)) streams.get(info.codec).push(info);
      }
    }
    // Some quality-switch responses omit previously advertised DV streams.
    const previous = manifests.get(page.key);
    if (previous) for (const [codec, values] of previous.streams) {
      if (!streams.has(codec) && dv.has(codec)) streams.set(codec, values);
    }
    manifests.set(page.key, { dv, ordinary, streams, quality });
    const waiting = pending.get(page.key);
    const matching = waiting && streams.get(codecOf(waiting.baseType));
    if (waiting && !waiting.fingerprint && matching?.length === 1 && !ordinary.has(matching[0].codec)) {
      waiting.fingerprint = matching[0].fingerprint;
      remember(page.key, waiting.baseType, waiting.dolby, waiting.fingerprint);
    }
    record({ status: 'manifest-observed', page: page.key, dvCodecs: [...dv], ambiguousCodecs: [...dv].filter(c => ordinary.has(c)) });
    scheduleRebuild(page.key);
    return Promise.all([...streams].filter(([codec, values]) => values.length === 1 && !ordinary.has(codec))
      .map(([, values]) => probeStream(page.key, values[0])));
  }
  function observeXhr(xhr) {
    const url = xhrRequests.get(xhr);
    if (!url || xhr.readyState !== 4) return;
    try {
      const value = xhr.responseType === 'json' ? xhr.response : nativeParse(xhr.responseText);
      const task = observePlayInfo(url, value);
      if (task) task.catch(() => {});
    } catch (_) { /* Do not interfere with the page's own response handling. */ }
  }
  function observeInitialPlayInfo() {
    const page = identity(), initial = window.__INITIAL_STATE__, value = window.__playinfo__;
    if (!page || !value || typeof value !== 'object') return;
    const cid = initial?.videoData?.pages?.find(p => Number(p.page) === page.part)?.cid;
    if (initial?.bvid !== page.bvid || !cid || String(initial.cid) !== String(cid)) return;
    if (initialResponses.has(value)) return initialResponses.get(value);
    const task = observePlayInfo(`https://api.bilibili.com/x/player/playurl?bvid=${page.bvid}&cid=${cid}`, value, page);
    if (task) { initialResponses.set(value, task); task.catch(() => {}); }
    return task;
  }
  function readyForPage(page) {
    const manifest = manifests.get(page);
    return manifest && [...manifest.dv].some(codec => candidateFor(`video/mp4; codecs="${codec}"`, page));
  }
  function preparePage(page) {
    if (preparations.has(page.key)) return preparations.get(page.key);
    const task = (async () => {
      await observeInitialPlayInfo();
      if (!active || readyForPage(page.key)) return;
      const manifest = manifests.get(page.key);
      if (manifest && !manifest.dv.size) return; // Known ordinary video.
      const cid = await resolveCid(page);
      if (!cid || !nativeFetch) return;
      const url = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(page.bvid)}&cid=${cid}&qn=126&fnval=4048&fourk=1`;
      const controller = new AbortController(); controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        // Use the viewer's existing membership in the page's own fetch context.
        // Read-only request; no cookies/tokens are copied into script storage.
        const response = await Reflect.apply(nativeFetch, window, [url, {
          credentials: 'include', signal: controller.signal
        }]);
        if (!active || !response.ok) return;
        const data = await response.json();
        clearTimeout(timeout); // The separate metadata probe has its own timeout.
        await observePlayInfo(url, data, page);
      } catch (error) {
        if (active) record({ status: 'startup-precheck-unavailable', page: page.key, reason: error.name });
      } finally {
        clearTimeout(timeout); controllers.delete(controller); controller.abort();
      }
    })();
    preparations.set(page.key, task);
    return task;
  }
  function armPlayer(player) {
    if (!active || !player || typeof player.connect !== 'function' || armedPlayers.has(player)) return;
    const descriptor = Object.getOwnPropertyDescriptor(player, 'connect');
    if (!descriptor?.configurable || typeof descriptor.value !== 'function') return;
    const original = descriptor.value;
    let connection, connectionPage;
    function connect(...args) {
      if (!active) return Reflect.apply(original, this, args);
      const page = playingIdentity(), receiver = this;
      if (connection && connectionPage === page?.key) return connection;
      connectionPage = page?.key;
      connection = (async () => {
        if (page) {
          record({ status: 'startup-precheck-wait', page: page.key });
          try { await preparePage(page); } catch (_) { /* Native startup remains available. */ }
          if (playingIdentity()?.key !== page.key || (window.player && window.player !== player)) return;
          record({ status: 'startup-precheck-ready', page: page.key, verified: !!readyForPage(page.key) });
        }
        return Reflect.apply(original, receiver, args);
      })();
      connection.catch(() => { connection = null; });
      return connection;
    }
    try {
      install(player, 'connect', connect);
      const reload = Object.getOwnPropertyDescriptor(player, 'reload');
      if (reload?.configurable && typeof reload.value === 'function') {
        const originalReload = reload.value;
        install(player, 'reload', async function (...args) {
          if (!active) return Reflect.apply(originalReload, this, args);
          const config = args[0], startPage = identity();
          let target = playingIdentity();
          if (config && typeof config === 'object' && /^BV[a-zA-Z0-9]+$/.test(config.bvid || '')) {
            const part = Number(config.p || 1), cid = Number(config.cid);
            if (Number.isSafeInteger(part) && part > 0) {
              target = { bvid: config.bvid, part, key: `${config.bvid}:${part}` };
              if (Number.isSafeInteger(cid) && cid > 0) pageCids.set(target.key, cid);
            }
          }
          if (!target) return Reflect.apply(originalReload, this, args);
          const serial = ++reloadSerial;
          record({ status: 'navigation-precheck-wait', page: target.key });
          try { await preparePage(target); } catch (_) { /* Native switching remains available. */ }
          // Cancel an older switch when another recommendation wins the race.
          if (serial !== reloadSerial || (window.player && window.player !== player)) return false;
          const route = identity();
          if (route?.key !== target.key && route?.key !== startPage?.key) return false;
          playbackPage = target;
          playbackOriginKey = route?.key;
          record({ status: 'navigation-precheck-ready', page: target.key, verified: !!readyForPage(target.key) });
          return Reflect.apply(originalReload, this, args);
        });
      }
      armedPlayers.add(player);
    } catch (_) { /* Observe actual init instead. */ }
  }
  function onRouteChange() {
    const page = identity();
    if (page?.key === routeKey) return;
    routeKey = page?.key; navigationVersion++;
    playbackPage = null;
    record({ status: 'route-changed', page: page?.key });
    if (page) {
      later(() => preparePage(page), 0);
      later(() => { armPlayer(window.player); scheduleRebuild(page.key); }, 100);
    }
  }
  function watchRoutes() {
    const history = window.history;
    if (history) for (const name of ['pushState', 'replaceState']) {
      const proto = Object.getPrototypeOf(history);
      const owner = Object.prototype.hasOwnProperty.call(history, name) ? history : proto;
      const native = owner?.[name];
      if (typeof native !== 'function') continue;
      try { install(owner, name, function (...args) {
        const result = Reflect.apply(native, this, args); onRouteChange(); return result;
      }); } catch (_) { /* The player.reload hook remains available. */ }
    }
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('popstate', onRouteChange);
      cleanups.push(() => window.removeEventListener('popstate', onRouteChange));
    }
  }
  function watchPlayer() {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'player');
    if (descriptor && (!descriptor.configurable || !('value' in descriptor) || !descriptor.writable)) {
      armPlayer(window.player); return;
    }
    let value = descriptor?.value;
    const get = () => value;
    const set = next => { value = next; armPlayer(next); };
    Object.defineProperty(window, 'player', { configurable: true, enumerable: descriptor?.enumerable ?? true, get, set });
    restorePlayerSlot = () => {
      if (Object.getOwnPropertyDescriptor(window, 'player')?.get !== get) return;
      Object.defineProperty(window, 'player', { ...(descriptor || { configurable: true, enumerable: true, writable: true }), value });
    };
    armPlayer(value);
  }
  function currentQuality(player) {
    const q = player.getQuality();
    return Number(typeof q === 'object' && q ? q.nowQ : q);
  }
  function scheduleRebuild(page, attempt = 0) {
    const state = pending.get(page);
    if (!state || playingIdentity()?.key !== page || !candidateFor(state.baseType, page)) return;
    const generation = navigationVersion;
    const token = `${generation}|${page}|${state.fingerprint}`;
    if (rebuilds.has(token) || state.scheduled) return;
    state.scheduled = true;
    later(async () => {
      state.scheduled = false;
      if (generation !== navigationVersion || pending.get(page) !== state || playingIdentity()?.key !== page) return;
      const player = window.player;
      if (typeof player?.reload !== 'function' || typeof player?.getQuality !== 'function') {
        if (attempt < 20) scheduleRebuild(page, attempt + 1);
        else record({ status: 'player-interface-unavailable', page, next: '自动重建接口不可用，请导出诊断。' });
        return;
      }
      let quality;
      try { quality = currentQuality(player); } catch (_) { return; }
      if (quality !== 126) {
        // The init can arrive before nowQ changes from the previous quality.
        let switchingToDV = false;
        try { switchingToDV = Number(player.getQuality()?.newQ) === 126; } catch (_) { /* No pending quality. */ }
        if (switchingToDV && attempt < 20) scheduleRebuild(page, attempt + 1);
        return; // Never override a user's ordinary-quality selection.
      }
      rebuilds.add(token);
      let video;
      try { video = player.mediaElement?.(); } catch (_) { /* Use the main video below. */ }
      video ||= document.querySelector('.bpx-player-video-wrap video, .bilibili-player-video video, video');
      const paused = video?.paused;
      const position = Number(video?.currentTime);
      const valid = () => active && generation === navigationVersion && playingIdentity()?.key === page && window.player === player;
      // Rebuild the whole media pipeline, not merely a seamless quality switch.
      const pauseIfNeeded = () => {
        if (paused && valid()) {
          try { (player.mediaElement?.() || video)?.pause(); } catch (_) { /* Detached media. */ }
        }
      };
      try {
        record({ status: 'p84-player-rebuilding', page, via: 'player.reload', position });
        const reloaded = player.reload();
        if (!reloaded || typeof reloaded.then !== 'function') throw new Error('player.reload did not return a Promise');
        const ok = await reloaded;
        if (!valid()) return;
        if (ok === false) throw new Error('player.reload failed');
        if (currentQuality(player) !== 126 && typeof player.requestQuality === 'function') await player.requestQuality(126, null);
        if (!valid()) return;
        if (Number.isFinite(position) && position > 0) {
          if (typeof player.seek === 'function') await player.seek(position);
          else { const media = player.mediaElement?.() || video; if (media) media.currentTime = position; }
        }
        if (!valid()) return;
        pauseIfNeeded();
        if (paused === false) {
          try { const media = player.mediaElement?.() || video; await media?.play(); } catch (_) { /* Respect autoplay policy. */ }
        }
        record({ status: pending.has(page) ? 'p84-player-rebuild-unconfirmed' : 'p84-player-rebuilt', page });
      } catch (error) {
        record({ status: 'player-rebuild-unavailable', page, reason: error.message,
          next: '请导出本脚本诊断；不循环重试。' });
      }
    }, attempt ? 250 : 100);
  }
  function candidateFor(type, page) {
    const codec = codecOf(type);
    const manifest = manifests.get(page);
    // A codec shared with ordinary HDR/SDR is deliberately not remapped.
    if (!codec || !manifest?.dv.has(codec) || manifest.ordinary.has(codec)) return null;
    const streams = manifest.streams.get(codec);
    if (!streams || streams.length !== 1 || blocked.has(streams[0].fingerprint)) return null;
    const known = cache[cacheId(page, type)];
    if (!known || known.fingerprint !== streams[0].fingerprint) return null;
    const candidate = makeDolbyMime(type, known.dolby);
    try { return candidate && MS.isTypeSupported(candidate) ? candidate : null; } catch (_) { return null; }
  }
  function install(prototype, name, replacement) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor || !descriptor.configurable || typeof descriptor.value !== 'function') throw new Error(`Cannot hook ${name}`);
    Object.defineProperty(prototype, name, { ...descriptor, value: replacement });
    hooks.push({ prototype, name, descriptor, replacement });
  }
  function addSourceBuffer(...args) {
    if (active) observeInitialPlayInfo();
    const page = playingIdentity();
    const candidate = active && page && isHevcMime(args[0]) ? candidateFor(args[0], page.key) : null;
    let buffer, chosen = args[0];
    if (candidate) {
      try {
        buffer = Reflect.apply(nativeAdd, this, [candidate, ...args.slice(1)]);
        chosen = candidate;
        pending.delete(page.key);
        record({ status: 'p84-created', page: page.key, before: args[0], after: candidate });
      } catch (error) {
        record({ status: 'create-rejected', error: `${error.name}: ${error.message}` });
      }
    }
    if (!buffer) buffer = Reflect.apply(nativeAdd, this, args);
    if (active && page && isHevcMime(args[0])) {
      const stream = manifests.get(page.key)?.streams.get(codecOf(args[0]));
      states.set(buffer, { page: page.key, baseType: args[0], currentType: chosen,
        fingerprint: stream?.length === 1 ? stream[0].fingerprint : null });
    }
    return buffer;
  }
  function changeType(...args) {
    const result = Reflect.apply(nativeChange, this, args);
    if (active) {
      const page = playingIdentity();
      if (page && isHevcMime(args[0])) {
        const stream = manifests.get(page.key)?.streams.get(codecOf(args[0]));
        states.set(this, { page: page.key, baseType: args[0], currentType: args[0],
          fingerprint: stream?.length === 1 ? stream[0].fingerprint : null });
      }
      else states.delete(this);
    }
    return result;
  }
  function appendBuffer(...args) {
    const state = active && states.get(this);
    if (state && !this.updating) {
      const init = inspectInit(args[0]);
      if (init) {
        const candidate = makeDolbyMime(state.baseType, init.dolby);
        if (candidate) {
          state.dolby = init.dolby;
          remember(state.page, state.baseType, init.dolby, state.fingerprint);
          if (state.currentType !== candidate) {
            pending.set(state.page, state);
            record({ status: 'p84-learned', page: state.page, codec: candidate,
              next: '准备自动重建播放器并恢复进度，不刷新网页。' });
            scheduleRebuild(state.page);
          } else {
            record({ status: 'p84-metadata-confirmed', page: state.page, codec: candidate });
          }
        } else if (state.currentType !== state.baseType) {
          // Do not silently present ordinary HDR under a stale DV declaration.
          delete cache[cacheId(state.page, state.baseType)]; saveCache();
          blocked.add(state.fingerprint);
          record({ status: 'cache-mismatch', next: '实际元数据已改变，已清除缓存；请切换普通画质恢复播放。' });
          throw new DOMException('Dolby Vision metadata changed; select ordinary quality to restore HEVC.', 'NotSupportedError');
        }
      }
    }
    // Preserve native append exceptions and the original BufferSource object.
    return Reflect.apply(nativeAppend, this, args);
  }
  function restore() {
    active = false;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const controller of controllers) controller.abort();
    for (const cleanup of cleanups) cleanup();
    if (restorePlayerSlot) restorePlayerSlot();
    for (const hook of hooks) {
      if (hook.prototype[hook.name] === hook.replacement) {
        Object.defineProperty(hook.prototype, hook.name, hook.descriptor);
      }
    }
  }
  try {
    install(MS.prototype, 'addSourceBuffer', addSourceBuffer);
    install(SB.prototype, 'changeType', changeType);
    install(SB.prototype, 'appendBuffer', appendBuffer);
    watchPlayer();
    watchRoutes();
    const XHR = window.XMLHttpRequest;
    if (XHR) {
      const originalOpen = XHR.prototype.open;
      install(XHR.prototype, 'open', function (method, url, ...rest) {
        let request;
        try { request = new URL(String(url), location.href); } catch (_) { /* Not an observable URL. */ }
        const tracked = request && ['api.bilibili.com', 'www.bilibili.com'].includes(request.hostname) && /\/playurl$/.test(request.pathname);
        if (tracked) {
          xhrRequests.set(this, request.href);
          this.addEventListener('readystatechange', () => observeXhr(this));
        } else xhrRequests.delete(this);
        return Reflect.apply(originalOpen, this, [method, url, ...rest]);
      });
    }
    if (typeof window.fetch === 'function') {
      const originalFetch = window.fetch;
      const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
      if (descriptor?.configurable) install(window, 'fetch', async function (...args) {
        const response = await Reflect.apply(originalFetch, this, args);
        try {
          const request = new URL(typeof args[0] === 'string' ? args[0] : args[0]?.url || String(args[0]), location.href);
          if (['api.bilibili.com', 'www.bilibili.com'].includes(request.hostname) && /\/playurl$/.test(request.pathname)) {
            await observePlayInfo(request.href, await response.clone().json());
          }
        } catch (_) { /* Return the original response unchanged. */ }
        return response;
      });
    }
  } catch (error) {
    restore();
    console.warn('[B站杜比P8.4] 未能启用补丁，保留原播放方式。', error.message);
    return;
  }
  window[KEY] = { version: '6.0.0', records, restore,
    diagnostics: () => JSON.stringify({ version: '6.0.0', page: playingIdentity()?.key, route: identity()?.key, records }, null, 2) };
  // Early SSR observation helps XHR/embedded-player startup; addSourceBuffer also checks it.
  let polls = 0;
  function pollInitial() {
    observeInitialPlayInfo();
    armPlayer(window.player);
    if (++polls < 40) later(pollInitial, 50);
  }
  pollInitial();
  console.info('[B站杜比P8.4 v6] 已启用：推荐列表/分P切换和首次启动均预检；按新BV与CID识别；无24小时缓存期限。');
})();
