# Uploading the 13 rasters to Earth Engine — step-by-step guide

You will upload 13 GeoTIFF files (about 20 GB total) through the Earth Engine Code
Editor in your browser. No command line, no billing. Each upload is the same eight
clicks; only the file, the asset name, and two settings change. Budget an evening:
the browser must finish *transferring* each file before you start the next batch,
but the *ingestion* (Earth Engine processing the file) continues on Google's side
after transfer, so you can queue several and walk away.

## One-time setup (2 minutes)

1. Open https://code.earthengine.google.com/ in Chrome and sign in with the Google
   account that owns the `ee-arshahvaran` project.
2. In the top-left corner, check the project selector shows **ee-arshahvaran**.
   If it shows something else, click it and choose ee-arshahvaran.
3. Click the **Assets** tab (left panel, next to Scripts and Docs).
4. Click the red **NEW** button → **Folder**. Type exactly:

       wildfire_1

   and click **CREATE**. You should now see `wildfire_1` in your asset tree under
   `projects/ee-arshahvaran/assets`.

## The upload procedure (repeat 13 times)

For EACH row of the table below:

1. Assets tab → red **NEW** button → **Image Upload** → **GeoTIFF (.tif ...)**.
2. Click **SELECT** and pick the file from the "File on your disk" column.
3. In **Asset ID**, click the folder icon and choose the `wildfire_1` folder, then
   type the "Asset name" from the table (so the full ID reads
   `projects/ee-arshahvaran/assets/wildfire_1/<Asset name>`).
4. Scroll down to **Masking mode**. Choose **No-data value** and type the number
   from the "No-data" column. (This tells Earth Engine which pixels are empty.
   Getting it wrong makes oceans read as -9999 instead of "no data".)
5. Scroll to **Pyramiding policy**. Set it to the value in the "Pyramiding" column.
   **This is the one setting that can go silently wrong.** MEAN is the default and
   is correct for the smooth layers; the four rows marked **MODE** are categorical
   maps, and MODE stops Earth Engine from blending class codes into meaningless
   averages when zoomed out. Please double-check those four.
6. Click **UPLOAD**. A task appears in the **Tasks** tab (top right, orange).
7. Keep the browser tab open until the task's *upload* phase finishes (the file
   transfer). Once it shows as an ingestion task, Google continues without you.
8. Move to the next row. Two or three uploads can transfer in parallel if your
   connection is decent.

## The 13 files

| # | File on your disk (E:\publications\wildfire_1\data\...) | Asset name | No-data | Pyramiding |
|---|---|---|---|---|
| 1 | process_6\3\maps\susceptibility_mean_lightgbm.tif | susceptibility_mean | -9999 | MEAN |
| 2 | process_6\4\classified\susceptibility_class_quantile_lightgbm.tif | susceptibility_class | 0 | **MODE** |
| 3 | process_6\3\applicability\aoa_mask.tif | aoa_mask | 255 | **MODE** |
| 4 | process_6\3\conformal\conformal_ambiguous.tif | conformal_ambiguous | 255 | **MODE** |
| 5 | rasters_coregistered\ghm_human_modification_90m_coregistered.tif | pred_ghm | -9999 | MEAN |
| 6 | rasters_coregistered\gov_bc_road_density_30m_coregistered.tif | pred_road_density | -9999 | MEAN |
| 7 | rasters_coregistered\ghs_dist_to_built_30m_coregistered.tif | pred_dist_built | -9999 | MEAN |
| 8 | rasters_coregistered\landsat_c2_t1_l2_ndvi_30m_coregistered.tif | pred_ndvi | -9999 | MEAN |
| 9 | rasters_coregistered\casr_v32_mean_annual_maximum_vpd_10km_coregistered.tif | pred_vpd | -9999 | MEAN |
| 10 | rasters_coregistered\casr_v32_mean_annual_maximum_sfcWindmax_10km_coregistered.tif | pred_wind | -9999 | MEAN |
| 11 | rasters_coregistered\wglc_lightning_density_10km_coregistered.tif | pred_lightning | -9999 | MEAN |
| 12 | rasters_coregistered\gedtm30_slope_30m_rescaled_coregistered.tif | pred_slope | -9999 | MEAN |
| 13 | rasters_coregistered\cffdrs_fbp_fuel_type_30m_coregistered.tif | pred_fuel_type | -9999 | **MODE** |

Suggested order: start with rows 2, 3, 4, 13 (the small ones, minutes each) to get
comfortable with the dialog, then queue the big ones (1, 5–12) in batches.

## If something goes wrong

* **Typo in the asset name** — no problem: right-click the asset in the tree →
  Rename. The names must match the table exactly (the app code refers to them).
* **Forgot the no-data value or picked the wrong pyramiding** — delete the asset
  (right-click → Delete) and upload that file again. Settings cannot be changed
  after ingestion.
* **A task shows FAILED in the Tasks tab** — hover it for the reason; nearly always
  a cancelled transfer. Just repeat that row.

## When you are done

Tell Claude "uploads done". The verification script (`tools/verify_assets.py`) will
then check every asset: that all 13 exist under the right names, that the
projection and 25.86 m resolution survived, that sampled values match the original
files on your disk at eight test points, and that the four MODE layers really were
ingested with MODE (it can detect the blended values a wrong setting produces).
Anything wrong, it names the exact asset to re-upload. Nothing proceeds to the app
until this passes.
