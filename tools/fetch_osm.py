"""OpenStreetMap (Overpass API) から道路網とランドマークを取得する。

出典: © OpenStreetMap contributors (ODbL)
注意: 現在の OSM データは震災後の地形・道路(嵩上げ後)を含む。
      フェーズ1では街の骨格として使用し、震災前の再現度はフェーズ2で改善する。

出力:
  assets/roads.json      道路ポリライン(緯度経度)+ 種別
  assets/landmarks.json  名前で検索したランドマーク(緯度経度)

使い方: python tools/fetch_osm.py
"""
import json
import time
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

# terrain_meta.json と同じ範囲(南,西,北,東)
BBOX = "38.985,141.595,39.035,141.665"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

ROAD_QUERY = f"""
[out:json][timeout:60];
way["highway"~"^(trunk|primary|secondary|tertiary|unclassified|residential|service|track)$"]({BBOX});
out geom;
"""

LANDMARK_QUERY = f"""
[out:json][timeout:60];
(
  nwr["name"~"一本松|市民会館|市民体育館|市役所|道の駅|高田松原|伝承館|気仙中|高田病院|高田小|高田高校|下矢作|普門寺|本丸公園|高台"]({BBOX});
  nwr["memorial"]({BBOX});
  nwr["historic"]({BBOX});
);
out center tags;
"""


def query(q):
    data = urllib.parse.urlencode({"data": q}).encode()
    last_err = None
    for attempt in range(4):
        url = MIRRORS[attempt % len(MIRRORS)]
        req = urllib.request.Request(url, data=data,
                                     headers={"User-Agent": "rikuzentakata-311-sim (educational)"})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            last_err = e
            print(f"  リトライ {attempt+1} ({url.split('/')[2]}): {e}")
            time.sleep(10)
    raise last_err


def main():
    ASSETS.mkdir(exist_ok=True)

    if (ASSETS / "roads.json").exists():
        print("roads.json は取得済み、スキップ")
    else:
        print("道路網を取得中…")
        res = query(ROAD_QUERY)
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
        (ASSETS / "roads.json").write_text(
            json.dumps({"source": "© OpenStreetMap contributors (ODbL)", "roads": roads},
                       ensure_ascii=False), encoding="utf-8")
        print(f"  道路 {len(roads)} 本")

    print("ランドマークを取得中…")
    res = query(LANDMARK_QUERY)
    lms = []
    for el in res.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue
        if el.get("type") == "node":
            lat, lon = el.get("lat"), el.get("lon")
        else:
            c = el.get("center", {})
            lat, lon = c.get("lat"), c.get("lon")
        if lat is None:
            continue
        lms.append({"name": name, "lat": lat, "lon": lon,
                    "tags": {k: v for k, v in tags.items()
                             if k in ("historic", "memorial", "tourism", "amenity", "building")}})
    (ASSETS / "landmarks.json").write_text(
        json.dumps({"source": "© OpenStreetMap contributors (ODbL)", "landmarks": lms},
                   ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  ランドマーク {len(lms)} 件")
    for lm in lms:
        print(f"    {lm['name']} ({lm['lat']:.4f}, {lm['lon']:.4f})")


if __name__ == "__main__":
    main()
