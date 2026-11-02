import Foundation
import AVFoundation
import Vision
import ImageIO
import UniformTypeIdentifiers

// Read the actual OBS recording; write untouched decoded frames and OCR evidence.
// Usage: swift ... inspect-recording.swift <recording> <output-directory> [seconds ...]
let arguments = CommandLine.arguments
guard arguments.count >= 3 else { fatalError("Expected recording and output directory") }
let input = URL(fileURLWithPath: arguments[1]), output = URL(fileURLWithPath: arguments[2])
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let asset = AVURLAsset(url: input)
let duration = CMTimeGetSeconds(asset.duration)
guard let track = asset.tracks(withMediaType: .video).first else { fatalError("No video track") }
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
var frames: [[String: Any]] = []
let times = arguments.count > 3 ? arguments.dropFirst(3).compactMap(Double.init) : [0.0, min(10.0, duration / 2)]
for seconds in times where seconds >= 0 && seconds < duration {
  var actual = CMTime.zero
  // Round explicitly before constructing CMTime: a binary double just below a frame boundary
  // otherwise seeks to the preceding frame even with zero requested tolerance.
  let requested = CMTime(value: Int64((seconds * 60000).rounded()), timescale: 60000)
  let image = try generator.copyCGImage(at: requested, actualTime: &actual)
  let filename = "frame-" + String(format: "%.3f", seconds) + ".png"
  let destination = CGImageDestinationCreateWithURL(output.appendingPathComponent(filename) as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, nil)
  guard CGImageDestinationFinalize(destination) else { fatalError("Frame write failed") }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-US"]
  try VNImageRequestHandler(cgImage: image).perform([request])
  let texts = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
  let unix = texts.first { $0.range(of: "^[0-9]{13}$", options: .regularExpression) != nil }.flatMap(Double.init)
  var frame: [String: Any] = ["requestedSeconds": seconds, "actualSeconds": CMTimeGetSeconds(actual), "file": filename, "ocr": texts]
  if let unix = unix { frame["visibleUnixMs"] = unix; frame["recordingOriginEstimateMs"] = unix - CMTimeGetSeconds(actual) * 1000 }
  frames.append(frame)
}
let report: [String: Any] = ["provenance": "AVFoundation decoding and Vision OCR of actual OBS recording", "recording": input.path,
  "durationSeconds": duration, "fps": track.nominalFrameRate, "width": track.naturalSize.width, "height": track.naturalSize.height, "frames": frames]
let data = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
try data.write(to: output.appendingPathComponent("recording-inspection.json"))
print(String(data: data, encoding: .utf8)!)
