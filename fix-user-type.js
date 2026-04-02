require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://sahithguttikondaai_db_user:sai%40121@cluster0.o37tcxa.mongodb.net/stockmaster?retryWrites=true&w=majority&appName=Cluster0')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Update your user to be a mentor
    const User = mongoose.model('User', new mongoose.Schema({
      email: String,
      username: String,
      passwordHash: String,
      userType: String
    }));
    
    // Update your specific user to be a mentor
    const result = await User.updateOne(
      { email: 'stockmastere5@gmail.com' }, // Your email
      { $set: { userType: 'mentor' } }
    );
    
    console.log('Update result:', result);
    
    // Check the user after update
    const user = await User.findOne({ email: 'stockmastere5@gmail.com' });
    console.log('User after update:', user);
    
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
