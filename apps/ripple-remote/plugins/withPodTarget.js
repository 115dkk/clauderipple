const { withPodfile } = require('expo/config-plugins');
module.exports = config => withPodfile(config, mod => {
  const anchor = 'post_install do |installer|';
  if (!mod.modResults.contents.includes(anchor)) throw new Error('Expo Podfile post_install hook not found');
  mod.modResults.contents = mod.modResults.contents.replace(anchor, `${anchor}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |configuration|
        current = configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f
        configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4' if current < 16.4
      end
    end`);
  return mod;
});
