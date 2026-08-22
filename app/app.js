/**
 * BC Wildfire Susceptibility Explorer
 *
 * Google Earth Engine App source (Code Editor JavaScript, ui.* client API).
 * Serves the final map products of a wildfire ignition susceptibility study
 * for British Columbia: a calibrated relative susceptibility score (0-1), a
 * five-class quantile map, an Area of Applicability (AoA) mask and a
 * conformal-prediction ambiguity mask.
 *
 * Disclosure boundary (do not relax):
 *   - Predictor rasters are NEVER added as map layers.
 *   - Per-pixel predictor values appear ONLY in the click readout, drawn from
 *     the fixed PREDICTORS allowlist below. Nothing iterates bandNames().
 *   - The transect chart/CSV carries susceptibility and class only.
 *   - Polygon statistics carry no predictor aggregates.
 *
 * Paste this file into the Code Editor and publish with Apps > NEW APP
 * (see README.md alongside this file).
 */

/* ===== 1. CONFIG - every asset ID, palette, name map and limit lives here ===== */

var ASSET_ROOT = 'projects/ee-arshahvaran/assets/wildfire_1/';

var CONFIG = {
  assets: {
    susceptibility: ASSET_ROOT + 'susceptibility_mean',
    susceptibilityClass: ASSET_ROOT + 'susceptibility_class',
    aoaMask: ASSET_ROOT + 'aoa_mask',
    conformal: ASSET_ROOT + 'conformal_ambiguous',
    predGhm: ASSET_ROOT + 'pred_ghm',
    predRoadDensity: ASSET_ROOT + 'pred_road_density',
    predDistBuilt: ASSET_ROOT + 'pred_dist_built',
    predNdvi: ASSET_ROOT + 'pred_ndvi',
    predVpd: ASSET_ROOT + 'pred_vpd',
    predWind: ASSET_ROOT + 'pred_wind',
    predLightning: ASSET_ROOT + 'pred_lightning',
    predSlope: ASSET_ROOT + 'pred_slope',
    predFuelType: ASSET_ROOT + 'pred_fuel_type'
  },
  /* YlOrRd ramp for the continuous 0-1 susceptibility score. */
  continuousPalette: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c',
                      '#fd8d3c', '#fc4e2a', '#e31a1c', '#b10026'],
  /* Five-class palette matching the paper's Fig. 5 (classes 1..5). */
  classPalette: ['#ffffb2', '#fecc5c', '#fd8d3c', '#e31a1c', '#800026'],
  classNames: ['Very low', 'Low', 'Moderate', 'High', 'Very high'],
  classTextColors: ['#333333', '#333333', '#333333', '#ffffff', '#ffffff'],
  /* AoA display matching the paper's Fig. 6b. */
  aoaWithinColor: '#bdbdbd',
  aoaExtrapolationColor: '#8B0000',
  /* FBP fuel code -> name lookup (all 16 codes present in BC). */
  fuelNames: {
    1: 'C-1 Spruce-lichen woodland',
    2: 'C-2 Boreal spruce',
    3: 'C-3 Mature jack or lodgepole pine',
    4: 'C-4 Immature jack or lodgepole pine',
    5: 'C-5 Red and white pine',
    7: 'C-7 Ponderosa pine / Douglas fir',
    11: 'D-1 Leafless aspen',
    13: 'D-1/D-2 Aspen',
    31: 'O-1a Matted grass',
    101: 'Non-fuel',
    102: 'Water',
    105: 'Vegetated non-fuel',
    415: 'M-1 Boreal mixedwood, leafless, 15% conifer',
    625: 'M-1/M-2 Boreal mixedwood, 25% conifer',
    650: 'M-1/M-2 Boreal mixedwood, 50% conifer',
    675: 'M-1/M-2 Boreal mixedwood, 75% conifer'
  },
  nativeScale: 26,        // reduceRegion scale for the 25.86 m product
  // The assets' exact grid. Sampling with this transform reads the identical
  // pixel the source GeoTIFFs hold, byte-faithfully; a rounded scale of 26 m
  // can land one pixel off wherever the surface has a gradient.
  nativeTransform: [25.860966463822098, 0, 34162.95412826538,
                    0, -25.860966463822098, 1736292.499123845],
  minZoom: 4,
  maxZoom: 13,            // ~11 m/px at 55 N: modest overzoom for a 26 m map
  clickDebounceMs: 300,
  transect: {maxPoints: 400, minSpacingM: 26, maxErrorM: 10},
  polygon: {largeAreaKm2: 200000, smallScaleM: 100, largeScaleM: 300,
            maxPixels: 1e9, areaMaxErrorM: 100},
  defaultOpacity: 0.9,
  panelWidth: '400px'
};

/**
 * Fixed allowlist of the nine predictors shown in the click readout.
 * This array is the ONLY enumeration of predictor bands in the app.
 * Each entry: stable band key, display label, formatter (value -> string).
 */
// NOTE: the Code Editor's JavaScript sandbox has no Object.freeze, so this
// allowlist is a plain array. It is still the ONLY place predictor bands are
// enumerated - never iterate bandNames() to build this list.
var PREDICTORS = [
  {key: 'ghm', label: 'Human modification (gHM)', format: function (v) { return v.toFixed(2); }},
  {key: 'road_density', label: 'Road density', format: function (v) { return v.toFixed(2) + ' km/km²'; }},
  {key: 'dist_built', label: 'Distance to built areas', format: function (v) { return (v / 1000).toFixed(2) + ' km'; }},
  {key: 'ndvi', label: 'NDVI', format: function (v) { return v.toFixed(3); }},
  {key: 'vpd', label: 'Vapour pressure deficit', format: function (v) { return v.toFixed(2) + ' kPa'; }},
  {key: 'wind', label: 'Wind speed', format: function (v) { return v.toFixed(1) + ' m/s'; }},
  {key: 'lightning', label: 'Lightning density', format: function (v) { return v.toFixed(2) + ' strokes/km²/yr'; }},
  {key: 'slope', label: 'Slope', format: function (v) { return v.toFixed(1) + '°'; }},
  {key: 'fuel_type', label: 'FBP fuel type', format: function (v) {
    var name = CONFIG.fuelNames[Math.round(v)];
    return name ? name : 'Code ' + Math.round(v);
  }}
];

/*
 * The panel mark as a data URI. ui.Label's imageUrl accepts only data: URIs and
 * gstatic.com icons, so it is inlined rather than linked. It is shipped at its
 * exact display size (107 x 107): a ui.Label's style width CLIPS the image, it
 * does not scale it, so to resize the mark you must regenerate this string at the
 * new size. 107 px is the measured height of the title-and-caption block beside it
 * (2 title lines + 3 caption lines at line-height normal), which is what puts the
 * foot of the mark on the last line of the caption. That block is 107 px tall at
 * every panel content width between 360 and 384 px, so the alignment survives the
 * scrollbar appearing or vanishing. Source: assets/icon.png.
 */
var PANEL_ICON = 'data:image/png;base64,' +
    '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' +
    'QmCC';

var EM_DASH = '—';

/* Shared widget styles. */
var GROUP_BG = '#f5f5f5';   /* the grey of a control group */
var STYLES = {
  title: {fontSize: '21px', fontWeight: 'bold', margin: '0', padding: '0',
          color: '#222222'},
  caption: {fontSize: '15px', color: '#666666', margin: '3px 0 0 0'},
  section: {fontSize: '18px', fontWeight: 'bold', margin: '14px 0 4px 0', color: '#333333'},
  subhead: {fontSize: '17px', fontWeight: 'bold', margin: '12px 0 6px 0'},
  hint: {fontSize: '15px', color: '#666666', margin: '6px 0'},
  note: {fontSize: '14px', color: '#888888', margin: '6px 0'},
  error: {fontSize: '15px', color: '#cc0000', margin: '6px 0'},
  body: {fontSize: '15px', color: '#555555', margin: '6px 0 0 0'},
  /*
   * Control rows. Earth Engine pins select captions and button labels at 11px in
   * its own stylesheet (.goog-flat-menu-button, .jfk-button), and a widget's style
   * dictionary is applied to the widget's root element only, which an inherited
   * font size cannot use to beat a class rule on the child that draws the text.
   * fontSize on a ui.Select or a ui.Button therefore has no effect. A ui.Checkbox
   * draws its label in the root, so every control here is a checkbox instead, and
   * its text is whatever size this says.
   */
  choice: {fontSize: '15px', margin: '3px 0', padding: '0',
           backgroundColor: GROUP_BG},
  group: {backgroundColor: GROUP_BG, border: '1px solid #dcdcdc',
          padding: '5px 8px', margin: '0 0 2px 0', stretch: 'horizontal'}
};

/* ===== 1b. LOADING OVERLAY =====================================================
 * Earth Engine computes a map ID server-side before a single tile is requested,
 * so an app can sit blank for ten seconds or more with no feedback. This shows a
 * card over the map from the moment the script runs and clears it when the map
 * reports that no tiles are still pending.
 *
 * This block is deliberately the FIRST thing the script does. Everything below it
 * touches Earth Engine, and the card must already be on screen before any of that
 * work begins, otherwise it appears only once the map is half drawn.
 *
 * Map.onTileLoaded hands the callback an array with one entry per layer, each the
 * FRACTION of that layer's tiles still outstanding; all zero means everything is
 * drawn. It only starts firing once tiles begin arriving, which is why the card is
 * shown immediately and only ever hidden by the callback, never shown by it.
 *
 * The animated ellipsis is driven by ui.util.setInterval. Note that intervals are
 * cancelled with ui.util.clearTimeout: ui.util.clearInterval does not exist in the
 * Code Editor API and calling it throws.
 */
var loadingLabel = ui.Label('Loading map layers', {
  fontSize: '16px', color: '#333333', margin: '0', padding: '0'
});
var loadingHint = ui.Label('This can take a few seconds on first open.', {
  fontSize: '13px', color: '#777777', margin: '4px 0 0 0', padding: '0'
});
var loadingPanel = ui.Panel({
  widgets: [loadingLabel, loadingHint],
  style: {
    position: 'top-center', padding: '12px 18px', margin: '14px 0 0 0',
    backgroundColor: 'rgba(255, 255, 255, 0.94)', border: '1px solid #d0d0d0'
  }
});
Map.add(loadingPanel);

var loadingDots = 0;
var loadingTimer = ui.util.setInterval(function () {
  loadingDots = (loadingDots + 1) % 4;
  loadingLabel.setValue('Loading map layers' + new Array(loadingDots + 1).join('.'));
}, 400);

/** Tears the overlay down exactly once. */
var loadingDone = false;
function finishLoading() {
  if (loadingDone) return;
  loadingDone = true;
  ui.util.clearTimeout(loadingTimer);   // clears intervals too; clearInterval does not exist
  loadingPanel.style().set('shown', false);
}

Map.onTileLoaded(function (pending) {
  var worst = 0;
  for (var i = 0; i < pending.length; i++) {
    worst = Math.max(worst, pending[i]);
  }
  if (worst === 0) finishLoading();
});

/* Safety net: never leave the card up forever if tiles never report complete. */
ui.util.setTimeout(finishLoading, 45000);

/* ===== 2. DATA - images renamed to stable keys ===== */

/*
 * The province outline is the authoritative BC government boundary, uploaded as a
 * table asset. Two earlier sources were rejected: bc_shapefile_gee is the study-area
 * / raster footprint whose southern bound reaches 47.79 N, so it drew a line across
 * Washington State; and the public GAUL level-1 province is split into two features,
 * whose shared edge printed as a spurious vertical line through the province. The
 * uploaded boundary is a single feature simplified to a 25 m tolerance
 * (309,003 vertices, inside Earth Engine's 1,000,000-vertex ingest limit).
 */
var boundary = ee.FeatureCollection(
    'projects/ee-arshahvaran/assets/wildfire_1/bc_boundary');
var susceptibility = ee.Image(CONFIG.assets.susceptibility).rename('susceptibility');
var suscClass = ee.Image(CONFIG.assets.susceptibilityClass).rename('class');
var aoaMask = ee.Image(CONFIG.assets.aoaMask).rename('aoa');
var conformal = ee.Image(CONFIG.assets.conformal).rename('conformal');

/**
 * The single probe image for the click readout: products plus the nine
 * allowlisted predictors, all renamed to stable keys. One reduceRegion
 * per click reads all values. This image is never added to the map.
 */
var probeImage = ee.Image.cat([
  susceptibility, suscClass, aoaMask, conformal,
  ee.Image(CONFIG.assets.predGhm).rename('ghm'),
  ee.Image(CONFIG.assets.predRoadDensity).rename('road_density'),
  ee.Image(CONFIG.assets.predDistBuilt).rename('dist_built'),
  ee.Image(CONFIG.assets.predNdvi).rename('ndvi'),
  ee.Image(CONFIG.assets.predVpd).rename('vpd'),
  ee.Image(CONFIG.assets.predWind).rename('wind'),
  ee.Image(CONFIG.assets.predLightning).rename('lightning'),
  ee.Image(CONFIG.assets.predSlope).rename('slope'),
  ee.Image(CONFIG.assets.predFuelType).rename('fuel_type')
]);

/** Transect sampling image: susceptibility and class ONLY. */
var transectImage = ee.Image.cat([susceptibility, suscClass]);

/* ===== 3. MAP SETUP - basemap, controls, zoom limits, layers, outline ===== */

/* Subdued road-map style (Google Maps styler array). */
var SUBDUED_STYLE = [
  {elementType: 'geometry', stylers: [{color: '#f5f5f5'}]},
  {elementType: 'labels.text.fill', stylers: [{color: '#616161'}]},
  {elementType: 'labels.text.stroke', stylers: [{color: '#f5f5f5'}]},
  {featureType: 'administrative', elementType: 'geometry.stroke',
   stylers: [{color: '#bdbdbd'}]},
  {featureType: 'poi', stylers: [{visibility: 'off'}]},
  {featureType: 'road', elementType: 'geometry', stylers: [{color: '#ffffff'}]},
  {featureType: 'road', elementType: 'labels.icon', stylers: [{visibility: 'off'}]},
  {featureType: 'transit', stylers: [{visibility: 'off'}]},
  {featureType: 'water', elementType: 'geometry', stylers: [{color: '#cfd8dc'}]}
];

Map.setOptions('Subdued', {Subdued: SUBDUED_STYLE});
Map.setControlVisibility({all: false, zoomControl: true, scaleControl: true});
Map.setLocked(false, CONFIG.minZoom, CONFIG.maxZoom);
Map.style().set('cursor', 'crosshair');
// Centre hard-coded on purpose. Map.centerObject(boundary, 6) has to evaluate the
// boundary's centroid server-side first, measured at 18.6 s for this asset, and the
// map cannot position itself until that returns. These are the coordinates that call
// produced, so the framing is identical and the wait is gone. Zoom 6 fits the province
// with a small margin at a normal viewport width.
Map.setCenter(-124.3685, 54.5610, 6);

/** Display order and definitions of the three product layers. */
var LAYER_KEYS = ['continuous', 'classes', 'aoa'];
var LAYER_DEFS = {
  continuous: {
    label: 'Susceptibility (continuous)',
    image: susceptibility,
    vis: {min: 0, max: 1, palette: CONFIG.continuousPalette}
  },
  classes: {
    label: 'Susceptibility (five classes)',
    image: suscClass,
    vis: {min: 1, max: 5, palette: CONFIG.classPalette}
  },
  aoa: {
    label: 'Area of Applicability',
    image: aoaMask,
    vis: {min: 0, max: 1,
          palette: [CONFIG.aoaExtrapolationColor, CONFIG.aoaWithinColor]}
  }
};

var activeLayerKey = 'continuous';
var mapLayers = {};
LAYER_KEYS.forEach(function (key) {
  var def = LAYER_DEFS[key];
  mapLayers[key] = Map.addLayer(def.image, def.vis, def.label,
                                key === activeLayerKey, CONFIG.defaultOpacity);
});

/* BC outline on top: thin dark stroke, no fill. */
Map.addLayer(
    boundary.style({color: '#333333', width: 1.5, fillColor: '00000000'}),
    {}, 'British Columbia outline');


/* ===== 4. RESULTS PANEL helpers ===== */

var resultsPanel = ui.Panel({style: {margin: '6px 0 0 0', stretch: 'horizontal'}});

/** Replaces the contents of the results panel. */
function setResults(widgets) {
  resultsPanel.clear();
  widgets.forEach(function (w) { resultsPanel.add(w); });
}

/** A red error label. */
function errorLabel(message) {
  return ui.Label(message, STYLES.error);
}

/** A name/value row: name on the left, value right-aligned. */
function row(name, value) {
  return ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    widgets: [
      ui.Label(name, {margin: '3px 0', fontSize: '15px', color: '#555555', stretch: 'horizontal'}),
      ui.Label(value, {margin: '3px 0', fontSize: '15px', textAlign: 'right'})
    ]
  });
}

/** A coloured chip for class index 0..4. */
function classChip(idx, text) {
  return ui.Label(text, {
    backgroundColor: CONFIG.classPalette[idx],
    color: CONFIG.classTextColors[idx],
    padding: '3px 10px', margin: '3px 0', fontSize: '15px'
  });
}

/* ===== 5. INSPECT TOOL - debounced click readout from ONE reduceRegion ===== */

var activeTool = 'inspect';
var inspectRequestId = 0;  // ignores stale asynchronous responses

/** Handles a map click while the inspect tool is active. */
function handleMapClick(coords) {
  if (activeTool !== 'inspect') return;
  inspectRequestId += 1;
  var requestId = inspectRequestId;
  setResults([ui.Label('Reading values...', STYLES.hint)]);
  var point = ee.Geometry.Point([coords.lon, coords.lat]);
  probeImage
      .reduceRegion({reducer: ee.Reducer.first(), geometry: point,
                     crs: 'EPSG:3005', crsTransform: CONFIG.nativeTransform})
      .evaluate(function (values, error) {
        if (requestId !== inspectRequestId || activeTool !== 'inspect') return;
        if (error) {
          setResults([errorLabel('Could not read this pixel: ' + error)]);
          return;
        }
        renderReadout(coords, values);
      });
}

/** Builds the click readout card from evaluated pixel values. */
function renderReadout(coords, values) {
  var noData = !values ||
      (values.susceptibility === null && values['class'] === null &&
       values.aoa === null);
  if (noData) {
    setResults([ui.Label('No data here ' + EM_DASH +
                         ' click inside British Columbia.', STYLES.hint)]);
    return;
  }
  var card = [];
  card.push(ui.Label('Pixel at ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4), STYLES.subhead));
  var s = values.susceptibility;
  card.push(row('Susceptibility', s === null ? EM_DASH : s.toFixed(3)));
  var idx = values['class'] === null ? -1 : Math.round(values['class']) - 1;
  card.push(ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    widgets: [
      ui.Label('Class', {margin: '5px 0 3px 0', fontSize: '15px', color: '#555555', stretch: 'horizontal'}),
      (idx >= 0 && idx < 5) ? classChip(idx, CONFIG.classNames[idx])
                            : ui.Label(EM_DASH, {margin: '5px 0 3px 0', fontSize: '15px'})
    ]
  }));
  if (values.aoa === 1) {
    card.push(ui.Label('Within the Area of Applicability', STYLES.body));
  } else if (values.aoa === 0) {
    card.push(ui.Label(
        'Extrapolation ' + EM_DASH + ' predictor values here are outside the training range',
        {fontSize: '15px', color: CONFIG.aoaExtrapolationColor, margin: '5px 0 0 0'}));
  } else {
    card.push(row('Area of Applicability', EM_DASH));
  }
  if (values.conformal === 0) {
    card.push(ui.Label('Confident: a single outcome survives at 90% coverage', STYLES.body));
  } else if (values.conformal === 1) {
    card.push(ui.Label('Ambiguous: both outcomes retained',
                       {fontSize: '15px', color: '#b26a00', margin: '3px 0 0 0'}));
  } else {
    card.push(row('Conformal prediction', EM_DASH));
  }
  card.push(ui.Label('Predictors at this pixel', STYLES.subhead));
  PREDICTORS.forEach(function (p) {
    var v = values[p.key];
    card.push(row(p.label, (v === null || v === undefined) ? EM_DASH : p.format(v)));
  });
  setResults(card);
}

Map.onClick(ui.util.debounce(handleMapClick, CONFIG.clickDebounceMs));

/* ===== 6. TRANSECT TOOL - line -> capped, evenly spaced samples -> chart ===== */

/**
 * Samples susceptibility and class along a drawn line and charts them.
 * The line is densified with cutLines: spacing = max(26 m, length / 399),
 * which caps the node count at 400 points.
 */
function runTransect(line) {
  setResults([ui.Label('Sampling transect...', STYLES.hint)]);
  var length = ee.Number(line.length(1));
  var spacing = length.divide(CONFIG.transect.maxPoints - 1)
                      .max(CONFIG.transect.minSpacingM);
  var distances = ee.List.sequence(0, length, spacing);
  var segments = ee.List(
      line.cutLines({distances: distances,
                     maxError: CONFIG.transect.maxErrorM}).geometries());
  var samplePoints = ee.FeatureCollection(
      segments.zip(distances).map(function (pair) {
        pair = ee.List(pair);
        return ee.Feature(
            ee.Geometry(pair.get(0)).centroid(CONFIG.transect.maxErrorM),
            {distance_km: ee.Number(pair.get(1)).divide(1000)});
      }));
  var sampled = transectImage.reduceRegions({
    collection: samplePoints,
    reducer: ee.Reducer.first(),
    crs: 'EPSG:3005',
    crsTransform: CONFIG.nativeTransform
  });
  var chart = ui.Chart.feature.byFeature({
        features: sampled, xProperty: 'distance_km',
        yProperties: ['susceptibility', 'class']
      })
      .setChartType('LineChart')
      .setOptions({
        title: 'Susceptibility along transect',
        hAxis: {title: 'Distance (km)'},
        vAxes: {
          0: {title: 'Susceptibility', viewWindow: {min: 0, max: 1}},
          1: {title: 'Class (1-5)', viewWindow: {min: 0, max: 5}, gridlines: {count: 0}}
        },
        series: {
          0: {targetAxisIndex: 0, color: '#e31a1c', lineWidth: 2},
          1: {targetAxisIndex: 1, color: '#9e9e9e', lineWidth: 1, lineDashStyle: [4, 3]}
        },
        focusTarget: 'category',
        interpolateNulls: true,
        legend: {position: 'top'},
        chartArea: {left: 45, right: 45}
      });
  chart.style().set({stretch: 'horizontal', height: '240px'});
  var spacingNote = ui.Label('Computing sample spacing...', STYLES.note);
  setResults([
    chart,
    ui.Label('Use the chart\'s pop-out button to download CSV (susceptibility and class only).',
             STYLES.note),
    spacingNote
  ]);
  ee.Dictionary({spacing_m: spacing, n_points: distances.size()})
      .evaluate(function (d, error) {
        if (error) {
          spacingNote.setValue('Sampling details unavailable: ' + error);
        } else {
          spacingNote.setValue('Sampled ' + d.n_points + ' points at ' + Math.round(d.spacing_m) +
                               ' m spacing (cap: 400 points, minimum spacing 26 m).');
        }
      });
}

/* ===== 7. POLYGON TOOL - area-dependent scale, product statistics only ===== */

/** Computes and renders polygon statistics for the drawn polygon. */
function runPolygonStats(polygon) {
  setResults([ui.Label('Computing polygon statistics...', STYLES.hint)]);
  polygon.area(CONFIG.polygon.areaMaxErrorM).evaluate(function (areaM2, areaError) {
    if (areaError) {
      setResults([errorLabel('Area computation failed: ' + areaError)]);
      return;
    }
    var areaKm2 = areaM2 / 1e6;
    var scale = areaKm2 > CONFIG.polygon.largeAreaKm2 ?
        CONFIG.polygon.largeScaleM : CONFIG.polygon.smallScaleM;

    /** reduceRegion over the polygon at the chosen scale. */
    function reduce(image, reducer) {
      return image.reduceRegion({
        reducer: reducer, geometry: polygon, scale: scale,
        maxPixels: CONFIG.polygon.maxPixels, bestEffort: true
      });
    }
    var meanMedian = ee.Reducer.mean()
        .combine({reducer2: ee.Reducer.median(), sharedInputs: true});
    var confident = ee.Image(1).subtract(conformal).rename('confident');
    var stats = reduce(susceptibility, meanMedian)
        .combine(reduce(ee.Image.cat([aoaMask, confident]), ee.Reducer.mean()))
        .combine(reduce(suscClass, ee.Reducer.frequencyHistogram()));
    stats.evaluate(function (result, error) {
      if (activeTool !== 'polygon') return;
      if (error) {
        setResults([errorLabel('Statistics failed: ' + error)]);
        return;
      }
      renderPolygonStats(result, areaKm2, scale);
    });
  });
}

/** Builds the polygon statistics card from evaluated results. */
function renderPolygonStats(result, areaKm2, scale) {
  var card = [];
  card.push(ui.Label('Polygon statistics', STYLES.subhead));
  card.push(row('Area', areaKm2.toFixed(1) + ' km²'));
  card.push(ui.Label('Statistics at ' + scale + ' m scale (best effort, up to 1e9 pixels).',
                     STYLES.note));
  if (result.susceptibility_mean === null || result.susceptibility_mean === undefined) {
    card.push(ui.Label('The polygon contains no data pixels ' + EM_DASH +
                       ' draw inside British Columbia.', STYLES.hint));
    setResults(card);
    return;
  }
  card.push(row('Susceptibility mean', result.susceptibility_mean.toFixed(3)));
  card.push(row('Susceptibility median',
                result.susceptibility_median === null ? EM_DASH : result.susceptibility_median.toFixed(3)));
  card.push(ui.Label('Class shares', STYLES.subhead));
  var hist = result['class'] || {};
  var counts = [0, 0, 0, 0, 0];
  var total = 0;
  for (var key in hist) {
    if (!hist.hasOwnProperty(key)) continue;
    var cls = Math.round(parseFloat(key));
    if (cls >= 1 && cls <= 5) {
      counts[cls - 1] += hist[key];
      total += hist[key];
    }
  }
  for (var i = 0; i < 5; i++) {
    var pct = total > 0 ? (100 * counts[i] / total).toFixed(1) : '0.0';
    card.push(ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      widgets: [
        classChip(i, CONFIG.classNames[i]),
        ui.Label(pct + '%', {margin: '6px 0 0 10px', fontSize: '15px'})
      ]
    }));
  }
  var aoaPct = (result.aoa === null || result.aoa === undefined) ?
      EM_DASH : (100 * result.aoa).toFixed(1) + '%';
  var confPct = (result.confident === null || result.confident === undefined) ?
      EM_DASH : (100 * result.confident).toFixed(1) + '%';
  card.push(row('Within Area of Applicability', aoaPct));
  card.push(row('Confident (conformal)', confPct));
  setResults(card);
}

/* ===== 8. DRAWING TOOLS + TOOL EXCLUSIVITY ===== */

var drawingTools = Map.drawingTools();
drawingTools.setShown(false);  // toolbar hidden; the app manages drawing

/** Removes every geometry layer from the drawing tools. */
function clearDrawings() {
  var layers = drawingTools.layers();
  while (layers.length() > 0) {
    layers.remove(layers.get(0));
  }
}
clearDrawings();

/** Adds a fresh geometry layer and starts drawing the given shape. */
function startDrawing(shape, color) {
  var layer = ui.Map.GeometryLayer({geometries: null, name: shape, color: color});
  drawingTools.layers().add(layer);
  drawingTools.setShape(shape);
  drawingTools.draw();
}

drawingTools.onDraw(ui.util.debounce(function (geometry) {
  drawingTools.stop();
  if (activeTool === 'transect') {
    runTransect(geometry);
  } else if (activeTool === 'polygon') {
    runPolygonStats(geometry);
  }
}, CONFIG.clickDebounceMs));

var TOOL_HINTS = {
  inspect: 'Click the map to read susceptibility, uncertainty and predictor ' +
           'values at a pixel.',
  transect: 'Draw a line on the map: click to add vertices, double-click to ' +
            'finish. Click the Transect button again for a new line.',
  polygon: 'Draw a polygon on the map: click to add vertices, double-click ' +
           'to close. Click the Polygon button again for a new polygon.'
};
var toolRadio = null;  // radio group, built in section 9

/**
 * Activates one of the mutually exclusive tools. Switching clears the
 * drawn geometries and the results card.
 */
function setActiveTool(name) {
  activeTool = name;
  if (toolRadio) toolRadio.select(name);
  drawingTools.stop();
  clearDrawings();
  setResults([ui.Label(TOOL_HINTS[name], STYLES.hint)]);
  if (name === 'transect') {
    startDrawing('line', '1a73e8');
  } else if (name === 'polygon') {
    startDrawing('polygon', '6a1b9a');
  }
  Map.style().set('cursor', name === 'inspect' ? 'crosshair' : 'hand');
}

/* ===== 9. CONTROL PANEL - layers, opacity, basemap, tools, legend, about ===== */

/**
 * A group of checkboxes driven as radio buttons: exactly one is on, and clicking
 * the one already on leaves it on. Returns the panel to place and a select() that
 * repaints the group without calling back.
 *
 * opts.horizontal lays the rows out in a line; opts.color is the colour of the
 * live row's label.
 */
function radioGroup(options, initial, onSelect, opts) {
  opts = opts || {};
  var boxes = [];
  var lock = false;          // guards the setValue -> onChange loop

  function paint(value) {
    lock = true;
    for (var i = 0; i < options.length; i++) {
      var on = options[i].value === value;
      boxes[i].setValue(on);
      boxes[i].style().set('fontWeight', on ? 'bold' : 'normal');
      boxes[i].style().set('color', on ? (opts.color || '#222222') : '#555555');
    }
    lock = false;
  }

  options.forEach(function (opt) {
    boxes.push(ui.Checkbox({
      label: opt.label,
      value: opt.value === initial,
      onChange: function () { if (!lock) onSelect(opt.value); },
      style: {fontSize: STYLES.choice.fontSize, padding: '0',
              margin: opts.horizontal ? '3px 18px 3px 0' : '3px 0',
              backgroundColor: GROUP_BG}
    }));
  });

  var panel = ui.Panel({
    widgets: boxes,
    layout: opts.horizontal ? ui.Panel.Layout.flow('horizontal')
                            : ui.Panel.Layout.flow('vertical'),
    style: STYLES.group
  });
  paint(initial);
  return {panel: panel, select: paint};
}

/* Layer selector: exactly one product layer visible. */
var layerRadio = radioGroup(
    LAYER_KEYS.map(function (key) {
      return {label: LAYER_DEFS[key].label, value: key};
    }),
    activeLayerKey,
    function (key) { setActiveLayer(key); });

/* Opacity slider bound to whichever layer is active. */
var opacitySlider = ui.Slider({
  min: 0, max: 1, value: CONFIG.defaultOpacity, step: 0.05,
  onChange: function (value) { mapLayers[activeLayerKey].setOpacity(value); },
  /* The slider's read-out is drawn in the widget root, so unlike a select caption
   * it does take the font size it is given. */
  style: {stretch: 'horizontal', margin: '0 0 2px 0', fontSize: '14px'}
});

/* Basemap selector: subdued road style (default), satellite, hybrid. */
function setBasemap(name) {
  if (name === 'Satellite') {
    Map.setOptions('SATELLITE');
  } else if (name === 'Hybrid') {
    Map.setOptions('HYBRID');
  } else {
    Map.setOptions('Subdued', {Subdued: SUBDUED_STYLE});
  }
  basemapRadio.select(name);
}
var basemapRadio = radioGroup(
    ['Subdued road map', 'Satellite', 'Hybrid'].map(function (name) {
      return {label: name, value: name};
    }),
    'Subdued road map', setBasemap);

/* Legend panel, re-rendered for the active layer. */
var legendPanel = ui.Panel({style: {margin: '2px 0 0 0', stretch: 'horizontal'}});

/** A legend row: colour swatch + text. */
function swatchRow(color, text) {
  return ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    widgets: [
      ui.Label('', {backgroundColor: color, padding: '9px', margin: '0 10px 0 0',
                    border: '1px solid #999999'}),
      ui.Label(text, {margin: '3px 0 0 0', fontSize: '15px'})
    ],
    style: {margin: '0 0 3px 0'}
  });
}

/** Rebuilds the legend for the given layer key. */
function renderLegend(key) {
  legendPanel.clear();
  if (key === 'continuous') {
    var ramp = ui.Thumbnail({
      image: ee.Image.pixelLonLat().select('longitude'),
      params: {bbox: [0, 0, 1, 0.1], dimensions: '200x12', format: 'png',
               min: 0, max: 1, palette: CONFIG.continuousPalette},
      style: {stretch: 'horizontal', margin: '2px 0 0 0', maxHeight: '20px'}
    });
    var rampLabels = ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      widgets: [
        ui.Label('0', {margin: '0', fontSize: '14px'}),
        ui.Label('0.5', {margin: '0', fontSize: '14px', textAlign: 'center',
                         stretch: 'horizontal'}),
        ui.Label('1', {margin: '0', fontSize: '14px'})
      ]
    });
    legendPanel.add(ui.Label('Relative susceptibility', STYLES.note));
    legendPanel.add(ramp);
    legendPanel.add(rampLabels);
  } else if (key === 'classes') {
    legendPanel.add(ui.Label('Susceptibility class (quantile, equal-area)',
                             STYLES.note));
    for (var i = 0; i < 5; i++) {
      legendPanel.add(swatchRow(CONFIG.classPalette[i], CONFIG.classNames[i]));
    }
  } else {
    legendPanel.add(ui.Label('Area of Applicability', STYLES.note));
    legendPanel.add(swatchRow(CONFIG.aoaWithinColor, 'Within AoA'));
    legendPanel.add(swatchRow(CONFIG.aoaExtrapolationColor, 'Extrapolation'));
  }
}

/** Shows exactly one product layer and refreshes legend and opacity. */
function setActiveLayer(key) {
  activeLayerKey = key;
  layerRadio.select(key);
  LAYER_KEYS.forEach(function (k) { mapLayers[k].setShown(k === key); });
  mapLayers[key].setOpacity(opacitySlider.getValue());
  renderLegend(key);
}

/*
 * Tool buttons (mutually exclusive; active one is highlighted).
 * The glyphs are plain geometric unicode (circled plus, diagonal line, white
 * diamond), not emoji, so every browser renders them as text at label weight.
 */
toolRadio = radioGroup(
    [{label: '⊕ Inspect', value: 'inspect'},
     {label: '╱ Transect', value: 'transect'},
     {label: '◇ Polygon', value: 'polygon'}],
    activeTool, setActiveTool, {horizontal: true, color: '#e31a1c'});

/* About section: collapsed until the reader asks for it. */
var REPO_URL = 'https://github.com/arshahvaran/bc-wildfire';
var ABOUT_TEXT_STYLE = {fontSize: '14px', color: '#555555', margin: '0 0 8px 0'};
var ABOUT_LINK_STYLE = {fontSize: '14px', color: '#1a73e8', margin: '0 0 8px 0'};
var ABOUT_PARAGRAPHS = [
  'The score is a calibrated relative susceptibility. The model was trained on a 1:1 ' +
      'sample of ignition and non-ignition locations, so the score ranks likelihood on ' +
      'that sampling base rate. It is not an annual ignition probability.',
  'Wildfire record coordinates are approximate. Interpret fine-scale patterns with care.',
  'The five classes are quantile (equal-area) breaks of the score.',
  'The Area of Applicability flags pixels whose predictor values fall outside the ' +
      'training range.',
  'This app serves the final map products only and does not distribute the input ' +
      'rasters. Predictor values are shown for a clicked pixel only.'
];
var aboutWidgets = [];   /* the toggle button below is the heading */
ABOUT_PARAGRAPHS.forEach(function (text) {
  aboutWidgets.push(ui.Label(text, ABOUT_TEXT_STYLE));
});
aboutWidgets.push(ui.Label('Source, licence and citation:',
                           {fontSize: '14px', color: '#555555', margin: '0 0 4px 0'}));
/* ui.Label takes (text, style, url); the third argument makes it a link. */
aboutWidgets.push(ui.Label(REPO_URL, ABOUT_LINK_STYLE, REPO_URL));
var aboutPanel = ui.Panel({
  widgets: aboutWidgets,
  style: {shown: false, margin: '4px 0 4px 0', stretch: 'horizontal'}
});
var aboutToggle = ui.Checkbox({
  label: 'About this app',
  value: false,
  onChange: function (checked) { aboutPanel.style().set('shown', checked); },
  style: {fontSize: '16px', fontWeight: 'bold', color: '#333333',
          margin: '0', padding: '0', backgroundColor: GROUP_BG}
});
var aboutBox = ui.Panel({
  widgets: [aboutToggle],
  style: {backgroundColor: GROUP_BG, border: '1px solid #dcdcdc',
          padding: '5px 8px', margin: '14px 0 0 0', stretch: 'horizontal'}
});

/*
 * Assemble the left panel. Everything sits in a column of fixed width: the panel
 * scrolls, and a scrollbar takes its width from the inside, so without this the
 * whole panel re-flowed - every control changing width - the moment About was
 * opened. 364 px clears the widest scrollbar a 400 px panel can show.
 */
var contentPanel = ui.Panel({
  widgets: [
    /* Header: the mark on the left, title and caption stacked to its right, so
     * the caption starts at the title's left edge rather than the panel's. */
    ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      widgets: [
        ui.Label({value: '', imageUrl: PANEL_ICON,
                  style: {width: '107px', height: '107px',
                          margin: '0 12px 0 0', padding: '0'}}),
        ui.Panel({
          widgets: [
            ui.Label('BC Wildfire Susceptibility Explorer', STYLES.title),
            ui.Label('Calibrated wildfire susceptibility for British Columbia, ' +
                     'with per-pixel uncertainty.', STYLES.caption)
          ],
          style: {margin: '0', padding: '0', stretch: 'horizontal'}
        })
      ],
      style: {margin: '0 0 4px 0', padding: '0', stretch: 'horizontal'}
    }),
    ui.Label('Layer', STYLES.section),
    layerRadio.panel,
    ui.Label('Opacity', STYLES.note),
    opacitySlider,
    ui.Label('Basemap', STYLES.section),
    basemapRadio.panel,
    ui.Label('Legend', STYLES.section),
    legendPanel,
    ui.Label('Tools', STYLES.section),
    toolRadio.panel,
    resultsPanel,
    aboutBox,
    aboutPanel
  ],
  style: {width: '364px', margin: '0', padding: '0'}
});
var controlPanel = ui.Panel({
  widgets: [contentPanel],
  style: {width: CONFIG.panelWidth, padding: '8px'}
});
ui.root.insert(0, controlPanel);

/* ===== 10. INIT ===== */

renderLegend(activeLayerKey);
setActiveTool('inspect');
