const express = require("express");
const app = express();
const path = require("path");
const mongoose = require("mongoose");

// Connect to MongoDB Atlas (same as main server)
const MONGO_URI = 'mongodb+srv://sahithguttikondaai_db_user:sai%40121@cluster0.o37tcxa.mongodb.net/stockmaster?retryWrites=true&w=majority&appName=Cluster0';

// Define ExamUser Schema
const examUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  registeredAt: { type: Date, default: Date.now }
});

// Define Coupon Schema
const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  discount: { type: Number, required: true, default: 30 },
  userId: { type: String, default: 'anonymous' },
  username: { type: String, default: 'anonymous' },
  score: { type: Number, required: true },
  generatedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
  used: { type: Boolean, default: false },
  usedAt: { type: Date }
});

const ExamUser = mongoose.model('ExamUser', examUserSchema);
const Coupon = mongoose.model('Coupon', couponSchema);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend', 'online-exam-proctoring', 'public')));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'online-exam-proctoring', 'public', 'index.html'));
});

// Register user for exam
app.post('/api/register-exam-user', async (req, res) => {
  try {
    console.log('=== EXAM USER REGISTRATION ===');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    const { name, email } = req.body;
    
    if (!name || !email) {
      console.log('Missing name or email');
      return res.status(400).json({ error: 'Name and email are required' });
    }
    
    console.log('Attempting to find existing user with email:', email);
    // Check if user already exists
    const existingUser = await ExamUser.findOne({ email });
    if (existingUser) {
      console.log('User already exists:', existingUser);
      return res.status(400).json({ error: 'User with this email already exists' });
    }
    
    console.log('Creating new exam user with name:', name, 'email:', email);
    // Create new exam user
    const newExamUser = new ExamUser({
      name,
      email
    });
    
    await newExamUser.save();
    console.log('Exam user registered successfully:', newExamUser);
    
    res.json({ 
      success: true, 
      message: 'User registered successfully',
      user: newExamUser
    });
  } catch (error) {
    console.error('Error registering exam user:', error);
    res.status(500).json({ error: 'Failed to register user: ' + error.message });
  }
});

// Get user by email
app.get('/api/get-exam-user/:email', async (req, res) => {
  try {
    const { email } = req.params;
    const user = await ExamUser.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ success: true, user });
  } catch (error) {
    console.error('Error getting exam user:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Coupon API endpoints
app.post('/api/generate-coupon', async (req, res) => {
  try {
    console.log('=== COUPON GENERATION REQUEST ===');
    console.log('Request body:', req.body);
    
    const { score, userEmail } = req.body;
    
    // Check if score is 70% or higher
    if (score < 70) {
      console.log('Score too low:', score);
      return res.status(400).json({ error: 'Score must be 70% or higher to earn a discount' });
    }
    
    // Find user from examusers collection
    let userName = 'anonymous';
    if (userEmail) {
      const examUser = await ExamUser.findOne({ email: userEmail });
      if (examUser) {
        userName = examUser.name;
        console.log('Found exam user:', examUser);
      } else {
        console.log('No exam user found for email:', userEmail);
      }
    }
    
    console.log('Score valid, generating coupon for user:', userName);
    
    // Generate unique coupon code
    const couponCode = 'STOCK30' + Math.random().toString(36).substr(2, 8).toUpperCase();
    console.log('Generated coupon code:', couponCode);
    
    // Create new coupon in database with actual user info
    const newCoupon = new Coupon({
      code: couponCode,
      discount: 30,
      userId: userEmail || 'anonymous',
      username: userName,
      score: score,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
    });
    
    console.log('New coupon object:', newCoupon);
    
    await newCoupon.save();
    console.log('Coupon saved to database successfully');
    
    res.json({ 
      success: true, 
      coupon: couponCode,
      expiresAt: newCoupon.expiresAt,
      userName: userName
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

app.post('/api/validate-coupon', async (req, res) => {
  try {
    console.log('=== COUPON VALIDATION REQUEST ===');
    console.log('Request body:', req.body);
    
    const { couponCode } = req.body;
    
    if (!couponCode) {
      console.log('No coupon code provided');
      return res.status(400).json({ error: 'Coupon code is required' });
    }
    
    console.log('Looking for coupon:', couponCode.toUpperCase());
    
    // Find the coupon in database
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
    
    console.log('Coupon valid, marking as used...');
    
    // Mark coupon as used
    coupon.used = true;
    coupon.usedAt = new Date();
    
    await coupon.save();
    console.log('Coupon marked as used successfully');
    
    res.json({ 
      success: true, 
      discount: coupon.discount,
      message: 'Coupon applied successfully'
    });
  } catch (error) {
    console.error('Error validating coupon:', error);
    res.status(500).json({ error: 'Failed to validate coupon' });
  }
});

// Connect to MongoDB and start server
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB at', MONGO_URI);
    app.listen(3002, () => {
      console.log("Exam Proctoring Server running on http://localhost:3002");
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
  });