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
 * indexed (url -> fileId); on each save, an indexed image that is no longer
 * referenced anywhere gets an `unreferencedSince` stamp, and once it stays
 * unreferenced past GRACE_MS it is deleted from ImageKit. The grace window
 * keeps ↩ Undo (which can restore a deleted block) from pointing at a dead
 * image, and also cleans up scans/uploads that were never saved into a note.
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
async function collectGarbage(state) {
  const ik = getImageKit();
  if (!ik) return;
  try {
    const doc = await InkDoc.findById(INDEX_ID).lean();
    const entries = (doc && doc.entries) || [];
    if (!entries.length) return;

    const referenced = extractImageUrls(state);
    const nowIso = new Date().toISOString();
    const cutoff = Date.now() - GRACE_MS;
    const keep = [];

    for (const entry of entries) {
      if (referenced.has(entry.url)) {
        keep.push({ ...entry, unreferencedSince: null }); // in use
      } else {
        const since = entry.unreferencedSince || nowIso;
        if (new Date(since).getTime() <= cutoff) {
          try {
            await ik.deleteFile(entry.fileId);
          } catch (err) {
            const status = err.$ResponseMetadata?.statusCode || err.statusCode;
            if (status !== 404) {
              console.error(`ImageKit delete failed for ${entry.fileId}:`, err.message);
              keep.push({ ...entry, unreferencedSince: since }); // retry on a later save
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
  } catch (err) {
    console.error('Image garbage collection failed:', err.message);
  }
}

module.exports = { isConfigured, NOT_CONFIGURED, storeImage, registerUpload, collectGarbage };
