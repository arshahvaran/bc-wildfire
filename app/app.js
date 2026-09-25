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
 * Paste this file into the Code Editor script users/arshahvaran/wildfire_app:app,
 * save it, and publish with Apps > bc-wildfire > Update app.
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
  {key: 'ghm', label: 'Human modification (gHM)', format: function (v) { return v.toFixed(3); }},
  {key: 'road_density', label: 'Road density', format: function (v) { return v.toFixed(2) + ' km/km²'; }},
  {key: 'dist_built', label: 'Distance to built-up land', format: function (v) { return (v / 1000).toFixed(2) + ' km'; }},
  {key: 'ndvi', label: 'NDVI', format: function (v) { return v.toFixed(3); }},
  {key: 'vpd', label: 'Max vapor pressure deficit', format: function (v) { return v.toFixed(2) + ' kPa'; }},
  {key: 'wind', label: 'Max wind speed', format: function (v) { return v.toFixed(1) + ' m/s'; }},
  {key: 'lightning', label: 'Lightning stroke density', format: function (v) { return v.toFixed(3) + ' strokes/km²/yr'; }},
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
 * scrollbar appearing or vanishing. Source: assets/logo.png.
 */
var PANEL_ICON = 'data:image/png;base64,' +
    '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';

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

/*
 * The transect chart's columns, with their types declared rather than inferred.
 * ui.Chart types a column from its first non-null value and falls back to "string"
 * for a column that holds no values at all, and Google Charts then refuses to draw
 * it: "Data column(s) for axis #0 cannot be of type string". A line drawn entirely
 * over water, over a gap in the data, or outside the province produces exactly that
 * empty column, which is why the error came and went. Declaring the types here
 * makes it impossible.
 */
var TRANSECT_COLUMNS = [
  {label: 'Distance (km)', type: 'number'},
  {label: 'Susceptibility', type: 'number'},
  {label: 'Class', type: 'number'}
];

/**
 * A finite number, or null. Earth Engine serialises NaN and Infinity as the
 * strings "NaN" and "Infinity", and one of those in a column would type the whole
 * column as text in the same way a missing value does.
 */
function finiteOrNull(value) {
  return (typeof value === 'number' && isFinite(value)) ? value : null;
}

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
        'Extrapolation ' + EM_DASH + ' predictor values here are too dissimilar from the training data',
        {fontSize: '15px', color: CONFIG.aoaExtrapolationColor, margin: '5px 0 0 0'}));
  } else {
    card.push(row('Area of Applicability', EM_DASH));
  }
  if (values.conformal === 0) {
    card.push(ui.Label('Confident: a single outcome at the 90% coverage target', STYLES.body));
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
  sampled.evaluate(function (fc, error) {
    if (error) {
      setResults([errorLabel('Transect sampling failed: ' + error)]);
      return;
    }
    var feats = (fc && fc.features) || [];
    var rows = [];
    var withData = 0;
    for (var i = 0; i < feats.length; i++) {
      var props = feats[i].properties || {};
      var km = finiteOrNull(props.distance_km);
      if (km === null) continue;               // no distance, nothing to plot against
      var value = finiteOrNull(props.susceptibility);
      var klass = finiteOrNull(props['class']);
      if (value !== null || klass !== null) withData++;
      rows.push([km, value, klass]);
    }
    if (rows.length < 2) {
      setResults([ui.Label('That line is shorter than one 26 m pixel. Draw a longer one.',
                           STYLES.hint)]);
      return;
    }
    if (withData === 0) {
      setResults([ui.Label(
          'Nothing to chart: no mapped pixel lies under that line. The surface covers ' +
          'land inside British Columbia, so a line drawn over water, over a gap in the ' +
          'data or outside the province has no values to read.', STYLES.hint)]);
      return;
    }
    var chart = ui.Chart({
      dataTable: [TRANSECT_COLUMNS].concat(rows),
      chartType: 'LineChart',
      options: {
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
      }
    });
    chart.style().set({stretch: 'horizontal', height: '240px'});
    /* Spacing comes from the rows themselves, so the note costs no second call. */
    var spacingM = Math.round((rows[1][0] - rows[0][0]) * 1000);
    var gaps = rows.length - withData;
    var widgets = [
      chart,
      ui.Label('Use the chart\'s pop-out button to download CSV (susceptibility and ' +
               'class only).', STYLES.note),
      ui.Label('Sampled ' + rows.length + ' points at ' + spacingM + ' m spacing (cap: ' +
               CONFIG.transect.maxPoints + ' points, minimum spacing ' +
               CONFIG.transect.minSpacingM + ' m).', STYLES.note)
    ];
    if (gaps > 0) {
      widgets.push(ui.Label(
          gaps === 1 ? 'One of them falls outside the mapped surface and is drawn as a gap.'
                     : gaps + ' of them fall outside the mapped surface and are drawn as gaps.',
          STYLES.note));
    }
    setResults(widgets);
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
  'The Area of Applicability flags pixels whose predictor values are too dissimilar from the ' +
      'training data.',
  'This app serves the final map products only and does not distribute the input ' +
      'rasters. Predictor values are shown for a clicked pixel only. A dash means the ' +
      'layer has no value there; the model used the nearest valid value from a 259 m copy.'
];
var aboutWidgets = [];   /* the toggle button below is the heading */
ABOUT_PARAGRAPHS.forEach(function (text) {
  aboutWidgets.push(ui.Label(text, ABOUT_TEXT_STYLE));
});
aboutWidgets.push(ui.Label('Source, license and citation:',
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
