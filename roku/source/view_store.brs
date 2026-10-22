' Spotlight Studio for Roku
' view_store.brs - Spotlight Pro storefront.
'
' Product names and prices are whatever Roku Pay returns from GetCatalog(); the
' values in store.brs are only placeholders shown until that request answers.
' The copy describes what Pro actually unlocks inside this channel - it does not
' promise to change the Roku home screen or the system screensaver, which no
' channel is allowed to do.

function StoreLayout() as object
    gaa = GetGlobalAA()
    if gaa.__ssStoreLayout = invalid
        gaa.__ssStoreLayout = {
            panelX: 85,
            panelY: 130,
            panelW: 1180,
            panelH: 810,
            rowH: 150,
            rowsY: 250,
            infoX: 1300,
            infoW: 535
        }
    end if
    return gaa.__ssStoreLayout
end function

' Rows: one per product, then "Restore purchases".
function StoreRowCount() as integer
    return StoreProducts().Count() + 1
end function

sub RenderStore(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    L = StoreLayout()
    lm = state.licenseMgr

    screen.Clear(t.bgMain)
    DrawViewHeader(screen, state, "Spotlight Pro Store", "Unlock every theme, the full 4K archive and unlimited Ambient Mode rotation")

    ' ── entitlement banner ─────────────────────────────────────────────
    bannerColor = t.badgeFhd
    bannerText = "FREE MODE  •  " + lm.GetLicenseSummary()
    if lm.HasProAccess()
        bannerColor = t.successGreen
        bannerText = lm.GetProBadge() + "  •  Every Pro feature is unlocked. Thank you for supporting the project."
    else if lm.IsTrialActive()
        bannerColor = t.textGold
        bannerText = lm.GetProBadge() + "  •  " + StrI(lm.GetTrialDaysRemaining()).Trim() + " days of Pro left before the archive locks again"
    end if
    DrawGlassPanelR(screen, L.panelX, L.panelY, L.panelW, 96, bannerColor, t.bgPanel, 16)
    screen.DrawText(TruncateText(bannerText, 104), L.panelX + 24, L.panelY + 22, t.textPrimary, fonts.heading)
    screen.DrawText("Purchases are handled by Roku Pay and appear on your Roku account statement.", L.panelX + 24, L.panelY + 60, t.textSecondary, fonts.caption)

    ' ── products ───────────────────────────────────────────────────────
    products = state.storeMgr.GetDisplayList()
    state.storeIdx = ClampI(state.storeIdx, 0, StoreRowCount() - 1)

    if not state.storeMgr.IsAvailable()
        DrawGlassPanelR(screen, L.panelX, L.rowsY, L.panelW, 200, t.dangerRed, t.bgPanel, 16)
        screen.DrawText("Roku Pay is unavailable", L.panelX + 24, L.rowsY + 30, t.textPrimary, fonts.title)
        screen.DrawText("This device or account cannot complete in-channel purchases right now.", L.panelX + 24, L.rowsY + 92, t.textSecondary, fonts.body)
        screen.DrawText("The rest of the channel stays fully usable in free mode.", L.panelX + 24, L.rowsY + 128, t.textSecondary, fonts.caption)
    else
        for i = 0 to products.Count() - 1
            product = products[i]
            rowY = L.rowsY + (i * L.rowH)
            isFocused = (state.storeIdx = i)
            DrawProductRow(screen, state, product, L.panelX, rowY, L.panelW, L.rowH - 18, isFocused)
        end for

        ' Restore row.
        restoreY = L.rowsY + (products.Count() * L.rowH)
        restoreFocused = (state.storeIdx = products.Count())
        bg = t.bgPanelLight
        border = t.borderSubtle
        if restoreFocused
            bg = t.accentSoft
            border = t.borderFocused
        end if
        DrawGlassPanelR(screen, L.panelX, restoreY, L.panelW, 96, border, bg, 14)
        screen.DrawText("Restore Purchases", L.panelX + 24, restoreY + 22, t.textPrimary, fonts.heading)
        screen.DrawText("Re-read every Roku Pay entitlement attached to this Roku account.", L.panelX + 24, restoreY + 58, t.textSecondary, fonts.caption)
        if restoreFocused then DrawFocusRingAnimated(screen, L.panelX, restoreY, L.panelW, 96, t.borderFocused, 14, CalcGlowAlpha(state, 200))
    end if

    ' ── what's included ────────────────────────────────────────────────
    DrawGlassPanelR(screen, L.infoX, L.panelY, L.infoW, 470, t.borderSubtle, t.bgPanel, 18)
    screen.DrawText("What Pro Unlocks", L.infoX + 20, L.panelY + 18, t.textPrimary, fonts.heading)

    perks = [
        "All 6 Liquid Glass theme palettes",
        "Unlimited Ambient Mode rotation",
        "Auto-rotation pools: 4K, favourites, daily",
        "Menu backdrop wallpaper",
        "Custom rotation intervals",
        "Full 4K UHD archive in the viewer",
        "Search across 7,500 wallpapers",
        "Supports an independent project"
    ]
    for i = 0 to perks.Count() - 1
        screen.DrawText("+  " + perks[i], L.infoX + 20, L.panelY + 60 + (i * 34), t.textSecondary, fonts.caption)
    end for

    ' ── trial / status panel ───────────────────────────────────────────
    statusY = L.panelY + 490
    DrawGlassPanelR(screen, L.infoX, statusY, L.infoW, 320, t.borderSubtle, t.bgPanel, 18)
    screen.DrawText("Your Licence", L.infoX + 20, statusY + 18, t.textPrimary, fonts.heading)

    DrawBadge(screen, lm.GetProBadge(), L.infoX + 20, statusY + 58, t.btnFocused, t.textOnAccent, fonts.caption)

    statusLines = [
        "Lifetime: " + YesNo(lm.hasFullVersion),
        "Subscription: " + YesNo(lm.HasActiveSubscription()),
        "Trial: " + YesNo(lm.IsTrialActive()),
        "Purchases: " + StrI(lm.purchaseCount).Trim()
    ]
    for i = 0 to statusLines.Count() - 1
        screen.DrawText(statusLines[i], L.infoX + 20, statusY + 104 + (i * 30), t.textSecondary, fonts.caption)
    end for

    if state.storeMgr.LastError() <> ""
        screen.DrawText(TruncateText(state.storeMgr.LastError(), 40), L.infoX + 20, statusY + 240, t.dangerRed, fonts.caption)
    else if state.storeMgr.IsBusy()
        screen.DrawText("Contacting Roku Pay...", L.infoX + 20, statusY + 240, t.textAccent, fonts.caption)
    else if state.storeMgr.catalogReady
        screen.DrawText("Prices confirmed by Roku Pay.", L.infoX + 20, statusY + 240, t.successGreen, fonts.caption)
    end if

    DrawViewFooter(screen, state, "Up/Down select   OK buy or restore   Play start the 3-day trial   Back return")
end sub

sub DrawProductRow(screen as object, state as object, product as object, x as integer, y as integer, w as integer, h as integer, isFocused as boolean)
    t = GetTheme()
    fonts = state.fonts

    bg = t.bgPanelLight
    border = t.borderSubtle
    if isFocused
        bg = t.accentSoft
        border = t.borderFocused
    end if

    DrawGlassPanelR(screen, x, y, w, h, border, bg, 14)

    ' Colour bar keyed to the product tier.
    tierColor = t.textAccent
    if SafeStr(product.kind) = "lifetime" then tierColor = t.textGold
    if SafeStr(product.kind) = "yearly" then tierColor = t.successGreen
    screen.DrawRect(x + 4, y + 14, 6, h - 28, tierColor)

    screen.DrawText(SafeStr(product.name), x + 28, y + 14, t.textPrimary, fonts.heading)
    screen.DrawText(TruncateText(SafeStr(product.tagline), 84), x + 28, y + 48, t.textSecondary, fonts.caption)

    features = product.features
    for i = 0 to features.Count() - 1
        if i > 2 then exit for
        screen.DrawText("-  " + SafeStr(features[i]), x + 28, y + 74 + (i * 22), t.textMuted, fonts.caption)
    end for

    priceText = SafeStr(product.cost)
    priceW = fonts.title.GetOneLineWidth(priceText, 1920)
    screen.DrawText(priceText, x + w - priceW - 24, y + 18, t.textPrimary, fonts.title)

    ctaLabel = "PURCHASE"
    if SafeStr(product.kind) <> "lifetime" then ctaLabel = "SUBSCRIBE"
    if state.licenseMgr.hasFullVersion and SafeStr(product.kind) = "lifetime" then ctaLabel = "OWNED"
    ctaW = BadgeWidth(ctaLabel, fonts.caption)
    DrawBadge(screen, ctaLabel, x + w - ctaW - 24, y + h - 44, t.btnFocused, t.textOnAccent, fonts.caption)

    if isFocused then DrawFocusRingAnimated(screen, x, y, w, h, t.borderFocused, 14, CalcGlowAlpha(state, 200))
end sub
