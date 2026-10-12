const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
module.exports = config => {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate' }] },
    };
    // QR scanning never records audio.
    delete mod.modResults.NSMicrophoneUsageDescription;
    return mod;
  });
  return withAppDelegate(config, mod => {
    const start = '    window = UIWindow(frame: UIScreen.main.bounds)\n    factory.startReactNative(\n      withModuleName: "main",\n      in: window,\n      launchOptions: launchOptions)';
    if (!mod.modResults.contents.includes(start)) throw new Error('Expo AppDelegate startup hook changed');
    mod.modResults.contents = mod.modResults.contents.replace(start, '    // The SceneDelegate owns the window on iOS 27.');
    mod.modResults.contents += `
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let scene = scene as? UIWindowScene,
          let app = UIApplication.shared.delegate as? AppDelegate,
          let factory = app.reactNativeFactory else { return }
    let window = UIWindow(windowScene: scene)
    self.window = window
    app.window = window
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: nil)
    for context in connectionOptions.urlContexts {
      _ = app.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
  func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      _ = (UIApplication.shared.delegate as? AppDelegate)?.application(UIApplication.shared, open: context.url, options: [:])
    }
  }
  func sceneDidBecomeActive(_ scene: UIScene) {
    NotificationCenter.default.post(name: UIApplication.didBecomeActiveNotification, object: UIApplication.shared)
  }
  func sceneWillResignActive(_ scene: UIScene) {
    NotificationCenter.default.post(name: UIApplication.willResignActiveNotification, object: UIApplication.shared)
  }
  func sceneDidEnterBackground(_ scene: UIScene) {
    NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: UIApplication.shared)
  }
  func sceneWillEnterForeground(_ scene: UIScene) {
    NotificationCenter.default.post(name: UIApplication.willEnterForegroundNotification, object: UIApplication.shared)
  }
}
`;
    return mod;
  });
};
