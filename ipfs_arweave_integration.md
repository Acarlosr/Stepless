# Stepless — IPFS / Arweave Photo Storage Integration Guide

> Decentralized accessibility mapping on Arc Testnet (Circle's stablecoin-native L1)
> Memo Contract: `0x5294E9927c3306DcBaDb03fe70b92e01cCede505`

---

## Table of Contents

1. [Why Decentralized Storage?](#1-why-decentralized-storage)
2. [IPFS vs Arweave — Comparison for Stepless](#2-ipfs-vs-arweave--comparison-for-stepless)
3. [Recommended Architecture](#3-recommended-architecture)
4. [Photo Metadata Schema](#4-photo-metadata-schema)
5. [Upload Flow](#5-upload-flow)
6. [Arc Memo Contract Integration](#6-arc-memo-contract-integration)
7. [Photo Retrieval Flow](#7-photo-retrieval-flow)
8. [Cost Analysis](#8-cost-analysis)
9. [Privacy Considerations](#9-privacy-considerations)
10. [Code Examples](#10-code-examples)

---

## 1. Why Decentralized Storage?

Accessibility photos — ramps, restrooms, parking spots, building entrances — are the core data of Stepless. Each photo is typically 100 KB – 2 MB after compression. Storing binary image data directly on-chain is economically infeasible:

| Storage Target | Cost per 500 KB photo | Notes |
|---|---|---|
| Arc Testnet (on-chain calldata) | Gas-prohibitive for images | Memo contract stores only a 32-byte hash, not the image |
| IPFS (Pinata / Web3.Storage) | ~$0 (free tiers) to $0.15/GB/mo | Content-addressed, fast retrieval via gateways |
| Arweave (permanent) | ~$0.000004 AR/byte ≈ $0.002 for 500 KB | One-time payment, permanent storage |

**Decision:** Store the **photo on IPFS** (hot access, fast CDN-backed gateways) and optionally **mirror to Arweave** for permanent archival. Store only the **IPFS CID** (content identifier) on-chain via the Memo contract's `memo` event.

### Benefits of Decentralized Storage for Accessibility Data

- **Censorship resistance:** Accessibility data can't be silently removed by a single platform.
- **Content integrity:** IPFS CIDs are cryptographic hashes — a tampered photo produces a different CID, making manipulation detectable.
- **No single point of failure:** Photos are replicated across IPFS nodes; Arweave copies are stored across thousands of miners for 200+ years.
- **Open access:** Anyone can retrieve photos via public gateways without API keys or platform accounts.
- **Community ownership:** Contributors retain ownership of their data; no platform can lock it in.

---

## 2. IPFS vs Arweave — Comparison for Stepless

| Feature | IPFS | Arweave |
|---|---|---|
| **Storage model** | Content-addressed P2P network; nodes pin content voluntarily | Permanent, blockchain-backed storage |
| **Permanence** | Only while pinned; unpinning → garbage collection | ~200+ years (endowment model) |
| **Retrieval speed** | Fast via public gateways (Cloudflare, Pinata, dweb.link) | Slower; requires Arweave gateway |
| **Cost model** | Free (self-host) or pinning service subscription ($0–150/mo) | One-time upfront payment per byte |
| **Content addressing** | CIDv1 (multihash, multibase) | Transaction ID (SHA-256 of data) |
| **Mutability** | Immutable per CID; update = new CID | Immutable per transaction |
| **Best for** | Hot data, frequent reads, app UX | Cold archive, audit trail, permanent record |
| **Ecosystem maturity** | Large ecosystem, many SDKs, widely adopted | Smaller but growing; strong for NFT/permanent data |

### Why Both?

Stepless photos serve two purposes:

1. **Active mapping (hot):** Users browse photos in the app/website. IPFS with a pinning service provides CDN-fast retrieval and easy gateway URLs.
2. **Historical record (cold):** Accessibility infrastructure changes over time. A ramp might be removed, a building renovated. Arweave preserves the original photo as a permanent, verifiable record of what existed at a point in time.

---

## 3. Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Stepless Photo Pipeline                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Contributor (browser/mobile)                                       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │
│  │  Take Photo  │───▶│ Compress &   │───▶│  Create Metadata     │  │
│  │              │    │ Strip EXIF   │    │  JSON (locationHash, │  │
│  │              │    │ (max 1024²)  │    │  category, etc.)     │  │
│  └──────────────┘    └──────────────┘    └──────────┬───────────┘  │
│                                                      │              │
│                                                      ▼              │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Upload Layer                               │  │
│  │  1. Upload photo → IPFS (Pinata) → get photoCID              │  │
│  │  2. Upload metadata JSON → IPFS (Pinata) → get metaCID       │  │
│  │  3. (Optional) Mirror photo → Arweave (ark protocol/bundlr)  │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                             │                                       │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Arc Testnet — Memo Contract                      │  │
│  │  0x5294E9927c3306DcBaDb03fe70b92e01cCede505                  │  │
│  │                                                               │  │
│  │  emit Memo(msg.sender, keccak256(abi.encodePacked(            │  │
│  │    photoCID, metaCID, locationHash)), photoCID);              │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                             │                                       │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Goldsky Subgraph (Indexing)                      │  │
│  │  Indexes Memo events → queryable by locationHash,            │  │
│  │  contributor, category, timestamp                             │  │
│  └──────────────────────────┬───────────────────────────────────┘  │
│                             │                                       │
│                             ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              Retrieval Layer                                  │  │
│  │  Query Goldsky → get photoCID → fetch from IPFS gateway       │  │
│  │  Gateway: https://gateway.pinata.cloud/ipfs/{CID}             │  │
│  │  Fallback: https://arweave.net/{txId} (if archived)           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Pinning Service: Pinata

Pinata is the recommended IPFS pinning service for Stepless:

- **Free tier:** 1 GB storage, 100 uploads — sufficient for testnet development.
- **Pro tier ($20/mo):** 100 GB storage, dedicated gateways, faster retrieval.
- **API:** Simple REST API for pinning files and JSON metadata.
- **Gateway:** `https://gateway.pinata.cloud/ipfs/{CID}` (or custom subdomain on Pro).

### Alternative: Web3.Storage (w3up)

Web3.Storage offers free UCAN-based uploads to IPFS + Filecoin. Good for projects that want Filecoin backing without a paid pinning service. API is more complex (delegation tokens).

### Arweave via Irys (formerly Bundlr)

Irys provides a simple SDK for uploading to Arweave with flexible payment (AR, ETH, USDC, etc.). For Stepless:

- Upload photo + metadata as a bundled transaction.
- Tag with `App-Name: Stepless`, `Content-Type: image/jpeg`, `Category: ramp`, etc.
- One-time cost ≈ $0.001–0.003 per compressed photo.

---

## 4. Photo Metadata Schema

See [`photo_metadata_schema.json`](./photo_metadata_schema.json) for the full JSON Schema.

### Summary

```jsonc
{
  "locationHash": "0xabcdef...",       // bytes32 — keccak256(lat,lng,category)
  "latitude": -23.5505,                // float — WGS84
  "longitude": -46.6333,               // float — WGS84
  "category": "ramp",                  // enum: ramp|restroom|parking|entrance|elevator|other
  "accessibilityRating": 5,            // 1-5
  "description": "Ramp at north entrance", // string, multilingual
  "contributorAddress": "0x1234...",   // Ethereum address
  "timestamp": "2026-06-29T14:00:48Z", // ISO 8601
  "photoCID": "bafyrei...",            // IPFS CIDv1
  "photoThumbnailCID": "bafyrei...",   // optional — 256x256 thumbnail
  "verificationStatus": "pending",     // enum: pending|verified|rejected
  "verifierAddress": "0x5678..."       // optional — verifier's address
}
```

### Multilingual Description

The `description` field supports multilingual entries via an object map:

```json
{
  "description": {
    "en": "Wheelchair ramp at north entrance",
    "pt": "Rampa de cadeira de rodas na entrada norte",
    "es": "Rampa para silla de ruedas en la entrada norte"
  }
}
```

When a single string is provided, it is treated as the default language (`en`).

---

## 5. Upload Flow

### Step-by-Step

```
1. Capture Photo
   └─ Browser: <input type="file" accept="image/*" capture="environment">
   └─ Mobile: expo-camera or native camera

2. Compress & Strip EXIF
   └─ Browser: Canvas API — resize to max 1024×1024, JPEG quality 0.8
   └─ Mobile: expo-image-manipulator — resize, compress, no EXIF
   └─ Strip all EXIF metadata (GPS, device info, timestamps) for privacy

3. Generate Thumbnail (optional, recommended)
   └─ Resize to 256×256, JPEG quality 0.7
   └─ Upload separately for fast preview loading

4. Create Metadata JSON
   └─ Compute locationHash = keccak256(abi.encodePacked(lat, lng, category))
   └─ Assemble metadata object per schema
   └─ Sign metadata with contributor's wallet (EIP-712 optional)

5. Upload to IPFS (Pinata)
   └─ POST photo → Pinata pinFileToIPFS → photoCID
   └─ POST thumbnail → Pinata pinFileToIPFS → thumbnailCID (optional)
   └─ POST metadata JSON → Pinata pinJSONToIPFS → metaCID

6. (Optional) Mirror to Arweave
   └─ Upload photo via Irys SDK → arweaveTxId
   └─ Store arweaveTxId in metadata or on-chain

7. Store CID On-Chain (Arc Memo Contract)
   └─ Call memo() with photoCID (and/or composite hash)
   └─ Transaction hash serves as on-chain timestamp + proof

8. Confirm & Index
   └─ Goldsky subgraph indexes Memo event
   └─ Photo becomes queryable by locationHash, contributor, category
```

### Compression Details

| Parameter | Value | Rationale |
|---|---|---|
| Max dimension | 1024×1024 px | Sufficient detail for accessibility verification; keeps file < 500 KB |
| Format | JPEG | Best compression for photographic content |
| Quality | 0.8 (photo), 0.7 (thumbnail) | Good visual quality at small size |
| Thumbnail | 256×256 px, JPEG 0.7 | Fast preview in list views; ~15 KB |

### EXIF Stripping

EXIF data in JPEGs can contain:
- **GPS coordinates** — privacy risk; reveals exact contributor location
- **Device model/serial** — fingerprinting risk
- **Timestamps** — may differ from on-chain timestamp, causing confusion
- **Orientation tags** — must be preserved or applied during canvas rendering

**Browser approach:** Drawing to a `<canvas>` and exporting via `canvas.toBlob()` inherently strips EXIF. Orientation must be read first (via `exifr` library) and applied as a canvas transform.

**Mobile approach:** `expo-image-manipulator` with `compress` option strips EXIF. Orientation is handled automatically.

---

## 6. Arc Memo Contract Integration

### Contract Details

| Field | Value |
|---|---|
| Network | Arc Testnet |
| Contract Address | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` |
| ABI | Memo ABI (see below) |
| Explorer | Arc Testnet block explorer |

### Memo ABI (Relevant Functions)

```json
[
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true,  "internalType": "address", "name": "from", "type": "address" },
      { "indexed": false, "internalType": "bytes32", "name": "contentHash", "type": "bytes32" },
      { "indexed": false, "internalType": "string",  "name": "data", "type": "string" }
    ],
    "name": "Memo",
    "type": "event"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "contentHash", "type": "bytes32" },
      { "internalType": "string",  "name": "data", "type": "string" }
    ],
    "name": "memo",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

### On-Chain Storage Strategy

The Memo contract's `memo()` function accepts:
- `contentHash` (bytes32): A hash of the content being referenced. For Stepless, this is `keccak256(abi.encodePacked(photoCID, metaCID, locationHash))`.
- `data` (string): The IPFS CID of the photo (or metadata JSON). This is human-readable and queryable.

```solidity
// Example: storing a photo reference on-chain
function storePhoto(
    string memory photoCID,
    string memory metaCID,
    bytes32 locationHash
) external {
    bytes32 contentHash = keccak256(
        abi.encodePacked(photoCID, metaCID, locationHash)
    );
    // Store photoCID as the data field for easy retrieval
    memo(contentHash, photoCID);

    // Emit custom event for subgraph indexing
    emit PhotoStored(msg.sender, locationHash, photoCID, metaCID, block.timestamp);
}
```

### Goldsky Subgraph

The Goldsky subgraph indexes `Memo` events from the contract, enabling queries by:

```graphql
{
  memos(
    where: { from: "0xcontributor..." }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    id
    from
    contentHash
    data          # ← this is the photoCID
    blockTimestamp
    txHash
  }
}
```

To retrieve photos for a specific location:

```graphql
{
  memos(
    where: { contentHash: "0xlocationHash..." }
    orderBy: blockTimestamp
    orderDirection: desc
  ) {
    data          # photoCID
    from          # contributor address
    blockTimestamp
  }
}
```

---

## 7. Photo Retrieval Flow

```
1. Query Goldsky Subgraph
   └─ Filter by locationHash, contributor, category, or time range
   └─ Returns list of { photoCID, metaCID, contributor, timestamp }

2. Fetch Metadata JSON from IPFS
   └─ GET https://gateway.pinata.cloud/ipfs/{metaCID}
   └─ Parse metadata (category, rating, description, thumbnailCID)

3. Fetch Photo from IPFS
   └─ Primary: https://gateway.pinata.cloud/ipfs/{photoCID}
   └─ Fallback 1: https://dweb.link/ipfs/{photoCID}
   └─ Fallback 2: https://cloudflare-ipfs.com/ipfs/{photoCID}
   └─ Fallback 3 (if archived): https://arweave.net/{arweaveTxId}

4. Display in UI
   └─ Show thumbnail first (if available) for fast rendering
   └─ Lazy-load full photo on demand
   └─ Show metadata: category icon, rating stars, contributor, timestamp

5. Verify Integrity (optional)
   └─ Download photo → compute SHA-256 → compare with CID hash
   └─ If mismatch: flag as tampered
```

### Gateway Fallback Strategy

```javascript
const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/'
];

async function fetchFromIPFS(cid) {
  for (const gateway of GATEWAYS) {
    try {
      const res = await fetch(gateway + cid, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return res;
    } catch (e) { /* try next gateway */ }
  }
  throw new Error(`All IPFS gateways failed for CID: ${cid}`);
}
```

---

## 8. Cost Analysis

### IPFS Pinning (Pinata)

| Plan | Price | Storage | Uploads/mo | Gateway | Best For |
|---|---|---|---|---|---|
| Free | $0 | 1 GB | 100 | Shared | Testnet / MVP |
| Developer | $20/mo | 100 GB | Unlimited | Shared | Early production |
| Pro | $50/mo | 500 GB | Unlimited | Dedicated | Scale |
| Enterprise | Custom | Custom | Custom | Custom | Large scale |

**Estimate for Stepless:**
- Average compressed photo: ~300 KB
- Average metadata JSON: ~1 KB
- 10,000 photos = ~3 GB storage → fits in Developer plan ($20/mo)
- 100,000 photos = ~30 GB → still fits in Developer plan
- 1,000,000 photos = ~300 GB → Pro plan ($50/mo)

### Arweave Permanent Storage (via Irys)

| Parameter | Value |
|---|---|
| Cost per byte | ~0.000004 AR (~$0.0000024 USD at AR ~$0.60) |
| 300 KB photo | ~$0.00072 |
| 10,000 photos | ~$7.20 (one-time) |
| 100,000 photos | ~$72.00 (one-time) |
| 1,000,000 photos | ~$720.00 (one-time) |

**Key difference:** IPFS pinning is a recurring subscription; Arweave is a one-time payment for permanent storage. For Stepless, the recommended approach is:

1. **Always pin to IPFS** (hot access, app UX).
2. **Archive verified photos to Arweave** (only photos that pass verification — saves cost).
3. **Unpin from IPFS after Arweave archival** (optional, to reduce pinning costs for old photos).

### Hybrid Cost Model (10K photos, 12 months)

| Component | Cost |
|---|---|
| IPFS pinning (Pinata Developer) | $240 ($20 × 12) |
| Arweave archival (verified subset, ~50%) | ~$3.60 one-time |
| Arc Testnet gas | ~$0 (testnet) |
| Goldsky indexing | Free tier |
| **Total Year 1** | **~$244** |

---

## 9. Privacy Considerations

### EXIF Stripping (Critical)

Photos taken with mobile devices embed EXIF metadata that can include:

| EXIF Field | Risk | Mitigation |
|---|---|---|
| GPSLatitude / GPSLongitude | Reveals exact contributor location | Strip all EXIF on upload |
| DateTimeOriginal | May differ from on-chain timestamp | Strip; use on-chain timestamp as source of truth |
| Make / Model | Device fingerprinting | Strip |
| Software | Editing tool fingerprint | Strip |
| Orientation | Needed for correct display | Read before stripping; apply as canvas transform |

**Implementation:**
- **Browser:** Canvas-based compression strips EXIF by default. Use `exifr` to read orientation before drawing to canvas.
- **Mobile:** `expo-image-manipulator` strips EXIF when compressing. No additional code needed.

### Geolocation Privacy

Even after EXIF stripping, the metadata JSON contains `latitude` and `longitude`. To protect contributor privacy:

1. **Precision rounding:** Round coordinates to 4 decimal places (~11 m accuracy). Sufficient for accessibility mapping without revealing exact position.
   ```javascript
   const roundedLat = Math.round(lat * 10000) / 10000;
   const roundedLng = Math.round(lng * 10000) / 10000;
   ```

2. **Location hashing:** The `locationHash` (bytes32) groups photos by location without exposing coordinates in on-chain events. The actual coordinates are only in the IPFS metadata, not on-chain.

3. **Contributor pseudonymity:** Contributors are identified by wallet address, not name/email. No KYC required.

4. **No facial recognition:** Photos should focus on infrastructure (ramps, doors, signage), not people. App UI should include guidelines: "Photograph the accessibility feature, not individuals."

5. **Data minimization:** Only store what's needed. No device info, no IP addresses, no user agent strings in metadata.

### GDPR / LGPD Considerations

- Stepless stores infrastructure data, not personal data. Photos of ramps/restrooms are not personal data under GDPR/LGPD.
- Contributor wallet addresses are pseudonymous identifiers, not directly identifiable personal data.
- If a contributor requests deletion: unpin from IPFS (removes from pinning service). Note: Arweave data is permanent and cannot be deleted. This should be disclosed to contributors.
- The metadata schema does not include names, emails, or other directly identifiable information.

---

## 10. Code Examples

### 10.1 Browser — Upload Photo to IPFS (Vanilla JS)

```javascript
// ipfs-upload.js — see frontend/ipfs-upload.js for full implementation
import { SteplessIPFS } from './ipfs-upload.js';

const ipfs = new SteplessIPFS({
  pinataApiKey: process.env.PINATA_API_KEY,
  pinataApiSecret: process.env.PINATA_API_SECRET,
  gateway: 'https://gateway.pinata.cloud/ipfs/'
});

const result = await ipfs.uploadPhoto(file, {
  latitude: -23.5505,
  longitude: -46.6333,
  category: 'ramp',
  accessibilityRating: 5,
  description: 'Wheelchair ramp at north entrance',
  contributorAddress: '0x1234...'
}, {
  onProgress: (pct) => console.log(`Upload: ${pct}%`)
});

console.log(result.photoCID);      // bafyrei...
console.log(result.metaCID);       // bafyrei...
console.log(result.gatewayUrl);    // https://gateway.pinata.cloud/ipfs/bafyrei...
```

### 10.2 Node.js — Upload Photo to IPFS

```javascript
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const crypto = require('crypto');

async function uploadToPinata(filePath, apiKey, apiSecret) {
  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  formData.append('file', fileBuffer, { filename: 'photo.jpg' });

  // Pinata metadata
  formData.append('pinataMetadata', JSON.stringify({
    name: 'stepless-photo',
    keyvalues: { app: 'stepless', network: 'arc-testnet' }
  }));

  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinFileToIPFS',
    formData,
    {
      headers: {
        ...formData.getHeaders(),
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    }
  );

  return response.data.IpfsHash; // CID
}

async function uploadMetadataToPinata(metadata, apiKey, apiSecret) {
  const response = await axios.post(
    'https://api.pinata.cloud/pinning/pinJSONToIPFS',
    {
      pinataContent: metadata,
      pinataMetadata: {
        name: 'stepless-metadata',
        keyvalues: { app: 'stepless', category: metadata.category }
      }
    },
    {
      headers: {
        'pinata_api_key': apiKey,
        'pinata_secret_api_key': apiSecret
      }
    }
  );

  return response.data.IpfsHash;
}

// Usage
async function main() {
  const apiKey = process.env.PINATA_API_KEY;
  const apiSecret = process.env.PINATA_API_SECRET;

  const photoCID = await uploadToPinata('./photo.jpg', apiKey, apiSecret);

  const metadata = {
    locationHash: '0x...',
    latitude: -23.5505,
    longitude: -46.6333,
    category: 'ramp',
    accessibilityRating: 5,
    description: 'Wheelchair ramp at north entrance',
    contributorAddress: '0x1234...',
    timestamp: new Date().toISOString(),
    photoCID: photoCID,
    verificationStatus: 'pending'
  };

  const metaCID = await uploadMetadataToPinata(metadata, apiKey, apiSecret);
  console.log('Photo CID:', photoCID);
  console.log('Metadata CID:', metaCID);
}

main().catch(console.error);
```

### 10.3 Browser — Store CID On-Chain via Memo Contract

```javascript
import { ethers } from 'ethers';

const MEMO_CONTRACT_ADDRESS = '0x5294E9927c3306DcBaDb03fe70b92e01cCede505';
const MEMO_ABI = [
  'function memo(bytes32 contentHash, string data) external',
  'event Memo(address indexed from, bytes32 contentHash, string data)'
];

async function storePhotoOnChain(photoCID, metaCID, locationHash) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const contract = new ethers.Contract(MEMO_CONTRACT_ADDRESS, MEMO_ABI, signer);

  // Compute composite content hash
  const contentHash = ethers.keccak256(
    ethers.solidityPacked(
      ['string', 'string', 'bytes32'],
      [photoCID, metaCID, locationHash]
    )
  );

  // Call memo() — stores photoCID as the data field
  const tx = await contract.memo(contentHash, photoCID);
  console.log('Transaction sent:', tx.hash);

  const receipt = await tx.wait();
  console.log('Confirmed in block:', receipt.blockNumber);

  return { txHash: tx.hash, contentHash, blockNumber: receipt.blockNumber };
}
```

### 10.4 Node.js — Query Goldsky Subgraph for Photos

```javascript
const axios = require('axios');

const GOLDSKY_SUBGRAPH_URL = process.env.GOLDSKY_SUBGRAPH_URL;

async function getPhotosByLocation(locationHash) {
  const query = `
    query PhotosByLocation($locationHash: Bytes!) {
      memos(
        where: { contentHash: $locationHash }
        orderBy: blockTimestamp
        orderDirection: desc
        first: 100
      ) {
        id
        from
        contentHash
        data
        blockTimestamp
        txHash
      }
    }
  `;

  const response = await axios.post(GOLDSKY_SUBGRAPH_URL, {
    query,
    variables: { locationHash }
  });

  return response.data.data.memos;
}

async function getPhotosByContributor(address) {
  const query = `
    query PhotosByContributor($address: Bytes!) {
      memos(
        where: { from: $address }
        orderBy: blockTimestamp
        orderDirection: desc
        first: 100
      ) {
        id
        from
        contentHash
        data
        blockTimestamp
        txHash
      }
    }
  `;

  const response = await axios.post(GOLDSKY_SUBGRAPH_URL, {
    query,
    variables: { address }
  });

  return response.data.data.memos;
}

// Usage
const photos = await getPhotosByLocation('0xabcdef...');
for (const photo of photos) {
  console.log(`CID: ${photo.data} | Contributor: ${photo.from} | Time: ${photo.blockTimestamp}`);
  // Fetch photo: https://gateway.pinata.cloud/ipfs/{photo.data}
}
```

### 10.5 Node.js — Arweave Archival via Irys

```javascript
import Irys from '@irys/sdk';

async function archiveToArweave(photoBuffer, metadata, contributorAddress) {
  // Connect to Irys (Bundlr) on the Arweave mainnet
  // For testnet, use 'https://devnet.irys.xyz' and currency 'arweave'
  const irys = new Irys({
    url: 'https://node1.irys.xyz',
    token: 'arweave',
    key: process.env.ARWEAVE_KEY_PATH // path to key file
  });

  // Upload photo with Stepless tags
  const tags = [
    { name: 'App-Name', value: 'Stepless' },
    { name: 'Content-Type', value: 'image/jpeg' },
    { name: 'Category', value: metadata.category },
    { name: 'Contributor', value: contributorAddress },
    { name: 'Location-Hash', value: metadata.locationHash },
    { name: 'IPFS-CID', value: metadata.photoCID }
  ];

  const price = await irys.getPrice(photoBuffer.length);
  console.log(`Arweave upload cost: ${irys.utils.unitConverter(price)} AR`);

  const receipt = await irys.upload(photoBuffer, { tags });
  console.log('Arweave TX ID:', receipt.id);
  console.log('Arweave URL:', `https://arweave.net/${receipt.id}`);

  return receipt.id;
}
```

### 10.6 Browser — Fetch Photo from IPFS with Gateway Fallback

```javascript
const GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://ipfs.io/ipfs/'
];

async function fetchPhoto(cid, timeoutMs = 10000) {
  for (const gateway of GATEWAYS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(gateway + cid, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const blob = await res.blob();
        return URL.createObjectURL(blob);
      }
    } catch (e) {
      console.warn(`Gateway ${gateway} failed:`, e.message);
    }
  }
  throw new Error(`All IPFS gateways failed for CID: ${cid}`);
}

// Usage in <img> tag
const photoUrl = await fetchPhoto('bafyrei...');
document.getElementById('photo').src = photoUrl;
```

---

## Appendix A: Environment Variables

```bash
# Pinata (IPFS pinning)
PINATA_API_KEY=your_pinata_api_key
PINATA_API_SECRET=your_pinata_api_secret
PINATA_GATEWAY=https://gateway.pinata.cloud/ipfs/

# Arweave (optional, for permanent archival)
ARWEAVE_KEY_PATH=/path/to/arweave-key.json
IRYS_NODE_URL=https://node1.irys.xyz

# Arc Testnet
ARC_RPC_URL=https://rpc.arc-testnet.circle.com
MEMO_CONTRACT_ADDRESS=0x5294E9927c3306DcBaDb03fe70b92e01cCede505

# Goldsky
GOLDSKY_SUBGRAPH_URL=https://api.goldsky.com/subgraphs/stepless/...
```

## Appendix B: IPFS CID Formats

| Format | Example | Notes |
|---|---|---|
| CIDv0 | `Qm...` (46 chars) | SHA-256, base58btc. Legacy. |
| CIDv1 | `bafyrei...` | Multihash, multibase. Recommended. |

Pinata returns CIDv0 by default. To get CIDv1, add `?cid-version=1` to the pinning API call or convert with `cids` library.

## Appendix C: References

- [IPFS Documentation](https://docs.ipfs.tech/)
- [Pinata API Reference](https://docs.pinata.cloud/)
- [Web3.Storage (w3up)](https://web3.storage/)
- [Arweave Documentation](https://docs.arweave.org/)
- [Irys (Bundlr) SDK](https://docs.irys.xyz/)
- [Arc Testnet Documentation](https://docs.arc.red/)
- [Goldsky Subgraph Documentation](https://docs.goldsky.com/)