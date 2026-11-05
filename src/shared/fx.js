/* =====================================================================
 * fx.js — v2 新增功能（中英文共用）
 * 由 tools/build.py 嵌入 src/{zh,en}/page.html 的 __FX_JS__ 標記位置。
 * 文字放在 src/i18n/{zh,en}.json；功能開關與版本號放在 config.json。
 * 主程式只在幾個固定位置呼叫 FX.xxx()，見 README「主程式掛勾」。
 * ===================================================================== */
const FX = (() => {
  const C = __FX_CONF__;                       // {version, date, lang, features, strings}
  const T = C.strings;
  const on = k => !!C.features[k];
  const t = (k, vars) => {
    let v = T[k]; if (v === undefined) return k;
    if (vars) for (const n in vars) v = v.split('{' + n + '}').join(vars[n]);
    return v;
  };
  const NS = 'http://www.w3.org/2000/svg';
  const RED = '#d62828', BLUE = '#1d4ed8', GREEN = '#1f9d55';
  const W_LIMIT = 1626;                        // 64 吋（mm）
  const st = { wheelChosen: false, lastChecks: [] };
  const WD = { img: null, pts: [], on: false, ratio: null, k: 1 };

  /* ---------- 比例範圍區塊（唯一來源：綠色區塊與標籤共用） ---------- */
  function zones(g) {
    const D = S.wheelD, xs = g.axles.map(a => a.x), last = xs[xs.length - 1], Z = [];
    const six = S.wheelCount === 6;
    Z.push({ key: six ? 'zoneRear1' : 'zoneRear', x0: RANGE.wb[0] * D, x1: RANGE.wb[1] * D, y0: 0, y1: D });
    if (six) { const mid = xs[1]; Z.push({ key: 'zoneRear2', x0: mid + RANGE.tandem[0] * D, x1: mid + RANGE.tandem[1] * D, y0: 0, y1: D * 0.6 }); }
    Z.push({ key: 'zoneRoof', x0: -RANGE.oh[1] * D, x1: last + RANGE.oh[1] * D, y0: RANGE.h[0] * D, y1: RANGE.h[1] * D });
    Z.push({ key: 'zoneNose', x0: -RANGE.oh[1] * D, x1: -RANGE.oh[0] * D, y0: 0, y1: D * 1.4 });
    Z.push({ key: 'zoneTail', x0: last + RANGE.oh[0] * D, x1: last + RANGE.oh[1] * D, y0: 0, y1: D * 1.4 });
    return Z;
  }

  /* ---------- 比例數值（與 runChecks 相同的算法） ---------- */
  function ratios() {
    const g = solve(S), D = S.wheelD, xs = g.axles.map(a => a.x), out = [];
    if (S.wheelCount === 6) {
      const seg = xs.slice(1).map((x, i) => x - xs[i]);
      const iMain = seg.indexOf(Math.max(...seg)), iTan = seg.indexOf(Math.min(...seg));
      out.push({ key: 'dimMain', a: xs[iMain], b: xs[iMain + 1], v: seg[iMain] / D, lo: RANGE.wb[0], hi: RANGE.wb[1] });
      out.push({ key: 'dimTandem', a: xs[iTan], b: xs[iTan + 1], v: seg[iTan] / D, lo: RANGE.tandem[0], hi: RANGE.tandem[1] });
    } else {
      out.push({ key: 'dimWheelbase', a: xs[0], b: xs[xs.length - 1], v: S.wheelbase / D, lo: RANGE.wb[0], hi: RANGE.wb[1] });
    }
    return { g, list: out };
  }

  /* ---------- 通過角：以前後輪心連線為地面（修正圖片傾斜） ---------- */
  function angleGeom() {
    if (!OV.pts || !OV.ang) return null;
    const [a, b] = OV.pts.map(p => [flipU(p[0]), p[1]]);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) return null;
    const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    let n = [-d[1], d[0]]; if (n[1] < 0) n = [-n[0], -n[1]];            // 垂直地面、朝下
    const r = S.wheelD / 2 * L / S.wheelbase;                            // 圖上輪半徑（像素）
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1];
    const out = { r, a, b, n, d, ground: [[a[0] + r * n[0], a[1] + r * n[1]], [b[0] + r * n[0], b[1] + r * n[1]]] };
    for (const [key, Cn, o] of [['front', a, [-d[0], -d[1]]], ['rear', b, d]]) {
      const P0 = OV.ang[key]; if (!P0) continue;
      const P = [flipU(P0[0]), P0[1]], v = [P[0] - Cn[0], P[1] - Cn[1]];
      const u = dot(v, o), w = -dot(v, n), R = Math.hypot(u, w);
      if (u <= 0) { out[key] = { P, err: t('angleErrOutside') }; continue; }
      if (R <= r) { out[key] = { P, err: t('angleErrOnTire') }; continue; }
      const th = Math.atan2(w, u) + Math.asin(r / R), deg = th * 180 / Math.PI;
      let line = null;
      if (deg < 89.5) {
        const len = (w + r) / Math.sin(th);
        const dir = [-Math.cos(th) * o[0] + Math.sin(th) * n[0], -Math.cos(th) * o[1] + Math.sin(th) * n[1]];
        line = [P, [P[0] + dir[0] * len, P[1] + dir[1] * len]];
      }
      out[key] = { P, deg, line, o };
    }
    return out;
  }
  function approachAngles() {
    const G = angleGeom(); if (!G) return null; const out = {};
    for (const k of ['front', 'rear']) if (G[k]) { out[k] = G[k].err ? null : G[k].deg; if (G[k].err) out[k + 'Err'] = G[k].err; }
    return out;
  }

  /* ---------- 檢視台 SVG 圖層 ---------- */
  function svg() { return document.getElementById('fxsvg'); }
  function el(tag, at, parent) {
    const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]);
    (parent || svg()).appendChild(e); return e;
  }
  function label(x, y, str, col, anchor, parent) {
    const e = el('text', { x, y, fill: col, 'text-anchor': anchor || 'middle', class: 'fxlab' }, parent); e.textContent = str; return e;
  }
  function project(x, y) {                                               // 模型 mm → 檢視台像素
    const [W, H] = stageWH(); const v = new THREE.Vector3(x * 0.001, y * 0.001, 0).project(camera);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  }
  function sideReady() { return window.THREE && camera && view === 'side' && S.utv; }

  function drawZoneLabels() {
    if (!on('zoneLabels') || !sideReady() || !$('#bandon').checked) return;
    const g = solve(S);
    for (const z of zones(g)) {                                         // 標在區塊左上角；車頂改標右上角，避開檢視按鈕
      const right = z.key === 'zoneRoof', p = project(right ? z.x1 : z.x0, z.y1);
      label(p[0] + (right ? -3 : 3), p[1] - 5, t(z.key), GREEN, right ? 'end' : 'start');
    }
  }
  function drawRangeDims() {
    if (!on('rangeHighlight') || !sideReady() || !OV.pts || $('#ov').hidden) return;
    const { g, list } = ratios();
    list.forEach((m, i) => {                                            // 尺寸線畫在輪心高度，穿過輪心
      const A = project(m.a, g.r), B = project(m.b, g.r), ok = m.v >= m.lo && m.v <= m.hi, col = ok ? GREEN : RED;
      el('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: col, 'stroke-width': 2.5 });
      for (const P of [A, B]) el('line', { x1: P[0], y1: P[1] - 7, x2: P[0], y2: P[1] + 7, stroke: col, 'stroke-width': 2.5 });
      const verdict = ok ? t('inRange') : (m.v < m.lo ? t('tooShort') : t('tooLong'));
      label((A[0] + B[0]) / 2, i ? A[1] + 22 : A[1] - 10, t(m.key, { v: m.v.toFixed(2), lo: m.lo, hi: m.hi, verdict }), col);
    });
  }
  function drawAngles() {
    if (!on('angleOverlay') || $('#ov').hidden || view !== 'side' || !OV.cur) return;
    const G = angleGeom(); if (!G) return;
    const { s, tx, ty } = OV.cur, X = p => [tx + s * p[0], ty + s * p[1]];
    const ext = Math.max(G.r * 3, 40), g0 = G.ground[0], g1 = G.ground[1];
    const A0 = X([g0[0] - G.d[0] * ext, g0[1] - G.d[1] * ext]), A1 = X([g1[0] + G.d[0] * ext, g1[1] + G.d[1] * ext]);
    el('line', { x1: A0[0], y1: A0[1], x2: A1[0], y2: A1[1], stroke: BLUE, 'stroke-width': 2, 'stroke-dasharray': '8 5' });
    const cx = tx + s * (G.a[0] + G.b[0]) / 2;
    for (const [k, lab] of [['front', t('approach')], ['rear', t('departure')]]) {
      const A = G[k]; if (!A) continue; const P = X(A.P), left = P[0] < cx;
      el('circle', { cx: P[0], cy: P[1], r: 6, fill: 'rgba(214,40,40,.25)', stroke: RED, 'stroke-width': 2 });
      const tag = A.err ? lab + ' ×' : (!A.line ? lab + ' ≥ 90°' : `${lab} ${A.deg.toFixed(0)}°`);
      label(P[0] + (left ? -4 : 4), P[1] - 14, tag, RED, left ? 'start' : 'end');
      if (A.err || !A.line) continue;
      const Q = X(A.line[1]);
      el('line', { x1: P[0], y1: P[1], x2: Q[0], y2: Q[1], stroke: RED, 'stroke-width': 2.5 });
      const rr = Math.min(46, Math.hypot(P[0] - Q[0], P[1] - Q[1]) * 0.6), vx = P[0] - Q[0], vy = P[1] - Q[1], vl = Math.hypot(vx, vy);
      const S0 = [Q[0] + A.o[0] * rr, Q[1] + A.o[1] * rr], S1 = [Q[0] + vx / vl * rr, Q[1] + vy / vl * rr];
      const sweep = (A.o[0] * vy - A.o[1] * vx) > 0 ? 1 : 0;
      el('path', { d: `M${S0[0]} ${S0[1]} A${rr} ${rr} 0 0 ${sweep} ${S1[0]} ${S1[1]}`, fill: 'none', stroke: RED, 'stroke-width': 2 });
    }
  }
  function draw() {
    const g = svg(); if (!g) return; g.innerHTML = '';
    try { drawZoneLabels(); drawRangeDims(); drawAngles(); } catch (e) { console.warn('[FX] draw', e); }
  }

  /* ---------- 輪數確認（載入圖片後先選四輪／六輪） ---------- */
  function wheelUI() {
    const box = $('#fxwheel'); if (!box) return;
    box.innerHTML = `<span>${t('wheelAsk')}</span>` +
      ['utv4', 'utv6'].map(k => `<button class="btn${st.wheelChosen && S.wheelCount === (k === 'utv6' ? 6 : 4) ? ' primary' : ''}" data-k="${k}">${t(k === 'utv6' ? 'six' : 'four')}</button>`).join('');
    box.querySelectorAll('button').forEach(b => b.onclick = () => {
      const want = b.dataset.k === 'utv6' ? 6 : 4;
      if (S.wheelCount !== want) applyPreset(b.dataset.k);
      st.wheelChosen = true; addLog(t('logWheel'), '', String(want)); wheelUI();
      $('#ovmsg').textContent = t('wheelChosen', { n: t(want === 6 ? 'six' : 'four') });
    });
  }
  function onImageLoaded() {
    if (!on('wheelPrompt')) return;
    st.wheelChosen = false; $('#fxwheel').hidden = false; wheelUI();
    $('#ovmsg').textContent = t('wheelFirst');
  }
  function canAlign() {
    if (!on('wheelPrompt') || st.wheelChosen) return true;
    $('#ovmsg').textContent = t('wheelFirst'); return false;
  }
  function onImageCleared() { st.wheelChosen = false; const b = $('#fxwheel'); if (b) b.hidden = true; }

  /* ---------- 前視量全寬 ---------- */
  function wdDraw() {
    const cv = $('#wdcv'); if (!cv) return; if (!WD.img) { cv.hidden = true; return; }
    cv.hidden = false;
    const maxW = Math.min(cv.parentElement.clientWidth || 640, 720), k = maxW / WD.img.naturalWidth, dpr = window.devicePixelRatio || 1;
    WD.k = k; const Wd = Math.round(WD.img.naturalWidth * k), Hd = Math.round(WD.img.naturalHeight * k);
    cv.style.width = Wd + 'px'; cv.style.height = Hd + 'px'; cv.width = Wd * dpr; cv.height = Hd * dpr;
    const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.drawImage(WD.img, 0, 0, Wd, Hd);
    const P = WD.pts.map(p => [p[0] * k, p[1] * k]);
    c.lineWidth = 2.5; c.font = '600 13px system-ui,sans-serif';
    const tag = (x, y, s, col, al) => { c.textAlign = al || 'center'; c.lineWidth = 4; c.strokeStyle = '#fff'; c.strokeText(s, x, y); c.fillStyle = col; c.fillText(s, x, y); c.lineWidth = 2.5; };
    P.forEach((p, i) => { c.beginPath(); c.arc(p[0], p[1], 5, 0, 7); c.fillStyle = i < 2 ? 'rgba(29,78,216,.3)' : 'rgba(214,40,40,.3)'; c.fill(); c.strokeStyle = i < 2 ? BLUE : RED; c.stroke(); });
    if (P.length >= 2) {
      c.strokeStyle = BLUE; c.beginPath(); c.moveTo(P[0][0], P[0][1]); c.lineTo(P[0][0], P[1][1]); c.stroke();
      tag(P[0][0] + 8, (P[0][1] + P[1][1]) / 2, t('wdTire', { d: Math.round(S.wheelD) }), BLUE, 'left');
    }
    if (P.length >= 4 && WD.ratio) {
      const y = Math.max(P[2][1], P[3][1]) + 18, mm = WD.ratio * S.wheelD; c.strokeStyle = RED;
      c.beginPath(); c.moveTo(P[2][0], P[2][1]); c.lineTo(P[2][0], y); c.moveTo(P[3][0], P[3][1]); c.lineTo(P[3][0], y); c.moveTo(P[2][0], y); c.lineTo(P[3][0], y); c.stroke();
      tag((P[2][0] + P[3][0]) / 2, y - 6, t('wdLabel', { mm: Math.round(mm).toLocaleString('en-US'), inch: (mm / 25.4).toFixed(1) }), RED);
    }
  }
  function wdCompute() {
    const p = WD.pts; if (p.length < 4) { WD.ratio = null; return; }
    const tire = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), w = Math.abs(p[3][0] - p[2][0]);
    WD.ratio = tire > 0 ? w / tire : null;
  }
  function wdWire() {
    $('#wdfile').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const im = new Image(); im.onload = () => { WD.img = im; WD.pts = []; WD.on = false; WD.ratio = null; wdDraw(); $('#wdmsg').textContent = ''; addLog(t('logWidthImg'), '', file.name); scheduleBuild(); };
      im.src = URL.createObjectURL(file);
    });
    $('#wdstart').onclick = () => {
      if (!WD.img) { $('#wdmsg').textContent = t('wdNoImg'); return; }
      WD.pts = []; WD.ratio = null; WD.on = true; wdDraw(); scheduleBuild(); $('#wdmsg').textContent = t('wdP1');
    };
    $('#wdclear').onclick = () => { WD.img = null; WD.pts = []; WD.on = false; WD.ratio = null; $('#wdfile').value = ''; wdDraw(); $('#wdmsg').textContent = ''; scheduleBuild(); };
    $('#wdcv').addEventListener('click', e => {
      if (!WD.on) return; const r = e.currentTarget.getBoundingClientRect();
      WD.pts.push([(e.clientX - r.left) / WD.k, (e.clientY - r.top) / WD.k]);
      if (WD.pts.length < 4) { $('#wdmsg').textContent = t('wdP' + (WD.pts.length + 1)); wdDraw(); return; }
      WD.on = false; wdCompute(); addLog(t('logWidth'), '', WD.ratio ? Math.round(WD.ratio * S.wheelD) + ' mm' : '-');
      wdDraw(); scheduleBuild(); $('#wdmsg').textContent = t('wdDone');
    });
  }

  /* ---------- 比例結果：額外檢查項目、複製文字 ---------- */
  function extraChecks(s, add) {
    if (on('widthMeasure') && WD.ratio) {
      const m = WD.ratio * s.wheelD, ok = m <= W_LIMIT, inch = (m / 25.4).toFixed(1);
      add(ok ? 'ok' : 'warn', t(ok ? 'wdCheckOk' : 'wdCheckBad', { inch }), t('wdCheckBody', { d: Math.round(s.wheelD), mm: Math.round(m).toLocaleString('en-US') }));
    }
  }
  function afterRender(checks) { st.lastChecks = checks; if (WD.img) wdDraw(); requestAnimationFrame(draw); }
  function checksText() {
    const lab = { ok: t('lvOk'), warn: t('lvWarn'), fail: t('lvFail'), info: t('lvInfo') };
    const head = [t('copyHead', { n: t(S.wheelCount === 6 ? 'six' : 'four'), ver: C.version }),
      t('copyWheel', { d: Math.round(S.wheelD) }) + (S.wheelCount === 6 ? t('copyGap', { g: Math.round(S.axleGap) }) : ''),
      OV.pts ? t('copyAligned') : t('copyNotAligned')];
    return head.join('\n') + '\n\n' + st.lastChecks.map(c => `[${lab[c.lv]}] ${c.title}\n${c.body}`).join('\n\n');
  }
  function copyWire() {
    $('#cpchecks').onclick = async e => {
      const b = e.currentTarget, keep = b.textContent, txt = checksText(), fb = $('#chkfallback');
      addLog(t('logCopy'), '', S.wheelCount + 'w');
      try { await navigator.clipboard.writeText(txt); fb.hidden = true; b.textContent = t('copied'); }
      catch (err) { fb.hidden = false; fb.value = txt; fb.focus(); fb.select(); b.textContent = t('copyManual'); }
      setTimeout(() => b.textContent = keep, 1600);
    };
  }

  /* ---------- 介面掛載：所有新增元素由這裡插入，主程式 HTML 不需改 ---------- */
  function mount() {
    $('#stage').insertAdjacentHTML('beforeend', '<svg id="fxsvg" aria-hidden="true"></svg>');
    if (on('wheelPrompt')) $('#ovmsg').insertAdjacentHTML('afterend', '<div class="line fxwheel" id="fxwheel" hidden></div>');
    if (on('widthMeasure')) $('#bandon').closest('label').insertAdjacentHTML('afterend',
      `<div class="fxsec"><p class="fxh">${t('wdHead')}</p><p class="note">${t('wdNote')}</p>
       <div class="line"><input type="file" id="wdfile" accept="image/*"><button class="btn primary" id="wdstart">${t('wdStart')}</button><button class="btn" id="wdclear">${t('wdClear')}</button></div>
       <p class="note" id="wdmsg" role="status"></p><canvas id="wdcv" hidden></canvas></div>`);
    if (on('copyText')) $('#checks').insertAdjacentHTML('beforebegin',
      `<div class="line fxcopy"><button class="btn primary" id="cpchecks">${t('copyBtn')}</button><span class="note">${t('copyNote')}</span></div>
       <textarea id="chkfallback" class="fxfallback" hidden readonly aria-label="${t('copyManual')}"></textarea>`);
    document.body.insertAdjacentHTML('beforeend', `<p class="fxver">${t('version', { v: C.version, d: C.date })}</p>`);
  }
  function wire() {
    mount();
    if (on('widthMeasure')) wdWire();
    if (on('copyText')) copyWire();
    $('#bandon').addEventListener('change', draw);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && WD.on) { WD.on = false; WD.pts = []; wdDraw(); $('#wdmsg').textContent = t('wdCancel'); }
    });
    addEventListener('resize', () => requestAnimationFrame(draw));
    addLog(t('logVersion'), '', C.version);
  }

  return { t, zones, approachAngles, extraChecks, afterRender, draw, onImageLoaded, canAlign, onImageCleared, wire, version: C.version, _wd: WD, _st: st };
})();
