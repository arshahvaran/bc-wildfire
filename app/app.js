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
    ui.Label('BC Wildfire Susceptibility Explorer', STYLES.title),
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
