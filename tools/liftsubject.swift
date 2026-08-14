// Lift a garment off its background using Apple's own subject-segmentation
// model — the one Photos uses when you long-press an object and it pops out.
//
// Why this exists: cutout.js flood-fills from the border by colour, which is
// cheap and works on a plain backdrop. It cannot solve the cases that actually
// matter — a white top on a white sheet, a wooden hanger touching the shoulders,
// a garment on a model. Alta hit the same wall and moved to Meta's Segment
// Anything. This is the equivalent that ships with macOS: free, on-device, no
// API key, no per-image cost.
//
// The flood fill stays in the app for photos added on the phone. This is the
// batch path for a whole wardrobe.
//
//   swiftc -O tools/liftsubject.swift -o tools/liftsubject
//   tools/liftsubject in.heic out.png

import AppKit
import CoreImage
import Foundation
import Vision

struct Failure: Error { let message: String }

func lift(from input: URL, to output: URL) throws {
    let request = VNGenerateForegroundInstanceMaskRequest()
    let handler = VNImageRequestHandler(url: input)
    try handler.perform([request])

    guard let result = request.results?.first, !result.allInstances.isEmpty else {
        throw Failure(message: "no subject found")
    }

    // Crop to the subject's extent: it drops the surrounding bedsheet entirely,
    // so every garment arrives at a consistent scale instead of floating in
    // whatever margin the photo happened to have.
    let masked = try result.generateMaskedImage(
        ofInstances: result.allInstances,
        from: handler,
        croppedToInstancesExtent: true
    )

    let ci = CIImage(cvPixelBuffer: masked)
    let context = CIContext()
    guard let colourSpace = CGColorSpace(name: CGColorSpace.sRGB) else {
        throw Failure(message: "no sRGB colour space")
    }
    guard let png = context.pngRepresentation(
        of: ci, format: .RGBA8, colorSpace: colourSpace
    ) else {
        throw Failure(message: "could not encode PNG")
    }
    try png.write(to: output)

    // Report how many separate objects it found. More than one usually means a
    // hanger, or a second garment in shot — worth knowing rather than guessing.
    FileHandle.standardError.write(
        "\(input.lastPathComponent): \(result.allInstances.count) instance(s)\n".data(using: .utf8)!
    )
}

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: liftsubject <input> <output.png>\n".data(using: .utf8)!)
    exit(2)
}

do {
    try lift(from: URL(fileURLWithPath: args[1]), to: URL(fileURLWithPath: args[2]))
} catch let e as Failure {
    FileHandle.standardError.write("\(args[1]): \(e.message)\n".data(using: .utf8)!)
    exit(1)
} catch {
    FileHandle.standardError.write("\(args[1]): \(error.localizedDescription)\n".data(using: .utf8)!)
    exit(1)
}
