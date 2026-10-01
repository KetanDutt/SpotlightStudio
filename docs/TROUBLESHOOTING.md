# 🛠️ Troubleshooting & FAQ

This guide contains diagnostic steps and solutions for common operational issues.

---

## 🔍 Common Issues & Solutions

### 1. `WebView2` Runtime Not Found / PyWebView Fails to Launch
**Symptom**: `python main.py` prints a warning or fails to open a native desktop window.  
**Cause**: PyWebView on Windows requires Microsoft Edge WebView2 Runtime (pre-installed on Windows 10/11, but may be disabled on stripped Windows editions).  
**Solution**:
- The updated `main.py` automatically detects this and falls back to opening your default web browser at `http://127.0.0.1:8765/`.
- To enable the native desktop window, install [Evergreen WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).

---

### 2. Port `8765` Already in Use (`OSError: [Errno 10048]`)
**Symptom**: Server fails to start because port 8765 is taken by another process.  
**Solution**:
- Change the port in `.env`:
  ```dotenv
  PORT=8788
  ```
- Or pass the `--port` flag when launching:
  ```powershell
  python main.py --port 8788
  ```

---

### 3. "Failed to set wallpaper: Only supported on Windows"
**Symptom**: Calling `/api/wallpapers/{id}/set-wallpaper` returns a 400 error.  
**Cause**: The 1-click wallpaper setting feature uses the Windows Win32 API (`SystemParametersInfoW`).  
**Solution**:
- This feature is native to Windows 10 & 11.
- On Linux or macOS, you can still download any wallpaper in full 4K UHD via the **"Download Full Resolution"** button and apply it through your desktop environment's background settings.

---

### 4. Database Locked (`sqlite3.OperationalError: database is locked`)
**Symptom**: SQLite reports database locked under heavy concurrent writes.  
**Solution**:
- Spotlight Studio initializes SQLite in **WAL (Write-Ahead Logging)** mode with thread-local connections (`PRAGMA journal_mode=WAL`), allowing simultaneous readers and non-blocking writers.
- Ensure you do not have SQLite database editing tools (like DB Browser for SQLite) holding an exclusive write lock while the crawler is actively downloading.

---

### 5. Network Timeouts on Slow Connections
**Symptom**: Repeated timeout warnings in `data/downloader.log`.  
**Solution**:
- Adjust the timeout and reduce concurrency in `.env`:
  ```dotenv
  CONCURRENT_DOWNLOADS=16
  REQUEST_TIMEOUT_SECONDS=45
  REQUEST_DELAY_SECONDS=0.3
  ```

---

### 6. GitHub Pages Shows 404 for Images or JSON
**Symptom**: GitHub Pages website loads, but image thumbnails or `wallpapers.json` fail with 404.  
**Cause**: Git did not push `data/wallpapers.json` or the `images/` directory.  
**Solution**:
- Verify your `.gitignore` does not ignore `images/` or `data/wallpapers.json`.
- Run:
  ```bash
  git add images/ data/wallpapers.json index.html
  git commit -m "Ensure images and catalog are tracked"
  git push origin main
  ```
- In GitHub repository settings: **Settings** → **Pages** → ensure Source is set to `main` branch, `/ (root)` folder.
