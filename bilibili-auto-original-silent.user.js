// ==UserScript==
// @name         哔哩哔哩直播自动原画（精简版）
// @namespace    local.bilibili.auto-original
// @version      2.1.1
// @author       coldboot32
// @license      MIT
// @description  静默选择原画，并在播放器统计面板显示音视频分片平均码率。
// @match        https://live.bilibili.com/*
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
MIT License

Copyright (c) 2026 coldboot32

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

(() => {
  'use strict';
  const KEY = '__biliAutoOriginalSilentLocal';
  if (window[KEY]) return;
  const state = { player: null, path: '', done: false, attempts: 0,
    lastAttempt: 0, waiting: 0, pending: false };
  window[KEY] = state;
  // 码率统计必须在播放器创建 SourceBuffer 之前安装。
  const updateBitratePanel = installBitratePanel();
  const report = value => {
    if (document.documentElement) document.documentElement.dataset.biliAutoOriginal = '2.1.1:' + value;
  };
  report('started');

  function tick() {
    if (!/^\/\d+\/?$/.test(location.pathname)) return;
    const player = unsafeWindow.livePlayer;
    if (player !== state.player || location.pathname !== state.path) {
      Object.assign(state, { player, path: location.pathname, done: false,
        attempts: 0, lastAttempt: 0, waiting: 0, pending: false });
      report('waiting');
    }
    if (state.done) return;
    try {
      if (!player || typeof player.getPlayerInfo !== 'function' ||
          typeof player.switchQuality !== 'function') {
        if (++state.waiting === 60) {
          report('api-unavailable');
          console.warn('[自动原画] 等待播放器接口超过60秒。');
        }
        return;
      }
      const info = player.getPlayerInfo();
      if (!info?.playurl || !Array.isArray(info.qualityCandidates)) return;
      const target = info.qualityCandidates.find(q => Number(q.qn) === 10000) ||
        info.qualityCandidates.find(q => /原画/.test(q.desc || '') && !/自动/.test(q.desc || ''));
      if (!target) { report('original-unavailable'); return; }

      const now = Date.now();
      const label = document.querySelector('#live-player .selected-qn')?.textContent?.trim();
      // 即使自动模式恰好播放原画，也先调用一次接口，明确选择原画。
      if (state.attempts > 0 && now - state.lastAttempt >= 2000 &&
          Number(info.quality) === Number(target.qn) && !/^自动/.test(label || '')) {
        state.done = true;
        report('confirmed:' + target.qn);
        console.info('[自动原画] 静默切换已确认：', target.desc, target.qn);
        return;
      }
      if (state.pending || (state.attempts > 0 && now - state.lastAttempt < 5000)) return;
      if (state.attempts >= 5) {
        state.done = true;
        report('failed');
        console.warn('[自动原画] 已尝试5次，切换未确认。');
        return;
      }
      state.attempts++;
      state.lastAttempt = now;
      report('switching:' + target.qn);
      // 当前播放器严格比较 String(code) 与入参，必须传字符串。
      const switchMethod = typeof player.switchQualityAsync === 'function' ?
        player.switchQualityAsync : player.switchQuality;
      const result = switchMethod.call(player, String(target.qn), target.hdrType ?? 0, false, 'auto-original-local');
      if (result && typeof result.then === 'function') {
        state.pending = true;
        result.then(response => {
          if (state.player !== player) return;
          document.documentElement.dataset.biliAutoOriginalResult = JSON.stringify({
            code: response?.code, msg: response?.msg,
            requested: String(target.qn), current: player.getPlayerInfo().quality
          });
          console.info('[自动原画] 切换接口返回：', response?.code, response?.msg);
        }).catch(error => console.warn('[自动原画] 切换接口拒绝：', error))
          .finally(() => { if (state.player === player) state.pending = false; });
      }
    } catch (error) {
      report('error');
      if (++state.waiting === 1) console.warn('[自动原画] 接口执行失败：', error);
    }
  }
  state.timer = window.setInterval(() => { updateBitratePanel(); tick(); }, 1000);
  tick();

  function installBitratePanel() {
    const buffers = new WeakMap();
    const latest = new Map();
    const infoLabels = new WeakMap();
    let hookInstalled = false;

    // 仅读取 MP4 盒子，不复制或保留媒体内容，不改动播放器收到的字节。
    function boxes(view, start, end, visit) {
      for (let p = start, count = 0; p + 8 <= end && count++ < 2000;) {
        let size = view.getUint32(p), header = 8;
        const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5),
          view.getUint8(p + 6), view.getUint8(p + 7));
        if (size === 1) {
          if (p + 16 > end) return;
          size = view.getUint32(p + 8) * 4294967296 + view.getUint32(p + 12);
          header = 16;
        } else if (size === 0) size = end - p;
        if (!Number.isSafeInteger(size) || size < header || p + size > end) return;
        visit(type, p + header, p + size);
        p += size;
      }
    }

    function inspect(buffer, data) {
      const view = ArrayBuffer.isView(data) ?
        new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);
      let tracks = buffers.get(buffer);
      if (!tracks) { tracks = new Map(); buffers.set(buffer, tracks); }
      boxes(view, 0, view.byteLength, (type, start, end) => {
        if (type === 'moov') {
          for (const track of tracks.values()) {
            if (latest.get(track.kind) === track) latest.delete(track.kind);
          }
          tracks.clear();
          const defaults = new Map();
          boxes(view, start, end, (child, a, b) => {
            if (child === 'mvex') boxes(view, a, b, (name, p, q) => {
              if (name === 'trex' && q - p >= 24) defaults.set(view.getUint32(p + 4),
                { duration: view.getUint32(p + 12), size: view.getUint32(p + 16) });
            });
            if (child !== 'trak') return;
            const track = { id: 0, kind: '', scale: 0, samples: [], lastAt: 0 };
            boxes(view, a, b, (name, p, q) => {
              if (name === 'tkhd') {
                const offset = view.getUint8(p) === 1 ? 20 : 12;
                if (p + offset + 4 <= q) track.id = view.getUint32(p + offset);
              }
              if (name === 'mdia') boxes(view, p, q, (field, x, y) => {
                if (field === 'mdhd') {
                  const offset = view.getUint8(x) === 1 ? 20 : 12;
                  if (x + offset + 4 <= y) track.scale = view.getUint32(x + offset);
                }
                if (field === 'hdlr' && y - x >= 12) {
                  const handler = view.getUint32(x + 8);
                  track.kind = handler === 0x76696465 ? 'video' : handler === 0x736f756e ? 'audio' : '';
                }
              });
            });
            if (track.id && track.kind && track.scale) tracks.set(track.id, track);
          });
          for (const track of tracks.values()) Object.assign(track, defaults.get(track.id));
        }
        if (type !== 'moof') return;
        boxes(view, start, end, (child, a, b) => {
          if (child !== 'traf') return;
          let track, duration = 0, size = 0;
          const runs = [];
          boxes(view, a, b, (name, p, q) => {
            if (name === 'trun') runs.push([p, q]);
            if (name !== 'tfhd' || q - p < 8) return;
            const flags = view.getUint32(p) & 0xffffff;
            track = tracks.get(view.getUint32(p + 4));
            if (!track) return;
            duration = track.duration || 0; size = track.size || 0;
            let cursor = p + 8;
            if (flags & 1) cursor += 8;
            if (flags & 2) cursor += 4;
            if (flags & 8) { if (cursor + 4 > q) throw new Error('tfhd'); duration = view.getUint32(cursor); cursor += 4; }
            if (flags & 16) { if (cursor + 4 > q) throw new Error('tfhd'); size = view.getUint32(cursor); }
          });
          if (!track) return;
          let bytes = 0, ticks = 0;
          for (const [p, q] of runs) {
            if (q - p < 8) return;
            const flags = view.getUint32(p) & 0xffffff, count = view.getUint32(p + 4);
            if (count > 200000) return;
            let cursor = p + 8;
            if (flags & 1) cursor += 4;
            if (flags & 4) cursor += 4;
            const fields = [256, 512, 1024, 2048].filter(flag => flags & flag).length;
            if (cursor + count * fields * 4 > q) return;
            for (let i = 0; i < count; i++) {
              let sampleDuration = duration, sampleSize = size;
              if (flags & 256) { sampleDuration = view.getUint32(cursor); cursor += 4; }
              if (flags & 512) { sampleSize = view.getUint32(cursor); cursor += 4; }
              if (flags & 1024) cursor += 4;
              if (flags & 2048) cursor += 4;
              // 未知大小或时长时不把不完整统计伪装成真实码率。
              if (!sampleDuration || !sampleSize) return;
              ticks += sampleDuration; bytes += sampleSize;
            }
          }
          if (!bytes || !ticks) return;
          const seconds = ticks / track.scale;
          track.samples.push({ bytes, seconds });
          let total = track.samples.reduce((sum, sample) => sum + sample.seconds, 0);
          while (track.samples.length > 1 && total - track.samples[0].seconds >= 10) {
            total -= track.samples.shift().seconds;
          }
          track.lastAt = Date.now();
          latest.set(track.kind, track);
        });
      });
    }

    try {
      const prototype = unsafeWindow.SourceBuffer?.prototype;
      if (prototype && typeof prototype.appendBuffer === 'function') {
        const original = prototype.appendBuffer;
        prototype.appendBuffer = function (data) {
          const result = Reflect.apply(original, this, arguments);
          try { inspect(this, data); } catch (_) { /* 统计失败不影响播放 */ }
          return result;
        };
        hookInstalled = true;
      }
    } catch (error) { console.warn('[音视频码率] 无法安装统计：', error); }

    function rate(kind) {
      const track = latest.get(kind);
      if (!track || Date.now() - track.lastAt > 30000) return hookInstalled ? '等待分片 / N/A' : '当前播放内核不支持';
      const bytes = track.samples.reduce((sum, sample) => sum + sample.bytes, 0);
      const seconds = track.samples.reduce((sum, sample) => sum + sample.seconds, 0);
      const bps = bytes * 8 / seconds;
      return bps >= 1e6 ? (bps / 1e6).toFixed(2) + ' Mbps' : (bps / 1000).toFixed(1) + ' Kbps';
    }

    return function updatePanel() {
      const mime = document.getElementById('p-video-info-mimeType')?.querySelector('.web-player-line-data')?.textContent || '';
      const codecText = /codecs\s*=\s*["']([^"']+)["']/i.exec(mime)?.[1] || '';
      const codecs = codecText.split(',').map(value => value.trim().toLowerCase());
      const videoCodec = codecs.find(value => /^(av01|avc[13]|hev1|hvc1|vp0[89]|vp[89])(?:\.|$)/.test(value));
      const audioCodec = codecs.find(value => /^(mp4a|opus|flac|ac-3|ec-3|mp3)(?:\.|$)/.test(value));
      function codecName(codec) {
        if (!codec) return '';
        if (/^av01/.test(codec)) return 'AV1';
        if (/^avc[13]/.test(codec)) return 'H.264';
        if (/^(hev1|hvc1)/.test(codec)) return 'H.265';
        if (/^(vp09|vp9)/.test(codec)) return 'VP9';
        if (/^(vp08|vp8)/.test(codec)) return 'VP8';
        if (codec === 'mp4a.40.2') return 'AAC-LC';
        if (/^mp4a\.40\.(5|29)$/.test(codec)) return 'HE-AAC';
        if (/^mp4a\.40\./.test(codec)) return 'AAC';
        return codec.toUpperCase();
      }
      for (const [kind, anchorId, label] of [
        ['video', 'p-video-info-videoInfo', 'Video Bitrate:'],
        ['audio', 'p-video-info-audioInfo', 'Audio Bitrate:']
      ]) {
        const anchor = document.getElementById(anchorId);
        if (!anchor) continue;
        const info = anchor.querySelector('.web-player-line-data');
        if (info) {
          const previous = infoLabels.get(info);
          const base = previous && info.textContent === previous.rendered ? previous.base : info.textContent;
          const name = codecName(kind === 'video' ? videoCodec : audioCodec);
          const rendered = name && base ? base + ', ' + name : base;
          if (info.textContent !== rendered) info.textContent = rendered;
          infoLabels.set(info, { base, rendered });
        }
        const id = 'p-video-info-local-' + kind + '-bitrate';
        let row = document.getElementById(id);
        if (!row || row.parentNode !== anchor.parentNode) {
          row?.remove();
          row = anchor.cloneNode(true);
          row.id = id;
          row.firstElementChild.textContent = label;
          row.title = '编码样本字节数 × 8 ÷ 媒体时长；近期约10秒分片的平均值，不是下载速度。';
          anchor.after(row);
        }
        const value = row.querySelector('.web-player-line-data');
        if (value && value.textContent !== rate(kind)) value.textContent = rate(kind);
      }
    };
  }
})();
