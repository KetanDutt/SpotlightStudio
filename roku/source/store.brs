' Spotlight Studio for Roku
' store.brs - Roku Pay (roChannelStore) integration.
'
' The purchase flow follows the documented BrightScript sequence exactly:
'
'   GetCatalog()   -> roChannelStoreEvent -> real product names + localised cost
'   GetPurchases() -> roChannelStoreEvent -> existing entitlements (cert RP4.3)
'   ClearOrder() / SetOrder([{ code, qty }]) / DoOrder()
'                  -> roChannelStoreEvent -> { code, purchaseID, amount, total }
'
' Three rules from the Roku Pay documentation shape this file:
'   * exactly one roChannelStore instance for the whole app lifetime - DoOrder()
'     reads the product type cached by GetCatalog(), so a second instance cannot
'     complete a purchase started by the first;
'   * SetOrder() takes a LIST of { code, qty } items, not a single order object;
'   * DoOrder() takes no arguments and blocks while the Roku Pay sheet is up.

' The in-app product identifiers.  These must match the "Product Identifier"
' entered on the In-App Products page of the Roku Developer Dashboard.  The
' display price shown before GetCatalog() answers is only a placeholder - Roku
' always returns the real, localised cost.
function StoreProducts() as object
    gaa = GetGlobalAA()
    if gaa.__ssProducts <> invalid then return gaa.__ssProducts

    gaa.__ssProducts = [
        {
            code: "spotlight_pro_lifetime",
            name: "Pro Lifetime Unlock",
            kind: "lifetime",
            tagline: "One-time payment. Permanent access to the full archive.",
            features: [
                "Unlock all 6 Liquid Glass theme palettes",
                "Unlimited 4K UHD Ambient Mode rotation",
                "Custom CDN endpoint override",
                "Ambient auto-switching with a custom pool",
                "Priority thumbnail delivery"
            ],
            fallbackPrice: "$14.99"
        },
        {
            code: "spotlight_pro_yearly",
            name: "Pro Yearly",
            kind: "yearly",
            tagline: "Every Pro feature, billed once a year.",
            features: [
                "All Pro Lifetime features",
                "Cancel any time from your Roku account",
                "Roughly the price of five months"
            ],
            fallbackPrice: "$6.99"
        },
        {
            code: "spotlight_pro_monthly",
            name: "Pro Monthly",
            kind: "monthly",
            tagline: "Every Pro feature, billed monthly.",
            features: [
                "All Pro Lifetime features",
                "Cancel any time from your Roku account"
            ],
            fallbackPrice: "$0.99"
        }
    ]
    return gaa.__ssProducts
end function

function StoreProductByCode(code as string) as object
    for each product in StoreProducts()
        if product.code = code then return product
    end for
    return invalid
end function

function CreateStoreManager(port as object, licenseMgr as object) as object
    store = CreateObject("roChannelStore")
    if store <> invalid then store.SetMessagePort(port)

    mgr = {
        port: port,
        store: store,
        licenseMgr: licenseMgr,

        ' Which request the next event belongs to: "catalog", "purchases",
        ' "order" or "".  GetCatalog()/GetPurchases() both answer with an
        ' roChannelStoreEvent and the payload shape differs, so the request has
        ' to be tracked rather than guessed from the response.
        pendingRequest: "",
        pendingCode: "",

        ' code -> { code, name, kind, tagline, features, cost, productType }
        catalog: {},
        catalogReady: false,
        lastError: "",
        busy: false,

        BuildCatalogFromProducts: function() as void
            m.catalog = {}
            for each product in StoreProducts()
                m.catalog[product.code] = {
                    code: product.code,
                    name: SafeStr(product.name),
                    kind: SafeStr(product.kind),
                    tagline: SafeStr(product.tagline),
                    features: product.features,
                    cost: SafeStr(product.fallbackPrice),
                    productType: ""
                }
            end for
        end function,

        IsAvailable: function() as boolean
            return m.store <> invalid
        end function,

        IsBusy: function() as boolean
            return m.busy
        end function,

        LastError: function() as string
            return m.lastError
        end function,

        ' Ordered list for the store view: lifetime, yearly, monthly.
        GetDisplayList: function() as object
            result = []
            for each product in StoreProducts()
                entry = m.catalog[product.code]
                if entry <> invalid then result.Push(entry)
            end for
            return result
        end function,

        GetProduct: function(code as string) as object
            if m.catalog.DoesExist(code) then return m.catalog[code]
            return invalid
        end function,

        ' Ask Roku for the authoritative product list and the customer's
        ' existing purchases.  Called once at launch and again after any order.
        Refresh: function() as void
            if m.store = invalid
                m.lastError = "Roku Pay is not available on this device"
                return
            end if
            m.lastError = ""
            m.busy = true
            m.pendingRequest = "catalog"
            m.store.GetCatalog()
        end function,

        RefreshPurchases: function() as void
            if m.store = invalid then return
            m.busy = true
            m.pendingRequest = "purchases"
            m.store.GetPurchases()
        end function,

        ' Start a purchase.  Returns false when the order could not be placed.
        ' DoOrder() blocks while the Roku Pay sheet is displayed, so the caller
        ' must paint any "launching" affordance and swap buffers BEFORE calling.
        Purchase: function(code as string) as boolean
            if m.store = invalid
                m.lastError = "Roku Pay is not available on this device"
                return false
            end if
            if StoreProductByCode(code) = invalid
                m.lastError = "Unknown product " + code
                return false
            end if

            m.lastError = ""
            m.pendingCode = code
            m.store.ClearOrder()

            ' SetOrder() wants a LIST of { code, qty } items.
            orderItems = [{ code: code, qty: 1 }]
            m.store.SetOrder(orderItems)

            m.busy = true
            m.pendingRequest = "order"
            ' DoOrder() takes no arguments.
            ok = m.store.DoOrder()
            if not ok
                m.busy = false
                m.pendingRequest = ""
                m.pendingCode = ""
                m.lastError = "The order was cancelled or could not be completed"
                return false
            end if
            return true
        end function,

        ' Returns true when the event was ours.
        HandleStoreEvent: function(msg as object) as boolean
            if msg = invalid then return false
            if type(msg) <> "roChannelStoreEvent" then return false
            if m.store = invalid then return false

            request = m.pendingRequest
            m.busy = false

            succeeded = false
            if msg.IsRequestSucceeded() then succeeded = true

            if not succeeded
                interrupted = false
                if msg.IsRequestInterrupted() then interrupted = true
                m.pendingRequest = ""
                if interrupted
                    m.lastError = "The Roku Pay request was interrupted"
                else
                    m.lastError = "Roku Pay request failed: " + SafeStr(msg.GetStatusMessage())
                end if
                LogInfo(m.lastError)
                return true
            end if

            response = msg.GetResponse()
            if response = invalid
                m.pendingRequest = ""
                m.lastError = "Roku Pay returned an empty response"
                return true
            end if

            if request = "catalog"
                m.ApplyCatalog(response)
                m.pendingRequest = "purchases"
                m.busy = true
                m.store.GetPurchases()
                return true
            end if

            if request = "purchases"
                m.ApplyPurchases(response)
                m.pendingRequest = ""
                return true
            end if

            if request = "order"
                m.ApplyOrder(response)
                m.pendingRequest = ""
                m.pendingCode = ""
                ' Re-read entitlements so a subscription's expiration date comes
                ' straight from Roku rather than from a locally assumed term.
                m.RefreshPurchases()
                return true
            end if

            m.pendingRequest = ""
            return true
        end function,

        ApplyCatalog: function(response as object) as void
            if type(response) <> "roList" and type(response) <> "roArray" then return
            for each entry in response
                if entry <> invalid
                    code = SafeStr(entry.code)
                    if code <> "" and m.catalog.DoesExist(code)
                        item = m.catalog[code]
                        cost = SafeStr(entry.cost)
                        if cost <> "" then item.cost = cost
                        itemName = SafeStr(entry.name)
                        if itemName <> "" then item.name = itemName
                        item.productType = SafeStr(entry.productType)
                    end if
                end if
            end for
            m.catalogReady = true
            LogDebug("Store catalog refreshed from Roku Pay")
        end function,

        ApplyPurchases: function(response as object) as void
            if type(response) <> "roList" and type(response) <> "roArray" then return
            if m.licenseMgr <> invalid then m.licenseMgr.ApplyPurchases(response)
        end function,

        ApplyOrder: function(response as object) as void
            ' A successful DoOrder() answers with a single associative array:
            ' { amount, code, purchaseID, qty, total }.
            code = ""
            if type(response) = "roAssociativeArray"
                code = SafeStr(response.code)
            else if type(response) = "roList" or type(response) = "roArray"
                for each entry in response
                    if entry <> invalid and code = "" then code = SafeStr(entry.code)
                end for
            end if

            if code = "" then code = m.pendingCode
            if code = ""
                m.lastError = "The purchase completed but returned no product code"
                return
            end if

            product = StoreProductByCode(code)
            if product = invalid
                m.lastError = "Purchased an unknown product: " + code
                return
            end if

            if m.licenseMgr <> invalid
                m.licenseMgr.RecordPurchase(product, "")
                LogInfo("Roku Pay purchase recorded: " + code)
            end if
        end function
    }

    mgr.BuildCatalogFromProducts()
    return mgr
end function
