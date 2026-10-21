' Spotlight Studio for Roku
' audio.brs - Navigation feedback using Roku's built-in system sound effects.
'
' roAudioResource can be created with a system effect NAME instead of a file
' path ("select", "navsingle", "navmulti", "deadend").  Those clips are supplied
' by the OS, so they cost zero bytes of the 4 MB package budget and - critically -
' they are played at the volume the user chose in Settings > Audio, or not at all
' if the user turned interface sounds off.  Bundling custom .wav files would
' override that preference, which is exactly what a TV app should not do.

function CreateAudioManager(enabled as boolean) as object
    mgr = {
        enabled: enabled,
        select: invalid,
        navSingle: invalid,
        navMulti: invalid,
        deadEnd: invalid,
        available: false,

        Init: function() as void
            m.select = m.LoadEffect("select")
            m.navSingle = m.LoadEffect("navsingle")
            m.navMulti = m.LoadEffect("navmulti")
            m.deadEnd = m.LoadEffect("deadend")
            m.available = (m.select <> invalid) or (m.navSingle <> invalid)
            if not m.available then LogDebug("System sound effects unavailable on this device")
        end function,

        LoadEffect: function(effectName as string) as object
            effect = CreateObject("roAudioResource", effectName)
            if effect = invalid then return invalid
            return effect
        end function,

        SetEnabled: function(enabled as boolean) as void
            m.enabled = enabled
        end function,

        IsEnabled: function() as boolean
            return m.enabled and m.available
        end function,

        ' Short blip for a confirmed action (OK, toggling a favourite).
        PlaySelect: function() as void
            m.Trigger(m.select)
        end function,

        ' Single step movement (one tile, one row).
        PlayNav: function() as void
            m.Trigger(m.navSingle)
        end function,

        ' Larger movement (page change, tab change).
        PlayNavMulti: function() as void
            m.Trigger(m.navMulti)
        end function,

        ' Movement that cannot go any further.
        PlayDeadEnd: function() as void
            m.Trigger(m.deadEnd)
        end function,

        Trigger: function(effect as object) as void
            if not m.IsEnabled() then return
            if effect = invalid then return
            ' The OS decides the actual volume for system effects; 100 simply
            ' means "do not attenuate it ourselves".
            effect.Trigger(100)
        end function
    }

    mgr.Init()
    return mgr
end function
