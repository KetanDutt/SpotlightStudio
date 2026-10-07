import ExpoModulesCore

/**
 The iOS half of the wallpaper bridge.

 Apple does not offer public API to change the wallpaper, so this module is honest about it:
 `isSupported()` returns `false` and `setWallpaper` throws a descriptive error.  The app
 reads those signals and switches to the "save to Photos + Shortcuts" flow (see
 `src/services/wallpaper.ts`), which means the JavaScript side never has to branch per
 platform.

 Keeping the module here (instead of omitting it) has a real benefit: the same TypeScript
 contract exists on both platforms, and a future iOS release that exposes an API only needs
 a change in this one file.
 */
public class SpotlightWallpaperModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SpotlightWallpaper")

    Function("isSupported") { () -> Bool in
      false
    }

    Function("supportsSeparateLockScreen") { () -> Bool in
      false
    }

    AsyncFunction("setWallpaper") { (uri: String, mode: String) -> [String: Any] in
      throw WallpaperUnsupportedException()
    }
  }
}

internal final class WallpaperUnsupportedException: Exception {
  override var reason: String {
    "iOS does not allow apps to change the wallpaper. Spotlight Studio saved the image to your photo library instead – use the Shortcuts “Set Wallpaper” action to apply it."
  }
}
