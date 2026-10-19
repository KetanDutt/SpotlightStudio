' Spotlight Studio for Roku
' view_store.brs - Pro Store & Upgrades view (3-Day Trial, Full Version IAP, Monthly/Yearly Subscriptions)

sub RenderStoreView(screen as object, state as object)
    t = GetTheme()
    fonts = state.fonts
    lm = state.licenseMgr
    sm = state.storeMgr
    
    ' 1. Clear Background
    screen.Clear(t.bgMain)
    
    ' 2. Header
    screen.DrawRect(0, 0, 1920, 120, t.bgHeader)
    screen.DrawRect(0, 119, 1920, 1, t.borderSubtle)
    screen.DrawText("SPOTLIGHT PRO STORE & UPGRADES", 85, 24, t.textPrimary, fonts.title)
    
    ' License status badge
    statusBadge = lm.GetStatusBadge()
    badgeColor = t.btnNormal
    if lm.IsTrialActive() then badgeColor = t.textAccent
    if lm.hasFullVersion then badgeColor = t.badgeFhd
    if lm.HasActiveSubscription() then badgeColor = t.badge4k
    DrawBadge(screen, statusBadge, 1580, 32, badgeColor, t.textPrimary, fonts.small)
    
    ' Subheader with trial description
    trialDesc = ""
    if lm.IsTrialActive()
        hoursLeft = lm.GetTrialRemainingHours()
        trialDesc = "3-Day Free Trial Active: " + StrI(hoursLeft).Trim() + " hours remaining. All manual & auto-switching features unlocked!"
    else if lm.HasActiveSubscription()
        trialDesc = "Pro Subscription Active: Unlimited auto-switching, background rotation, and all 7,400+ wallpapers unlocked."
    else if lm.hasFullVersion
        trialDesc = "Full Version Owned: Manual wallpaper & screensaver changers unlocked for lifetime. Subscribe for auto-switching."
    else
        trialDesc = "Your 3-day free trial has expired. Purchase Full Version ($4.99) for manual changes, or subscribe for auto-switching."
    end if
    screen.DrawText(trialDesc, 85, 78, t.textSecondary, fonts.caption)
    
    ' 3. Products Grid (3 Cards: Full Version, Pro Monthly, Pro Yearly)
    cardW = 540
    cardH = 680
    cardGap = 35
    startX = 105
    startY = 150
    
    products = sm.products
    
    for i = 0 to products.Count() - 1
        prod = products[i]
        cardX = startX + (i * (cardW + cardGap))
        isFocused = (state.storeCardIdx = i)
        
        ' Determine ownership / active status
        isOwned = false
        if prod.sku = "BuyFullVersion" and lm.hasFullVersion
            isOwned = true
        else if prod.sku = "sub_monthly" and lm.hasMonthlySub
            isOwned = true
        else if prod.sku = "sub_yearly" and lm.hasYearlySub
            isOwned = true
        end if
        
        ' Card background & border with smooth elevation pop
        drawCardX = cardX
        drawCardY = startY
        drawCardW = cardW
        drawCardH = cardH
        cardRadius = 16
        
        cardBg = t.bgPanel
        borderClr = t.borderSubtle
        if isFocused
            drawCardX = cardX - 4
            drawCardY = startY - 4
            drawCardW = cardW + 8
            drawCardH = cardH + 8
            cardRadius = 18
            cardBg = &h121728EE
            borderClr = t.borderFocused
        end if
        
        DrawGlassPanelR(screen, drawCardX, drawCardY, drawCardW, drawCardH, borderClr, cardBg, cardRadius)
        
        ' Card Header Badge
        headerBadgeColor = t.btnNormal
        if i = 0 then headerBadgeColor = t.badgeFhd
        if i = 1 then headerBadgeColor = t.textAccent
        if i = 2 then headerBadgeColor = t.badge4k
        DrawBadge(screen, prod.badge, drawCardX + 30, drawCardY + 28, headerBadgeColor, t.textPrimary, fonts.caption)
        
        ' Product Title
        screen.DrawText(prod.title, drawCardX + 30, drawCardY + 70, t.textPrimary, fonts.heading)
        
        ' Price Banner with rounded corners
        DrawRoundRect(screen, drawCardX + 30, drawCardY + 120, drawCardW - 60, 56, 10, &h00000066)
        DrawRoundedOutline(screen, drawCardX + 30, drawCardY + 120, drawCardW - 60, 56, 10, borderClr, 1)
        screen.DrawText(prod.price, drawCardX + 45, drawCardY + 130, t.textAccent, fonts.title)
        
        typeStr = prod.type
        screen.DrawText(typeStr, drawCardX + 280, drawCardY + 138, t.textMuted, fonts.small)
        
        ' Features Checklist
        featY = drawCardY + 205
        lineH = 46
        
        if prod.sku = "BuyFullVersion"
            DrawStoreFeature(screen, drawCardX + 35, featY, true, "Manual Roku Home Wallpaper Changer", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH, true, "Manual Roku TV Screensaver Setter", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 2, true, "Full 7,474+ Wallpaper Library", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 3, true, "Unlimited Favorites & 4K Downloads", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 4, true, "Lifetime License — One-time Payment", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 5, false, "Auto-Switching requires Subscription", fonts.body, t)
        else if prod.sku = "sub_monthly"
            DrawStoreFeature(screen, drawCardX + 35, featY, true, "Automatic Wallpaper & Screensaver Switch", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH, true, "Custom Intervals (1 min, 5 min, Daily)", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 2, true, "All 5 Liquid Glass Roku Theme Palettes", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 3, true, "All Full Version & Screensaver Features", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 4, true, "Continuous Daily Spotlight Auto-Sync", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 5, true, "Cancel Anytime via Roku Account", fonts.body, t)
        else if prod.sku = "sub_yearly"
            DrawStoreFeature(screen, drawCardX + 35, featY, true, "Everything in Pro Monthly Included", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH, true, "37% Discount vs Monthly ($1.25 / mo)", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 2, true, "Priority High-Bandwidth Image Sync", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 3, true, "VIP Early Feature & Theme Access", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 4, true, "Full Automatic Home & Screensaver Engine", fonts.body, t)
            DrawStoreFeature(screen, drawCardX + 35, featY + lineH * 5, true, "Billed Annually at $14.99/yr", fonts.body, t)
        end if
        
        ' Purchase Button with rounded corners
        btnW = drawCardW - 60
        btnH = 58
        btnX = drawCardX + 30
        btnY = drawCardY + drawCardH - 85
        btnRadius = 10
        
        btnLabel = "PURCHASE " + prod.price
        if isOwned
            btnLabel = "✓ CURRENTLY ACTIVE"
            DrawRoundRect(screen, btnX, btnY, btnW, btnH, btnRadius, &h10B98133)
            DrawRoundedOutline(screen, btnX, btnY, btnW, btnH, btnRadius, t.badge4k, 2)
            screen.DrawText(btnLabel, btnX + 110, btnY + 16, t.badge4k, fonts.body)
        else
            btnBg = t.btnNormal
            btnBorder = t.borderSubtle
            textColor = t.textPrimary
            if isFocused
                btnBg = t.btnFocused
                btnBorder = t.borderFocused
                textColor = t.bgMain
            end if
            DrawRoundRect(screen, btnX, btnY, btnW, btnH, btnRadius, btnBg)
            DrawRoundedOutline(screen, btnX, btnY, btnW, btnH, btnRadius, btnBorder, 2)
            screen.DrawText(btnLabel, btnX + 90, btnY + 16, textColor, fonts.body)
        end if
        
        if isFocused
            glow = 255
            if state.glowAlpha <> invalid then glow = state.glowAlpha
            DrawFocusRingAnimated(screen, drawCardX, drawCardY, drawCardW, drawCardH, t.borderFocused, cardRadius, glow)
        end if
    end for
    
    ' 4. Bottom Utility Bar: Restore Purchases & Trial Testing
    utilY = 860
    utilH = 80
    DrawGlassPanelR(screen, 105, utilY, 1710, utilH, t.borderSubtle, t.bgPanel, 14)
    
    isRestoreFocused = (state.storeCardIdx = 3)
    restoreBg = t.btnNormal
    restoreBorder = t.borderSubtle
    restoreRadius = 8
    if isRestoreFocused
        restoreBg = t.btnFocused
        restoreBorder = t.borderFocused
    end if
    DrawRoundRect(screen, 135, utilY + 16, 260, 48, restoreRadius, restoreBg)
    DrawRoundedOutline(screen, 135, utilY + 16, 260, 48, restoreRadius, restoreBorder, 2)
    restoreTextColor = t.textPrimary
    screen.DrawText("Restore Purchases", 170, utilY + 28, restoreTextColor, fonts.body)
    
    screen.DrawText("Purchases are securely linked to your Roku Account across all your devices.", 425, utilY + 30, t.textSecondary, fonts.caption)
    
    ' 5. Footer Bar
    screen.DrawRect(0, 970, 1920, 110, t.bgFooter)
    screen.DrawRect(0, 970, 1920, 2, t.borderSubtle)
    screen.DrawText("[◄ / ►] Choose Product     [OK] Buy / Subscribe via Roku Pay     [Back] Return to Gallery", 85, 1010, t.textSecondary, fonts.body)
end sub

sub DrawStoreFeature(screen as object, x as integer, y as integer, isIncluded as boolean, text as string, font as object, t as object)
    if isIncluded
        screen.DrawText("✓", x, y, t.badge4k, font)
        screen.DrawText(text, x + 30, y, t.textPrimary, font)
    else
        screen.DrawText("✕", x, y, t.textMuted, font)
        screen.DrawText(text, x + 30, y, t.textMuted, font)
    end if
end sub
