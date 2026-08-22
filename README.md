# BC Wildfire Susceptibility Explorer (BCWSE)

[![Live app](https://img.shields.io/badge/Live%20app-Earth%20Engine-0b6e99)](https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire)
[![Version](https://img.shields.io/badge/version-1.0-informational)](https://github.com/arshahvaran/bc-wildfire/tags)
[![CC BY-NC 4.0][cc-by-nc-shield]][cc-by-nc]

**An Earth Engine web app for reading calibrated, uncertainty-aware wildfire ignition
susceptibility maps of British Columbia.**

**Live app:** https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire

BCWSE accompanies a study that maps wildfire ignition susceptibility across British
Columbia from nine physical, climatic and human predictors, and that reports where the
model applies as well as what it predicts: a calibrated relative susceptibility score, a
five-class equal-area version of that score, an Area of Applicability mask, and a
conformal flag for pixels whose 90% prediction set keeps both outcomes.

Everything (layer switching, the per-pixel readout, transects, polygon statistics) is
computed in Earth Engine on the native 25.9 m grid. The app serves the finished map
products only. **The predictor rasters are not distributed**; their values are shown for a
clicked pixel and nowhere else.

## Contents

- [Key features](#key-features)
- [Getting started](#getting-started)
- [Map products](#map-products)
- [Technical validation](#technical-validation)
- [How to cite](#how-to-cite)
- [License](#license)

## Key features

**Layers.** One product on the map at a time, so nothing is read through a stack of
overlays: the continuous score, the five classes, or the Area of Applicability. Opacity
slider, and a subdued, satellite or hybrid basemap.

**Click readout.** Susceptibility, class, applicability and conformal ambiguity at the
clicked pixel, then all nine predictor values in their own units (human modification, road
density, distance to built areas, NDVI, vapour pressure deficit, wind speed, lightning
density, slope, FBP fuel type).

**Transect.** Draw a line and read susceptibility and class along it as a chart, sampled
at even spacing with a 400-point cap and a 26 m floor, with a CSV download.

**Polygon.** Draw a polygon and get its area, the mean and percentiles of susceptibility
inside it, and the class breakdown, at a scale chosen from the polygon's size.

## Getting started

Use the live app directly (nothing to install):
https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire. No Earth Engine account
and no sign-in are needed.

To run the source yourself, in the [Code Editor](https://code.earthengine.google.com):

1. Create a script and paste the whole of [`app/app.js`](app/app.js) into it.
2. Click **Run**. One self-contained script, no build step and no dependencies.
3. Point `ASSET_ROOT` and the `CONFIG.assets` block at your own copies to serve different
   products; every asset ID, palette, label and limit lives in that one object.

Ingesting the rasters is covered in
[`docs/asset_upload_guide.md`](docs/asset_upload_guide.md), and publishing in
[`docs/deployment.md`](docs/deployment.md).

## Map products

| Layer | What it shows |
| --- | --- |
| Susceptibility (continuous) | calibrated relative score, 0 to 1 |
| Susceptibility (five classes) | quantile, equal-area classes of that score |
| Area of Applicability | pixels whose predictors fall outside the training range |

Province-wide, 25.9 m pixels, EPSG:3005. The score ranks relative likelihood on a 1:1
ignition / non-ignition sampling base rate; it is not an annual ignition probability.

## Technical validation

[`tools/verify_assets.py`](tools/verify_assets.py) checks every ingested asset before the
app is allowed to serve it: that all 13 exist under the expected names, that the
projection and the 25.86 m grid survived ingestion, that values sampled from Earth Engine
match the source GeoTIFFs on disk at eight test points across British Columbia when read
on the assets' own `crsTransform`, and that the four categorical layers were ingested with
MODE pyramiding rather than MEAN, which it detects from the blended values a wrong setting
produces at coarse zoom.

## How to cite

*Reference paper will be added here once published.*

## License

This work is licensed under a
[Creative Commons Attribution-NonCommercial 4.0 International License][cc-by-nc].

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg
