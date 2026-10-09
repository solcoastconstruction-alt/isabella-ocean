import UIKit
import WebKit

/// The whole app: one full-screen web view showing the game's pages from inside the bundle.
///
/// The page reaches the app through three message handlers, set up by `bridge.js`:
/// `store` (game saves), `billing` (the in-app purchase) and `app` (open the game's own site).
/// The web view has no network use of its own: it can only load `isabella://app/…`.
final class GameViewController: UIViewController {
    /// The only pages the game may open, and only in the browser: this build's own, on the game's site.
    static let site = "isabellaocean.app"
    static let sitePath = "/apple/"
    private static let savesKey = "isabella.saves"
    private static let ocean = UIColor(red: 0x1F / 255, green: 0x8F / 255, blue: 0xC0 / 255, alpha: 1)

    let billing: Billing
    private(set) var webView: WKWebView!
    private let defaults: UserDefaults
    private let bridgeSource: String

    init(billing: Billing, defaults: UserDefaults = .standard) {
        self.billing = billing
        self.defaults = defaults
        guard let url = Bundle.main.url(forResource: "bridge", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            fatalError("bridge.js is missing from the app bundle")
        }
        bridgeSource = source
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    // A child's palm on the edge of the screen should not swipe the game away.
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.ocean

        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web", isDirectory: true),
              FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path) else {
            fatalError("The web folder is missing from the app bundle")
        }

        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundleSchemeHandler(root: root), forURLScheme: BundleSchemeHandler.scheme)
        configuration.websiteDataStore = .nonPersistent()   // saves go through the bridge; the web view keeps nothing
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.isTextInteractionEnabled = false
        let content = configuration.userContentController
        content.add(self, name: "store")
        content.add(self, name: "app")
        content.addScriptMessageHandler(self, contentWorld: .page, name: "billing")

        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.underPageBackgroundColor = Self.ocean
        webView.allowsBackForwardNavigationGestures = false
        webView.allowsLinkPreview = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        webView.isInspectable = true
        #endif
        view.addSubview(webView)

        billing.onChange = { [weak self] in self?.pushBillingState() }
        // Under test there is no store until the test has set up Xcode's local one, and asking the
        // real one first costs the tests most of a minute. The tests start billing themselves.
        if !Self.isUnderTest { billing.start() }
        NotificationCenter.default.addObserver(self, selector: #selector(cameToFront), name: UIApplication.willEnterForegroundNotification, object: nil)
        webView.load(URLRequest(url: BundleSchemeHandler.home))
    }

    private static let isUnderTest = ProcessInfo.processInfo.environment.keys.contains { $0.hasPrefix("XCTest") }

    /// Coming back to the game: a refund, or a purchase approved or made elsewhere, may have landed.
    @objc private func cameToFront() {
        guard !Self.isUnderTest else { return }
        Task { await billing.refresh() }
    }

    // MARK: - The bridge

    private var saves: [String: String] {
        get { defaults.dictionary(forKey: Self.savesKey) as? [String: String] ?? [:] }
        set { defaults.set(newValue, forKey: Self.savesKey) }
    }

    private static func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    /// Put `bridge.js` in front of the next page, carrying the saves and the purchase state as they
    /// are right now. Called before every page load, so each page starts from what the last one saved.
    private func installBridge() {
        let boot = Self.json(["store": saves, "billing": billing.state])
        let source = bridgeSource.replacingOccurrences(of: "__BOOT__", with: boot)
        let content = webView.configuration.userContentController
        content.removeAllUserScripts()
        content.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func pushBillingState() {
        guard isViewLoaded else { return }
        webView.evaluateJavaScript("window.__billingState && window.__billingState(\(Self.json(billing.state)))")
    }

    /// Only the game's own pages may talk to the app.
    private func isFromGame(_ message: WKScriptMessage) -> Bool {
        message.frameInfo.isMainFrame && message.frameInfo.request.url?.scheme == BundleSchemeHandler.scheme
    }

    private func openSite(_ text: String) {
        guard let url = URL(string: text), url.scheme == "https", url.host == Self.site,
              url.path.hasPrefix(Self.sitePath) else { return }
        UIApplication.shared.open(url)
    }
}

extension GameViewController: WKScriptMessageHandler, WKScriptMessageHandlerWithReply {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard isFromGame(message), let body = message.body as? [String: Any] else { return }
        switch message.name {
        case "store":
            guard let key = body["key"] as? String, let value = body["value"] as? String else { return }
            saves[key] = value
        case "app":
            if body["op"] as? String == "open", let url = body["url"] as? String { openSite(url) }
        default:
            break
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard isFromGame(message), let op = (message.body as? [String: Any])?["op"] as? String else {
            replyHandler(["error": Billing.Failure.failed.rawValue], nil)
            return
        }
        Task { @MainActor in
            var reply: [String: Any] = [:]
            do {
                switch op {
                case "buy": reply["status"] = try await billing.buy().rawValue
                case "restore": try await billing.restore()
                case "redeem":
                    guard let scene = view.window?.windowScene else { throw Billing.Failure.failed }
                    try await billing.redeem(in: scene)
                case "refresh": await billing.refresh()
                default: throw Billing.Failure.failed
                }
            } catch let failure as Billing.Failure {
                reply["error"] = failure.rawValue
            } catch {
                reply["error"] = Billing.Failure.failed.rawValue
            }
            reply["owned"] = billing.owned
            reply["state"] = billing.state
            replyHandler(reply, nil)
        }
    }
}

extension GameViewController: WKNavigationDelegate, WKUIDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url,
              url.scheme == BundleSchemeHandler.scheme, url.host == BundleSchemeHandler.host else {
            decisionHandler(.cancel)
            return
        }
        if navigationAction.targetFrame?.isMainFrame ?? true { installBridge() }
        decisionHandler(.allow)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.load(URLRequest(url: BundleSchemeHandler.home))
    }

    // window.open and target=_blank never open anything inside the game.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        nil
    }

    // Splash Dash steers by tilting the device. The game's own pages may read the motion sensors
    // without the system asking first; nothing else may.
    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == BundleSchemeHandler.scheme && frame.isMainFrame ? .grant : .deny)
    }
}
