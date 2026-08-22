# app/ - the Earth Engine App source

`app.js` is the complete source of the **BC Wildfire Susceptibility Explorer**, the Earth
Engine App that serves the final map products of the wildfire susceptibility publication. It
is written in the Code Editor dialect (client-side `ui.*` and `Map.*` API) and runs as a
single script: no npm, no bundler, no build step. Paste it and run it.

Live app: <https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire>

For the project overview see the [repository README](../README.md); for ingesting the rasters
see [`docs/asset_upload_guide.md`](../docs/asset_upload_guide.md); for publishing and updating
the app see [`docs/deployment.md`](../docs/deployment.md).

## What the script builds

* Three product layers, one visible at a time: susceptibility (continuous 0 to 1),
  susceptibility (five classes) and the Area of Applicability, with an opacity slider, a
  basemap selector and a legend that follows the active layer.
* Three mutually exclusive tools: **Inspect** (click readout for one pixel), **Transect**
  (chart of susceptibility and class along a drawn line) and **Polygon** (statistics for a
  drawn polygon).
* An **About this app** section carrying the interpretation caveats, including that the score
  is relative and not an annual ignition probability.

## Disclosure boundary

Do not relax these while editing `app.js`:

* Predictor rasters are never added as map layers.
* Per-pixel predictor values appear only in the click readout, and only for the nine entries
  in the fixed `PREDICTORS` allowlist. Nothing iterates `bandNames()` to build that list.
* The transect chart and its CSV carry susceptibility and class only.
* Polygon statistics carry no predictor aggregates.

## Editing the script

Everything configurable lives in the `CONFIG` object at the top of the file: asset IDs,
palettes, class names, the FBP fuel code lookup, the native grid transform, zoom limits, the
transect point cap and the polygon scale thresholds. Change asset IDs there and nowhere else.

The Code Editor sandbox is not a full modern JavaScript environment. It has no `Object.freeze`
and no ES6 syntax, so the allowlist is a plain array and the file stays in ES5.

Sampling uses the products' native grid (`CONFIG.nativeTransform`, EPSG:3005, 25.86 m) rather
than a rounded scale, so a click reads the same pixel the source GeoTIFF holds. A rounded
26 m scale can land one pixel away wherever the surface has a gradient.

## Running it

1. Open <https://code.earthengine.google.com> with the account that owns the `ee-arshahvaran`
   Cloud project.
2. Scripts tab, NEW > File, for example `wildfire_1/app`.
3. Paste the whole of `app.js` and click **Save**.
4. Click **Run**.

The script expects the 13 images and the boundary table `bc_boundary`, all under
`projects/ee-arshahvaran/assets/wildfire_1`. If those are not in place,
follow [`docs/asset_upload_guide.md`](../docs/asset_upload_guide.md) and then run
`tools/verify_assets.py`.

## Publishing

Apps > NEW APP publishes a saved snapshot of the script, and the app name sets the public URL.
The step that is easy to get wrong is asset sharing: sharing the `wildfire_1` folder with the
app does not share the images inside it, so each of the 13 assets must be shared with the
app's service account individually. [`docs/deployment.md`](../docs/deployment.md) covers the
dialog and gives a script that shares them all in one pass.
