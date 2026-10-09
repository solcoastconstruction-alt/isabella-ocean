import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the game's pages from the `web` folder inside the app bundle at `isabella://app/…`.
/// Nothing is ever fetched from a network: a path that isn't a file in that folder is a 404.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "isabella"
    static let host = "app"
    static let home = URL(string: "\(scheme)://\(host)/index.html")!

    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = fileURL(for: url),
              let data = try? Data(contentsOf: file) else {
            respond(task, status: 404, type: "text/plain", data: Data("Not found".utf8))
            return
        }
        respond(task, status: 200, type: Self.mimeType(for: file), data: data)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    /// The file a URL names, or nil if it would leave the `web` folder.
    func fileURL(for url: URL) -> URL? {
        guard url.scheme == Self.scheme, url.host == Self.host else { return nil }
        var path = url.path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory), !isDirectory.boolValue else { return nil }
        return file
    }

    private func respond(_ task: WKURLSchemeTask, status: Int, type: String, data: Data) {
        let headers = [
            "Content-Type": type,
            "Content-Length": String(data.count),
            "Cache-Control": "no-store",
        ]
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badURL))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    static func mimeType(for file: URL) -> String {
        switch file.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "svg": return "image/svg+xml"
        default: return UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        }
    }
}
