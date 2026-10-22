# Deep linking and Direct to Play

The channel accepts both launch-time and running-app deep links.  Parameter
names are matched case-insensitively; the first non-empty value wins.

| Parameter | Aliases | Effect |
|---|---|---|
| `contentID` | `contentId`, `contentid`, `id` | Open that wallpaper's id (or filename) in the fullscreen viewer |
| `mediaType` | — | Accepted (`wallpaper`, or anything); the channel has one media type |
| `query` | `search`, `keyword` | Pre-fill the search and show the results grid |
| `action` | `mode` | Where to land — see the table below |

## Actions

| `action=` | Aliases | Lands on |
|---|---|---|
| `ambient` | — | Ambient Mode. Combined with `contentID`, starts on that wallpaper; alone, starts from the gallery (honouring the Theme Studio *Ambient Mode* assignment) |
| `daily` | — | The Daily Spotlight |
| `favorites` | `favourites` | The Favorites tab, with a match-count toast |
| `screensavers` | `collection` | The Ambient Collection |
| `theme` | — | Theme Studio |
| `settings` | — | Settings |
| `store` | — | Store |

Unknown actions are ignored (the channel stays where it is); unknown ids
produce a toast rather than a blank screen.

## Launch (channel not running)

```bash
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?contentID=7399&mediaType=wallpaper"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?query=lighthouse"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?contentID=7399&action=ambient"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?action=favorites"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?action=theme"
```

`<CHANNEL_ID>` is `dev` for a sideloaded developer channel.

## While running (Direct to Play, certification 5.2)

```bash
curl -d '' "http://<ROKU_IP>:8060/input?contentID=7399"
curl -d '' "http://<ROKU_IP>:8060/input?action=daily"
```

Requires `supports_input_launch=1` in `roku/manifest` (the packaging script
fails the build without it).  The parameters arrive as an `roInputEvent` on the
main message port; `MainLoop()` dispatches them through the same handler as
launch arguments, so the viewer opens without relaunching the channel.

## Resolution order

`ApplyDeepLinkParams()` evaluates the parameters in a fixed order, so
combinations behave predictably:

1. `query` wins over everything — it filters and lands on the results grid.
2. `contentID` — looked up in `state.filtered` first, then the full archive
   (so a link still resolves when the persisted filters would have hidden the
   wallpaper).  `action=ambient` sends it to Ambient Mode, anything else to the
   viewer.
3. `action` alone — lands on the named screen.

## Unknown ids

An id that is not in the packaged archive produces a toast
("Wallpaper N is not in this archive") rather than a blank screen.  The archive
is refreshed by rebuilding `roku/assets/catalog.json`
(`make roku-catalog`), which is also how newly scraped wallpapers reach the TV.
