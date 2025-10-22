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
  },
  // NEW: Time-based access control
  activeDate: {
    type: Date,
    default: null
  },
  activeTime: {
    type: String,
    default: '00:00'
  },
  endTime: {
    type: String,
    default: '23:59'
  },
  allowEarlyAccess: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Method to check if barcode is currently active
barcodeSchema.methods.isActive = function() {
  const now = new Date();
  const today = new Date().toDateString();
  
  // If no active date set, always active
  if (!this.activeDate) return true;
  
  const activeDate = new Date(this.activeDate).toDateString();
  
  // Check if today is the active date
  if (today !== activeDate) return false;
  
  // Check time window if set
  if (this.activeTime && this.endTime) {
    const currentTime = now.toTimeString().substring(0, 5); // HH:MM
    return currentTime >= this.activeTime && currentTime <= this.endTime;
  }
  
  return true;
};