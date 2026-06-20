import ExpoModulesCore
import UIKit

/**
 * Minimal iOS background-task bridge. `begin()` asks iOS for the short
 * extended-background window via `beginBackgroundTask` (~30s) so a JS timer can
 * fire just before suspension; `end()` releases it. iOS calls our expiration
 * handler if it needs the time back sooner — we end gracefully there too.
 */
public class FreeportBackgroundTaskModule: Module {
  private var taskId: UIBackgroundTaskIdentifier = .invalid

  public func definition() -> ModuleDefinition {
    Name("FreeportBackgroundTask")

    Function("begin") { () -> Void in
      DispatchQueue.main.async {
        guard self.taskId == .invalid else { return }
        self.taskId = UIApplication.shared.beginBackgroundTask(withName: "FreeportRelayKeepAlive") { [weak self] in
          self?.endInternal()
        }
      }
    }

    Function("end") { () -> Void in
      self.endInternal()
    }
  }

  private func endInternal() {
    DispatchQueue.main.async {
      guard self.taskId != .invalid else { return }
      UIApplication.shared.endBackgroundTask(self.taskId)
      self.taskId = .invalid
    }
  }
}
