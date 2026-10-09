import Foundation
import StoreKit
import UIKit

/// The one in-app purchase: World 2 (levels 11–20), a non-consumable, through StoreKit 2.
///
/// Ownership is whatever the App Store says it is, so a reinstall, a second device, a refund and
/// Ask to Buy all resolve themselves. Two rules decide it:
/// - A signed transaction for World 2 is the evidence: one that is not revoked opens it, one that
///   is revoked (a refund) locks it. It can arrive as the result of a purchase, as an update from
///   the store, or as the answer to "what is the latest transaction for this product?".
/// - "No transaction" is not evidence against one already seen. Straight after a purchase the store
///   can answer that it has none for a moment (seen in Xcode's local store: empty 150 ms after a
///   verified purchase, right about 0.75 s later), so once a valid transaction has been seen in
///   this run, only a revocation takes World 2 away. On a fresh launch nothing has been seen yet:
///   "none" then means locked, but if the last run ended unlocked the store is asked a second
///   time a little later before World 2 is taken away.
/// The last answer is kept in UserDefaults so the padlocks are right on the first frame.
@MainActor
final class Billing {
    static let productID = "app.isabellaocean.mobile.world2"
    private static let ownedKey = "billing.owned"
    private static let secondLookDelay: UInt64 = 2_000_000_000

    enum Outcome: String { case purchased, pending, cancelled }

    /// What the page is told when something goes wrong; the paywall has a sentence for each.
    enum Failure: String, Error { case offline, unavailable, failed }

    private(set) var product: Product?
    private(set) var owned: Bool
    /// Called on the main actor whenever `owned` or the product's price changes.
    var onChange: (() -> Void)?

    private let defaults: UserDefaults
    private var updates: Task<Void, Never>?
    private var checking: Task<Void, Never>?
    /// Apple's own "redeem a code" sheet. The Simulator has no App Store to redeem against, so the
    /// tests put their own step here.
    var presentRedeemSheet: (UIWindowScene) async throws -> Void = { try await AppStore.presentOfferCodeRedeemSheet(in: $0) }
    /// A valid (not revoked) transaction for World 2 has been seen since the app started.
    private var seenValid = false

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.owned = defaults.bool(forKey: Self.ownedKey)
    }

    deinit { updates?.cancel() }

    /// The store's own localized price ("$4.99", "A$7.99"), or nil until the product has loaded.
    var price: String? { product?.displayPrice }

    /// What the page sees through `IsabellaBilling.state()`.
    var state: [String: Any] {
        ["owned": owned, "price": price ?? NSNull(), "ready": product != nil]
    }

    /// Start listening for purchases that finish outside a `buy()` (Ask to Buy approvals, refunds,
    /// purchases on another device), then load the product and check ownership.
    func start() {
        guard updates == nil else { return }
        updates = Task { [weak self] in
            for await result in Transaction.updates {
                if case .verified(let transaction) = result {
                    self?.take(transaction)
                    await transaction.finish()
                }
                await self?.recheck()
            }
        }
        Task { await refresh() }
    }

    /// Load the product if it isn't loaded yet, and ask the store again who owns what.
    func refresh() async {
        if product == nil {
            let found = try? await Product.products(for: [Self.productID]).first
            if let found, product == nil {
                product = found
                onChange?()
            }
        }
        await recheck()
    }

    func buy() async throws -> Outcome {
        guard AppStore.canMakePayments else { throw Failure.unavailable }
        if product == nil { await refresh() }
        guard let product else { throw Failure.unavailable }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                // An unverified transaction unlocks nothing: only the store's signed answer counts.
                guard case .verified(let transaction) = verification else { throw Failure.failed }
                take(transaction)
                await transaction.finish()
                guard owned else { throw Failure.failed }
                return .purchased
            case .pending:
                return .pending
            case .userCancelled:
                return .cancelled
            @unknown default:
                throw Failure.failed
            }
        } catch let failure as Failure {
            throw failure
        } catch {
            throw Self.classify(error)
        }
    }

    /// "Restore purchase": sync with the App Store (it may ask for the Apple Account password), then
    /// re-check. Cancelling the sign-in is not an error; the re-check simply finds what it finds.
    func restore() async throws {
        do {
            try await AppStore.sync()
        } catch StoreKitError.userCancelled {
            // fall through to the re-check
        } catch {
            await recheck()
            if !owned { throw Self.classify(error) }
            return
        }
        await recheck()
    }

    /// A signed transaction is the evidence either way: valid opens World 2, revoked locks it.
    private func take(_ transaction: Transaction) {
        guard transaction.productID == Self.productID else { return }
        seenValid = transaction.revocationDate == nil
        setOwned(seenValid)
    }

    #if DEBUG
    /// For the tests, which wipe Xcode's local store between cases (the real store never forgets a
    /// purchase): forget what this run has seen, as a fresh launch would.
    func forgetThisRun() { seenValid = false }
    #endif

    private func setOwned(_ value: Bool) {
        guard value != owned else { return }
        owned = value
        defaults.set(value, forKey: Self.ownedKey)
        onChange?()
    }

    /// Ask the store for the latest transaction for World 2 and take its answer. Checks can be asked
    /// for at the same moment (a refund arriving while the grown-ups' screen asks), so they run one
    /// after another: each asks only after the one before it has finished, and so the answer that
    /// was asked for last is the one that stands.
    private func recheck() async {
        let earlier = checking
        let check = Task { @MainActor [weak self] in
            await earlier?.value
            var latest = await Transaction.latest(for: Self.productID)
            if latest == nil, let self, self.owned, !self.seenValid {
                // Unlocked when the app last ran, and the store's first answer is "none": ask again
                // before locking a paying family out on one empty answer.
                try? await Task.sleep(nanoseconds: Self.secondLookDelay)
                latest = await Transaction.latest(for: Self.productID)
            }
            guard let self else { return }
            if case .verified(let transaction) = latest {
                self.take(transaction)
            } else if !self.seenValid {
                self.setOwned(false)
            }
        }
        checking = check
        await check.value
    }

    /// "Redeem a code": an App Store offer code the family was given for World 2 (codes for a
    /// one-time purchase need iOS 16.3, which is why the app asks for 16.4). Apple's sheet takes the code and
    /// the App Store does the rest; a redeemed code arrives like any purchase, as a transaction from
    /// the store (`start()` is listening), sometimes a moment after the sheet has closed. Closing
    /// the sheet without redeeming is not an error.
    func redeem(in scene: UIWindowScene) async throws {
        do {
            try await presentRedeemSheet(scene)
        } catch {
            throw Self.classify(error)
        }
        await recheck()
    }

    private static func classify(_ error: Error) -> Failure {
        if let error = error as? StoreKitError {
            switch error {
            case .networkError: return .offline
            case .notAvailableInStorefront, .notEntitled: return .unavailable
            default: return .failed
            }
        }
        if let error = error as? Product.PurchaseError {
            switch error {
            case .purchaseNotAllowed, .productUnavailable: return .unavailable
            default: return .failed
            }
        }
        if (error as NSError).domain == NSURLErrorDomain { return .offline }
        return .failed
    }
}
