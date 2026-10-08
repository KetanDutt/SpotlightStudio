const { test, expect } = require('@playwright/test');

test('gallery recovers corrupt preferences and supports favorites backup/restore', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('spotlight:favorites', '{}');
    localStorage.setItem('spotlight:prefs', 'null');
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await expect(page.locator('#crawler')).toBeHidden();
  await expect(page.locator('.read-only-notice')).toBeVisible();
  await page.locator('.card-fav').first().click();
  await expect(page.locator('#fav-count')).toHaveText('1');
  await page.locator('#btn-menu').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-action="backup-favorites"]').click();
  const download = await downloadEvent;
  await page.locator('.card-fav').first().click();
  await expect(page.locator('#fav-count')).toHaveText('0');
  await page.locator('#favorites-file').setInputFiles(await download.path());
  await expect(page.locator('#fav-count')).toHaveText('1');
  await page.locator('#search').fill('no matching photograph');
  await expect(page.locator('#state-empty')).toBeVisible();
  await page.locator('#search-clear').click();
  await expect(page.locator('.card')).toHaveCount(24);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});

test('actions menu is keyboard accessible; favorites synchronize between tabs', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('#btn-menu').click();
  await expect(page.locator('[data-action="export-json"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-action="export-csv"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-menu')).toBeFocused();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.card')).toHaveCount(24);
  await page.locator('.card-fav').first().click();
  await expect(other.locator('#fav-count')).toHaveText('1');
  await context.setOffline(true);
  await expect(page.locator('#offline-banner')).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator('#offline-banner')).toBeHidden();
  await other.close();
});

test('API reference loads without inline scripts, CDN calls or CSP violations', async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:8877')) externalRequests.push(request.url());
  });
  await page.goto('/api/docs');
  await expect(page.locator('.opblock').first()).toBeVisible();
  expect(await page.locator('.opblock').count()).toBeGreaterThan(10);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

for (const scheme of ['light', 'dark']) {
  test(`Still Glass: ${scheme} gallery, list, viewer and dialogs preserve their flows`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await expect(page.locator('.card')).toHaveCount(24);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.locator('#view-list').click();
    await expect(page.locator('#gallery')).toHaveClass(/is-list/);
    await expect(page.locator('.seg')).toHaveClass(/is-list-selected/);
    await page.locator('.card-main').first().click();
    await expect(page.locator('#lightbox')).toBeVisible();
    const title = await page.locator('#lb-title').textContent();
    await page.locator('#lb-next').click();
    await expect(page.locator('#lb-title')).not.toHaveText(title);
    await page.locator('#lb-fav').click();
    await expect(page.locator('#lb-fav')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#lightbox #toasts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#lightbox')).not.toBeVisible();
    await expect(page).not.toHaveURL(/#w=/);
    await expect(page.locator('body > #toasts .toast')).toBeVisible();
    await page.locator('#btn-menu').click();
    await page.locator('[data-action="shortcuts"]').click();
    await expect(page.locator('#dlg-shortcuts')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#dlg-shortcuts')).not.toBeVisible();
    await page.locator('#btn-menu').click();
    await page.locator('[data-action="about"]').click();
    await expect(page.locator('#dlg-about')).toBeVisible();
    await page.locator('#dlg-about [data-close]').click();
    await expect(page.locator('#dlg-about')).not.toBeVisible();
    await page.locator('#view-grid').click();
    await expect(page.locator('#gallery')).not.toHaveClass(/is-list/);
  });
}

for (const width of [320, 390, 768]) {
  test(`Still Glass: ${width}px layout and filter focus containment`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await expect(page.locator('.card')).toHaveCount(24);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#filters-toggle').click();
    await expect(page.locator('#sidebar')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#sidebar-close')).toBeFocused();
    await expect(page.locator('#main')).toHaveAttribute('inert', '');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#btn-reset')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#sidebar-close')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#filters-toggle')).toBeFocused();
    await expect(page.locator('#main')).not.toHaveAttribute('inert', '');
    await expect(page.locator('#scrim')).toBeHidden();
    // 44px touch targets, including all top-bar actions at the smallest width.
    for (const id of ['btn-favs', 'btn-shuffle', 'btn-theme', 'btn-menu']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('Still Glass: reduced motion removes transforms and dialog exit delay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  const motion = await page.locator('.card').first().evaluate(el => {
    const s = getComputedStyle(el); return { animation: s.animationName, transition: s.transitionDuration };
  });
  expect(motion).toEqual({ animation: 'none', transition: '0s' });
  await page.locator('#btn-menu').click();
  await page.locator('[data-action="about"]').click();
  await page.locator('#dlg-about [data-close]').click();
  await expect(page.locator('#dlg-about')).not.toHaveAttribute('open', '');
});

test('Still Glass: text and primary-action tokens meet AA contrast in both themes', async ({ page }) => {
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
    const ratios = await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      const style = getComputedStyle(document.documentElement);
      const color = token => style.getPropertyValue(token).trim();
      const luminance = hex => {
        if (hex.length === 4) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
        const c = hex.slice(1).match(/../g).map(x => {
          const v = parseInt(x, 16) / 255;
          return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
        });
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      };
      const contrast = (a, b) => {
        const x = luminance(color(a)), y = luminance(color(b));
        return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
      };
      return [...['--text', '--text-2', '--text-3', '--accent'].flatMap(fg =>
        ['--bg', '--bg-elev'].map(bg => ({ pair: `${theme} ${fg}/${bg}`, ratio: contrast(fg, bg) }))),
        { pair: `${theme} primary`, ratio: contrast('--accent-ink', '--accent') }];
    }, theme);
    for (const { pair, ratio } of ratios) expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
  }
});

test('daily spotlight is a shared UTC pick with favorites and filter-aware visibility', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#daily-spotlight')).toBeVisible();
  const expected = await page.evaluate(async () => {
    const rows = await (await fetch('/api/catalog')).json();
    return SpotlightCore.dailyWallpaper(SpotlightCore.buildCatalog(rows)).id;
  });
  await page.locator('#daily-fav').click();
  await expect(page.locator('#daily-fav')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fav-count')).toHaveText('1');
  await page.locator('#daily-open').click();
  await expect(page).toHaveURL(new RegExp(`#w=${expected}$`));
  await expect(page.locator('#lb-fav')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#lightbox')).not.toBeVisible();
  await page.locator('#search').fill('fixture');
  await expect(page.locator('#daily-spotlight')).toBeHidden();
  await page.locator('#search-clear').click();
  await expect(page.locator('#daily-spotlight')).toBeVisible();
  expect(errors).toEqual([]);
});

test('viewer shows a persistent image failure and can retry without closing', async ({ page }) => {
  let blocked = true;
  await page.route('**/images/peapix/**', route => blocked ? route.abort('failed') : route.continue());
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('.card-main').first().click();
  await expect(page.locator('#lb-error')).toBeVisible();
  await expect(page.locator('#lb-error')).toContainText('Check your connection');
  blocked = false;
  await page.locator('#lb-retry').click();
  await expect(page.locator('#lb-error')).toBeHidden();
  await expect(page.locator('#lb-img')).toBeVisible();
  expect(await page.locator('#lb-img').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
});

test('legacy clipboard fallback remains inside the modal viewer', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    document.execCommand = command => {
      window.copyInsideDialog = command === 'copy' && Boolean(document.activeElement.closest('dialog[open]'));
      return true;
    };
  });
  await page.goto('/');
  await page.locator('.card-main').first().click();
  await page.locator('#lb-share').click();
  await expect(page.locator('#lightbox #toasts')).toContainText('Link copied');
  expect(await page.evaluate(() => window.copyInsideDialog)).toBe(true);
});

test('removing a viewer favorite updates the filtered gallery when it closes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('.card-fav').nth(0).click();
  await page.locator('.card-fav').nth(1).click();
  await page.locator('#btn-favs').click();
  await expect(page.locator('.card')).toHaveCount(2);
  await page.locator('.card-main').first().click();
  await page.locator('#lb-fav').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.card')).toHaveCount(1);
  await expect(page.locator('#fav-count')).toHaveText('1');
});

test('same-ID metadata changes are rendered on live catalog refresh', async ({ page }) => {
  let changed = false;
  await page.route('**/api/catalog', async route => {
    const response = await route.fetch();
    const rows = await response.json();
    if (changed) rows.forEach(row => { row.title = 'Upgraded photograph'; row.width = 1280; row.quality = 'HD'; });
    await route.fulfill({ response, json: rows });
  });
  await page.route('**/api/status', async route => {
    const response = await route.fetch();
    const status = await response.json();
    status.library_signature = changed ? 'metadata-upgraded' : 'initial-metadata';
    await route.fulfill({ response, json: status });
  });
  await page.goto('/');
  await expect(page.locator('.card')).toHaveCount(24);
  changed = true;
  await expect(page.locator('.card-title').first()).toHaveText('Upgraded photograph', { timeout: 10000 });
});

test('PWA keeps its scoped shell/catalog offline even after visiting the desktop app', async ({ page, context }) => {
  await page.route('https://github.com/**', route => route.abort());
  await page.goto('/showcase/?app=web');
  await expect(page.locator('.card')).toHaveCount(24);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  // Desktop cleanup must not unregister the /showcase/ worker or delete its caches.
  const desktop = await context.newPage();
  await desktop.goto('/');
  await expect(desktop.locator('.card')).toHaveCount(24);
  await desktop.close();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.card')).toHaveCount(24);
  await expect(page.locator('#daily-spotlight')).toBeVisible();
  await expect(page.locator('#offline-banner')).toBeVisible();
});
