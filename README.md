# BC Wildfire Susceptibility Explorer

[![Live app](https://img.shields.io/badge/Live%20app-Earth%20Engine-4285F4)](https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire)
[![Version](https://img.shields.io/badge/version-1.0-informational)](https://github.com/arshahvaran/bc-wildfire/tags)
[![CC BY-NC 4.0][cc-by-nc-shield]][cc-by-nc]

**An Earth Engine app for reading calibrated, uncertainty-aware wildfire ignition
susceptibility maps of British Columbia.**

**Live app:** https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire

The app accompanies a study that maps wildfire ignition susceptibility across British
Columbia from nine physical, climatic and human predictors, and that reports where the
model applies as well as what it predicts: a calibrated relative susceptibility score, a
five-class equal-area version of that score, and an Area of Applicability mask.

It serves the finished map products only. **The predictor rasters are not distributed**;
their values are shown for a clicked pixel and nowhere else.

## Contents

- [Key features](#key-features)
- [Map products](#map-products)
- [Getting started](#getting-started)
- [How to cite](#how-to-cite)
- [License](#license)

## Key features

**Layers.** One product on the map at a time, with an opacity slider and a choice of
basemap.

**Click readout.** Susceptibility, class, applicability and conformal ambiguity at the
clicked pixel, then all nine predictor values in their own units.

**Transect.** Draw a line and read susceptibility and class along it as a chart.

**Polygon.** Draw a polygon and get its area, mean and percentile susceptibility, and the
class breakdown inside it.

## Map products

| Layer | What it shows |
| --- | --- |
| Susceptibility (continuous) | calibrated relative score, 0 to 1 |
| Susceptibility (five classes) | quantile, equal-area classes of that score |
| Area of Applicability | pixels whose predictors fall outside the training range |

Province-wide, 25.9 m pixels, EPSG:3005.

## Getting started

Open the live app. Nothing to install, no Earth Engine account, no sign-in.

To run the source yourself, paste [`app/app.js`](app/app.js) into the
[Code Editor](https://code.earthengine.google.com) and press Run: one self-contained
script, no build step. Ingesting the rasters is covered in
[`docs/asset_upload_guide.md`](docs/asset_upload_guide.md) and publishing in
[`docs/deployment.md`](docs/deployment.md).

## How to cite

*Reference paper will be added here once published.*

For the tool itself, use [`CITATION.cff`](CITATION.cff), which GitHub renders as a "Cite
this repository" button.

## License

Code (`app/`, `tools/`) is [MIT](LICENSE); documentation, figures and other content are
[CC BY-NC 4.0][cc-by-nc]. The Earth Engine assets are not redistributed here, and the
source datasets keep their providers' licences.

[![CC BY-NC 4.0][cc-by-nc-image]][cc-by-nc]

[cc-by-nc]: https://creativecommons.org/licenses/by-nc/4.0/
[cc-by-nc-image]: https://licensebuttons.net/l/by-nc/4.0/88x31.png
[cc-by-nc-shield]: https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg
