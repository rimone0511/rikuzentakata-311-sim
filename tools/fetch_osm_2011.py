"""OpenStreetMap (Overpass API) の attic クエリで 2011年3月時点の道路網を取得し、
嵩上げ・区画整理された地区について現在の道路網(assets/roads.json)と合成する。

出典: © OpenStreetMap contributors (ODbL), 2011-03-01時点のスナップショット

手順:
  1. Overpass attic クエリで 2011-03-01 時点の道路を取得 → assets/roads_2011_raw.json に保存
  2. 現在の assets/roads.json を assets/roads_current.json として退避
  3. 嵩上げ2地区(矩形A・矩形B)について、
     - 現在道路のうちpts の50%以上が矩形内 → 除去
     - 2011年道路のうちpts の50%以上が矩形内 → 追加(idは1e10を加算)
     を行い、新しい assets/roads.json を書き出す
  4. 矩形内に該当する2011年道路が合計10本未満ならフォールバックし、
     assets/roads.json は現在版のまま変更しない

使い方: python tools/fetch_osm_2011.py
"""
import json
import time
import urllib.request
import urllib.parse
import urllib.error
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# terrain_meta.json と同じ範囲(南,西,北,東)。fetch_osm.py と同一。
BBOX = "38.985,141.595,39.035,141.665"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Overpass の過去データは OSM ライセンス移行日(2012-09-12)までしか遡れない。
# 陸前高田の嵩上げ・区画整理工事は2014年以降のため、2012-09-13 時点のOSMには
# 震災前の街路網(震災前の情報源に基づく)がほぼそのまま残っている。これを「震災前の近似」として使う。
SNAPSHOT_DATE = "2012-09-13T00:00:00Z"
ROAD_QUERY_2011 = f"""
[date:"{SNAPSHOT_DATE}"][out:json][timeout:90];
way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"]({BBOX});
out geom;
"""

# 嵩上げ・区画整理された2地区(緯度経度の矩形)
RECT_A = {"lat_min": 39.011, "lat_max": 39.023, "lon_min": 141.616, "lon_max": 141.641}
RECT_B = {"lat_min": 39.001, "lat_max": 39.011, "lon_min": 141.606, "lon_max": 141.621}

ID_OFFSET = 10_000_000_000
MIN_2011_ROADS = 10


def query(q, max_attempts=6):
    data = urllib.parse.urlencode({"data": q}).encode()
    last_err = None
    for attempt in range(max_attempts):
        url = MIRRORS[attempt % len(MIRRORS)]
        req = urllib.request.Request(url, data=data,
                                     headers={"User-Agent": "rikuzentakata-311-sim (educational)"})
        try:
            with urllib.request.urlopen(req, timeout=150) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last_err = e
            print(f"  リトライ {attempt+1}/{max_attempts} ({url.split('/')[2]}): {e}")
            time.sleep(10)
    raise last_err


def in_rect(pt, rect):
    lat, lon = pt
    return rect["lat_min"] <= lat <= rect["lat_max"] and rect["lon_min"] <= lon <= rect["lon_max"]


def mostly_in_rects(pts, rects):
    """pts の50%以上がいずれかの矩形内にあれば True"""
    if not pts:
        return False
    count = 0
    for pt in pts:
        if any(in_rect(pt, r) for r in rects):
            count += 1
    return count / len(pts) >= 0.5


def fetch_2011_roads():
    print("2011年3月時点の道路網(attic)を取得中…")
    res = query(ROAD_QUERY_2011)
    roads = []
    for el in res.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        roads.append({
            "id": el["id"],
            "class": el.get("tags", {}).get("highway", "unclassified"),
            "name": el.get("tags", {}).get("name", ""),
            "pts": [[round(p["lat"], 6), round(p["lon"], 6)] for p in el["geometry"]],
        })
    return roads


def main():
    ASSETS.mkdir(exist_ok=True)
    rects = [RECT_A, RECT_B]

    # 手順1: 2011年道路網の取得
    try:
        roads_2011 = fetch_2011_roads()
    except Exception as e:
        print(f"2011年道路網の取得に失敗しました: {e}")
        print("assets/roads.json は変更しません。")
        return

    (ASSETS / "roads_2011_raw.json").write_text(
        json.dumps({
            "source": f"© OpenStreetMap contributors (ODbL), {SNAPSHOT_DATE[:10]}時点(震災前街路の近似)",
            "roads": roads_2011,
        }, ensure_ascii=False), encoding="utf-8")
    print(f"  2011年道路 {len(roads_2011)} 本を取得 -> assets/roads_2011_raw.json")

    # 矩形内に該当する2011年道路を抽出
    roads_2011_in_area = [r for r in roads_2011 if mostly_in_rects(r["pts"], rects)]
    print(f"  うち嵩上げ地区内(50%以上)の道路: {len(roads_2011_in_area)} 本")

    # 手順3: フォールバック判定
    if len(roads_2011_in_area) < MIN_2011_ROADS:
        print(f"矩形内の2011年道路が{MIN_2011_ROADS}本未満のため、フォールバックします。")
        print("assets/roads.json は現在版のまま変更しません。")
        return

    # 手順2: 現在版を退避してから合成
    current_path = ASSETS / "roads.json"
    backup_path = ASSETS / "roads_current.json"
    current_data = json.loads(current_path.read_text(encoding="utf-8"))
    backup_path.write_text(json.dumps(current_data, ensure_ascii=False), encoding="utf-8")
    print(f"  現在版を退避 -> assets/roads_current.json")

    current_roads = current_data["roads"]

    removed = [r for r in current_roads if mostly_in_rects(r["pts"], rects)]
    kept = [r for r in current_roads if not mostly_in_rects(r["pts"], rects)]

    added = []
    for r in roads_2011_in_area:
        new_r = dict(r)
        new_r["id"] = r["id"] + ID_OFFSET
        added.append(new_r)

    merged_roads = kept + added

    new_data = {
        "source": current_data.get("source", "© OpenStreetMap contributors (ODbL)"),
        "roads": merged_roads,
    }
    current_path.write_text(json.dumps(new_data, ensure_ascii=False), encoding="utf-8")

    print(f"  除去した現在道路: {len(removed)} 本")
    print(f"  追加した2011年道路: {len(added)} 本")
    print(f"  合成後の道路総数: {len(merged_roads)} 本")

    # 手順4: 検証
    try:
        check = json.loads(current_path.read_text(encoding="utf-8"))
        assert "source" in check and "roads" in check
        assert isinstance(check["roads"], list)
        print(f"検証OK: assets/roads.json は正しいJSONで、道路 {len(check['roads'])} 本を含みます。")
    except Exception as e:
        print(f"検証NG: {e}")


if __name__ == "__main__":
    main()
