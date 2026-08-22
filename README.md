# BC Wildfire Susceptibility Explorer

[![Live app](https://img.shields.io/badge/Live%20app-Earth%20Engine-4285F4)](https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire)
[![Content licence: CC BY-NC 4.0](https://img.shields.io/badge/Content-CC%20BY--NC%204.0-lightgrey)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Code licence: MIT](https://img.shields.io/badge/Code-MIT-green)](LICENSE)

An interactive Google Earth Engine application that serves the finished map products of a
wildfire ignition susceptibility study for British Columbia: a calibrated relative
susceptibility score, a five-class version of that score, and a per-pixel view of where the
model is and is not applicable. The app is built for reading the maps rather than rebuilding
them, so it answers questions about one pixel, one transect or one polygon at a time, and it
never distributes the input rasters.

Open the app: <https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire>

## Contents

1. [Key features](#1-key-features)
2. [Getting started](#2-getting-started)
3. [Data and methods](#3-data-and-methods)
4. [Repository structure](#4-repository-structure)
5. [How to cite](#5-how-to-cite)
6. [Licence](#6-licence)

## 1. Key features

### 1.1 Two display modes for the susceptibility surface

The layer selector shows exactly one product at a time, so nothing is read through a stack of
overlays:

* **Susceptibility (continuous).** The calibrated score from 0 to 1 on a yellow to dark red
  ramp, with a graded legend.
* **Susceptibility (five classes).** The same score cut at quantile (equal-area) breaks into
  very low, low, moderate, high and very high, with a categorical legend.

A third selectable layer, the **Area of Applicability**, greys out the pixels the model can
speak to and marks the rest as extrapolation. An opacity slider applies to whichever layer is
active, and the basemap can be switched between a subdued road map, satellite and hybrid. Zoom
is capped at a level suited to a 25.86 m product, so the map is never zoomed past its own
resolution.

### 1.2 Click readout, including the nine predictors

With the **Inspect** tool active, a click returns a card for that pixel: the susceptibility
score, its class, whether the pixel lies within the Area of Applicability, whether the
conformal prediction set is confident or ambiguous, and the values of all nine model
predictors:

| Predictor | Reported as |
|---|---|
| Human modification (gHM) | index, 0 to 1 |
| Road density | km/km2 |
| Distance to built areas | km |
| NDVI | index |
| Vapour pressure deficit | kPa |
| Wind speed | m/s |
| Lightning density | strokes/km2/yr |
| Slope | degrees |
| FBP fuel type | fuel class name |

Values are read on the products' native grid, so the readout reports the same number the
source raster holds. The predictor list is a fixed allowlist in the source: the app reads
those nine values for the clicked pixel only, and no predictor is ever added as a map layer.

### 1.3 Transect tool

Draw a line and the app samples susceptibility and class along it, then charts both against
distance in kilometres. Sample spacing is chosen from the line length, capped at 400 points
and never finer than the pixel size, and the app reports the spacing it used. The chart's
pop-out button downloads the sampled series as CSV. The transect carries susceptibility and
class only.

### 1.4 Polygon statistics tool

Draw a polygon and the app reports its area, the mean and median susceptibility inside it, the
share of area in each of the five classes, the percentage of the polygon within the Area of
Applicability, and the percentage where the conformal prediction is confident. Very large
polygons are summarised at a coarser scale so a province-wide draw still returns. Polygon
statistics carry no predictor aggregates.

### 1.5 What the app deliberately does not distribute

The app is a viewer for the published products, not a data release:

* The nine predictor rasters are never map layers and are never downloadable. They are read
  only through the click readout, one pixel at a time, from a fixed allowlist.
* The transect CSV contains susceptibility and class only.
* Polygon statistics summarise the products only.
* The wildfire records used for training are not served by the app.
* The Earth Engine assets are shared with the app's service account, not with the world, so
  the rasters stay non-public (see [docs/deployment.md](docs/deployment.md)).

## 2. Getting started

### 2.1 Open the live app

Go to <https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire>. No Earth Engine
account and no sign-in is needed. The app was first published at
`https://ee-arshahvaran.projects.earthengine.app/view/wildfire-susceptibility-bc`; that older
address may still be in circulation, and both point at the same application.

Start with the **Inspect** tool, click anywhere inside British Columbia, then switch layers or
tools from the left panel. The **About this app** section at the foot of the panel repeats the
interpretation caveats.

### 2.2 Run the source yourself in the Code Editor

You need an Earth Engine account and read access to the assets under
`projects/ee-arshahvaran/assets/wildfire_1`. The app is one self-contained Code Editor script
with no build step, no npm and no bundler.

1. Open <https://code.earthengine.google.com>.
2. Create a new script (Scripts tab, NEW > File), for example `wildfire_1/app`.
3. Paste the whole of [`app/app.js`](app/app.js) into the editor and click **Save**.
4. Click **Run**. The control panel appears on the left and the map centres on British
   Columbia.

To point the script at your own copies of the products, change `ASSET_ROOT` and the
`CONFIG.assets` block at the top of `app/app.js`; every asset ID, palette, label and limit
lives in that one configuration object. [`docs/asset_upload_guide.md`](docs/asset_upload_guide.md)
covers ingesting the rasters, [`tools/verify_assets.py`](tools/verify_assets.py) checks the
result, and [`docs/deployment.md`](docs/deployment.md) covers publishing.

## 3. Data and methods

The model learns wildfire ignition susceptibility for British Columbia from 9,317 wildfire
records for 2000 to 2025, paired one to one with non-ignition locations. Nine predictors were
retained from 45 candidates after screening for redundancy and importance: human modification,
road density, distance to built areas, NDVI, vapour pressure deficit, wind speed, lightning
density, slope and FBP fuel type. All layers were co-registered to a common 25.86 m grid in
BC Albers (EPSG:3005).

LightGBM is the primary learner. Performance was estimated with spatial-block cross-validation
so that nearby training and test points do not leak into one another, and the predicted scores
were calibrated with isotonic regression. Uncertainty is reported two ways: an Area of
Applicability mask, which flags pixels whose predictor values fall outside the range the model
was trained on, and split-conformal prediction at 90% coverage, which flags pixels where the
prediction set retains both outcomes.

Headline results:

| Quantity | Value |
|---|---|
| ROC-AUC, per fold | 0.818 +/- 0.045 |
| AUPRC, per fold | 0.750 +/- 0.179 |
| Expected calibration error, after calibration | 0.062 |
| Frequency ratio, very low class | 0.011 |
| Frequency ratio, very high class | 3.837 |

The five classes are equal-area (quantile) breaks of the score, and the frequency ratios show
that observed ignitions concentrate strongly in the upper classes.

**The score is relative, not an annual probability.** It was trained on a balanced sample of
ignition and non-ignition locations, so it ranks locations against one another on that
sampling base rate. It does not state the chance that a given pixel burns in a given year.
Wildfire record coordinates are approximate, so fine-scale patterns should be read with care.

## 4. Repository structure

```
bc-wildfire/
├── app/
│   ├── app.js                    the complete Earth Engine App source (Code Editor dialect)
│   └── README.md                 how to paste, run and publish the script
├── assets/
│   ├── logo.png / logo.svg       project logo
│   └── thumbnail.png / .svg      app and repository thumbnail
├── docs/
│   ├── asset_upload_guide.md     ingesting the 13 rasters through the Code Editor
│   └── deployment.md             publishing the app and sharing the assets with it
├── tools/
│   └── verify_assets.py          post-upload check of the 13 Earth Engine assets
├── .gitignore
├── CITATION.cff                  machine-readable citation metadata
├── LICENSE                       MIT for code, CC BY-NC 4.0 for content
└── README.md                     this file
```

## 5. How to cite

The manuscript is **in preparation**. Until it appears, cite it as:

> Shahvaran, A. R., Noori, R., Madani, K., Sadegh, M., and AghaKouchak, A. Uncertainty-aware
> wildfire susceptibility for British Columbia: a reproducible machine-learning workflow and
> an interactive Earth Engine tool. Manuscript in preparation.

To cite the tool itself, use [`CITATION.cff`](CITATION.cff), which GitHub renders as a "Cite
this repository" button and which most reference managers can import.

## 6. Licence

This repository is released under two licences:

* **Code**, meaning everything in `app/` and `tools/`: [MIT](LICENSE).
* **Documentation, figures and other content**, meaning `README.md`, `docs/` and `assets/`:
  [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

The Earth Engine assets served by the app are not covered by either licence and are not
redistributed here. Source datasets keep the licences of their original providers.

Copyright 2026 Ali Reza Shahvaran. See [LICENSE](LICENSE) for the full terms.
