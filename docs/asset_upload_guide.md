# Uploading the 13 rasters to Earth Engine: a step-by-step guide

*(Written against the "Upload a new image asset" dialog as of August 2026.)*

You will upload 13 GeoTIFF files (about 20 GB total) through the Earth Engine Code
Editor in your browser. No command line, no billing. Each upload is the same few
steps; only the file, the asset name, and two settings change. Budget an evening:
the browser must finish *transferring* each file, but the *ingestion* (Earth Engine
processing it) continues on Google's side afterwards, so you can queue several and
walk away.

## The one thing that trips people up

The **Asset ID** row has a dropdown and a text box:

    Asset ID:  [ projects/ee-arshahvaran/assets/  ▾ ]  [ Asset Name          ]

The dropdown only ever lists **project roots**. It will never show `wildfire_1`,
and that is normal, not a bug. To put an asset inside a folder you type the folder
into the **Asset Name** box as part of the path:

    Asset Name:  wildfire_1/susceptibility_class

which produces the full ID `projects/ee-arshahvaran/assets/wildfire_1/susceptibility_class`.
Every asset name in the table below must be typed with that `wildfire_1/` prefix.

## One-time setup (already done)

The folder `projects/ee-arshahvaran/assets/wildfire_1` already exists.
Nothing to do here.

## The upload procedure (repeat 13 times)

1. **Assets** tab → red **NEW** button → **Image upload** → **GeoTIFF (.tif, .tiff)**.
   The dialog is titled *"Upload a new image asset"*.
2. **Source files** → click **SELECT** → choose the file from the "File on your disk"
   column of the table. Its name appears in the grey strip below the button.
3. **Asset ID** → leave the dropdown on `projects/ee-arshahvaran/assets/`, and in the
   **Asset Name** box type the value from the "Type in Asset Name" column
   (always beginning `wildfire_1/`).
4. Skip the **Properties** section entirely (no start time, no end time, no
   properties; none of them matter for this app).
5. Open **Advanced options**. Three fields, in this order:
   * **Pyramiding policy**: a dropdown offering MEAN, MODE, MIN, MAX, SAMPLE.
     Set it to the value in the "Pyramiding" column. **This is the one setting that
     can go silently wrong.** MEAN is right for the smooth layers; the four rows
     marked **MODE** are categorical maps, where MODE stops Earth Engine from
     averaging class codes into meaningless in-between values when zoomed out.
   * **Masking mode**: set to **No-data value**.
   * **No-data value**: type the number from the "No-data" column. (This tells
     Earth Engine which pixels are empty; get it wrong and the ocean reads as
     −9999 instead of "no data".)
6. Click **UPLOAD**. A task appears in the **Tasks** tab (top right).
7. Keep the browser tab open until the *transfer* finishes. Once it becomes an
   ingestion task, Google continues without you. Two or three transfers can run at
   once on a decent connection.

## The 13 files

All local paths are relative to `E:\publications\wildfire_1\data\`.

| # | File on your disk | Type in Asset Name | No-data | Pyramiding |
|---|---|---|---|---|
| 1 | process_6\3\maps\susceptibility_mean_lightgbm.tif | `wildfire_1/susceptibility_mean` | -9999 | MEAN |
| 2 | process_6\4\classified\susceptibility_class_quantile_lightgbm.tif | `wildfire_1/susceptibility_class` | 0 | **MODE** |
| 3 | process_6\3\applicability\aoa_mask.tif | `wildfire_1/aoa_mask` | 255 | **MODE** |
| 4 | process_6\3\conformal\conformal_ambiguous.tif | `wildfire_1/conformal_ambiguous` | 255 | **MODE** |
| 5 | rasters_coregistered\ghm_human_modification_90m_coregistered.tif | `wildfire_1/pred_ghm` | -9999 | MEAN |
| 6 | rasters_coregistered\gov_bc_road_density_30m_coregistered.tif | `wildfire_1/pred_road_density` | -9999 | MEAN |
| 7 | rasters_coregistered\ghs_dist_to_built_30m_coregistered.tif | `wildfire_1/pred_dist_built` | -9999 | MEAN |
| 8 | rasters_coregistered\landsat_c2_t1_l2_ndvi_30m_coregistered.tif | `wildfire_1/pred_ndvi` | -9999 | MEAN |
| 9 | rasters_coregistered\casr_v32_mean_annual_maximum_vpd_10km_coregistered.tif | `wildfire_1/pred_vpd` | -9999 | MEAN |
| 10 | rasters_coregistered\casr_v32_mean_annual_maximum_sfcWindmax_10km_coregistered.tif | `wildfire_1/pred_wind` | -9999 | MEAN |
| 11 | rasters_coregistered\wglc_lightning_density_10km_coregistered.tif | `wildfire_1/pred_lightning` | -9999 | MEAN |
| 12 | rasters_coregistered\gedtm30_slope_30m_rescaled_coregistered.tif | `wildfire_1/pred_slope` | -9999 | MEAN |
| 13 | rasters_coregistered\cffdrs_fbp_fuel_type_30m_coregistered.tif | `wildfire_1/pred_fuel_type` | -9999 | **MODE** |

Suggested order: do rows 2, 3, 4 and 13 first (the small ones, minutes each) to get
comfortable with the dialog, then queue the big ones (1, 5–12) in batches.

## Checking the first one landed correctly

After upload #2 finishes, click the refresh arrow at the top of the Assets tab and
expand `wildfire_1`. You should see `susceptibility_class` **inside** the folder,
not beside it. Click it: the *Asset details* panel should report a single band
`b1`, 71538 × 53042 pixels, and EPSG:3005.

## If something goes wrong

* **The asset landed in the wrong place** (beside `wildfire_1` instead of inside).
  Right-click it → **Rename**, and change the path to include `wildfire_1/`.
  Rename moves an asset in Earth Engine; you do not have to upload it again.
* **Typo in the name**: same fix, right-click → Rename. The names must match the
  table exactly, because the app code refers to them.
* **Wrong no-data value or wrong pyramiding**: these cannot be changed after
  ingestion. Right-click → **Delete**, then upload that file again.
* **A task shows FAILED in the Tasks tab**: hover it for the reason; nearly always
  a cancelled transfer. Just repeat that row.

## When you are done

Then run the verification script (`tools/verify_assets.py`), which
checks every asset: that all 13 exist under the right names, that the projection and
25.86 m resolution survived, that sampled values match the original files on your
disk at eight test points across BC, and that the four MODE layers really were
ingested with MODE (it detects the blended values a wrong setting produces).
Anything wrong, it names the exact asset to redo. Nothing proceeds to the app until
this passes.
