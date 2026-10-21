' Spotlight Studio for Roku
' license.brs - Trial state machine and Pro entitlements.
'
' Entitlements come from two places and are merged:
'   * the local registry, so the channel is usable the moment it launches;
'   * Roku Pay's GetPurchases(), re-read on every launch, so a purchase made on
'     another device tied to the same Roku account is honoured and a lapsed
'     subscription stops granting access (certification RP4.3).
'
' Subscriptions are expiry-aware: `proExpiresAtSec` is taken from Roku's
' `expirationDate` when it is present, and only the "lifetime" product grants
' access forever.

function CreateLicenseManager() as object
    oneDayMs = 86400000

    mgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_License"),
        trialStartedMs: 0,
        trialDurationMs: oneDayMs * 3,
        oneDayMs: oneDayMs,

        hasFullVersion: false,   ' lifetime product purchased
        ' Subscription expiry as Unix epoch SECONDS, not milliseconds: a
        ' millisecond epoch is ~1.8e12, which does not fit in a 32-bit
        ' BrightScript Integer.  Epoch seconds stay inside int32 until 2038.
        proExpiresAtSec: 0,      ' 0 = no subscription
        proProductCode: "",
        purchaseCount: 0,

        ' Monotonic clock, used for the short-lived trial window.
        NowMs: function() as integer
            if m.__clock = invalid
                m.__clock = CreateObject("roTimespan")
                m.__clock.Mark()
            end if
            return m.__clock.TotalMilliseconds()
        end function,

        ' Wall clock in Unix epoch seconds, used for subscription expiry.
        WallSeconds: function() as integer
            wall = CreateObject("roDateTime")
            if wall = invalid then return 0
            return wall.AsSeconds()
        end function,

        Load: function() as void
            m.hasFullVersion = false
            m.proExpiresAtSec = 0
            m.proProductCode = ""
            m.purchaseCount = 0
            if m.section = invalid then return

            if m.section.Exists("trialStarted")
                stored = SafeStr(m.section.Read("trialStarted"))
                if stored <> "" then m.trialStartedMs = Val(stored)
            end if
            if m.section.Exists("hasFullVersion") then m.hasFullVersion = (Val(SafeStr(m.section.Read("hasFullVersion"))) = 1)
            if m.section.Exists("proExpiresAt")
                stored = SafeStr(m.section.Read("proExpiresAt"))
                if stored <> "" then m.proExpiresAtSec = CInt(Val(stored))
            end if
            if m.section.Exists("proProductCode") then m.proProductCode = SafeStr(m.section.Read("proProductCode"))
            if m.section.Exists("purchaseCount")
                stored = SafeStr(m.section.Read("purchaseCount"))
                if stored <> "" then m.purchaseCount = Val(stored)
            end if
        end function,

        Persist: function() as void
            if m.section = invalid then return
            m.section.Write("hasFullVersion", m.FlagStr(m.hasFullVersion))
            m.section.Write("proExpiresAt", StrI(m.proExpiresAtSec).Trim())
            m.section.Write("proProductCode", m.proProductCode)
            m.section.Write("purchaseCount", StrI(m.purchaseCount).Trim())
            m.section.Flush()
        end function,

        FlagStr: function(value as boolean) as string
            if value then return "1"
            return "0"
        end function,

        ' ── trial ────────────────────────────────────────────────────────

        StartTrial: function() as void
            m.trialStartedMs = m.NowMs()
            if m.section <> invalid
                m.section.Write("trialStarted", StrI(m.trialStartedMs).Trim())
                m.section.Flush()
            end if
            LogInfo("3-day Spotlight Pro trial started")
        end function,

        IsTrialActive: function() as boolean
            if m.trialStartedMs = 0 then return false
            elapsed = m.NowMs() - m.trialStartedMs
            return elapsed < m.trialDurationMs
        end function,

        GetTrialDaysRemaining: function() as integer
            if not m.IsTrialActive() then return 0
            remaining = m.trialDurationMs - (m.NowMs() - m.trialStartedMs)
            days = CInt(remaining / m.oneDayMs)
            if days < 0 then days = 0
            return days
        end function,

        ' ── entitlements ─────────────────────────────────────────────────

        HasActiveSubscription: function() as boolean
            if m.proExpiresAtSec = 0 then return false
            return m.proExpiresAtSec > m.WallSeconds()
        end function,

        ' Anything that unlocks Pro content: a lifetime purchase or a
        ' subscription that has not expired.
        HasProAccess: function() as boolean
            return m.hasFullVersion or m.HasActiveSubscription()
        end function,

        GetProBadge: function() as string
            if m.hasFullVersion then return "PRO LIFETIME"
            if m.HasActiveSubscription()
                remainingDays = CInt((m.proExpiresAtSec - m.WallSeconds()) / 86400)
                if remainingDays < 1 then remainingDays = 1
                return "PRO " + StrI(remainingDays).Trim() + "D"
            end if
            if m.IsTrialActive() then return "TRIAL " + StrI(m.GetTrialDaysRemaining()).Trim() + "D"
            return "TRIAL ENDED"
        end function,

        GetStatusBadge: function() as string
            if m.hasFullVersion then return "PRO"
            if m.HasActiveSubscription() then return "PRO SUB"
            if m.IsTrialActive() then return "TRIAL " + StrI(m.GetTrialDaysRemaining()).Trim() + "D"
            return "FREE"
        end function,

        GetLicenseSummary: function() as string
            if m.hasFullVersion then return "Pro Lifetime - thank you for supporting Spotlight Studio"
            if m.HasActiveSubscription()
                remainingDays = CInt((m.proExpiresAtSec - m.WallSeconds()) / 86400)
                return "Pro subscription active - " + StrI(remainingDays).Trim() + " days remaining"
            end if
            if m.IsTrialActive()
                return "Trial active - " + StrI(m.GetTrialDaysRemaining()).Trim() + " days remaining"
            end if
            if m.trialStartedMs > 0 then return "Trial expired - Pro features are locked"
            return "Free mode - start the 3-day Pro trial from Settings"
        end function,

        ' ── purchases ────────────────────────────────────────────────────

        ' Record a completed purchase.  `expirationDate` is Roku's ISO-8601
        ' subscription expiry; pass "" for a one-time product.
        RecordPurchase: function(product as object, expirationDate as string) as void
            if product = invalid then return

            kind = SafeStr(product.kind)
            m.purchaseCount = m.purchaseCount + 1
            m.proProductCode = SafeStr(product.code)

            if kind = "lifetime"
                m.hasFullVersion = true
                m.proExpiresAtSec = 0
            else
                expiry = m.ParseIsoSeconds(expirationDate)
                if expiry <= 0
                    ' No expiry reported: assume the product's natural term so a
                    ' purchase is never silently ignored.
                    if kind = "monthly"
                        expiry = m.WallSeconds() + (86400 * 30)
                    else
                        expiry = m.WallSeconds() + (86400 * 365)
                    end if
                end if
                if expiry > m.proExpiresAtSec then m.proExpiresAtSec = expiry
                m.hasFullVersion = false
            end if

            m.Persist()
            LogInfo("Entitlement updated: " + SafeStr(product.code) + " -> " + m.GetProBadge())
        end function,

        ' Merge a GetPurchases() response into the local entitlement state.
        ' Called on every launch so purchases made on another device tied to the
        ' same Roku account are honoured.
        ApplyPurchases: function(purchases as object) as void
            if purchases = invalid then return
            if type(purchases) <> "roList" and type(purchases) <> "roArray" then return

            lifetime = false
            bestExpiry = m.proExpiresAtSec
            bestCode = m.proProductCode
            applied = 0

            for each entry in purchases
                if entry <> invalid
                    code = SafeStr(entry.code)
                    product = StoreProductByCode(code)
                    if product <> invalid
                        applied = applied + 1
                        if SafeStr(product.kind) = "lifetime"
                            lifetime = true
                            bestCode = code
                        else
                            expiry = m.ParseIsoSeconds(SafeStr(entry.expirationDate))
                            if expiry > bestExpiry
                                bestExpiry = expiry
                                bestCode = code
                            end if
                        end if
                    end if
                end if
            end for

            if applied = 0 then return

            changed = (lifetime <> m.hasFullVersion) or (bestExpiry <> m.proExpiresAtSec) or (bestCode <> m.proProductCode)
            if not changed then return

            m.hasFullVersion = lifetime or m.hasFullVersion
            m.proExpiresAtSec = bestExpiry
            if bestCode <> "" then m.proProductCode = bestCode
            m.Persist()
            LogInfo("Roku Pay entitlements synced (" + StrI(applied).Trim() + " products)")
        end function,

        ' ISO-8601 -> Unix epoch seconds.  Returns 0 when the value is missing
        ' or unparseable, which callers treat as "use the product's own term".
        ParseIsoSeconds: function(iso as string) as integer
            if iso = invalid or Len(iso) < 10 then return 0
            dt = CreateObject("roDateTime")
            if dt = invalid then return 0
            ok = dt.FromISOString(iso)
            if not ok then return 0
            return dt.AsSeconds()
        end function,

        ' ── developer helpers ────────────────────────────────────────────
        ' Gated on IsDevBuild() so a shipped channel cannot be talked into
        ' expiring its own trial or wiping a customer's entitlements.

        ResetForTesting: function() as void
            if not IsDevBuild() then return
            m.trialStartedMs = 0
            m.hasFullVersion = false
            m.proExpiresAtSec = 0
            m.proProductCode = ""
            m.purchaseCount = 0
            if m.section <> invalid
                m.section.Delete("trialStarted")
                m.section.Delete("hasFullVersion")
                m.section.Delete("proExpiresAt")
                m.section.Delete("proProductCode")
                m.section.Delete("purchaseCount")
                m.section.Flush()
            end if
            LogInfo("Licence state reset (developer build only)")
        end function,

        ExpireTrialForTesting: function() as void
            if not IsDevBuild() then return
            m.trialStartedMs = m.NowMs() - (m.trialDurationMs + 1000)
            if m.section <> invalid
                m.section.Write("trialStarted", StrI(m.trialStartedMs).Trim())
                m.section.Flush()
            end if
            LogInfo("Trial forced to expire (developer build only)")
        end function,

        ' Grant Pro without a transaction.  Developer builds only.
        GrantProForTesting: function(kind as string) as void
            if not IsDevBuild() then return
            product = { code: "dev_" + kind, name: "Developer " + kind, kind: kind }
            m.RecordPurchase(product, "")
        end function
    }

    mgr.Load()
    return mgr
end function
