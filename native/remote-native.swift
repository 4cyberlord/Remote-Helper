import AppKit
import CoreGraphics
import Foundation
import Security

let service = "com.4cyberlord.council-remote-helper"
let account = NSUserName()
func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
func attrs() -> [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
     kSecAttrAccount as String: account]
}
func keychainWrite(_ text: String) {
    guard !text.isEmpty else { fail("Empty credential refused") }
    var q = attrs()
    q[kSecValueData as String] = Data(text.utf8)
    let add = SecItemAdd(q as CFDictionary, nil)
    if add == errSecDuplicateItem {
        let status = SecItemUpdate(attrs() as CFDictionary,
          [kSecValueData as String: Data(text.utf8)] as CFDictionary)
        if status != errSecSuccess { fail("Keychain update error \(status)") }
    } else if add != errSecSuccess { fail("Keychain insert error \(add)") }
}
func keychainRead() -> String {
    var q = attrs()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &found)
    if status == errSecItemNotFound { fail("No login in Keychain. Run: council-remote login") }
    if status != errSecSuccess { fail("Keychain read error \(status)") }
    guard let data = found as? Data, let value = String(data: data, encoding: .utf8) else { fail("Invalid Keychain credential") }
    return value
}
let command = CommandLine.arguments.dropFirst().first ?? ""
switch command {
case "displays":
    var count: UInt32 = 0
    let status = CGGetActiveDisplayList(0, nil, &count)
    if status != .success || count == 0 { fail("Could not enumerate screens") }
    var ids = [CGDirectDisplayID](repeating: 0, count: Int(count))
    if CGGetActiveDisplayList(count, &ids, &count) != .success { fail("Could not read screens") }
    let cursor = CGEvent(source: nil)?.location ?? CGPoint(x: 0, y: 0)
    var monitors: [[String: Any]] = []
    var active: UInt32? = nil
    for (i, id) in ids.prefix(Int(count)).enumerated() {
        let b = CGDisplayBounds(id)
        let x1 = Int(b.minX.rounded()), y1 = Int(b.minY.rounded())
        let x2 = Int(b.maxX.rounded()), y2 = Int(b.maxY.rounded())
        if b.contains(cursor) { active = id }
        monitors.append(["index": i+1,"id": id,"x": x1,"y": y1,
           "width": x2-x1,"height": y2-y1,"main": CGDisplayIsMain(id) != 0,
           "pixelWidth": CGDisplayPixelsWide(id),"pixelHeight": CGDisplayPixelsHigh(id)])
    }
    let output: [String: Any] = ["activeDisplayId": active ?? CGMainDisplayID(), "displays": monitors]
    do {
      let json = try JSONSerialization.data(withJSONObject: output, options: [.sortedKeys])
      FileHandle.standardOutput.write(json)
    } catch { fail("Could not serialize screen geometry") }
case "keychain-set":
    let data = FileHandle.standardInput.readDataToEndOfFile()
    guard let value = String(data: data, encoding: .utf8) else { fail("Invalid credential input") }
    keychainWrite(value.trimmingCharacters(in: .whitespacesAndNewlines))
case "keychain-get":
    print(keychainRead())
case "keychain-delete":
    let status = SecItemDelete(attrs() as CFDictionary)
    if status != errSecSuccess && status != errSecItemNotFound { fail("Keychain removal error \(status)") }
case "screen-permission":
    print(CGPreflightScreenCaptureAccess() ? "granted" : "not-granted")
case "screen-request":
    print(CGRequestScreenCaptureAccess() ? "granted" : "not-granted")
default:
    fail("Expected displays, keychain-set, keychain-get, keychain-delete, screen-permission, or screen-request")
}
