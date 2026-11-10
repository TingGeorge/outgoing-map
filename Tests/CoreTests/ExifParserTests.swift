import Foundation
import Testing
@testable import OutgoingMapCore

private func utc(_ iso: String) -> Date {
    JSONCoding.parseDate(iso)!
}

@Test func exifFullMetadataWithOffset() {
    let m = ExifParser.parse([
        "{GPS}": ["Latitude": 24.1745, "LatitudeRef": "N", "Longitude": 121.2837, "LongitudeRef": "E",
                  "Altitude": 3422.5, "AltitudeRef": 0, "DateStamp": "2026:11:07", "TimeStamp": "01:25:40"],
        "{Exif}": ["DateTimeOriginal": "2026:11:07 09:25:30", "OffsetTimeOriginal": "+08:00"],
    ])
    #expect(m.takenAt == utc("2026-11-07T01:25:30Z"))
    #expect(m.lat == 24.1745 && m.lon == 121.2837 && m.altitude == 3422.5)
}

@Test func exifOffsetBeatsGPSStamp() {
    let m = ExifParser.parse([
        "{Exif}": ["DateTimeOriginal": "2026:11:07 09:25:30", "OffsetTimeOriginal": "-05:30"],
    ])
    #expect(m.takenAt == utc("2026-11-07T14:55:30Z"))
}

@Test func exifWithoutOffsetPrefersGPSUTCStamp() {
    let m = ExifParser.parse([
        "{GPS}": ["Latitude": 24.17, "LatitudeRef": "N", "Longitude": 121.28, "LongitudeRef": "E",
                  "DateStamp": "2026:11:07", "TimeStamp": "01:25:31.25"],
        "{Exif}": ["DateTimeOriginal": "2026:11:07 09:25:30"],
    ])
    #expect(m.takenAt == utc("2026-11-07T01:25:31Z"))
}

@Test func exifWithoutGPSAssumesTaipei() {
    let m = ExifParser.parse(["{TIFF}": ["DateTime": "2026:11:07 09:25:30"]])
    #expect(m.takenAt == utc("2026-11-07T01:25:30Z"))
    #expect(m.lat == nil && m.lon == nil && m.altitude == nil)
    #expect(ExifParser.parse([:]) == PhotoMetadata())
}

@Test func exifSouthWestAndBelowSeaLevel() {
    let m = ExifParser.parse([
        "{GPS}": ["Latitude": 33.9, "LatitudeRef": "S", "Longitude": 18.4, "LongitudeRef": "W",
                  "Altitude": 12.0, "AltitudeRef": 1],
    ])
    #expect(m.lat == -33.9 && m.lon == -18.4 && m.altitude == -12.0)
}

@Test func exifRejectsNullIsland() {
    let m = ExifParser.parse(["{GPS}": ["Latitude": 0.0, "LatitudeRef": "N", "Longitude": 0.0, "LongitudeRef": "E", "Altitude": 5.0]])
    #expect(m.lat == nil && m.lon == nil && m.altitude == nil)
}
