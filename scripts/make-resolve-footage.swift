import Foundation
import AVFoundation
import CoreVideo

// Procedural, known-duration test footage; no user media or network access.
let path = CommandLine.arguments[1]
let fps = Int32(CommandLine.arguments[2])!
let url = URL(fileURLWithPath: path)
if FileManager.default.fileExists(atPath: path) { try FileManager.default.removeItem(at: url) }
let writer = try AVAssetWriter(outputURL: url, fileType: .mov)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 320, AVVideoHeightKey: 180
])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: 320, kCVPixelBufferHeightKey as String: 180
])
writer.add(input)
guard writer.startWriting() else { fatalError(String(describing: writer.error)) }
writer.startSession(atSourceTime: .zero)
for frame in 0..<(Int(fps) * 12) {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.001) }
    var buffer: CVPixelBuffer?
    CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    let pixelBuffer = buffer!
    CVPixelBufferLockBaseAddress(pixelBuffer, [])
    let bytes = CVPixelBufferGetBaseAddress(pixelBuffer)!.assumingMemoryBound(to: UInt8.self)
    let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
    for y in 0..<180 { for x in 0..<320 {
        let pos = y * stride + x * 4
        bytes[pos] = 255
        bytes[pos + 1] = UInt8((frame * 3) % 256)
        bytes[pos + 2] = UInt8(x % 256)
        bytes[pos + 3] = UInt8(y % 256)
    } }
    CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
    guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)) else {
        fatalError(String(describing: writer.error))
    }
}
input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else { fatalError(String(describing: writer.error)) }
print("Generated \(path): \(fps) fps, 12 seconds, \(Int(fps) * 12) frames")
