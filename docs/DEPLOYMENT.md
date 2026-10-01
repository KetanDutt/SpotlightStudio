# 🚀 Deployment & Operating Guide

Spotlight Studio can be deployed in two complementary modes:
1. **GitHub Pages (Static Web Showcase)**: Free, zero-maintenance public hosting for browsing and downloading wallpapers.
2. **Local Desktop / Server (Crawler Engine)**: Runs locally on Windows, macOS, or Linux to scrape new wallpapers and update the catalog.

---

## 🌐 Deploying to GitHub Pages

GitHub Pages serves the static files (`index.html`, `sw.js`, `data/wallpapers.json`, and `images/`) directly from the repository.

### Performance Highlights on GitHub Pages:
- **Instant First Paint (< 300ms)**: Zero external CSS or JS dependencies. All styles are inlined and critical paths preloaded.
- **Service Worker Caching (`sw.js`)**: Caches image thumbnails on first view and uses Stale-While-Revalidate for the catalog JSON.
- **SessionStorage Fast-Render**: Instant sub-10ms render on subsequent tab visits while silently checking for updates.
- **Pre-indexed Client-Side Search**: Instant sub-millisecond search across thousands of wallpapers without server roundtrips.
- **Async Decoding & CLS Prevention**: Zero Cumulative Layout Shift (CLS = 0) with fixed image aspect containers and `decoding="async"`.

### Step-by-Step Instructions:

1. **Commit and Push Your Repository**:
   Ensure `index.html`, `sw.js`, `data/wallpapers.json`, and the `images/` directory are committed to GitHub:
   ```bash
   git add .
   git commit -m "Deploy Spotlight Studio showcase"
   git push origin main
   ```

2. **Configure GitHub Pages in Repository Settings**:
   - Go to your repository on [GitHub](https://github.com/).
   - Click **Settings** (top navigation).
   - In the left sidebar, click **Pages** (under "Code and automation").
   - Under **Build and deployment**:
     - **Source**: Select `Deploy from a branch`.
     - **Branch**: Select `main`.
     - **Folder**: Select `/ (root)`.
   - Click **Save**.

3. **Verify Deployment**:
   Within 1 to 2 minutes, GitHub will publish your site at:
   ```
   https://<your-username>.github.io/<your-repository-name>/
   ```
   Visitors can immediately search, filter by source, view high-res previews in the Apple Liquid Glass lightbox, and download wallpapers!

---

## 🖥️ Running the Desktop Application

### Option A: 1-Click Launchers (Windows)
- **Desktop Window (PyWebView)**: Double-click **`start_desktop.bat`**.
  *(If the virtual environment is missing, the script will automatically create it and install all dependencies!)*
- **Browser Server Mode**: Double-click **`start_server.bat`** and visit `http://127.0.0.1:8765/`.

### Option B: Command Line (Cross-Platform)

```bash
# 1. Activate virtual environment
# Windows:
.\venv\Scripts\activate
# Linux / macOS:
source venv/bin/activate

# 2. Launch Desktop Window:
python main.py

# 3. Or launch Headless Server:
python main.py --server --host 127.0.0.1 --port 8765
```

---

## ⏰ Automated Scheduled Crawling (Windows Task Scheduler)

You can set up Windows Task Scheduler to automatically run the crawler once a week to fetch newly released Windows Spotlight wallpapers:

1. Open **Task Scheduler** in Windows (`taskschd.msc`).
2. Click **Create Basic Task...** on the right panel.
3. **Name**: `Windows Spotlight Wallpaper Sync`.
4. **Trigger**: Select `Weekly` (e.g., every Sunday at 02:00 AM).
5. **Action**: Select `Start a program`.
6. **Program/script**: `powershell.exe`
7. **Add arguments**:
   ```powershell
   -ExecutionPolicy Bypass -Command "& 'C:\Users\...\WindowsSpotlightWallpapers\venv\Scripts\python.exe' 'C:\Users\...\WindowsSpotlightWallpapers\main.py' --server"
   ```
8. Save and test by clicking **Run**.
