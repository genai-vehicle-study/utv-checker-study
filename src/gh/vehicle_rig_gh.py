# -*- coding: utf-8 -*-
"""
載具比例參數台 · Grasshopper 參數化載具量體
適用：Rhino 7 GhPython 元件、Rhino 8 Python 3 Script 元件。單位：mm。
座標：X = 車長方向（前軸在 X=0，往車尾為正），Y = 車寬方向，Z = 高度（地面 Z=0）。

輸入 Inputs（全部選填；沒有接線的沿用預設值）
  params_json : str  從網頁「匯出」分頁複製的參數 JSON，接一個 Panel 貼上即可
  也可以另外新增與參數同名的輸入並接 Number Slider，優先順序：
  個別輸入 > params_json > 預設值
  可用的參數名稱：
    wheelCount (2/3/4/6)   layout3 ("tadpole"/"delta")   layout6 ("front"/"rear")
    wheelbase  axleGap  trackF  trackR  wheelD  tireW
    ohF  ohR  bodyW  belt  clear  nose (0-1)
    cabin ("closed"/"open"/"rider")  cabinPos (0-1)  cabinLen (0-1)
    roof  seatH  sitH

輸出 Outputs（請在元件上建立同名輸出）
  body     車身量體 Brep
  canopy   座艙玻璃（封閉）或防滾架（開放）Brep 清單
  wheels   輪胎 Brep 清單
  figure   乘員人偶 Brep 清單（人體比例參考）
  profile  車身側視輪廓曲線（可拿去與 AI 生成圖比對）
  info     尺寸摘要文字
"""
import json
import math
import Rhino.Geometry as rg

try:
    import scriptcontext as sc
    TOL = sc.doc.ModelAbsoluteTolerance
except Exception:
    TOL = 0.01

DEFAULTS = {
    "wheelCount": 4, "layout3": "tadpole", "layout6": "front",
    "wheelbase": 2750.0, "axleGap": 900.0, "trackF": 1570.0, "trackR": 1580.0,
    "wheelD": 660.0, "tireW": 225.0,
    "ohF": 950.0, "ohR": 1050.0, "bodyW": 1830.0, "belt": 1000.0, "clear": 140.0, "nose": 0.55,
    "cabin": "closed", "cabinPos": 0.5, "cabinLen": 0.45, "roof": 1450.0,
    "seatH": 450.0, "sitH": 930.0,
}
TEXT_KEYS = ("layout3", "layout6", "cabin")
ARCH_GAP = 40.0  # 輪拱與輪胎的間隙


def read_params():
    p = dict(DEFAULTS)
    g = globals()
    js = g.get("params_json")
    if js:
        try:
            p.update(json.loads(str(js)))
        except Exception as e:
            raise ValueError(u"params_json 無法解析：{0}".format(e))
    for k in DEFAULTS:
        v = g.get(k)
        if v is not None:
            p[k] = v
    for k in DEFAULTS:
        if k in TEXT_KEYS:
            p[k] = str(p[k])
        elif k == "wheelCount":
            p[k] = int(p[k])
        else:
            p[k] = float(p[k])
    return p


def axles_of(p):
    wc, wb = p["wheelCount"], p["wheelbase"]

    def pair(t):
        return [-t / 2.0, t / 2.0]

    if wc == 2:
        return [(0.0, [0.0]), (wb, [0.0])]
    if wc == 3:
        if p["layout3"] == "tadpole":
            return [(0.0, pair(p["trackF"])), (wb, [0.0])]
        return [(0.0, [0.0]), (wb, pair(p["trackR"]))]
    if wc == 4:
        return [(0.0, pair(p["trackF"])), (wb, pair(p["trackR"]))]
    if p["layout6"] == "front":
        return [(0.0, pair(p["trackF"])), (p["axleGap"], pair(p["trackF"])), (wb, pair(p["trackR"]))]
    return [(0.0, pair(p["trackF"])), (wb - p["axleGap"], pair(p["trackR"])), (wb, pair(p["trackR"]))]


def solve(p):
    """車身側視輪廓：下緣為直線加輪拱圓弧，上緣為通過控制點的平滑曲線。"""
    r = p["wheelD"] / 2.0
    ra = r + ARCH_GAP
    x0 = -p["ohF"]
    x1 = p["wheelbase"] + p["ohR"]
    L = x1 - x0
    zb = p["clear"]
    hb = max(p["belt"], zb + 100.0)
    D = hb - zb
    sx = x0 + 0.04 * L
    ex = x1 - 0.06 * L

    axles = axles_of(p)
    arches = []
    for (ax, ys) in axles:
        covered = any(abs(y) - p["tireW"] / 2.0 < p["bodyW"] / 2.0 for y in ys)
        dz = zb - r
        if covered and abs(dz) < ra:
            dx = math.sqrt(ra * ra - dz * dz)
            a, b = ax - dx, ax + dx
            if b > sx and a < ex:
                arches.append((ax, a, b))
    arches.sort()

    segs = []
    start = (sx, zb)
    cur = (sx, zb)
    prev_end = -1e9
    for (cx, a, b) in arches:
        if a < prev_end:
            continue  # 與前一個輪拱重疊，略過
        za = zb
        zbb = zb
        if a < sx:
            if segs:
                continue
            a = sx
            za = r + math.sqrt(max(ra * ra - (sx - cx) ** 2, 0.0))
            start = (sx, za)
            cur = start
        elif a - cur[0] > 1e-6:
            segs.append(("line", cur, (a, zb)))
        if b > ex:
            b = ex
            zbb = r + math.sqrt(max(ra * ra - (ex - cx) ** 2, 0.0))
        segs.append(("arc", cx, r, ra, (a, za), (b, zbb)))
        cur = (b, zbb)
        prev_end = b
    if ex - cur[0] > 1e-6:
        segs.append(("line", cur, (ex, zb)))
        cur = (ex, zb)
    end = cur

    nose = p["nose"]
    top = [
        end,
        (x1, max(zb + D * 0.45, end[1] + 20.0)),
        (x1 - 0.015 * L, hb - D * 0.05),
        (x1 - 0.12 * L, hb),
        (x0 + 0.40 * L, hb),
        (x0 + 0.18 * L, zb + D * (nose + (1.0 - nose) * 0.75)),
        (x0, max(zb + D * nose, start[1] + 20.0)),
        start,
    ]
    return {"r": r, "ra": ra, "x0": x0, "x1": x1, "L": L, "zb": zb, "hb": hb, "D": D,
            "axles": axles, "segs": segs, "top": top}


def figure_of(p, g):
    cab = p["cabin"]
    cxC = g["x0"] + p["cabinPos"] * g["L"]
    cl = p["cabinLen"] * g["L"]
    headX = cxC + 0.12 * cl if cab == "closed" else cxC
    headR = 105.0 if cab == "closed" else 135.0
    headTop = p["seatH"] + p["sitH"]
    head = (headX, headTop - headR)
    off = {"open": -380.0, "closed": -220.0, "rider": 230.0}.get(cab, -220.0)
    hip = (headX + off, p["seatH"] + 90.0)
    sh = (hip[0] + (head[0] - hip[0]) * 0.78, hip[1] + (head[1] - hip[1]) * 0.78)
    if cab == "rider":
        knee = (hip[0] - 380.0, p["seatH"] - 20.0)
        foot = (hip[0] - 280.0, max(g["zb"] + 80.0, p["seatH"] - 470.0))
    else:
        knee = (hip[0] - 430.0, p["seatH"] + (200.0 if cab == "closed" else 250.0))
        foot = (hip[0] - 880.0, max(g["zb"] + 60.0, p["seatH"] - 180.0))
    y = -0.2 * p["bodyW"] if (cab == "closed" and p["bodyW"] > 1300) else 0.0
    return {"cxC": cxC, "cl": cl, "headX": headX, "headR": headR, "headTop": headTop,
            "head": head, "hip": hip, "sh": sh, "knee": knee, "foot": foot, "y": y}


def P(x, z, y=0.0):
    return rg.Point3d(x, y, z)


def extrude_profile(crv, width):
    srf = rg.Surface.CreateExtrusion(crv, rg.Vector3d(0, width, 0))
    brep = srf.ToBrep()
    capped = brep.CapPlanarHoles(TOL)
    if capped:
        brep = capped
    brep.Translate(rg.Vector3d(0, -width / 2.0, 0))
    return brep


def body_profile(g):
    crvs = []
    for s in g["segs"]:
        if s[0] == "line":
            crvs.append(rg.LineCurve(P(*s[1]), P(*s[2])))
        else:
            _, cx, cz, ra, a, b = s
            t0 = math.atan2(a[1] - cz, a[0] - cx)
            t1 = math.atan2(b[1] - cz, b[0] - cx)
            if t0 < t1:
                t0 += 2 * math.pi
            tm = (t0 + t1) / 2.0
            mid = P(cx + ra * math.cos(tm), cz + ra * math.sin(tm))
            crvs.append(rg.ArcCurve(rg.Arc(P(*a), mid, P(*b))))
    top_pts = [P(x, z) for (x, z) in g["top"]]
    crvs.append(rg.Curve.CreateInterpolatedCurve(top_pts, 3))
    joined = rg.Curve.JoinCurves(crvs, TOL * 10)
    crv = joined[0]
    if not crv.IsClosed:
        crv.MakeClosed(TOL * 10)
    return crv


def build():
    p = read_params()
    g = solve(p)
    f = figure_of(p, g)
    r, hb = g["r"], g["hb"]

    prof = body_profile(g)
    body_brep = extrude_profile(prof, p["bodyW"])

    # 座艙
    canopy_out = []
    if p["cabin"] == "closed" and p["roof"] > hb + 80:
        xc0 = f["cxC"] - f["cl"] / 2.0
        xc1 = f["cxC"] + f["cl"] / 2.0
        cl, roof, zc = f["cl"], p["roof"], hb - 20.0
        pts = [P(xc0, zc), P(xc0 + 0.38 * cl, roof - 15), P(xc0 + 0.62 * cl, roof),
               P(xc1 - 0.18 * cl, roof - 40), P(xc1, zc)]
        top = rg.Curve.CreateInterpolatedCurve(pts, 3)
        base = rg.LineCurve(P(xc1, zc), P(xc0, zc))
        gh = rg.Curve.JoinCurves([top, base], TOL * 10)[0]
        cw = min(p["bodyW"] * 0.8, p["bodyW"] - 80)
        canopy_out.append(extrude_profile(gh, cw))
    elif p["cabin"] == "open":
        xh = f["headX"] + 180.0
        hr = min(p["bodyW"] * 0.75, 620.0) / 2.0
        if p["roof"] - hr < hb:
            hr = max(80.0, p["roof"] - hb)
        legs_top = p["roof"] - hr
        pts_l = [P(xh, hb - 30, -hr), P(xh, legs_top, -hr)]
        pts_r = [P(xh, legs_top, hr), P(xh, hb - 30, hr)]
        arc = rg.ArcCurve(rg.Arc(P(xh, legs_top, -hr), P(xh, p["roof"], 0), P(xh, legs_top, hr)))
        rail = rg.Curve.JoinCurves([rg.LineCurve(*pts_l), arc, rg.LineCurve(*pts_r)], TOL * 10)[0]
        pipes = rg.Brep.CreatePipe(rail, 16.0, False, rg.PipeCapMode.Round, True, TOL, 0.02)
        if pipes:
            canopy_out.extend(pipes)

    # 輪胎
    wheel_out = []
    for (ax, ys) in g["axles"]:
        for y in ys:
            pl = rg.Plane(rg.Point3d(ax, y - p["tireW"] / 2.0, r), rg.Vector3d(0, 1, 0))
            wheel_out.append(rg.Cylinder(rg.Circle(pl, r), p["tireW"]).ToBrep(True, True))

    # 乘員人偶
    fig_out = []
    y = f["y"]
    fig_out.append(rg.Sphere(P(f["head"][0], f["head"][1], y), f["headR"]).ToBrep())
    limbs = [(f["hip"], f["sh"], 140.0), (f["hip"], f["knee"], 65.0), (f["knee"], f["foot"], 55.0)]
    for (a, b, rad) in limbs:
        rail = rg.LineCurve(P(a[0], a[1], y), P(b[0], b[1], y))
        pipes = rg.Brep.CreatePipe(rail, rad, False, rg.PipeCapMode.Round, True, TOL, 0.02)
        if pipes:
            fig_out.extend(pipes)

    # 尺寸摘要
    xs = [ax for (ax, _) in g["axles"]]
    front = min(g["x0"], min(xs) - r)
    rear = max(g["x1"], max(xs) + r)
    tracks = [abs(yy) * 2 for (_, ys) in g["axles"] for yy in ys]
    width = max(p["bodyW"], max(tracks) + p["tireW"])
    height = max(hb, f["headTop"], p["roof"] if p["cabin"] != "rider" else 0)
    length = rear - front
    lines = [
        u"全長 {0:.0f} mm".format(length),
        u"全寬 {0:.0f} mm".format(width),
        u"全高 {0:.0f} mm".format(height),
        u"軸距 {0:.0f} mm（佔全長 {1:.0%}）".format(p["wheelbase"], p["wheelbase"] / length),
        u"輪徑 / 全高 = {0:.2f}".format(p["wheelD"] / height),
        u"頭頂離地 {0:.0f} mm".format(f["headTop"]),
    ]
    return body_brep, canopy_out, wheel_out, fig_out, prof, "\n".join(lines)


body, canopy, wheels, figure, profile, info = build()
