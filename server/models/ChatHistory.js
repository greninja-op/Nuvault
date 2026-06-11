/**
 * ChatHistory model — a single AI-advisor conversation turn for a user.
 *
 * One document per message (user prompt or model reply), scoped to the
 * owning user. The advisor loads recent turns to (a) restore the chat on
 * page refresh and (b) give Gemini short-term conversational memory.
 *
 * `role` uses Gemini's vocabulary: 'user' for the person, 'model' for the
 * AI, so stored turns can be mapped straight into a Gemini `contents` array.
 */
const mongoose = require('mongoose');

const CHAT_ROLES = ['user', 'model'];

const chatHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  role: {
    type: String,
    required: true,
    enum: {
      values: CHAT_ROLES,
      message: 'role must be one of: ' + CHAT_ROLES.join(', '),
    },
  },
  message: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

module.exports = mongoose.model('ChatHistory', chatHistorySchema);
module.exports.CHAT_ROLES = CHAT_ROLES;
