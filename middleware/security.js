const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Stricter rate limiting for barcode generation
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 generation requests per windowMs
  message: {
    error: 'Too many barcode generation requests. Please wait before generating more.'
  }
});

// Input validation middleware
const validateBarcodeInput = (req, res, next) => {
  const { issuedTo, purpose, expiryHours } = req.body;
  
  if (!issuedTo || issuedTo.trim().length === 0) {
    return res.status(400).json({ error: 'Issued To field is required' });
  }
  
  if (issuedTo.length > 100) {
    return res.status(400).json({ error: 'Issued To field too long' });
  }
  
  if (purpose && purpose.length > 200) {
    return res.status(400).json({ error: 'Purpose field too long' });
  }
  
  next();
};

module.exports = {
  generalLimiter,
  generateLimiter,
  validateBarcodeInput,
  helmet: helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
};