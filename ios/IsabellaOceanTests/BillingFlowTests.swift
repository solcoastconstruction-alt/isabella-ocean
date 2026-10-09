import StoreKit
import StoreKitTest
import WebKit
import XCTest
@testable import IsabellaOcean

/// The whole unlock, end to end, inside the real app: the real pages in the real web view, the real
/// bridge, the real `Billing`, against Xcode's local App Store (`Products.storekit`). Nothing is
/// tapped: the tests press the page's own buttons from JavaScript and read the page back.
@MainActor
final class BillingFlowTests: XCTestCase {
    private var session: SKTestSession!
    private var game: GameViewController!
    private var web: WKWebView { game.webView }

    override func setUp() async throws {
        session = try SKTestSession(configurationFileNamed: "Products")
        session.resetToDefaultState()
        session.disableDialogs = true
        session.clearTransactions()

        game = try await waitFor("the game's view controller") {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            return scene?.windows.first?.rootViewController as? GameViewController
        }
        game.billing.start()   // the app leaves this to the tests, so the local store exists first
        game.billing.presentRedeemSheet = { _ in XCTFail("a test opened the real redeem sheet") }
        // The local store takes a moment to forget the last test's purchase, as it does to list a new one.
        try await until("the store and the app agree that nothing is owned") {
            self.game.billing.forgetThisRun()
            await self.game.billing.refresh()
            return !self.game.billing.owned
        }
        XCTAssertEqual(game.billing.price, "$4.99", "the local store did not answer")
        try await goHome()
        try await until("World 2 is locked before each test") { try await self.flag("!Paywall.worldOpen()") }
    }

    override func tearDown() async throws {
        session?.clearTransactions()
        session = nil
    }

    // MARK: - What the build packed

    func testTheBundleHasOnlyTheAppStoreGame() throws {
        let root = try XCTUnwrap(Bundle.main.resourceURL).appendingPathComponent("web")
        let files = try XCTUnwrap(FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil))
            .compactMap { ($0 as? URL)?.path.replacingOccurrences(of: root.path + "/", with: "") }
        XCTAssertGreaterThan(files.count, 40, "the bundle looks empty: \(files.count) files")
        XCTAssertTrue(files.contains("index.html"))
        XCTAssertTrue(files.contains("games/dash/index.html"))
        for gone in ["wallet.js", "payments.js", "entitlement.js", "paymock.js", "vendor/solana.js"] {
            XCTAssertFalse(files.contains(gone), "\(gone) must not ship in the App Store build")
        }
        let flavor = try String(contentsOf: root.appendingPathComponent("flavor.js"), encoding: .utf8)
        XCTAssertTrue(flavor.contains("'appstore'"), flavor)
    }

    func testThePageIsTheAppStoreFlavorWithItsBridge() async throws {
        try await expectText("window.IsabellaFlavor", "appstore")
        try await expect("Paywall.enabled && !document.getElementById('parentBtn').hidden")
        try await expect("typeof IsabellaStore.get === 'function' && typeof IsabellaBilling.buy === 'function'")
        try await expect("window.isSecureContext", "the tilt game needs a secure context for the motion sensors")
        try await expect("!window.SolanaLib && !window.Wallet && !window.IsabellaPay && !window.IsabellaEntitlement")
    }

    func testOnlyTheGamesOwnPagesLoad() async throws {
        _ = try await js("location.href = 'https://example.com/'; return true")
        try await Task.sleep(nanoseconds: 600_000_000)
        XCTAssertEqual(web.url?.scheme, BundleSchemeHandler.scheme)
        try await expectText("location.protocol", "isabella:")
    }

    // MARK: - Saves

    /// A save written just before leaving a page must be there when the next page starts. Each
    /// round writes and navigates in the same turn, the way the games' home buttons do.
    func testSavesSurvivePageChanges() async throws {
        let pages = ["games/pop/index.html", "index.html", "games/maze/index.html", "index.html", "games/dash/index.html", "index.html"]
        for (round, page) in pages.enumerated() {
            let value = "round-\(round)-\(UUID().uuidString)"
            let before = web.url
            _ = try await js("IsabellaStore.set('test.carry', value); location.href = new URL(page, 'isabella://app/').href; return true",
                             ["value": value, "page": page])
            try await until("\(page) has loaded") {
                guard self.web.url != before, !self.web.isLoading else { return false }
                return try await self.flag("document.readyState === 'complete' && !!window.IsabellaStore")
            }
            try await expectText("IsabellaStore.get('test.carry')", value, "round \(round): \(page) started with a stale save")
        }
        try await expect("IsabellaStore.get('test.never-written') === null")
    }

    // MARK: - The parent gate

    func testTheGateNeedsTheHoldAndTheRightAnswer() async throws {
        _ = try await js("Paywall.gate(Paywall.openPaywall); return true")
        try await expect("!document.getElementById('pwHoldStage').hidden && document.getElementById('pwMathStage').hidden")
        // A short press is not enough.
        _ = try await js("""
            const b = document.getElementById('pwHoldBtn');
            b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7 }));
            await new Promise((r) => setTimeout(r, 1000));
            b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
            return true
            """)
        try await expect("document.getElementById('pwMathStage').hidden", "one second opened the sum")
        // Three seconds is.
        _ = try await js("document.getElementById('pwHoldBtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 8 })); return true")
        try await until("the sum shows after a 3 second hold", seconds: 6) { try await self.flag("!document.getElementById('pwMathStage').hidden") }
        // A wrong answer gives a new sum and opens nothing.
        try await type("1")
        try await expect("document.getElementById('pwGate').classList.contains('on') && !document.getElementById('pwPay').classList.contains('on')")
        // The right answer opens the unlock screen.
        let sum = try await text("document.getElementById('pwMathQ').textContent")
        let parts = sum.components(separatedBy: " × ").compactMap { Int($0) }
        XCTAssertEqual(parts.count, 2, sum)
        try await type(String(parts[0] * parts[1]))
        try await until("the unlock screen opens") { try await self.flag("document.getElementById('pwPay').classList.contains('on') && !document.getElementById('pwGate').classList.contains('on')") }
    }

    // MARK: - Buying

    func testBuyingOpensWorldTwo() async throws {
        try await openOffer()
        let offer = try await text("document.querySelector('#pwPay [data-act=buy] b').textContent")
        XCTAssertTrue(offer.contains("$4.99"), offer)
        try await press("#pwPay [data-act=buy]")
        try await until("the celebration shows") { try await self.flag("Paywall.worldOpen() && document.getElementById('pwYay').classList.contains('on')") }
        try await expect("!document.getElementById('pwPay').classList.contains('on')")
        XCTAssertTrue(game.billing.owned)

        // The next page starts unlocked, with no wait for the store.
        try await goHome()
        try await expect("IsabellaBilling.state().owned && Paywall.worldOpen()")

        // A reinstall: nothing remembered on the device, and the store alone says it is owned.
        let fresh = try XCTUnwrap(UserDefaults(suiteName: "reinstall-\(UUID().uuidString)"))
        let reinstalled = Billing(defaults: fresh)
        XCTAssertFalse(reinstalled.owned)
        // (Xcode's local store takes most of a second to list a new purchase; a real reinstall is minutes later.)
        try await until("a fresh install finds the purchase") { await reinstalled.refresh(); return reinstalled.owned }
    }

    func testARefundLocksWorldTwoAgain() async throws {
        try await openOffer()
        try await press("#pwPay [data-act=buy]")
        try await until("World 2 opens") { try await self.flag("Paywall.worldOpen()") }
        let bought = try XCTUnwrap(session.allTransactions().first)
        try session.refundTransaction(identifier: bought.identifier)
        try await until("World 2 locks after the refund") { try await self.flag("!Paywall.worldOpen()") }
        XCTAssertFalse(game.billing.owned)
    }

    func testAskToBuyWaitsThenOpens() async throws {
        session.askToBuyEnabled = true
        try await openOffer()
        try await press("#pwPay [data-act=buy]")
        try await until("the waiting-for-approval note shows") { try await self.text("document.getElementById('pwPayBody').textContent").contains("Waiting for approval") }
        try await expect("!Paywall.worldOpen()", "World 2 opened before the approval")
        let waiting = try XCTUnwrap(session.allTransactions().first)
        try session.approveAskToBuyTransaction(identifier: waiting.identifier)
        try await until("World 2 opens with its celebration once approved") { try await self.flag("Paywall.worldOpen() && document.getElementById('pwYay').classList.contains('on')") }
    }

    func testAPurchaseThatFailsUnlocksNothingAndCanBeRetried() async throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("simulated store errors need iOS 17") }
        try await openOffer()

        // No connection: the grown-up is told so, and nothing opens.
        try await session.setSimulatedError(.generic(.networkError(URLError(.notConnectedToInternet))), forAPI: StoreKitPurchaseAPI())
        try await press("#pwPay [data-act=buy]")
        try await until("the offline screen shows") { try await self.text("document.getElementById('pwPayBody').textContent").contains("You seem to be offline") }
        try await expect("!Paywall.worldOpen()")

        // Purchases switched off on the device (Screen Time): a different sentence, still nothing opens.
        try await session.setSimulatedError(.purchase(.purchaseNotAllowed), forAPI: StoreKitPurchaseAPI())
        try await press("#pwPay [data-act=retry]")
        try await until("the purchases-are-off screen shows") { try await self.text("document.getElementById('pwPayBody').textContent").contains("Purchases are turned off") }
        try await expect("!Paywall.worldOpen()")
        XCTAssertFalse(game.billing.owned)

        // Try again with the store working: the same Try again button goes through.
        // Once a purchase has been made to fail, Xcode's local store goes on answering every
        // purchase with StoreKitError.unknown, even after the simulated error is cleared (measured on
        // Xcode 26.6: a new Product object, a 3 s wait and clearing the transactions did not help;
        // resetting the session did). So the retry below proves the page's Try again button and the
        // app's state after a failure. The real store's own retry is for the sandbox test.
        session.resetToDefaultState()
        session.disableDialogs = true
        try await press("#pwPay [data-act=retry]")
        try await until("World 2 opens on the next try") { try await self.flag("Paywall.worldOpen()") }
    }

    /// The next launch after a purchase starts from the remembered answer. One empty answer from the
    /// store must not lock a paying family out; a store that keeps saying "none" must.
    func testARememberedPurchaseSurvivesOneEmptyAnswerButNotTwo() async throws {
        let remembered = try XCTUnwrap(UserDefaults(suiteName: "remembered-\(UUID().uuidString)"))
        remembered.set(true, forKey: "billing.owned")

        // Bought a moment ago: the local store answers "none" for most of a second, then lists it.
        try session.buyProduct(productIdentifier: Billing.productID)
        let relaunched = Billing(defaults: remembered)
        XCTAssertTrue(relaunched.owned, "the remembered answer should show on the first frame")
        var changes = 0
        relaunched.onChange = { changes += 1 }
        await relaunched.refresh()
        XCTAssertTrue(relaunched.owned)
        XCTAssertEqual(changes, 1, "only the price loading should have been reported, never a lock")   // the product loaded

        // Refunded while the app was closed, or a different Apple Account: the store has nothing, twice.
        session.clearTransactions()
        let lapsed = Billing(defaults: remembered)
        XCTAssertTrue(lapsed.owned)
        await lapsed.refresh()
        XCTAssertFalse(lapsed.owned)
        XCTAssertFalse(remembered.bool(forKey: "billing.owned"))
    }

    // MARK: - Restore

    func testRestoreFindsNothingThenFindsThePurchase() async throws {
        _ = try await js("Paywall.openManage(); return true")
        try await expectText("document.getElementById('pwStatus').textContent", "Not unlocked")
        try await press("#pwManage [data-act=restore]")
        try await until("restore says nothing was found") { try await self.text("document.getElementById('pwManBody').textContent").contains("Nothing found") }
        try await expect("!Paywall.worldOpen()")

        // Bought elsewhere (another device, or before a reinstall): the store has it, this page doesn't know yet.
        try session.buyProduct(productIdentifier: Billing.productID)
        try await press("#pwManage [data-act=ok]")
        try await until("World 2 opens without a tap once the store reports the purchase") { try await self.flag("Paywall.worldOpen()") }
        _ = try await js("Paywall.openManage(); return true")
        try await expectText("document.getElementById('pwStatus').textContent", "Purchased ✓")
        try await expect("!document.querySelector('#pwManage [data-act=unlock]')", "an owner is still offered the unlock")
    }

    // MARK: - Codes

    /// "Redeem a code" opens Apple's own sheet, which the Simulator cannot redeem against. These
    /// stand in for the three ways it can end; a real code is for the device.
    func testRedeemingACodeOpensWorldTwo() async throws {
        // The sheet is closed without a code: nothing changes, and the grown-ups' screen is back.
        var opened = 0
        game.billing.presentRedeemSheet = { _ in opened += 1 }
        _ = try await js("Paywall.openManage(); return true")
        try await press("#pwManage [data-act=redeem]")
        try await until("the grown-ups' screen is back") { try await self.flag("!!document.querySelector('#pwManage [data-act=redeem]')") }
        XCTAssertEqual(opened, 1)
        try await expect("!Paywall.worldOpen()")

        // The store cannot be reached: the grown-up is told so.
        game.billing.presentRedeemSheet = { _ in throw StoreKitError.networkError(URLError(.notConnectedToInternet)) }
        try await press("#pwManage [data-act=redeem]")
        try await until("the offline screen shows") { try await self.text("document.getElementById('pwManBody').textContent").contains("You seem to be offline") }
        try await press("#pwManage [data-act=ok]")

        // A code is redeemed: the store reports a transaction a moment after the sheet closes, the
        // way it reports a purchase made anywhere else, and World 2 opens with its celebration.
        game.billing.presentRedeemSheet = { [session] _ in try session?.buyProduct(productIdentifier: Billing.productID) }
        try await press("#pwManage [data-act=redeem]")
        try await until("World 2 opens with its celebration") { try await self.flag("Paywall.worldOpen() && document.getElementById('pwYay').classList.contains('on')") }
        XCTAssertTrue(game.billing.owned)

        // An owner is not offered a code.
        _ = try await js("document.getElementById('pwYayGo').click(); Paywall.openManage(); return true")
        try await expect("!document.querySelector('#pwManage [data-act=redeem]')")
    }

    func testTheOfferScreenAlsoTakesACode() async throws {
        game.billing.presentRedeemSheet = { [session] _ in try session?.buyProduct(productIdentifier: Billing.productID) }
        try await openOffer()
        try await press("#pwPay [data-act=redeem]")
        try await until("World 2 opens with its celebration") { try await self.flag("Paywall.worldOpen() && document.getElementById('pwYay').classList.contains('on')") }
    }

    // MARK: - Pictures

    /// Not a check: saves pictures of the grown-ups' screens, for looking at and for the screenshot
    /// App Review asks for with the in-app purchase. Runs only when a folder is named:
    /// `TEST_RUNNER_ISABELLA_SNAPSHOTS=/some/folder xcodebuild test …`
    func testSavePicturesOfTheGrownUpsScreens() async throws {
        guard let folder = ProcessInfo.processInfo.environment["ISABELLA_SNAPSHOTS"], !folder.isEmpty else {
            throw XCTSkip("no ISABELLA_SNAPSHOTS folder named")
        }
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        func save(_ name: String) async throws {
            try await Task.sleep(nanoseconds: 400_000_000)
            let image = try await web.takeSnapshot(configuration: nil)
            let url = URL(fileURLWithPath: folder).appendingPathComponent("\(device)-\(name).png")
            try XCTUnwrap(image.pngData()).write(to: url)
        }
        try await save("1-title")
        _ = try await js("document.getElementById('playBtn').click(); document.getElementById('pgNext').click(); return true")
        try await save("2-world-2-locked")
        _ = try await js("document.querySelector('#grid .paylock').click(); return true")
        try await save("3-ask-a-grown-up")
        _ = try await js("document.getElementById('pwAskGo').click(); return true")
        try await save("4-gate-hold")
        _ = try await js("document.getElementById('pwHoldBtn').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 9 })); return true")
        try await until("the sum shows", seconds: 6) { try await self.flag("!document.getElementById('pwMathStage').hidden") }
        try await save("5-gate-sum")
        let parts = try await text("document.getElementById('pwMathQ').textContent").components(separatedBy: " × ").compactMap { Int($0) }
        try await type(String(parts[0] * parts[1]))
        try await until("the offer shows") { try await self.flag("!!document.querySelector('#pwPay [data-act=buy]')") }
        try await save("6-unlock-offer")
        try await press("#pwPay [data-act=buy]")
        try await until("the celebration shows") { try await self.flag("document.getElementById('pwYay').classList.contains('on')") }
        try await save("7-unlocked")
        _ = try await js("document.getElementById('pwYayGo').click(); return true")
        try await save("8-world-2-open")
        _ = try await js("document.getElementById('levelsHome').click(); Paywall.openManage(); return true")
        try await save("9-grown-ups")
    }

    /// Not a check either: one picture of each screen a child meets first, for judging the layout
    /// on a screen shape (an iPad's 4:3 above all). Same folder switch as the test above.
    func testSavePicturesOfEveryGame() async throws {
        guard let folder = ProcessInfo.processInfo.environment["ISABELLA_SNAPSHOTS"], !folder.isEmpty else {
            throw XCTSkip("no ISABELLA_SNAPSHOTS folder named")
        }
        let device = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        func save(_ name: String, after seconds: Double = 1.2) async throws {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            let image = try await web.takeSnapshot(configuration: nil)
            try XCTUnwrap(image.pngData()).write(to: URL(fileURLWithPath: folder).appendingPathComponent("\(device)-game-\(name).png"))
        }
        try await save("0-title", after: 3)
        _ = try await js("document.getElementById('moreBtn').click(); return true")
        try await save("0-more")
        _ = try await js("document.getElementById('moreBack').click(); document.getElementById('playBtn').click(); return true")
        try await save("0-levels")
        _ = try await js("__dbg.start(3); __dbg.play(); return true")
        try await save("0-isabella-level-3", after: 2.5)
        _ = try await js("document.getElementById('pauseBtn').click(); return true")
        try await save("0-isabella-paused")
        for game in ["pop", "maze", "match", "words", "blocks", "jigsaw", "dash", "catch"] {
            web.load(URLRequest(url: URL(string: "isabella://app/games/\(game)/index.html")!))
            try await until("\(game) has loaded") {
                guard !self.web.isLoading else { return false }
                return try await self.flag("document.readyState === 'complete' && location.pathname.includes('/\(game)/')")
            }
            try await save("\(game)-1-first-screen", after: 2)
            // Then the game in play, started through its own debug hook (each game has one).
            if let (start, wait) = inPlay[game] {
                _ = try await js(start + "; return true")
                try await save("\(game)-2-in-play", after: wait)
            }
        }
    }

    private let inPlay: [String: (String, Double)] = [
        "pop": ("__popDebug.start(2)", 5),
        "maze": ("__mazeDebug.start(12, 'easy')", 2.5),
        "match": ("__matchDebug.start(4)", 2.5),
        "words": ("__wordsDebug.start('medium')", 2.5),
        "blocks": ("__blocksDebug.start('medium'); for (let i = 0; i < 7; i++) { for (let k = 0; k < (i * 2) % 5; k++) __blocksDebug.act(i % 2 ? 'left' : 'right'); __blocksDebug.act('drop'); __blocksDebug.advance(1.2); }", 1.5),
        "jigsaw": ("__jigsawDebug.start('medium', 2, true) || __jigsawDebug.start('easy', 4, true); __jigsawDebug.solve(8)", 3),
        "dash": ("__dashDebug.start(3)", 6),
        "catch": ("__catchDebug.start(3)", 6),
    ]

    // MARK: - Helpers

    private func js(_ body: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
        try await web.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
    }

    private func flag(_ expression: String) async throws -> Bool {
        (try await js("return !!(\(expression))") as? Bool) ?? false
    }

    private func text(_ expression: String) async throws -> String {
        let value = try await js("return String(\(expression))") as? String
        return try XCTUnwrap(value)
    }

    private func expect(_ expression: String, _ message: String = "", line: UInt = #line) async throws {
        let holds = try await flag(expression)
        XCTAssertTrue(holds, message.isEmpty ? expression : message, line: line)
    }

    private func expectText(_ expression: String, _ expected: String, _ message: String = "", line: UInt = #line) async throws {
        let found = try await text(expression)
        XCTAssertEqual(found, expected, message, line: line)
    }

    private func press(_ selector: String) async throws {
        let found = try await js("const el = document.querySelector(selector); if (!el) return false; el.click(); return true", ["selector": selector]) as? Bool
        XCTAssertEqual(found, true, "nothing to press at \(selector)")
    }

    private func type(_ digits: String) async throws {
        for digit in digits { try await press("#pwPad [data-k='\(digit)']") }
        try await press("#pwPad [data-k=ok]")
    }

    private func openOffer() async throws {
        _ = try await js("Paywall.openPaywall(); return true")
        try await until("the offer shows a price") { try await self.flag("!!document.querySelector('#pwPay [data-act=buy]')") }
    }

    private func goHome() async throws {
        web.load(URLRequest(url: BundleSchemeHandler.home))
        try await until("the title screen has loaded") {
            guard !self.web.isLoading, self.web.url == BundleSchemeHandler.home else { return false }
            return try await self.flag("document.readyState === 'complete' && !!window.Paywall && !!window.IsabellaBilling")
        }
    }

    private func until(_ what: String, seconds: Double = 10, _ condition: @escaping () async throws -> Bool) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if (try? await condition()) == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let page = (try? await js("""
            const text = (id) => { const el = document.getElementById(id); return el && el.classList.contains('on') ? el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : '(closed)'; };
            return JSON.stringify({ billing: window.IsabellaBilling && IsabellaBilling.state(), pay: text('pwPay'), manage: text('pwManage'), yay: text('pwYay') })
            """) as? String) ?? "(the page did not answer)"
        XCTFail("Timed out waiting until \(what). Page: \(page). Store transactions: \(session.allTransactions().count)")
        throw CancellationError()
    }

    private func waitFor<T>(_ what: String, seconds: Double = 10, _ find: @escaping () -> T?) async throws -> T {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if let found = find() { return found }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTFail("Timed out waiting for \(what)")
        throw CancellationError()
    }
}
