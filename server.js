require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const path = require('path');
const bwipjs = require('bwip-js');
const crypto = require('crypto');
const moment = require('moment');

// Remove the old schema and import the model
const Barcode = require('./models/Barcode');




const app = express();
const PORT = process.env.PORT || 3000;

// Middleware

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));



// Generate unique code
const generateUniqueCode = () => {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
};

// Generate barcode image
// Generate barcode image with high quality and square dimensions
// Generate barcode image - UPDATED FOR BETTER SCANNING
const generateBarcodeImage = (text, type = 'qrcode', baseUrl, colors = {}) => {
  return new Promise((resolve, reject) => {
    try {
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
      
      // OPTIMIZED FOR MOBILE SCANNING - LARGER SIZE
      const options = {
        bcid: type,
        text: encodedText,
        scale: 6, // Good balance for mobile scanning
        height: 20, // Increased height
        width: 20, // Square dimensions
        paddingwidth: 40, // More padding for better detection
        paddingheight: 40,
        includetext: false,
        textxalign: 'center',
        backgroundcolor: cleanColors.background,
        barcolor: cleanColors.foreground,
        bordercolor: cleanColors.border,
      };

      // For QR codes - optimize for mobile scanning
      if (type === 'qrcode') {
        options.scale = 8; // Larger scale for better quality
        options.height = 15;
        options.width = 15;
        options.paddingwidth = 50; // Even more padding
        options.paddingheight = 50;
        options.includetext = false;
        
        // QR code specific optimizations for better scanning
        options.eclevel = 'M'; // Medium error correction
        options.version = 8; // Appropriate version for the data size
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
    
    console.log('=== GENERATE REQUEST - RAW FORM DATA ===');
    console.log('All form fields:', req.body);
    console.log('Schedule fields:', {
      activeDate: activeDate,
      activeTime: activeTime,
      endTime: endTime,
      allowEarlyAccess: allowEarlyAccess,
      allowEarlyAccessType: typeof allowEarlyAccess
    });
    
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
    
    // Prepare barcode data with explicit logging
    const barcodeData = {
      code,
      issuedTo: issuedTo.trim(),
      purpose: purpose ? purpose.trim() : null,
      expiresAt,
      activeDate: activeDate ? new Date(activeDate) : null,
      activeTime: activeTime,
      endTime: endTime,
      allowEarlyAccess: allowEarlyAccess === 'true' || allowEarlyAccess === true
    };
    
    console.log('=== BARCODE DATA BEFORE SAVE ===');
    console.log('Full barcode data:', JSON.stringify(barcodeData, null, 2));
    console.log('Active date value:', barcodeData.activeDate);
    console.log('Active date type:', typeof barcodeData.activeDate);
    console.log('Allow early access value:', barcodeData.allowEarlyAccess);
    console.log('Allow early access type:', typeof barcodeData.allowEarlyAccess);
    
    const barcode = new Barcode(barcodeData);
    
    // Save to database with detailed logging
    console.log('=== SAVING TO DATABASE ===');
    const savedBarcode = await barcode.save();
    
    console.log('=== AFTER SAVE - DATABASE RECORD ===');
    console.log('Saved barcode ID:', savedBarcode._id);
    console.log('All fields in saved document:', Object.keys(savedBarcode.toObject()));
    console.log('Schedule fields in saved document:', {
      activeDate: savedBarcode.activeDate,
      activeTime: savedBarcode.activeTime,
      endTime: savedBarcode.endTime,
      allowEarlyAccess: savedBarcode.allowEarlyAccess
    });
    
    // Use production URL
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://bar-event.vercel.app'
      : `${req.protocol}://${req.get('host')}`;
    
    // Color options
    const colors = {
      background: backgroundColor ? backgroundColor.replace('#', '') : 'FFFFFF',
      foreground: foregroundColor ? foregroundColor.replace('#', '') : '000000',
      border: borderColor ? borderColor.replace('#', '') : '000000'
    };
    
    // Generate barcode image
    const barcodeImage = await generateBarcodeImage(code, barcodeType, baseUrl, colors);
    const barcodeDataUrl = `data:image/png;base64,${barcodeImage.toString('base64')}`;
    
    res.render('generate', {
      title: 'Generate Barcode',
      barcode: {
        code: savedBarcode.code,
        issuedTo: savedBarcode.issuedTo,
        purpose: savedBarcode.purpose,
        expiresAt: savedBarcode.expiresAt,
        image: barcodeDataUrl,
        imageBase64: barcodeImage.toString('base64'),
        scanUrl: `${baseUrl}/mobile-scan/${code}`,
        mobileUrl: `${baseUrl}/mobile-scan/${code}`,
        colors: colors,
        activeDate: savedBarcode.activeDate,
        activeTime: savedBarcode.activeTime,
        endTime: savedBarcode.endTime,
        allowEarlyAccess: savedBarcode.allowEarlyAccess
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


// Add this route to reset your database
app.get('/reset-database', async (req, res) => {
  try {
    // Drop the entire barcodes collection
    await mongoose.connection.db.dropCollection('barcodes');
    console.log('✅ Barcodes collection dropped');
    
    res.json({ 
      message: 'Database reset successfully. The collection will be recreated with the correct schema.' 
    });
  } catch (error) {
    console.error('Error resetting database:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/verify', async (req, res) => {
  const { success, error, scannedCode, issuedTo } = req.query;
  
  // If there's a scanned code in query params, process it with time validation
  if (scannedCode) {
    try {
      const barcode = await Barcode.findOne({ code: scannedCode.trim().toUpperCase() });
      
      if (barcode && !barcode.used) {
        console.log('GET verify - Processing scanned code:', scannedCode);
        
        // Apply time validation logic
        if (barcode.activeDate) {
          const now = new Date();
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const activeDate = new Date(barcode.activeDate);
          const eventDay = new Date(activeDate.getFullYear(), activeDate.getMonth(), activeDate.getDate());
          
          // Check if before event day
          if (today < eventDay && !barcode.allowEarlyAccess) {
            return res.render('verify', {
              title: 'Verify Barcode',
              result: { 
                success: false, 
                message: `Access not available until ${activeDate.toLocaleDateString()}`,
                access: 'denied',
                issuedTo: barcode.issuedTo
              },
              scannedCode: scannedCode
            });
          }
          
          // Check if after event day
          if (today > eventDay) {
            return res.render('verify', {
              title: 'Verify Barcode',
              result: { 
                success: false, 
                message: `Access was only available on ${activeDate.toLocaleDateString()}`,
                access: 'denied',
                issuedTo: barcode.issuedTo
              },
              scannedCode: scannedCode
            });
          }
          
          // Check time window on event day
          if (today.getTime() === eventDay.getTime()) {
            const currentHours = now.getHours().toString().padStart(2, '0');
            const currentMinutes = now.getMinutes().toString().padStart(2, '0');
            const currentTime = `${currentHours}:${currentMinutes}`;
            
            if (currentTime < barcode.activeTime) {
              return res.render('verify', {
                title: 'Verify Barcode',
                result: { 
                  success: false, 
                  message: `Access available starting at ${barcode.activeTime} on ${activeDate.toLocaleDateString()}`,
                  access: 'denied',
                  issuedTo: barcode.issuedTo
                },
                scannedCode: scannedCode
              });
            }
            
            if (currentTime > barcode.endTime) {
              return res.render('verify', {
                title: 'Verify Barcode',
                result: { 
                  success: false, 
                  message: `Access ended at ${barcode.endTime} on ${activeDate.toLocaleDateString()}`,
                  access: 'denied',
                  issuedTo: barcode.issuedTo
                },
                scannedCode: scannedCode
              });
            }
          }
        }
        
        // If time validation passes, mark as used and show success
        console.log('GET verify - Granting access to:', barcode.code);
        barcode.used = true;
        barcode.usedAt = new Date();
        await barcode.save();
        
        return res.render('verify', {
          title: 'Verify Barcode',
          result: { 
            success: true, 
            message: 'Access Granted',
            access: 'granted',
            issuedTo: barcode.issuedTo,
            purpose: barcode.purpose,
            usedAt: new Date()
          },
          scannedCode: scannedCode
        });
      }
    } catch (error) {
      console.error('GET verify error:', error);
    }
  }
  
  // Default render for empty verify page or with query parameters
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
        result: { success: false, message: 'No barcode provided', access: 'denied' }
      });
    }

    const barcode = await Barcode.findOne({ code: code.trim().toUpperCase() });
    if (!barcode) {
      console.log('Barcode not found in database');
      return res.render('mobile-result', {
        result: { success: false, message: 'Invalid access code', access: 'denied' }
      });
    }

    // Convert and normalize stored date/time values
    const now = new Date();
    const eventDate = new Date(barcode.activeDate); // Convert string to Date
    const eventDateStr = eventDate.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    console.log('Date check:', { todayStr, eventDateStr });

    // Already used?
    if (barcode.used) {
      return res.render('mobile-result', {
        result: {
          success: false,
          message: `Access code was already used on ${new Date(barcode.usedAt).toLocaleString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }

    // Expired?
    if (barcode.expiresAt && new Date() > barcode.expiresAt) {
      return res.render('mobile-result', {
        result: {
          success: false,
          message: `Access code expired on ${barcode.expiresAt.toLocaleString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }

    // Before event day
    if (todayStr < eventDateStr) {
      if (!barcode.allowEarlyAccess) {
        console.log('Access denied — before event day');
        return res.render('mobile-result', {
          result: {
            success: false,
            message: `Access not available until ${eventDate.toLocaleDateString()}`,
            access: 'denied',
            issuedTo: barcode.issuedTo
          }
        });
      }
    }

    // After event day
    if (todayStr > eventDateStr) {
      console.log('Access denied — after event day');
      return res.render('mobile-result', {
        result: {
          success: false,
          message: `Access was only available on ${eventDate.toLocaleDateString()}`,
          access: 'denied',
          issuedTo: barcode.issuedTo
        }
      });
    }

    // On the event day, check time window
    if (todayStr === eventDateStr) {
      const currentTime = now.toTimeString().slice(0, 5); // HH:MM
      const startTime = barcode.activeTime || "00:00";
      const endTime = barcode.endTime || "23:59";

      console.log('Time window check:', { currentTime, startTime, endTime });

      if (currentTime < startTime) {
        console.log('Access denied — too early');
        return res.render('mobile-result', {
          result: {
            success: false,
            message: `Access available starting at ${startTime} on ${eventDate.toLocaleDateString()}`,
            access: 'denied',
            issuedTo: barcode.issuedTo
          }
        });
      }

      if (currentTime > endTime) {
        console.log('Access denied — too late');
        return res.render('mobile-result', {
          result: {
            success: false,
            message: `Access ended at ${endTime} on ${eventDate.toLocaleDateString()}`,
            access: 'denied',
            issuedTo: barcode.issuedTo
          }
        });
      }
    }

    // ✅ Access granted
    console.log('Access granted');
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
      result: { success: false, message: 'System error. Please try again.', access: 'denied' }
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
// Enhanced download route with high-quality square barcodes
app.get('/download/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { 
      bg = 'FFFFFF', 
      fg = '000000', 
      border = '000000',
      size = '1000' // Default to 1000px for high quality
    } = req.query;
    
    // Use production URL
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://bar-event.vercel.app'
      : `${req.protocol}://${req.get('host')}`;
    
    const colors = {
      background: bg.replace('#', ''),
      foreground: fg.replace('#', ''),
      border: border.replace('#', '')
    };
    
    // Generate high-quality barcode
    const barcodeImage = await generateBarcodeImage(code, 'qrcode', baseUrl, colors);
    
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename=barcode-${code}.png`);
    res.setHeader('Cache-Control', 'no-cache');
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