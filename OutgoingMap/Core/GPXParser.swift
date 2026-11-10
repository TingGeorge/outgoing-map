import Foundation

public enum GPXParser {
    public static func parse(data: Data) -> [TrackPoint] {
        let delegate = Delegate()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.parse()
        return delegate.track.isEmpty ? delegate.route : delegate.track
    }

    private final class Delegate: NSObject, XMLParserDelegate {
        var track: [TrackPoint] = []
        var route: [TrackPoint] = []
        private var current: TrackPoint?
        private var text = ""

        private func local(_ name: String) -> String {
            name.split(separator: ":").last.map(String.init) ?? name
        }

        func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                    qualifiedName: String?, attributes: [String: String] = [:]) {
            text = ""
            switch local(elementName) {
            case "trkpt", "rtept":
                guard let lat = attributes["lat"].flatMap(Double.init),
                      let lon = attributes["lon"].flatMap(Double.init),
                      (-90...90).contains(lat), (-180...180).contains(lon)
                else { current = nil; return }
                current = TrackPoint(time: TrackPoint.noTime, lat: lat, lon: lon)
            default:
                break
            }
        }

        func parser(_ parser: XMLParser, foundCharacters string: String) {
            text += string
        }

        func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?,
                    qualifiedName: String?) {
            let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
            switch local(elementName) {
            case "ele":
                current?.altitude = Double(value)
            case "time":
                if let date = JSONCoding.parseDate(value) { current?.time = date }
            case "trkpt":
                if let current { track.append(current) }
                current = nil
            case "rtept":
                if let current { route.append(current) }
                current = nil
            default:
                break
            }
            text = ""
        }
    }
}
