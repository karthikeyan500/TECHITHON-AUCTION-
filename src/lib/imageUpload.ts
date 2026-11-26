const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 220_000;

/**
 * Resizes and compresses an uploaded image file client-side so it fits safely
 * inside a Firestore document (well under the 1MB limit) and syncs rapidly
 * to all participant devices and projector screens.
 */
export async function compressUploadedImage(file: File): Promise<string> {
  if (!ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Please upload a JPG, PNG, WebP, or GIF image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Image file is too large (max 15 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read the selected image file.'));
      el.src = objectUrl;
    });

    const maxDimCandidates = [720, 560, 420];
    const qualityCandidates = [0.82, 0.7, 0.56];

    for (const maxDim of maxDimCandidates) {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Browser canvas is unavailable for image compression.');
      }
      ctx.fillStyle = '#08111F';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of qualityCandidates) {
        const webpUrl = canvas.toDataURL('image/webp', quality);
        if (webpUrl.startsWith('data:image/webp;base64,') && webpUrl.length <= MAX_DATA_URL_LENGTH) {
          return webpUrl;
        }
        const jpegUrl = canvas.toDataURL('image/jpeg', quality);
        if (jpegUrl.length <= MAX_DATA_URL_LENGTH) {
          return jpegUrl;
        }
      }
    }

    throw new Error('Image could not be compressed below 200 KB. Please choose a smaller photo.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
