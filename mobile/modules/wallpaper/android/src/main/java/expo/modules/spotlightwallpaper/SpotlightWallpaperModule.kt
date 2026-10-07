package expo.modules.spotlightwallpaper

import android.app.WallpaperManager
import android.content.Context
import android.graphics.BitmapFactory
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException

/** Raised when the image cannot be applied; the message is shown to the user as-is. */
class WallpaperException(message: String) : CodedException(message)

/**
 * Sets the Android wallpaper from a local file.
 *
 * Design notes
 * ------------
 * * The picture is decoded with `BitmapFactory` (the same decoder the system uses) and it is
 *   verified *before* anything is written, so a corrupt download can never blank the screen.
 * * `FLAG_SYSTEM` = home screen, `FLAG_LOCK` = lock screen (Android 7.0+ only – the flag
 *   simply does not exist before that).
 * * The bitmap is recycled in a `finally` block: a 4K image is ~30 MB in RAM.
 * * No permissions are requested at runtime; `SET_WALLPAPER` is a normal permission.
 */
class SpotlightWallpaperModule : Module() {
  private val context: Context
    get() = appContext.reactContext
      ?: throw WallpaperException("The Android context is not available yet.")

  override fun definition() = ModuleDefinition {
    Name("SpotlightWallpaper")

    Function("isSupported") {
      WallpaperManager.getInstance(context).isWallpaperSupported
    }

    Function("supportsSeparateLockScreen") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
    }

    AsyncFunction("setWallpaper") { uri: String, mode: String ->
      val path = uri.removePrefix("file://")
      val file = File(path)
      if (!file.isFile) {
        throw WallpaperException("The image file could not be found: $path")
      }

      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(path, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        throw WallpaperException("The file is not a readable image.")
      }

      val manager = WallpaperManager.getInstance(context)
      if (!manager.isWallpaperSupported) {
        throw WallpaperException("This device does not allow changing the wallpaper.")
      }

      val wantsLock = mode == "lock" || mode == "both"
      if (wantsLock && Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
        throw WallpaperException("This Android version can only change the home screen wallpaper.")
      }
      val flags = when (mode) {
        "lock" -> WallpaperManager.FLAG_LOCK
        "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
        else -> WallpaperManager.FLAG_SYSTEM
      }

      val bitmap = try {
        BitmapFactory.decodeFile(path)
      } catch (error: OutOfMemoryError) {
        // A 4K picture is ~30 MB once decoded; a low-memory device can refuse it.
        throw WallpaperException("Not enough memory to decode this image.")
      } ?: throw WallpaperException("The image could not be decoded (unsupported format?).")

      try {
        manager.setBitmap(bitmap, null, true, flags)
      } catch (error: IOException) {
        throw WallpaperException("Android refused the image: ${error.message ?: "I/O error"}")
      } catch (error: SecurityException) {
        throw WallpaperException("Android refused the change (missing permission).")
      } catch (error: IllegalArgumentException) {
        throw WallpaperException("This screen cannot use that image.")
      } finally {
        bitmap.recycle()
      }

      mapOf(
        "success" to true,
        "target" to if (mode == "lock" || mode == "both" || mode == "home") mode else "home",
        "width" to bounds.outWidth,
        "height" to bounds.outHeight
      )
    }
  }
}
