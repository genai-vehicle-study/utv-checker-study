"""建置：src/ → docs/（GitHub Pages 從 docs/ 資料夾發佈）

用法：python3 tools/build.py
- 把 src/shared/fx.js、fx.css、src/i18n/<lang>.json、config.json 與 GH 腳本嵌入兩個語言頁面
- v2：輸出 docs/v2/index.html（中文）與 docs/v2/en.html（英文）
- v3：src/v3/index.html 單一檔案，直接複製成 docs/index.html（正式實驗使用）
- docs/v1/ 是 P1、P2 實驗時的舊版，不會被覆蓋
"""
import json, pathlib, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'src', ROOT / 'docs' / 'v2'
LANGS = {'zh': ('index.html', 'vehicle_rig_gh.py'), 'en': ('en.html', 'vehicle_rig_gh_en.py')}

def read(p): return (SRC / p).read_text(encoding='utf-8')
def js_lit(v):
    """把 Python 值轉成可安全放進 <script> 的 JavaScript 字面值（字串或物件）。"""
    return json.dumps(v, ensure_ascii=False).replace('</', '<\\/')

def build():
    conf = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))
    fx_js, fx_css = read('shared/fx.js'), read('shared/fx.css')
    keys = None
    for lang, (out_name, gh) in LANGS.items():
        strings = json.loads(read(f'i18n/{lang}.json'))
        keys = keys or set(strings)
        missing = keys ^ set(strings)
        if missing: sys.exit(f'i18n 字串鍵不一致（{lang}）：{sorted(missing)}')
        fx_conf = {**conf, 'lang': lang, 'strings': strings}
        page = read(f'{lang}/page.html')
        for token in ('"__GH_SCRIPT__"', '/*__FX_CSS__*/', '/*__FX_JS__*/'):
            if page.count(token) != 1: sys.exit(f'{lang}/page.html 找不到或重複的標記：{token}')
        page = (page.replace('"__GH_SCRIPT__"', js_lit(read(f'gh/{gh}')))
                    .replace('/*__FX_CSS__*/', fx_css)
                    .replace('/*__FX_JS__*/', fx_js.replace('__FX_CONF__', js_lit(fx_conf))))
        OUT.mkdir(exist_ok=True)
        (OUT / out_name).write_text(page, encoding='utf-8')
        print(f'docs/v2/{out_name}  {len(page):,} chars  v{conf["version"]}')

if __name__ == '__main__':
    build()


# ---------- v3（正式實驗用）：單一檔案，直接複製 ----------
import shutil
OUT.mkdir(parents=True, exist_ok=True)
shutil.copyfile(SRC / 'v3' / 'index.html', ROOT / 'docs' / 'index.html')
print('docs/index.html  (v3, 從 src/v3/index.html 複製)')
# 英文版 v3 尚未製作：docs/en.html 暫時沿用 v2 英文版，舊網址不會失效
shutil.copyfile(OUT / 'en.html', ROOT / 'docs' / 'en.html')
print('docs/en.html  (暫用 v2 英文版)')
