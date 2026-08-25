const mongoose = require("mongoose");

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    credits: {
      type: Number,
      default: 0,
    },
    generationsLeft: {
      low: {
        type: Number,
        default: 0,
      },
      medium: {
        type: Number,
        default: 0,
      },
      high: {
        type: Number,
        default: 0,
      },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Wallet", walletSchema);
