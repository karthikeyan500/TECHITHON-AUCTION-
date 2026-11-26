const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

const ALLOWED_EXTENSIONS = /\.(jpe?g|png|webp)$/i;
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = 220_000;

/**
 * Validates, resizes, and compresses an uploaded image file (JPG, JPEG, PNG, WEBP)
 * client-side so it fits safely inside a Firestore document (well under the 1MB limit)
 * and syncs permanently across refresh, Host, Team, and Audience Projector screens.
 */
export async function compressUploadedImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const mime = (file.type || '').toLowerCase();
  const hasValidMime = ALLOWED_MIME_TYPES.has(mime);
  const hasValidExt = ALLOWED_EXTENSIONS.test(file.name || '');

  if (!hasValidMime && !hasValidExt) {
    throw new Error('Unsupported file format. Please upload a JPG, JPEG, PNG, or WEBP image.');
  }
  if (file.size <= 0) {
    throw new Error('Selected image file is empty.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Image file is too large (maximum 15 MB).');
  }

  onProgress?.(20);
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read the selected image file.'));
      el.src = objectUrl;
    });

    onProgress?.(55);
    const maxDimCandidates = [720, 560, 420];
    const qualityCandidates = [0.82, 0.7, 0.56];

    for (let i = 0; i < maxDimCandidates.length; i++) {
      const maxDim = maxDimCandidates[i];
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Browser canvas is unavailable for image processing.');
      }
      ctx.fillStyle = '#08111F';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      onProgress?.(Math.min(90, 65 + i * 10));

      for (const quality of qualityCandidates) {
        const webpUrl = canvas.toDataURL('image/webp', quality);
        if (webpUrl.startsWith('data:image/webp;base64,') && webpUrl.length <= MAX_DATA_URL_LENGTH) {
          onProgress?.(100);
          return webpUrl;
        }
        const jpegUrl = canvas.toDataURL('image/jpeg', quality);
        if (jpegUrl.length <= MAX_DATA_URL_LENGTH) {
          onProgress?.(100);
          return jpegUrl;
        }
      }
    }

    throw new Error('Image could not be compressed below 200 KB. Please choose a smaller photo.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
