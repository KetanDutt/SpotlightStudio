Pod::Spec.new do |s|
  s.name           = 'SpotlightWallpaper'
  s.version        = '0.3.0'
  s.summary        = 'Wallpaper bridge for Spotlight Studio (iOS implementation).'
  s.description    = 'Validates supported images in the private app cache with bounded ImageIO decoding. iOS reports unsupported wallpaper setting honestly.'
  s.author         = 'Ketan Dutt'
  s.homepage       = 'https://github.com/KetanDutt/SpotlightStudio'
  s.license        = { :type => 'All Rights Reserved' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/KetanDutt/SpotlightStudio.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
