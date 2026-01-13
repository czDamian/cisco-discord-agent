import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  discordId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  discordUsername: {
    type: String,
    required: true
  },
  amadeusPublicKey: {
    type: String,
    required: true,
    index: true
  },
  amadeusPrivateKey: {
    type: String,
    required: true
  }, // ENCRYPTED with AES-256-GCM
  balance: {
    type: Number,
    default: 0
  }, // AMA balance (cached)
  totalRequests: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  transactions: [{
    type: {
      type: String,
      enum: ['payment', 'deposit', 'refund'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    txHash: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    description: String
  }],
  lastActive: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

export default mongoose.model('User', userSchema);
