require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bwipjs = require('bwip-js');
const crypto = require('crypto');
const moment = require('moment');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Barcode Model
const barcodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  used: { type: Boolean, default: false },
  issuedTo: { type: String, required: true },
  issuedAt: { type: Date, default: Date.now },
  usedAt: { type: Date },
  purpose: { type: String },
  expiresAt: { type: Date }
});

const Barcode = mongoose.model('Barcode', barcodeSchema);

// Generate unique code
const generateUniqueCode = () => {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
};

// Generate barcode image
const generateBarcodeImage = (text, type = 'qrcode', baseUrl) => {
  return new Promise((resolve, reject) => {
    // Use mobile-scan route for QR codes
    const encodedText = type === 'qrcode' ? `${baseUrl}/mobile-scan/${text}` : text;
    
    const options = {
      bcid: type,
      text: encodedText,
      scale: type === 'qrcode' ? 8 : 3,
      height: 10,
      includetext: false,
    };

    bwipjs.toBuffer(options, (err, png) => {
      if (err) reject(err);
      else resolve(png);
    });
  });
};

// MongoDB connection with better error handling
const connectDB = async () => {
  try {
    // Use MongoDB Atlas connection string from environment variables
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/barcode_access_system';
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    console.log('✅ MongoDB connected successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    // Don't exit process in serverless environment
  }
};

// Connect to database
connectDB();

// Routes
app.get('/', (req, res) => {
  res.render('index', { 
    title: 'Home',
    success: req.query.success,
    error: req.query.error
  });
});

app.get('/generate', (req, res) => {
  res.render('generate', { 
    title: 'Generate Barcode',
    barcode: null,
    error: null
  });
});

// Replace the baseUrl logic in your generate route:
app.post('/generate', async (req, res) => {
  try {
    const { issuedTo, purpose, expiryHours, barcodeType = 'qrcode' } = req.body;
    
    if (!issuedTo) {
      return res.render('generate', {
        title: 'Generate Barcode',
        barcode: null,
        error: 'Issued To field is required'
      });
    }

    const code = generateUniqueCode();
    let expiresAt = null;
    
    if (expiryHours && !isNaN(expiryHours)) {
      expiresAt = new Date(Date.now() + parseInt(expiryHours) * 60 * 60 * 1000);
    }
    
    const barcode = new Barcode({
      code,
      issuedTo: issuedTo.trim(),
      purpose: purpose ? purpose.trim() : null,
      expiresAt
    });
    
    await barcode.save();
    
    // FIXED: Use production URL directly for QR codes
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://barcodey.vercel.app/'  // Replace with your actual Vercel URL
      : `${req.protocol}://${req.get('host')}`;
    
    // Generate barcode image with mobile URL
    const barcodeImage = await generateBarcodeImage(code, barcodeType, baseUrl);
    const barcodeDataUrl = `data:image/png;base64,${barcodeImage.toString('base64')}`;
    
    res.render('generate', {
      title: 'Generate Barcode',
      barcode: {
        code,
        issuedTo: barcode.issuedTo,
        purpose: barcode.purpose,
        expiresAt: barcode.expiresAt,
        image: barcodeDataUrl,
        imageBase64: barcodeImage.toString('base64'),
        scanUrl: `${baseUrl}/mobile-scan/${code}`,
        mobileUrl: `${baseUrl}/mobile-scan/${code}`
      },
      error: null
    });
    
  } catch (error) {
    console.error('Barcode generation error:', error);
    res.render('generate', {
      title: 'Generate Barcode',
      barcode: null,
      error: 'Failed to generate barcode. Please try again.'
    });
  }
});

app.get('/verify', (req, res) => {
  const { success, error, scannedCode, issuedTo } = req.query;
  
  let result = null;
  if (success || error) {
    result = {
      success: !!success,
      message: success || error,
      access: success ? 'granted' : 'denied',
      issuedTo: issuedTo || null
    };
  }
  
  res.render('verify', {
    title: 'Verify Barcode',
    result,
    scannedCode: scannedCode || null
  });
});

app.post('/verify', async (req, res) => {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.render('verify', {
        title: 'Verify Barcode',
        result: { 
          success: false, 
          message: 'No barcode code provided',
          access: 'denied'
        },
        scannedCode: code
      });
    }
    
    const barcode = await Barcode.findOne({ code: code.trim().toUpperCase() });
    
    if (!barcode) {
      return res.render('verify', {
        title: 'Verify Barcode',
        result: { 
          success: false, 
          message: 'Invalid barcode',
          access: 'denied'
        },
        scannedCode: code
      });
    }
    
    if (barcode.used) {
      return res.render('verify', {
        title: 'Verify Barcode',
        result: { 
          success: false, 
          message: `Barcode already used on ${new Date(barcode.usedAt).toLocaleString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        },
        scannedCode: code
      });
    }
    
    if (barcode.expiresAt && new Date() > barcode.expiresAt) {
      return res.render('verify', {
        title: 'Verify Barcode',
        result: { 
          success: false, 
          message: `Barcode expired on ${barcode.expiresAt.toLocaleString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        },
        scannedCode: code
      });
    }
    
    // Mark as used
    barcode.used = true;
    barcode.usedAt = new Date();
    await barcode.save();
    
    res.render('verify', {
      title: 'Verify Barcode',
      result: { 
        success: true, 
        message: 'Access Granted',
        access: 'granted',
        issuedTo: barcode.issuedTo,
        purpose: barcode.purpose,
        usedAt: new Date()
      },
      scannedCode: code
    });
    
  } catch (error) {
    console.error('Barcode verification error:', error);
    res.render('verify', {
      title: 'Verify Barcode',
      result: { 
        success: false, 
        message: 'Verification error. Please try again.',
        access: 'denied'
      },
      scannedCode: req.body.code
    });
  }
});

// Mobile-only scan route (for QR codes)
app.get('/mobile-scan/:code', async (req, res) => {
  try {
    const { code } = req.params;
    
    if (!code) {
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: 'No barcode provided',
          access: 'denied'
        }
      });
    }
    
    const barcode = await Barcode.findOne({ code: code.trim().toUpperCase() });
    
    if (!barcode) {
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: 'Invalid access code',
          access: 'denied'
        }
      });
    }
    
    if (barcode.used) {
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: `Access code was already used on ${new Date(barcode.usedAt).toLocaleDateString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }
    
    if (barcode.expiresAt && new Date() > barcode.expiresAt) {
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: `Access code expired on ${barcode.expiresAt.toLocaleDateString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }
    
    // Mark as used
    barcode.used = true;
    barcode.usedAt = new Date();
    await barcode.save();
    
    res.render('mobile-result', {
      result: { 
        success: true, 
        message: 'Access authorized successfully',
        access: 'granted',
        issuedTo: barcode.issuedTo,
        purpose: barcode.purpose
      }
    });
    
  } catch (error) {
    console.error('Mobile scan error:', error);
    res.render('mobile-result', {
      result: { 
        success: false, 
        message: 'System error. Please try again.',
        access: 'denied'
      }
    });
  }
});

app.get('/admin', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const barcodes = await Barcode.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const total = await Barcode.countDocuments();
    const totalPages = Math.ceil(total / limit);
    
    res.render('admin', {
      title: 'Admin Dashboard',
      barcodes,
      currentPage: page,
      totalPages,
      totalBarcodes: total,
      moment: moment,
      error: null
    });
    
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.render('admin', {
      title: 'Admin Dashboard',
      barcodes: [],
      currentPage: 1,
      totalPages: 1,
      totalBarcodes: 0,
      moment: moment,
      error: 'Failed to load barcodes'
    });
  }
});

// Download route
app.get('/download/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : `${req.protocol}://${req.get('host')}`;
    
    const barcodeImage = await generateBarcodeImage(code, 'qrcode', baseUrl);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename=barcode-${code}.png`);
    res.send(barcodeImage);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Error generating download');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).render('error', {
    title: 'Error',
    message: 'Something went wrong!',
    error: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page Not Found',
    message: 'The page you are looking for does not exist.'
  });
});

// Vercel requires module.exports for serverless functions
module.exports = app;

// Only listen if not in Vercel environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Barcode Access System running on port ${PORT}`);
    console.log(`📍 Access the application at: http://localhost:${PORT}`);
  });
}