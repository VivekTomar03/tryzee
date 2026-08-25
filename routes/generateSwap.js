const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const ai = require("../config/gemini");

const generateSwapRoute = express.Router();

// Ensure uploads/swap-generations folder exists.
//
// Wrapped because this runs at import time: on a read-only filesystem
// (Vercel and other serverless hosts) mkdir throws EROFS/ENOENT and takes the
// entire API down before a single route is registered — not just /swap.
// Failing quietly here keeps auth, wallet, history and scraping working; the
// write itself still fails later, which /swap reports properly.
const uploadsDir = path.join(__dirname, "../uploads/swap-generations");
try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (err) {
  console.warn(
    `[swap] could not create ${uploadsDir} (${err.code}) — generated images cannot be stored on this host`
  );
}

// Product images come from arbitrary e-commerce CDNs, so the format is not ours
// to choose - Meesho serves AVIF, others WebP, and that will keep changing. Rather
// than rejecting whatever the model does not accept, normalise everything to JPEG.
// Downscaling here also cuts upload size and token count substantially: an observed
// 1204KB PNG becomes ~100KB.
const MAX_IMAGE_DIMENSION = Number(process.env.MAX_IMAGE_DIMENSION) || 1024;
const JPEG_QUALITY = Number(process.env.JPEG_QUALITY) || 85;
const IMAGE_FETCH_TIMEOUT_MS =
  Number(process.env.IMAGE_FETCH_TIMEOUT_MS) || 15000;

// Fetch an image from any URL and return it as JPEG base64 the model will accept.
async function fetchImageAsJpegBase64(url, label) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: IMAGE_FETCH_TIMEOUT_MS,
    headers: {
      // Some CDNs 403 requests without a browser-ish UA.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });

  const original = Buffer.from(response.data);
  const servedType = (response.headers["content-type"] || "unknown")
    .split(";")[0]
    .trim();

  let meta;
  try {
    meta = await sharp(original).metadata();
  } catch (err) {
    const e = new Error(`Unreadable image at ${url} (${servedType})`);
    e.isImageDecodeError = true;
    throw e;
  }

  // rotate() applies EXIF orientation, so phone photos are not sent sideways.
  const jpeg = await sharp(original)
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();

  const beforeKB = Math.round(original.length / 1024);
  const afterKB = Math.round(jpeg.length / 1024);
  console.log(
    `[swap]   ${label}: ${servedType} ${meta.width}x${meta.height} ${beforeKB}KB ` +
      `-> jpeg ${afterKB}KB  ${url}`
  );

  return { base64: jpeg.toString("base64"), mimeType: "image/jpeg", url };
}

// Gemini's image models return 503 UNAVAILABLE under load, often intermittently -
// the same request frequently succeeds a moment later. Retry each model a couple
// of times, then fall back to the next one so a capacity spike does not fail the
// request outright. Quality order: Pro -> Flash -> 2.5 Flash.
const MODEL_CHAIN = [
  ...new Set(
    (
      process.env.GEMINI_IMAGE_MODELS ||
      [
        process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image",
        "gemini-3.1-flash-image",
        "gemini-3.1-flash-lite-image",
        "gemini-2.5-flash-image",
      ].join(",")
    )
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
  ),
];

// Text models (e.g. gemini-3.1-pro-preview) accept image input but can never
// return an image - they silently describe it instead. Catch that misconfig here
// rather than after a 90s call that produces no image.
const nonImageModels = MODEL_CHAIN.filter((m) => !m.includes("image"));
if (nonImageModels.length) {
  console.warn(
    `[swap] WARNING: not image-generation models: ${nonImageModels.join(", ")}. ` +
      `Expected an id containing "image" (e.g. gemini-3-pro-image). ` +
      `These will return text, never an image.`
  );
}

const RETRIES_PER_MODEL = Number(process.env.GEMINI_RETRIES_PER_MODEL) || 2;

// Without a cap a single slow model blocks the whole request - one observed call
// took 306s. Abort it and move to the next model instead of waiting it out.
const ATTEMPT_TIMEOUT_MS =
  Number(process.env.GEMINI_ATTEMPT_TIMEOUT_MS) || 60000;

// Ceiling for the whole chain, so a bad run has a predictable upper bound
// instead of models x retries x timeout.
const TOTAL_BUDGET_MS = Number(process.env.GEMINI_TOTAL_BUDGET_MS) || 150000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Only these are worth retrying - a block or bad input will fail identically.
const isTransient = (code) => code === 503 || code === 429 || code === 500;

async function generateWithFallback(contents) {
  let lastError = null;
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const model of MODEL_CHAIN) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.error(
          `[swap]   total budget ${TOTAL_BUDGET_MS / 1000}s exhausted, giving up`
        );
        throw lastError || new Error("Image generation timed out");
      }
      // Never let one attempt run past the overall budget.
      const attemptMs = Math.min(ATTEMPT_TIMEOUT_MS, remaining);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptMs);
      const attemptStart = Date.now();

      try {
        console.log(`[swap] calling ${model} (attempt ${attempt}) ...`);
        const result = await ai.models.generateContent({
          model,
          contents,
          config: {
            responseModalities: ["Text", "Image"],
            abortSignal: controller.signal,
          },
        });
        return { result, model };
      } catch (err) {
        lastError = err;
        const secs = ((Date.now() - attemptStart) / 1000).toFixed(1);

        if (controller.signal.aborted) {
          console.error(
            `[swap]   ${model} attempt ${attempt} TIMED OUT after ${secs}s`
          );
          break; // a slow model will likely be slow again - go to the next one
        }

        let code = null;
        try {
          code = JSON.parse(String(err.message)).error?.code;
        } catch {
          /* non-JSON error */
        }

        console.error(
          `[swap]   ${model} attempt ${attempt} failed in ${secs}s: ${
            code || err.message
          }`
        );

        if (!isTransient(code)) throw err; // blocked / bad input - no point retrying

        if (attempt < RETRIES_PER_MODEL) await sleep(1500 * attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    console.error(`[swap]   ${model} exhausted, falling back`);
  }

  throw lastError;
}

// POST /generate-swap
generateSwapRoute.post("/", async (req, res) => {
  try {
    const { part, my_image_url, person_image_url, gender, quality } = req.body;
// console.log("Received generate swap request:", req.body);
    // Validate required fields
    if (!part || !my_image_url || !person_image_url) {
      return res.status(400).json({
        message:
          "Missing required fields: part, my_image_url, person_image_url",
      });
    }

    // Validate part
    const validparts = ["upper", "lower", "full"];
    if (!validparts.includes(part)) {
      return res.status(400).json({
        message: "Invalid part. Must be: upper, lower, or full",
      });
    }

    // Fetch both images as base64
    console.log(
      `[swap] request  part=${part} gender=${gender || "-"} quality=${
        quality || "standard"
      }`
    );
    const [userImage, clothesImage] = await Promise.all([
      fetchImageAsJpegBase64(my_image_url, "user  "),
      fetchImageAsJpegBase64(person_image_url, "cloth "),
    ]);

    // Build prompt based on part
    let partDescription = "";
    switch (part) {
      case "upper":
        partDescription = "upper body clothing (shirt, top, jacket, etc.)";
        break;
      case "lower":
        partDescription = "lower body clothing (pants, skirt, shorts, etc.)";
        break;
      case "full":
        partDescription = "full body outfit (complete clothing)";
        break;
    }

    const genderText = gender ? `The person is ${gender}.` : "";
    const qualityText =
      quality === "high" ? "high quality, detailed" : "good quality";

    const prompt = `You are a virtual try-on AI assistant.

Task: Edit the FIRST image so the person in it is wearing the ${partDescription} from the SECOND image. This is an edit of an existing photo, not the creation of a new one.

=== IDENTITY RULES (highest priority) ===
- The person in the output MUST be the same person as in Image 1. Keep the face, facial features, expression, hair style, hair colour, skin tone, body shape and build EXACTLY as they are.
- Do NOT generate, substitute, beautify, slim, or re-imagine the person. Do not change their age or ethnicity.
- If any part of the person is not visible in Image 1, do NOT invent it — see the framing rules below.

=== FRAMING RULES ===
- Keep the exact same camera framing, crop, zoom and pose as Image 1. If Image 1 is a waist-up or half-body shot, the output MUST stay a waist-up or half-body shot.
- Never extend the frame to show body parts that were cropped out of Image 1. Do not turn a half-body photo into a full-body photo.
- Keep the original background unchanged.

=== CLOTHING RULES ===
- Replace only the ${partDescription}. Reproduce the garment from Image 2 exactly: colour, shade, pattern, print, texture, fabric, cut, neckline, sleeve length, hemline, and any logos or embroidery.
- Do not simplify or substitute any clothing detail. If Image 2 is blurry or low resolution, reconstruct the garment faithfully rather than inventing a different design.
- The garment must drape naturally on the person's actual body shape, with correct fit, folds and shadows.
- Leave all other clothing that is visible in Image 1 unchanged.

=== OUTPUT RULES ===
- ${genderText}
- Lighting and shadows must match Image 1.
- Output: ${qualityText}, photorealistic — it must look like the original photograph with the garment changed, not a composite or an illustration.

Generate the virtual try-on result image.`;

    const contents = [
      { text: prompt },
      {
        inlineData: {
          mimeType: userImage.mimeType,
          data: userImage.base64,
        },
      },
      {
        inlineData: {
          mimeType: clothesImage.mimeType,
          data: clothesImage.base64,
        },
      },
    ];

    const startedAt = Date.now();
    const { result, model } = await generateWithFallback(contents);

    console.log(
      `[swap] ${model} responded in ${(
        (Date.now() - startedAt) / 1000
      ).toFixed(1)}s  ` +
        `candidates=${result.candidates?.length ?? "NONE"} ` +
        `finish=${result.candidates?.[0]?.finishReason || "-"}`
    );

    // No candidates => blocked or filtered. Surface the real reason instead of
    // crashing on candidates[0] with "Cannot read properties of undefined".
    const candidate = result.candidates?.[0];
    if (!candidate?.content?.parts) {
      console.error(
        "[swap] NO CANDIDATES. promptFeedback=",
        JSON.stringify(result.promptFeedback || null),
        "finishReason=",
        candidate?.finishReason || "-",
        "safetyRatings=",
        JSON.stringify(candidate?.safetyRatings || null)
      );
      // Blocked content is the user's problem to fix (usually the photo), so say
      // that much - but never expose the provider or its raw feedback.
      const blocked =
        result.promptFeedback?.blockReason || candidate?.finishReason;
      return res.status(422).json({
        message: blocked
          ? "Could not generate an image from this photo. Please try a different photo."
          : "Could not generate the image. Please try again.",
      });
    }

    // Extract generated image from response
    let generatedImageBase64 = null;
    let textResponse = "";

    for (const responsePart of candidate.content.parts) {
      if (responsePart.text) {
        textResponse = responsePart.text;
      } else if (responsePart.inlineData) {
        generatedImageBase64 = responsePart.inlineData.data;
      }
    }

    if (!generatedImageBase64) {
      console.error(
        `[swap] no image part. finish=${candidate.finishReason} text="${textResponse}"`
      );
      return res.status(502).json({
        message: "Could not generate the image. Please try again.",
      });
    }

    // Save generated image to uploads folder
    const buffer = Buffer.from(generatedImageBase64, "base64");
    const filename = `swap_${Date.now()}_${Math.random().toString(36).substring(7)}.png`;
    const filePath = path.join(uploadsDir, filename);

    fs.writeFileSync(filePath, buffer);

    // Return path relative to base URL
    const imageUrl = `/uploads/swap-generations/${filename}`;

    res.json({
      message: "Image generated successfully",
      image_url: imageUrl, // Use: baseUrl + image_url to display
      output_file: imageUrl,
      part,
      gender,
      quality: quality || "standard",
      input_files: {
        my_image: my_image_url,
        person_image: person_image_url,
      },
    });
  } catch (err) {
    // The SDK stuffs the real Google error into err.message as a JSON string.
    // Parse it so the log shows code/status/reason instead of a wall of text.
    let google = null;
    try {
      google = JSON.parse(String(err.message)).error;
    } catch {
      /* not a JSON ApiError - fall through */
    }

    if (google) {
      console.error(
        `[swap] GEMINI ERROR code=${google.code} status=${google.status}\n` +
          `        message: ${google.message}`
      );
      if (google.details) {
        console.error(
          "        details:",
          JSON.stringify(google.details, null, 2)
        );
      }

      // Map upstream status so the client can tell these apart, but send our own
      // wording - the provider's raw message must not reach the client.
      const responses = {
        429: [429, "Too many requests right now. Please try again shortly."],
        503: [503, "Image generation is busy. Please try again in a moment."],
        400: [400, "The provided images could not be processed."],
        500: [502, "Could not generate the image. Please try again."],
      };
      const [status, message] = responses[google.code] || [
        502,
        "Could not generate the image. Please try again.",
      ];
      return res.status(status).json({ message });
    }

    // The bytes downloaded but were not a decodable image (dead CDN link, an
    // HTML error page served with an image content-type, a truly exotic format).
    if (err.isImageDecodeError) {
      console.error(`[swap] IMAGE DECODE FAILED: ${err.message}`);
      return res.status(400).json({
        message: "One of the images could not be read. Please pick another image.",
      });
    }

    if (err.code === "ECONNABORTED") {
      console.error(`[swap] IMAGE FETCH TIMED OUT: ${err.config?.url}`);
      return res.status(504).json({
        message: "Downloading the images took too long. Please try again.",
      });
    }

    // Image fetch failures (axios) and everything else.
    if (err.response) {
      console.error(
        `[swap] IMAGE FETCH FAILED status=${err.response.status} url=${err.config?.url}`
      );
      return res.status(400).json({
        message: "Could not download one of the images. Please try again.",
      });
    }

    console.error("[swap] UNEXPECTED ERROR:", err);
    res.status(500).json({
      message: "Could not generate the image. Please try again.",
    });
  }
});

module.exports = generateSwapRoute;
