/**
 * ML Kit is the ANDROID translate provider only (iOS uses Apple Foundation
 * Models, web uses the Translator API) — don't link its pods on iOS: they
 * drag Google MLKit in and demand a higher deployment target than SDK 54's
 * default (broke the 1.6.0 iOS build).
 */
module.exports = {
  dependencies: {
    '@react-native-ml-kit/translate-text': { platforms: { ios: null } },
    '@react-native-ml-kit/identify-languages': { platforms: { ios: null } },
  },
};
