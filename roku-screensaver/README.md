# Spotlight Studio Ambient — standalone Roku screensaver

A dedicated screensaver app, separate from the Spotlight Studio channel
because Roku's screensaver policy allows screensavers only in standalone
packages (certification requirement 4.5 forbids channels from shipping one).

* Entry points: `RunScreenSaver()` and `RunScreenSaverSettings()` only.
  No `Main()`, no `RunUserInterface()`.
* No `roChannelStore`, `roAudioPlayer` or `roVideoPlayer`.
* Any key press exits and returns the viewer to the running app.
* Cycles a chosen pool (landscape / 4K / whole archive) with a Ken Burns drift,
  dip-to-black cross-slides and an optional fading clock.
* Settings appear under *Settings → Theme → Screensavers → Change screensaver
  settings*: interval, pool, palette, clock.

Build and verify:

```bash
make roku-screensaver     # dist/spotlight-studio-screensaver-<version>.zip
make roku-check           # enforces entry points, banned components, size
```

The build copies its shared modules (`utils`, `constants`, `gfx_cache`,
`theme`, `catalog`, `image_loader`) from `roku/source/`, so the two packages
cannot drift apart.  See [`../docs/roku/SCREENSAVER.md`](../docs/roku/SCREENSAVER.md)
for the policy background and publishing notes.
