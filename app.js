'use strict';
/* 台語巴克禮聖經 — 主程式 */

const FHL = 'https://bible.fhl.net/json/qb.php';
const TTS = 'https://hapsing.ithuan.tw/bangtsam?taibun=';
const VERS = { hl: 'bklhl', cl: 'bklcl' };
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 本機儲存（失敗也不影響使用） ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('tb:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('tb:' + k, JSON.stringify(v)); } catch (e) { } }
};
const settings = Object.assign({ script: 'hl', fs: 19, theme: 'auto' }, store.get('settings', {}));
function saveSettings() { store.set('settings', settings); applySettings(); }
function applySettings() {
  document.documentElement.style.setProperty('--fs', settings.fs + 'px');
  if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', settings.theme);
}
applySettings();

/* ---------- IndexedDB：存已下載的章 ---------- */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res) => {
    try {
      const r = indexedDB.open('taigi-bible', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('ch');
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch (e) { res(null); }
  });
  return dbP;
}
async function idbGet(key) {
  const d = await db(); if (!d) return undefined;
  return new Promise(res => { try { const q = d.transaction('ch').objectStore('ch').get(key); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch (e) { res(undefined); } });
}
async function idbPut(key, val) {
  const d = await db(); if (!d) return;
  return new Promise(res => { try { const t = d.transaction('ch', 'readwrite'); t.objectStore('ch').put(val, key); t.oncomplete = () => res(); t.onerror = () => res(); } catch (e) { res(); } });
}
async function idbKeys() {
  const d = await db(); if (!d) return [];
  return new Promise(res => { try { const q = d.transaction('ch').objectStore('ch').getAllKeys(); q.onsuccess = () => res(q.result); q.onerror = () => res([]); } catch (e) { res([]); } });
}

/* ---------- 取經文 ---------- */
const memCache = new Map();
async function getChapter(script, b, c) {
  const key = `${script}:${b}:${c}`;
  if (memCache.has(key)) return memCache.get(key);
  let data = await idbGet(key);
  if (!data) {
    const url = `${FHL}?chineses=${encodeURIComponent(BOOKS[b][0])}&chap=${c}&version=${VERS[script]}&gb=0&strong=0`;
    let j;
    try { j = await (await fetch(url)).json(); }
    catch (e) { throw new Error(navigator.onLine ? '無法連到信望愛經文網站，請稍後再試。' : '這一章還沒下載過，需要網路才能讀取。'); }
    if (!j.record || !j.record.length) throw new Error('信望愛沒有回傳這一章的經文。');
    data = j.record.map(r => [Number(r.sec), String(r.bible_text || '').trim()]);
    await idbPut(key, data);
  }
  memCache.set(key, data);
  return data;
}

/* ---------- 書卷、經節解析 ---------- */
const abbrIndex = new Map();
BOOKS.forEach(([ab, full], i) => { abbrIndex.set(ab, i); abbrIndex.set(full, i); });
// 常見別寫
[['約壹', 62], ['約貳', 63], ['約參', 64], ['啓', 65], ['啟示', 65], ['詩篇', 18]].forEach(([k, i]) => abbrIndex.set(k, i));

function findBook(s) {
  s = s.trim();
  if (abbrIndex.has(s)) return abbrIndex.get(s);
  return -1;
}
// 解析「提後 3:14-4:5」「約3:16」「詩 23」「提後 3:14~16」
function parseRef(input) {
  let s = (input || '').trim().replace(/[：﹕]/g, ':').replace(/[～〜~－—–]/g, '-').replace(/\s+/g, ' ');
  if (!s) return { err: '請輸入經節，例如：約 3:16' };
  const m = s.match(/^(.+?)\s*(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?$/);
  if (!m) return { err: '看不懂這個經節格式，例：約 3:16 或 提後 3:14-4:5' };
  const b = findBook(m[1].replace(/\s/g, ''));
  if (b < 0) return { err: `找不到書卷「${m[1].trim()}」，請用和合本縮寫，例如：創、約、提後。` };
  const c1 = +m[2], v1 = m[3] ? +m[3] : null;
  let c2 = c1, v2 = null;
  if (m[4]) {
    if (m[5]) { c2 = +m[4]; v2 = +m[5]; }
    else if (v1 != null) { v2 = +m[4]; }
    else { c2 = +m[4]; }
  }
  const [ab, full, n] = BOOKS[b];
  for (const c of [c1, c2]) if (c < 1 || c > n) return { err: `${full}只有 ${n} 章。` };
  if (c2 < c1 || (c2 === c1 && v1 != null && v2 != null && v2 < v1)) return { err: '範圍的結尾在開頭之前，請檢查。' };
  return { b, c1, v1, c2, v2, isRange: !!m[4] };
}
const refLabel = (b, c, v) => `${BOOKS[b][0]} ${c}${v ? ':' + v : ''}`;

/* ---------- 小提示 ---------- */
let toastT;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- 語音播放器 ---------- */
const audioCache = new Map(); // 本次開啟期間已載入的語音
const player = {
  queue: [], idx: 0, audio: null, paused: false, active: false, token: 0,
  async start(items, label) {
    this.stop(true);
    if (!items.length) return;
    this.queue = items; this.idx = 0; this.active = true; this.paused = false; this.label = label;
    $('#player').hidden = false;
    // 從首頁開始範圍朗讀時，先切到第一章
    if (currentView.name !== 'chapter') { currentView = { name: 'chapter', b: -1, c: -1 }; }
    this.playCurrent();
  },
  async playCurrent() {
    const tk = ++this.token;
    const it = this.queue[this.idx];
    if (!it) { this.stop(); return; }
    updatePlayerUI('載入語音中…');
    markPlaying(it);
    let text;
    try {
      const ch = await getChapter('cl', it.b, it.c);
      const row = ch.find(r => r[0] === it.v);
      text = row ? row[1] : '';
    } catch (e) { if (tk === this.token) { toast(e.message); this.stop(); } return; }
    if (tk !== this.token) return;
    if (!text) { this.next(); return; }
    if (!navigator.onLine && !audioCache.has(text)) { /* 可能有離線快取，仍嘗試 */ }
    const a = getAudio(text);
    this.audio = a;
    a.onended = () => { if (tk === this.token) this.next(); };
    a.onerror = () => {
      if (tk !== this.token) return;
      audioCache.delete(text);
      toast(navigator.onLine ? '台語語音服務暫時無法使用，請稍後再試。' : '需要網路才能播放這一節的語音。');
      this.stop();
    };
    a.onplaying = () => { if (tk === this.token) updatePlayerUI('朗讀中'); };
    try { a.currentTime = 0; } catch (e) { }
    if (!this.paused) a.play().catch(err => { if (tk === this.token && err.name !== 'AbortError') { updatePlayerUI('請按「繼續」開始播放'); this.paused = true; $('#playerPause').textContent = '繼續'; } });
    // 預先載入下一節
    const nx = this.queue[this.idx + 1];
    if (nx) getChapter('cl', nx.b, nx.c).then(ch => { const r = ch.find(x => x[0] === nx.v); if (r && r[1]) getAudio(r[1]); }).catch(() => { });
  },
  next() { this.idx++; if (this.idx >= this.queue.length) this.stop(); else this.playCurrent(); },
  togglePause() {
    if (!this.active) return;
    this.paused = !this.paused;
    $('#playerPause').textContent = this.paused ? '繼續' : '暫停';
    if (this.audio) { if (this.paused) this.audio.pause(); else this.audio.play().catch(() => { }); }
    updatePlayerUI(this.paused ? '已暫停' : '朗讀中');
  },
  stop(silent) {
    this.token++;
    if (this.audio) { try { this.audio.pause(); } catch (e) { } this.audio.onended = this.audio.onerror = this.audio.onplaying = null; }
    this.audio = null; this.active = false; this.queue = []; this.paused = false;
    $('#playerPause').textContent = '暫停';
    if (!silent) $('#player').hidden = true;
    markPlaying(null);
  },
  current() { return this.active ? this.queue[this.idx] : null; }
};
function getAudio(text) {
  let a = audioCache.get(text);
  if (!a) {
    a = new Audio(TTS + encodeURIComponent(pojToTL(text)));
    a.preload = 'auto';
    audioCache.set(text, a);
    if (audioCache.size > 60) { const k = audioCache.keys().next().value; audioCache.delete(k); }
  }
  return a;
}
function updatePlayerUI(status) {
  const it = player.current();
  if (!it) return;
  const total = player.queue.length;
  $('#playerLabel').textContent = `${refLabel(it.b, it.c, it.v)}` + (total > 1 ? `（${player.idx + 1}/${total}）` : '');
  $('#playerStatus').textContent = status || '';
}
function markPlaying(it) {
  document.querySelectorAll('.verse.playing').forEach(el => el.classList.remove('playing'));
  document.querySelectorAll('.play.on').forEach(el => { el.classList.remove('on'); el.textContent = '▶'; });
  if (!it) return;
  // 若目前畫面不是這一章，就換過去
  if (currentView.name !== 'chapter') return; // 使用者在別的頁面，就不打擾
  if (currentView.b !== it.b || currentView.c !== it.c) {
    location.hash = `#/c/${it.b}/${it.c}`;
    return; // 畫面換好後 renderChapter 會再標示
  }
  const el = document.getElementById('v' + it.v);
  if (el) {
    el.classList.add('playing');
    const btn = el.querySelector('.play'); if (btn) { btn.classList.add('on'); btn.textContent = '■'; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
$('#playerPause').onclick = () => player.togglePause();
$('#playerStop').onclick = () => player.stop();

async function buildRange(r) {
  const items = [];
  for (let c = r.c1; c <= r.c2; c++) {
    const ch = await getChapter('cl', r.b, c);
    const maxV = ch.length ? ch[ch.length - 1][0] : 0;
    const from = (c === r.c1 && r.v1) ? r.v1 : 1;
    let to = maxV;
    if (c === r.c2 && r.v2 != null) to = r.v2;
    else if (c === r.c2 && !r.isRange && r.v1) to = r.v1; // 單節
    if (from > maxV) throw new Error(`${BOOKS[r.b][0]} ${c} 章只有 ${maxV} 節。`);
    if (to > maxV) throw new Error(`${BOOKS[r.b][0]} ${c} 章只有 ${maxV} 節。`);
    for (const [v] of ch) if (v >= from && v <= to) items.push({ b: r.b, c, v });
  }
  return items;
}
async function playRange(text, errEl) {
  const r = parseRef(text);
  if (r.err) { errEl ? (errEl.textContent = r.err) : toast(r.err); return; }
  if (!r.isRange && r.v1 == null) { r.isRange = true; } // 整章
  try {
    const items = await buildRange(r);
    if (errEl) errEl.textContent = '';
    store.set('lastRange', text);
    player.start(items, text);
  } catch (e) { errEl ? (errEl.textContent = e.message) : toast(e.message); }
}

/* ---------- 書籤、上次位置 ---------- */
const getBookmarks = () => store.get('bookmarks', []);
const isBookmarked = (b, c, v) => getBookmarks().some(x => x.b === b && x.c === c && x.v === v);
function toggleBookmark(b, c, v) {
  let bm = getBookmarks();
  if (isBookmarked(b, c, v)) { bm = bm.filter(x => !(x.b === b && x.c === c && x.v === v)); toast(`已移除書籤 ${refLabel(b, c, v)}`); }
  else { bm.unshift({ b, c, v, t: Date.now() }); toast(`已加入書籤 ${refLabel(b, c, v)}`); }
  store.set('bookmarks', bm);
  return isBookmarked(b, c, v);
}

/* ---------- 畫面 ---------- */
let currentView = { name: '' };
const view = () => $('#view');

function renderHome() {
  currentView = { name: 'home' };
  const last = store.get('last', null);
  const grid = (from, to) => BOOKS.slice(from, to).map(([ab, full], i) =>
    `<a href="#/b/${from + i}"><span class="ab">${ab}</span><span class="fn">${full}</span></a>`).join('');
  view().innerHTML = `
    <div class="box">
      <form id="jumpForm" class="row" autocomplete="off">
        <input id="jumpInput" type="text" placeholder="跳到經節，例：約 3:16" aria-label="跳到經節">
        <button class="btn" type="submit">前往</button>
      </form>
      <div id="jumpErr" class="err"></div>
    </div>
    <div class="box">
      <div class="muted" style="font-size:14px;margin-bottom:6px">範圍朗讀（可跨章）</div>
      <form id="rangeForm" class="row" autocomplete="off">
        <input id="rangeInput" type="text" placeholder="例：提後 3:14-4:5" aria-label="範圍朗讀" value="${esc(store.get('lastRange', ''))}">
        <button class="btn" type="submit">▶ 朗讀</button>
      </form>
      <div id="rangeErr" class="err"></div>
    </div>
    ${last ? `<p><a href="#/c/${last.b}/${last.c}">繼續閱讀：${esc(refLabel(last.b, last.c))}｜${esc(BOOKS[last.b][1])}</a></p>` : ''}
    <h2>舊約（39 卷）</h2><div class="grid">${grid(0, OT_COUNT)}</div>
    <h2>新約（27 卷）</h2><div class="grid">${grid(OT_COUNT, 66)}</div>
    <footer class="about">經文：1933 年巴克禮台語譯本，資料來自<a href="https://bible.fhl.net/" target="_blank" rel="noopener">信望愛資訊中心</a><br>台語語音：<a href="https://ithuan.tw/" target="_blank" rel="noopener">意傳科技</a></footer>`;
  $('#jumpForm').onsubmit = e => {
    e.preventDefault();
    const r = parseRef($('#jumpInput').value);
    if (r.err) { $('#jumpErr').textContent = r.err; return; }
    location.hash = `#/c/${r.b}/${r.c1}${r.v1 ? '/' + r.v1 : ''}`;
  };
  $('#rangeForm').onsubmit = e => { e.preventDefault(); playRange($('#rangeInput').value, $('#rangeErr')); };
}

function renderBook(b) {
  currentView = { name: 'book', b };
  const [ab, full, n] = BOOKS[b];
  let links = '';
  for (let c = 1; c <= n; c++) links += `<a href="#/c/${b}/${c}">${c}</a>`;
  view().innerHTML = `<h1>${esc(ab)}｜${esc(full)}</h1><div class="grid chapters">${links}</div>`;
}

async function renderChapter(b, c, v) {
  currentView = { name: 'chapter', b, c };
  const [ab, full, n] = BOOKS[b];
  store.set('last', { b, c });
  view().innerHTML = `
    <div class="chap-head">
      <h1>${esc(ab)} ${c}｜${esc(full)}</h1>
      <div class="seg" role="group" aria-label="文字">
        <button type="button" data-s="hl" class="${settings.script === 'hl' ? 'on' : ''}">漢羅</button>
        <button type="button" data-s="cl" class="${settings.script === 'cl' ? 'on' : ''}">全羅</button>
      </div>
    </div>
    <div class="chap-tools">
      <button class="btn" id="playAll" type="button">▶ 整章播放</button>
      <a class="btn ghost" href="#/b/${b}" style="text-decoration:none">選章</a>
    </div>
    <ol class="verses" id="verses"><li class="muted">載入中…</li></ol>
    <div class="chap-nav">
      ${prevChap(b, c) ? `<a class="btn ghost" style="text-decoration:none" href="#/c/${prevChap(b, c).join('/')}">‹ 上一章</a>` : '<span></span>'}
      ${nextChap(b, c) ? `<a class="btn ghost" style="text-decoration:none" href="#/c/${nextChap(b, c).join('/')}">下一章 ›</a>` : '<span></span>'}
    </div>`;
  view().querySelectorAll('.seg button').forEach(btn => btn.onclick = () => {
    settings.script = btn.dataset.s; saveSettings();
    const keep = topVisibleVerse();
    renderChapter(b, c, null).then(() => { if (keep) { const el = document.getElementById('v' + keep); if (el) el.scrollIntoView({ block: 'start' }); } });
  });
  $('#playAll').onclick = async () => {
    try { const items = await buildRange({ b, c1: c, c2: c, v1: null, v2: null, isRange: true }); player.start(items, refLabel(b, c)); }
    catch (e) { toast(e.message); }
  };
  let data;
  try { data = await getChapter(settings.script, b, c); }
  catch (e) { if (currentView.b === b && currentView.c === c) $('#verses').innerHTML = `<li class="err">${esc(e.message)}</li>`; return; }
  if (currentView.name !== 'chapter' || currentView.b !== b || currentView.c !== c) return;
  $('#verses').innerHTML = data.map(([n2, t]) => `
    <li class="verse${v === n2 ? ' hl' : ''}" id="v${n2}">
      <button class="play" type="button" data-v="${n2}" aria-label="朗讀第 ${n2} 節">▶</button>
      <div class="vtext"><span class="vnum">${n2}</span>${esc(t)}</div>
      <button class="star${isBookmarked(b, c, n2) ? ' on' : ''}" type="button" data-v="${n2}" aria-label="書籤">${isBookmarked(b, c, n2) ? '★' : '☆'}</button>
    </li>`).join('');
  $('#verses').onclick = e => {
    const p = e.target.closest('.play'), s = e.target.closest('.star');
    if (p) {
      const vv = +p.dataset.v, cur = player.current();
      if (cur && cur.b === b && cur.c === c && cur.v === vv && player.queue.length === 1) { player.stop(); return; }
      player.start([{ b, c, v: vv }], refLabel(b, c, vv));
    } else if (s) {
      const on = toggleBookmark(b, c, +s.dataset.v);
      s.classList.toggle('on', on); s.textContent = on ? '★' : '☆';
    }
  };
  const cur = player.current();
  if (cur && cur.b === b && cur.c === c) markPlaying(cur);
  else if (v) { const el = document.getElementById('v' + v); if (el) el.scrollIntoView({ block: 'center' }); }
  else window.scrollTo(0, 0);
}
function topVisibleVerse() {
  const els = document.querySelectorAll('.verse');
  for (const el of els) if (el.getBoundingClientRect().bottom > 70) return el.id.slice(1);
  return null;
}
function prevChap(b, c) { if (c > 1) return [b, c - 1]; if (b > 0) return [b - 1, BOOKS[b - 1][2]]; return null; }
function nextChap(b, c) { if (c < BOOKS[b][2]) return [b, c + 1]; if (b < 65) return [b + 1, 1]; return null; }

/* 搜尋 */
const TOTAL_CHAPTERS = BOOKS.reduce((s, x) => s + x[2], 0);
async function countDownloaded() {
  const keys = await idbKeys();
  const n = { hl: 0, cl: 0 };
  keys.forEach(k => { const s = String(k).split(':')[0]; if (n[s] != null) n[s]++; });
  return n;
}
async function renderSearch(q) {
  currentView = { name: 'search' };
  const scope = store.get('searchScope', 'all');
  view().innerHTML = `
    <h1>搜尋經文</h1>
    <div class="box">
      <form id="sForm" class="row" autocomplete="off">
        <input id="sInput" type="search" placeholder="漢字或白話字，例：Siong-te" value="${esc(q || '')}" aria-label="搜尋字詞">
        <select id="sScope" aria-label="範圍">
          <option value="all"${scope === 'all' ? ' selected' : ''}>全部</option>
          <option value="ot"${scope === 'ot' ? ' selected' : ''}>舊約</option>
          <option value="nt"${scope === 'nt' ? ' selected' : ''}>新約</option>
        </select>
        <button class="btn" type="submit">搜尋</button>
      </form>
      <div class="muted" style="font-size:13px;margin-top:6px">白話字可以不打聲調和連字號。</div>
      <div id="sNote" class="muted" style="font-size:14px;margin-top:6px"></div>
    </div>
    <div id="sCount" class="muted"></div>
    <ul class="results" id="sRes"></ul>`;
  $('#sForm').onsubmit = e => { e.preventDefault(); store.set('searchScope', $('#sScope').value); location.hash = '#/search/' + encodeURIComponent($('#sInput').value.trim()); };
  const n = await countDownloaded();
  if (n.hl < TOTAL_CHAPTERS || n.cl < TOTAL_CHAPTERS) {
    $('#sNote').innerHTML = `搜尋只會找已下載的章節（漢羅 ${n.hl}／全羅 ${n.cl}，全本 ${TOTAL_CHAPTERS} 章）。<a href="#/settings">到設定下載全本</a>，就能搜尋整本聖經。`;
  }
  if (!q) { $('#sInput').focus(); return; }
  await doSearch(q, scope);
}
async function doSearch(q, scope) {
  const fq = foldText(q).trim();
  if (!fq) return;
  const isLatin = /[a-z]/.test(fq) && !/[一-鿿]/.test(q);
  $('#sCount').textContent = '搜尋中…';
  const keys = await idbKeys();
  const want = isLatin ? ['cl', 'hl'] : ['hl', 'cl'];
  const results = []; const seen = new Set();
  const range = scope === 'ot' ? [0, OT_COUNT] : scope === 'nt' ? [OT_COUNT, 66] : [0, 66];
  const sorted = keys.map(k => String(k).split(':')).filter(([s, b]) => want.includes(s) && +b >= range[0] && +b < range[1])
    .sort((x, y) => (+x[1] - +y[1]) || (+x[2] - +y[2]) || (want.indexOf(x[0]) - want.indexOf(y[0])));
  for (const [s, b, c] of sorted) {
    const data = await getChapter(s, +b, +c);
    for (const [v, t] of data) {
      const id = `${b}:${c}:${v}`;
      if (seen.has(id)) continue;
      if (foldText(t).includes(fq)) { seen.add(id); results.push({ b: +b, c: +c, v, t }); }
    }
  }
  results.sort((x, y) => x.b - y.b || x.c - y.c || x.v - y.v);
  $('#sCount').textContent = `找到 ${results.length} 節` + (results.length > 300 ? '（只列出前 300 節）' : '');
  $('#sRes').innerHTML = results.slice(0, 300).map(r =>
    `<li><a href="#/c/${r.b}/${r.c}/${r.v}"><span class="ref">${esc(refLabel(r.b, r.c, r.v))}</span>${highlight(r.t, fq)}</a></li>`).join('');
}
function highlight(t, fq) {
  // 以「去聲調後」的位置找出原文對應區段
  const map = []; let folded = '';
  const nfd = t.normalize('NFD');
  for (let i = 0; i < nfd.length; i++) {
    const ch = nfd[i];
    let f = ch.replace(/[̀-ͯ͘]/, '').replace('ⁿ', 'n').replace('-', ' ').toLowerCase();
    if (/\s/.test(f) && /\s$/.test(folded)) f = '';
    for (const x of f) { folded += x; map.push(i); }
  }
  const at = folded.indexOf(fq);
  if (at < 0) return esc(t);
  const s = map[at], e = (map[at + fq.length - 1] ?? nfd.length - 1) + 1;
  let e2 = e; while (e2 < nfd.length && /[̀-ͯ͘]/.test(nfd[e2])) e2++;
  return esc(nfd.slice(0, s).normalize('NFC')) + '<mark>' + esc(nfd.slice(s, e2).normalize('NFC')) + '</mark>' + esc(nfd.slice(e2).normalize('NFC'));
}

/* 書籤 */
async function renderBookmarks() {
  currentView = { name: 'bookmarks' };
  const bm = getBookmarks();
  view().innerHTML = `<h1>書籤</h1>${bm.length ? '' : '<p class="muted">還沒有書籤。在經節右邊按 ☆ 就能加入。</p>'}<ul class="results" id="bmList"></ul>`;
  const list = $('#bmList');
  for (const x of bm) {
    let t = '';
    try { const ch = await getChapter(settings.script, x.b, x.c); const r = ch.find(y => y[0] === x.v); t = r ? r[1] : ''; } catch (e) { }
    const li = document.createElement('li');
    li.innerHTML = `<button class="rm" type="button" aria-label="移除">✕</button><a href="#/c/${x.b}/${x.c}/${x.v}"><span class="ref">${esc(refLabel(x.b, x.c, x.v))}</span>${esc(t)}</a>`;
    li.querySelector('.rm').onclick = () => { toggleBookmark(x.b, x.c, x.v); li.remove(); };
    list.appendChild(li);
  }
}

/* 設定 */
let dlRunning = false;
async function renderSettings() {
  currentView = { name: 'settings' };
  const n = await countDownloaded();
  view().innerHTML = `
    <h1>設定</h1>
    <div class="box">
      <div style="margin-bottom:8px">字體大小：<b id="fsVal">${settings.fs}</b> px</div>
      <div class="row"><button class="btn ghost" id="fsDown" type="button">A−</button><button class="btn ghost" id="fsUp" type="button">A+</button></div>
      <p class="vtext" style="margin:10px 0 0">Siōng-tè thiàⁿ sè-kan / 上帝疼世間</p>
    </div>
    <div class="box">
      <div style="margin-bottom:8px">外觀</div>
      <div class="seg" id="themeSeg">
        <button type="button" data-t="auto" class="${settings.theme === 'auto' ? 'on' : ''}">跟手機</button>
        <button type="button" data-t="light" class="${settings.theme === 'light' ? 'on' : ''}">淺色</button>
        <button type="button" data-t="dark" class="${settings.theme === 'dark' ? 'on' : ''}">深色</button>
      </div>
    </div>
    <div class="box">
      <div>離線經文：漢羅 <b id="nHl">${n.hl}</b>／全羅 <b id="nCl">${n.cl}</b>（全本各 ${TOTAL_CHAPTERS} 章）</div>
      <div class="muted" style="font-size:14px;margin:6px 0 10px">下載全本後，沒網路也能讀任何一章，也能搜尋整本聖經。約 10 MB，需要幾分鐘，建議用 Wi-Fi。</div>
      <button class="btn" id="dlAll" type="button"${dlRunning ? ' disabled' : ''}>${dlRunning ? '下載中…' : '下載全本'}</button>
      <div class="progress"><div id="dlBar" style="width:${Math.round((n.hl + n.cl) / (2 * TOTAL_CHAPTERS) * 100)}%"></div></div>
      <div id="dlMsg" class="muted" style="font-size:14px;margin-top:6px"></div>
    </div>
    <footer class="about">經文：1933 年巴克禮台語譯本，資料來自<a href="https://bible.fhl.net/" target="_blank" rel="noopener">信望愛資訊中心</a>　台語語音：<a href="https://ithuan.tw/" target="_blank" rel="noopener">意傳科技</a></footer>`;
  const setFs = d => { settings.fs = Math.min(32, Math.max(14, settings.fs + d)); saveSettings(); $('#fsVal').textContent = settings.fs; };
  $('#fsDown').onclick = () => setFs(-1);
  $('#fsUp').onclick = () => setFs(+1);
  $('#themeSeg').querySelectorAll('button').forEach(btn => btn.onclick = () => {
    settings.theme = btn.dataset.t; saveSettings();
    $('#themeSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === btn));
  });
  $('#dlAll').onclick = downloadAll;
}
async function downloadAll() {
  if (dlRunning) return;
  dlRunning = true;
  const btn = $('#dlAll'); if (btn) { btn.disabled = true; btn.textContent = '下載中…'; }
  const keys = new Set((await idbKeys()).map(String));
  const jobs = [];
  for (const s of ['hl', 'cl']) BOOKS.forEach((bk, b) => { for (let c = 1; c <= bk[2]; c++) if (!keys.has(`${s}:${b}:${c}`)) jobs.push([s, b, c]); });
  let done = 2 * TOTAL_CHAPTERS - jobs.length, failed = 0;
  const upd = () => {
    const bar = $('#dlBar'); if (bar) bar.style.width = Math.round(done / (2 * TOTAL_CHAPTERS) * 100) + '%';
    const m = $('#dlMsg'); if (m) m.textContent = `已完成 ${done} / ${2 * TOTAL_CHAPTERS}` + (failed ? `，失敗 ${failed}` : '');
  };
  upd();
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const [s, b, c] = jobs[i++];
      try { await getChapter(s, b, c); memCache.delete(`${s}:${b}:${c}`); done++; } catch (e) { failed++; }
      upd();
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  dlRunning = false;
  const n = await countDownloaded();
  if ($('#nHl')) { $('#nHl').textContent = n.hl; $('#nCl').textContent = n.cl; }
  const b2 = $('#dlAll'); if (b2) { b2.disabled = false; b2.textContent = '下載全本'; }
  toast(failed ? `下載完成，但有 ${failed} 章失敗，再按一次「下載全本」可補下載。` : '全本下載完成，現在可以離線閱讀與搜尋了。', 5000);
}

/* ---------- 路由 ---------- */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/');
  try {
    if (p[0] === 'b' && BOOKS[+p[1]]) return renderBook(+p[1]);
    if (p[0] === 'c' && BOOKS[+p[1]]) {
      const b = +p[1], c = Math.min(Math.max(1, +p[2] || 1), BOOKS[b][2]);
      return renderChapter(b, c, p[3] ? +p[3] : null);
    }
    if (p[0] === 'search') return renderSearch(p[1] ? decodeURIComponent(p.slice(1).join('/')) : '');
    if (p[0] === 'bookmarks') return renderBookmarks();
    if (p[0] === 'settings') return renderSettings();
    return renderHome();
  } finally { if (p[0] !== 'c') window.scrollTo(0, 0); }
}
window.addEventListener('hashchange', route);
route();

/* ---------- 離線支援 ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
