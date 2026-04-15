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
const axios = require('axios');
const FormData = require('form-data');
const nodemailer = require('nodemailer');

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

const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);

const app = express();
const PORT = process.env.PORT || 4000;

// ====== Email configuration ======
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Function to send payment receipt email
async function sendPaymentReceiptEmail(to, paymentDetails) {
  try {
    const { videoTopic, amount, orderId, paymentId, date, mentorName } = paymentDetails;
    
    console.log('📧 Preparing to send email...');
    console.log('To:', to);
    console.log('From:', process.env.EMAIL_USER);
    console.log('SMTP Service: gmail');
    
    const mailOptions = {
      from: `"StockMaster" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'Payment Receipt - Video Upload Successful',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #16a34a; margin: 0;">Payment Successful!</h2>
            <p style="color: #6b7280; margin: 5px 0;">Your video upload fee has been received</p>
          </div>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin-top: 0; color: #374151;">Receipt Details</h3>
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Video Topic:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${videoTopic}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Mentor:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${mentorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Amount Paid:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #16a34a;">₹${amount}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Order ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${orderId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Payment ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${paymentId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Date:</td>
                <td style="padding: 8px 0; text-align: right;">${date}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">Thank you for using StockMaster!</p>
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">For any queries, please contact support.</p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Payment receipt sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending payment receipt email:', error);
    return false;
  }
}

// Function to send sale receipt email to video owner
async function sendSaleReceiptEmail(to, receiptDetails) {
  try {
    const { videoTopic, amount, ownerEarnings, orderId, paymentId, date, mentorName, buyerName } = receiptDetails;
    
    console.log('📧 Preparing to send sale receipt email...');
    console.log('To:', to);
    
    const mailOptions = {
      from: `"StockMaster" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'New Video Sale - Payment Received',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #16a34a; margin: 0;">New Sale! 🎉</h2>
            <p style="color: #6b7280; margin: 5px 0;">Someone purchased your video</p>
          </div>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin-top: 0; color: #374151;">Sale Details</h3>
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Video Topic:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${videoTopic}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Buyer:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${buyerName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Total Sale Amount:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">₹${amount}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Platform Fee (16%):</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #dc2626;">-₹${(amount - ownerEarnings).toFixed(2)}</td>
              </tr>
              <tr style="background: #f0fdf4;">
                <td style="padding: 12px 0; color: #166534; font-weight: 600;">You Receive (84%):</td>
                <td style="padding: 12px 0; text-align: right; font-weight: 700; color: #16a34a;">₹${ownerEarnings}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Order ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${orderId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Payment ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${paymentId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Date:</td>
                <td style="padding: 8px 0; text-align: right;">${date}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">Keep up the great work! 🚀</p>
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">For any queries, please contact support.</p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Sale receipt sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending sale receipt email:', error);
    return false;
  }
}

// Function to send purchase receipt email to buyer
async function sendBuyerReceiptEmail(to, receiptDetails) {
  try {
    const { videoTopic, amount, orderId, paymentId, date, mentorName, buyerName } = receiptDetails;
    
    console.log('📧 Preparing to send buyer receipt email...');
    console.log('To:', to);
    
    const mailOptions = {
      from: `"StockMaster" <${process.env.EMAIL_USER}>`,
      to: to,
      subject: 'Purchase Receipt - Video Access Confirmed',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #16a34a; margin: 0;">Purchase Successful!</h2>
            <p style="color: #6b7280; margin: 5px 0;">You now have access to the video</p>
          </div>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin-top: 0; color: #374151;">Purchase Details</h3>
            <table style="width: 100%; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Video Topic:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${videoTopic}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Mentor:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${mentorName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Buyer:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${buyerName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Amount Paid:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #16a34a;">₹${amount}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Order ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${orderId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Payment ID:</td>
                <td style="padding: 8px 0; text-align: right; font-family: monospace; font-size: 12px;">${paymentId}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Date:</td>
                <td style="padding: 8px 0; text-align: right;">${date}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">Thank you for your purchase!</p>
            <p style="color: #9ca3af; font-size: 12px; margin: 5px 0 0 0;">You can now watch the video in your account.</p>
          </div>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`Buyer receipt sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending buyer receipt email:', error);
    return false;
  }
}

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

// ====== Alpha Vantage API Configuration ======
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;

if (!ALPHA_VANTAGE_API_KEY) {
  console.warn(
    '[WARN] ALPHA_VANTAGE_API_KEY is not set. Paper trading stock quotes will not work.'
  );
}

// Cache for stock prices to avoid API limits (5 calls per minute on free tier)
const stockPriceCache = new Map();
const CACHE_DURATION = 60000; // 60 seconds

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
    // Forgot password rate limiting
    forgotPasswordAttempts: { type: Number, default: 0 },
    forgotPasswordLastAttempt: { type: Date }
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

// Video Schema - Updated with AI Validation fields
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
    platformFee: { type: Number, default: 16 }, // 16% platform fee
    // Upload payment tracking
    uploadPaid: { type: Boolean, default: false },
    uploadPaidAt: { type: Date },
    uploadPaymentId: { type: String },
    uploadOrderId: { type: String },
    // AI Validation fields
    aiSummary: { type: String },
    relevanceScore: { type: Number },
    topicMatchScore: { type: Number },
    isApproved: { type: Boolean, default: false },
    rejectionReason: { type: String },
    transcript: { type: String },
    validationStatus: { 
      type: String, 
      enum: ['pending', 'processing', 'approved', 'rejected'], 
      default: 'pending' 
    },
    processingStage: { type: String }, // Current stage: upload, audio_extraction, transcription, ai_validation
    validationCompletedAt: { type: Date },
    // Rating summary fields
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const Video = mongoose.models.Video || mongoose.model('Video', videoSchema);

// Video Access Schema
const videoAccessSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  videoId: { type: String, required: true },
  unlockedAt: { type: Date, default: Date.now },
  paymentId: { type: String },
  amount: { type: Number },
  // Rating and watch tracking
  watched: { type: Boolean, default: false },
  watchedAt: { type: Date },
  rated: { type: Boolean, default: false },
  rating: { type: Number, min: 1, max: 5 }
});

const VideoAccess = mongoose.models.VideoAccess || mongoose.model('VideoAccess', videoAccessSchema);

// Rating Schema - Stores individual user ratings
const ratingSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  videoId: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

// Ensure one rating per user per video
ratingSchema.index({ userId: 1, videoId: 1 }, { unique: true });

const Rating = mongoose.models.Rating || mongoose.model('Rating', ratingSchema);

// ====== Paper Trading Schemas ======
const paperTradingBalanceSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  balance: { type: Number, default: 100000 }, // Starting with ₹100,000
  currency: { type: String, default: 'INR' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const PaperTradingBalance = mongoose.models.PaperTradingBalance || mongoose.model('PaperTradingBalance', paperTradingBalanceSchema);

const paperTradingHoldingSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  symbol: { type: String, required: true },
  companyName: { type: String, required: true },
  quantity: { type: Number, required: true },
  avgBuyPrice: { type: Number, required: true },
  totalInvestment: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound index for unique holdings per user per stock
paperTradingHoldingSchema.index({ userId: 1, symbol: 1 }, { unique: true });

const PaperTradingHolding = mongoose.models.PaperTradingHolding || mongoose.model('PaperTradingHolding', paperTradingHoldingSchema);

const paperTradingTransactionSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  symbol: { type: String, required: true },
  companyName: { type: String, required: true },
  type: { type: String, enum: ['BUY', 'SELL'], required: true },
  quantity: { type: Number, required: true },
  price: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const PaperTradingTransaction = mongoose.models.PaperTradingTransaction || mongoose.model('PaperTradingTransaction', paperTradingTransactionSchema);

// ====== File Upload Configuration ======
// Ensure uploads directory exists (skip in serverless)
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir) && process.env.VERCEL !== '1') {
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

// ====== AI Video Validation Functions ======

// Audio extraction function using FFmpeg
async function extractAudioFromVideo(videoPath, outputAudioPath) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = '"C:\\Users\\gutti\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.0.1-full_build\\bin\\ffmpeg.exe"';
    const { exec } = require('child_process');
    
    exec(`${ffmpegPath} -version`, (error) => {
      if (error) {
        console.error('FFmpeg not available for audio extraction');
        return reject(new Error('FFmpeg not available'));
      }
      
      const ffmpeg = require('fluent-ffmpeg');
      ffmpeg.setFfmpegPath(ffmpegPath.replace(/"/g, ''));
      
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .toFormat('mp3')
        .on('end', () => {
          console.log('Audio extraction completed:', outputAudioPath);
          resolve(outputAudioPath);
        })
        .on('error', (err) => {
          console.error('Audio extraction error:', err);
          reject(err);
        })
        .save(outputAudioPath);
    });
  });
}

// Speech-to-Text using Groq (Groq supports Whisper)
async function transcribeAudio(audioPath) {
  try {
    if (!GROQ_API_KEY || !groq) {
      throw new Error('Groq API key not configured');
    }

    console.log('Starting audio transcription...');
    
    // Check if file exists and has content
    if (!fs.existsSync(audioPath)) {
      throw new Error('Audio file not found');
    }
    
    const stats = fs.statSync(audioPath);
    if (stats.size === 0) {
      throw new Error('Audio file is empty (no audio detected in video)');
    }

    // Read audio file
    const audioBuffer = fs.readFileSync(audioPath);
    
    // Create a FormData-like object for the API call
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: 'audio.mp3',
      contentType: 'audio/mpeg'
    });
    form.append('model', 'whisper-large-v3');
    
    // Make API call to Groq
    const axios = require('axios');
    const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000 // 2 minute timeout for large files
    });

    const transcript = response.data.text;
    
    if (!transcript || transcript.trim().length === 0) {
      throw new Error('Transcription result is empty');
    }

    console.log('Transcription completed. Length:', transcript.length);
    return transcript;
    
  } catch (error) {
    console.error('Transcription error:', error);
    if (error.response?.status === 401) {
      throw new Error('Invalid Groq API key');
    }
    if (error.code === 'ECONNABORTED') {
      throw new Error('Transcription timed out - audio file may be too large');
    }
    throw new Error(`Transcription failed: ${error.message}`);
  }
}

// AI Summarization using Groq
async function summarizeTranscript(transcript, topic) {
  try {
    if (!GROQ_API_KEY || !groq) {
      throw new Error('Groq API not configured');
    }

    console.log('Generating summary...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: 'You are a helpful AI assistant. Summarize the following video transcript in 2-3 sentences. Keep it concise and informative.'
        },
        {
          role: 'user',
          content: `Topic: ${topic}\n\nTranscript:\n${transcript.substring(0, 3000)}\n\nPlease provide a brief summary of this content in 2-3 sentences. Focus on the key points discussed.`
        }
      ],
      max_tokens: 300,
      temperature: 0.7
    });

    const summary = completion.choices?.[0]?.message?.content;
    
    if (!summary) {
      throw new Error('Empty summary response from AI');
    }

    console.log('Summary generated:', summary.substring(0, 100) + '...');
    return summary.trim();
    
  } catch (error) {
    console.error('Summarization error:', error);
    throw new Error(`Failed to generate summary: ${error.message}`);
  }
}

// Stock Market Relevance Check
async function checkStockMarketRelevance(summary, transcript) {
  try {
    if (!GROQ_API_KEY || !groq) {
      throw new Error('Groq API not configured');
    }

    console.log('Checking stock market relevance...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are a stock market content validator. Analyze if the content is related to stock market, investing, trading, mutual funds, ETFs, bonds, cryptocurrency, or personal finance.
Return a JSON object with:
- "relevant": boolean (true if related to stocks/finance)
- "score": number 0-100 (higher = more relevant to stock market)
Only return the JSON object, nothing else.`
        },
        {
          role: 'user',
          content: `Summary: ${summary}\n\nTranscript excerpt: ${transcript.substring(0, 1500)}\n\nIs this content related to stock market, investing, or finance? Return JSON only.`
        }
      ],
      max_tokens: 100,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices?.[0]?.message?.content;
    
    if (!response) {
      return { relevant: false, score: 0 };
    }

    try {
      const result = JSON.parse(response);
      return {
        relevant: result.relevant === true,
        score: Math.min(100, Math.max(0, parseInt(result.score) || 0))
      };
    } catch (parseError) {
      console.error('Failed to parse relevance response:', response);
      return { relevant: false, score: 0 };
    }
    
  } catch (error) {
    console.error('Relevance check error:', error);
    return { relevant: false, score: 0 };
  }
}

// Topic Matching Check
async function checkTopicMatch(summary, transcript, providedTopic) {
  try {
    if (!GROQ_API_KEY || !groq) {
      throw new Error('Groq API not configured');
    }

    console.log('Checking topic match...');
    
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: `You are a topic matching validator. Compare the video content with the provided topic.
Return a JSON object with:
- "match": boolean (true if content matches the topic)
- "score": number 0-100 (higher = better match)
Only return the JSON object, nothing else.`
        },
        {
          role: 'user',
          content: `Provided Topic: ${providedTopic}\n\nSummary: ${summary}\n\nTranscript excerpt: ${transcript.substring(0, 1500)}\n\nDoes the content match the provided topic? Return JSON only.`
        }
      ],
      max_tokens: 100,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices?.[0]?.message?.content;
    
    if (!response) {
      return { match: false, score: 0 };
    }

    try {
      const result = JSON.parse(response);
      return {
        match: result.match === true,
        score: Math.min(100, Math.max(0, parseInt(result.score) || 0))
      };
    } catch (parseError) {
      console.error('Failed to parse topic match response:', response);
      return { match: false, score: 0 };
    }
    
  } catch (error) {
    console.error('Topic match check error:', error);
    return { match: false, score: 0 };
  }
}

// Clean up temporary files
function cleanupTempFiles(files) {
  files.forEach(filePath => {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) console.error('Error cleaning up file:', filePath, err);
        else console.log('Cleaned up:', filePath);
      });
    }
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
    
    // Update existing admin coupons with default score after migrations
    return updateAdminCoupons();
  })
  .then(() => {
    console.log('Admin coupons update completed');
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });

// ====== Middleware ======
// CORS: allow local dev ports, mobile, and production
const allowedOrigins = [
  'http://localhost:4000',
  'http://localhost:3000',
  'http://127.0.0.1:4000',
  'http://127.0.0.1:3000',
  'null', // For file:// access
  'file://', // For file:// access
  'https://stocklearning.vercel.app', // Production URL
  'https://stocklearning-npfp7qxlz-sahithguttikondaai-6745s-projects.vercel.app',
  'https://stocklearning-g00s7y24t-sahithguttikondaai-6745s-projects.vercel.app',
  'https://stocklearning-p8lc9ugoo-sahithguttikondaai-6745s-projects.vercel.app',
  'https://stocklearning-eg33g00b3-sahithguttikondaai-6745s-projects.vercel.app'
];

app.use(
  cors({
    origin: (origin, callback) => {
      // No origin (e.g. mobile apps, curl, Postman) – allow
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      // For production, allow all origins to support mobile devices
      if (process.env.NODE_ENV === 'production') {
        return callback(null, true);
      }
      // For development, allow all origins
      return callback(null, true);
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
      secure: process.env.NODE_ENV === 'production', // Secure in production
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

// Serve paper-trading page
app.get('/paper-trading', (req, res) => {
  res.sendFile(path.join(__dirname, 'mlearning', 'mlearning', 'paper-trading.html'));
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

    const { name, topic, isPaid, cost, currency, paymentUpi, 
        ownerUpiId, ownerAccountName, ownerAccountNumber, ownerIfsc,
        uploadPaymentId, uploadOrderId, uploadSignature } = req.body;
    
    console.log('=== FORM DATA DEBUG ===');
    console.log('Name:', name);
    console.log('Topic:', topic);
    console.log('Is Paid:', isPaid);
    console.log('Cost:', cost);
    console.log('Currency:', currency);
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

    // Send payment receipt email if payment was made
    console.log('=== EMAIL DEBUG ===');
    console.log('paymentEmail:', paymentEmail);
    console.log('uploadOrderId:', uploadOrderId);
    console.log('uploadPaymentId:', uploadPaymentId);
    console.log('user.username:', user.username);
    
    if (paymentEmail && uploadOrderId && uploadPaymentId) {
      const receiptDetails = {
        videoTopic: topic,
        amount: 120, // Upload fee is ₹120
        orderId: uploadOrderId,
        paymentId: uploadPaymentId,
        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        mentorName: user.username
      };
      
      console.log('Sending receipt to:', paymentEmail);
      console.log('Receipt details:', receiptDetails);
      
      sendPaymentReceiptEmail(paymentEmail, receiptDetails)
        .then(() => console.log('✅ Upload payment receipt email sent successfully'))
        .catch(err => console.error('❌ Failed to send upload receipt email:', err));
    } else {
      console.log('⚠️ Skipping email - missing required fields');
    }

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

// ====== AI Video Validation Endpoint (Before Payment) ======
// This endpoint validates video content without saving - called BEFORE payment
app.post('/api/validate-video', requireAuth, upload.single('video'), async (req, res) => {
  const tempFiles = [];
  
  try {
    console.log('=== AI VALIDATION STARTED (Pre-Payment) ===');

    if (!req.file) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoFile = req.file;
    const { topic } = req.body;
    tempFiles.push(videoFile.path);

    if (!topic) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ error: 'Topic is required' });
    }

    // === STAGE 1: AUDIO EXTRACTION ===
    console.log('[1/5] Extracting audio...');
    const audioPath = videoFile.path.replace(path.extname(videoFile.path), '.mp3');
    tempFiles.push(audioPath);
    
    try {
      await extractAudioFromVideo(videoFile.path, audioPath);
    } catch (error) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'audio_extraction',
        error: `Audio extraction failed: ${error.message}`,
        message: 'Failed to extract audio. The video may be silent or corrupted.'
      });
    }

    // Check if audio file has content
    const audioStats = fs.statSync(audioPath);
    if (audioStats.size === 0) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'audio_extraction',
        error: 'Audio file is empty',
        message: 'No audio detected in the video. Please upload a video with audio/speech.'
      });
    }

    // === STAGE 2: SPEECH-TO-TEXT TRANSCRIPTION ===
    console.log('[2/5] Transcribing audio...');
    let transcript;
    try {
      transcript = await transcribeAudio(audioPath);
      if (!transcript || transcript.trim().length < 10) {
        throw new Error('Transcription too short - no speech detected');
      }
    } catch (error) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'transcription',
        error: error.message,
        message: 'Failed to transcribe audio. ' + (error.message.includes('empty') 
          ? 'The video appears to be silent.' 
          : 'Please ensure clear audio in the video.')
      });
    }

    console.log('Transcript length:', transcript.length, 'characters');

    // === STAGE 3: AI SUMMARIZATION ===
    console.log('[3/5] Generating summary...');
    let summary;
    try {
      summary = await summarizeTranscript(transcript, topic);
    } catch (error) {
      console.error('Summarization failed, using excerpt:', error);
      summary = transcript.substring(0, 500) + '...';
    }

    // === STAGE 4: AI VALIDATION - STOCK MARKET RELEVANCE ===
    console.log('[4/5] Checking stock market relevance...');
    const relevanceCheck = await checkStockMarketRelevance(summary, transcript);
    console.log('Relevance result:', relevanceCheck);

    // === STAGE 5: AI VALIDATION - TOPIC MATCH ===
    console.log('[5/5] Checking topic match...');
    const topicMatch = await checkTopicMatch(summary, transcript, topic);
    console.log('Topic match result:', topicMatch);

    // === DECISION LOGIC ===
    const MIN_SCORE = 70;
    const relevanceScore = relevanceCheck.score || 0;
    const topicScore = topicMatch.score || 0;
    const isRelevant = relevanceCheck.relevant && relevanceScore > MIN_SCORE;
    const isTopicMatch = topicMatch.match && topicScore > MIN_SCORE;

    let rejectionReason = '';
    if (!isRelevant) {
      rejectionReason = `Content is not stock market related (score: ${relevanceScore}/100, min required: ${MIN_SCORE}).`;
    } else if (!isTopicMatch) {
      rejectionReason = `Content does not match the provided topic "${topic}" (match score: ${topicScore}/100, min required: ${MIN_SCORE}).`;
    }

    const isApproved = isRelevant && isTopicMatch;

    // Calculate file hash for later use
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(videoFile.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');

    // Cleanup temp files
    cleanupTempFiles(tempFiles);

    // Return validation result
    res.json({
      success: true,
      isApproved: isApproved,
      message: isApproved ? 'Video passed AI validation!' : 'Video rejected by AI validation',
      rejectionReason: isApproved ? null : rejectionReason,
      summary: summary,
      relevanceScore: relevanceScore,
      topicScore: topicScore,
      transcript: transcript.substring(0, 2000),
      fileHash: fileHash,
      fileName: videoFile.filename,
      originalName: videoFile.originalname,
      fileSize: videoFile.size,
      mimeType: videoFile.mimetype
    });

  } catch (error) {
    console.error('AI validation error:', error);
    cleanupTempFiles(tempFiles);
    res.status(500).json({ 
      success: false,
      error: error.message || 'AI validation failed'
    });
  }
});

// ====== Final Video Save Endpoint (After Payment + Validation) ======
// This endpoint saves the video after AI validation and payment are complete
app.post('/api/videos/final-save', requireAuth, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'paymentQrCode', maxCount: 1 }
]), async (req, res) => {
  try {
    console.log('=== FINAL VIDEO SAVE ===');

    if (!req.files.video || !req.files.video[0]) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    const videoFile = req.files.video[0];
    const qrCodeFile = req.files.paymentQrCode ? req.files.paymentQrCode[0] : null;

    const { name, topic, isPaid, cost, currency, paymentEmail, paymentUpi, 
        ownerUpiId, ownerAccountName, ownerAccountNumber, ownerIfsc,
        uploadPaymentId, uploadOrderId, uploadSignature,
        aiSummary, relevanceScore, topicMatchScore, transcript, fileHash } = req.body;

    // Verify Razorpay payment
    if (!uploadPaymentId || !uploadOrderId || !uploadSignature) {
      return res.status(400).json({ error: 'Payment verification required' });
    }

    const crypto = require('crypto');
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${uploadOrderId}|${uploadPaymentId}`)
      .digest('hex');
    
    if (generatedSignature !== uploadSignature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Get user info
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check for duplicate
    const existingVideo = await Video.findOne({ fileHash });
    if (existingVideo) {
      fs.unlinkSync(videoFile.path);
      if (qrCodeFile) fs.unlinkSync(qrCodeFile.path);
      return res.status(400).json({ error: 'This video has already been uploaded' });
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
    }

    // Get currency symbol
    const currencySymbols = {
      'USD': '$', 'INR': '₹', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$'
    };
    const currencySymbol = currencySymbols[currency] || '$';
    const formattedAmount = `${currencySymbol}${parseFloat(cost).toFixed(2)}`;

    // Create and save video document
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
      qrCodeUrl: qrCodeFile ? `/uploads/${qrCodeFile.filename}` : null,
      fileName: videoFile.filename,
      fileSize: videoFile.size,
      mimeType: videoFile.mimetype,
      fileHash: fileHash,
      paymentEmail: paymentEmail || null,
      paymentUpi: paymentUpi || null,
      ownerUpiId: ownerUpiId || null,
      ownerAccountName: ownerAccountName || null,
      ownerAccountNumber: ownerAccountNumber || null,
      ownerIfsc: ownerIfsc || null,
      uploadPaymentId: uploadPaymentId,
      uploadOrderId: uploadOrderId,
      uploadPaid: true,
      uploadPaidAt: new Date(),
      // AI Validation fields
      aiSummary: aiSummary,
      relevanceScore: parseInt(relevanceScore),
      topicMatchScore: parseInt(topicMatchScore),
      isApproved: true,
      transcript: transcript,
      validationStatus: 'approved',
      processingStage: 'completed',
      validationCompletedAt: new Date()
    });

    await video.save();

    // Send payment receipt email to user's account email (not upload form email)
    console.log('=== UPLOAD EMAIL DEBUG ===');
    console.log('User account email:', user.email);
    console.log('uploadOrderId:', uploadOrderId);
    console.log('uploadPaymentId:', uploadPaymentId);
    console.log('user.username:', user.username);
    
    if (user.email && uploadOrderId && uploadPaymentId) {
      const receiptDetails = {
        videoTopic: topic,
        amount: 120, // Upload fee is ₹120
        orderId: uploadOrderId,
        paymentId: uploadPaymentId,
        date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
        mentorName: user.username
      };
      
      console.log('Sending upload receipt to user account email:', user.email);
      
      sendPaymentReceiptEmail(user.email, receiptDetails)
        .then(() => console.log('✅ Upload payment receipt email sent successfully'))
        .catch(err => console.error('❌ Failed to send upload receipt email:', err));
    } else {
      console.log('⚠️ Skipping upload email - missing user account email or payment details');
    }

    console.log('Video saved successfully:', video._id);

    res.status(201).json({
      success: true,
      message: 'Video uploaded successfully!',
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
    console.error('Final save error:', error);
    // Cleanup files
    if (req.files && req.files.video && req.files.video[0]) {
      fs.unlink(req.files.video[0].path, () => {});
    }
    if (req.files && req.files.paymentQrCode && req.files.paymentQrCode[0]) {
      fs.unlink(req.files.paymentQrCode[0].path, () => {});
    }
    res.status(500).json({ 
      success: false,
      error: error.message || 'Failed to save video'
    });
  }
});

// ====== AI-Validated Video Upload Endpoint (Legacy - Deprecated) ======
// This endpoint processes videos with AI validation before saving
app.post('/api/videos/ai-validated', requireAuth, upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'paymentQrCode', maxCount: 1 }
]), async (req, res) => {
  const tempFiles = [];
  let videoFile, qrCodeFile;
  
  try {
    console.log('=== AI-VALIDATED UPLOAD STARTED ===');
    
    // Progress tracking helper
    const sendProgress = (stage, message, data = {}) => {
      console.log(`[PROGRESS] ${stage}: ${message}`);
    };
    
    sendProgress('upload', 'Starting video upload process');

    if (!req.files.video || !req.files.video[0]) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    videoFile = req.files.video[0];
    qrCodeFile = req.files.paymentQrCode ? req.files.paymentQrCode[0] : null;
    tempFiles.push(videoFile.path);
    if (qrCodeFile) tempFiles.push(qrCodeFile.path);

    const { name, topic, isPaid, cost, currency, paymentEmail, paymentUpi, 
        ownerUpiId, ownerAccountName, ownerAccountNumber, ownerIfsc,
        uploadPaymentId, uploadOrderId, uploadSignature } = req.body;

    // Validate required fields
    if (!name || !topic) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ error: 'Name and topic are required' });
    }

    // Check for duplicate video
    sendProgress('duplicate_check', 'Checking for duplicate video...');
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(videoFile.path);
    const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex');
    
    const existingVideo = await Video.findOne({ fileHash });
    if (existingVideo) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ 
        error: 'This video has already been uploaded',
        stage: 'duplicate_check',
        duplicate: true
      });
    }

    // Verify Razorpay payment
    sendProgress('payment_verify', 'Verifying payment...');
    if (!uploadPaymentId || !uploadOrderId || !uploadSignature) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ 
        error: 'Payment verification required',
        stage: 'payment_verify'
      });
    }

    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${uploadOrderId}|${uploadPaymentId}`)
      .digest('hex');
    
    if (generatedSignature !== uploadSignature) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({ 
        error: 'Payment verification failed',
        stage: 'payment_verify'
      });
    }

    // Get user info
    const user = await User.findById(req.session.userId);
    if (!user) {
      cleanupTempFiles(tempFiles);
      return res.status(401).json({ error: 'User not found' });
    }

    // === STAGE 1: AUDIO EXTRACTION ===
    sendProgress('audio_extraction', 'Extracting audio from video...');
    const audioPath = videoFile.path.replace(path.extname(videoFile.path), '.mp3');
    tempFiles.push(audioPath);
    
    try {
      await extractAudioFromVideo(videoFile.path, audioPath);
    } catch (error) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'audio_extraction',
        error: `Audio extraction failed: ${error.message}`,
        message: 'Failed to extract audio from video. The video may be silent or corrupted.'
      });
    }

    // Check if audio file has content
    const audioStats = fs.statSync(audioPath);
    if (audioStats.size === 0) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'audio_extraction',
        error: 'Audio file is empty',
        message: 'No audio detected in the video. Please upload a video with audio/speech.'
      });
    }

    // === STAGE 2: SPEECH-TO-TEXT TRANSCRIPTION ===
    sendProgress('transcription', 'Converting speech to text using AI...');
    let transcript;
    try {
      transcript = await transcribeAudio(audioPath);
      
      if (!transcript || transcript.trim().length < 10) {
        throw new Error('Transcription too short - no speech detected');
      }
    } catch (error) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'transcription',
        error: error.message,
        message: 'Failed to transcribe audio. ' + (error.message.includes('empty') 
          ? 'The video appears to be silent.' 
          : 'Please ensure clear audio in the video.')
      });
    }

    console.log('Transcript length:', transcript.length, 'characters');

    // === STAGE 3: AI SUMMARIZATION ===
    sendProgress('summarization', 'Generating AI summary...');
    let summary;
    try {
      summary = await summarizeTranscript(transcript, topic);
    } catch (error) {
      console.error('Summarization failed, continuing without summary:', error);
      summary = transcript.substring(0, 500) + '...';
    }

    // === STAGE 4: AI VALIDATION - STOCK MARKET RELEVANCE ===
    sendProgress('ai_validation', 'Validating stock market relevance...');
    const relevanceCheck = await checkStockMarketRelevance(summary, transcript);
    
    console.log('Relevance check result:', relevanceCheck);

    // === STAGE 5: AI VALIDATION - TOPIC MATCH ===
    sendProgress('ai_validation', 'Checking topic match...');
    const topicMatch = await checkTopicMatch(summary, transcript, topic);
    
    console.log('Topic match result:', topicMatch);

    // === STAGE 6: DECISION LOGIC ===
    const MIN_SCORE = 70;
    const relevanceScore = relevanceCheck.score || 0;
    const topicScore = topicMatch.score || 0;
    const isRelevant = relevanceCheck.relevant && relevanceScore > MIN_SCORE;
    const isTopicMatch = topicMatch.match && topicScore > MIN_SCORE;

    console.log('Validation scores:', { relevanceScore, topicScore, isRelevant, isTopicMatch });

    let rejectionReason = '';
    if (!isRelevant) {
      rejectionReason = `Content is not stock market related (score: ${relevanceScore}/100, min required: ${MIN_SCORE}).`;
    } else if (!isTopicMatch) {
      rejectionReason = `Content does not match the provided topic "${topic}" (match score: ${topicScore}/100, min required: ${MIN_SCORE}).`;
    }

    // If validation fails, reject and cleanup
    if (!isRelevant || !isTopicMatch) {
      cleanupTempFiles(tempFiles);
      return res.status(400).json({
        success: false,
        stage: 'ai_validation',
        message: 'Video rejected by AI validation',
        rejectionReason: rejectionReason,
        summary: summary,
        relevanceScore: relevanceScore,
        topicScore: topicScore,
        isApproved: false,
        transcript: transcript.substring(0, 1000) // First 1000 chars for reference
      });
    }

    // === STAGE 7: SAVE APPROVED VIDEO ===
    sendProgress('saving', 'Saving validated video to database...');

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
    }

    // Get currency symbol
    const currencySymbols = {
      'USD': '$', 'INR': '₹', 'EUR': '€', 'GBP': '£', 'JPY': '¥', 'AUD': 'A$', 'CAD': 'C$'
    };
    const currencySymbol = currencySymbols[currency] || '$';
    const formattedAmount = `${currencySymbol}${parseFloat(cost).toFixed(2)}`;

    // Create and save video document
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
      qrCodeUrl: qrCodeFile ? `/uploads/${qrCodeFile.filename}` : null,
      fileName: videoFile.filename,
      fileSize: videoFile.size,
      mimeType: videoFile.mimetype,
      fileHash: fileHash,
      paymentEmail: paymentEmail || null,
      paymentUpi: paymentUpi || null,
      ownerUpiId: ownerUpiId || null,
      ownerAccountName: ownerAccountName || null,
      ownerAccountNumber: ownerAccountNumber || null,
      ownerIfsc: ownerIfsc || null,
      uploadPaymentId: uploadPaymentId,
      uploadOrderId: uploadOrderId,
      uploadPaid: true,
      uploadPaidAt: new Date(),
      // AI Validation fields
      aiSummary: summary,
      relevanceScore: relevanceScore,
      topicMatchScore: topicScore,
      isApproved: true,
      transcript: transcript.substring(0, 10000), // Store first 10k chars
      validationStatus: 'approved',
      processingStage: 'completed',
      validationCompletedAt: new Date()
    });

    await video.save();

    // Cleanup temp audio file (keep video and thumbnail)
    cleanupTempFiles([audioPath]);

    sendProgress('completed', 'Video upload completed successfully!');

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Video approved and uploaded successfully!',
      stage: 'completed',
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
      },
      aiValidation: {
        summary: summary,
        relevanceScore: relevanceScore,
        topicScore: topicScore,
        isApproved: true
      }
    });

  } catch (error) {
    console.error('AI-validated upload error:', error);
    
    // Cleanup all temp files on error
    cleanupTempFiles(tempFiles);
    
    res.status(500).json({ 
      success: false,
      stage: 'error',
      error: error.message || 'Failed to process video',
      message: 'An error occurred during video processing. Please try again.'
    });
  }
});

// Create Razorpay order for video upload fee ($1)
app.post('/api/create-upload-order', requireAuth, async (req, res) => {
  try {
    console.log('=== CREATE UPLOAD ORDER REQUEST ===');
    
    const amount = 120; // ₹120 INR ($1.44)
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
      
      // Get video details and send receipt to video owner
      const video = await Video.findById(videoId);
      console.log('=== VIDEO LOOKUP ===');
      console.log('Video found:', !!video);
      console.log('Video ID:', videoId);
      
      if (video) {
        const videoOwner = await User.findOne({ username: video.uploader });
        console.log('=== VIDEO OWNER LOOKUP ===');
        console.log('Video uploader (username):', video.uploader);
        console.log('Video owner found:', !!videoOwner);
        
        const buyer = await User.findById(userId);
        console.log('=== BUYER LOOKUP ===');
        console.log('userId:', userId);
        console.log('Buyer found:', !!buyer);
        if (buyer) {
          console.log('Buyer email:', buyer.email);
        }
        
        if (videoOwner && videoOwner.email) {
          const ownerEarnings = (totalAmount * 0.84).toFixed(2); // 84% after 16% commission
          const receiptDetails = {
            videoTopic: video.topic,
            amount: totalAmount,
            ownerEarnings: ownerEarnings,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            mentorName: videoOwner.username,
            buyerName: buyer ? buyer.username : 'Anonymous'
          };
          
          sendSaleReceiptEmail(videoOwner.email, receiptDetails)
            .then(() => console.log('✅ Sale receipt email sent to video owner:', videoOwner.email))
            .catch(err => console.error('❌ Failed to send sale receipt email:', err));
        }
        
        // Send receipt to buyer as well
        console.log('=== BUYER EMAIL DEBUG ===');
        console.log('Buyer object:', buyer ? { id: buyer._id, username: buyer.username, email: buyer.email } : 'null');
        
        if (buyer && buyer.email) {
          const buyerReceiptDetails = {
            videoTopic: video.topic,
            amount: totalAmount,
            orderId: razorpay_order_id,
            paymentId: razorpay_payment_id,
            date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            mentorName: videoOwner ? videoOwner.username : 'Unknown',
            buyerName: buyer.username
          };
          
          console.log('📧 Sending buyer receipt to:', buyer.email);
          console.log('Buyer receipt details:', buyerReceiptDetails);
          
          sendBuyerReceiptEmail(buyer.email, buyerReceiptDetails)
            .then(() => console.log('✅ Purchase receipt email sent to buyer:', buyer.email))
            .catch(err => console.error('❌ Failed to send buyer receipt email:', err));
        } else {
          console.log('⚠️ Skipping buyer email - buyer or buyer.email is missing');
        }
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

    // Calculate amounts - hardcoded 16% platform fee
    const platformFeePercent = 16;
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
      .select('title topic uploader uploaderEmail isPaid price currency formattedAmount videoUrl thumbnail createdAt paymentEmail paymentUpi qrCodeUrl uploadPaid averageRating totalReviews');

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
      createdAt: video.createdAt,
      averageRating: video.averageRating || 0,
      totalReviews: video.totalReviews || 0
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
        amount: record.amount,
        watched: record.watched || false,
        rated: record.rated || false,
        userRating: record.rating || null
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

// ====== Video Rating Endpoints ======

// Mark video as watched (enables rating)
app.post('/api/videos/:videoId/watch', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { videoId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not logged in' });
    }
    
    const access = await VideoAccess.findOne({ userId, videoId });
    if (!access) {
      return res.status(404).json({ error: 'Video not found in user library' });
    }
    
    access.watched = true;
    access.watchedAt = new Date();
    await access.save();
    
    res.json({ success: true, message: 'Video marked as watched' });
  } catch (error) {
    console.error('Error marking video as watched:', error);
    res.status(500).json({ error: 'Failed to mark video as watched' });
  }
});

// Submit rating for a video
app.post('/api/videos/:videoId/rate', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { videoId } = req.params;
    const { rating } = req.body;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not logged in' });
    }
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    // Check if user has access and has watched the video
    const access = await VideoAccess.findOne({ userId, videoId });
    if (!access) {
      return res.status(403).json({ error: 'You must purchase this video to rate it' });
    }
    
    if (!access.watched) {
      return res.status(403).json({ error: 'You must watch the video before rating' });
    }
    
    if (access.rated) {
      return res.status(403).json({ error: 'You have already rated this video' });
    }
    
    // Create rating
    const newRating = new Rating({
      userId,
      videoId,
      rating
    });
    await newRating.save();
    
    // Update VideoAccess
    access.rated = true;
    access.rating = rating;
    await access.save();
    
    // Recalculate video rating stats
    const ratingStats = await Rating.aggregate([
      { $match: { videoId: videoId } },
      { 
        $group: { 
          _id: null, 
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        } 
      }
    ]);
    
    if (ratingStats.length > 0) {
      await Video.findByIdAndUpdate(videoId, {
        averageRating: parseFloat(ratingStats[0].averageRating.toFixed(1)),
        totalReviews: ratingStats[0].totalReviews
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Rating submitted successfully',
      averageRating: ratingStats[0]?.averageRating.toFixed(1) || rating,
      totalReviews: ratingStats[0]?.totalReviews || 1
    });
  } catch (error) {
    console.error('Error submitting rating:', error);
    if (error.code === 11000) {
      return res.status(403).json({ error: 'You have already rated this video' });
    }
    res.status(500).json({ error: 'Failed to submit rating' });
  }
});

// Check if user can rate a video
app.get('/api/videos/:videoId/rating-status', requireAuth, async (req, res) => {
  try {
    const userId = req.session?.userId;
    const { videoId } = req.params;
    
    if (!userId) {
      return res.status(401).json({ error: 'User not logged in' });
    }
    
    const access = await VideoAccess.findOne({ userId, videoId });
    
    if (!access) {
      return res.json({ 
        canRate: false, 
        reason: 'not_purchased',
        watched: false,
        rated: false
      });
    }
    
    res.json({
      canRate: access.watched && !access.rated,
      watched: access.watched,
      rated: access.rated,
      userRating: access.rating || null,
      reason: access.rated ? 'already_rated' : (access.watched ? 'can_rate' : 'not_watched')
    });
  } catch (error) {
    console.error('Error checking rating status:', error);
    res.status(500).json({ error: 'Failed to check rating status' });
  }
});

// Get video rating stats
app.get('/api/videos/:videoId/ratings', async (req, res) => {
  try {
    const { videoId } = req.params;
    
    const video = await Video.findById(videoId).select('averageRating totalReviews');
    
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({
      averageRating: video.averageRating || 0,
      totalReviews: video.totalReviews || 0
    });
  } catch (error) {
    console.error('Error getting video ratings:', error);
    res.status(500).json({ error: 'Failed to get video ratings' });
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
    console.log('=== LOGIN ATTEMPT ===');
    console.log('Request body:', req.body);
    
    const { username, password } = req.body || {};

    if (!username || !password) {
      console.log('Missing username or password');
      return res.status(400).json({ error: 'Username and password are required' });
    }

    console.log('Looking for user:', username);
    const user = await User.findOne({ username });
    if (!user) {
      console.log('User not found:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log('User found, checking password');
    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      console.log('Password mismatch for user:', username);
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    console.log('Password correct, creating session');
    req.session.userId = user._id.toString();
    req.session.username = user.username;

    console.log('Session created:', { userId: req.session.userId, username: req.session.username });

    res.json({
      success: true,
      user: {
        username: user.username,
        email: user.email,
        userType: user.userType,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
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

// Check if email exists (for forgot password) - with rate limiting
const MAX_FORGOT_PASSWORD_ATTEMPTS = 2;
const FORGOT_PASSWORD_WINDOW_HOURS = 24;

app.post('/api/check-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ exists: false });
    }
    
    // Check rate limiting
    const now = new Date();
    const lastAttempt = user.forgotPasswordLastAttempt;
    let attempts = user.forgotPasswordAttempts || 0;
    
    // Reset attempts if 24 hours have passed since last attempt
    if (lastAttempt) {
      const hoursSinceLastAttempt = (now - lastAttempt) / (1000 * 60 * 60);
      if (hoursSinceLastAttempt >= FORGOT_PASSWORD_WINDOW_HOURS) {
        attempts = 0; // Reset counter after 24 hours
      }
    }
    
    // Check if limit exceeded
    if (attempts >= MAX_FORGOT_PASSWORD_ATTEMPTS) {
      const hoursRemaining = lastAttempt 
        ? Math.ceil(FORGOT_PASSWORD_WINDOW_HOURS - (now - lastAttempt) / (1000 * 60 * 60))
        : FORGOT_PASSWORD_WINDOW_HOURS;
      
      console.log(`Rate limit exceeded for ${email}. Attempts: ${attempts}, Hours remaining: ${hoursRemaining}`);
      
      return res.status(429).json({ 
        error: `Too many attempts. You can try again in ${hoursRemaining} hour(s).`,
        rateLimited: true,
        hoursRemaining: hoursRemaining,
        attemptsRemaining: 0
      });
    }
    
    // Increment attempt counter and update timestamp
    await User.updateOne(
      { email },
      { 
        $set: { 
          forgotPasswordAttempts: attempts + 1,
          forgotPasswordLastAttempt: now
        }
      }
    );
    
    console.log(`Forgot password attempt ${attempts + 1}/${MAX_FORGOT_PASSWORD_ATTEMPTS} for ${email}`);
    
    res.json({ 
      exists: true,
      attemptsRemaining: MAX_FORGOT_PASSWORD_ATTEMPTS - (attempts + 1)
    });
  } catch (error) {
    console.error('Check email error:', error);
    res.status(500).json({ error: 'Failed to check email' });
  }
});

// Reset password (for forgot password)
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, newPassword } = req.body;
    
    if (!email || !newPassword) {
      return res.status(400).json({ error: 'Email and new password are required' });
    }
    
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update user password
    const result = await User.updateOne(
      { email },
      { $set: { passwordHash: hashedPassword } }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log(`Password reset successful for: ${email}`);
    res.json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ====== Mentor Earnings API ======

// Get mentor earnings data
app.get('/api/mentor/earnings', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Find the user to verify they are a mentor
    const user = await User.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    if (user.userType !== 'mentor') {
      return res.status(403).json({ error: 'Access denied. Only mentors can view earnings.' });
    }

    console.log('=== FETCHING MENTOR EARNINGS ===');
    console.log('User:', user.email);

    // Get all videos uploaded by this mentor using uploaderEmail
    const videos = await Video.find({ uploaderEmail: user.email })
      .select('title topic createdAt price uploaderEmail')
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`Found ${videos.length} videos for mentor ${user.email}`);
    if (videos.length > 0) {
      console.log('First video from DB:', { 
        title: videos[0].title, 
        topic: videos[0].topic,
        keys: Object.keys(videos[0])
      });
    }
    console.log(`Found ${videos.length} videos for mentor`);

    // Calculate earnings per video by querying VideoAccess collection
    const videoStats = [];
    for (const video of videos) {
      console.log('Video object keys:', Object.keys(video));
      console.log('Video topic value:', video.topic);
      // Get all access records for this video to calculate discounts
      const accessRecords = await VideoAccess.find({ videoId: video._id.toString() });
      const purchaseCount = accessRecords.length;
      
      // Calculate revenue and discount information
      let revenuePerVideo = 0;
      let totalDiscountAmount = 0;
      let discountedPurchases = 0;
      
      const purchaseDetails = accessRecords.map(record => {
        const originalPrice = video.price || 0;
        const actualPaid = record.amount || originalPrice;
        const discountAmount = originalPrice - actualPaid;
        const hasDiscount = discountAmount > 0;
        
        if (hasDiscount) {
          totalDiscountAmount += discountAmount;
          discountedPurchases++;
        }
        
        revenuePerVideo += actualPaid;
        
        return {
          userId: record.userId,
          purchasedAt: record.unlockedAt,
          originalPrice: originalPrice,
          actualPaid: actualPaid,
          discountAmount: discountAmount,
          hasDiscount: hasDiscount
        };
      });
      
      console.log(`Video: ${video.title}, Topic: ${video.topic}, Purchases: ${purchaseCount}, Revenue: ₹${revenuePerVideo}, Discounts: ${discountedPurchases}`);
      
      videoStats.push({
        videoId: video._id,
        title: video.title,
        topic: video.topic,
        uploadDate: video.createdAt,
        price: video.price || 0,
        purchaseCount: purchaseCount,
        revenue: revenuePerVideo,
        discountedPurchases: discountedPurchases,
        totalDiscountAmount: totalDiscountAmount,
        purchases: purchaseDetails
      });
    }

    // Calculate totals
    const totalVideos = videos.length;
    const totalPurchases = videoStats.reduce((sum, v) => sum + v.purchaseCount, 0);
    const totalEarnings = videoStats.reduce((sum, v) => sum + v.revenue, 0);

    console.log(`Total Videos: ${totalVideos}, Total Purchases: ${totalPurchases}, Total Earnings: ₹${totalEarnings}`);

    res.json({
      success: true,
      mentor: {
        username: user.username,
        email: user.email
      },
      stats: {
        totalVideos,
        totalPurchases,
        totalEarnings
      },
      videos: videoStats
    });

  } catch (error) {
    console.error('Error fetching mentor earnings:', error);
    res.status(500).json({ error: 'Failed to fetch earnings data' });
  }
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

// ====== Paper Trading System ======

// Popular stocks for paper trading (NSE/BSE symbols)
const POPULAR_STOCKS = [
  { symbol: 'RELIANCE.BSE', name: 'Reliance Industries', exchange: 'BSE' },
  { symbol: 'TCS.BSE', name: 'Tata Consultancy Services', exchange: 'BSE' },
  { symbol: 'HDFCBANK.BSE', name: 'HDFC Bank', exchange: 'BSE' },
  { symbol: 'INFY.BSE', name: 'Infosys', exchange: 'BSE' },
  { symbol: 'ICICIBANK.BSE', name: 'ICICI Bank', exchange: 'BSE' },
  { symbol: 'HINDUNILVR.BSE', name: 'Hindustan Unilever', exchange: 'BSE' },
  { symbol: 'SBIN.BSE', name: 'State Bank of India', exchange: 'BSE' },
  { symbol: 'BAJFINANCE.BSE', name: 'Bajaj Finance', exchange: 'BSE' },
  { symbol: 'BHARTIARTL.BSE', name: 'Bharti Airtel', exchange: 'BSE' },
  { symbol: 'ITC.BSE', name: 'ITC Limited', exchange: 'BSE' },
  { symbol: 'KOTAKBANK.BSE', name: 'Kotak Mahindra Bank', exchange: 'BSE' },
  { symbol: 'LT.BSE', name: 'Larsen & Toubro', exchange: 'BSE' },
  { symbol: 'AXISBANK.BSE', name: 'Axis Bank', exchange: 'BSE' },
  { symbol: 'ASIANPAINT.BSE', name: 'Asian Paints', exchange: 'BSE' },
  { symbol: 'MARUTI.BSE', name: 'Maruti Suzuki', exchange: 'BSE' },
  { symbol: 'TITAN.BSE', name: 'Titan Company', exchange: 'BSE' },
  { symbol: 'SUNPHARMA.BSE', name: 'Sun Pharmaceutical', exchange: 'BSE' },
  { symbol: 'WIPRO.BSE', name: 'Wipro', exchange: 'BSE' },
  { symbol: 'NESTLEIND.BSE', name: 'Nestle India', exchange: 'BSE' },
  { symbol: 'POWERGRID.BSE', name: 'Power Grid Corp', exchange: 'BSE' },
  { symbol: 'NTPC.BSE', name: 'NTPC Limited', exchange: 'BSE' },
  { symbol: 'ULTRACEMCO.BSE', name: 'UltraTech Cement', exchange: 'BSE' },
  { symbol: 'M&M.BSE', name: 'Mahindra & Mahindra', exchange: 'BSE' },
  { symbol: 'BAJAJFINSV.BSE', name: 'Bajaj Finserv', exchange: 'BSE' },
  { symbol: 'ADANIENT.BSE', name: 'Adani Enterprises', exchange: 'BSE' },
  { symbol: 'ADANIPORTS.BSE', name: 'Adani Ports', exchange: 'BSE' },
  { symbol: 'COALINDIA.BSE', name: 'Coal India', exchange: 'BSE' },
  { symbol: 'HCLTECH.BSE', name: 'HCL Technologies', exchange: 'BSE' },
  { symbol: 'TECHM.BSE', name: 'Tech Mahindra', exchange: 'BSE' },
  { symbol: 'ONGC.BSE', name: 'Oil & Natural Gas Corp', exchange: 'BSE' },
  { symbol: 'JSWSTEEL.BSE', name: 'JSW Steel', exchange: 'BSE' },
  { symbol: 'TATAMOTORS.BSE', name: 'Tata Motors', exchange: 'BSE' },
  { symbol: 'GRASIM.BSE', name: 'Grasim Industries', exchange: 'BSE' },
  { symbol: 'HDFCLIFE.BSE', name: 'HDFC Life Insurance', exchange: 'BSE' },
  { symbol: 'SBILIFE.BSE', name: 'SBI Life Insurance', exchange: 'BSE' },
  { symbol: 'TATASTEEL.BSE', name: 'Tata Steel', exchange: 'BSE' },
  { symbol: 'APOLLOHOSP.BSE', name: 'Apollo Hospitals', exchange: 'BSE' },
  { symbol: 'INDUSINDBK.BSE', name: 'IndusInd Bank', exchange: 'BSE' },
  { symbol: 'EICHERMOT.BSE', name: 'Eicher Motors', exchange: 'BSE' },
  { symbol: 'UPL.BSE', name: 'UPL Limited', exchange: 'BSE' },
  { symbol: 'BPCL.BSE', name: 'Bharat Petroleum', exchange: 'BSE' },
  { symbol: 'DIVISLAB.BSE', name: "Divi's Laboratories", exchange: 'BSE' },
  { symbol: 'CIPLA.BSE', name: 'Cipla', exchange: 'BSE' },
  { symbol: 'HEROMOTOCO.BSE', name: 'Hero MotoCorp', exchange: 'BSE' },
  { symbol: 'DRREDDY.BSE', name: "Dr. Reddy's Laboratories", exchange: 'BSE' },
  { symbol: 'BRITANNIA.BSE', name: 'Britannia Industries', exchange: 'BSE' },
  { symbol: 'SHREECEM.BSE', name: 'Shree Cement', exchange: 'BSE' },
  { symbol: 'TATACONSUM.BSE', name: 'Tata Consumer Products', exchange: 'BSE' },
  { symbol: 'HINDALCO.BSE', name: 'Hindalco Industries', exchange: 'BSE' },
  { symbol: 'DABUR.BSE', name: 'Dabur India', exchange: 'BSE' }
];

// Get stock quote from Alpha Vantage with caching
async function getStockQuote(symbol) {
  try {
    // Check cache first
    const cacheKey = symbol.toUpperCase();
    const cached = stockPriceCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      console.log(`Using cached price for ${symbol}: ₹${cached.price}`);
      return cached;
    }
    
    if (!ALPHA_VANTAGE_API_KEY) {
      // Return mock data for testing without API
      console.log(`ALPHA_VANTAGE_API_KEY not set, returning mock data for ${symbol}`);
      const mockPrice = Math.round((Math.random() * 2000 + 100) * 100) / 100;
      const mockData = {
        symbol: symbol,
        price: mockPrice,
        change: Math.round((Math.random() * 20 - 10) * 100) / 100,
        changePercent: Math.round((Math.random() * 5 - 2.5) * 100) / 100,
        currency: 'INR',
        timestamp: Date.now(),
        isMock: true
      };
      stockPriceCache.set(cacheKey, mockData);
      return mockData;
    }
    
    // Call Alpha Vantage API
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data['Global Quote'] && data['Global Quote']['05. price']) {
      const quote = data['Global Quote'];
      const price = parseFloat(quote['05. price']);
      const change = parseFloat(quote['09. change'] || '0');
      const changePercent = parseFloat((quote['10. change percent'] || '0').replace('%', ''));
      
      const result = {
        symbol: symbol,
        price: price,
        change: change,
        changePercent: changePercent,
        currency: 'INR',
        timestamp: Date.now(),
        isMock: false
      };
      
      stockPriceCache.set(cacheKey, result);
      console.log(`Fetched live price for ${symbol}: ₹${price}`);
      return result;
    } else {
      // Fallback to mock data if API returns empty
      console.log(`Alpha Vantage returned no data for ${symbol}, using mock data`);
      const mockPrice = Math.round((Math.random() * 2000 + 100) * 100) / 100;
      const mockData = {
        symbol: symbol,
        price: mockPrice,
        change: Math.round((Math.random() * 20 - 10) * 100) / 100,
        changePercent: Math.round((Math.random() * 5 - 2.5) * 100) / 100,
        currency: 'INR',
        timestamp: Date.now(),
        isMock: true
      };
      stockPriceCache.set(cacheKey, mockData);
      return mockData;
    }
  } catch (error) {
    console.error(`Error fetching stock quote for ${symbol}:`, error);
    // Return mock data on error
    const mockPrice = Math.round((Math.random() * 2000 + 100) * 100) / 100;
    return {
      symbol: symbol,
      price: mockPrice,
      change: Math.round((Math.random() * 20 - 10) * 100) / 100,
      changePercent: Math.round((Math.random() * 5 - 2.5) * 100) / 100,
      currency: 'INR',
      timestamp: Date.now(),
      isMock: true
    };
  }
}

// Get available stocks for paper trading
app.get('/api/paper-trading/stocks', async (req, res) => {
  try {
    res.json({
      success: true,
      stocks: POPULAR_STOCKS
    });
  } catch (error) {
    console.error('Error fetching stocks:', error);
    res.status(500).json({ error: 'Failed to fetch stocks' });
  }
});

// Get real-time stock quote
app.get('/api/paper-trading/quote/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    if (!symbol) {
      return res.status(400).json({ error: 'Stock symbol is required' });
    }
    
    const quote = await getStockQuote(symbol);
    
    res.json({
      success: true,
      quote: quote
    });
  } catch (error) {
    console.error('Error fetching stock quote:', error);
    res.status(500).json({ error: 'Failed to fetch stock quote' });
  }
});

// Get user balance - requires login
app.get('/api/paper-trading/balance', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to access paper trading' });
    }
    
    const userId = req.session.userId;
    
    let balance = await PaperTradingBalance.findOne({ userId: userId });
    
    if (!balance) {
      // Create initial balance of ₹100,000
      balance = new PaperTradingBalance({
        userId: userId,
        balance: 100000,
        currency: 'INR'
      });
      await balance.save();
      console.log(`Created paper trading account with ₹100,000 for user: ${userId}`);
    }
    
    res.json({
      success: true,
      balance: {
        amount: balance.balance,
        currency: balance.currency,
        formatted: `₹${balance.balance.toLocaleString('en-IN')}`
      }
    });
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// Get user portfolio - requires login
app.get('/api/paper-trading/portfolio', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to access paper trading' });
    }

    const userId = req.session.userId;
    console.log(`[PORTFOLIO] Fetching portfolio for user ${userId}`);

    const holdings = await PaperTradingHolding.find({ userId: userId });
    console.log(`[PORTFOLIO] Found ${holdings.length} holdings:`, holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity })));

    const balance = await PaperTradingBalance.findOne({ userId: userId });
    
    if (!balance) {
      // Create new account with initial balance
      const newBalance = new PaperTradingBalance({
        userId: userId,
        balance: 100000,
        currency: 'INR'
      });
      await newBalance.save();
      
      return res.json({
        success: true,
        portfolio: {
          cashBalance: 100000,
          holdings: [],
          summary: {
            totalInvestment: 0,
            totalCurrentValue: 0,
            totalProfitLoss: 0,
            totalProfitLossPercent: 0,
            totalPortfolioValue: 100000
          }
        }
      });
    }
    
    // Get current prices for all holdings
    const portfolioWithPrices = await Promise.all(
      holdings.map(async (holding) => {
        const quote = await getStockQuote(holding.symbol);
        const currentValue = holding.quantity * quote.price;
        const investment = holding.totalInvestment;
        const profitLoss = currentValue - investment;
        const profitLossPercent = investment > 0 ? (profitLoss / investment) * 100 : 0;
        
        return {
          symbol: holding.symbol,
          companyName: holding.companyName,
          quantity: holding.quantity,
          avgBuyPrice: holding.avgBuyPrice,
          currentPrice: quote.price,
          investment: investment,
          currentValue: currentValue,
          profitLoss: profitLoss,
          profitLossPercent: profitLossPercent,
          dayChange: quote.change,
          dayChangePercent: quote.changePercent
        };
      })
    );
    
    const totalInvestment = portfolioWithPrices.reduce((sum, h) => sum + h.investment, 0);
    const totalCurrentValue = portfolioWithPrices.reduce((sum, h) => sum + h.currentValue, 0);
    const totalProfitLoss = totalCurrentValue - totalInvestment;
    const totalProfitLossPercent = totalInvestment > 0 ? (totalProfitLoss / totalInvestment) * 100 : 0;
    
    res.json({
      success: true,
      portfolio: {
        cashBalance: balance.balance,
        holdings: portfolioWithPrices,
        summary: {
          totalInvestment: totalInvestment,
          totalCurrentValue: totalCurrentValue,
          totalProfitLoss: totalProfitLoss,
          totalProfitLossPercent: totalProfitLossPercent,
          totalPortfolioValue: balance.balance + totalCurrentValue
        }
      }
    });
  } catch (error) {
    console.error('Error fetching portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio' });
  }
});

// Buy stock - requires login
app.post('/api/paper-trading/buy', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to trade' });
    }

    const userId = req.session.userId;
    console.log(`[BUY] User ${userId} attempting to buy stock`);

    const { symbol, companyName, quantity } = req.body;

    if (!symbol || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Symbol and valid quantity are required' });
    }

    // Get current stock price
    const quote = await getStockQuote(symbol);
    const totalCost = quote.price * quantity;
    console.log(`[BUY] Stock ${symbol} price: ₹${quote.price}, Total cost: ₹${totalCost}`);

    // Check user balance
    let balance = await PaperTradingBalance.findOne({ userId: userId });
    if (!balance) {
      balance = new PaperTradingBalance({
        userId: userId,
        balance: 100000,
        currency: 'INR'
      });
      await balance.save();
      console.log(`[BUY] Created new balance for user ${userId}: ₹100,000`);
    }

    if (balance.balance < totalCost) {
      return res.status(400).json({
        error: 'Insufficient balance',
        required: totalCost,
        available: balance.balance
      });
    }

    // Deduct from balance
    balance.balance -= totalCost;
    balance.updatedAt = new Date();
    await balance.save();
    console.log(`[BUY] Deducted ₹${totalCost} from user ${userId} balance. New balance: ₹${balance.balance}`);

    // Update or create holding
    let holding = await PaperTradingHolding.findOne({ userId: userId, symbol: symbol });

    if (holding) {
      // Update existing holding with new average price
      const totalQuantity = holding.quantity + quantity;
      const totalInvestment = holding.totalInvestment + totalCost;
      holding.quantity = totalQuantity;
      holding.avgBuyPrice = totalInvestment / totalQuantity;
      holding.totalInvestment = totalInvestment;
      holding.updatedAt = new Date();
      await holding.save();
      console.log(`[BUY] Updated existing holding for ${symbol}: ${totalQuantity} shares @ ₹${holding.avgBuyPrice}`);
    } else {
      // Create new holding
      holding = new PaperTradingHolding({
        userId: userId,
        symbol: symbol,
        companyName: companyName || symbol,
        quantity: quantity,
        avgBuyPrice: quote.price,
        totalInvestment: totalCost
      });
      await holding.save();
      console.log(`[BUY] Created new holding for ${symbol}: ${quantity} shares @ ₹${quote.price}`);
    }

    // Verify holding was saved
    const verifyHolding = await PaperTradingHolding.findOne({ userId: userId, symbol: symbol });
    console.log(`[BUY] Verified holding in DB:`, verifyHolding);

    // Record transaction
    const transaction = new PaperTradingTransaction({
      userId: userId,
      symbol: symbol,
      companyName: companyName || symbol,
      type: 'BUY',
      quantity: quantity,
      price: quote.price,
      totalAmount: totalCost,
      balanceAfter: balance.balance
    });
    await transaction.save();

    console.log(`[BUY] SUCCESS: User ${userId} bought ${quantity} shares of ${symbol} at ₹${quote.price}`);

    res.json({
      success: true,
      message: `Successfully bought ${quantity} shares of ${symbol}`,
      transaction: {
        symbol: symbol,
        quantity: quantity,
        price: quote.price,
        totalCost: totalCost,
        balance: balance.balance
      }
    });
  } catch (error) {
    console.error('[BUY] Error:', error);
    res.status(500).json({ error: 'Failed to execute buy order' });
  }
});

// Sell stock - requires login
app.post('/api/paper-trading/sell', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to trade' });
    }
    
    const userId = req.session.userId;
    
    const { symbol, quantity } = req.body;
    
    if (!symbol || !quantity || quantity <= 0) {
      return res.status(400).json({ error: 'Symbol and valid quantity are required' });
    }
    
    // Check user holdings
    const holding = await PaperTradingHolding.findOne({ userId: userId, symbol: symbol });
    
    if (!holding || holding.quantity < quantity) {
      return res.status(400).json({ 
        error: 'Insufficient shares',
        available: holding ? holding.quantity : 0,
        requested: quantity
      });
    }
    
    // Get current stock price
    const quote = await getStockQuote(symbol);
    const totalValue = quote.price * quantity;
    
    // Calculate profit/loss for this sale
    const costBasis = holding.avgBuyPrice * quantity;
    const profitLoss = totalValue - costBasis;
    
    // Add to balance
    let balance = await PaperTradingBalance.findOne({ userId: userId });
    balance.balance += totalValue;
    balance.updatedAt = new Date();
    await balance.save();
    
    // Update holding
    holding.quantity -= quantity;
    holding.totalInvestment = holding.avgBuyPrice * holding.quantity;
    holding.updatedAt = new Date();
    
    if (holding.quantity === 0) {
      await PaperTradingHolding.deleteOne({ _id: holding._id });
    } else {
      await holding.save();
    }
    
    // Record transaction
    const transaction = new PaperTradingTransaction({
      userId: userId,
      symbol: symbol,
      companyName: holding.companyName,
      type: 'SELL',
      quantity: quantity,
      price: quote.price,
      totalAmount: totalValue,
      balanceAfter: balance.balance
    });
    await transaction.save();
    
    console.log(`SELL: User ${userId} sold ${quantity} shares of ${symbol} at ₹${quote.price} (P&L: ₹${profitLoss.toFixed(2)})`);
    
    res.json({
      success: true,
      message: `Successfully sold ${quantity} shares of ${symbol}`,
      transaction: {
        symbol: symbol,
        quantity: quantity,
        price: quote.price,
        totalValue: totalValue,
        profitLoss: profitLoss,
        balance: balance.balance
      }
    });
  } catch (error) {
    console.error('Error selling stock:', error);
    res.status(500).json({ error: 'Failed to execute sell order' });
  }
});

// Get transaction history - requires login
app.get('/api/paper-trading/transactions', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to view transactions' });
    }
    
    const userId = req.session.userId;
    
    const { limit = 50, page = 1 } = req.query;
    
    const transactions = await PaperTradingTransaction.find({ userId: userId })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
    
    const total = await PaperTradingTransaction.countDocuments({ userId: userId });
    
    res.json({
      success: true,
      transactions: transactions,
      pagination: {
        total: total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Reset paper trading account - requires login
app.post('/api/paper-trading/reset', async (req, res) => {
  try {
    // Check if user is logged in
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Please log in to reset account' });
    }
    
    const userId = req.session.userId;
    
    // Reset balance to ₹100,000
    await PaperTradingBalance.findOneAndUpdate(
      { userId: userId },
      { balance: 100000, updatedAt: new Date() },
      { upsert: true }
    );
    
    // Delete all holdings
    await PaperTradingHolding.deleteMany({ userId: userId });
    
    // Clear transactions history (optional - keeping for now)
    // await PaperTradingTransaction.deleteMany({ userId: userId });
    
    console.log(`Reset paper trading account for user: ${userId}`);
    
    res.json({
      success: true,
      message: 'Paper trading account reset successfully. Starting balance: ₹100,000'
    });
  } catch (error) {
    console.error('Error resetting account:', error);
    res.status(500).json({ error: 'Failed to reset account' });
  }
});

// Serve paper trading page
app.get('/paper-trading', (req, res) => {
  try {
    const paperTradingPath = path.join(__dirname, 'mlearning', 'mlearning', 'paper-trading.html');
    res.sendFile(paperTradingPath);
  } catch (error) {
    console.error('Error serving paper trading page:', error);
    res.status(500).send('Error loading paper trading page');
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