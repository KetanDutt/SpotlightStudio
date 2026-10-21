# Deep linking and Direct to Play

The channel accepts both launch-time and running-app deep links.  Parameter
names are matched case-insensitively; the first non-empty value wins.

| Parameter | Aliases | Effect |
|---|---|---|
| `contentID` | `contentId`, `contentid`, `id` | Open that wallpaper's id (or filename) in the fullscreen viewer |
| `mediaType` | — | Accepted (`wallpaper`, or anything); the channel has one media type |
| `query` | `search`, `keyword` | Pre-fill the search and show the results grid |
| `action` | `mode` | `ambient` starts Ambient Mode (on the deep-linked wallpaper when combined with `contentID`); `daily` opens the Daily Spotlight |

## Launch (channel not running)

```bash
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?contentID=7399&mediaType=wallpaper"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?query=lighthouse"
curl -d '' "http://<ROKU_IP>:8060/launch/<CHANNEL_ID>?contentID=7399&action=ambient"
```

`<CHANNEL_ID>` is `dev` for a sideloaded developer channel.

## While running (Direct to Play, certification 5.2)

```bash
curl -d '' "http://<ROKU_IP>:8060/input?contentID=7399"
```

Requires `supports_input_launch=1` in `roku/manifest` (the packaging script
fails the build without it).  The parameters arrive as an `roInputEvent` on the
main message port; `MainLoop()` dispatches them through the same handler as
launch arguments, so the viewer opens without relaunching the channel.

## Unknown ids

An id that is not in the packaged archive produces a toast
("Wallpaper N is not in this archive") rather than a blank screen.  The archive
is refreshed by rebuilding `roku/assets/catalog.json`
(`make roku-catalog`), which is also how newly scraped wallpapers reach the TV.
