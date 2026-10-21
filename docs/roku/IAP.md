# Roku Pay (Spotlight Pro)

## Product model

Three in-channel products, defined once in `store.brs::StoreProducts()` and
matched by their **Product Identifier** (the exact string from the Developer
Dashboard's In-App Products page):

| Code | Kind | Notes |
|---|---|---|
| `spotlight_pro_lifetime` | one-time | Grants Pro forever |
| `spotlight_pro_yearly` | subscription | Expiry taken from Roku's `expirationDate` |
| `spotlight_pro_monthly` | subscription | Expiry taken from Roku's `expirationDate` |

The display price shown before Roku answers is a placeholder.  The
authoritative localised price comes from `GetCatalog()`'s `cost` field; the
store view shows a "Prices confirmed by Roku Pay" line once that request
completes.  Create the three products in the dashboard before testing
purchases — `GetCatalog()` returns nothing for products that do not exist.

## Purchase flow (exactly the documented sequence)

```
GetCatalog()                 -> roChannelStoreEvent -> cache names/prices
   then automatically
GetPurchases()               -> roChannelStoreEvent -> merge entitlements
   on user confirmation
ClearOrder()
SetOrder([{ code, qty: 1 }])        # a LIST of items, not one order object
DoOrder()                           # takes NO arguments; blocks on the sheet
   -> roChannelStoreEvent with { code, purchaseID, amount, qty, total }
   then GetPurchases() again, so expiry comes from Roku and not from an
   assumed term
```

Three rules from the Roku Pay documentation shape `store.brs`:

1. **One `roChannelStore` instance** for the whole app lifetime — `DoOrder()`
   reads the product type cached by `GetCatalog()`, so a second instance
   cannot complete a purchase started by the first.
2. `SetOrder()` wants an **roList of `{ code, qty }`** associative arrays.
   (The previous code passed a single order object and then called
   `DoOrder(order)`, which is a runtime error.)
3. `DoOrder()` **blocks** while the Roku Pay sheet is up.  The store view
   paints and swaps a "Opening Roku Pay…" toast *before* calling it, so the
   user is never left staring at a frozen frame.

## Entitlements

`license.brs` merges two sources on every launch:

* the local registry (`hasFullVersion`, `proExpiresAtSec`, purchase count), so
  the channel is usable the instant it starts;
* `GetPurchases()`, so a purchase made on another device tied to the same Roku
  account is honoured and a **lapsed subscription stops granting access**.

Expiry is stored as Unix epoch **seconds**.  A millisecond epoch (~1.8e12)
does not fit a 32-bit BrightScript Integer; epoch seconds stay inside `int32`
until 2038 and survive the registry round-trip to within about a minute,
which is irrelevant next to a 30-day term.

| Product kind | Effect |
|---|---|
| lifetime | `hasFullVersion = true`, no expiry |
| monthly / yearly | `proExpiresAtSec = expirationDate`, or the product's natural term when Roku reports none |

`HasProAccess()` = lifetime **or** an unexpired subscription.  The trial is a
separate 3-day flag and does not interact with purchases.

## Trial and developer hooks

* The 3-day trial starts only from Settings / the store's Play shortcut and is
  refused if it was ever started on the device.
* `ResetForTesting()` / `ExpireTrialForTesting()` / `GrantProForTesting()` are
  guarded by `IsDevBuild()` (`roAppInfo.IsDev()`), i.e. sideloaded channels
  only.  A published build cannot be talked into wiping a customer's licence —
  the earlier version exposed those hooks through the Replay and FF keys in
  the store view for every user.

## What Pro does **not** do

Pro unlocks in-channel features only (all six palettes, unlimited Ambient
rotation and its pools, the menu backdrop, custom intervals).  It does **not**
change the Roku home screen wallpaper or the system screensaver: no channel
can, and claiming otherwise would fail certification 4.5 and mislead users.
