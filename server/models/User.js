'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// RFC-5322 inspired but pragmatic email regex. Final, stricter validation
// is handled at the controller layer via express-validator (R1.8); this
// model-level check is a defense-in-depth guard so the database never
// stores a value that is obviously not an email.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [1, 'Name must be at least 1 character'],
      maxlength: [100, 'Name must be at most 100 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: [254, 'Email must be at most 254 characters'],
      validate: {
        validator: (value) => typeof value === 'string' && EMAIL_REGEX.test(value),
        message: 'Email format is invalid',
      },
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
    },
    currency: {
      type: String,
      default: 'INR',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // Disable the automatic `updatedAt` companion; the design only
    // specifies `createdAt` for the User model.
    timestamps: false,
  }
);

// Hash the password with a generated salt before saving, but only when
// the password field has been modified. This avoids re-hashing an
// already-hashed value on subsequent saves of unrelated fields.
// Validates: Requirements 1.2
userSchema.pre('save', async function preSaveHashPassword(next) {
  try {
    if (!this.isModified('password')) {
      return next();
    }

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    return next();
  } catch (err) {
    return next(err);
  }
});

// Compare a plaintext password against the stored bcrypt hash.
// Returns true on match, false otherwise.
userSchema.methods.matchPassword = async function matchPassword(enteredPassword) {
  if (typeof enteredPassword !== 'string' || !this.password) {
    return false;
  }
  return bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
