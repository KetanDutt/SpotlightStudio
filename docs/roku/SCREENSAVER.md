# The standalone screensaver channel

Roku's screensaver policy is unambiguous:

* only **standalone screensaver apps** may ship a screensaver;
* a non-screensaver app that provides `screensaver_title` "will be blocked"
  from publishing;
* certification 4.5 prohibits channels from overriding or interfering with the
  system screensaver;
* a screensaver package must **not** define `Main()` or `RunUserInterface()`,
  must **not** use `roChannelStore`, `roAudioPlayer` or `roVideoPlayer`, and
  must exit on any user input.

So this repository ships **two** packages.  The channel (`roku/`) contains no
screensaver code at all; its in-app "Ambient Mode" runs only while the user is
inside the app.  The screensaver (`roku-screensaver/`) is a separate app that
appears under *Settings → Theme → Screensavers*.

## What is in it

```
roku-screensaver/
├── manifest         screensaver_title=… , NO title=, NO Main()
└── source/main.brs  RunScreenSaver() + RunScreenSaverSettings() only
```

The build copies the shared modules it needs out of `roku/source/`:
`utils.brs`, `constants.brs`, `gfx_cache.brs`, `theme.brs`, `catalog.brs`,
`image_loader.brs`.  That is the entire dependency closure of the screensaver's
renderer — no store, no licence, no views.

## Behaviour

* Cycles the chosen pool (landscape / 4K / entire archive) with a 30-second
  Ken Burns drift and a dip-to-black cross-slide.
* Pre-fetches the frame after the one on screen — before the first slide and
  again at every transition — so the dip-to-black reveals a decoded image
  instead of a blank panel.
* Optionally draws a large clock that fades with each transition.
* **Any remote key press exits immediately** and returns the viewer to
  whatever app was running.
* Gives up after 45 s **without a single decoded frame** so the device falls
  back to the system screensaver instead of showing a black panel.  The
  stall clock is re-marked on every frame that does arrive, so one slow early
  download no longer ends the screensaver permanently — it used to measure from
  process start, which exited for good 45 s in whenever the first image was
  merely slow.
* `RunScreenSaverSettings()` adds the standard "Change screensaver settings"
  menu entry: interval, pool, palette and clock toggle, saved to the
  `SpotlightScreensaver` registry section.

## Building

```bash
make roku-audit              # static gate: state keys, Roku API surface, dead calls
make roku-lint               # BrighterScript compile gate
make roku-screensaver        # dist/spotlight-studio-screensaver-<ver>.zip
make roku-check              # audit + pre-flight: entry points, banned components, size
```

The pre-flight enforces the policy mechanically: `screensaver_title` present,
`title` absent, `RunScreenSaver()` present, `Main()`/`RunUserInterface()`
absent, and none of the three banned components referenced outside comments.
The auditor covers it too: it has its own package profile, so a screensaver
source file may only contain `RunScreenSaver()`/`RunScreenSaverSettings()` and
may not reach for `roChannelStore`, `roAudioPlayer` or `roVideoPlayer`.

## Publishing notes

* Upload it as its **own** app in the Developer Dashboard with the *Screensaver*
  type; its store listing shows in the screensaver catalogue, not on the home
  screen.
* It shares the channel's catalog, so it needs the same CDN reachability.
* Purchased screensavers are hidden from the home screen by the OS; this one is
  free.
