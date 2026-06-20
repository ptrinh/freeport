import ExpoModulesCore
import Security

/**
 * iCloud-Keychain backup of the Nostr identity (an `nsec` string).
 *
 * The item is stored in the keychain with `kSecAttrSynchronizable = true`, which
 * is what makes iOS sync it through the user's iCloud Keychain to their other
 * devices automatically — no special entitlement or keychain-access-group is
 * needed beyond the standard keychain the app already uses. Accessibility is
 * `AfterFirstUnlock` so a fresh-install restore can read it once the device has
 * been unlocked since boot.
 */
public class FreeportCloudBackupModule: Module {
  private let service = "uk.trinh.freeport"
  private let account = "identity"

  public func definition() -> ModuleDefinition {
    Name("FreeportCloudBackup")

    Function("isAvailable") { () -> Bool in
      return true
    }

    AsyncFunction("save") { (value: String) -> Void in
      // Replace any existing synchronizable item, then add the new one.
      let deleteQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: self.service,
        kSecAttrAccount as String: self.account,
        kSecAttrSynchronizable as String: kCFBooleanTrue!,
      ]
      SecItemDelete(deleteQuery as CFDictionary)

      guard let data = value.data(using: .utf8) else {
        throw NSError(domain: "FreeportCloudBackup", code: -1,
                      userInfo: [NSLocalizedDescriptionKey: "Could not encode value."])
      }
      let addQuery: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: self.service,
        kSecAttrAccount as String: self.account,
        kSecAttrSynchronizable as String: kCFBooleanTrue!,
        kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        kSecValueData as String: data,
      ]
      let status = SecItemAdd(addQuery as CFDictionary, nil)
      guard status == errSecSuccess else {
        throw NSError(domain: "FreeportCloudBackup", code: Int(status),
                      userInfo: [NSLocalizedDescriptionKey: "Keychain save failed (\(status))."])
      }
    }

    AsyncFunction("restore") { () -> String? in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: self.service,
        kSecAttrAccount as String: self.account,
        kSecAttrSynchronizable as String: kCFBooleanTrue!,
        kSecReturnData as String: kCFBooleanTrue!,
        kSecMatchLimit as String: kSecMatchLimitOne,
      ]
      var item: CFTypeRef?
      let status = SecItemCopyMatching(query as CFDictionary, &item)
      if status == errSecItemNotFound { return nil }
      guard status == errSecSuccess, let data = item as? Data,
            let str = String(data: data, encoding: .utf8) else {
        return nil
      }
      return str
    }

    AsyncFunction("clear") { () -> Void in
      let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: self.service,
        kSecAttrAccount as String: self.account,
        kSecAttrSynchronizable as String: kCFBooleanTrue!,
      ]
      SecItemDelete(query as CFDictionary)
    }
  }
}
