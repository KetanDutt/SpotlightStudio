' Spotlight Studio for Roku
' license.brs - License management, 3-day trial tracking, and IAP entitlement verification

function CreateLicenseManager() as object
    mgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_License"),
        
        ' License state
        trialStartEpoch: 0,
        trialDurationSeconds: 259200, ' 3 days = 3 * 24 * 3600 seconds = 72 hours
        hasFullVersion: false,
        hasMonthlySub: false,
        hasYearlySub: false,
        
        Init: function()
            now = CreateObject("roDateTime")
            currentEpoch = now.AsSeconds()
            
            if m.section = invalid then return invalid
            
            ' 1. First launch timestamp for 3-day trial
            if m.section.Exists("trial_start_epoch")
                m.trialStartEpoch = Val(m.section.Read("trial_start_epoch"))
            else
                m.trialStartEpoch = currentEpoch
                m.section.Write("trial_start_epoch", StrI(currentEpoch).Trim())
                m.section.Flush()
            end if
            
            ' 2. Full Version IAP ("BuyFullVersion")
            if m.section.Exists("entitlement_full")
                m.hasFullVersion = (m.section.Read("entitlement_full") = "true")
            end if
            
            ' 3. Subscriptions ("sub_monthly", "sub_yearly")
            if m.section.Exists("entitlement_sub_monthly")
                m.hasMonthlySub = (m.section.Read("entitlement_sub_monthly") = "true")
            end if
            if m.section.Exists("entitlement_sub_yearly")
                m.hasYearlySub = (m.section.Read("entitlement_sub_yearly") = "true")
            end if
        end function,
        
        GetTrialRemainingSeconds: function() as integer
            now = CreateObject("roDateTime")
            currentEpoch = now.AsSeconds()
            elapsed = currentEpoch - m.trialStartEpoch
            if elapsed < 0 then elapsed = 0
            remaining = m.trialDurationSeconds - elapsed
            if remaining < 0 then remaining = 0
            return remaining
        end function,
        
        GetTrialRemainingHours: function() as integer
            sec = m.GetTrialRemainingSeconds()
            return CInt((sec + 3599) / 3600)
        end function,
        
        IsTrialActive: function() as boolean
            return (m.GetTrialRemainingSeconds() > 0)
        end function,
        
        HasActiveSubscription: function() as boolean
            return m.hasMonthlySub or m.hasYearlySub
        end function,
        
        ' Manual wallpaper / screensaver setting:
        ' Allowed during active 3-day trial, or after purchasing BuyFullVersion, or with active subscription
        CanChangeWallpaperManually: function() as boolean
            return m.IsTrialActive() or m.hasFullVersion or m.HasActiveSubscription()
        end function,
        
        ' Automatic switching of wallpaper and screensaver:
        ' Allowed during active 3-day trial, or with active monthly/yearly subscription
        CanAutoSwitch: function() as boolean
            return m.IsTrialActive() or m.HasActiveSubscription()
        end function,
        
        RecordPurchase: function(sku as string) as boolean
            skuLower = LCase(sku)
            if m.section = invalid then return false
            
            if skuLower = "buyfullversion" or Instr(1, skuLower, "full") > 0
                m.hasFullVersion = true
                m.section.Write("entitlement_full", "true")
                m.section.Flush()
                return true
            else if skuLower = "sub_monthly" or Instr(1, skuLower, "monthly") > 0
                m.hasMonthlySub = true
                m.section.Write("entitlement_sub_monthly", "true")
                m.section.Flush()
                return true
            else if skuLower = "sub_yearly" or Instr(1, skuLower, "yearly") > 0
                m.hasYearlySub = true
                m.section.Write("entitlement_sub_yearly", "true")
                m.section.Flush()
                return true
            end if
            return false
        end function,
        
        GetStatusBadge: function() as string
            if m.hasYearlySub
                return "PRO YEARLY"
            else if m.hasMonthlySub
                return "PRO MONTHLY"
            else if m.hasFullVersion
                return "FULL VERSION"
            else if m.IsTrialActive()
                h = m.GetTrialRemainingHours()
                if h > 24
                    days = CInt(h / 24)
                    return "TRIAL: " + StrI(days).Trim() + " DAYS LEFT"
                else
                    return "TRIAL: " + StrI(h).Trim() + " HOURS LEFT"
                end if
            else
                return "TRIAL EXPIRED"
            end if
        end function,
        
        ResetForTesting: function()
            now = CreateObject("roDateTime")
            m.trialStartEpoch = now.AsSeconds()
            m.hasFullVersion = false
            m.hasMonthlySub = false
            m.hasYearlySub = false
            if m.section <> invalid
                m.section.Delete("entitlement_full")
                m.section.Delete("entitlement_sub_monthly")
                m.section.Delete("entitlement_sub_yearly")
                m.section.Write("trial_start_epoch", StrI(m.trialStartEpoch).Trim())
                m.section.Flush()
            end if
        end function,
        
        ExpireTrialForTesting: function()
            now = CreateObject("roDateTime")
            m.trialStartEpoch = now.AsSeconds() - m.trialDurationSeconds - 100
            m.hasFullVersion = false
            m.hasMonthlySub = false
            m.hasYearlySub = false
            if m.section <> invalid
                m.section.Delete("entitlement_full")
                m.section.Delete("entitlement_sub_monthly")
                m.section.Delete("entitlement_sub_yearly")
                m.section.Write("trial_start_epoch", StrI(m.trialStartEpoch).Trim())
                m.section.Flush()
            end if
        end function
    }
    mgr.Init()
    return mgr
end function
