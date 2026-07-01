/**
 * Stepless — Browser-Side IPFS Upload Utility
 * ============================================
 *
 * Vanilla JS (no build step required). Works in modern browsers with
 * <script type="module"> or bundlers (webpack, vite, etc.).
 *
 * Features:
 *   - Image compression via Canvas API (max 1024×1024, JPEG quality 0.8)
 *   - EXIF data stripping for privacy (canvas export strips EXIF)
 *   - EXIF orientation correction (reads orientation before stripping)
 *   - Metadata JSON creation and upload
 *   - Pinata API for IPFS pinning
 *   - Progress callback for upload UI
 *   - Error handling with retry logic (exponential backoff)
 *   - Returns CID for on-chain storage via Memo contract
 *
 * Usage:
 *   import { SteplessIPFS } from './ipfs-upload.js';
 *
 *   const ipfs = new SteplessIPFS({
 *     pinataApiKey: 'your-key',
 *     pinataApiSecret: 'your-secret',
 *     gateway: 'https://gateway.pinata.cloud/ipfs/'
 *   });
 *
 *   const result = await ipfs.uploadPhoto(fileElement.files[0], {
 *     latitude: -23.5505,
 *     longitude: -46.6333,
 *     category: 'ramp',
 *     accessibilityRating: 5,
 *     description: 'Wheelchair ramp at north entrance',
 *     contributorAddress: '0x1234...'
 *   }, {
 *     onProgress: (pct) => updateProgressBar(pct)
 *   });
 *
 *   // result.photoCID → store on-chain via Memo contract
 *   // result.metaCID  → metadata JSON CID
 *   // result.gatewayUrl → direct photo URL
 *
 * Arc Memo Contract: 0x5294E9927c3306DcBaDb03fe70b92e01cCede505
 */

'use strict';

// ============================================================================
// Constants
// ============================================================================

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;
const THUMBNAIL_DIMENSION = 256;
const THUMBNAIL_QUALITY = 0.7;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const UPLOAD_TIMEOUT_MS = 60000;

const PINATA_FILE_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';
const PINATA_JSON_ENDPOINT = 'https://api.pinata.cloud/pinning/pinJSONToIPFS';

const VALID_CATEGORIES = ['ramp', 'restroom', 'parking', 'entrance', 'elevator', 'other'];
const VALID_VERIFICATION_STATUSES = ['pending', 'verified', 'rejected'];

const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/'
];

// ============================================================================
// EXIF Orientation Reader (minimal, no external dependency)
// ============================================================================

/**
 * Reads the EXIF orientation tag from a JPEG File/Blob.
 * Returns a promise resolving to an orientation value (1–8) or 1 if not found.
 * Uses minimal JPEG marker parsing — no external library needed.
 *
 * @param {Blob} file - JPEG file blob
 * @returns {Promise<number>} orientation (1 = normal, 3 = 180°, 6 = 90° CW, 8 = 270° CW)
 */
function readExifOrientation(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xffd8) {
          resolve(1); // Not a JPEG
          return;
        }
        let offset = 2;
        while (offset < view.byteLength) {
          const marker = view.getUint16(offset, false);
          offset += 2;
          if (marker === 0xffe1) {
            // APP1 (EXIF)
            const length = view.getUint16(offset, false);
            offset += 2;
            const exifData = view.getUint32(offset + 2, false);
            if (exifData !== 0x45786966) {
              resolve(1);
              return;
            }
            const tiffOffset = offset + 8;
            const byteOrder = view.getUint16(tiffOffset, false);
            const isLittleEndian = byteOrder === 0x4949;
            const ifdOffset = tiffOffset + view.getUint32(tiffOffset + 4, isLittleEndian);
            const entries = view.getUint16(ifdOffset, isLittleEndian);
            for (let i = 0; i < entries; i++) {
              const entryOffset = ifdOffset + 2 + i * 12;
              const tag = view.getUint16(entryOffset, isLittleEndian);
              if (tag === 0x0112) {
                // Orientation tag
                const orientation = view.getUint16(entryOffset + 8, isLittleEndian);
                resolve(orientation);
                return;
              }
            }
          } else if ((marker & 0xff00) !== 0xff00) {
            break;
          } else {
            offset += view.getUint16(offset, false);
          }
        }
        resolve(1);
      } catch (err) {
        resolve(1);
      }
    };
    reader.onerror = () => resolve(1);
    // Read only the first 64KB (EXIF is near the start)
    const slice = file.slice(0, Math.min(file.size, 65536));
    reader.readAsArrayBuffer(slice);
  });
}

// ============================================================================
// Image Compression & EXIF Stripping
// ============================================================================

/**
 * Compresses an image file using Canvas API.
 * - Resizes to max dimension (preserving aspect ratio)
 * - Exports as JPEG (strips all EXIF metadata)
 * - Corrects EXIF orientation before export
 *
 * @param {File|Blob} file - Source image file
 * @param {number} maxDim - Maximum width/height in pixels
 * @param {number} quality - JPEG quality (0.0–1.0)
 * @param {function} [onProgress] - Optional progress callback (0–100)
 * @returns {Promise<Blob>} compressed JPEG blob
 */
async function compressImage(file, maxDim, quality, onProgress) {
  if (onProgress) onProgress(5);

  // Read EXIF orientation
  const orientation = await readExifOrientation(file);
  if (onProgress) onProgress(15);

  // Load image into an HTMLImageElement
  const img = await loadImage(file);
  if (onProgress) onProgress(30);

  // Calculate target dimensions
  let { width, height } = calculateDimensions(img.width, img.height, maxDim);

  // Create canvas at target size
  const canvas = document.createElement('canvas');

  // Apply orientation transform
  const ctx = canvas.getContext('2d');
  applyOrientation(canvas, ctx, width, height, orientation);

  // Draw image
  ctx.drawImage(img, 0, 0, width, height);
  if (onProgress) onProgress(50);

  // Export as JPEG (this strips all EXIF)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          if (onProgress) onProgress(60);
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob failed — unsupported image format'));
        }
      },
      'image/jpeg',
      quality
    );
  });
}

/**
 * Loads a File/Blob into an HTMLImageElement.
 * @param {File|Blob} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

/**
 * Calculates target dimensions preserving aspect ratio.
 * @param {number} srcW - Source width
 * @param {number} srcH - Source height
 * @param {number} maxDim - Maximum dimension
 * @returns {{width: number, height: number}}
 */
function calculateDimensions(srcW, srcH, maxDim) {
  if (srcW <= maxDim && srcH <= maxDim) {
    return { width: srcW, height: srcH };
  }
  if (srcW >= srcH) {
    return {
      width: maxDim,
      height: Math.round((srcH / srcW) * maxDim)
    };
  }
  return {
    width: Math.round((srcW / srcH) * maxDim),
    height: maxDim
  };
}

/**
 * Applies EXIF orientation transform to canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} orientation - EXIF orientation value (1–8)
 */
function applyOrientation(canvas, ctx, width, height, orientation) {
  switch (orientation) {
    case 1: // Normal
      canvas.width = width;
      canvas.height = height;
      break;
    case 2: // Flip horizontal
      canvas.width = width;
      canvas.height = height;
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
      break;
    case 3: // Rotate 180°
      canvas.width = width;
      canvas.height = height;
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 4: // Flip vertical
      canvas.width = width;
      canvas.height = height;
      ctx.translate(0, height);
      ctx.scale(1, -1);
      break;
    case 5: // Transpose (flip horizontal + rotate 90° CW)
      canvas.width = height;
      canvas.height = width;
      ctx.rotate(Math.PI / 2);
      ctx.scale(1, -1);
      break;
    case 6: // Rotate 90° CW
      canvas.width = height;
      canvas.height = width;
      ctx.rotate(Math.PI / 2);
      ctx.translate(0, -height);
      break;
    case 7: // Transverse (flip horizontal + rotate 270° CW)
      canvas.width = height;
      canvas.height = width;
      ctx.rotate(Math.PI / 2);
      ctx.translate(width, -height);
      ctx.scale(-1, 1);
      break;
    case 8: // Rotate 270° CW
      canvas.width = height;
      canvas.height = width;
      ctx.rotate(-Math.PI / 2);
      ctx.translate(-width, 0);
      break;
    default:
      canvas.width = width;
      canvas.height = height;
  }
}

// ============================================================================
// Metadata Creation
// ============================================================================

/**
 * Creates a Stepless photo metadata object per the JSON schema.
 *
 * @param {object} params
 * @param {string} params.photoCID - IPFS CID of the uploaded photo
 * @param {string} [params.photoThumbnailCID] - IPFS CID of thumbnail (optional)
 * @param {number} params.latitude - WGS84 latitude
 * @param {number} params.longitude - WGS84 longitude
 * @param {string} params.category - One of: ramp, restroom, parking, entrance, elevator, other
 * @param {number} params.accessibilityRating - Rating 1–5
 * @param {string|object} params.description - Description string or multilingual map
 * @param {string} params.contributorAddress - Ethereum address (0x...)
 * @param {string} [params.locationHash] - Pre-computed bytes32 location hash
 * @returns {object} metadata object
 */
function createMetadata(params) {
  // Validate category
  if (!VALID_CATEGORIES.includes(params.category)) {
    throw new Error(
      `Invalid category "${params.category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`
    );
  }

  // Validate accessibility rating
  const rating = Number(params.accessibilityRating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new Error(`accessibilityRating must be an integer 1–5, got: ${params.accessibilityRating}`);
  }

  // Validate contributor address
  if (!/^0x[a-fA-F0-9]{40}$/.test(params.contributorAddress)) {
    throw new Error(`Invalid contributorAddress: ${params.contributorAddress}`);
  }

  // Round coordinates for privacy (~11m precision)
  const latitude = Math.round(params.latitude * 10000) / 10000;
  const longitude = Math.round(params.longitude * 10000) / 10000;

  // Compute locationHash if not provided
  // locationHash = keccak256(abi.encodePacked(lat, lng, category))
  // In browser, we use a simple hash if ethers is not available
  let locationHash = params.locationHash;
  if (!locationHash) {
    locationHash = computeLocationHash(latitude, longitude, params.category);
  }

  const metadata = {
    locationHash: locationHash,
    latitude: latitude,
    longitude: longitude,
    category: params.category,
    accessibilityRating: rating,
    description: params.description || '',
    contributorAddress: params.contributorAddress,
    timestamp: new Date().toISOString(),
    photoCID: params.photoCID,
    verificationStatus: 'pending'
  };

  // Add optional thumbnail CID
  if (params.photoThumbnailCID) {
    metadata.photoThumbnailCID = params.photoThumbnailCID;
  }

  return metadata;
}

/**
 * Computes a simple location hash (bytes32 hex string).
 * Uses SubtleCrypto SHA-256 if available, falls back to a simple hash.
 * Note: For exact keccak256 matching on-chain, use ethers.js:
 *   ethers.keccak256(ethers.solidityPacked(['int256','int256','string'], [lat*1e6, lng*1e6, category]))
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} category
 * @returns {Promise<string>} 0x-prefixed 32-byte hex string
 */
async function computeLocationHash(lat, lng, category) {
  const input = `${lat.toFixed(4)},${lng.toFixed(4)},${category}`;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return '0x' + Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback: simple FNV-1a hash (not cryptographically secure)
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, '0');
  return '0x' + hex.repeat(8);
}

// ============================================================================
// Pinata IPFS Upload
// ============================================================================

/**
 * Uploads a file blob to Pinata for IPFS pinning.
 * Includes retry logic with exponential backoff.
 *
 * @param {Blob} blob - File blob to upload
 * @param {string} filename - Filename for Pinata
 * @param {object} keyvalues - Pinata metadata key-values
 * @param {object} config - Pinata config (apiKey, apiSecret)
 * @param {function} [onProgress] - Progress callback (0–100)
 * @param {number} [attempt] - Current attempt number (internal)
 * @returns {Promise<string>} IPFS CID
 */
async function pinFileToIPFS(blob, filename, keyvalues, config, onProgress, attempt = 0) {
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append(
    'pinataMetadata',
    JSON.stringify({
      name: filename,
      keyvalues: { app: 'stepless', network: 'arc-testnet', ...keyvalues }
    })
  );

  try {
    if (onProgress) onProgress(70);

    const response = await fetchWithTimeout(
      PINATA_FILE_ENDPOINT,
      {
        method: 'POST',
        headers: {
          pinata_api_key: config.pinataApiKey,
          pinata_secret_api_key: config.pinataApiSecret
        },
        body: formData
      },
      UPLOAD_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Pinata API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (onProgress) onProgress(85);

    if (!data.IpfsHash) {
      throw new Error('Pinata response missing IpfsHash');
    }

    return data.IpfsHash;
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Pinata upload attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
      return pinFileToIPFS(blob, filename, keyvalues, config, onProgress, attempt + 1);
    }
    throw new Error(`Pinata upload failed after ${MAX_RETRIES + 1} attempts: ${error.message}`);
  }
}

/**
 * Uploads a JSON object to Pinata for IPFS pinning.
 *
 * @param {object} json - JSON object to pin
 * @param {object} keyvalues - Pinata metadata key-values
 * @param {object} config - Pinata config
 * @param {number} [attempt] - Current attempt number (internal)
 * @returns {Promise<string>} IPFS CID
 */
async function pinJSONToIPFS(json, keyvalues, config, attempt = 0) {
  try {
    const response = await fetchWithTimeout(
      PINATA_JSON_ENDPOINT,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          pinata_api_key: config.pinataApiKey,
          pinata_secret_api_key: config.pinataApiSecret
        },
        body: JSON.stringify({
          pinataContent: json,
          pinataMetadata: {
            name: 'stepless-metadata',
            keyvalues: { app: 'stepless', network: 'arc-testnet', ...keyvalues }
          }
        })
      },
      UPLOAD_TIMEOUT_MS
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Pinata JSON API error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.IpfsHash) {
      throw new Error('Pinata JSON response missing IpfsHash');
    }

    return data.IpfsHash;
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`Pinata JSON upload attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
      await sleep(delay);
      return pinJSONToIPFS(json, keyvalues, config, attempt + 1);
    }
    throw new Error(`Pinata JSON upload failed after ${MAX_RETRIES + 1} attempts: ${error.message}`);
  }
}

// ============================================================================
// Fetch Helpers
// ============================================================================

/**
 * Fetch with timeout via AbortController.
 * @param {string} url
 * @param {object} options - fetch options
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  );
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// IPFS Gateway Fetch with Fallback
// ============================================================================

/**
 * Fetches content from IPFS using multiple gateways with fallback.
 *
 * @param {string} cid - IPFS CID
 * @param {number} [timeoutMs=10000] - Per-gateway timeout
 * @returns {Promise<Response>}
 */
async function fetchFromIPFS(cid, timeoutMs = 10000) {
  let lastError;
  for (const gateway of IPFS_GATEWAYS) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(gateway + cid, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) return res;
      lastError = new Error(`Gateway ${gateway} returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All IPFS gateways failed for CID ${cid}: ${lastError?.message}`);
}

// ============================================================================
// Main Class: SteplessIPFS
// ============================================================================

/**
 * Stepless IPFS upload utility for browser-side photo storage.
 *
 * Handles:
 *   - Image compression (Canvas API, max 1024×1024, JPEG 0.8)
 *   - EXIF stripping (canvas export strips all EXIF)
 *   - EXIF orientation correction
 *   - Thumbnail generation (256×256, JPEG 0.7)
 *   - Metadata JSON creation and upload
 *   - Pinata IPFS pinning with retry logic
 *   - Progress callbacks for UI
 */
class SteplessIPFS {
  /**
   * @param {object} config
   * @param {string} config.pinataApiKey - Pinata API key
   * @param {string} config.pinataApiSecret - Pinata API secret
   * @param {string} [config.gateway] - IPFS gateway base URL
   * @param {number} [config.maxDimension] - Max photo dimension (default 1024)
   * @param {number} [config.jpegQuality] - JPEG quality (default 0.8)
   * @param {boolean} [config.generateThumbnail] - Generate thumbnail (default true)
   */
  constructor(config) {
    if (!config.pinataApiKey || !config.pinataApiSecret) {
      throw new Error('SteplessIPFS requires pinataApiKey and pinataApiSecret');
    }
    this.config = {
      pinataApiKey: config.pinataApiKey,
      pinataApiSecret: config.pinataApiSecret,
      gateway: config.gateway || 'https://gateway.pinata.cloud/ipfs/',
      maxDimension: config.maxDimension || MAX_DIMENSION,
      jpegQuality: config.jpegQuality || JPEG_QUALITY,
      generateThumbnail: config.generateThumbnail !== false
    };
  }

  /**
   * Full upload pipeline: compress → strip EXIF → upload photo → upload metadata → return CIDs.
   *
   * @param {File|Blob} photoFile - Raw photo from <input> or camera
   * @param {object} metadata - Photo metadata fields
   * @param {number} metadata.latitude - WGS84 latitude
   * @param {number} metadata.longitude - WGS84 longitude
   * @param {string} metadata.category - ramp|restroom|parking|entrance|elevator|other
   * @param {number} metadata.accessibilityRating - 1–5
   * @param {string|object} [metadata.description] - Description (string or multilingual map)
   * @param {string} metadata.contributorAddress - Ethereum address (0x...)
   * @param {string} [metadata.locationHash] - Pre-computed bytes32 hash
   * @param {object} [options]
   * @param {function} [options.onProgress] - Progress callback (0–100)
   * @returns {Promise<{photoCID: string, metaCID: string, thumbnailCID: string|null, gatewayUrl: string, metadata: object}>}
   */
  async uploadPhoto(photoFile, metadata, options = {}) {
    const onProgress = options.onProgress || (() => {});

    // Step 1: Compress photo and strip EXIF
    onProgress(0);
    const compressedBlob = await compressImage(
      photoFile,
      this.config.maxDimension,
      this.config.jpegQuality,
      onProgress
    );

    // Step 2: Generate thumbnail (optional)
    let thumbnailCID = null;
    if (this.config.generateThumbnail) {
      const thumbnailBlob = await compressImage(
        photoFile,
        THUMBNAIL_DIMENSION,
        THUMBNAIL_QUALITY,
        () => {}
      );
      thumbnailCID = await pinFileToIPFS(
        thumbnailBlob,
        'thumbnail.jpg',
        { type: 'thumbnail' },
        this.config,
        () => {}
      );
    }

    // Step 3: Upload compressed photo to IPFS
    const photoCID = await pinFileToIPFS(
      compressedBlob,
      'photo.jpg',
      { type: 'photo', category: metadata.category },
      this.config,
      onProgress
    );

    // Step 4: Create and upload metadata JSON
    const fullMetadata = createMetadata({
      ...metadata,
      photoCID,
      photoThumbnailCID: thumbnailCID
    });

    const metaCID = await pinJSONToIPFS(
      fullMetadata,
      { category: metadata.category, photoCID },
      this.config
    );

    onProgress(100);

    return {
      photoCID,
      metaCID,
      thumbnailCID,
      gatewayUrl: this.config.gateway + photoCID,
      thumbnailUrl: thumbnailCID ? this.config.gateway + thumbnailCID : null,
      metadata: fullMetadata
    };
  }

  /**
   * Uploads only the metadata JSON (when photo is already on IPFS).
   *
   * @param {object} metadata - Metadata object (must include photoCID)
   * @returns {Promise<string>} metaCID
   */
  async uploadMetadata(metadata) {
    if (!metadata.photoCID) {
      throw new Error('metadata.photoCID is required');
    }
    const fullMetadata = createMetadata(metadata);
    return pinJSONToIPFS(
      fullMetadata,
      { category: metadata.category, photoCID: metadata.photoCID },
      this.config
    );
  }

  /**
   * Fetches a photo from IPFS using gateway fallback.
   *
   * @param {string} cid - IPFS CID
   * @returns {Promise<string>} Object URL for use in <img src>
   */
  async fetchPhoto(cid) {
    const res = await fetchFromIPFS(cid);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Fetches metadata JSON from IPFS.
   *
   * @param {string} cid - IPFS CID of metadata JSON
   * @returns {Promise<object>} parsed metadata
   */
  async fetchMetadata(cid) {
    const res = await fetchFromIPFS(cid);
    return res.json();
  }

  /**
   * Builds the on-chain Memo contract call data for storing the photo CID.
   * Returns the parameters needed for the Memo contract's memo() function.
   *
   * @param {string} photoCID - IPFS CID of the photo
   * @param {string} metaCID - IPFS CID of the metadata
   * @param {string} locationHash - bytes32 location hash
   * @returns {{contentHash: string, data: string}} Parameters for memo(bytes32, string)
   *
   * Note: To compute the exact keccak256 contentHash matching the Solidity
   * contract, use ethers.js:
   *   ethers.keccak256(ethers.solidityPacked(
   *     ['string','string','bytes32'],
   *     [photoCID, metaCID, locationHash]
   *   ))
   */
  buildMemoParams(photoCID, metaCID, locationHash) {
    return {
      contentHash: locationHash, // Use locationHash as contentHash for location-based queries
      data: photoCID // Store photoCID as the data field for retrieval
    };
  }
}

// ============================================================================
// Exports
// ============================================================================

// ES module export (for bundlers and <script type="module">)
export { SteplessIPFS, createMetadata, compressImage, fetchFromIPFS };

// CommonJS compatibility (for Node.js require)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SteplessIPFS, createMetadata, compressImage, fetchFromIPFS };
}

// Global export (for vanilla <script> tag without module)
if (typeof window !== 'undefined') {
  window.SteplessIPFS = SteplessIPFS;
  window.SteplessCreateMetadata = createMetadata;
  window.SteplessFetchFromIPFS = fetchFromIPFS;
}