// 自動測試：node tests/smoke.mjs（先執行 python3 tools/build.py）
// 需要：cd tests && npm install（playwright-core、three@0.128.0）
// 會開本機伺服器載入 docs/，模擬點擊並檢查各功能，截圖存到 tests/out/。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, '..', 'docs');
const FIX = p => path.join(HERE, 'fixtures', p);
const OUT = path.join(HERE, 'out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium';
const VERSION = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config.json'), 'utf8')).version;

const server = http.createServer((req, res) => {
  const f = path.join(DOCS, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(DOCS) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(res);
}).listen(0);
const BASE = `http://localhost:${server.address().port}/`;

let fails = 0;
const check = (name, ok, info = '') => { console.log(`${ok ? '  ✓' : '  ✗'} ${name}${info ? '  ' + info : ''}`); if (!ok) fails++; };
const near = (v, want, tol) => v != null && Math.abs(v - want) <= tol;

async function open(browser, page) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route('**/three.min.js', r => r.fulfill({ path: path.join(HERE, 'node_modules/three/build/three.min.js'), contentType: 'text/javascript' }));
  await p.route('**/OrbitControls.js', r => r.fulfill({ path: path.join(HERE, 'node_modules/three/examples/js/controls/OrbitControls.js'), contentType: 'text/javascript' }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ body: '', contentType: 'text/css' }));
  await p.goto(BASE + page); await p.waitForTimeout(700);
  return { p, errs, ctx };
}
// 點圖上的像素（疊圖 #ov 的圖片座標）
async function clickImg(p, u, v) {
  const xy = await p.evaluate(([u, v]) => { const r = document.querySelector('#stage').getBoundingClientRect(), { s, tx, ty } = OV.cur; return [r.left + tx + s * flipU(u), r.top + ty + s * v]; }, [u, v]);
  await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(120);
}
async function loadSide(p, file, wheels) {
  await p.setInputFiles('#ovfile', FIX(file)); await p.waitForFunction(() => !document.querySelector('#ov').hidden);
  await p.waitForTimeout(200);
  if (wheels) { await p.click(`#fxwheel button[data-k="${wheels}"]`); await p.waitForTimeout(300); }
}
const rot = (x, y, deg) => { const t = deg * Math.PI / 180, dx = x - 600, dy = y - 300; return [600 + dx * Math.cos(t) + dy * Math.sin(t), 300 - dx * Math.sin(t) + dy * Math.cos(t)]; };

async function testPage(browser, page) {
  console.log(`\n[${page}]`);
  const { p, errs, ctx } = await open(browser, page);
  check('版本號顯示', (await p.$eval('.fxver', e => e.textContent)).includes(VERSION));

  // 輪數確認：未選擇前不能對齊
  await loadSide(p, 'side_flat.png');
  check('載入後出現輪數選擇', await p.$eval('#fxwheel', e => !e.hidden));
  await p.click('#ovalign');
  check('未選輪數時不能對齊', await p.$eval('#ovpick', e => e.hidden));
  await p.click('#fxwheel button[data-k="utv4"]'); await p.waitForTimeout(300);

  // 對齊 + 範圍提示 + 區塊標籤
  await p.click('#ovalign'); await clickImg(p, 300, 400); await clickImg(p, 900, 400); await p.waitForTimeout(400);
  check('兩點對齊完成', await p.evaluate(() => !!OV.pts));
  const labels = await p.$$eval('#fxsvg text', a => a.map(e => e.textContent));
  check('綠色區塊標籤（≥4）', labels.length >= 4, labels.slice(0, 5).join(' / '));
  check('軸距數值標示', labels.some(s => /\d\.\d\d D/.test(s)));
  await p.evaluate(() => setParam('wheelD', 900)); await p.waitForTimeout(400);       // 輪徑變大 → 軸距約 3.3 D，應標示偏短
  const short = await p.$$eval('#fxsvg text', a => a.map(e => e.textContent).find(s => / D/.test(s)) || '');
  check('超出範圍時標示偏短', /偏短|too short/.test(short), short);
  await p.evaluate(() => setParam('wheelD', 762)); await p.waitForTimeout(300);

  // 通過角（平圖、6° 傾斜圖）
  for (const [file, deg] of [['side_flat.png', 0], ['side_tilt6.png', 6]]) {
    if (deg) { await loadSide(p, file, 'utv4'); await p.click('#ovalign'); await clickImg(p, ...rot(300, 400, deg)); await clickImg(p, ...rot(900, 400, deg)); }
    await p.click('#ovangle'); await clickImg(p, ...rot(180, 370, deg)); await clickImg(p, ...rot(1030, 360, deg)); await p.waitForTimeout(300);
    const A = await p.evaluate(() => approachAngles());
    check(`通過角（傾斜 ${deg}°）`, near(A?.front, 52.5, 1.5) && near(A?.rear, 51.6, 1.5), `前 ${A?.front?.toFixed(1)}° 後 ${A?.rear?.toFixed(1)}°`);
  }
  check('通過角切線畫在圖上', (await p.$$('#fxsvg path')).length === 2);
  await p.screenshot({ path: path.join(OUT, page.replace('.html', '') + '_side.png') });

  // 量全寬（前視）：圖上輪胎 200 px＝762 mm，車寬 520 px → 約 1,981 mm
  await p.setInputFiles('#wdfile', FIX('front.png')); await p.waitForFunction(() => FX._wd.img !== null);
  await p.click('#wdstart'); await p.$eval('#wdcv', e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
  for (const [u, v] of [[190, 300], [190, 500], [140, 400], [660, 400]]) {
    const xy = await p.evaluate(([u, v]) => { const r = document.querySelector('#wdcv').getBoundingClientRect(); return [r.left + u * FX._wd.k, r.top + v * FX._wd.k]; }, [u, v]);
    await p.mouse.click(xy[0], xy[1]); await p.waitForTimeout(80);
  }
  const mm = await p.evaluate(() => FX._wd.ratio * S.wheelD);
  check('量全寬', near(mm, 1981, 40), `${Math.round(mm)} mm`);
  await p.screenshot({ path: path.join(OUT, page.replace('.html', '') + '_width.png') });

  // 比例結果：全寬項目＋複製文字
  await p.click('#tablist [data-t=checks]'); await p.waitForTimeout(200);
  check('比例結果列出全寬', (await p.$eval('#checks', e => e.innerText)).includes('64'));
  await p.click('#cpchecks'); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText());
  check('複製結果文字（含版本號）', clip.includes('v' + VERSION) && clip.includes('64'), clip.split('\n')[0]);

  // 六輪
  await p.click('#tablist [data-t=overlay]');
  await loadSide(p, 'side_six.png', 'utv6');
  check('選六輪後切換模型', await p.evaluate(() => S.wheelCount === 6));
  await p.click('#ovalign'); await clickImg(p, 300, 400); await clickImg(p, 1160, 400); await p.waitForTimeout(400);
  const l6 = await p.$$eval('#fxsvg text', a => a.map(e => e.textContent));
  check('六輪標籤與兩段數值', l6.length >= 7 && l6.filter(s => /\d\.\d\d D/.test(s)).length === 2, l6.filter(s => / D/.test(s)).join(' / '));
  await p.screenshot({ path: path.join(OUT, page.replace('.html', '') + '_six.png') });

  // 切到前視時圖層清空
  await p.click('#views [data-v=front]'); await p.waitForTimeout(300);
  check('非側視不畫標示', (await p.$$('#fxsvg *')).length === 0);

  check('沒有 JavaScript 錯誤', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
try {
  for (const page of ['v2/index.html', 'v2/en.html']) await testPage(browser, page);
  for (const page of ['v1/index.html', 'v1/en.html']) {
    console.log(`\n[${page}]`); const { p, errs, ctx } = await open(browser, page);
    check('舊版可載入', (await p.title()).length > 0 && errs.length === 0, errs.join(' | ')); await ctx.close();
  }
} finally { await browser.close(); server.close(); }
console.log(fails ? `\n✗ ${fails} 項失敗` : '\n✓ 全部通過');
process.exit(fails ? 1 : 0);
