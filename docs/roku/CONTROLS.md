# Remote control map

Codes are `roUniversalControlEvent.GetInt()` press codes; release events are
the press code + 100 and are ignored.  Voice remotes map their extra buttons
through the same table.

Legend: **Back** = 0, **Up/Down/Left/Right** = 2/3/4/5, **OK** = 6,
**Replay** = 7, **Rewind** = 8, **FF** = 9, **★ Info** = 10, **Play** = 13,
**A/B** = 17/18.

The **Home** button is intercepted by the Roku OS and terminates the channel;
it never reaches this code.

## Home (gallery)

| Key | Action |
|---|---|
| Up / Down | Move through the 4×2 card grid; Up on the top row focuses the tab bar |
| Left / Right | Step one card; wraps across page boundaries |
| OK | Open the focused wallpaper in the fullscreen viewer |
| Back | Grid → tab bar; **tab bar → exit to the Roku home screen** (cert 4.6) |
| ★ | Open the Filter & Sort dialog |
| Replay | Jump to today's Daily Spotlight in the grid |
| Play | Start Ambient Mode from the focused card |
| Rewind / FF / A / B | Skip ±10 pages |

While the tab bar is focused, Left/Right move between the eight tabs and OK
activates one (Favorites and Filter & Sort are actions, the rest are views).

## Fullscreen viewer

| Key | Action |
|---|---|
| Left / Right / A / B | Previous / next wallpaper in the same list |
| Up / Down | Zoom in / out (100 % – 300 %) |
| OK | Cycle aspect mode: FIT (letterbox) → FILL (crop) |
| ★ or Info | Hide / show the glass HUD |
| Play / Pause | Toggle the slideshow |
| Replay | Toggle the focused wallpaper in Favorites |
| Rewind / FF | Jump ±10 wallpapers |
| Back | Return to the screen the viewer was opened from |

## Ambient Mode

| Key | Action |
|---|---|
| Play / Pause | Pause / resume the slideshow |
| ★ or Info | Show / hide the metadata HUD |
| Replay | Shuffle to a random wallpaper |
| Left / Right / A / B | Browse manually |
| Rewind / FF | Cycle the slide interval |
| OK | Pin the current wallpaper as the Ambient Mode starting wallpaper |
| **any other key** | Exit Ambient Mode |

## Daily Spotlight

| Key | Action |
|---|---|
| Up / Down | Move between the three action buttons |
| OK | Run the focused action (view fullscreen / start Ambient / favourite) |
| Replay | Toggle the favourite flag |
| Play | Start Ambient Mode on today's pick |
| Back | Return to the gallery |

## Ambient Collection (Screensavers tab)

| Key | Action |
|---|---|
| D-pad | Move through the 3×2 grid |
| OK | Open the focused wallpaper in the viewer |
| ★ | Set the focused wallpaper as the Ambient Mode wallpaper |
| Replay | Toggle the favourite flag |
| Play | Start Ambient Mode on the focused wallpaper |
| Rewind / FF | Previous / next page |
| Back | Return to the gallery |

## Theme Studio

| Key | Action |
|---|---|
| Up / Down | Move through the six palettes and the control rows |
| OK | Apply the focused palette (instantly), run a focused action, or cycle a value |
| Left / Right | Change the focused cycling row (auto-rotation, interval, pool, target) |
| Play | Preview Ambient Mode with the current rotation pool |
| Back | Return to the gallery |

## Pro Store

| Key | Action |
|---|---|
| Up / Down | Move between the three products and "Restore Purchases" |
| OK | Buy the focused product through Roku Pay, or restore purchases |
| Play | Start the 3-day trial (when unused) |
| Back | Return to the gallery |

## Settings

| Key | Action |
|---|---|
| Up / Down | Move through the preference rows |
| Left / Right / OK | Change a cycling row's value; run an action row |
| ★ | Open the Filter & Sort dialog |
| Play | Start the Pro trial |
| Back | Return to the gallery |

## Filter & Sort dialog (modal)

| Key | Action |
|---|---|
| Up / Down | Move between rows |
| Left / Right | Change the focused row's value (live — results update immediately) |
| OK | Apply and close (focus lands on the Search row's keyboard) |
| ★ | Reset every filter to its default |
| Back | Close the dialog |

## Search keyboard (modal)

| Key | Action |
|---|---|
| D-pad | Move the key cursor (rows are staggered, the column is clamped) |
| OK | Press the focused key: a letter, `SPACE`, `CLEAR`, `SEARCH` or `CANCEL` |
| Back | Delete the last character; closes the keyboard once the query is empty |
| ★ | Clear the whole query |
| Physical keyboard | Characters type directly into the query (simulator / keyboard remotes) |
