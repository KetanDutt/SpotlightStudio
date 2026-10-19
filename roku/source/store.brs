' Spotlight Studio for Roku
' store.brs - In-App Purchases (IAP) integration with roChannelStore for Full Version & Subscriptions

function CreateStoreManager(port as object, licenseMgr as object) as object
    mgr = {
        port: port,
        licenseMgr: licenseMgr,
        channelStore: invalid,
        isProcessingOrder: false,
        lastError: "",
        
        products: [
            {
                sku: "BuyFullVersion",
                title: "Spotlight Studio Full Version",
                price: "$4.99",
                type: "One-time Purchase (Lifetime)",
                badge: "LIFETIME ACCESS",
                desc: "Unlock manual wallpaper changer, screensaver setter, all 7,400+ wallpapers & unlimited favorites."
            },
            {
                sku: "sub_monthly",
                title: "Spotlight Pro (Monthly)",
                price: "$1.99 / mo",
                type: "Monthly Subscription",
                badge: "AUTO-SWITCHING",
                desc: "Unlock automatic wallpaper & screensaver switching (1 min to daily), background rotation, and all themes."
            },
            {
                sku: "sub_yearly",
                title: "Spotlight Pro (Yearly)",
                price: "$14.99 / yr",
                type: "Annual Subscription",
                badge: "BEST VALUE — SAVE 37%",
                desc: "Everything in Pro Monthly plus priority catalog sync and VIP support ($1.25/mo billed annually)."
            }
        ],
        
        Init: function()
            m.channelStore = CreateObject("roChannelStore")
            if m.channelStore <> invalid and m.port <> invalid
                m.channelStore.SetMessagePort(m.port)
            end if
        end function,
        
        Purchase: function(sku as string) as boolean
            if m.channelStore = invalid
                print "[Store] Error: roChannelStore unavailable"
                return false
            end if
            
            m.isProcessingOrder = true
            m.lastError = ""
            
            order = {
                code: sku,
                sku: sku,
                qty: 1
            }
            
            print "[Store] Ordering product: " + sku
            m.channelStore.SetOrder(order)
            return m.channelStore.DoOrder(order)
        end function,
        
        RestorePurchases: function() as boolean
            if m.channelStore = invalid then return false
            print "[Store] Querying existing purchases..."
            return m.channelStore.GetPurchases()
        end function,
        
        HandleStoreEvent: function(msg as object) as string
            m.isProcessingOrder = false
            if msg = invalid then return ""
            
            status = msg.GetStatus()
            statusMsg = msg.GetStatusMessage()
            print "[Store] ChannelStoreEvent status: " + StrI(status).Trim() + " msg: " + statusMsg
            
            if status = 1 or status = "success" or msg.IsRequestSucceeded()
                resp = msg.GetResponse()
                ' Inspect purchases in response
                if resp <> invalid
                    purchases = invalid
                    if resp.requestStatus <> invalid and resp.requestStatus.result <> invalid
                        purchases = resp.requestStatus.result.purchases
                    else if resp.purchases <> invalid
                        purchases = resp.purchases
                    end if
                    
                    if purchases <> invalid and purchases.Count() > 0
                        for each p in purchases
                            sku = ""
                            if p.code <> invalid then sku = p.code
                            if sku = "" and p.sku <> invalid then sku = p.sku
                            if sku = "" and p.productId <> invalid then sku = p.productId
                            
                            if sku <> ""
                                m.licenseMgr.RecordPurchase(sku)
                                print "[Store] Recorded purchase: " + sku
                                return "Purchased: " + sku
                            end if
                        end for
                    else
                        ' Fallback if response succeeded without explicit items array
                        return "Purchase Success"
                    end if
                end if
                return "Purchase Confirmed"
            else if msg.IsRequestInterrupted()
                return "Purchase Cancelled"
            else
                m.lastError = statusMsg
                return "Purchase Failed: " + statusMsg
            end if
        end function
    }
    mgr.Init()
    return mgr
end function
