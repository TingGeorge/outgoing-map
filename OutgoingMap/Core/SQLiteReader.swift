import Foundation
import SQLite3

public struct SQLiteError: Error, CustomStringConvertible {
    public var description: String
}

final class SQLiteReader: @unchecked Sendable {
    private let db: OpaquePointer
    private let lock = NSLock()

    init(url: URL) throws {
        var handle: OpaquePointer?
        let rc = sqlite3_open_v2(url.path, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil)
        guard rc == SQLITE_OK, let handle else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            sqlite3_close(handle)
            throw SQLiteError(description: "\(url.lastPathComponent): \(message)")
        }
        db = handle
    }

    deinit {
        sqlite3_close(db)
    }

    // ponytail: one lock serializes every query on this connection; upgrade to a small pool of read-only connections if tile reads become a bottleneck.
    func query<T>(_ sql: String, _ args: [Double] = [], row: (OpaquePointer) -> T?) -> [T] {
        lock.lock()
        defer { lock.unlock() }

        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { return [] }
        defer { sqlite3_finalize(stmt) }

        for (i, arg) in args.enumerated() {
            sqlite3_bind_double(stmt, Int32(i + 1), arg)
        }
        var rows: [T] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let value = row(stmt) { rows.append(value) }
        }
        return rows
    }

    static func text(_ stmt: OpaquePointer, _ column: Int32) -> String? {
        sqlite3_column_text(stmt, column).map { String(cString: $0) }
    }

    static func double(_ stmt: OpaquePointer, _ column: Int32) -> Double? {
        sqlite3_column_type(stmt, column) == SQLITE_NULL ? nil : sqlite3_column_double(stmt, column)
    }

    static func blob(_ stmt: OpaquePointer, _ column: Int32) -> Data? {
        guard let bytes = sqlite3_column_blob(stmt, column) else { return nil }
        return Data(bytes: bytes, count: Int(sqlite3_column_bytes(stmt, column)))
    }
}
