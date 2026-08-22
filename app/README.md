# BC Wildfire Susceptibility Explorer - Earth Engine App

`app.js` is the complete source of the Earth Engine App that serves the final
map products of the wildfire susceptibility publication. It is written in the
Code Editor dialect (client-side `ui.*` / `Map.*` API) and runs as a single
script. It displays the susceptibility, class and Area-of-Applicability
layers, and provides a click readout, a transect chart and polygon statistics.
Predictor rasters are never added as map layers.

## 1. Paste the script into the Code Editor

1. Open https://code.earthengine.google.com with the account that owns the
   `ee-arshahvaran` Cloud project.
2. In the Scripts tab, make a new script (NEW > File), for example
   `wildfire_1/app`.
3. Paste the full content of `app.js` into the editor and click Save.

## 2. Attach the assets

1. In the Assets tab, select the `ee-arshahvaran` project and make the folder
   `projects/ee-arshahvaran/assets/wildfire_1` (NEW > Folder).
2. Upload the 13 single-band GeoTIFFs (NEW > Image Upload) with these exact
   asset names: `susceptibility_mean`, `susceptibility_class`, `aoa_mask`,
   `conformal_ambiguous`, `pred_ghm`, `pred_road_density`, `pred_dist_built`,
   `pred_ndvi`, `pred_vpd`, `pred_wind`, `pred_lightning`, `pred_slope`,
   `pred_fuel_type`.
3. In each upload dialog, set the masking (nodata) value from the data
   dictionary: -9999 for the float rasters and `pred_fuel_type`, 0 for
   `susceptibility_class`, 255 for `aoa_mask` and `conformal_ambiguous`.
4. For the categorical rasters (`susceptibility_class`, `aoa_mask`,
   `conformal_ambiguous`, `pred_fuel_type`) set the pyramiding policy to MODE
   so coarse-scale polygon statistics stay valid.
5. The boundary table `projects/ee-arshahvaran/assets/bc_shapefile_gee`
   already exists. Click Run to test the script against the assets.

## 3. Publish as an app

1. In the Code Editor, click Apps > NEW APP.
2. Select the `ee-arshahvaran` Google Cloud project, set the app name to
   "BC Wildfire Susceptibility Explorer", and choose this script (or a
   repository that contains only it) as the source.
3. In the publish dialog, the Code Editor lists the assets the app reads.
   Use the option that shares those assets with the app (this grants the
   app's service account read access). Do NOT make the assets public.
4. Click Publish and open the app URL
   (https://ee-arshahvaran.projects.earthengine.app/view/...) to verify.
