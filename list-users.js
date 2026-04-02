require('dotenv').config();
const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || 'mongodb+srv://sahithguttikondaai_db_user:sai%40121@cluster0.o37tcxa.mongodb.net/stockmaster?retryWrites=true&w=majority&appName=Cluster0')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // User schema
    const userSchema = new mongoose.Schema({
      email: String,
      username: String,
      passwordHash: String,
      userType: String
    });
    const User = mongoose.model('User', userSchema);
    
    // List all users
    const users = await User.find({});
    console.log('All users in database:');
    users.forEach(user => {
      console.log(`- Email: ${user.email}, Username: ${user.username}, UserType: ${user.userType || 'NOT SET'}`);
    });
    
    process.exit(0);
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });
