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

so the name is a public, quotable identifier, not a label. This app was first published as
`wildfire-susceptibility-bc` and is being renamed to `bc-wildfire`, which gives:

    current after renaming:
    https://ee-arshahvaran.projects.earthengine.app/view/bc-wildfire

    original address, still in circulation:
    https://ee-arshahvaran.projects.earthengine.app/view/wildfire-susceptibility-bc

Set the display title to **BC Wildfire Susceptibility Explorer**, which is the name used in
the app panel, the repository and the paper.

**Step 3, choose the Google Cloud project.** Select `ee-arshahvaran`. This is the project that
is billed for the app's Earth Engine usage and the project that owns the app's service
account, so it must be the project that owns the assets as well.

**Step 4, set access and appearance.** Leave the app readable by anyone with the link, which
is what makes it citable from the paper. Add the description and the thumbnail from `assets/`
if you want the app listed with an image. Do **not** tick any option that makes the underlying
assets public: the app needs read access, the world does not.

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
    + ["projects/ee-arshahvaran/assets/bc_shapefile_gee"]
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
* The boundary table `bc_shapefile_gee` lives outside the `wildfire_1` folder and is easy to
  forget. Without it the app draws no provincial outline and `Map.centerObject` fails.

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
