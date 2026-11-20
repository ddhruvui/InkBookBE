const mongoose = require('mongoose');

// One collection ("InkBook") holds these kinds of documents:
//   { kind: 'subject', _id: <uuid>, name, color, position, chapters: [...], topics: [...] }
//     (topics live in a chapter's `topics` or directly in the subject's `topics`)
//   { kind: 'important-marks', _id: 'important-marks', marks: [...] }
// The nested chapter/topic/block shape is owned by the client (see SPEC.md),
// so the schema stays non-strict and only pins what the server relies on.
const InkDocSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['subject', 'important-marks', 'image-index', 'state-meta'], index: true },
    position: { type: Number },
  },
  { strict: false, timestamps: true }
);

module.exports = mongoose.model('InkDoc', InkDocSchema, 'InkBook');
