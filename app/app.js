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
    'ir4Txwbi9gAAAABJRU5ErkJggg==';

var EM_DASH = '—';

/* Shared widget styles. */
var STYLES = {
  title: {fontSize: '21px', fontWeight: 'bold', margin: '0', padding: '0',
          color: '#222222'},
  caption: {fontSize: '15px', color: '#666666', margin: '3px 0 0 0'},
  section: {fontSize: '18px', fontWeight: 'bold', margin: '14px 0 4px 0', color: '#333333'},
  subhead: {fontSize: '17px', fontWeight: 'bold', margin: '12px 0 6px 0'},
  hint: {fontSize: '15px', color: '#666666', margin: '6px 0'},
  note: {fontSize: '14px', color: '#888888', margin: '6px 0'},
  error: {fontSize: '15px', color: '#cc0000', margin: '6px 0'},
  body: {fontSize: '15px', color: '#555555', margin: '6px 0 0 0'}
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
var TOOL_ACTIVE_STYLE = {border: '2px solid #e31a1c', fontWeight: 'bold'};
var TOOL_INACTIVE_STYLE = {border: '1px solid #cccccc', fontWeight: 'normal'};
var toolButtons = {};  // key -> ui.Button, filled in section 9

/**
 * Activates one of the mutually exclusive tools. Switching clears the
 * drawn geometries and the results card.
 */
function setActiveTool(name) {
  activeTool = name;
  for (var key in toolButtons) {
    if (!toolButtons.hasOwnProperty(key)) continue;
    toolButtons[key].style().set(
        key === name ? TOOL_ACTIVE_STYLE : TOOL_INACTIVE_STYLE);
  }
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

/* Layer selector (radio-style: exactly one product layer visible). */
var layerSelect = ui.Select({
  items: LAYER_KEYS.map(function (key) {
    return {label: LAYER_DEFS[key].label, value: key};
  }),
  value: activeLayerKey,
  onChange: function (key) { setActiveLayer(key); },
  /* Every ui.Widget is born with margin: 8px on all four sides, which is what held
   * the selects and the slider in from the legend and the tool buttons. Zeroing the
   * sides puts their edges on the panel's content edges, where everything else is. */
  style: {stretch: 'horizontal', margin: '0 0 2px 0'}
});

/* Opacity slider bound to whichever layer is active. */
var opacitySlider = ui.Slider({
  min: 0, max: 1, value: CONFIG.defaultOpacity, step: 0.05,
  onChange: function (value) { mapLayers[activeLayerKey].setOpacity(value); },
  style: {stretch: 'horizontal', margin: '0 0 2px 0'}
});

/* Basemap selector: subdued road style (default), satellite, hybrid. */
var basemapSelect = ui.Select({
  items: ['Subdued road map', 'Satellite', 'Hybrid'],
  value: 'Subdued road map',
  onChange: function (name) {
    if (name === 'Satellite') {
      Map.setOptions('SATELLITE');
    } else if (name === 'Hybrid') {
      Map.setOptions('HYBRID');
    } else {
      Map.setOptions('Subdued', {Subdued: SUBDUED_STYLE});
    }
  },
  style: {stretch: 'horizontal', margin: '0 0 2px 0'}
});

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
  LAYER_KEYS.forEach(function (k) { mapLayers[k].setShown(k === key); });
  mapLayers[key].setOpacity(opacitySlider.getValue());
  renderLegend(key);
}

/*
 * Tool buttons (mutually exclusive; active one is highlighted).
 * The glyphs are plain geometric unicode (circled plus, diagonal line, white
 * diamond), not emoji, so every browser renders them as text at label weight.
 */
toolButtons.inspect = ui.Button({
  label: '⊕ Inspect', onClick: function () { setActiveTool('inspect'); },
  style: {margin: '0 6px 0 0', stretch: 'horizontal'}
});
toolButtons.transect = ui.Button({
  label: '╱ Transect', onClick: function () { setActiveTool('transect'); },
  style: {margin: '0 6px 0 0', stretch: 'horizontal'}
});
toolButtons.polygon = ui.Button({
  label: '◇ Polygon', onClick: function () { setActiveTool('polygon'); },
  style: {margin: '0', stretch: 'horizontal'}
});

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
var aboutOpen = false;
var aboutToggle = ui.Button({
  label: 'About this app  ▸',
  onClick: function () {
    aboutOpen = !aboutOpen;
    aboutPanel.style().set('shown', aboutOpen);
    aboutToggle.setLabel(aboutOpen ? 'About this app  ▾' : 'About this app  ▸');
  },
  style: {margin: '14px 0 0 0', stretch: 'horizontal'}
});

/* Assemble the left control panel (~340 px). */
var controlPanel = ui.Panel({
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
    layerSelect,
    ui.Label('Opacity', STYLES.note),
    opacitySlider,
    ui.Label('Basemap', STYLES.section),
    basemapSelect,
    ui.Label('Legend', STYLES.section),
    legendPanel,
    ui.Label('Tools', STYLES.section),
    ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      widgets: [toolButtons.inspect, toolButtons.transect, toolButtons.polygon],
      style: {stretch: 'horizontal', margin: '0'}
    }),
    resultsPanel,
    aboutToggle,
    aboutPanel
  ],
  style: {width: CONFIG.panelWidth, padding: '8px'}
});
ui.root.insert(0, controlPanel);

/* ===== 10. INIT ===== */

renderLegend(activeLayerKey);
setActiveTool('inspect');
