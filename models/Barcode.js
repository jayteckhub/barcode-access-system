const mongoose = require('mongoose');

const barcodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  used: {
    type: Boolean,
    default: false,
    index: true
  },
  issuedTo: {
    type: String,
    required: true,
    trim: true
  },
  issuedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  usedAt: {
    type: Date
  },
  purpose: {
    type: String,
    trim: true
  },
  expiresAt: {
    type: Date,
    index: true
  },
  scannerId: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Index for better query performance
barcodeSchema.index({ used: 1, expiresAt: 1 });
barcodeSchema.index({ code: 1, used: 1 });

// Static method to generate unique code
barcodeSchema.statics.generateUniqueCode = function() {
  const crypto = require('crypto');
  return crypto.randomBytes(16).toString('hex').toUpperCase();
};

// Method to mark as used
barcodeSchema.methods.markAsUsed = function(scannerId = null) {
  this.used = true;
  this.usedAt = new Date();
  if (scannerId) this.scannerId = scannerId;
  return this.save();
};

// Check if barcode is valid
barcodeSchema.methods.isValid = function() {
  if (this.used) return false;
  if (this.expiresAt && new Date() > this.expiresAt) return false;
  return true;
};

module.exports = mongoose.model('Barcode', barcodeSchema);