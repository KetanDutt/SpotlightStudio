Pod::Spec.new do |s|
  s.name           = 'SpotlightWallpaper'
  s.version        = '0.1.0'
  s.summary        = 'Wallpaper bridge for Spotlight Studio (iOS implementation).'
  s.description    = 'iOS deliberately exposes no wallpaper API, so this module reports the real capabilities and returns a clear error instead of pretending to work.'
  s.author         = 'Ketan Dutt'
  s.homepage       = 'https://github.com/KetanDutt/SpotlightStudio'
  s.license        = { :type => 'All Rights Reserved' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/KetanDutt/SpotlightStudio.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
