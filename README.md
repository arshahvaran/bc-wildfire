# wildfire_1

Code and interactive tool for:

**Calibrated, uncertainty-aware wildfire susceptibility for British Columbia: a
reproducible machine-learning workflow and an interactive Earth Engine tool**

Ali Reza Shahvaran, Roohollah Noori, Mojtaba Sadegh, Amir AghaKouchak

## Status

Under construction. The interactive Google Earth Engine application is being built in
`app/`; repository structure and a code release accompanying the manuscript will follow.

## The application

A Google Earth Engine App serving the finished map products for British Columbia:
the calibrated wildfire susceptibility surface (0-1), the five-class product, and the
per-pixel uncertainty layers (Area of Applicability, split-conformal confidence).
Clicking a point returns the susceptibility value and the values of the nine modelling
predictors at that pixel. The app serves map products only; the input rasters are not
distributed.

## Licence

To be determined (see the manuscript's data and software availability statement).

## Repository layout

    app/    the Earth Engine App source (paste app/app.js into the Code Editor)
    docs/   asset_upload_guide.md - step-by-step raster ingestion instructions
    tools/  verify_assets.py - post-upload verification (run from the gee-env conda env)
