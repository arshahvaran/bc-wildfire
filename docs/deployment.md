# Publishing and updating the app

How the BC Wildfire Susceptibility Explorer was published as an Earth Engine App, and what to
repeat when the script or the assets change.

Read [asset_upload_guide.md](asset_upload_guide.md) first: the 13 rasters must already be
ingested under `projects/ee-arshahvaran/assets/wildfire_1`, and `tools/verify_assets.py` must
pass, before there is anything to publish.

The single hard part is section 4. Sharing the **folder** with the app does **not** share the
images inside it, and an app that cannot read its assets fails for every visitor while looking
fine to you as the owner.

## 1. Save the script in the Code Editor

An Earth Engine App is published from a saved script, never from unsaved editor contents.

1. Open <https://code.earthengine.google.com> with the account that owns the `ee-arshahvaran`
   Cloud project.
2. In the **Scripts** tab, create the script (NEW > File) if it does not exist, for example
   `wildfire_1/app`.
3. Paste the whole of `app/app.js` into the editor.
4. Click **Save**. Click **Run** and confirm the panel, the three layers, a click readout, a
   transect and a polygon all work. Whatever is saved now is exactly what the app will serve.

## 2. Create the app: Apps > NEW APP

Click **Apps** in the Code Editor toolbar, then **NEW APP**. The dialog has four steps.

**Step 1, choose the source.** Pick the saved script from step 1. Earth Engine publishes a
snapshot of the script, so the live app does not change when you later edit the script in the
editor; you must republish (section 5).

**Step 2, name the app.** The app name sets the URL. The name entered here is slugified into

    https://ee-arshahvaran.projects.earthengine.app/view/<app-name>

so the name is a public, quotable identifier, not a label. An app's URL cannot be edited after
creation: changing it means publishing a new app and deleting the old one, which is how this app
arrived at its address:

    https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire

Set the display title to **BC Wildfire Susceptibility Explorer**, which is the name used in
the app panel, the repository and the paper.

**Step 3, choose the Google Cloud project.** Select `ee-arshahvaran`. This is the project that
is billed for the app's Earth Engine usage and the project that owns the app's service
account, so it must be the project that owns the assets as well.

**Step 4, set access and appearance.** Leave the app readable by anyone with the link, which
is what makes it citable from the paper. Add the description and, for the thumbnail,
`assets/logo.png` - the square mark, which is the same file the app draws in its panel.
Do **not** tick any option that makes the underlying assets public: the app needs read
access, the world does not.

Click **PUBLISH**. Provisioning takes a few minutes, after which the app URL resolves.

## 3. Check the app as a stranger would

Open the app URL in a private browsing window, or in a browser signed in to a different Google
account. This is not optional. As the asset owner your own session can read the rasters
whether or not the app can, so the owner's view proves nothing.

If layers stay blank, the tiles fail, or the click readout returns errors for every pixel, the
cause is almost always section 4.

## 4. Share every asset with the app's service account

When an app is published, Earth Engine creates a service account for it. For this app it is:

    serviceAccount:wildfire-s-bility-bc-f8ca58e4f@ee-arshahvaran.iam.gserviceaccount.com

The service account identifier is derived from the app name at creation time, so confirm the
exact string in the app's own sharing dialog (Apps > the app > share, or the asset sharing
prompt shown at publish time) before using it. If you create a second app, or if renaming this
one produces a different identifier, re-run the script below with the new value.

**The gotcha.** Sharing the `wildfire_1` **folder** with the service account does not cascade
to the images already inside it. Folder sharing in Earth Engine sets an access control list on
the folder object; the 13 images that were ingested into it keep the access control lists they
were created with. The Assets tab shows the folder as shared and gives no warning at all, and
the app still fails. Each of the 13 images must be shared individually.

Doing that by hand is 13 right-click, share, paste, save cycles with no confirmation that you
covered them all. The script below does it in one pass.

### The one-pass sharing script

Run it from the same conda environment used for `tools/verify_assets.py`:

```python
"""Share every wildfire_1 asset with the published app's service account."""

import ee

ee.Initialize(project="ee-arshahvaran")

SERVICE_ACCOUNT = (
    "serviceAccount:wildfire-s-bility-bc-f8ca58e4f@ee-arshahvaran.iam.gserviceaccount.com"
)

FOLDER = "projects/ee-arshahvaran/assets/wildfire_1"

ASSET_NAMES = [
    "susceptibility_mean",
    "susceptibility_class",
    "aoa_mask",
    "conformal_ambiguous",
    "pred_ghm",
    "pred_road_density",
    "pred_dist_built",
    "pred_ndvi",
    "pred_vpd",
    "pred_wind",
    "pred_lightning",
    "pred_slope",
    "pred_fuel_type",
]

# The 13 images, plus the boundary table the app also reads, plus the folder
# itself so the Assets tab agrees with reality.
ASSET_IDS = (
    [FOLDER]
    + [FOLDER + "/" + name for name in ASSET_NAMES]
    + ["projects/ee-arshahvaran/assets/wildfire_1/bc_boundary"]
)

for asset_id in ASSET_IDS:
    acl = ee.data.getAssetAcl(asset_id)
    readers = list(acl.get("readers", []))
    if SERVICE_ACCOUNT in readers:
        print("already shared:", asset_id)
        continue
    readers.append(SERVICE_ACCOUNT)
    update = {
        "readers": readers,
        "writers": list(acl.get("writers", [])),
        # Must stay False. True would make the rasters world-readable.
        "all_users_can_read": False,
    }
    owners = acl.get("owners")
    if owners:
        update["owners"] = list(owners)
    ee.data.setAssetAcl(asset_id, update)
    print("shared:", asset_id)

print("done:", len(ASSET_IDS), "assets processed")
```

Notes on the script:

* `all_users_can_read` must stay `False`. Setting it to `True` publishes the rasters to the
  whole internet, which is exactly what this project does not do: the app serves finished map
  products, and the underlying rasters are not distributed. The app works perfectly well with
  the service account as the only added reader.
* The script reads the existing access control list and appends, so it does not remove readers
  you added earlier and is safe to run again. Running it twice prints `already shared` and
  changes nothing.
* `owners` is only sent back when Earth Engine returned one. For project-owned assets the
  owner list is managed by the Cloud project, and passing it can be rejected; if you see an
  error mentioning owners, drop that key and retry.
* If `ee.data.setAssetAcl` rejects a dictionary in your version of the client library, wrap it
  with `json.dumps(update)`.
* The boundary table `wildfire_1/bc_boundary` is easy to forget. Without it the app draws no
  provincial outline and `Map.centerObject` fails.
* EVERY app has its own service account, created with the app. Deleting an app and publishing a
  replacement produces a NEW identity, and the old grants become dead references, so every asset
  must be re-granted. Read the current identity off the folder rather than assuming it:
  `ee.data.getAssetAcl(FOLDER)["readers"]`. This app's identity is
  `serviceAccount:bc-wildfire-fd3828b3ed657418f2@ee-arshahvaran.iam.gserviceaccount.com`.

After running the script, re-check the app in a private browsing window (section 3).

## 5. Updating the app later

* **Script changed.** Save the script in the Code Editor, then Apps > the app > **UPDATE**, so
  the app takes a fresh snapshot. Editing and saving the script alone does not change the live
  app.
* **An asset was re-uploaded.** A deleted and re-ingested asset is a new object with a new
  access control list, so it is no longer shared with the app even though the name is
  unchanged. Re-run the sharing script and re-run `tools/verify_assets.py`.
* **The app was renamed.** The URL changes with the name. Update the URL in `README.md`,
  `app/README.md`, `CITATION.cff` and the manuscript, keep a note of the old address, and
  confirm the service account identifier in the sharing dialog before assuming the old one
  still applies.
* **Nothing is served from the local disk.** `E:\publications\wildfire_1\data` is the source of
  the ingested rasters only. The published app reads Earth Engine assets, so the local files
  can move without affecting the live app.

## First-paint time

Two things decide how long the app looks blank.

The first is `Map.centerObject`. It evaluates the object's centroid on the server before
the map can position itself, measured at **18.6 s** for the BC boundary, during which the
app shows nothing useful. The app therefore calls `Map.setCenter` with the coordinates that
call returned. Any fixed extent should be hard-coded the same way; reserve `centerObject`
for geometry that is not known until run time.

The second is the loading card, which must be created before any Earth Engine call, not
after `Map.addLayer`. It is section 1b of `app/app.js` for that reason. Nothing can be shown
earlier than that: until the Code Editor sandbox has loaded and run the script, the page is
Earth Engine's own shell and no app code has executed.

## Header logo and the browser tab title

Two pieces of app chrome behave in ways worth recording.

**The header logo** replaces the "Google Earth Engine Apps" wordmark in the top-left of
the header bar; the wordmark then moves to the right-hand side. It is stored as app
configuration, not in the script, and it is set on the last step of the publish wizard
("Publication and Viewers" > LOGO tab). Uploading the image into the well does NOT save
it: the wizard must be carried through to the final PUBLISH or UPDATE button, or the
configuration is never written. Earth Engine copies the file to its own image service at
publish time rather than linking yours. RGBA PNG with transparency works and is displayed
at exactly 50 px tall, clipped beyond about 400 px wide, so keep the artwork close to 8:1.
`assets/logo_earthengine.png` is cut to those proportions; `assets/logo.png` is the square
mark with no text and belongs in the thumbnail field, not here.

Both are also kept as SVG, which is the source both PNGs are rendered from. Upload the
PNGs: the wizard's image fields take raster formats, and Earth Engine's own URL sanitiser
refuses `data:image/svg+xml` (its allowed list is bmp, gif, jpeg, png, tiff, webp, ico,
heic, heif, avif), which is why the panel mark inside `app.js` is an inlined PNG too.

To check whether a logo is actually stored, fetch the app page and look at the header
markup rather than trusting the browser, which caches the image for a day:

    curl -s https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire | grep -o 'id="logo"[^>]*'

An app with a logo renders `id="logo" class="appLogo"` and an `lh3.googleusercontent.com`
image source. An app without one renders a bare `id="logo"` wrapping a link to
earthengine.app. That test is server-side and immune to caching.

**The browser tab title** is the app name, which is the same single field that generates
the URL slug. There is no separate title setting, the Gallery description does not affect
it, and the Code Editor sandbox exposes no DOM, so the script cannot change it either.
Renaming the app changes the title and the URL together and breaks the old address, since
Earth Engine provides no redirect. The alternatives are to accept the slug as the tab
title, which is what nearly every published app does, or to wrap the app in a page you
host whose own title and URL you control.

The application therefore carries its full name inside the interface instead. The control
panel is headed by the square mark from `assets/logo.png`, inlined as a data URI because
`ui.Label`'s `imageUrl` accepts only data URIs and gstatic.com icons. The title and the
caption sit in a vertical panel beside it, so the caption begins at the title's left edge
rather than under the mark.

A label's `style.width` **clips** its image, it does not scale it, so an inlined image must
be shipped at the exact size it is to appear at. A wordmark sized for a wider panel simply
runs off the edge with its right-hand end cut away. The mark is therefore inlined at
107 x 107, its display size: **to resize it, regenerate the base64 string at the new size**,
because widening the label alone only reveals more empty space or crops the image.

107 px is not a taste call. Beside a mark that size the title wraps to two lines and the
caption to three, and that text block measures exactly 107 px tall with Earth Engine's own
stylesheet (`html, body {line-height: normal}`, Roboto), so the foot of the mark lands on
the last line of the caption. It measures 107 px at every panel content width from 360 to
384 px, which is the range the panel moves through as its scrollbar appears and vanishes,
so the alignment cannot be broken by content elsewhere in the panel.

## What Earth Engine's stylesheet fixes, and you cannot

Two rules in `earthengine.app/css/app.css` decide more of the panel's look than the app
code does:

* **Every widget is created with `margin: 8px` on all four sides** (`ui.Widget`'s default
  style, in `earthengine.app/javascript/main.js`). That is what held the selects and the
  opacity slider in from the panel's content edges while the legend ramp and the tool
  buttons, which set their own margins, sat flush. The app now sets `margin: '0 0 2px 0'`
  on all three so every control shares one left and right edge.
* **Select captions and button labels are pinned at 11 px bold** —
  `.goog-flat-menu-button {font-size: 11px; font-weight: 700; line-height: 27px}` and
  `.jfk-button {font-size: 11px}`. A widget's `style` dictionary is applied to the
  widget's own root element only (`ZE()` in main.js has a custom handler for `cursor`
  and nothing else), and an inherited font size cannot beat a class rule on the child
  that renders the text. **So `fontSize` on a `ui.Select` or a `ui.Button` has no visible
  effect.** The only way to control the size of that text is to build the control out of
  widgets whose text lives in the root element: `ui.Label` and `ui.Checkbox` both honour
  `fontSize`.

The app therefore has no selects and no buttons. Layer, Basemap and Tools are checkbox
groups driven as radio buttons by `radioGroup()` in section 9: exactly one row is on, and
clicking the row already on leaves it on. A checkbox's label is a `<span class="label">`
inside the widget root with no font rule of its own, so the label takes the size the app
gives it (15 px here, against the 11 px a select would have forced). The one control that
kept its widget is the opacity slider, whose read-out is also drawn in the root and so
does take a font size.

## Why the transect chart declares its column types

`ui.Chart` builds its DataTable with `arrayToDataTable`, which infers a column's type
from that column's first non-null value and falls back to `"string"` for a column that
holds no values at all:

    O(c.cols, function(m, n){ m.type == null && (m.type = g[n] || "string") })

Google Charts then refuses the chart with *"Data column(s) for axis #0 cannot be of type
string"*. A transect drawn entirely over water, over a gap in the data, or outside the
province samples nothing but masked pixels, so both value columns arrive empty and get
typed as text - which is why the error appeared and disappeared depending on where the
line was drawn, and why it was easiest to hit zoomed in. Verified against the live assets:
a line in the open Pacific returns 328 points, every value null, with the property keys
present.

The chart is therefore built from an explicit `[{label, type: 'number'}, ...]` header and
rows evaluated client-side, with every value passed through `finiteOrNull()`. That also
covers Earth Engine sending NaN and Infinity as the strings `"NaN"` and `"Infinity"`,
which would type a column as text in the same way. A line with nothing under it now gets a
sentence saying so, and a line shorter than one pixel gets another.

## Why the content sits in a fixed-width column

The control panel scrolls, and a scrollbar takes its width from the inside of the element
that scrolls. Opening the About section made the panel taller than the window, the
scrollbar appeared, and every stretched widget in the panel lost about 15 px - the whole
interface visibly re-flowed on a click. `ui` exposes no `overflow` style, so the scrollbar
cannot be pinned on. Instead all content sits in an inner panel of fixed width (364 px)
inside the 400 px panel: the scrollbar still comes and goes, but nothing inside changes
size, because nothing inside depends on the panel's remaining width.
