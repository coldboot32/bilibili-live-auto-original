const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '..', 'bilibili-auto-original-silent.user.js'), 'utf8');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const box = (type, ...parts) => { const b = Buffer.concat(parts); return Buffer.concat([u32(b.length + 8), Buffer.from(type), b]); };
const full = (type, flags, ...parts) => box(type, u32(flags), ...parts);
function track(id, kind, scale, version = 0) {
  const flag = version ? 0x1000000 : 0;
  return box('trak', full('tkhd', flag, Buffer.alloc(version ? 16 : 8), u32(id)),
    box('mdia', full('mdhd', flag, Buffer.alloc(version ? 16 : 8), u32(scale)),
      full('hdlr', 0, u32(0), Buffer.from(kind))));
}
function init() {
  return box('moov', track(1, 'vide', 1000, 1), track(2, 'soun', 48000),
    box('mvex', full('trex', 0, u32(1), u32(1), u32(1000), u32(250000), u32(0)),
      full('trex', 0, u32(2), u32(1), u32(1024), u32(400), u32(0))));
}
function fragment(override = false) {
  return box('moof', box('traf', full('tfhd', override ? 24 : 0, u32(1),
    ...(override ? [u32(1000), u32(500000)] : [])), full('trun', 0, u32(10))),
    box('traf', full('tfhd', 0, u32(2)), full('trun', 0, u32(480))));
}
function setup(options = {}) {
  let now = 10000, timer, serial = 0, reads = 0, appends = 0, panelFault = false;
  const requests = [], warnings = [], elements = new Map();
  class SourceBuffer {
    appendBuffer(data) { appends++; if (!data) throw Error('native append failure'); }
    abort() {}
    changeType() {}
  }
  class MediaSource {
    addSourceBuffer() { return new SourceBuffer(); }
    removeSourceBuffer() {}
  }
  const URL = { createObjectURL() { return 'blob:test-' + ++serial; }, revokeObjectURL() {} };
  const video = { currentSrc: '', src: '', srcObject: null };
  function row(id) {
    return { id, parentNode: 'panel', firstElementChild: { textContent: '' }, value: { textContent: '' },
      querySelector() { return this.value; }, cloneNode() { return row(''); },
      after(other) { elements.set(other.id, other); }, remove() { elements.delete(this.id); } };
  }
  for (const id of ['videoInfo', 'audioInfo', 'mimeType']) elements.set('p-video-info-' + id, row('p-video-info-' + id));
  elements.get('p-video-info-videoInfo').value.textContent = '1920x1080, 60FPS';
  elements.get('p-video-info-audioInfo').value.textContent = '48KHz, Stereo, 160Kbps';
  elements.get('p-video-info-mimeType').value.textContent = 'video/mp4; codecs="av01.0.09M.08,mp4a.40.2"';
  const info = { playurl: 'stream', quality: '80', qualityCandidates: [{ qn: '10000', desc: '原画' }] };
  const player = {
    getPlayerInfo() { reads++; return info; },
    switchQualityAsync(qn) {
      assert.equal(qn, '10000');
      if (!options.promise) return undefined;
      let resolve, reject;
      const promise = new Promise((a, b) => { resolve = a; reject = b; });
      requests.push({ resolve, reject });
      return promise;
    }
  };
  if (options.incomplete) delete player.getPlayerInfo;
  const context = { window: { setInterval(fn) { timer = fn; return 1; } },
    unsafeWindow: { SourceBuffer, MediaSource, URL, WeakRef, livePlayer: player },
    document: { documentElement: { dataset: {} },
      getElementById(id) { if (panelFault) throw Error('DOM changed'); return elements.get(id); },
      querySelector(selector) {
        if (selector === '#live-player video') return video;
        if (Object.prototype.hasOwnProperty.call(options, 'label')) return options.label == null ? null : { textContent: options.label };
        return { textContent: info.quality === '10000' ? '原画' : '自动' };
      } },
    location: { pathname: '/1' }, console: { info() {}, warn(...args) { warnings.push(args); } },
    Date: { now: () => now }, WeakMap, Map, ArrayBuffer, DataView, Uint8Array, Reflect, Promise };
  vm.runInNewContext(source, context);
  function attach(main = true) {
    const media = new MediaSource(), url = URL.createObjectURL(media), buffer = media.addSourceBuffer('video/mp4');
    if (main) { video.currentSrc = url; video.src = url; }
    return { media, url, buffer };
  }
  return { context, player, info, elements, requests, warnings, SourceBuffer, video, URL, attach,
    get state() { return context.window.__biliAutoOriginalSilentLocal; },
    tick(ms = 1000) { now += ms; timer(); }, reads: () => reads, appends: () => appends,
    fault(value) { panelFault = value; },
    value(kind) { return elements.get('p-video-info-local-' + kind + '-bitrate')?.value.textContent; } };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
async function run() {
  for (const label of [null, '', '自动（原画）', '1080P 蓝光', '正在切换到原画', '原画（自动）']) {
    const uncertain = setup({ label }); uncertain.info.quality = '10000'; uncertain.tick(2000);
    assert.equal(uncertain.state.done, false, `Must not confirm label: ${label}`);
    assert(!uncertain.context.document.documentElement.dataset.biliAutoOriginal.includes('confirmed:'));
  }
  for (const label of ['原画', '1080P 原画（高帧率）', '原画(高帧率)', '  原画  ']) {
    const explicit = setup({ label }); explicit.info.quality = '10000'; explicit.tick(2000);
    assert.equal(explicit.state.done, true, `Must confirm original label: ${label}`);
    assert.equal(explicit.context.document.documentElement.dataset.biliAutoOriginal, '2.2.1:confirmed:10000');
  }
  const mismatched = setup({ label: '原画' }); mismatched.tick(2000); assert.equal(mismatched.state.done, false);
  const unavailable = setup({ label: null }); unavailable.info.quality = '10000';
  for (let i = 0; i < 5; i++) unavailable.tick(5000);
  assert.equal(unavailable.state.attempts, 5); assert.equal(unavailable.state.done, true);
  assert.equal(unavailable.context.document.documentElement.dataset.biliAutoOriginal, '2.2.1:failed');
  console.log('PASS: confirmation requires explicit original label and matching quality; missing/empty/auto/unknown labels never confirm; retries remain bounded');
  let s = setup();
  s.fault(true); const before = s.reads(); s.tick(5000);
  assert(s.reads() > before);
  s.tick(); assert.equal(s.warnings.filter(w => w[0].includes('面板更新失败')).length, 1);
  s.fault(false); s.info.quality = '10000'; s.tick(); assert.equal(s.state.done, true);
  console.log('PASS 1: panel exceptions cannot block quality retries or confirmation; logging is bounded');

  s = setup({ incomplete: true });
  s.tick(59000); assert(!s.warnings.length);
  s.tick(1000); assert.equal(s.warnings.length, 1);
  s.player.getPlayerInfo = () => { throw Error('API failed'); };
  s.tick(); assert.equal(s.state.errorCount, 1);
  assert.equal(s.warnings.filter(w => w[0].includes('接口执行失败')).length, 1);
  assert.equal(s.state.interfaceWaitStart, null);
  console.log('PASS 2: elapsed interface wait and first exception logs are independent');

  s = setup({ promise: true });
  s.tick(10000); assert.equal(s.state.attempts, 2); assert.equal(s.state.pending, true);
  s.requests[0].resolve({ code: 0 }); await flush();
  assert.equal(s.state.pending, true); assert.equal(s.context.document.documentElement.dataset.biliAutoOriginalResult, undefined);
  s.context.location.pathname = '/2'; s.tick(); assert.equal(s.state.attempts, 1);
  s.requests[1].reject(Error('old room')); await flush(); assert.equal(s.state.pending, true);
  for (let i = 0; i < 5; i++) s.tick(10000);
  assert.equal(s.state.attempts, 5); assert.equal(s.state.done, true); assert.equal(s.state.pending, false);
  assert.equal(s.context.document.documentElement.dataset.biliAutoOriginal, '2.2.1:failed');
  s.requests[2].resolve({ code: 0 }); await flush(); assert.equal(s.state.pending, false);
  const completed = setup({ promise: true }); completed.info.quality = '10000'; completed.tick(2000);
  assert.equal(completed.state.done, true); assert.equal(completed.state.pending, false);
  console.log('PASS 3: hung promises time out; stale attempts and same-player room changes cannot clear new requests; retry limit holds');
  const settled = setup({ promise: true });
  settled.requests[0].resolve({ code: 0, msg: 'ok' }); await flush();
  assert.equal(settled.state.pending, false);
  assert.equal(JSON.parse(settled.context.document.documentElement.dataset.biliAutoOriginalResult).code, 0);
  settled.tick(5000); settled.requests[1].reject(Error('current failure')); await flush();
  assert.equal(settled.state.pending, false);
  assert.equal(settled.warnings.filter(w => w[0].includes('切换接口拒绝')).length, 1);

  s = setup();
  const main = s.attach(); main.buffer.appendBuffer(init()); main.buffer.appendBuffer(fragment()); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps'); assert.equal(s.value('audio'), '150.0 Kbps');
  const other = s.attach(false); other.buffer.appendBuffer(init()); other.buffer.appendBuffer(fragment(true)); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps');
  s.URL.revokeObjectURL(main.url); s.tick(); assert.equal(s.value('video'), '2.00 Mbps');
  s.video.currentSrc = other.url; s.tick(); assert.equal(s.value('video'), '4.00 Mbps');
  s.video.currentSrc = 'blob:untracked'; s.tick(); assert.equal(s.value('video'), '等待分片 / N/A');
  s.video.srcObject = main.media; s.tick(); assert.equal(s.value('video'), '2.00 Mbps'); s.video.srcObject = null;
  s.video.currentSrc = main.url;
  const untracked = new s.SourceBuffer(); untracked.appendBuffer(init()); untracked.appendBuffer(fragment(true)); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps');
  console.log('PASS 4: only the main video MediaSource supplies statistics; unrelated and untracked buffers are excluded');

  main.buffer.abort();
  const split = Buffer.concat([init(), box('mdat', Buffer.alloc(32)), fragment()]);
  for (let p = 0; p < split.length; p++) main.buffer.appendBuffer(split.subarray(p, p + 1));
  s.tick(); assert.equal(s.value('video'), '2.00 Mbps'); assert.equal(s.value('audio'), '150.0 Kbps');
  main.buffer.abort();
  const largeHeader = Buffer.concat([u32(1), Buffer.from('mdat'), u32(0), u32(48)]);
  const extended = Buffer.concat([largeHeader, Buffer.alloc(32), fragment(true)]);
  for (let p = 0; p < extended.length; p += 3) main.buffer.appendBuffer(extended.subarray(p, p + 3));
  s.tick(); assert.equal(s.value('video'), '4.00 Mbps');
  main.buffer.abort();
  const largePayload = box('mdat', Buffer.alloc(3 * 1024 * 1024));
  main.buffer.appendBuffer(largePayload.subarray(0, 37)); main.buffer.appendBuffer(largePayload.subarray(37));
  main.buffer.appendBuffer(fragment()); s.tick(); assert.equal(s.value('video'), '2.00 Mbps');
  main.buffer.appendBuffer(Buffer.concat([u32(3 * 1024 * 1024), Buffer.from('moov')]));
  s.tick(); assert.equal(s.value('video'), '等待分片 / N/A');
  main.buffer.abort(); main.buffer.appendBuffer(init()); main.buffer.appendBuffer(fragment()); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps');
  main.buffer.changeType('video/mp4'); main.buffer.appendBuffer(fragment()); s.tick();
  assert.equal(s.value('video'), '等待分片 / N/A');
  main.buffer.appendBuffer(init()); main.buffer.appendBuffer(fragment()); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps');
  main.buffer.appendBuffer(Buffer.concat([u32(0), Buffer.from('mdat')])); s.tick();
  assert.equal(s.value('video'), '等待分片 / N/A');
  main.buffer.abort(); main.buffer.appendBuffer(init()); main.buffer.appendBuffer(fragment()); s.tick();
  assert.equal(s.value('video'), '2.00 Mbps');
  console.log('PASS 5: split headers, initialization, moof and mdat tails; extended sizes; large media payloads; metadata limit; abort/changeType recovery');

  const explicit = box('moof', box('traf', full('tfhd', 0, u32(1)),
    full('trun', 0x301, u32(2), u32(0), u32(5000), u32(1000000), u32(5000), u32(1000000))));
  main.buffer.appendBuffer(explicit); s.tick(); assert.equal(s.value('video'), '1.60 Mbps');
  assert.throws(() => main.buffer.appendBuffer(null), /native append failure/);
  assert.equal(s.elements.get('p-video-info-videoInfo').value.textContent, '1920x1080, 60FPS, AV1');
  s.tick(); assert.equal(s.elements.get('p-video-info-videoInfo').value.textContent, '1920x1080, 60FPS, AV1');
  s.elements.get('p-video-info-mimeType').value.textContent = 'video/mp4; codecs="avc1.64002a,mp4a.40.2"';
  s.tick(); assert.equal(s.elements.get('p-video-info-videoInfo').value.textContent, '1920x1080, 60FPS, H.264');
  const originalHook = s.SourceBuffer.prototype.appendBuffer;
  vm.runInNewContext(source, s.context); assert.equal(s.SourceBuffer.prototype.appendBuffer, originalHook);
  const anchor = s.elements.get('p-video-info-audioInfo');
  s.elements.delete('p-video-info-local-audio-bitrate');
  anchor.cloneNode = () => ({ firstElementChild: null, querySelector() { return null; } });
  s.tick(); assert(!s.warnings.some(w => w[0].includes('面板更新失败')));
  main.media.removeSourceBuffer(main.buffer); s.tick(); assert.equal(s.value('video'), '等待分片 / N/A');
  console.log('PASS: sample/default parsing, native exceptions, codec formatting, duplicate injection, missing DOM children and buffer removal');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
