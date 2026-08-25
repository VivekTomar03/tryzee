const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    password: {
      type: String,
      // required: true,
      minlength: 8,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    age: {
      type: String,
      // required: true,
      trim: true,
      validate: {
        validator: function (v) {
          const num = parseInt(v, 10);
          return !isNaN(num) && num >= 1 && num <= 120;
        },
        message: "Age must be a between 1 and 120",
      },
    },
    gender: {
      type: String,
      // required: true,
      trim: true,
      enum: ["Male", "Female", "Other"],
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    frontPoseUrl: {
      type: String, // e.g., /uploads/filename.jpg
      required: false,
    },
    otp: {
      type: String,
      required: false,
    },
    otpExpiry: {
      type: Date,
      required: false,
    },
    isSignUp: {
      type: Boolean,
      required: false,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
