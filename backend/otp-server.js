require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 5000;

// CORS configuration (allow from any origin; no credentials needed)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Handle preflight requests
app.options('/send-otp', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.send(200);
});

app.options('/verify-otp', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
  res.send(200);
});

app.use(express.json());

// Email transporter configuration
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify email transporter configuration
console.log('OTP Server - Email configuration:');
console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***configured***' : '***missing***');

transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter configuration error:', error);
  } else {
    console.log('Email transporter is ready to send emails');
  }
});

// In-memory OTP storage
const otpStore = {};

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'otp-server', port: 5000 });
});

// Send OTP endpoint
app.post('/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('OTP request received for email:', email);

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiry = Date.now() + 5 * 60 * 1000; // 5 minutes expiry
    console.log('Generated OTP:', otp);

    // Store OTP
    otpStore[email] = {
      otp,
      expiry,
      attempts: 0
    };
    console.log('OTP stored for email:', email);

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'StockMaster - Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #667eea; text-align: center;">StockMaster Email Verification</h2>
          <div style="background: #f8fafc; padding: 30px; border-radius: 10px; text-align: center; margin: 20px 0;">
            <p style="font-size: 16px; color: #4a5568; margin-bottom: 20px;">Your verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; color: #2d3748; letter-spacing: 5px; background: white; padding: 20px; border-radius: 8px; border: 2px solid #e2e8f0;">
              ${otp}
            </div>
            <p style="font-size: 14px; color: #718096; margin-top: 20px;">This code will expire in 5 minutes.</p>
          </div>
          <p style="text-align: center; color: #a0aec0; font-size: 12px;">
            If you didn't request this code, please ignore this email.
          </p>
        </div>
      `
    };

    console.log('Attempting to send email to:', email);
    
    await transporter.sendMail(mailOptions);
    console.log('Email sent successfully to:', email);
    
    res.json({ 
      success: true, 
      message: 'OTP sent successfully',
      expiry: 5 * 60 * 1000 // 5 minutes in milliseconds
    });

  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({ 
      error: 'Failed to send OTP. Please try again.',
      details: error.message 
    });
  }
});

// Verify OTP endpoint
app.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    console.log('OTP verification request for email:', email);

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const storedData = otpStore[email];

    if (!storedData) {
      return res.status(400).json({ error: 'OTP not found or expired' });
    }

    // Check expiry
    if (Date.now() > storedData.expiry) {
      delete otpStore[email];
      return res.status(400).json({ error: 'OTP has expired' });
    }

    // Check attempts (max 3 attempts)
    if (storedData.attempts >= 3) {
      delete otpStore[email];
      return res.status(400).json({ error: 'Too many failed attempts. Please request a new OTP.' });
    }

    // Verify OTP
    if (storedData.otp === otp) {
      delete otpStore[email]; // Clear OTP after successful verification
      console.log('OTP verified successfully for email:', email);
      res.json({ 
        success: true, 
        message: 'OTP verified successfully' 
      });
    } else {
      storedData.attempts++;
      console.log('Invalid OTP attempt for email:', email, 'Attempts left:', 3 - storedData.attempts);
      res.status(400).json({ 
        error: 'Invalid OTP',
        attemptsLeft: 3 - storedData.attempts 
      });
    }

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ 
      error: 'Failed to verify OTP. Please try again.',
      details: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`OTP server listening on http://localhost:${PORT}`);
});
