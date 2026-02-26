import { GRID_SIZE, type PixelData, type FrameTuple } from "./characters";

/**
 * Downscale an image data URI to target dimensions using nearest-neighbor interpolation.
 */
export function downscaleImage(
  dataUri: string,
  targetW: number,
  targetH: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUri;
  });
}

/**
 * Convert an image data URI to a PixelData grid by downscaling and reading pixels.
 */
export function imageToPixelData(
  dataUri: string,
  gridSize: number = GRID_SIZE
): Promise<PixelData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = gridSize;
      canvas.height = gridSize;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, gridSize, gridSize);

      const imageData = ctx.getImageData(0, 0, gridSize, gridSize);
      const pixels: PixelData = [];

      for (let row = 0; row < gridSize; row++) {
        const rowData: (string | null)[] = [];
        for (let col = 0; col < gridSize; col++) {
          const i = (row * gridSize + col) * 4;
          const r = imageData.data[i];
          const g = imageData.data[i + 1];
          const b = imageData.data[i + 2];
          const a = imageData.data[i + 3];

          if (a < 128) {
            rowData.push(null);
          } else {
            const hex =
              "#" +
              r.toString(16).padStart(2, "0").toUpperCase() +
              g.toString(16).padStart(2, "0").toUpperCase() +
              b.toString(16).padStart(2, "0").toUpperCase();
            rowData.push(hex);
          }
        }
        pixels.push(rowData);
      }

      resolve(pixels);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUri;
  });
}

/**
 * Extract a single frame from a canvas context and convert to GRID_SIZE x GRID_SIZE PixelData.
 * Handles any source frame size by resampling to GRID_SIZE via a temp canvas.
 */
function extractFrame(
  srcCtx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): PixelData {
  // Draw the sub-region into a GRID_SIZE x GRID_SIZE canvas
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = GRID_SIZE;
  tmpCanvas.height = GRID_SIZE;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.imageSmoothingEnabled = false;
  tmpCtx.drawImage(
    srcCtx.canvas,
    sx, sy, sw, sh,       // source rect
    0, 0, GRID_SIZE, GRID_SIZE  // dest rect (always GRID_SIZE)
  );

  const imageData = tmpCtx.getImageData(0, 0, GRID_SIZE, GRID_SIZE);
  const pixels: PixelData = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    const rowData: (string | null)[] = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const i = (row * GRID_SIZE + col) * 4;
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const a = imageData.data[i + 3];

      if (a < 128) {
        rowData.push(null);
      } else {
        const hex =
          "#" +
          r.toString(16).padStart(2, "0").toUpperCase() +
          g.toString(16).padStart(2, "0").toUpperCase() +
          b.toString(16).padStart(2, "0").toUpperCase();
        rowData.push(hex);
      }
    }
    pixels.push(rowData);
  }

  return pixels;
}

/**
 * Scan a column or row of pixels to check if it's mostly empty (a grid line/border).
 * Returns true if the line has less than 10% opaque pixels.
 */
function isEmptyLine(
  imageData: ImageData,
  axis: "col" | "row",
  index: number,
  width: number,
  height: number
): boolean {
  let opaqueCount = 0;
  const length = axis === "col" ? height : width;
  for (let i = 0; i < length; i++) {
    const px = axis === "col" ? index : i;
    const py = axis === "col" ? i : index;
    const a = imageData.data[(py * width + px) * 4 + 3];
    if (a > 30) opaqueCount++;
  }
  return opaqueCount / length < 0.1;
}

/**
 * Find the boundaries of a 4x4 grid in a spritesheet by detecting empty
 * columns/rows that separate frames. Falls back to equal division.
 */
function findGridBoundaries(
  imageData: ImageData,
  width: number,
  height: number,
  count: number
): number[] {
  // Scan for empty columns/rows to find dividers
  const boundaries: number[] = [0];

  // For each expected divider, search near the expected position
  for (let i = 1; i < count; i++) {
    const expected = Math.round((i * width) / count);
    let found = expected;
    // Search within ±5% of expected position for an empty line
    const searchRange = Math.round(width * 0.05);
    for (let offset = 0; offset <= searchRange; offset++) {
      if (expected + offset < width && isEmptyLine(imageData, "col", expected + offset, width, height)) {
        found = expected + offset + 1; // Start after the empty line
        break;
      }
      if (expected - offset >= 0 && isEmptyLine(imageData, "col", expected - offset, width, height)) {
        found = expected - offset; // End before the empty line
        break;
      }
    }
    boundaries.push(found);
  }
  boundaries.push(width);
  return boundaries;
}

/**
 * Parse a spritesheet image into directional walk frames.
 * Expected layout: 4 rows x 4 columns (walk frames).
 * Auto-detects frame boundaries to handle padding/borders between frames.
 * Each extracted frame is normalized to GRID_SIZE x GRID_SIZE PixelData.
 */
export function parseSpritesheet(
  dataUri: string,
  frameW: number,
  frameH: number
): Promise<{
  walkDown: FrameTuple;
  walkUp: FrameTuple;
  walkLeft: FrameTuple;
  walkRight: FrameTuple;
}> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0);

      const fullImageData = ctx.getImageData(0, 0, img.width, img.height);

      // Auto-detect column and row boundaries
      const colBounds = findGridBoundaries(fullImageData, img.width, img.height, 4);
      // For rows, we need to scan horizontal lines
      const rowBounds: number[] = [0];
      for (let i = 1; i < 4; i++) {
        const expected = Math.round((i * img.height) / 4);
        let found = expected;
        const searchRange = Math.round(img.height * 0.05);
        for (let offset = 0; offset <= searchRange; offset++) {
          if (expected + offset < img.height && isEmptyLine(fullImageData, "row", expected + offset, img.width, img.height)) {
            found = expected + offset + 1;
            break;
          }
          if (expected - offset >= 0 && isEmptyLine(fullImageData, "row", expected - offset, img.width, img.height)) {
            found = expected - offset;
            break;
          }
        }
        rowBounds.push(found);
      }
      rowBounds.push(img.height);

      console.log(`[parseSpritesheet] image=${img.width}x${img.height}, colBounds=${JSON.stringify(colBounds)}, rowBounds=${JSON.stringify(rowBounds)}`);

      // rd-animation spritesheet row order: Row 0=Up, Row 1=Right, Row 2=Down, Row 3=Left
      // rd-animation spritesheet row order: Row 0=Down, Row 1=Up, Row 2=Left, Row 3=Right
      const rowToDirection = ["walkDown", "walkUp", "walkLeft", "walkRight"] as const;
      const result: Record<string, FrameTuple> = {};

      for (let rowIdx = 0; rowIdx < 4; rowIdx++) {
        const dir = rowToDirection[rowIdx];
        const frames: PixelData[] = [];
        const sy = rowBounds[rowIdx];
        const sh = rowBounds[rowIdx + 1] - sy;

        for (let frameIdx = 0; frameIdx < 4; frameIdx++) {
          const sx = colBounds[frameIdx];
          const sw = colBounds[frameIdx + 1] - sx;
          const pixels = extractFrame(ctx, sx, sy, sw, sh);
          console.log(`[parseSpritesheet] row ${rowIdx} → ${dir}[${frameIdx}]: src=(${sx},${sy},${sw}x${sh}) → ${pixels.length}x${pixels[0]?.length ?? 0}`);
          frames.push(pixels);
        }
        result[dir] = frames as unknown as FrameTuple;
      }

      resolve(result as {
        walkDown: FrameTuple;
        walkUp: FrameTuple;
        walkLeft: FrameTuple;
        walkRight: FrameTuple;
      });
    };
    img.onerror = () => reject(new Error("Failed to load spritesheet"));
    img.src = dataUri;
  });
}

/**
 * Fallback: Generate 4 walk animation frames from a single base frame by shifting pixels.
 * Frame 0: base, Frame 1: shift left 1px, Frame 2: base, Frame 3: shift right 1px
 */
export function generateWalkFrames(
  baseFrame: PixelData
): FrameTuple {
  const cols = baseFrame[0]?.length ?? 0;

  const base1: PixelData = baseFrame.map((row) => [...row]);
  const shiftLeft: PixelData = baseFrame.map((row) => [...row.slice(1), null]);
  const base2: PixelData = baseFrame.map((row) => [...row]);
  const shiftRight: PixelData = baseFrame.map((row) => [null, ...row.slice(0, cols - 1)]);

  return [base1, shiftLeft, base2, shiftRight];
}
