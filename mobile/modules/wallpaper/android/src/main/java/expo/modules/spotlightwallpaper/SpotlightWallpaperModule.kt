package expo.modules.spotlightwallpaper

import android.app.WallpaperManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile

class WallpaperException(message: String) : CodedException(message)

/** Private-cache-only image validation and bounded, serialized wallpaper changes. */
class SpotlightWallpaperModule : Module() {
  companion object {
    // Shared by foreground/headless module instances within this Android process.
    private val imageLock = Any()
    private const val MAX_BYTES = 40L * 1024 * 1024
    private const val MAX_PIXELS = 120_000_000L
  }

  private val context: Context
    get() = appContext.reactContext
      ?: throw WallpaperException("The Android context is not available yet.")

  private fun cacheImage(uri: String): File {
    val parsed = Uri.parse(uri)
    if (parsed.scheme != "file" || !parsed.authority.isNullOrEmpty() || parsed.query != null || parsed.fragment != null) {
      throw WallpaperException("Only a private cached image can be used.")
    }
    val file = File(parsed.path ?: throw WallpaperException("Missing image path.")).canonicalFile
    val root = File(context.cacheDir, "spotlight-studio").canonicalPath + File.separator
    if (!file.path.startsWith(root) || !file.isFile) {
      throw WallpaperException("The private cached image is no longer available. Download it again.")
    }
    if (file.length() < 32 || file.length() > MAX_BYTES) {
      throw WallpaperException("The image is empty or exceeds the 40 MiB safety limit.")
    }
    return file
  }

  private fun bounds(file: File): BitmapFactory.Options {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, options)
    if (options.outWidth <= 0 || options.outHeight <= 0 ||
      options.outWidth.toLong() * options.outHeight.toLong() > MAX_PIXELS ||
      options.outMimeType !in listOf("image/jpeg", "image/png", "image/webp")) {
      throw WallpaperException("The image is unreadable, unsupported or exceeds 120 megapixels.")
    }
    // Cheap truncation checks in addition to the real decoder. Never read the whole file.
    RandomAccessFile(file, "r").use { input ->
      val complete = when (options.outMimeType) {
        "image/jpeg" -> {
          input.seek(file.length() - 2)
          input.readUnsignedByte() == 0xff && input.readUnsignedByte() == 0xd9
        }
        "image/png" -> {
          input.seek(file.length() - 12)
          val tail = ByteArray(12)
          input.readFully(tail)
          tail.contentEquals(byteArrayOf(0, 0, 0, 0, 73, 69, 78, 68, -82, 66, 96, -126))
        }
        else -> {
          input.seek(4)
          val declared = (input.readUnsignedByte().toLong()) or
            (input.readUnsignedByte().toLong() shl 8) or
            (input.readUnsignedByte().toLong() shl 16) or
            (input.readUnsignedByte().toLong() shl 24)
          declared + 8 == file.length()
        }
      }
      if (!complete) throw WallpaperException("The image download is incomplete. Please retry.")
    }
    return options
  }

  private fun decode(file: File, bounds: BitmapFactory.Options, budget: Long): Bitmap {
    var sample = 1
    while (((bounds.outWidth.toLong() + sample - 1) / sample) *
      ((bounds.outHeight.toLong() + sample - 1) / sample) > budget) sample *= 2
    val options = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return try {
      BitmapFactory.decodeFile(file.path, options)
        ?: throw WallpaperException("The image could not be decoded. Please download it again.")
    } catch (_: OutOfMemoryError) {
      throw WallpaperException("Not enough memory to decode this image. Try a smaller wallpaper.")
    }
  }

  override fun definition() = ModuleDefinition {
    Name("SpotlightWallpaper")

    Function("isSupported") {
      try {
        val manager = WallpaperManager.getInstance(context)
        manager.isWallpaperSupported && manager.isSetWallpaperAllowed
      } catch (_: Exception) { false }
    }

    Function("supportsSeparateLockScreen") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.N }

    AsyncFunction("validateImage") { uri: String ->
      synchronized(imageLock) {
        try {
          val file = cacheImage(uri)
          val info = bounds(file)
          val bitmap = decode(file, info, 2_000_000L)
          bitmap.recycle()
          mapOf("valid" to true, "width" to info.outWidth, "height" to info.outHeight)
        } catch (_: Exception) {
          mapOf("valid" to false, "width" to 0, "height" to 0)
        } catch (_: OutOfMemoryError) {
          mapOf("valid" to false, "width" to 0, "height" to 0)
        }
      }
    }

    AsyncFunction("setWallpaper") { uri: String, mode: String ->
      synchronized(imageLock) {
        if (mode !in listOf("home", "lock", "both")) throw WallpaperException("Unknown wallpaper target.")
        val file = cacheImage(uri)
        val info = bounds(file)
        val manager = WallpaperManager.getInstance(context)
        if (!manager.isWallpaperSupported || !manager.isSetWallpaperAllowed) {
          throw WallpaperException("This device or work-profile policy does not allow changing the wallpaper.")
        }
        val flags = when (mode) {
          "lock" -> WallpaperManager.FLAG_LOCK
          "both" -> WallpaperManager.FLAG_SYSTEM or WallpaperManager.FLAG_LOCK
          else -> WallpaperManager.FLAG_SYSTEM
        }
        val bitmap = decode(file, info, 12_000_000L)
        val width = bitmap.width
        val height = bitmap.height
        try {
          // Do not opt user-selected images into OS wallpaper backup implicitly.
          val wallpaperId = manager.setBitmap(bitmap, null, false, flags)
          if (wallpaperId <= 0) throw WallpaperException("Android did not confirm a wallpaper change.")
        } catch (_: IOException) {
          throw WallpaperException("Android could not write this wallpaper. Please retry.")
        } catch (_: SecurityException) {
          throw WallpaperException("Android policy or permissions refused this wallpaper change.")
        } catch (_: IllegalArgumentException) {
          throw WallpaperException("This screen cannot use that image.")
        } finally {
          bitmap.recycle()
        }
        mapOf("success" to true, "target" to mode, "width" to width, "height" to height)
      }
    }
  }
}
