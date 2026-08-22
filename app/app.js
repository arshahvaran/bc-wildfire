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
 * Panel logo as a data URI. ui.Label's imageUrl accepts only data: URIs and
 * gstatic.com icons, so the mark is inlined rather than linked. Rendered at
 * 736 x 92 for a 2x display at the panel's 368 px content width; the source
 * is assets/logo_panel.png in this repository.
 */
var PANEL_LOGO = 'data:image/png;base64,' +
    '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' +
    'P69zi2LB8OkAAAAASUVORK5CYII=';

var EM_DASH = '—';

/* Shared widget styles. */
var STYLES = {
  title: {fontSize: '24px', fontWeight: 'bold', margin: '0 0 4px 0'},
  caption: {fontSize: '15px', color: '#666666', margin: '0 0 12px 0'},
  section: {fontSize: '18px', fontWeight: 'bold', margin: '14px 0 4px 0', color: '#333333'},
  subhead: {fontSize: '17px', fontWeight: 'bold', margin: '12px 0 6px 0'},
  hint: {fontSize: '15px', color: '#666666', margin: '6px 0'},
  note: {fontSize: '14px', color: '#888888', margin: '6px 0'},
  error: {fontSize: '15px', color: '#cc0000', margin: '6px 0'},
  body: {fontSize: '15px', color: '#555555', margin: '6px 0 0 0'}
};

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
// Zoom 5 fills the map with the province: BC spans 25 degrees of longitude and
// 11.7 of latitude, about 560 x 455 px at zoom 5, so the outline sits inside a
// normal viewport with a small margin. Zoom 6 would crop the north and east.
Map.centerObject(boundary, 6);

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

/* ===== 3b. LOADING OVERLAY =====================================================
 * Earth Engine computes a map ID server-side before a single tile is requested,
 * so an app can sit blank for ten seconds or more with no feedback. This shows a
 * card over the map from the moment the script runs and clears it when the map
 * reports that no tiles are still pending.
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
  style: {stretch: 'horizontal'}
});

/* Opacity slider bound to whichever layer is active. */
var opacitySlider = ui.Slider({
  min: 0, max: 1, value: CONFIG.defaultOpacity, step: 0.05,
  onChange: function (value) { mapLayers[activeLayerKey].setOpacity(value); },
  style: {stretch: 'horizontal'}
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
  style: {stretch: 'horizontal'}
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
  style: {margin: '0', stretch: 'horizontal'}
});
toolButtons.transect = ui.Button({
  label: '╱ Transect', onClick: function () { setActiveTool('transect'); },
  style: {margin: '0', stretch: 'horizontal'}
});
toolButtons.polygon = ui.Button({
  label: '◇ Polygon', onClick: function () { setActiveTool('polygon'); },
  style: {margin: '0', stretch: 'horizontal'}
});

/* About section: always visible, no toggle. */
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
var aboutWidgets = [ui.Label('About this app', STYLES.section)];
ABOUT_PARAGRAPHS.forEach(function (text) {
  aboutWidgets.push(ui.Label(text, ABOUT_TEXT_STYLE));
});
aboutWidgets.push(ui.Label('Source, licence and citation:',
                           {fontSize: '14px', color: '#555555', margin: '0 0 4px 0'}));
/* ui.Label takes (text, style, url); the third argument makes it a link. */
aboutWidgets.push(ui.Label(REPO_URL, ABOUT_LINK_STYLE, REPO_URL));
var aboutPanel = ui.Panel({
  widgets: aboutWidgets,
  style: {margin: '8px 0 4px 0', stretch: 'horizontal'}
});

/* Assemble the left control panel (~340 px). */
var controlPanel = ui.Panel({
  widgets: [
    ui.Label({value: 'BC Wildfire Susceptibility Explorer',
              imageUrl: PANEL_LOGO,
              style: {margin: '0 0 2px 0', padding: '0', width: '368px'}}),
    ui.Label('Calibrated wildfire susceptibility for British Columbia, ' +
             'with per-pixel uncertainty.', STYLES.caption),
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
    aboutPanel
  ],
  style: {width: CONFIG.panelWidth, padding: '8px'}
});
ui.root.insert(0, controlPanel);

/* ===== 10. INIT ===== */

renderLegend(activeLayerKey);
setActiveTool('inspect');
