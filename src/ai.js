const express = require('express');
const { upload } = require('./upload');

const router = express.Router();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

let client = null;
function getClient() {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!client) {
    const { GoogleGenAI } = require('@google/genai');
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const NOT_CONFIGURED = {
  error: 'AI is not configured — add GEMINI_API_KEY to server/.env (free key at aistudio.google.com) and restart the server.',
};

// Strip anything executable from model-produced SVG before it reaches clients.
function sanitizeSvg(svg) {
  return String(svg)
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*["'](?!#)[^"']*["']/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '');
}

const CONVERT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short title for the note (3-6 words)' },
    body: {
      type: 'string',
      description:
        'The transcribed prose as clean HTML paragraphs (<p>...</p>). Fix obvious spelling slips. Use <b>/<em> sparingly where the writer emphasized.',
    },
    formula: {
      type: 'string',
      description:
        'The main formula/equation in plain LaTeX-friendly text (e.g. "f = (1/2L) * sqrt(T/mu)"), or empty string if none.',
    },
    tip: { type: 'string', description: 'A short tip/mnemonic/note-to-self found in the page, or empty string.' },
    hasDiagram: { type: 'boolean' },
    diagramSvg: {
      type: 'string',
      description:
        'If the page contains a sketch/diagram, redraw it as a clean minimal inline SVG: viewBox="0 0 320 180", no width/height/script/event attributes, stroke "#3a3128" with accent "#c9962e", stroke-width 2, fill "none" unless needed, legible 11px sans-serif labels. Empty string if no diagram.',
    },
    diagramCaption: { type: 'string', description: 'One-line caption for the diagram, or empty string.' },
    transcript: {
      type: 'string',
      description: 'Faithful plain-text transcript of the original handwriting (no corrections), 1-3 sentences worth.',
    },
  },
  required: ['title', 'body', 'formula', 'tip', 'hasDiagram', 'diagramSvg', 'diagramCaption', 'transcript'],
};

router.post(
  '/convert-scan',
  upload.single('file'),
  wrap(async (req, res) => {
    const ai = getClient();
    if (!ai) return res.status(503).json(NOT_CONFIGURED);
    if (!req.file) return res.status(400).json({ error: 'No image provided (field name: file)' });

    const response = await ai.models.generateContent({
      model: MODEL(),
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: req.file.mimetype, data: req.file.buffer.toString('base64') } },
            {
              text:
                'This is a scanned page of handwritten study notes. Transcribe it into clean digital notes. ' +
                'Read carefully — handwriting may be messy. If a diagram/sketch is present, redraw it as a clean vector SVG. ' +
                'Return only the structured JSON.',
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: CONVERT_SCHEMA },
    });

    const parsed = JSON.parse(response.text);
    res.json({
      title: parsed.title || 'Scanned note',
      body: parsed.body || '',
      formula: parsed.formula || '',
      tip: parsed.tip || '',
      diagram:
        parsed.hasDiagram && parsed.diagramSvg
          ? { svg: sanitizeSvg(parsed.diagramSvg), caption: parsed.diagramCaption || '' }
          : null,
      transcript: parsed.transcript || '',
    });
  })
);

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          points: { type: 'array', items: { type: 'string' }, description: 'Exactly 2 concise study points' },
        },
        required: ['name', 'points'],
      },
    },
  },
  required: ['topics'],
};

router.post(
  '/summarize-chapter',
  wrap(async (req, res) => {
    const ai = getClient();
    if (!ai) return res.status(503).json(NOT_CONFIGURED);

    const { chapterName, topics } = req.body ?? {};
    if (!Array.isArray(topics) || !topics.length) {
      return res.status(400).json({ error: 'Body must be { chapterName, topics: [{ name, text }] }' });
    }

    const material = topics
      .slice(0, 30)
      .map((t) => `## ${String(t.name || 'Untitled').slice(0, 200)}\n${String(t.text || '').slice(0, 6000)}`)
      .join('\n\n');

    const response = await ai.models.generateContent({
      model: MODEL(),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `Summarize the chapter "${String(chapterName || '').slice(0, 200)}" from these study notes. ` +
                'For EACH topic below, produce exactly 2 concise, exam-useful bullet points (max ~20 words each), ' +
                'in the same order as given. Return only the structured JSON.\n\n' +
                material,
            },
          ],
        },
      ],
      config: { responseMimeType: 'application/json', responseSchema: SUMMARY_SCHEMA },
    });

    const parsed = JSON.parse(response.text);
    res.json({ topics: Array.isArray(parsed.topics) ? parsed.topics : [] });
  })
);

module.exports = router;
