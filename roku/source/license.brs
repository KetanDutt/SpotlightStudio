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
    mgr = {
        section: CreateObject("roRegistrySection", "SpotlightStudio_License"),
        ' Trial window, in epoch SECONDS.  See WallSeconds() below for why this
        ' is not a monotonic roTimespan any more.
        trialStartedSec: 0,
        trialDurationSec: 259200, ' 3 days

        hasFullVersion: false,   ' lifetime product purchased
        ' Subscription expiry as Unix epoch SECONDS, not milliseconds: a
        ' millisecond epoch is ~1.8e12, which does not fit in a 32-bit
        ' BrightScript Integer.  Epoch seconds stay inside int32 until 2038.
        proExpiresAtSec: 0,      ' 0 = no subscription
        proProductCode: "",
        purchaseCount: 0,

        ' Wall clock in Unix epoch seconds, used for the trial window and for
        ' subscription expiry.
        '
        ' The trial used to be stored against a monotonic roTimespan that starts
        ' at ~0 on every launch, so `trialStartedSec` was re-seeded each time the
        ' channel started and the three-day window never actually elapsed.  The
        ' epoch wall clock is the only thing that survives a reboot.
        WallSeconds: function() as integer
            wall = CreateObject("roDateTime")
            if wall = invalid then return 0
            return wall.AsSeconds()
        end function,

        ' Trial start/expiry bookkeeping, in epoch SECONDS (see the note above
        ' the fields: a millisecond epoch does not fit in a 32-bit Integer).
        TrialSecondsPerDay: 86400,

        Load: function() as void
            m.hasFullVersion = false
            m.proExpiresAtSec = 0
            m.proProductCode = ""
            m.purchaseCount = 0
            if m.section = invalid then return

            if m.section.Exists("trialStartedSec")
                stored = SafeStr(m.section.Read("trialStartedSec"))
                if stored <> "" then m.trialStartedSec = CInt(Val(stored))
            else if m.section.Exists("trialStarted")
                ' Migration: the old value was a monotonic roTimespan reading
                ' from the launch that started the trial, which is meaningless
                ' after a reboot.  Restart the window rather than honouring a
                ' timestamp that can never expire.
                m.trialStartedSec = 0
            end if
            if m.trialStartedSec < 0 then m.trialStartedSec = 0
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
            m.section.Write("trialStartedSec", StrI(m.trialStartedSec).Trim())
            m.section.Flush()
        end function,

        FlagStr: function(value as boolean) as string
            if value then return "1"
            return "0"
        end function,

        ' ── trial ────────────────────────────────────────────────────────

        StartTrial: function() as void
            m.trialStartedSec = m.WallSeconds()
            if m.section <> invalid
                m.section.Write("trialStartedSec", StrI(m.trialStartedSec).Trim())
                m.section.Flush()
            end if
            LogInfo("3-day Spotlight Pro trial started")
        end function,

        IsTrialActive: function() as boolean
            ' A trial started before the Roku clock was valid (epoch 0, or a
            ' device that has never synced) would expire instantly; treat a
            ' wall clock below 2016 as "not started" rather than "expired".
            if m.trialStartedSec <= 0 then return false
            if m.WallSeconds() < 1451606400 then return true
            elapsed = m.WallSeconds() - m.trialStartedSec
            return elapsed < m.trialDurationSec and elapsed >= 0
        end function,

        GetTrialDaysRemaining: function() as integer
            if not m.IsTrialActive() then return 0
            remaining = m.trialDurationSec - (m.WallSeconds() - m.trialStartedSec)
            days = CInt(remaining / m.TrialSecondsPerDay)
            if days < 0 then days = 0
            return days
        end function,

        ' Epoch seconds at which the trial lapses (0 when no trial is running).
        TrialEndsAtSec: function() as integer
            if m.trialStartedSec <= 0 then return 0
            return m.trialStartedSec + m.trialDurationSec
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
            if m.trialStartedSec > 0 then return "Trial expired - Pro features are locked"
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
                ' hasFullVersion is deliberately left alone here: it records a
                ' LIFETIME purchase, and a subscription must never clear it.
                ' The previous code set it to false unconditionally, so buying a
                ' monthly plan after owning Pro Lifetime demoted the customer.
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

            ' Recomputed from scratch, not merged into the previous state.
            ' Seeding these from the current values meant a subscription that
            ' Roku has already lapsed kept granting Pro access forever (Roku Pay
            ' requirement RP4.3).  `applied = 0` below still protects a local
            ' purchase when GetPurchases() cannot be reached.
            lifetime = false
            bestExpiry = 0
            bestCode = ""
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

            ' A lifetime purchase can only ever be granted by this sync; a
            ' subscription window is authoritative in both directions.
            newFull = lifetime
            changed = (newFull <> m.hasFullVersion) or (bestExpiry <> m.proExpiresAtSec) or (bestCode <> m.proProductCode)
            if not changed then return

            m.hasFullVersion = newFull
            m.proExpiresAtSec = bestExpiry
            m.proProductCode = bestCode
            m.Persist()
            LogInfo("Roku Pay entitlements synced (" + StrI(applied).Trim() + " products)")
        end function,

        ' ISO-8601 -> Unix epoch seconds.  Returns 0 when the value is missing
        ' or unparseable, which callers treat as "use the product's own term".
        '
        ' The roDateTime method is FromISO8601String().  FromISOString() does not
        ' exist - calling it raises a runtime error in the middle of purchase
        ' handling, which killed the channel the moment Roku Pay reported a
        ' subscription with an expirationDate.
        ParseIsoSeconds: function(iso as string) as integer
            if iso = invalid or Len(iso) < 10 then return 0
            dt = CreateObject("roDateTime")
            if dt = invalid then return 0
            ok = dt.FromISO8601String(iso)
            if not ok then return 0
            return dt.AsSeconds()
        end function,

        ' ── developer helpers ────────────────────────────────────────────
        ' Gated on IsDevBuild() so a shipped channel cannot be talked into
        ' expiring its own trial or wiping a customer's entitlements.

        ResetForTesting: function() as void
            if not IsDevBuild() then return
            m.trialStartedSec = 0
            m.hasFullVersion = false
            m.proExpiresAtSec = 0
            m.proProductCode = ""
            m.purchaseCount = 0
            if m.section <> invalid
                m.section.Delete("trialStarted")
                m.section.Delete("trialStartedSec")
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
            m.trialStartedSec = m.WallSeconds() - (m.trialDurationSec + 60)
            if m.section <> invalid
                m.section.Write("trialStartedSec", StrI(m.trialStartedSec).Trim())
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
