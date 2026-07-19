const crypto = require('crypto');
const InkDoc = require('./model');

// ImageKit media storage. Uploads go straight from memory to ImageKit's CDN;
// deletion is propagated by diffing image references on each state save.

let client = null;
function getImageKit() {
  const { IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } = process.env;
  if (!IMAGEKIT_PUBLIC_KEY || !IMAGEKIT_PRIVATE_KEY || !IMAGEKIT_URL_ENDPOINT) return null;
  if (!client) {
    const ImageKit = require('imagekit');
    client = new ImageKit({
      publicKey: IMAGEKIT_PUBLIC_KEY,
      privateKey: IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: IMAGEKIT_URL_ENDPOINT,
    });
  }
  return client;
}

const isConfigured = () => Boolean(getImageKit());

const NOT_CONFIGURED = {
  error:
    'Image storage is not configured — add IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT to server/.env (ImageKit dashboard → Developer options → API keys) and restart the server.',
};

// Upload a multer memory file. Returns { url, fileId }.
async function storeImage(file) {
  const ik = getImageKit();
  const ext = (file.originalname.match(/\.\w{1,8}$/) || ['.png'])[0].toLowerCase();
  const result = await ik.upload({
    file: file.buffer,
    fileName: `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`,
    folder: '/inkbook',
    useUniqueFileName: false,
  });
  return { url: result.url, fileId: result.fileId };
}

/*
 * Deletion propagation. The client owns the notebook state, so the server
 * learns an image was deleted by diffing references on save. Every upload is
 * indexed (url -> fileId). An image that was referenced on the previous save
 * and is now gone (its topic/chapter/subject was deleted) is removed from
 * ImageKit immediately — ↩ Undo of such a deletion restores the block but not
 * the image file. Fresh uploads that were never saved into a note keep an
 * `unreferencedSince` stamp and are only cleaned up after GRACE_MS, so an
 * upload in flight isn't deleted before its save lands.
 */
const INDEX_ID = 'image-index';
const GRACE_MS = 60 * 60 * 1000; // 1 hour

async function registerUpload({ url, fileId }) {
  await InkDoc.updateOne(
    { _id: INDEX_ID },
    {
      $setOnInsert: { kind: 'image-index' },
      $push: { entries: { url, fileId, unreferencedSince: new Date().toISOString() } },
    },
    { upsert: true }
  );
}

function extractImageUrls(value) {
  const urls = new Set();
  const s = JSON.stringify(value) || '';
  for (const match of s.matchAll(/https?:\/\/ik\.imagekit\.io\/[^"\\\s]+/g)) urls.add(match[0]);
  return urls;
}

// Fire-and-forget after each state save.
let gcTimer = null;
async function collectGarbage(state) {
  const ik = getImageKit();
  if (!ik) return;
  try {
    const doc = await InkDoc.findById(INDEX_ID).lean();
    const entries = (doc && doc.entries) || [];
    if (!entries.length) return;

    const referenced = extractImageUrls(state);
    const cutoff = Date.now() - GRACE_MS;
    const keep = [];

    for (const entry of entries) {
      if (referenced.has(entry.url)) {
        keep.push({ ...entry, unreferencedSince: null }); // in use
      } else {
        const since = entry.unreferencedSince;
        // No stamp means the image was referenced on the last save — its
        // note was just deleted, so remove the file right away. Stamped
        // entries are unsaved uploads still inside their grace window.
        if (!since || new Date(since).getTime() <= cutoff) {
          try {
            await ik.deleteFile(entry.fileId);
          } catch (err) {
            const status = err.$ResponseMetadata?.statusCode || err.statusCode;
            if (status !== 404) {
              console.error(`ImageKit delete failed for ${entry.fileId}:`, err.message);
              keep.push({ ...entry, unreferencedSince: since || null }); // retry on a later save
            }
          }
        } else {
          keep.push({ ...entry, unreferencedSince: since });
        }
      }
    }

    await InkDoc.updateOne(
      { _id: INDEX_ID },
      { $set: { kind: 'image-index', entries: keep } },
      { upsert: true }
    );

    // Unsaved uploads still in their grace window: re-run once the earliest
    // window lapses, so they get cleaned up even if no further save arrives.
    // A newer save's GC pass supersedes this with fresher state.
    const pending = keep
      .filter((e) => e.unreferencedSince)
      .map((e) => new Date(e.unreferencedSince).getTime() + GRACE_MS);
    clearTimeout(gcTimer);
    if (pending.length) {
      const delay = Math.max(Math.min(...pending) - Date.now(), 0) + 1000;
      gcTimer = setTimeout(() => collectGarbage(state), delay);
      gcTimer.unref?.();
    }
  } catch (err) {
    console.error('Image garbage collection failed:', err.message);
  }
}

module.exports = { isConfigured, NOT_CONFIGURED, storeImage, registerUpload, collectGarbage };
