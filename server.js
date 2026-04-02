require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Razorpay = require('razorpay');
const Groq = require('groq-sdk');
const ffmpeg = require('fluent-ffmpeg');

// Define Coupon Schema
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discount: { type: Number, required: true, default: 30 }, // Percentage
  discountAmount: { type: Number, default: 0 }, // Actual discount in rupees
  userId: { type: String, default: 'anonymous' },
  username: { type: String, default: 'anonymous' },
  score: { type: Number }, // Score is optional (for admin-generated coupons)
  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  usedAt: { type: Date },
  originalPrice: { type: Number }, // Original price of the item
  finalPrice: { type: Number } // Final price after discount
});

const Coupon = mongoose.model('Coupon', couponSchema);

const app = express();
const PORT = process.env.PORT || 4000;

// ====== Razorpay configuration ======
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ====== Groq configuration ======
const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.warn(
    '[WARN] GROQ_API_KEY is not set. Chat endpoint will return an error until it is configured.'
  );
}

const groq = GROQ_API_KEY ? new Groq({ apiKey: GROQ_API_KEY }) : null;

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    userType: { 
      type: String, 
      required: true, 
      enum: ['learner', 'mentor'], 
      default: 'learner',
      validate: {
        validator: function(v) {
          return ['learner', 'mentor'].includes(v);
        },
        message: 'User type must be either learner or mentor'
      }
    },
  },
  { timestamps: true }
);

const User = mongoose.model('User', userSchema);

// Video Schema
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    topic: { type: String, required: true },
    uploader: { type: String, required: true },
    uploaderEmail: { type: String, required: true },
    isPaid: { type: Boolean, required: true, default: false },
    price: { type: Number, required: true, default: 0 },
    currency: { type: String, required: true, default: 'USD' },
    formattedAmount: { type: String, required: true, default: '$0.00' },
    videoUrl: { type: String, required: true },
    thumbnail: { type: String },
    qrCodeUrl: { type: String },
    fileName: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    fileHash: { type: String, unique: true, sparse: true },
    paymentEmail: { type: String },
    paymentUpi: { type: String },
    // Bank account details for direct transfers
    ownerAccountNumber: { type: String },
    ownerIfsc: { type: String },
    ownerAccountName: { type: String },
    ownerUpiId: { type: String },
    platformFee: { type: Number, default: 5 }, // 5% platform fee
    // Upload payment tracking
    uploadPaid: { type: Boolean, default: false },
    uploadPaidAt: { type: Date },
    uploadPaymentId: { type: String },
    uploadOrderId: { type: String }
  },
  { timestamps: true }
);

const Video = mongoose.model('Video', videoSchema);

// Video Access Schema
const videoAccessSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  videoId: { type: String, required: true },
  unlockedAt: { type: Date, default: Date.now },
  paymentId: { type: String },
  amount: { type: Number }
});

const VideoAccess = mongoose.model('VideoAccess', videoAccessSchema);

// ====== File Upload Configuration ======
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Thumbnail generation function
async function generateThumbnail(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Use the full path to FFmpeg on Windows
    const ffmpegPath = '"C:\\Users\\gutti\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe"';
    
    // Check if ffmpeg is available
    const { exec } = require('child_process');
    exec(`${ffmpegPath} -version`, (error, stdout, stderr) => {
      if (error) {
        console.log('FFmpeg not available, skipping thumbnail generation');
        resolve(null); // Return null if ffmpeg is not available
        return;
      }
      
      // FFmpeg is available, proceed with thumbnail generation
      const ffmpeg = require('fluent-ffmpeg');
      ffmpeg.setFfmpegPath(ffmpegPath.replace(/"/g, ''));
      
      ffmpeg(videoPath)
        .screenshots({
          timestamps: ['00:00:00.001'], // Capture the very first frame
          filename: path.basename(outputPath),
          folder: path.dirname(outputPath),
          size: '800x450'
        })
        .on('end', () => resolve(outputPath))
        .on('error', (err) => {
          console.error('Thumbnail generation error:', err);
          reject(err);
        });
    });
  });
}

// Multer configuration for video uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept video files and image files for QR codes
  if (file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only video and image files are allowed'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit
  }
});

// ====== MongoDB configuration ======
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/stockmaster';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB at', MONGO_URI);
    
    // Migration: Update existing users without userType
    return User.updateMany(
      { userType: { $exists: false } },
      { $set: { userType: 'learner' } }
    );
  })
  .then(() => {
    console.log('User migration completed');
    
    // Migration: Update ALL videos to have uploadPaid: true (all uploads require payment)
    return Video.updateMany(
      { },
      { $set: { uploadPaid: true } }
    );
  })
  .then((result) => {
    console.log('Video uploadPaid migration completed:', result.modifiedCount, 'videos updated');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

// ====== Middleware ======
// CORS: allow local dev ports AND opening HTML via file:// (origin "null")
const allowedOrigins = [
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:3000',
  'null', // For file:// access
  'file://' // For file:// access
];

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin (e.g. curl, Postman) – allow
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // For development, allow all origins
      if (process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // Set to false for development (HTTP)
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
  })
);

app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Serve uploaded videos

// Serve static files from mlearning/mlearning directory
app.use(express.static('mlearning/mlearning'));

// Serve myvideos page
app.get('/myvideos', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'myvideos.html'));
});

// Serve mentors page
app.get('/mentors', (req, res) => {
  res.sendFile(path.join(__dirname, 'mlearning', 'mlearning', 'mentors.html'));
});

// Serve static files from mlearning directory
app.use('/mlearning', express.static(path.join(__dirname, 'mlearning')));

// ====== Auth helpers ======
function requireAuth(req, res, next) {
  console.log('=== AUTH DEBUG ===');
  console.log('Session:', req.session);
  console.log('Session ID:', req.sessionID);
  console.log('User ID:', req.session.userId);
  console.log('Session cookie:', req.headers.cookie);
  
  if (!req.session || !req.session.userId) {
    console.log('Authentication failed: No session or userId');
    return res.status(401).json({ error: 'Not authenticated' });
  }
  console.log('Authentication successful');
  next();
}

// ====== Health check ======
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-server', model: 'llama-3.1-8b-instant' });
});

// ====== Video Upload and Retrieval Endpoints ======

// Upload video endpoint
app.post('/api/videos', requireAuth, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'paymentQrCode', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('=== UPLOAD DEBUG ===');
    console.log('Video upload request received:', {
      body: req.body,
      files: req.files,
      session: req.session,
      userId: req.session.userId
    });

    console.log('=== FILE DEBUG ===');
    console.log('req.files exists:', !!req.files);
    console.log('req.files.video:', req.files?.video);
    console.log('req.files.paymentQrCode:', req.files?.paymentQrCode);

    if (!req.files.video || !req.files.video[0]) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoFile = req.files.video[0];
    const qrCodeFile = req.files.paymentQrCode ? req.files.paymentQrCode[0] : null;

    console.log('=== VIDEO FILE DEBUG ===');
    console.log('videoFile:', videoFile);
    console.log('qrCodeFile:', qrCodeFile);

    // Check for duplicate video immediately after file upload
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(videoFile.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    console.log('File hash:', fileHash);

    const existingVideo = await Video.findOne({ fileHash });
    if (existingVideo) {
      console.log('Duplicate video detected:', existingVideo.title);
      fs.unlinkSync(videoFile.path);
      if (qrCodeFile) fs.unlinkSync(qrCodeFile.path);
      return res.status(400).json({ error: 'This video has already been uploaded' });
    }

    const { name, topic, isPaid, cost, currency, paymentEmail, paymentUpi, 
        ownerUpiId, ownerAccountName, ownerAccountNumber, ownerIfsc,
        uploadPaymentId, uploadOrderId, uploadSignature } = req.body;
    
    console.log('=== FORM DATA DEBUG ===');
    console.log('Name:', name);
    console.log('Topic:', topic);
    console.log('Is Paid:', isPaid);
    console.log('Cost:', cost);
    console.log('Currency:', currency);
    console.log('Payment Email:', paymentEmail);
    console.log('Payment UPI:', paymentUpi);
    console.log('Upload Payment ID:', uploadPaymentId);
    console.log('Upload Order ID:', uploadOrderId);
    console.log('QR Code File:', qrCodeFile ? qrCodeFile.originalname : 'No QR code');

    // Get currency symbol
    const currencySymbols = {
        'USD': '$',
        'INR': '₹',
        'EUR': '€',
        'GBP': '£',
        'JPY': '¥',
        'AUD': 'A$',
        'CAD': 'C$'
    };
    
    const currencySymbol = currencySymbols[currency] || '$';
    const formattedAmount = `${currencySymbol}${parseFloat(cost).toFixed(2)}`;
    
    console.log('Formatted amount:', formattedAmount);

    // Validate required fields
    if (!name || !topic) {
      return res.status(400).json({ error: 'Name and topic are required' });
    }

    // Verify upload payment
    if (!uploadPaymentId || !uploadOrderId || !uploadSignature) {
      return res.status(400).json({ error: 'Payment verification required' });
    }

    // Verify Razorpay payment signature
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${uploadOrderId}|${uploadPaymentId}`)
      .digest('hex');
    
    if (generatedSignature !== uploadSignature) {
      console.error('Payment signature verification failed');
      return res.status(400).json({ error: 'Payment verification failed' });
    }
    
    console.log('Upload payment verified successfully');

    // Get user info from session
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Generate thumbnail
    const thumbnailFileName = videoFile.filename.replace(path.extname(videoFile.filename), '.jpg');
    const thumbnailPath = path.join(uploadsDir, thumbnailFileName);
    let thumbnailUrl = null;
    
    try {
      const generatedThumbnail = await generateThumbnail(videoFile.path, thumbnailPath);
      if (generatedThumbnail) {
        thumbnailUrl = `/uploads/${thumbnailFileName}`;
      }
    } catch (error) {
      console.error('Thumbnail generation failed:', error);
      // Continue without thumbnail
    }
    
    // Generate QR code URL
    const qrCodeUrl = qrCodeFile ? `/uploads/${qrCodeFile.filename}` : null;

    // Create video document
    const video = new Video({
      title: name,
      topic: topic,
      uploader: user.username,
      uploaderEmail: user.email,
      isPaid: isPaid === 'true',
      price: parseFloat(cost) || 0,
      currency: currency || 'USD',
      formattedAmount: formattedAmount,
      videoUrl: `/uploads/${videoFile.filename}`,
      thumbnail: thumbnailUrl,
      qrCodeUrl: qrCodeUrl,
      fileName: videoFile.filename,
      fileSize: videoFile.size,
      mimeType: videoFile.mimetype,
      fileHash: fileHash,
      paymentEmail: paymentEmail || null,
      paymentUpi: paymentUpi || null,
      // Bank account details for direct transfers
      ownerUpiId: ownerUpiId || null,
      ownerAccountName: ownerAccountName || null,
      ownerAccountNumber: ownerAccountNumber || null,
      ownerIfsc: ownerIfsc || null,
      // Upload payment tracking
      uploadPaymentId: uploadPaymentId,
      uploadOrderId: uploadOrderId,
      uploadPaid: true,
      uploadPaidAt: new Date()
    });

    console.log('=== VIDEO OBJECT DEBUG ===');
    console.log('Video object before save:', {
      title: video.title,
      price: video.price,
      currency: video.currency,
      isPaid: video.isPaid
    });

    await video.save();

    console.log('=== VIDEO SAVED DEBUG ===');
    console.log('Video saved with currency:', video.currency);
    console.log('Video saved with price:', video.price);
    console.log('Full video object:', JSON.stringify(video, null, 2));

    // Verify the saved video
    const savedVideo = await Video.findById(video._id);
    console.log('=== VERIFICATION DEBUG ===');
    console.log('Retrieved video currency:', savedVideo.currency);
    console.log('Retrieved video price:', savedVideo.price);

    console.log('Video saved successfully:', {
      id: video._id,
      title: video.title,
      uploader: video.uploader,
      thumbnail: video.thumbnail
    });

    res.status(201).json({
      success: true,
      video: {
        id: video._id,
        title: video.title,
        topic: video.topic,
        uploader: video.uploader,
        isPaid: video.isPaid,
        price: video.price,
        videoUrl: video.videoUrl,
        thumbnail: video.thumbnail,
        createdAt: video.createdAt
      }
    });

  } catch (error) {
    console.error('Video upload error:', error);
    
    // Clean up uploaded files if database save fails
    if (req.files && req.files.video && req.files.video[0] && req.files.video[0].path) {
      fs.unlink(req.files.video[0].path, (err) => {
        if (err) console.error('Error cleaning up video file:', err);
      });
    }
    
    if (req.files && req.files.paymentQrCode && req.files.paymentQrCode[0] && req.files.paymentQrCode[0].path) {
      fs.unlink(req.files.paymentQrCode[0].path, (err) => {
        if (err) console.error('Error cleaning up QR code file:', err);
      });
    }

    res.status(500).json({ 
      error: error.message || 'Failed to upload video' 
    });
  }
});

// Create Razorpay order for video upload fee ($1)
app.post('/api/create-upload-order', requireAuth, async (req, res) => {
  try {
    console.log('=== CREATE UPLOAD ORDER REQUEST ===');
    
    const amount = 100; // ₹100 INR ($1.20)
    const currency = 'INR';
    
    // Generate short receipt (max 40 chars for Razorpay)
    const shortId = Date.now().toString(36).toUpperCase();
    const receipt = `UP_${shortId}`.substring(0, 40);
    
    const options = {
      amount: amount * 100, // Convert to paise
      currency: currency,
      receipt: receipt,
      payment_capture: 1, // Auto-capture payment
      notes: {
        type: 'upload_fee',
        userId: req.session.userId
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    console.log('Upload order created:', order);
    
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key: process.env.RAZORPAY_KEY_ID
    });
    
  } catch (error) {
    console.error('Error creating upload order:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Check for duplicate video before payment
app.post('/api/check-duplicate-video', requireAuth, upload.single('video'), async (req, res) => {
  try {
    console.log('=== CHECK DUPLICATE VIDEO REQUEST ===');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    const videoFile = req.file;
    console.log('Checking file:', videoFile.originalname, 'Size:', videoFile.size);
    
    // Calculate file hash
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(videoFile.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    console.log('File hash:', fileHash);
    
    // Check if video exists
    const existingVideo = await Video.findOne({ fileHash });
    
    // Clean up the temp file
    fs.unlinkSync(videoFile.path);
    
    if (existingVideo) {
      console.log('Duplicate found:', existingVideo.title);
      return res.status(400).json({ 
        error: 'This video has already been uploaded by another user',
        duplicate: true,
        existingTitle: existingVideo.title
      });
    }
    
    console.log('No duplicate found - video is unique');
    res.json({ 
      success: true,
      fileHash: fileHash,
      message: 'Video is unique and can be uploaded'
    });
    
  } catch (error) {
    console.error('Error checking duplicate:', error);
    // Clean up temp file if exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to check for duplicate video' });
  }
});

// Create Razorpay order
app.post('/api/create-order', async (req, res) => {
  try {
    console.log('=== CREATE ORDER REQUEST ===');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    const { amount, videoId, videoTitle } = req.body;
    
    console.log('Creating Razorpay order:', { amount, videoId, videoTitle });
    
    if (!amount || !videoId || !videoTitle) {
      console.error('Missing required fields:', { amount, videoId, videoTitle });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const options = {
      amount: Math.round(Number(amount) * 100), // Convert to paise and round to nearest integer
      currency: 'INR',
      receipt: `rcpt_${videoId.slice(0, 8)}_${Date.now().toString().slice(-6)}`,
      payment_capture: 1, // Auto-capture payment
      notes: {
        videoId: videoId,
        videoTitle: videoTitle
      }
    };
    
    const order = await razorpay.orders.create(options);
    
    console.log('Razorpay order created:', order);
    
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID
    });
    
  } catch (error) {
    console.error('Error creating Razorpay order:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Verify Razorpay payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, videoId } = req.body;
    
    console.log('Verifying Razorpay payment:', { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature, 
      videoId 
    });
    
    // Verify payment signature
    const crypto = require('crypto');
    const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
    
    const isAuthentic = generated_signature === razorpay_signature;
    
    if (isAuthentic) {
      console.log('Payment verified successfully!');
      
      // Get payment amount from order
      const order = await razorpay.orders.fetch(razorpay_order_id);
      const totalAmount = order.amount / 100; // Convert from paise to rupees
      
      // Record video access for the user
      const userId = req.session?.userId || 'anonymous';
      console.log('=== PAYMENT VERIFICATION DEBUG ===');
      console.log('Session ID:', req.sessionID);
      console.log('User ID from session:', userId);
      console.log('Video ID:', videoId);
      console.log('Payment ID:', razorpay_payment_id);
      console.log('Amount:', totalAmount);
      
      // Check if user already has access
      const existingAccess = await VideoAccess.findOne({ userId, videoId });
      console.log('Existing access found:', !!existingAccess);
      
      if (!existingAccess) {
        const newAccess = new VideoAccess({
          userId,
          videoId,
          unlockedAt: new Date(),
          paymentId: razorpay_payment_id,
          amount: totalAmount
        });
        await newAccess.save();
        console.log('✅ Video access recorded successfully for user:', userId);
      } else {
        console.log('ℹ️ User already has access to this video');
      }
      
      // Initiate automatic transfer to video owner
      const transferSuccess = await transferToVideoOwner(videoId, totalAmount);
      
      if (transferSuccess) {
        console.log('Transfer to video owner initiated successfully');
        res.json({ 
          paid: true, 
          status: 'success',
          message: 'Payment verified successfully! Video unlocked. Payment sent to video owner.',
          paymentId: razorpay_payment_id
        });
      } else {
        console.log('Transfer failed, but payment was successful');
        res.json({ 
          paid: true, 
          status: 'success',
          message: 'Payment verified! Video unlocked. (Transfer to owner will be processed manually)',
          paymentId: razorpay_payment_id
        });
      }
    } else {
      console.log('Payment verification failed - invalid signature');
      res.json({ 
        paid: false, 
        status: 'failed',
        message: 'Payment verification failed. Please contact support.'
      });
    }
    
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Direct transfer to video owner
async function transferToVideoOwner(videoId, totalAmount) {
  try {
    // Get video details
    const video = await Video.findById(videoId);
    if (!video) {
      console.error('Video not found for transfer:', videoId);
      return false;
    }

    // Calculate amounts
    const platformFeePercent = video.platformFee || 5;
    const platformFee = (totalAmount * platformFeePercent) / 100;
    const ownerAmount = totalAmount - platformFee;

    console.log(`Transfer calculation: Total ₹${totalAmount}, Platform Fee ₹${platformFee}, Owner gets ₹${ownerAmount}`);

    // Check if video owner has UPI ID (preferred - instant transfer)
    if (video.ownerUpiId) {
      console.log(`Initiating UPI transfer to ${video.ownerUpiId} for ₹${ownerAmount}`);
      
      // Create UPI transfer using Razorpay Payouts
      const payout = await razorpay.payouts.create({
        account_number: video.ownerUpiId,
        amount: ownerAmount * 100, // Convert to paise
        currency: 'INR',
        mode: 'UPI',
        purpose: 'Video sale payment',
        reference_id: `video_${videoId}_${Date.now()}`,
        notes: {
          videoId: videoId,
          videoTitle: video.title,
          originalAmount: totalAmount,
          platformFee: platformFee
        }
      });

      console.log('UPI payout created:', payout.id);
      return true;
    }
    
    // Check if video owner has bank account
    else if (video.ownerAccountNumber && video.ownerIfsc && video.ownerAccountName) {
      console.log(`Initiating bank transfer to ${video.ownerAccountName} for ₹${ownerAmount}`);
      
      // Create bank transfer using Razorpay Payouts
      const payout = await razorpay.payouts.create({
        account_number: video.ownerAccountNumber,
        fund_account: {
          account_type: 'bank_account',
          bank_account: {
            name: video.ownerAccountName,
            account_number: video.ownerAccountNumber,
            ifsc: video.ownerIfsc
          }
        },
        amount: ownerAmount * 100, // Convert to paise
        currency: 'INR',
        mode: 'IMPS', // Instant transfer
        purpose: 'Video sale payment',
        reference_id: `video_${videoId}_${Date.now()}`,
        notes: {
          videoId: videoId,
          videoTitle: video.title,
          originalAmount: totalAmount,
          platformFee: platformFee
        }
      });

      console.log('Bank payout created:', payout.id);
      return true;
    }
    
    else {
      console.error('No payment details found for video owner:', videoId);
      return false;
    }
    
  } catch (error) {
    console.error('Transfer error:', error);
    return false;
  }
}

// Test balance payment endpoint
app.post('/api/test-balance-payment', async (req, res) => {
  try {
    console.log('=== TEST BALANCE PAYMENT ===');
    const { amount, videoId, videoTitle } = req.body;
    
    console.log('Test balance payment request:', { amount, videoId, videoTitle });
    
    // Simulate payment processing using test balance
    // In reality, this would use Razorpay payouts or direct balance deduction
    
    // Simulate successful payment
    const paymentId = `test_pay_${Date.now()}`;
    
    console.log('Test balance payment successful:', { paymentId, amount, videoId });
    
    // Here you would normally:
    // 1. Deduct from test balance
    // 2. Transfer to video owner (95%)
    // 3. Keep platform fee (5%)
    
    res.json({
      success: true,
      message: 'Test balance payment successful!',
      paymentId: paymentId,
      amount: amount,
      videoId: videoId
    });
    
  } catch (error) {
    console.error('Test balance payment error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Test balance payment failed' 
    });
  }
});

// Get all videos endpoint
app.get('/api/videos', async (req, res) => {
  try {
    console.log('Fetching videos...');
    
    const videos = await Video.find()
      .sort({ createdAt: -1 }) // Most recent first
      .select('title topic uploader uploaderEmail isPaid price currency formattedAmount videoUrl thumbnail createdAt paymentEmail paymentUpi qrCodeUrl uploadPaid');

    console.log(`Found ${videos.length} videos`);
    
    // Debug: check first video's uploadPaid status
    if (videos.length > 0) {
      console.log('First video uploadPaid raw value:', videos[0].uploadPaid);
      console.log('First video uploadPaid type:', typeof videos[0].uploadPaid);
    }

    res.json(videos.map(video => ({
      id: video._id,
      title: video.title,
      topic: video.topic,
      uploader: video.uploader,
      uploaderEmail: video.uploaderEmail,
      isPaid: video.isPaid,
      uploadPaid: video.uploadPaid,
      price: video.price,
      currency: video.currency || 'USD',
      formattedAmount: video.formattedAmount || '$0.00',
      videoUrl: video.videoUrl,
      thumbnail: video.thumbnail,
      qrCodeUrl: video.qrCodeUrl,
      paymentEmail: video.paymentEmail,
      paymentUpi: video.paymentUpi,
      createdAt: video.createdAt
    })));
  } catch (err) {
    console.error('Error fetching videos:', err);
    res.status(500).json({ error: 'Failed to fetch videos' });
  }
});

// Delete video endpoint
app.delete('/api/videos/:id', requireAuth, async (req, res) => {
  try {
    const videoId = req.params.id;
    
    // Find the video
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Get current user
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if the current user is the uploader of this video
    if (video.uploaderEmail !== user.email) {
      return res.status(403).json({ error: 'You can only delete your own videos' });
    }

    // Delete video file from filesystem
    const videoFilePath = path.join(__dirname, 'uploads', video.fileName);
    if (fs.existsSync(videoFilePath)) {
      fs.unlinkSync(videoFilePath);
    }

    // Delete thumbnail file if it exists
    if (video.thumbnail) {
      const thumbnailPath = path.join(__dirname, video.thumbnail.replace(/^\//, ''));
      if (fs.existsSync(thumbnailPath)) {
        fs.unlinkSync(thumbnailPath);
      }
    }

    // Delete video from database
    await Video.findByIdAndDelete(videoId);

    console.log(`Video ${videoId} deleted by user ${user.email}`);
    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (err) {
    console.error('Error deleting video:', err);
    res.status(500).json({ error: 'Failed to delete video' });
  }
});

// ====== Auth endpoints ======
// Check current auth state
app.get('/api/check-auth', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.json({ isAuthenticated: false });
    }
    const user = await User.findById(req.session.userId).select('username email');
    if (!user) {
      return res.json({ isAuthenticated: false });
    }
    res.json({
      isAuthenticated: true,
      user: { username: user.username, email: user.email },
    });
  } catch (err) {
    console.error('check-auth error:', err);
    res.json({ isAuthenticated: false });
  }
});

// Get user's unlocked videos
app.get('/api/user/unlocked-videos', async (req, res) => {
  try {
    // Get user from session
    const userId = req.session?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not logged in' });
    }
    
    console.log('=== GETTING UNLOCKED VIDEOS ===');
    console.log('Session ID:', req.sessionID);
    console.log('User ID:', userId);
    
    // Find all video access records for this user
    const accessRecords = await VideoAccess.find({ userId }).sort({ unlockedAt: -1 });
    console.log('Found access records:', accessRecords.length);
    console.log('Access records:', accessRecords.map(r => ({ userId: r.userId, videoId: r.videoId, unlockedAt: r.unlockedAt })));
    
    if (accessRecords.length === 0) {
      console.log('No access records found for user:', userId);
      return res.json({ success: true, videos: [] });
    }
    
    // Get video details for each unlocked video
    const videoIds = accessRecords.map(record => record.videoId);
    console.log('Looking for video IDs:', videoIds);
    const videos = await Video.find({ _id: { $in: videoIds } });
    console.log('Found videos:', videos.length);
    console.log('Video IDs found:', videos.map(v => v._id.toString()));
    
    // Combine video details with access records
    const unlockedVideos = accessRecords.map(record => {
      const video = videos.find(v => v._id.toString() === record.videoId);
      return {
        ...video.toObject(),
        unlockedAt: record.unlockedAt,
        paymentId: record.paymentId,
        amount: record.amount
      };
    });
    
    console.log('Final unlocked videos count:', unlockedVideos.length);
    console.log('Unlocked videos:', unlockedVideos.map(v => ({ title: v.title, videoId: v._id, unlockedAt: v.unlockedAt })));
    
    res.json({ 
      success: true, 
      videos: unlockedVideos 
    });
    
  } catch (error) {
    console.error('Error getting unlocked videos:', error);
    res.status(500).json({ error: 'Failed to get unlocked videos' });
  }
});

// Get user profile
app.get('/api/user/profile', async (req, res) => {
  try {
    const userId = req.session?.userId;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not logged in' });
    }
    
    const user = await User.findById(userId).select('username email createdAt');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ 
      success: true, 
      user: {
        name: user.username,
        email: user.email,
        createdAt: user.createdAt
      }
    });
    
  } catch (error) {
    console.error('Error getting user profile:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Get current user profile
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).select('username email createdAt userType');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('=== DEBUG: /api/me user data ===');
    console.log('User:', user);
    console.log('User type:', user.userType);
    
    // If user doesn't have userType, set it to learner as default
    if (!user.userType) {
      console.log('User has no userType, setting to learner');
      await User.findByIdAndUpdate(req.session.userId, { userType: 'learner' });
      user.userType = 'learner';
    }
    
    res.json({
      username: user.username,
      email: user.email,
      userType: user.userType,
      createdAt: user.createdAt,
    });
  } catch (err) {
    console.error('/api/me error:', err);
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

// Signup (called from page.html)
app.post('/api/signup', async (req, res) => {
  try {
    const { email, username, password, userType } = req.body || {};

    console.log('Signup request received:', { email, username, userType }); // Debug log

    if (!email || !username || !password || !userType) {
      return res.status(400).json({ error: 'Email, username, password, and user type are required' });
    }

    if (!['learner', 'mentor'].includes(userType)) {
      return res.status(400).json({ error: 'User type must be either learner or mentor' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ error: 'Email is already registered' });
    }

    const existingUsername = await User.findOne({ username });
    if (existingUsername) {
      return res.status(400).json({ error: 'Username is already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({ email, username, passwordHash, userType });

    console.log('User created with data:', { 
      id: user._id, 
      email: user.email, 
      username: user.username, 
      userType: user.userType 
    }); // Debug log

    // Create session
    req.session.userId = user._id.toString();
    req.session.username = user.username;

    res.status(201).json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error('/api/signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Login (called from signin.html)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    req.session.userId = user._id.toString();
    req.session.username = user.username;

    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error('/api/login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout
app.post('/api/logout', (req, res) => {
  if (!req.session) return res.json({ success: true });

  req.session.destroy((err) => {
    if (err) {
      console.error('/api/logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

// ====== Groq chat endpoint ======
app.post('/api/chat', async (req, res) => {
  try {
    if (!GROQ_API_KEY || !groq) {
      return res.status(500).json({
        error: 'GROQ_API_KEY is not configured in .env file.',
      });
    }

    const { message, history } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Build Groq messages array
    const messages = [
      {
        role: 'system',
        content:
          'You are StockMaster AI, a friendly, professional assistant. ' +
          'Answer clearly and concisely, and help the user with investing, ' +
          'finance, and general questions. If you are unsure, say so.',
      },
    ];

    // Add prior conversation history (exclude current message)
    const priorTurns = Array.isArray(history) ? history.slice(0, -1) : [];
    for (const turn of priorTurns) {
      const role = turn.role === 'user' ? 'user' : 'assistant';
      const content = String(turn.text || '').trim();
      if (content) messages.push({ role, content });
    }

    // Add current user message
    messages.push({ role: 'user', content: message });

    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages,
      max_tokens: 1024,
      temperature: 0.7,
    });

    const reply = completion.choices?.[0]?.message?.content;

    if (!reply) throw new Error('Empty response from Groq');

    res.json({ reply });
  } catch (err) {
    console.error('Groq chat error:', err?.message || err);

    const clientMsg =
      err?.status === 401                 ? 'Invalid Groq API key. Check your .env file.' :
      err?.status === 429                 ? 'Rate limit reached. Please wait a moment and try again.' :
      err?.status === 402                 ? 'Groq quota exceeded. Add credits at console.groq.com/billing.' :
      err?.message?.includes('model')    ? 'Model not found. Check the model name.' :
                                           'Failed to get a response from the AI. Please try again.';

    res.status(500).json({ error: clientMsg });
  }
});

// Serve admin panel - moved before other routes
app.get('/admin-working.html', (req, res) => {
  try {
    const adminPath = path.join(__dirname, 'admin-working.html');
    console.log('Serving admin panel from:', adminPath);
    res.sendFile(adminPath);
  } catch (error) {
    console.error('Error serving admin panel:', error);
    res.status(500).send('Error loading admin panel');
  }
});

app.get('/admin', (req, res) => {
  try {
    const adminPath = path.join(__dirname, 'admin-working.html');
    console.log('Serving admin panel from:', adminPath);
    res.sendFile(adminPath);
  } catch (error) {
    console.error('Error serving admin panel:', error);
    res.status(500).send('Error loading admin panel');
  }
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// ====== Coupon Management System ======

// Generate new coupon
app.post('/api/generate-coupon', async (req, res) => {
  try {
    console.log('=== COUPON GENERATION REQUEST ===');
    console.log('Request body:', req.body);
    
    const { score, userId, username } = req.body;
    
    // Check if score is 70% or higher
    if (score < 70) {
      console.log('Score too low:', score);
      return res.status(400).json({ error: 'Score must be 70% or higher to earn a discount' });
    }
    
    console.log('Score valid, generating coupon...');
    
    // Generate unique coupon code
    const couponCode = 'STOCK30' + Math.random().toString(36).substr(2, 8).toUpperCase();
    console.log('Generated coupon code:', couponCode);
    
    // Create new coupon in database with actual user info
    const newCoupon = new Coupon({
      code: couponCode,
      discount: 30,
      userId: userId || req.user?.id || 'anonymous',
      username: username || req.user?.username || 'anonymous',
      score: score,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    });
    
    console.log('New coupon object:', newCoupon);
    
    await newCoupon.save();
    console.log('Coupon saved to database successfully');
    
    res.json({ 
      success: true, 
      coupon: couponCode,
      expiresAt: newCoupon.expiresAt
    });
  } catch (error) {
    console.error('Error generating coupon:', error);
    
    // Check if it's a duplicate key error
    if (error.code === 11000) {
      return res.status(500).json({ error: 'Coupon generation failed, please try again' });
    }
    
    res.status(500).json({ error: 'Failed to generate coupon' });
  }
});

// Validate and use coupon
app.post('/api/validate-coupon', async (req, res) => {
  try {
    console.log('=== COUPON VALIDATION REQUEST ===');
    console.log('Request body:', req.body);
    
    const { couponCode, originalPrice } = req.body;
    
    if (!couponCode) {
      console.log('No coupon code provided');
      return res.status(400).json({ error: 'Coupon code is required' });
    }
    
    console.log('Looking for coupon:', couponCode.toUpperCase());
    
    // Find coupon in database
    const coupon = await Coupon.findOne({ 
      code: couponCode.toUpperCase(),
      used: false 
    });
    
    if (!coupon) {
      console.log('Coupon not found or already used');
      return res.status(400).json({ error: 'Invalid coupon code or coupon has been used' });
    }
    
    console.log('Found coupon:', coupon);
    
    // Check if coupon is expired
    if (new Date() > new Date(coupon.expiresAt)) {
      console.log('Coupon expired:', coupon.expiresAt);
      return res.status(400).json({ error: 'Coupon has expired' });
    }
    
    console.log('Coupon valid, calculating discount...');
    
    // Calculate discount amount
    const discountPercent = coupon.discount / 100;
    const discountAmount = originalPrice ? Math.round(originalPrice * discountPercent) : 0;
    const finalPrice = originalPrice ? Math.round(originalPrice - discountAmount) : 0;
    
    console.log('Discount calculation:', { originalPrice, discountPercent, discountAmount, finalPrice });
    
    // Mark coupon as used with discount details
    coupon.used = true;
    coupon.usedAt = new Date();
    coupon.discountAmount = discountAmount;
    coupon.originalPrice = originalPrice;
    coupon.finalPrice = finalPrice;
    
    await coupon.save();
    console.log('Coupon marked as used successfully with discount amount:', discountAmount);
    
    res.json({ 
      success: true, 
      discount: coupon.discount,
      discountAmount: discountAmount,
      originalPrice: originalPrice,
      finalPrice: finalPrice,
      message: 'Coupon applied successfully'
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// Update existing admin coupons with default score
async function updateAdminCoupons() {
  try {
    const result = await Coupon.updateMany(
      { userId: 'admin-generated', score: { $exists: false } },
      { $set: { score: null } }
    );
    console.log(`Updated ${result.modifiedCount} admin coupons with null score`);
  } catch (error) {
    console.error('Error updating admin coupons:', error);
  }
}

// Call the update function
updateAdminCoupons();

// Get coupon statistics (admin only)
app.get('/api/coupons/stats', async (req, res) => {
  try {
    const totalGenerated = await Coupon.countDocuments();
    const activeCoupons = await Coupon.countDocuments({ used: false });
    const usedCoupons = await Coupon.countDocuments({ used: true });
    const totalDiscounts = await Coupon.aggregate([
      { $match: { used: true } },
      { $group: { _id: null, total: { $sum: '$discount' } } }
    ]);
    
    const stats = {
      totalGenerated,
      activeCoupons,
      usedCoupons,
      totalDiscounts: totalDiscounts.length > 0 ? totalDiscounts[0].total : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting coupon stats:', error);
    res.status(500).json({ error: 'Failed to get coupon statistics' });
  }
});


// ====== Admin Coupon Management System ======

// Admin middleware
const adminAuth = (req, res, next) => {
  // For now, we'll allow access. In production, add proper admin authentication
  next();
};

// Clean up existing coupon documents to remove usedBy and usedByUsername fields
app.post('/api/admin/coupons/cleanup-fields', adminAuth, async (req, res) => {
  try {
    console.log('=== CLEANING UP COUPON FIELDS ===');
    
    // Remove usedBy and usedByUsername fields from all existing coupon documents
    const result = await Coupon.updateMany(
      {},
      { 
        $unset: { 
          usedBy: 1,
          usedByUsername: 1 
        } 
      },
      { multi: true }
    );
    
    console.log('Cleanup result:', result);
    
    res.json({ 
      success: true, 
      message: 'Coupon fields cleaned up successfully',
      documentsUpdated: result.modifiedCount
    });
  } catch (error) {
    console.error('Error cleaning up coupon fields:', error);
    res.status(500).json({ error: 'Failed to clean up coupon fields' });
  }
});

// Get coupon statistics
app.get('/api/admin/coupons/stats', adminAuth, async (req, res) => {
  try {
    const totalGenerated = await Coupon.countDocuments();
    const activeCoupons = await Coupon.countDocuments({ used: false, expiresAt: { $gt: new Date() } });
    const usedCoupons = await Coupon.countDocuments({ used: true });
    const expiredCoupons = await Coupon.countDocuments({ used: false, expiresAt: { $lt: new Date() } });
    
    const totalDiscounts = await Coupon.aggregate([
      { $match: { used: true, discountAmount: { $exists: true, $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$discountAmount' } } }
    ]);
    
    const stats = {
      totalGenerated,
      activeCoupons,
      usedCoupons,
      expiredCoupons,
      totalDiscounts: totalDiscounts.length > 0 ? totalDiscounts[0].total : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error('Error getting coupon stats:', error);
    res.status(500).json({ error: 'Failed to get coupon statistics' });
  }
});

// Get all coupons with filtering and pagination
app.get('/api/admin/coupons', adminAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search, score } = req.query;
    const filter = {};
    
    // Status filter
    if (status === 'active') {
      filter.used = false;
      filter.expiresAt = { $gt: new Date() };
    } else if (status === 'used') {
      filter.used = true;
    } else if (status === 'expired') {
      filter.used = false;
      filter.expiresAt = { $lt: new Date() };
    }
    
    // Search filter
    if (search) {
      filter.code = new RegExp(search, 'i');
    }
    
    // Score filter
    if (score) {
      filter.score = { $gte: parseInt(score) };
    }
    
    const coupons = await Coupon.find(filter)
      .sort({ generatedAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
      
    res.json(coupons);
  } catch (error) {
    console.error('Error getting coupons:', error);
    res.status(500).json({ error: 'Failed to get coupons' });
  }
});

// Generate bulk coupons
app.post('/api/admin/coupons/generate-bulk', adminAuth, async (req, res) => {
  try {
    const { count, discount = 30, expiryDays = 7 } = req.body;
    
    if (!count || count < 1 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }
    
    const coupons = [];
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000);
    
    for (let i = 0; i < count; i++) {
      const code = 'STOCK' + discount + Math.random().toString(36).substr(2, 8).toUpperCase();
      coupons.push({
        code,
        discount,
        userId: 'admin-generated',
        username: 'admin-generated',
        score: 0,
        generatedAt: new Date(),
        expiresAt,
        used: false
      });
    }
    
    await Coupon.insertMany(coupons);
    res.json({ success: true, generated: count });
  } catch (error) {
    console.error('Error generating bulk coupons:', error);
    console.error('Error details:', error.message);
    if (error.errors) {
      console.error('Validation errors:', Object.keys(error.errors).map(key => `${key}: ${error.errors[key].message}`));
    }
    res.status(500).json({ error: 'Failed to generate bulk coupons: ' + error.message });
  }
});

// Generate single coupon
app.post('/api/admin/coupons/generate-single', adminAuth, async (req, res) => {
  try {
    const { code, discount = 30, expiryDays = 7 } = req.body;
    
    // Generate code if not provided
    const couponCode = code || 'STOCK' + discount + Math.random().toString(36).substr(2, 8).toUpperCase();
    
    // Check if code already exists
    const existingCoupon = await Coupon.findOne({ code: couponCode });
    if (existingCoupon) {
      return res.status(400).json({ error: 'Coupon code already exists' });
    }
    
    const newCoupon = new Coupon({
      code: couponCode,
      discount,
      userId: 'admin-generated',
      username: 'admin-generated',
      score: 0,
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000),
      used: false
    });
    
    await newCoupon.save();
    res.json({ success: true, coupon: newCoupon });
  } catch (error) {
    console.error('Error generating single coupon:', error);
    console.error('Error details:', error.message);
    if (error.errors) {
      console.error('Validation errors:', Object.keys(error.errors).map(key => `${key}: ${error.errors[key].message}`));
    }
    res.status(500).json({ error: 'Failed to generate single coupon: ' + error.message });
  }
});

// Delete coupon
app.delete('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  try {
    const result = await Coupon.findByIdAndDelete(req.params.id);
    
    if (!result) {
      return res.status(404).json({ error: 'Coupon not found' });
    }
    
    res.json({ success: true, message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

// Export coupons to CSV
app.get('/api/admin/coupons/export', adminAuth, async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ generatedAt: -1 });
    
    // Create CSV content
    const csvHeaders = ['Code', 'User ID', 'Score', 'Discount', 'Status', 'Generated At', 'Expires At', 'Used At', 'Used By'];
    const csvRows = coupons.map(coupon => [
      coupon.code,
      coupon.userId || '',
      coupon.score || '',
      coupon.discount + '%',
      coupon.used ? 'Used' : (new Date() > new Date(coupon.expiresAt) ? 'Expired' : 'Active'),
      coupon.generatedAt ? new Date(coupon.generatedAt).toISOString() : '',
      coupon.expiresAt ? new Date(coupon.expiresAt).toISOString() : '',
      coupon.usedAt ? new Date(coupon.usedAt).toISOString() : '',
      coupon.usedBy || ''
    ]);
    
    const csvContent = [csvHeaders, ...csvRows].map(row => row.join(',')).join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="coupons_${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Error exporting coupons:', error);
    res.status(500).json({ error: 'Failed to export coupons' });
  }
});

// Clean expired coupons
app.delete('/api/admin/coupons/clean-expired', adminAuth, async (req, res) => {
  try {
    const result = await Coupon.deleteMany({
      used: false,
      expiresAt: { $lt: new Date() }
    });
    
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    console.error('Error cleaning expired coupons:', error);
    res.status(500).json({ error: 'Failed to clean expired coupons' });
  }
});

// Clean used coupons
app.delete('/api/admin/coupons/clean-used', adminAuth, async (req, res) => {
  try {
    const result = await Coupon.deleteMany({
      used: true
    });
    
    res.json({ success: true, deleted: result.deletedCount });
  } catch (error) {
    console.error('Error cleaning used coupons:', error);
    res.status(500).json({ error: 'Failed to clean used coupons' });
  }
});

// Test balance payment endpoint (for development/testing)
app.post('/api/test-balance-payment', requireAuth, async (req, res) => {
  try {
    const { videoId, amount } = req.body;
    
    // Get user info
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Get video info
    const video = await Video.findById(videoId);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    // Create access record
    const accessRecord = new VideoAccess({
      userId: req.session.userId,
      videoId: videoId,
      paymentId: 'test_balance_' + Date.now(),
      amount: parseFloat(amount),
      currency: video.currency || 'USD',
      paymentMethod: 'test_balance',
      unlockedAt: new Date()
    });
    
    await accessRecord.save();
    
    res.json({ 
      success: true, 
      message: 'Test balance payment successful',
      accessId: accessRecord._id
    });
    
  } catch (error) {
    console.error('Test balance payment error:', error);
    res.status(500).json({ error: 'Test balance payment failed' });
  }
});

// Only start server if running locally (not on Vercel)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
  });
}

// Export for Vercel serverless
module.exports = app;