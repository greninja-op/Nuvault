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
    // --- Account lockout (Feature 1) ---
    // Count of consecutive failed login attempts since the last success.
    loginAttempts: {
      type: Number,
      default: 0,
    },
    // When set and in the future, the account is locked and login is refused.
    lockUntil: {
      type: Date,
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

/**
 * Lockout policy constants (Feature 1).
 *   - MAX_LOGIN_ATTEMPTS: failures before the account locks.
 *   - LOCK_TIME_MS: how long the lock lasts (30 minutes).
 */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIME_MS = 30 * 60 * 1000;

/**
 * `true` when the account is currently locked — i.e. `lockUntil` is set and
 * still in the future. Expired locks read as not-locked.
 */
userSchema.virtual('isLocked').get(function isLockedGetter() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
});

/**
 * Record one failed login attempt and apply the lockout policy.
 *
 *   - If a previous lock has already expired, restart the counter at 1 and
 *     clear the stale `lockUntil`.
 *   - Otherwise increment the counter. When it reaches MAX_LOGIN_ATTEMPTS,
 *     set `lockUntil` to now + LOCK_TIME_MS and reset the counter to 0 so the
 *     next window starts fresh after the lock expires.
 *
 * Persists the change and resolves with the saved document.
 *
 * @returns {Promise<this>}
 */
userSchema.methods.incrementLoginAttempts = async function incrementLoginAttempts() {
  // A lock that has already elapsed: treat this failure as the first of a
  // brand-new window.
  if (this.lockUntil && this.lockUntil.getTime() < Date.now()) {
    this.loginAttempts = 1;
    this.lockUntil = undefined;
    return this.save();
  }

  this.loginAttempts += 1;

  if (this.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
    this.lockUntil = new Date(Date.now() + LOCK_TIME_MS);
    this.loginAttempts = 0;
  }

  return this.save();
};

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
module.exports.MAX_LOGIN_ATTEMPTS = MAX_LOGIN_ATTEMPTS;
module.exports.LOCK_TIME_MS = LOCK_TIME_MS;
