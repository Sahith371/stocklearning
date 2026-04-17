# Manual Payment Approval System

## How to Implement Quick Fix:

### 1. Create Payment Records Table
```javascript
const paymentSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  userId: { type: String, required: true },
  amount: { type: Number, required: true },
  method: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  screenshot: { type: String }, // Optional: Payment screenshot
  transactionId: { type: String } // User enters transaction ID
});
```

### 2. Add Payment Request Endpoint
```javascript
app.post('/api/payment-request', async (req, res) => {
  // Store payment request in database
  // Send notification to admin
  // Return "pending" status
});
```

### 3. Admin Approval Panel
- View all pending payments
- Approve/reject with reason
- Send email notifications

### 4. Check Payment Status
```javascript
app.post('/api/check-payment-status', async (req, res) => {
  // Check if payment is approved
  // Return true/false
});
```

## User Flow:
1. User pays via QR code
2. User enters transaction ID
3. Admin receives notification
4. Admin verifies payment (checks bank statement)
5. Admin approves payment
6. Video unlocks for user
