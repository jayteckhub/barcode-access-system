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
const generateBarcodeImage = (text, type = 'qrcode', baseUrl, colors = {}) => {
  return new Promise((resolve, reject) => {
    try {
      // Use mobile-scan route for QR codes
      const encodedText = type === 'qrcode' ? `${baseUrl}/mobile-scan/${text}` : text;
      
      console.log(`Generating ${type} barcode for:`, encodedText);
      
      // Default colors with fallbacks
      const defaultColors = {
        background: 'FFFFFF',
        foreground: '000000', 
        border: '000000'
      };
      
      // Merge with provided colors
      const finalColors = { ...defaultColors, ...colors };
      
      // Clean color values (remove # if present)
      const cleanColors = {
        background: finalColors.background.replace('#', ''),
        foreground: finalColors.foreground.replace('#', ''),
        border: finalColors.border.replace('#', '')
      };
      
      console.log('Final colors after cleaning:', cleanColors);
      
      const options = {
        bcid: type,
        text: encodedText,
        scale: type === 'qrcode' ? 8 : 3,
        height: 10,
        includetext: false,
        backgroundcolor: cleanColors.background,
        barcolor: cleanColors.foreground,
        bordercolor: cleanColors.border,
      };

      // For QR codes - optimize for mobile scanning
      if (type === 'qrcode') {
        options.scale = 8;
        options.height = 10;
        options.includetext = false;
      }

      console.log('BWIP-JS options:', options);

      bwipjs.toBuffer(options, (err, png) => {
        if (err) {
          console.error('BWIP-JS generation error:', err);
          reject(new Error(`Barcode rendering failed: ${err.message}`));
        } else {
          console.log('BWIP-JS generated image successfully, size:', png.length);
          resolve(png);
        }
      });
      
    } catch (setupError) {
      console.error('Barcode setup error:', setupError);
      reject(new Error(`Barcode setup failed: ${setupError.message}`));
    }
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
    const { 
      issuedTo, 
      purpose, 
      expiryHours, 
      barcodeType = 'qrcode',
      backgroundColor = 'FFFFFF',
      foregroundColor = '000000',
      borderColor = '000000',
      activeDate,
      activeTime = '09:00',
      endTime = '17:00',
      allowEarlyAccess = false
    } = req.body;
    
    console.log('Generate request received:', { issuedTo, barcodeType, activeDate });
    
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
      expiresAt,
      activeDate: activeDate ? new Date(activeDate) : null,
      activeTime: activeTime,
      endTime: endTime,
      allowEarlyAccess: !!allowEarlyAccess
    });
    
    await barcode.save();
    console.log('Barcode saved to database:', code);
    
    // Use production URL directly for QR codes
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://bar-event.vercel.app'  // REPLACE WITH YOUR ACTUAL URL
      : `${req.protocol}://${req.get('host')}`;
    
    console.log('Base URL:', baseUrl);
    
    // Color options - ensure colors object exists
    const colors = {
      background: backgroundColor ? backgroundColor.replace('#', '') : 'FFFFFF',
      foreground: foregroundColor ? foregroundColor.replace('#', '') : '000000',
      border: borderColor ? borderColor.replace('#', '') : '000000'
    };
    
    console.log('Generating barcode image with colors:', colors);
    
    // Generate barcode image with colors
    let barcodeImage;
    try {
      barcodeImage = await generateBarcodeImage(code, barcodeType, baseUrl, colors);
      console.log('Barcode image generated successfully, size:', barcodeImage.length);
    } catch (imageError) {
      console.error('Barcode image generation failed:', imageError);
      throw new Error(`Failed to generate barcode image: ${imageError.message}`);
    }
    
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
        mobileUrl: `${baseUrl}/mobile-scan/${code}`,
        colors: colors,
        activeDate: barcode.activeDate,
        activeTime: barcode.activeTime,
        endTime: barcode.endTime,
        allowEarlyAccess: barcode.allowEarlyAccess
      },
      error: null
    });
    
  } catch (error) {
    console.error('Barcode generation error details:', error);
    res.render('generate', {
      title: 'Generate Barcode',
      barcode: null,
      error: `Failed to generate barcode: ${error.message}`
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
    
    console.log('=== MANUAL VERIFICATION STARTED ===');
    console.log('Manual verification code:', code);
    
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
    
    console.log('Barcode found in manual verification:', {
      code: barcode.code,
      activeDate: barcode.activeDate,
      activeTime: barcode.activeTime,
      endTime: barcode.endTime,
      allowEarlyAccess: barcode.allowEarlyAccess,
      used: barcode.used
    });
    
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
    
    // ADD TIME-BASED ACCESS CONTROL HERE (SAME AS MOBILE-SCAN)
    if (barcode.activeDate) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Today at midnight
      const activeDate = new Date(barcode.activeDate);
      const eventDay = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate()); // Event day at midnight
      
      console.log('Manual verification - Time validation details:', {
        now: now.toISOString(),
        today: today.toISOString(),
        activeDate: activeDate.toISOString(),
        eventDay: eventDay.toISOString(),
        allowEarlyAccess: barcode.allowEarlyAccess
      });
      
      // Check if we're BEFORE the event day
      if (today < eventDay) {
        console.log('Manual verification - Before event day');
        if (!barcode.allowEarlyAccess) {
          console.log('Manual verification - Early access denied');
          return res.render('verify', {
            title: 'Verify Barcode',
            result: { 
              success: false, 
              message: `Access not available until ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            },
            scannedCode: code
          });
        } else {
          console.log('Manual verification - Early access allowed');
        }
      }
      
      // Check if we're AFTER the event day
      if (today > eventDay) {
        console.log('Manual verification - After event day');
        return res.render('verify', {
          title: 'Verify Barcode',
          result: { 
            success: false, 
            message: `Access was only available on ${activeDate.toLocaleDateString()}`,
            access: 'denied',
            issuedTo: barcode.issuedTo
          },
          scannedCode: code
        });
      }
      
      // If we're ON the event day, check time window
      if (today.getTime() === eventDay.getTime()) {
        console.log('Manual verification - On event day');
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHours}:${currentMinutes}`;
        
        console.log('Manual verification - Time window check:', {
          currentTime,
          activeTime: barcode.activeTime,
          endTime: barcode.endTime
        });
        
        // Check if before start time
        if (currentTime < barcode.activeTime) {
          console.log('Manual verification - Before start time');
          return res.render('verify', {
            title: 'Verify Barcode',
            result: { 
              success: false, 
              message: `Access available starting at ${barcode.activeTime} on ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            },
            scannedCode: code
          });
        }
        
        // Check if after end time
        if (currentTime > barcode.endTime) {
          console.log('Manual verification - After end time');
          return res.render('verify', {
            title: 'Verify Barcode',
            result: { 
              success: false, 
              message: `Access ended at ${barcode.endTime} on ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            },
            scannedCode: code
          });
        }
        
        console.log('Manual verification - Within time window');
      }
    } else {
      console.log('Manual verification - No active date set');
    }
    
    // If all checks pass, grant access
    console.log('Manual verification - Granting access to:', barcode.code);
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
    
    console.log('=== MOBILE SCAN STARTED ===');
    console.log('Scanned code:', code);
    
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
      console.log('Barcode not found in database');
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: 'Invalid access code',
          access: 'denied'
        }
      });
    }
    
    console.log('Barcode found:', {
      code: barcode.code,
      activeDate: barcode.activeDate,
      activeTime: barcode.activeTime,
      endTime: barcode.endTime,
      allowEarlyAccess: barcode.allowEarlyAccess,
      used: barcode.used
    });
    
    if (barcode.used) {
      console.log('Barcode already used');
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
      console.log('Barcode expired');
      return res.render('mobile-result', {
        result: { 
          success: false, 
          message: `Access code expired on ${barcode.expiresAt.toLocaleDateString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }
    
    // TIME-BASED ACCESS CONTROL
    if (barcode.activeDate) {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Today at midnight
      const activeDate = new Date(barcode.activeDate);
      const eventDay = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate()); // Event day at midnight
      
      console.log('Time validation details:', {
        now: now.toISOString(),
        today: today.toISOString(),
        activeDate: activeDate.toISOString(),
        eventDay: eventDay.toISOString(),
        allowEarlyAccess: barcode.allowEarlyAccess
      });
      
      // Check if we're BEFORE the event day
      if (today < eventDay) {
        console.log('Before event day - checking early access');
        if (!barcode.allowEarlyAccess) {
          console.log('Early access denied');
          return res.render('mobile-result', {
            result: { 
              success: false, 
              message: `Access not available until ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            }
          });
        } else {
          console.log('Early access allowed');
        }
      }
      
      // Check if we're AFTER the event day
      if (today > eventDay) {
        console.log('After event day - access denied');
        return res.render('mobile-result', {
          result: { 
            success: false, 
            message: `Access was only available on ${activeDate.toLocaleDateString()}`,
            access: 'denied',
            issuedTo: barcode.issuedTo
          }
        });
      }
      
      // If we're ON the event day, check time window
      if (today.getTime() === eventDay.getTime()) {
        console.log('On event day - checking time window');
        const currentHours = now.getHours().toString().padStart(2, '0');
        const currentMinutes = now.getMinutes().toString().padStart(2, '0');
        const currentTime = `${currentHours}:${currentMinutes}`;
        
        console.log('Time window check:', {
          currentTime,
          activeTime: barcode.activeTime,
          endTime: barcode.endTime
        });
        
        // Check if before start time
        if (currentTime < barcode.activeTime) {
          console.log('Before start time - access denied');
          return res.render('mobile-result', {
            result: { 
              success: false, 
              message: `Access available starting at ${barcode.activeTime} on ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            }
          });
        }
        
        // Check if after end time
        if (currentTime > barcode.endTime) {
          console.log('After end time - access denied');
          return res.render('mobile-result', {
            result: { 
              success: false, 
              message: `Access ended at ${barcode.endTime} on ${activeDate.toLocaleDateString()}`,
              access: 'denied',
              issuedTo: barcode.issuedTo
            }
          });
        }
        
        console.log('Within time window - access granted');
      }
    } else {
      console.log('No active date set - immediate access granted');
    }
    
    // If all checks pass, grant access
    console.log('Granting access to barcode:', barcode.code);
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
    const { bg = 'FFFFFF', fg = '000000', border = '000000' } = req.query;
    
    // Use production URL
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://barcodey.vercel.app/'
      : `${req.protocol}://${req.get('host')}`;
    
    const colors = {
      background: bg.replace('#', ''),
      foreground: fg.replace('#', ''),
      border: border.replace('#', '')
    };
    
    const barcodeImage = await generateBarcodeImage(code, 'qrcode', baseUrl, colors);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename=barcode-${code}.png`);
    res.send(barcodeImage);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).send('Error generating download');
  }
});


// Test time validation route
app.get('/test-time-validation', async (req, res) => {
  try {
    const testCode = 'TIMETEST123';
    
    // Create a test barcode that's only active tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    let barcode = await Barcode.findOne({ code: testCode });
    
    if (!barcode) {
      barcode = new Barcode({
        code: testCode,
        issuedTo: 'Time Test User',
        purpose: 'Testing time validation',
        activeDate: tomorrow,
        activeTime: '09:00',
        endTime: '17:00',
        allowEarlyAccess: false
      });
      await barcode.save();
    }
    
    const now = new Date();
    const today = new Date(now.toDateString());
    const eventDay = new Date(tomorrow.toDateString());
    
    res.json({
      testBarcode: {
        code: barcode.code,
        activeDate: barcode.activeDate,
        activeTime: barcode.activeTime,
        endTime: barcode.endTime,
        allowEarlyAccess: barcode.allowEarlyAccess
      },
      currentTime: {
        now: now.toISOString(),
        today: today.toISOString(),
        eventDay: eventDay.toISOString(),
        isBeforeEvent: today < eventDay,
        isAfterEvent: today > eventDay,
        isSameDay: today.getTime() === eventDay.getTime()
      },
      testUrl: `/mobile-scan/${testCode}`
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
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