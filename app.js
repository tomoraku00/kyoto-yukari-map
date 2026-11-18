// ===== 京都マップ アプリ =====
const byId = Object.fromEntries(SPOTS.map(s => [s.id, s]));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $app = document.getElementById('app');
const MODE = window.KM_MODE || 'artifact';
const useLeaflet = () => MODE === 'web' && typeof L !== 'undefined';
let pendingMaps = [], liveMaps = [];
function mapBlock(points, route) {
  if (!useLeaflet()) return mapSvg(points, route);
  pendingMaps.push({points, route});
  return `<div class="lmap" data-map="${pendingMaps.length - 1}"></div>`;
}
function mountMaps() {
  liveMaps.forEach(m => { try { m.remove(); } catch (e) {} }); liveMaps = [];
  if (!useLeaflet()) { pendingMaps = []; return; }
  document.querySelectorAll('.lmap').forEach(el => {
    const spec = pendingMaps[+el.dataset.map]; if (!spec) return;
    const m = L.map(el, {scrollWheelZoom: false});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'}).addTo(m);
    const ll = [];
    if (spec.route.length > 1) L.polyline(spec.route, {color: '#c0392b', weight: 4, dashArray: '8 6'}).addTo(m);
    spec.route.forEach(p => ll.push(p));
    spec.points.forEach(p => {
      const html = `<div class="pin ${p.main ? 'main' : ''}">${p.num || ''}</div>`;
      const mk = L.marker([p.lat, p.lng], {icon: L.divIcon({html, className: 'pin-wrap', iconSize: [26, 26], iconAnchor: [13, 13]})}).addTo(m);
      mk.bindPopup(`<b>${esc(p.label)}</b>${p.id && byId[p.id] ? `<br><button class="popbtn" data-act="open" data-id="${p.id}">詳しく見る</button>` : ''}`);
      ll.push([p.lat, p.lng]);
    });
    if (st.pos) L.circleMarker([st.pos.lat, st.pos.lng], {radius: 7, color: '#fff', weight: 2, fillColor: '#2f7de1', fillOpacity: 1}).addTo(m).bindPopup('現在地');
    if (ll.length === 1) m.setView(ll[0], 15); else m.fitBounds(ll, {padding: [24, 24]});
    m.on('popupopen', ev => { const b = ev.popup.getElement().querySelector('.popbtn'); if (b) b.onclick = () => go('detail', {spotId: b.dataset.id, planIdx: 0}); });
    liveMaps.push(m);
  });
  pendingMaps = [];
}
function locate() {
  return new Promise((res, rej) => {
    if (!navigator.geolocation) return rej(new Error('no'));
    navigator.geolocation.getCurrentPosition(p => { st.pos = {id: 'here', lat: p.coords.latitude, lng: p.coords.longitude, name: '現在地'}; res(st.pos); }, rej, {enableHighAccuracy: true, timeout: 10000, maximumAge: 60000});
  });
}

// ---------- 保存 ----------
const STORE_KEY = 'kyotoMap.v1';
let mem = null;
function load() {
  const def = {lists: [], visited: []};
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return Object.assign(def, JSON.parse(raw)); } catch (e) {}
  return mem || def;
}
let db = load();
function save() { mem = db; try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) {} }

// ---------- 状態 ----------
const st = {
  view: 'list', spotId: null, planIdx: 0, listId: null,
  sort: 'star', listMode: 'cards', pos: null, hiddenOnly: false, q: '', genres: [], area: '', era: '', season: '', person: '',
  start: 'kyoto', end: 'kyoto', order: 'time', onsenLast: true,
  sheet: null, toast: ''
};
const history_ = [];
function go(view, extra = {}) { history_.push({view: st.view, spotId: st.spotId, listId: st.listId, planIdx: st.planIdx}); Object.assign(st, {view, sheet: null}, extra); render(); window.scrollTo(0, 0); }
function back() { const h = history_.pop(); if (h) Object.assign(st, h, {sheet: null}); else st.view = 'list'; render(); }
function toast(msg) { st.toast = msg; render(); setTimeout(() => { st.toast = ''; render(); }, 1800); }

// ---------- 距離・時間 ----------
function km(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const TRAVEL = {
  transit: {label: '電車・バス', icon: '🚃', gm: 'transit', note: '1.2km以内は徒歩、それより遠いと電車・バスで計算します。'},
  walk: {label: '徒歩のみ', icon: '🚶', gm: 'walking', note: '全区間を歩く計算です。長い区間は時間がかかります。'},
  bike: {label: '自転車', icon: '🚲', gm: 'bicycling', note: 'レンタサイクル・シェアサイクルの想定。自転車は決められた駐輪場へ（路上に置くと撤去されることがあります）。Googleマップで自転車ルートが出ない場合は徒歩ルートで確認してください。'},
  taxi: {label: 'タクシー', icon: '🚕', gm: 'driving', note: '乗り場や配車を待つ時間を含めた目安です。紅葉や桜の時期の東山・嵐山は渋滞に注意。'},
  car: {label: '車', icon: '🚗', gm: 'driving', note: '駐車場を探す時間を含めた目安です。京都市内は駐車場が少なく渋滞しやすいので、郊外（大原・西山・宇治など）向きです。'}
};
function moveMin(a, b, mode = 'transit') {
  const d = km(a, b);
  const walk = {min: Math.max(3, Math.round(d * 1.3 * 1000 / 75)), how: '徒歩', mode: 'walk'};
  if (mode === 'walk') return walk;
  if (mode === 'bike') return d <= 0.4 ? walk : {min: Math.round(d * 1.3 / 0.2) + 3, how: '自転車', mode: 'bike'};
  if (mode === 'taxi') return d <= 0.6 ? walk : {min: Math.round(d * 1.4 / 0.3) + 5, how: 'タクシー', mode: 'taxi'};
  if (mode === 'car') return d <= 0.6 ? walk : {min: Math.round(d * 1.4 / 0.3) + 12, how: '車', mode: 'car'};
  if (d <= 1.2) return walk;
  return {min: Math.round(12 + d * 3), how: '電車・バス', mode: 'transit'};
}
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}時間${m % 60 ? (m % 60) + '分' : ''}` : `${m}分`;
const gmapSpot = s => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.name + ' 京都')}`;
const gmapDir = (a, b, mode = 'transit') => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lng}&destination=${b.lat},${b.lng}&travelmode=${(TRAVEL[mode] || TRAVEL.transit).gm}`;
const gSearch = s => `https://www.google.com/search?q=${encodeURIComponent(s.name + ' 公式')}`;

// ---------- 一覧 ----------
function filtered() {
  const norm = t => String(t).toLowerCase().replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/[\s　・（）()]/g, '');
  const words = norm(st.q).length ? st.q.trim().split(/[\s　]+/).map(norm).filter(Boolean) : [];
  return SPOTS.filter(s => {
    if (!words.length) return true;
    if (!s._q) s._q = norm([s.name, s.kana, s.short, s.area, s.genres.join(''), s.era || '', ...s.people, ...s.people.map(p => PEOPLE[p] || '')].join(' '));
    return words.every(w => s._q.includes(w));
  }).filter(s =>
    (!st.genres.length || s.genres.some(g => st.genres.includes(g))) &&
    (!st.area || s.area === st.area) &&
    (!st.era || s.era === st.era) &&
    (!st.season || s.seasons[st.season]) &&
    (!st.person || s.people.includes(st.person)) &&
    (!st.hiddenOnly || s.hidden));
}
function grouped(list) {
  const groups = [];
  const push = (label, items) => { if (items.length) groups.push({label, items}); };
  if (st.sort === 'star') {
    const order = (a, b) => (AREAS.indexOf(a.area) - AREAS.indexOf(b.area)) || a.kana.localeCompare(b.kana, 'ja');
    push('★★★ 定番・必見', list.filter(s => s.star === 3).sort(order));
    push('★★ おすすめ', list.filter(s => s.star === 2).sort(order));
    push('★ 好きな人向け・穴場', list.filter(s => (s.star || 1) === 1).sort(order));
  } else if (st.sort === 'era') {
    ERAS.forEach(e => push(e.label, list.filter(s => s.era === e.k).sort((a, b) => a.year - b.year)));
    push('時代なし（グルメ・景色・温泉など）', list.filter(s => !s.era));
  } else if (st.sort === 'person') {
    Object.entries(PEOPLE).sort((a, b) => a[1].localeCompare(b[1], 'ja')).forEach(([p]) => push(p, list.filter(s => s.people.includes(p))));
    push('ゆかりの人物なし', list.filter(s => !s.people.length));
  } else if (st.sort === 'near' && st.pos) {
    push('現在地から近い順', [...list].sort((a, b) => km(st.pos, a) - km(st.pos, b)));
  } else if (st.sort === 'name') {
    push('建物・場所の名前順（五十音）', [...list].sort((a, b) => a.kana.localeCompare(b.kana, 'ja')));
  } else if (st.sort === 'area') {
    AREAS.forEach(a => push(a, list.filter(s => s.area === a)));
  } else if (st.sort === 'genre') {
    GENRES.forEach(g => push(g, list.filter(s => s.genres[0] === g)));
  }
  return groups;
}
function card(s) {
  const inList = db.lists.some(l => l.ids.includes(s.id));
  return `<div class="card" data-act="open" data-id="${s.id}">
    <div class="card-main">
      <div class="badges">${s.last ? '<span class="b last">前回行った</span>' : ''}${s.reserve ? '<span class="b reserve">要予約</span>' : ''}${s.hidden ? '<span class="b hid">穴場</span>' : ''}${db.visited.includes(s.id) ? '<span class="b done">行った</span>' : ''}${s.genres.map(g => `<span class="b g">${g}</span>`).join('')}</div>
      <div class="card-title">${esc(s.name)}<span class="stars" aria-label="おすすめ度${s.star || 1}">${'★'.repeat(s.star || 1)}</span></div>
      <div class="card-meta">${st.pos ? `<b class="dist">${km(st.pos, s) < 1 ? Math.round(km(st.pos, s) * 1000) + 'm' : km(st.pos, s).toFixed(1) + 'km'}</b>・` : ''}${esc(s.area)}${s.era ? '・' + esc(ERAS.find(e => e.k === s.era).label) : ''}</div>
      <div class="card-short">${esc(s.short)}</div>
    </div>
    <button class="add ${inList ? 'on' : ''}" data-act="addsheet" data-id="${s.id}" aria-label="気になるリストに追加">${inList ? '★' : '＋'}</button>
  </div>`;
}
function viewList() {
  const list = filtered();
  const sel = (key, opts, label) => `<select data-bind="${key}"><option value="">${label}</option>${opts.map(o => `<option value="${esc(o[0])}" ${st[key] === o[0] ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
  const usedEras = ERAS.filter(e => SPOTS.some(s => s.era === e.k));
  return `
  <header class="top"><h1>京都 ゆかりマップ</h1><p>行った場所から、つながる次の場所へ</p></header>
  <div class="controls">
    <input type="search" data-bind="q" placeholder="名前・人物・よみがな（例：りょうま、紅葉 寺）" value="${esc(st.q)}">
    <div class="row"><label class="lbl">並び替え</label>
      <div class="seg">${[['star','おすすめ'],['era','時代'],['person','人物'],['name','名前'],['area','地域'],['genre','ジャンル'],['near','近い順']].map(([k, l]) => `<button class="${st.sort === k ? 'on' : ''}" data-act="sort" data-k="${k}">${l}</button>`).join('')}</div>
    </div>
    <div class="chips">${GENRES.map(g => `<button class="chip ${st.genres.includes(g) ? 'on' : ''}" data-act="genre" data-k="${g}">${g}</button>`).join('')}<button class="chip hidchip ${st.hiddenOnly ? 'on' : ''}" data-act="hiddenonly">穴場だけ</button></div>
    <div class="selects">
      ${sel('area', AREAS.map(a => [a, a]), 'すべての地域')}
      ${sel('era', usedEras.map(e => [e.k, e.label]), 'すべての時代')}
      ${sel('season', ['春','夏','秋','冬'].map(x => [x, x + 'の見どころ']), 'すべての季節')}
      ${sel('person', Object.keys(PEOPLE).map(p => [p, p]), 'すべての人物')}
    </div>
    <div id="qcount">${(st.hiddenOnly || st.genres.length || st.area || st.era || st.season || st.person || st.q) ? `<button class="link" data-act="clear">絞り込みを解除（${list.length}件）</button>` : `<div class="count">${list.length}件</div>`}</div>
  </div>
  <div class="seg view-toggle"><button class="${st.listMode === 'cards' ? 'on' : ''}" data-act="listmode" data-k="cards">一覧で見る</button><button class="${st.listMode === 'map' ? 'on' : ''}" data-act="listmode" data-k="map">地図で見る</button></div>
  <div id="results">${st.listMode === 'map' ? (list.length ? mapBlock(list.map(s => ({...s, label: s.name})), []) : '<p class="empty">条件に合う場所がありません</p>') :
  (grouped(list).map(g => `<h2 class="grp">${esc(g.label)}</h2>${g.items.map(card).join('')}`).join('') || '<p class="empty">条件に合う場所がありません</p>')}</div>`;
}

// ---------- 地図（簡易図） ----------
const RIVERS = [
  [[35.075,135.752],[35.058,135.757],[35.045,135.765],[35.0297,135.7716]],
  [[35.065,135.800],[35.045,135.787],[35.0297,135.7716]],
  [[35.0297,135.7716],[35.009,135.771],[35.0037,135.7716],[34.989,135.769],[34.965,135.764],[34.935,135.750],[34.912,135.725]],
  [[35.030,135.660],[35.0125,135.6775],[34.995,135.690],[34.965,135.705],[34.935,135.718],[34.905,135.715]],
  [[34.882,135.820],[34.8915,135.807],[34.905,135.785],[34.918,135.760],[34.912,135.725],[34.900,135.700]]
];
function mapSvg(points, route, opt = {}) {
  // points: [{lat,lng,label,kind}] route: [[lat,lng],...]
  const all = [...points, ...route.map(p => ({lat: p[0], lng: p[1]}))];
  let minLat = Math.min(...all.map(p => p.lat)), maxLat = Math.max(...all.map(p => p.lat));
  let minLng = Math.min(...all.map(p => p.lng)), maxLng = Math.max(...all.map(p => p.lng));
  const pad = 0.012;
  minLat -= pad; maxLat += pad; minLng -= pad; maxLng += pad;
  const k = Math.cos(35 * Math.PI / 180);
  let w = (maxLng - minLng) * k, h = maxLat - minLat;
  if (w < h * 1.2) { const add = (h * 1.2 - w) / k / 2; minLng -= add; maxLng += add; w = h * 1.2; }
  if (h < w * 0.7) { const add = (w * 0.7 - h) / 2; minLat -= add; maxLat += add; h = w * 0.7; }
  const X = lng => (lng - minLng) * k, Y = lat => maxLat - lat;
  const u = w / 100;
  const poly = pts => pts.map(p => `${X(p[1]).toFixed(5)},${Y(p[0]).toFixed(5)}`).join(' ');
  const shown = SPOTS.filter(s => s.lat > minLat && s.lat < maxLat && s.lng > minLng && s.lng < maxLng && !points.some(p => p.id === s.id));
  return `<svg class="map" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="簡易地図">
    <rect width="${w}" height="${h}" fill="var(--map)"/>
    ${RIVERS.map(r => `<polyline points="${poly(r)}" fill="none" stroke="var(--river)" stroke-width="${u * 1.1}" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    ${STATIONS.filter(s => s.lat > minLat && s.lat < maxLat && s.lng > minLng && s.lng < maxLng).map(s => `<g><rect x="${X(s.lng) - u * 0.9}" y="${Y(s.lat) - u * 0.9}" width="${u * 1.8}" height="${u * 1.8}" fill="var(--paper)" stroke="var(--ink-soft)" stroke-width="${u * 0.35}"/><text x="${X(s.lng) + u * 1.6}" y="${Y(s.lat) + u * 0.9}" font-size="${u * 2.6}" fill="var(--ink-soft)">${esc(s.name)}</text></g>`).join('')}
    ${shown.map(s => `<circle cx="${X(s.lng)}" cy="${Y(s.lat)}" r="${u * 0.8}" fill="var(--dim)"/>`).join('')}
    ${route.length > 1 ? `<polyline points="${poly(route)}" fill="none" stroke="var(--accent)" stroke-width="${u * 0.7}" stroke-dasharray="${u * 1.6} ${u * 1}" stroke-linecap="round"/>` : ''}
    ${points.map(p => `<g><circle cx="${X(p.lng)}" cy="${Y(p.lat)}" r="${u * (p.main ? 2.6 : 2.1)}" fill="${p.main ? 'var(--accent)' : 'var(--ink)'}" stroke="var(--paper)" stroke-width="${u * 0.5}"/>
      ${p.num ? `<text x="${X(p.lng)}" y="${Y(p.lat) + u * 0.95}" font-size="${u * 2.6}" text-anchor="middle" fill="var(--paper)" font-weight="700">${p.num}</text>` : ''}
      <text x="${X(p.lng) + u * 3}" y="${Y(p.lat) + u * 1}" font-size="${u * 3}" fill="var(--ink)" font-weight="700" paint-order="stroke" stroke="var(--map)" stroke-width="${u * 0.8}">${esc(p.label)}</text></g>`).join('')}
  </svg><div class="map-note">※ 位置関係をつかむための簡易図です。正確な場所と経路はGoogleマップで確認してください。</div>`;
}

// ---------- 詳細 ----------
function plansFor(id) { return PLANS.filter(p => p.stops.some(x => x.id === id)); }
function viewDetail() {
  const s = byId[st.spotId];
  const plans = plansFor(s.id);
  const pi = Math.min(st.planIdx, Math.max(0, plans.length - 1));
  const plan = plans[pi];
  const pts = plan ? plan.stops.map((x, i) => ({...byId[x.id], label: byId[x.id].name, num: i + 1, main: x.id === s.id})) : [{...s, label: s.name, main: true}];
  const route = plan ? plan.stops.map(x => [byId[x.id].lat, byId[x.id].lng]) : [];
  const near = SPOTS.filter(o => o.id !== s.id && (o.genres.includes('食事') || o.genres.includes('お土産') || o.genres.includes('温泉')) && km(s, o) < 2.5).sort((a, b) => km(s, a) - km(s, b)).slice(0, 4);
  const groups = GROUPS.filter(g => g.ids.includes(s.id));
  const visited = db.visited.includes(s.id);
  const L = 'ABCDEFGH';
  return `
  <div class="bar"><button class="back" data-act="back">‹ 戻る</button><button class="add-wide" data-act="addsheet" data-id="${s.id}">＋ 気になるリストへ</button></div>
  <article class="detail">
    <div class="badges">${s.last ? '<span class="b last">前回行った</span>' : ''}${s.reserve ? '<span class="b reserve">要予約</span>' : ''}${s.hidden ? '<span class="b hid">穴場</span>' : ''}${s.genres.map(g => `<span class="b g">${g}</span>`).join('')}${s.era ? `<span class="b">${esc(ERAS.find(e => e.k === s.era).label)}</span>` : ''}</div>
    <h1>${esc(s.name)}</h1>
    <div class="stars big" aria-label="おすすめ度${s.star || 1}">${'★'.repeat(s.star || 1)}${'☆'.repeat(3 - (s.star || 1))}<small>${['', '好きな人向け・穴場', 'おすすめ', '定番・必見'][s.star || 1]}</small></div>
    <div class="kana">${esc(s.kana)}</div>
    <p class="long">${esc(s.long)}</p>
    <dl class="info">
      <dt>アクセス</dt><dd>${esc(s.access)}</dd>
      <dt>滞在の目安</dt><dd>約${fmtMin(s.stay)}</dd>
      ${s.people.length ? `<dt>ゆかりの人物</dt><dd>${s.people.map(p => `<button class="tag" data-act="person" data-k="${esc(p)}">${esc(p)}</button>`).join('')}</dd>` : ''}
      ${Object.keys(s.seasons).length ? `<dt>季節の見どころ</dt><dd>${Object.entries(s.seasons).map(([k, v]) => `<div><b>${k}</b> ${esc(v)}</div>`).join('')}</dd>` : ''}
    </dl>
    <div class="btns">
      <a class="btn" href="${gmapSpot(s)}" target="_blank" rel="noopener">Googleマップで開く</a>
      <a class="btn ghost" href="${gSearch(s)}" target="_blank" rel="noopener">公式情報を検索</a>
      <button class="btn ghost ${visited ? 'on' : ''}" data-act="visited" data-id="${s.id}">${visited ? '✓ 行った' : '行ったら記録'}</button>
    </div>

    <h2 class="sec">地図</h2>
    ${plans.length ? `<div class="plan-tabs">${plans.map((p, i) => `<button class="${i === pi ? 'on' : ''}" data-act="plan" data-i="${i}">${L[i]}プラン</button>`).join('')}</div>` : ''}
    ${mapBlock(pts, route)}

    <h2 class="sec">ここから行くなら</h2>
    ${plans.map((p, i) => planCard(p, s.id, L[i], i === pi)).join('')}

    ${groups.length ? `<h2 class="sec">同じ仲間</h2>${groups.map(g => `<div class="group"><div class="group-name">${esc(g.name)}</div><div class="mini-list">${g.ids.filter(x => x !== s.id).map(x => `<button class="mini" data-act="open" data-id="${x}">${esc(byId[x].name)}</button>`).join('')}</div></div>`).join('')}` : ''}

    ${near.length ? `<h2 class="sec">近くの寄り道（グルメ・お土産・温泉）</h2><div class="mini-list">${near.map(o => `<button class="mini" data-act="open" data-id="${o.id}">${esc(o.name)}<small>${moveMin(s, o).how}約${moveMin(s, o).min}分</small></button>`).join('')}</div>` : ''}
  </article>`;
}
const TYPE_LABEL = {'ゆかり': 'ゆかり', '三大': '三大○○', '時代': '時代の流れ', '寄り道': '寄り道'};
function planCard(p, curId, letter, active) {
  return `<section class="plan ${active ? 'active' : ''}">
    <div class="plan-head"><span class="plan-letter">${letter}</span><div><div class="plan-type t-${p.type}">${TYPE_LABEL[p.type]}</div><div class="plan-title">${esc(p.title)}</div></div></div>
    <p class="plan-desc">${esc(p.desc)}　<b>所要 ${esc(p.time)}</b></p>
    <ol class="steps">${p.stops.map((x, i) => `
      <li class="step-row ${x.id === curId ? 'cur' : ''}">
        <button class="step" data-act="open" data-id="${x.id}"><span class="num">${i + 1}</span><span><b>${esc(byId[x.id].name)}</b>${x.id === curId ? '<em>いまここ</em>' : ''}<br><small>${esc(x.note)}</small></span></button>
        ${(() => { const on = db.lists.some(l => l.ids.includes(x.id)); return `<button class="add sm ${on ? 'on' : ''}" data-act="addsheet" data-id="${x.id}" aria-label="気になるリストに追加">${on ? '★' : '＋'}</button>`; })()}
      </li>
      ${i < p.legs.length ? `<li class="leg"><span>↓ ${esc(p.legs[i])}</span><a href="${gmapDir(byId[x.id], byId[p.stops[i + 1].id])}" target="_blank" rel="noopener">経路</a></li>` : ''}`).join('')}
    </ol>
    <div class="plan-actions">${active ? '' : `<button class="link" data-act="planmap" data-pid="${p.id}">このプランを地図に表示</button>`}</div>
    <button class="btn plan-add" data-act="addplansheet" data-pid="${p.id}">＋ このプランをまとめて気になるリストへ</button>
  </section>`;
}

// ---------- 気になるリスト ----------
function newList(name, ids = []) { const l = {id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name || '新しいリスト', ids}; db.lists.push(l); save(); return l; }
function viewLists() {
  return `<header class="top"><h1>気になるリスト</h1><p>リストごとに、おすすめの順番で回るコースを作れます</p></header>
  <div class="controls"><div class="btns">
    <button class="btn" data-act="newlist">＋ 新しいリスト</button>
    <button class="btn ghost" data-act="importsheet">共有されたリストを取り込む</button>
  </div></div>
  ${db.lists.length ? db.lists.map(l => `<div class="card" data-act="openlist" data-id="${l.id}"><div class="card-main"><div class="card-title">${esc(l.name)}</div><div class="card-short">${l.ids.length ? l.ids.map(i => byId[i] ? esc(byId[i].name) : '').filter(Boolean).join('・') : 'まだ場所がありません。一覧の「＋」から追加'}</div></div><span class="count-pill">${l.ids.length}</span></div>`).join('') : '<p class="empty">まだリストがありません。<br>一覧で気になる場所の「＋」を押すか、上のボタンで作ってください。</p>'}`;
}
const legKey = (a, b) => (a.id || 'here') + '>' + (b.id || 'here');
function legMode(l, a, b) { return (l.legModes && l.legModes[legKey(a, b)]) || l.mode || 'transit'; }
function legRow(l, a, b) {
  const mode = legMode(l, a, b), m = moveMin(a, b, mode), custom = !!(l.legModes && l.legModes[legKey(a, b)]);
  const sel = `<select class="legsel ${custom ? 'custom' : ''}" data-leg="${esc(legKey(a, b))}" aria-label="この区間の移動手段">${Object.entries(TRAVEL).map(([k, t]) => `<option value="${k}" ${k === mode ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}</select>`;
  return {m, html: `<li class="leg"><span>↓ ${m.how} 約${m.min}分（目安）</span><span class="legr">${sel}<a href="${gmapDir(a, b, m.mode)}" target="_blank" rel="noopener">経路</a></span></li>`};
}
function orderCourse(l) {
  const pick = id => (id === 'here' && st.pos) ? st.pos : (STATIONS.find(s => s.id === id) || STATIONS[0]);
  const start = pick(st.start), end = pick(st.end);
  let spots = l.ids.map(i => byId[i]).filter(Boolean);
  const onsens = st.onsenLast ? spots.filter(s => s.onsen) : [];
  spots = spots.filter(s => !onsens.includes(s));
  const lm = (a, b) => legMode(l, a, b);
  const cost = (seq, from, to) => { let c = 0, prev = from; for (const s of seq) { c += moveMin(prev, s, lm(prev, s)).min; prev = s; } return c + (to ? moveMin(prev, to, lm(prev, to)).min : 0); };
  let seq;
  if (st.order === 'era') {
    const hist = spots.filter(s => s.year).sort((a, b) => a.year - b.year);
    const other = spots.filter(s => !s.year);
    seq = [...hist];
    other.forEach(o => {
      if (!seq.length) { seq.push(o); return; }
      let best = 0, bd = Infinity;
      seq.forEach((h, i) => { const d = km(h, o); if (d < bd) { bd = d; best = i; } });
      seq.splice(best + 1, 0, o);
    });
  } else {
    const rest = [...spots]; seq = []; let cur = start;
    while (rest.length) { rest.sort((a, b) => km(cur, a) - km(cur, b)); cur = rest.shift(); seq.push(cur); }
    let improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let i = 0; i < seq.length - 1; i++) for (let j = i + 1; j < seq.length; j++) {
        const cand = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
        if (cost(cand, start, onsens.length ? null : end) < cost(seq, start, onsens.length ? null : end)) { seq = cand; improved = true; }
      }
    }
  }
  if (onsens.length) {
    const last = seq.length ? seq[seq.length - 1] : start;
    onsens.sort((a, b) => km(last, a) - km(last, b));
    seq = [...seq, ...onsens];
  }
  return {start, end, seq};
}
function viewCourse() {
  const l = db.lists.find(x => x.id === st.listId);
  if (!l) return viewLists();
  const {start, end, seq} = orderCourse(l);
  const stOpt = key => `<select data-bind="${key}">${MODE === 'web' ? `<option value="here" ${st[key] === 'here' ? 'selected' : ''}>現在地</option>` : ''}${STATIONS.map(s => `<option value="${s.id}" ${st[key] === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  let total = 0, moveTotal = 0, rows = '', prev = start;
  seq.forEach((s, i) => {
    const r = legRow(l, prev, s), m = r.m; moveTotal += m.min; total += m.min + s.stay;
    rows += r.html + `
      <li><div class="step course-step"><span class="num">${i + 1}</span><span class="grow" data-act="open" data-id="${s.id}"><b>${esc(s.name)}</b><br><small>${esc(s.area)}・滞在 約${fmtMin(s.stay)}${s.era ? '・' + esc(s.era) : ''}</small></span><button class="x" data-act="removefrom" data-id="${s.id}" aria-label="リストから外す">×</button></div></li>`;
    prev = s;
  });
  if (seq.length) { const r = legRow(l, prev, end); moveTotal += r.m.min; total += r.m.min; rows += r.html; }
  const cur = l.mode || 'transit', nCustom = l.legModes ? Object.keys(l.legModes).length : 0;
  const pts = seq.map((s, i) => ({...s, label: s.name, num: i + 1}));
  const route = [[start.lat, start.lng], ...seq.map(s => [s.lat, s.lng]), [end.lat, end.lng]];
  return `
  <div class="bar"><button class="back" data-act="back">‹ 戻る</button><button class="add-wide" data-act="share">共有用にコピー</button></div>
  <article class="detail">
    <div class="list-name-row"><h1>${esc(l.name)}</h1><button class="link" data-act="renamesheet">名前を変える</button></div>
    <div class="course-opts">
      <div class="row"><label class="lbl">出発</label>${stOpt('start')}</div>
      <div class="row"><label class="lbl">帰り</label>${stOpt('end')}</div>
      <div class="row"><label class="lbl">順番</label><div class="seg"><button class="${st.order === 'time' ? 'on' : ''}" data-act="order" data-k="time">移動が短い順</button><button class="${st.order === 'era' ? 'on' : ''}" data-act="order" data-k="era">時代順</button></div></div>
      <label class="check"><input type="checkbox" data-bind-check="onsenLast" ${st.onsenLast ? 'checked' : ''}> 温泉は最後に回す</label>
      <div class="row"><label class="lbl">移動</label><div class="seg modes">${Object.entries(TRAVEL).map(([k, t]) => `<button class="${cur === k ? 'on' : ''}" data-act="tmode" data-k="${k}">${t.icon}<br>${t.label}</button>`).join('')}</div></div>
      <p class="mode-note">${esc(TRAVEL[cur].note)} 区間ごとに変えたいときは、各区間の選択欄で変更できます。${nCustom ? `<br><button class="link" data-act="legreset">区間ごとの指定（${nCustom}か所）をリセット</button>` : ''}</p>
    </div>
    ${seq.length ? `
      <div class="summary"><div><b>${fmtMin(total)}</b><small>合計の目安</small></div><div><b>${fmtMin(moveTotal)}</b><small>移動</small></div><div><b>${seq.length}か所</b><small>スポット</small></div></div>
      ${total > 540 ? '<div class="warn">1日（約9時間）では回りきれない可能性があります。場所を減らすか、2つのリストに分けるのがおすすめです。</div>' : ''}
      ${mapBlock(pts, route)}
      <ol class="steps course"><li><div class="step station"><span class="num">発</span><b>${esc(start.name)}</b></div></li>${rows}<li><div class="step station"><span class="num">着</span><b>${esc(end.name)}</b></div></li></ol>
      <p class="map-note">移動時間は直線距離からの目安です。実際の時間は「経路」ボタンからGoogleマップで確認してください。</p>`
    : '<p class="empty">まだ場所がありません。一覧の「＋」から追加してください。</p>'}
    <div class="btns"><button class="btn ghost" data-act="goadd">一覧から場所を追加</button><button class="btn danger" data-act="delsheet">このリストを削除</button></div>
  </article>`;
}

// ---------- 共有 ----------
const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
function shareUrl(l) { return location.origin + location.pathname + '#import=' + b64e(JSON.stringify({n: l.name, i: l.ids})); }
function shareText(l) {
  return `【京都ゆかりマップ】${l.name}\n${l.ids.map((i, n) => `${n + 1}. ${byId[i] ? byId[i].name : ''}`).join('\n')}\n\n↓ページの「共有されたリストを取り込む」に、このメッセージを丸ごと貼り付けてください\nKM1:${b64e(JSON.stringify({n: l.name, i: l.ids}))}`;
}
// 共有メッセージ（リンク「#import=…」または「KM1:…」）からリストを取り込む。同じ内容が取り込み済みならそれを開く
function importText(t) {
  const m = String(t).match(/(?:KM1:|#import=)([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    const o = JSON.parse(b64d(m[1])); const ids = (o.i || []).filter(i => byId[i]);
    if (!ids.length) return null;
    const name = (o.n || '共有リスト') + '（取り込み）';
    const same = db.lists.find(l => l.name === name && l.ids.join() === ids.join());
    return same || newList(name, ids);
  } catch (e) { return null; }
}

// ---------- シート（ダイアログ） ----------
function viewSheet() {
  const sh = st.sheet; if (!sh) return '';
  let body = '';
  if (sh.type === 'add') {
    const s = byId[sh.id];
    body = `<h3>「${esc(s.name)}」をリストに追加</h3>
      ${db.lists.map(l => { const on = l.ids.includes(s.id); return `<button class="sheet-row ${on ? 'on' : ''}" data-act="toggleIn" data-lid="${l.id}" data-id="${s.id}"><span>${esc(l.name)}</span><span>${on ? '✓ 追加済み' : '追加'}</span></button>`; }).join('')}
      <div class="new-row"><input id="newname" placeholder="新しいリストの名前（例：秀吉めぐり）"><button class="btn" data-act="createAndAdd" data-id="${s.id}">作って追加</button></div>`;
  } else if (sh.type === 'addplan') {
    const p = PLANS.find(x => x.id === sh.pid);
    body = `<h3>「${esc(p.title)}」の${p.stops.length}か所をまとめて追加</h3>
      <p>${p.stops.map(x => esc(byId[x.id].name)).join('・')}</p>
      ${db.lists.map(l => { const all = p.stops.every(x => l.ids.includes(x.id)); return `<button class="sheet-row ${all ? 'on' : ''}" data-act="planIn" data-lid="${l.id}" data-pid="${p.id}"><span>${esc(l.name)}</span><span>${all ? '✓ 追加済み' : '追加'}</span></button>`; }).join('')}
      <div class="new-row"><input id="newname" value="${esc(p.title)}"><button class="btn" data-act="planNew" data-pid="${p.id}">新しいリストで追加</button></div>`;
  } else if (sh.type === 'new') {
    body = `<h3>新しいリスト</h3><div class="new-row"><input id="newname" placeholder="例：秀吉めぐり、食べ歩きコース"><button class="btn" data-act="create">作る</button></div>`;
  } else if (sh.type === 'rename') {
    const l = db.lists.find(x => x.id === st.listId);
    body = `<h3>名前を変える</h3><div class="new-row"><input id="newname" value="${esc(l.name)}"><button class="btn" data-act="rename">変更</button></div>`;
  } else if (sh.type === 'delete') {
    body = `<h3>このリストを削除しますか？</h3><p>元に戻せません。</p><div class="btns"><button class="btn danger" data-act="delete">削除する</button><button class="btn ghost" data-act="closesheet">やめる</button></div>`;
  } else if (sh.type === 'import') {
    body = `<h3>共有されたリストを取り込む</h3><p>LINEなどで受け取ったメッセージ（リンクを含む）を丸ごと貼り付けてください。ホーム画面のアイコンから使っている場合は、リンクを開くより、この方法が確実です。</p><textarea id="importbox" rows="6" placeholder="【京都ゆかりマップ】…&#10;https://…#import=…"></textarea><div class="btns"><button class="btn" data-act="import">取り込む</button></div>${sh.err ? `<p class="err">${esc(sh.err)}</p>` : ''}`;
  } else if (sh.type === 'share') {
    body = `<h3>共有用テキスト</h3><p>コピーできなかったときは、下の文字を長押しで全部選んでコピーしてください。</p><textarea rows="8" readonly>${esc(sh.text)}</textarea>`;
  }
  return `<div class="overlay" data-act="closesheet"></div><div class="sheet">${body}<button class="sheet-close" data-act="closesheet">閉じる</button></div>`;
}

// ---------- 描画 ----------
function render() {
  let main = st.view === 'detail' ? viewDetail() : st.view === 'lists' ? viewLists() : st.view === 'course' ? viewCourse() : viewList();
  const tab = (v, label) => `<button class="${(st.view === v || (v === 'lists' && st.view === 'course') || (v === 'list' && st.view === 'detail')) ? 'on' : ''}" data-act="tab" data-k="${v}">${label}</button>`;
  $app.innerHTML = `<main>${main}</main><nav class="tabs">${tab('list', '一覧')}${tab('lists', '気になるリスト' + (db.lists.length ? ` (${db.lists.length})` : ''))}</nav>${viewSheet()}${st.toast ? `<div class="toast">${esc(st.toast)}</div>` : ''}`;
  mountMaps();
}

// ---------- 操作 ----------
$app.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = el.dataset.act, id = el.dataset.id, k = el.dataset.k;
  if (a !== 'open' || !e.target.closest('button.add')) e.stopPropagation();
  const val = () => (document.getElementById('newname') || {}).value?.trim();
  switch (a) {
    case 'open': if (e.target.closest('[data-act="addsheet"]')) return; go('detail', {spotId: id, planIdx: 0}); break;
    case 'addsheet': e.stopPropagation(); st.sheet = {type: 'add', id}; render(); break;
    case 'back': back(); break;
    case 'tab': history_.length = 0; Object.assign(st, {view: k, sheet: null}); render(); window.scrollTo(0, 0); break;
    case 'sort':
      if (k === 'near' && !st.pos) { try { await locate(); } catch (err) { toast('現在地を取得できませんでした（位置情報の許可を確認してください）'); break; } }
      st.sort = k; render(); break;
    case 'listmode': st.listMode = k; render(); break;
    case 'hiddenonly': st.hiddenOnly = !st.hiddenOnly; render(); break;
    case 'genre': st.genres = st.genres.includes(k) ? st.genres.filter(x => x !== k) : [...st.genres, k]; render(); break;
    case 'clear': Object.assign(st, {hiddenOnly: false, genres: [], area: '', era: '', season: '', person: '', q: ''}); render(); break;
    case 'person': history_.length = 0; Object.assign(st, {view: 'list', person: k, sort: 'era'}); render(); window.scrollTo(0, 0); break;
    case 'plan': st.planIdx = +el.dataset.i; render(); break;
    case 'planmap': { const ps = plansFor(st.spotId); st.planIdx = ps.findIndex(p => p.id === el.dataset.pid); render(); document.querySelector('.plan-tabs')?.scrollIntoView({behavior: 'smooth'}); break; }
    case 'addplansheet': st.sheet = {type: 'addplan', pid: el.dataset.pid}; render(); break;
    case 'planIn': { const p = PLANS.find(x => x.id === el.dataset.pid); const l = db.lists.find(x => x.id === el.dataset.lid); p.stops.forEach(x => { if (!l.ids.includes(x.id)) l.ids.push(x.id); }); save(); st.sheet = null; toast(`「${l.name}」に追加しました`); break; }
    case 'planNew': { const p = PLANS.find(x => x.id === el.dataset.pid); const l = newList(val() || p.title, p.stops.map(x => x.id)); st.sheet = null; toast(`「${l.name}」を作って追加しました`); break; }
    case 'visited': db.visited = db.visited.includes(id) ? db.visited.filter(x => x !== id) : [...db.visited, id]; save(); render(); break;
    case 'toggleIn': { const l = db.lists.find(x => x.id === el.dataset.lid); l.ids = l.ids.includes(id) ? l.ids.filter(x => x !== id) : [...l.ids, id]; save(); render(); break; }
    case 'createAndAdd': { const l = newList(val()); l.ids.push(id); save(); st.sheet = null; toast(`「${l.name}」に追加しました`); break; }
    case 'newlist': st.sheet = {type: 'new'}; render(); break;
    case 'create': { const l = newList(val()); st.sheet = null; go('course', {listId: l.id}); break; }
    case 'openlist': go('course', {listId: id}); break;
    case 'renamesheet': st.sheet = {type: 'rename'}; render(); break;
    case 'rename': { const l = db.lists.find(x => x.id === st.listId); if (val()) l.name = val(); save(); st.sheet = null; render(); break; }
    case 'delsheet': st.sheet = {type: 'delete'}; render(); break;
    case 'delete': db.lists = db.lists.filter(x => x.id !== st.listId); save(); history_.length = 0; Object.assign(st, {view: 'lists', sheet: null}); toast('削除しました'); break;
    case 'removefrom': { const l = db.lists.find(x => x.id === st.listId); l.ids = l.ids.filter(x => x !== id); save(); render(); break; }
    case 'goadd': history_.length = 0; Object.assign(st, {view: 'list'}); render(); window.scrollTo(0, 0); break;
    case 'order': st.order = k; render(); break;
    case 'tmode': { const l = db.lists.find(x => x.id === st.listId); l.mode = k; save(); render(); break; }
    case 'legreset': { const l = db.lists.find(x => x.id === st.listId); l.legModes = {}; save(); render(); break; }
    case 'share': {
      const l = db.lists.find(x => x.id === st.listId); let text = shareText(l);
      if (MODE === 'web') {
        const url = shareUrl(l), names = l.ids.map(i => byId[i] ? byId[i].name : '').join('・');
        if (navigator.share) { try { await navigator.share({title: '京都ゆかりマップ：' + l.name, text: `【京都ゆかりマップ】${l.name}\n${names}\n開くとリストを取り込めます（ホーム画面のアプリで使う場合は、このメッセージをコピーして「共有されたリストを取り込む」に貼り付け）`, url}); break; } catch (err) { if (err && err.name === 'AbortError') break; } }
        text = `【京都ゆかりマップ】${l.name}\n${names}\n↓開くとリストを取り込めます（ホーム画面のアプリで使う場合は、このメッセージをコピーして「共有されたリストを取り込む」に貼り付け）\n${url}`;
      }
      try { await navigator.clipboard.writeText(text); toast('コピーしました。LINEなどに貼り付けて送れます'); }
      catch (err) { st.sheet = {type: 'share', text}; render(); }
      break;
    }
    case 'importsheet': st.sheet = {type: 'import'}; render(); break;
    case 'import': { const l = importText(document.getElementById('importbox').value); if (l) { st.sheet = null; toast('取り込みました'); go('course', {listId: l.id}); } else { st.sheet = {type: 'import', err: '読み取れませんでした。「https://…#import=」から始まるリンクの部分も含めて、メッセージを丸ごと貼り付けてください。'}; render(); } break; }
    case 'closesheet': st.sheet = null; render(); break;
  }
});
// 検索：入力欄は描き直さず、件数と結果だけを更新する（日本語入力の変換中は更新しない）
let qTimer = null;
function updateResults() {
  const tmp = document.createElement('div'); tmp.innerHTML = viewList();
  ['results', 'qcount'].forEach(id => { const cur = document.getElementById(id), nw = tmp.querySelector('#' + id); if (cur && nw) cur.innerHTML = nw.innerHTML; });
  mountMaps();
}
function onSearch(el) { st.q = el.value; clearTimeout(qTimer); qTimer = setTimeout(updateResults, 150); }
$app.addEventListener('input', e => {
  if (e.target.dataset.bind !== 'q') return;
  if (e.isComposing) return;
  onSearch(e.target);
});
$app.addEventListener('compositionend', e => { if (e.target.dataset.bind === 'q') onSearch(e.target); });
$app.addEventListener('change', e => {
  const k = e.target.dataset.bind;
  if (k && k !== 'q') {
    if (e.target.value === 'here' && !st.pos) { locate().then(() => { st[k] = 'here'; render(); }).catch(() => { toast('現在地を取得できませんでした'); }); return; }
    st[k] = e.target.value; render();
  }
  const c = e.target.dataset.bindCheck; if (c) { st[c] = e.target.checked; render(); }
  const lk = e.target.dataset.leg;
  if (lk) { const l = db.lists.find(x => x.id === st.listId); l.legModes = l.legModes || {}; if (e.target.value === (l.mode || 'transit')) delete l.legModes[lk]; else l.legModes[lk] = e.target.value; save(); render(); }
});
function checkHashImport() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  const l = importText('#import=' + m[1]);
  if (l) { history_.length = 0; Object.assign(st, {view: 'course', listId: l.id, sheet: null, toast: `「${l.name}」を取り込みました`}); setTimeout(() => { st.toast = ''; render(); }, 2500); }
  return true;
}
if (MODE === 'web') {
  checkHashImport();
  // すでに開いているページで共有リンクを開いたとき（ページが読み込み直されない場合）
  window.addEventListener('hashchange', () => { if (checkHashImport()) { render(); window.scrollTo(0, 0); } });
  window.addEventListener('pageshow', e => { if (e.persisted && checkHashImport()) render(); });
}
render();
