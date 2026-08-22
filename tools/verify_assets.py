#!/usr/bin/env python
"""
verify_assets.py -- post-upload verification for the wildfire_1 Earth Engine assets.

Read-only against Earth Engine (no writes, no exports). Run from gee-env:

    python tools/verify_assets.py

Checks:
  1. All 13 expected assets exist under projects/ee-arshahvaran/assets/wildfire_1
     (missing or misnamed uploads are listed explicitly so you know which to redo).
  2. Band name / dtype / CRS / nominal scale for each asset. CRS must be
     EPSG:3005 and the nominal scale within 25.5-26.5 m.
  3. Value spot-checks at 8 fixed points across (and outside) BC. If rasterio
     and pyproj are importable AND the local source rasters exist, the same
     pixel is read locally and compared (rel. tol 1e-4 for floats, exact for
     ints, both-masked counts as a match). Otherwise the local half is skipped
     with a notice. NOTE: a single-pixel mismatch right on a class boundary can
     be a 26 m resample-grid alignment artifact -- eyeball before re-uploading.
  4. Pyramiding sanity for the 4 categorical assets: every value seen at a
     coarse 2000 m scale over a 50 km box near Kelowna must be a legal code.
     Blended (non-integer) or illegal values mean the asset was ingested with
     MEAN pyramiding and must be re-uploaded with pyramiding policy MODE.

Exit code 0 only if every check passes; otherwise a FAILURES summary and 1.
"""

import math
import sys

import ee

try:
    import rasterio
    import pyproj
    HAVE_LOCAL = True
except ImportError:
    HAVE_LOCAL = False

PROJECT = "ee-arshahvaran"
FOLDER = "projects/ee-arshahvaran/assets/wildfire_1"

# key -> (kind, local source GeoTIFF, fallback nodata for the local read)
ASSETS = {
    "susceptibility_mean":  ("float", r"E:\publications\wildfire_1\data\process_6\3\maps\susceptibility_mean_lightgbm.tif", -9999),
    "susceptibility_class": ("int",   r"E:\publications\wildfire_1\data\process_6\4\classified\susceptibility_class_quantile_lightgbm.tif", 0),
    "aoa_mask":             ("int",   r"E:\publications\wildfire_1\data\process_6\3\applicability\aoa_mask.tif", 255),
    "conformal_ambiguous":  ("int",   r"E:\publications\wildfire_1\data\process_6\3\conformal\conformal_ambiguous.tif", 255),
    "pred_ghm":             ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\ghm_human_modification_90m_coregistered.tif", None),
    "pred_road_density":    ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\gov_bc_road_density_30m_coregistered.tif", None),
    "pred_dist_built":      ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\ghs_dist_to_built_30m_coregistered.tif", None),
    "pred_ndvi":            ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\landsat_c2_t1_l2_ndvi_30m_coregistered.tif", None),
    "pred_vpd":             ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\casr_v32_mean_annual_maximum_vpd_10km_coregistered.tif", None),
    "pred_wind":            ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\casr_v32_mean_annual_maximum_sfcWindmax_10km_coregistered.tif", None),
    "pred_lightning":       ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\wglc_lightning_density_10km_coregistered.tif", None),
    "pred_slope":           ("float", r"E:\publications\wildfire_1\data\rasters_coregistered\gedtm30_slope_30m_rescaled_coregistered.tif", None),
    "pred_fuel_type":       ("int",   r"E:\publications\wildfire_1\data\rasters_coregistered\cffdrs_fbp_fuel_type_30m_coregistered.tif", -9999),
}

# (label, lon, lat) in EPSG:4326
POINTS = [
    ("Victoria area (Sooke hills)",            -123.45, 48.50),
    ("Kelowna",                                -119.49, 49.89),
    ("Prince George",                          -122.75, 53.92),
    ("Fort Nelson",                            -122.70, 58.81),
    ("Coastal rainforest W of Bella Coola",    -127.00, 52.50),
    ("Ha-Iltzuk Icefield (alpine ice)",        -126.20, 51.55),
    ("Alberta, outside domain (expect null)",  -114.50, 51.50),
    ("Williston Lake (expect masked suscept)", -123.02, 56.00),
]

LEGAL = {
    "susceptibility_class": {1, 2, 3, 4, 5},
    "aoa_mask": {0, 1},
    "conformal_ambiguous": {0, 1},
    "pred_fuel_type": {1, 2, 3, 4, 5, 7, 11, 13, 31, 101, 102, 105, 415, 625, 650, 675},
}

# ~50 km x 50 km box centred near Kelowna (lon +/-0.349 deg, lat +/-0.225 deg)
KELOWNA_BOX = [-119.84, 49.665, -119.14, 50.115]

failures = []


def fail(msg):
    failures.append(msg)
    print("  FAIL: " + msg)


def fmt(v):
    if v is None:
        return "masked/null"
    if isinstance(v, float) and not v.is_integer():
        return "{:.6g}".format(v)
    return str(int(v)) if float(v).is_integer() else str(v)


def check_metadata():
    """Existence + band name/dtype/CRS/scale for each expected asset."""
    print("\n=== 1-2. Asset existence and metadata ===")
    try:
        listed = ee.data.listAssets({"parent": FOLDER}).get("assets", [])
        actual_ids = {a["id"] if a["id"].startswith("projects/") else a["name"] for a in listed}
    except Exception as exc:
        actual_ids = set()
        fail("Cannot list folder {} ({}). Create the folder and upload the assets.".format(FOLDER, exc))
    infos, missing = {}, []
    hdr = "{:<22} {:>6} {:<14} {:<10} {:>8}".format("asset", "band", "dtype", "crs", "scale_m")
    print(hdr + "\n" + "-" * len(hdr))
    for key in ASSETS:
        aid = FOLDER + "/" + key
        try:
            ee.data.getAsset(aid)
            info = ee.Image(aid).getInfo()
        except Exception:
            missing.append(key)
            print("{:<22} MISSING".format(key))
            continue
        band = info["bands"][0]
        dt = band.get("data_type", {})
        dtype = dt.get("precision", "?")
        if "min" in dt and "max" in dt:
            dtype += "[{:g}..{:g}]".format(dt["min"], dt["max"])
        crs = band.get("crs", "?")
        tr = band.get("crs_transform", [0, 0, 0, 0, 0, 0])
        scale = (abs(tr[0]) + abs(tr[4])) / 2.0
        infos[key] = {"band": band.get("id", "?"), "crs": crs, "scale": scale}
        print("{:<22} {:>6} {:<14} {:<10} {:>8.3f}".format(key, band.get("id", "?"), dtype, crs, scale))
        if band.get("id") != "b1":
            fail("{}: band is named '{}', expected 'b1' (Code Editor ingestion default).".format(key, band.get("id")))
        if crs != "EPSG:3005":
            fail("{}: CRS is {}, expected EPSG:3005.".format(key, crs))
        if not (25.5 <= abs(tr[0]) <= 26.5 and 25.5 <= abs(tr[4]) <= 26.5):
            fail("{}: nominal scale {:.4f} m outside 25.5-26.5 m.".format(key, scale))
    if missing:
        print("\n  *** MISSING OR MISNAMED ASSETS -- redo these uploads: ***")
        for key in missing:
            print("      {}/{}".format(FOLDER, key))
        extras = sorted(i.rsplit("/", 1)[-1] for i in actual_ids
                        if i.rsplit("/", 1)[-1] not in ASSETS)
        if extras:
            print("  Present in the folder but NOT expected (possibly misnamed uploads): " + ", ".join(extras))
        fail("Missing/misnamed assets: " + ", ".join(missing))
    return infos


def read_local_pixels(present):
    """{(key, point_index): value-or-None} from the local GeoTIFFs, or None if unavailable."""
    if not HAVE_LOCAL:
        print("\n  rasterio/pyproj not importable in this environment -- SKIPPING the local")
        print("  pixel comparison. Re-run from an env that has both for the full check.")
        return None
    tf = pyproj.Transformer.from_crs("EPSG:4326", "EPSG:3005", always_xy=True)
    xy = [tf.transform(lon, lat) for _, lon, lat in POINTS]
    out = {}
    for key in present:
        _, path, fallback_nd = ASSETS[key]
        try:
            ds = rasterio.open(path)
        except Exception:
            print("  local file not found, skipped for {}: {}".format(key, path))
            continue
        with ds:
            nd = ds.nodata if ds.nodata is not None else fallback_nd
            for i, (x, y) in enumerate(xy):
                row, col = ds.index(x, y)
                if not (0 <= row < ds.height and 0 <= col < ds.width):
                    out[(key, i)] = None
                    continue
                v = float(next(ds.sample([(x, y)]))[0])
                masked = math.isnan(v) or (nd is not None and abs(v - float(nd)) < 1e-6)
                out[(key, i)] = None if masked else v
    return out


def values_match(kind, ee_v, loc_v):
    if ee_v is None and loc_v is None:
        return True
    if ee_v is None or loc_v is None:
        return False
    if kind == "int":
        return int(round(float(ee_v))) == int(round(float(loc_v)))
    return math.isclose(float(ee_v), float(loc_v), rel_tol=1e-4, abs_tol=1e-6)


def spot_checks(present):
    print("\n=== 3. Value spot-checks at 8 fixed points (reduceRegion first, scale 26 m) ===")
    local = read_local_pixels(present)
    stack = ee.Image.cat([ee.Image(FOLDER + "/" + k).rename(k) for k in present])
    for i, (label, lon, lat) in enumerate(POINTS):
        print("\n  [{}] {}  ({:.4f}, {:.4f})".format(i + 1, label, lon, lat))
        pt = ee.Geometry.Point([lon, lat])
        try:
            vals = stack.reduceRegion(ee.Reducer.first(), pt, scale=26, crs="EPSG:3005").getInfo()
        except Exception as exc:
            fail("reduceRegion failed at point '{}': {}".format(label, exc))
            continue
        for key in present:
            ee_v = vals.get(key)
            line = "    {:<22} EE: {:<14}".format(key, fmt(ee_v))
            if local is not None and (key, i) in local:
                loc_v = local[(key, i)]
                ok = values_match(ASSETS[key][0], ee_v, loc_v)
                line += " local: {:<14} {}".format(fmt(loc_v), "MATCH" if ok else "MISMATCH")
                if not ok:
                    fail("{} at '{}': EE={} local={}".format(key, label, fmt(ee_v), fmt(loc_v)))
            print(line)
        if "susceptibility_mean" in present:
            sus = vals.get("susceptibility_mean")
            if "Alberta" in label and sus is not None:
                fail("Alberta point returned susceptibility_mean={} (expected null -- check georeferencing).".format(fmt(sus)))
            if "Williston" in label and sus is not None:
                fail("Lake point returned susceptibility_mean={} (expected masked -- check waterbody exclusion mask).".format(fmt(sus)))


def pyramiding_checks(present, infos):
    print("\n=== 4. Pyramiding sanity (2000 m frequency histogram, 50 km box near Kelowna) ===")
    box = ee.Geometry.Rectangle(KELOWNA_BOX, "EPSG:4326", False)
    for key in LEGAL:
        if key not in present:
            print("  {:<22} skipped (asset missing)".format(key))
            continue
        band = infos.get(key, {}).get("band", "b1")
        try:
            hist = (ee.Image(FOLDER + "/" + key)
                    .reduceRegion(ee.Reducer.frequencyHistogram(), box,
                                  scale=2000, crs="EPSG:3005", maxPixels=1e8)
                    .getInfo()).get(band) or {}
        except Exception as exc:
            fail("{}: coarse-scale histogram failed ({})".format(key, exc))
            continue
        bad = []
        for k in hist:
            v = float(k)
            if abs(v - round(v)) > 1e-6 or int(round(v)) not in LEGAL[key]:
                bad.append(k)
        seen = sorted(float(k) for k in hist)
        print("  {:<22} values at 2000 m: {}".format(key, [fmt(v) for v in seen] or "none (all masked?)"))
        if not hist:
            fail("{}: no unmasked pixels in the Kelowna box at 2000 m -- check the upload/mask.".format(key))
        if bad:
            fail("{}: ILLEGAL coarse-scale values {} -- this asset was ingested with MEAN "
                 "pyramiding. Re-upload {}/{} with pyramiding policy MODE.".format(key, bad, FOLDER, key))


def main():
    print("wildfire_1 asset verification (read-only) -- project {}".format(PROJECT))
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:
        print("FAIL: ee.Initialize failed: {}\nRun 'earthengine authenticate' first.".format(exc))
        sys.exit(1)
    infos = check_metadata()
    present = [k for k in ASSETS if k in infos]
    if present:
        spot_checks(present)
        pyramiding_checks(present, infos)
    print("\n=== Summary ===")
    if failures:
        print("FAILURES ({}):".format(len(failures)))
        for n, msg in enumerate(failures, 1):
            print("  {:>2}. {}".format(n, msg))
        sys.exit(1)
    print("ALL CHECKS PASSED.")
    sys.exit(0)


if __name__ == "__main__":
    main()
