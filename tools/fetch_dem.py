"""国土地理院 標高タイルを取得し、地形ハイトマップを assets/ に出力する。

出典: 国土地理院 標高タイル(https://maps.gsi.go.jp/development/ichiran.html)
  - dem5a (z15, 5mメッシュ, 精度高・海や一部に欠損 "e")
  - dem   (z14, 10mメッシュ, 欠損の穴埋めに使用)

出力:
  assets/terrain.bin       Float32 標高値 (row-major, 北→南, 西→東) [m]
  assets/terrain_meta.json グリッド情報(サイズ・間隔・原点緯度経度など)

使い方: python tools/fetch_dem.py
"""
import json
import math
import struct
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / "cache"
ASSETS = ROOT / "assets"

# 対象範囲: 陸前高田市街地(高田町)+ 気仙町今泉 + 広田湾岸 + 背後の高台
LAT_N, LAT_S = 39.035, 38.985
LON_W, LON_E = 141.595, 141.665

Z5 = 15   # dem5a
Z10 = 14  # dem (10m)

DOWNSAMPLE = 4  # z15ピクセル(約3.7m)を4つまとめて約15m間隔のグリッドに

MISSING_SEA = -2.0  # 両タイルとも欠損 = 海とみなす標高


def deg2num(lat, lon, z):
    n = 2 ** z
    x = (lon + 180.0) / 360.0 * n
    y = (1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n
    return x, y


def num2deg(x, y, z):
    n = 2 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lat, lon


def fetch_tile(kind, z, x, y):
    """タイルを取得(キャッシュあり)。404等は None。"""
    path = CACHE / kind / str(z) / str(x) / f"{y}.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    url = f"https://cyberjapandata.gsi.go.jp/xyz/{kind}/{z}/{x}/{y}.txt"
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            text = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            text = ""
        else:
            raise
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    time.sleep(0.1)  # 公共サーバーへの配慮
    return text


def parse_tile(text):
    """256x256 の float 行列(欠損は None)。空文字はタイルなし。"""
    if not text.strip():
        return None
    rows = []
    for line in text.strip().split("\n"):
        rows.append([None if v == "e" else float(v) for v in line.split(",")])
    return rows


def build_mosaic(kind, z, x0, x1, y0, y1):
    """タイル群を 1 枚の 2 次元配列に結合。"""
    w = (x1 - x0 + 1) * 256
    h = (y1 - y0 + 1) * 256
    grid = [[None] * w for _ in range(h)]
    total = (x1 - x0 + 1) * (y1 - y0 + 1)
    done = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            tile = parse_tile(fetch_tile(kind, z, tx, ty))
            done += 1
            print(f"  {kind} z{z} {done}/{total}", end="\r")
            if tile is None:
                continue
            ox, oy = (tx - x0) * 256, (ty - y0) * 256
            for r in range(256):
                row = tile[r]
                grow = grid[oy + r]
                for c in range(256):
                    grow[ox + c] = row[c]
    print()
    return grid


def main():
    ASSETS.mkdir(exist_ok=True)

    fx0, fy0 = deg2num(LAT_N, LON_W, Z5)
    fx1, fy1 = deg2num(LAT_S, LON_E, Z5)
    x0, y0, x1, y1 = int(fx0), int(fy0), int(fx1), int(fy1)
    print(f"dem5a z{Z5} tiles: x {x0}..{x1}, y {y0}..{y1} "
          f"({(x1-x0+1)*(y1-y0+1)} tiles)")

    dem5 = build_mosaic("dem5a", Z5, x0, x1, y0, y1)
    H5, W5 = len(dem5), len(dem5[0])

    # モザイク北西角の緯度経度と、1ピクセルの地上距離[m]
    lat_nw, lon_nw = num2deg(x0, y0, Z5)
    lat_c = (lat_nw + num2deg(x0, y1 + 1, Z5)[0]) / 2
    merc_res = 156543.03392804097 / (2 ** Z5) / 256 * 256  # m/px at equator
    merc_res = 156543.03392804097 * math.cos(math.radians(lat_c)) / (2 ** (Z5 + 8)) * 256
    px_m = merc_res  # 地上での1ピクセル間隔 [m](東西=南北、局所近似)

    # 10mメッシュ (z14) で欠損を穴埋め
    gx0, gy0 = deg2num(lat_nw, lon_nw, Z10)
    lat_se, lon_se = num2deg(x1 + 1, y1 + 1, Z5)
    gx1, gy1 = deg2num(lat_se, lon_se, Z10)
    g_x0, g_y0, g_x1, g_y1 = int(gx0), int(gy0), int(gx1), int(gy1)
    dem10 = build_mosaic("dem", Z10, g_x0, g_x1, g_y0, g_y1)

    def dem10_at(px5, py5):
        """dem5a ピクセル座標 → dem10 の対応値。"""
        # z15ピクセル → 世界ピクセル座標 → z14 モザイク内座標
        wx = (x0 * 256 + px5) / 2.0
        wy = (y0 * 256 + py5) / 2.0
        cx = int(wx) - g_x0 * 256
        cy = int(wy) - g_y0 * 256
        if 0 <= cy < len(dem10) and 0 <= cx < len(dem10[0]):
            return dem10[cy][cx]
        return None

    # ダウンサンプリング(有効値の平均)+ 欠損補完
    W = W5 // DOWNSAMPLE
    H = H5 // DOWNSAMPLE
    heights = [0.0] * (W * H)
    n_sea = 0
    for gy in range(H):
        for gx in range(W):
            s, n = 0.0, 0
            for dy in range(DOWNSAMPLE):
                row = dem5[gy * DOWNSAMPLE + dy]
                for dx in range(DOWNSAMPLE):
                    v = row[gx * DOWNSAMPLE + dx]
                    if v is not None:
                        s += v
                        n += 1
            if n == 0:
                v10 = dem10_at(gx * DOWNSAMPLE + DOWNSAMPLE // 2,
                               gy * DOWNSAMPLE + DOWNSAMPLE // 2)
                if v10 is not None:
                    heights[gy * W + gx] = v10
                else:
                    heights[gy * W + gx] = MISSING_SEA
                    n_sea += 1
            else:
                heights[gy * W + gx] = s / n
        print(f"  resample {gy+1}/{H}", end="\r")
    print()

    hmin, hmax = min(heights), max(heights)
    (ASSETS / "terrain.bin").write_bytes(struct.pack(f"<{len(heights)}f", *heights))
    meta = {
        "width": W,
        "height": H,
        "cell_m": px_m * DOWNSAMPLE,
        "lat_nw": lat_nw,
        "lon_nw": lon_nw,
        "lat_se": lat_se,
        "lon_se": lon_se,
        "min": hmin,
        "max": hmax,
        "missing_sea": MISSING_SEA,
        "source": "国土地理院 標高タイル dem5a/dem",
    }
    (ASSETS / "terrain_meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {W}x{H} grid, cell {meta['cell_m']:.2f} m, "
          f"elev {hmin:.1f}..{hmax:.1f} m, sea-fill {n_sea}")


if __name__ == "__main__":
    main()
