# UTV 比例比對工具（UTV Proportion Checker）

把 AI 生成的 UTV 正側視圖疊在參數化參考模型上，檢查軸距、車頂、車頭車尾、雙軸間距、通過角與全寬是否合理。
用於研究「設計者如何察覺 AI 生成載具概念中的錯誤」。

- 中文版：`docs/index.html`
- 英文版：`docs/en.html`
- 舊版 v1（P1、P2 實驗使用，**永遠不要修改**）：`docs/v1/`

目前版本見 `config.json`，畫面右下角與「複製結果文字」也會顯示版本號。

---

## 資料夾結構

```
config.json              版本號、日期、功能開關
src/
  zh/page.html           中文頁面（原始架構：HTML＋CSS＋主程式）
  en/page.html           英文頁面（與中文同結構，只有文字不同）
  shared/fx.js           v2 新增功能（中英文共用，只寫一次）
  shared/fx.css          v2 新增功能的樣式
  i18n/zh.json           新增功能的中文文字
  i18n/en.json           新增功能的英文文字
  gh/                    Grasshopper Python 腳本（中、英）
tools/build.py           建置：src/ → docs/
tests/smoke.mjs          自動測試（模擬點擊所有功能）
tests/fixtures/          測試用圖片
docs/                    建置結果，GitHub Pages 從這裡發佈（不要直接改）
```

## 要改什麼，去哪裡改

| 想改的東西 | 檔案 |
|---|---|
| v2 新功能的文字（按鈕、提示、標籤） | `src/i18n/zh.json`、`src/i18n/en.json`（兩個檔案的鍵必須一致，建置時會檢查） |
| v2 新功能的行為 | `src/shared/fx.js` |
| v2 新功能的樣式 | `src/shared/fx.css` |
| 開關某個新功能 | `config.json` 的 `features`（`true`／`false`） |
| 原有功能、原有文字、參考模型、比例範圍 | `src/zh/page.html` 與 `src/en/page.html`（**兩個都要改**） |
| 比例範圍數值 | 兩個 `page.html` 裡的 `const RANGE=...`（綠色區塊、標籤、尺寸線都讀這裡） |
| Grasshopper 腳本 | `src/gh/` |

改完後一定要：`python3 tools/build.py` → 跑測試 → 更新 `config.json` 版本號與 `CHANGELOG.md`。

## 功能開關（config.json → features）

| 鍵 | 功能 |
|---|---|
| `angleOverlay` | 量通過角後在圖上畫切線、地面線與角度 |
| `zoneLabels` | 綠色區塊旁標示名稱（後輪中心、車頂高度…） |
| `rangeHighlight` | 對齊後在輪心高度畫軸距尺寸線，超出範圍顯示紅色「偏短／偏長」 |
| `widthMeasure` | 前視圖量全寬 |
| `copyText` | 比例結果「複製結果文字」按鈕 |
| `wheelPrompt` | 載入圖片後先選四輪／六輪，才能對齊 |

通過角的傾斜修正（以前後輪心連線為地面）一律啟用，沒有開關。
`rangeHighlight` 會直接告訴受試者數值是否超出範圍，屬於研究介入；若要與舊版比較，可關掉這項另建一版。

## 建置與測試

```bash
python3 tools/build.py                 # 產生 docs/index.html、docs/en.html
cd tests && npm install && cd ..       # 第一次才需要（playwright-core、three@0.128.0）
node tests/smoke.mjs                   # 約 2 分鐘；結果截圖在 tests/out/
```

測試會檢查：版本號、輪數選擇、兩點對齊、區塊標籤、軸距尺寸線（含「偏短」）、通過角（含 6° 傾斜圖）、量全寬、
比例結果、複製文字、六輪、切換視角、沒有 JavaScript 錯誤，以及 v1 舊版能正常開啟。

## 部署到 GitHub Pages

1. 把整個資料夾上傳到 GitHub（`tests/node_modules`、`tests/out` 不用上傳）。
2. 專案「Settings → Pages」：Source 選 **Deploy from a branch**，Branch 選 **main**、資料夾選 **/docs** → Save。
3. 等 1–3 分鐘，打開網址，中英文各操作一次。
4. 在「Releases」建立版本標記（例如 `v2.0.0`），記下這一版的內容。

> 摘要已附 `utv-proportion-checker` 網址。審查結果（2026/12/4）公布前，該網址維持送審時的版本；
> 正式實驗使用另一個專案的網址（例如 `utv-checker-study`）。

## 主程式掛勾（給維護者）

新功能都寫在 `fx.js`，主程式只在這些位置呼叫它（兩個 `page.html` 相同）：

| 主程式位置 | 呼叫 |
|---|---|
| `buildBands()` | `FX.zones(g)`：綠色區塊範圍（標籤共用同一份） |
| `approachAngles()` | `FX.approachAngles()`：含傾斜修正的通過角 |
| `runChecks()` UTV 段 | `FX.extraChecks(s, add)`：加入全寬結果 |
| `renderPanels()` | `FX.afterRender(checks)`：記下結果供複製、重畫標示 |
| `drawDots()`、`setView()` 結尾 | `FX.draw()`：重畫 SVG 圖層 |
| 載入圖片、`startPick()`、移除圖片 | `FX.onImageLoaded()`、`FX.canAlign()`、`FX.onImageCleared()` |
| 通過角完成訊息 | `FX.t('angleDone')` |
| `wire()` 結尾 | `FX.wire()`：插入新介面並綁定事件 |
| `<style>` 結尾、主程式初始化前 | 建置標記 `/*__FX_CSS__*/`、`/*__FX_JS__*/` |

## 研究紀錄注意事項

- P1、P2 使用 v1；v2 起新增上表功能。論文需註明各受試者使用的版本。
- 「研究紀錄」分頁會記錄工具版本、輪數選擇、量全寬、複製結果文字等操作。
- 正式實驗開始後不要再改工具；必須修改時，升版本號並記錄從第幾位受試者開始使用。
