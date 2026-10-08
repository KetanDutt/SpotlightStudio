import ExpoModulesCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

/** iOS validates private images but never claims to set wallpaper. */
public class SpotlightWallpaperModule: Module {
  private static let imageLock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("SpotlightWallpaper")

    Function("isSupported") { false }
    Function("supportsSeparateLockScreen") { false }

    AsyncFunction("validateImage") { (uri: String) -> [String: Any] in
      Self.imageLock.lock()
      defer { Self.imageLock.unlock() }
      guard let cache = self.appContext?.config.cacheDirectory,
        let url = URL(string: uri), url.isFileURL, url.host == nil || url.host == "",
        url.query == nil, url.fragment == nil else {
        return ["valid": false, "width": 0, "height": 0]
      }
      let root = cache.appendingPathComponent("spotlight-studio", isDirectory: true)
        .standardizedFileURL.resolvingSymlinksInPath().path + "/"
      let file = url.standardizedFileURL.resolvingSymlinksInPath()
      guard file.path.hasPrefix(root),
        let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
        size >= 32, size <= 40 * 1024 * 1024,
        let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
        CGImageSourceGetCount(source) == 1,
        CGImageSourceGetStatus(source) == .statusComplete,
        CGImageSourceGetStatusAtIndex(source, 0) == .statusComplete,
        let identifier = CGImageSourceGetType(source),
        let type = UTType(identifier as String),
        [UTType.jpeg, UTType.png, UTType.webP].contains(type),
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let width = properties[kCGImagePropertyPixelWidth] as? Int,
        let height = properties[kCGImagePropertyPixelHeight] as? Int,
        width > 0, height > 0, Double(width) * Double(height) <= 120_000_000 else {
        return ["valid": false, "width": 0, "height": 0]
      }
      // A bounded decode, not just checking the magic bytes of a truncated download.
      let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: 2048,
        kCGImageSourceShouldCacheImmediately: true
      ]
      guard CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) != nil else {
        return ["valid": false, "width": 0, "height": 0]
      }
      return ["valid": true, "width": width, "height": height]
    }

    AsyncFunction("setWallpaper") { (uri: String, mode: String) -> [String: Any] in
      throw WallpaperUnsupportedException()
    }
  }
}

internal final class WallpaperUnsupportedException: Exception {
  override var reason: String {
    "iOS does not allow apps to change the wallpaper. Save the image to Photos, then use Settings or the Shortcuts “Set Wallpaper” action to apply it."
  }
}
