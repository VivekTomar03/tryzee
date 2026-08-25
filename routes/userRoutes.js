const express = require("express");
const bcrypt = require("bcrypt");
const multer = require("multer");
const User = require("../models/User");
const upload = require("../middleware/upload");
const jwt = require("jsonwebtoken");
const dotenv = require("dotenv");
const auth = require("../middleware/auth");
const Wallet = require("../models/Wallet");
const { creditCosts } = require("../Constant");
const WalletTransaction = require("../models/WalletTransaction");
const { OAuth2Client } = require("google-auth-library");
const cloudinary = require("../config/cloudinary");
const axios = require("axios");
const streamifier = require("streamifier");
dotenv.config();
const userRoutes = express.Router();

// /api/users/register
userRoutes.post("/register", upload.single("frontPose"), async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, age, gender } =
      req.body;
    console.log(req.body);
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Prepare frontPose URL if uploaded
    const frontPoseUrl = req.file?.path || null; // Cloudinary image URL

    // Create user
    const newUser = new User({
      firstName,
      lastName,
      email,
      phone,
      password: hashedPassword,
      frontPoseUrl,
      isSignUp: true,
      age,
      gender,
    });

    const user = await newUser.save();
    // Create wallet after user registration
    const wallet = await Wallet.create({
      user: newUser._id,
      credits: 50, // signup bonus
      generationsLeft: {
        low: Math.floor(50 / creditCosts.low), // 3 low-quality generations
        medium: Math.floor(50 / creditCosts.medium), // 2 medium-quality generations
        high: Math.floor(50 / creditCosts?.high), // 1 high-quality generation
      },
    });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });
    await WalletTransaction.create({
      user: user._id,
      type: "credit",
      amount: 50,
      description: "Signup bonus",
      balanceAfter: wallet.credits,
    });
    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        phone: newUser.phone,
        frontPoseUrl: newUser.frontPoseUrl,
        isSignUp: true,
        age: newUser?.age,
        gender: newUser?.gender,
      },
      wallet,
    });
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
// /api/users/login
userRoutes.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find user
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "Invalid email or password" });

    // 2. Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(400).json({ message: "Invalid email or password" });

    // 3. Generate JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    // 4. Return token + user info
    res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        frontPoseUrl: user.frontPoseUrl,
        age: user?.age,
        gender: user?.gender,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
// GET /api/users/me
userRoutes.get("/me", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password"); // exclude password

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user });
  } catch (err) {
    console.error("Get user details error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
// DELETE /api/users/me
userRoutes.delete("/me", auth, async (req, res) => {
  try {
    const deletedUser = await User.findByIdAndDelete(req.user.userId);

    if (!deletedUser) {
      return res
        .status(404)
        .json({ message: "User not found or already deleted" });
    }

    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete user error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/users/me (update profile)
userRoutes.put("/me", auth, upload.single("frontPose"), async (req, res) => {
  const { firstName, lastName, email, phone, age, gender } = req.body;

  // Check if required fields are provided
  if (!firstName || !lastName || !email) {
    return res
      .status(400)
      .json({ message: "First name, last name, and email are required" });
  }

  try {
    // Find the user
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update the user's fields
    user.firstName = firstName;
    user.lastName = lastName;
    user.email = email;
    user.phone = phone || user.phone; // If phone is not provided, keep existing value
    user.age = age;
    user.gender = gender;

    // Handle profile picture (if provided)
    if (req.file?.path) {
      user.frontPoseUrl = req.file?.path || null;
    }

    // Save updated user
    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        frontPoseUrl: user.frontPoseUrl,
        age: user.age,
        gender: user.gender,
      },
    });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ message: err.message });
  }
});
// POST /api/users/forgot-password
function generateOTP(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) {
    otp += Math.floor(Math.random() * 10); // Generate a random digit between 0-9
  }
  return otp;
}

userRoutes.post("/forgot-password", async (req, res) => {
  const { email } = req.body;

  // Check if email is provided
  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate OTP
    const otp = generateOTP(6); // Generate a 6-digit OTP

    // Store OTP temporarily (in the user document, with an expiry time)
    user.otp = otp;
    user.otpExpiry = Date.now() + 3600000; // OTP expires in 1 hour
    await user.save();

    // Send OTP in the response (for now, just for testing purposes)
    res.json({ message: "OTP has been generated", otp: otp });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// PUT /api/users/reset-password
userRoutes.put("/reset-password", async (req, res) => {
  const { email, otp, newPassword } = req.body;

  // Validate OTP and new password
  if (!otp || !newPassword) {
    return res
      .status(400)
      .json({ message: "OTP and new password are required" });
  }

  try {
    // Find the user by email and check OTP validity
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if OTP is correct and not expired
    if (user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Set new password and clear OTP
    user.password = hashedPassword;
    user.otp = undefined; // Clear OTP after use
    user.otpExpiry = undefined; // Clear OTP expiry time
    await user.save();

    res.json({ message: "Password has been reset successfully" });
  } catch (err) {
    console.error("Reset password error:", err);
    res.status(500).json({ message: "Server error" });
  }
});
userRoutes.post("/check-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // 1. Check if user exists
    const user = await User.findOne({ email });

    if (user) {
      return res.status(400).json({ message: "Email already exists" });
    }

    // Email is available
    res.json({ message: "Email is available" });
  } catch (err) {
    console.error("check-email error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// 🔹 Google OAuth login

userRoutes.post("/google", upload.single("frontPose"), async (req, res) => {
  try {
    const { idToken, age, gender, password } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "Missing Google idToken" });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, given_name, family_name, picture, sub } = payload;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    let wallet;

    let frontPoseUrl = null;

    if (!user) {
      if (req.file) {
        // If file uploaded manually
        frontPoseUrl = req.file.path;
      } else if (picture) {
        // Upload Google picture to Cloudinary
        const response = await axios.get(picture, {
          responseType: "arraybuffer",
        });
        const buffer = Buffer.from(response.data, "binary");

        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "google-profiles" },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          streamifier.createReadStream(buffer).pipe(uploadStream);
        });

        frontPoseUrl = result.secure_url;
      }
    }
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    if (!user) {
      // Create new user
      user = await User.create({
        firstName: given_name || "",
        lastName: family_name || "",
        email,
        frontPoseUrl: frontPoseUrl || null,
        isOAuth: true,
        oauthProvider: "google",
        oauthId: sub,
        isSignUp: true,
        gender,
        password: hashedPassword,
        age,
      });

      // Create wallet with signup bonus
      wallet = await Wallet.create({
        user: user._id,
        credits: 50,
        generationsLeft: {
          low: Math.floor(50 / creditCosts.low),
          medium: Math.floor(50 / creditCosts.medium),
          high: Math.floor(50 / creditCosts.high),
        },
      });

      await WalletTransaction.create({
        user: user._id,
        type: "credit",
        amount: 50,
        description: "Signup bonus (Google)",
        balanceAfter: wallet.credits,
      });
    } else {
      return res.status(400).json({
        message:
          "User already exists. Please login using your email and password.",
      });
    }

    // Issue JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    res.json({
      message: "Google login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        frontPoseUrl: user.frontPoseUrl,
        isSignUp: user.isSignUp,
        gender: user.gender,

        age: user.age,
      },
      wallet,
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
userRoutes.post("/google/login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "Missing Google idToken" });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, given_name, family_name, picture, sub } = payload;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    let wallet;

    if (user) {
      wallet = await Wallet.findOne({ user: user._id });
    } else {
      return res
        .status(400)
        .json({ message: "User not found. Please sign up first." });
    }

    // Issue JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    res.json({
      message: "Google login successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        frontPoseUrl: user.frontPoseUrl,
        isSignUp: user.isSignUp,
        gender: user.gender,

        age: user.age,
      },
      wallet,
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
userRoutes.post("/google/verify", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ message: "Missing Google idToken" });
    }

    // Verify Google token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, given_name, family_name, picture, sub } = payload;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }
    const user = await User.findOne({ email });

    if (user) {
      // User exists - log them in directly
      const wallet = await Wallet.findOne({ user: user._id });
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      return res.json({
        message: "Google login successful",
        isExistingUser: true,
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          frontPoseUrl: user.frontPoseUrl,
          isSignUp: user.isSignUp,
          gender: user.gender,
          age: user.age,
        },
        wallet,
      });
    }

    res.json({
      message: "Google login email verify",
      isExistingUser: false,
      user: {
        email,
        given_name,
        family_name,
        picture,
        sub,
      },
    });
  } catch (err) {
    console.error("Google login error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
// google for extension
userRoutes.post("/google/login-extension", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: "Missing Google accessToken" });
    }

    // Fetch user info from Google using accessToken
    const response = await axios.get(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const { email, given_name, family_name, picture, id: sub } = response.data;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }

    // Check if user already exists
    let user = await User.findOne({ email });
    let wallet;

    if (user) {
      wallet = await Wallet.findOne({ user: user._id });
    } else {
      return res
        .status(400)
        .json({ message: "User not found. Please sign up first." });
    }

    // Issue JWT
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    });

    res.json({
      message: "Google login (extension) successful",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        frontPoseUrl: user.frontPoseUrl,
        isSignUp: user.isSignUp,
        gender: user.gender,

        age: user.age,
      },
      wallet,
    });
  } catch (err) {
    console.error("Google login (extension) error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
userRoutes.post("/google/verify-extension", async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: "Missing Google accessToken" });
    }

    // Fetch user info from Google using accessToken
    const response = await axios.get(
      "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    const { email, given_name, family_name, picture, id: sub } = response.data;

    if (!email) {
      return res.status(400).json({ message: "Google account has no email" });
    }

    const user = await User.findOne({ email });

    if (user) {
      // return res.status(400).json({ message: "Email already exists" });
       // User exists - log them in directly
      const wallet = await Wallet.findOne({ user: user._id });
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      return res.json({
        message: "Google login successful",
        isExistingUser: true,
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          frontPoseUrl: user.frontPoseUrl,
          isSignUp: user.isSignUp,
          gender: user.gender,
          age: user.age,
        },
        wallet,
      });
    }

    res.json({
      message: "Google login email verify (extension)",
      user: {
        email,
        given_name,
        family_name,
        picture,
        sub,
      },
    });
  } catch (err) {
    console.error("Google login (extension) error:", err.message);
    res.status(500).json({ message: err.message });
  }
});
userRoutes.post(
  "/google/extension-signup",
  upload.single("frontPose"),
  async (req, res) => {
    try {
      const { accessToken, age, gender, password } = req.body;
      if (!accessToken) {
        return res.status(400).json({ message: "Missing Google accessToken" });
      }

      // Fetch user info from Google using accessToken
      const response = await axios.get(
        "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      const {
        email,
        given_name,
        family_name,
        picture,
        id: sub,
      } = response.data;

      if (!email) {
        return res.status(400).json({ message: "Google account has no email" });
      }

      // Check if user already exists
      let user = await User.findOne({ email });
      let wallet;

      let frontPoseUrl = null;

      if (!user) {
        if (req.file) {
          // If file uploaded manually
          frontPoseUrl = req.file.path;
        } else if (picture) {
          // Upload Google picture to Cloudinary
          const imageRes = await axios.get(picture, {
            responseType: "arraybuffer",
          });
          const buffer = Buffer.from(imageRes.data, "binary");

          const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
              { folder: "google-profiles" },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
            streamifier.createReadStream(buffer).pipe(uploadStream);
          });

          frontPoseUrl = result.secure_url;
        }
      }
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      if (!user) {
        // Create new user
        user = await User.create({
          firstName: given_name || "",
          lastName: family_name || "",
          email,
          frontPoseUrl: frontPoseUrl || null,
          isOAuth: true,
          oauthProvider: "google",
          oauthId: sub,
          isSignUp: true,
          gender,
          password: hashedPassword,
          age,
        });

        // Create wallet with signup bonus
        wallet = await Wallet.create({
          user: user._id,
          credits: 50,
          generationsLeft: {
            low: Math.floor(50 / creditCosts.low),
            medium: Math.floor(50 / creditCosts.medium),
            high: Math.floor(50 / creditCosts.high),
          },
        });

        await WalletTransaction.create({
          user: user._id,
          type: "credit",
          amount: 50,
          description: "Signup bonus (Google)",
          balanceAfter: wallet.credits,
        });
      } else {
        return res.status(400).json({
          message:
            "User already exists. Please login using your email and password.",
        });
      }

      // Issue JWT
      const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      res.json({
        message: "Google login (extension) successful",
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          frontPoseUrl: user.frontPoseUrl,
          isSignUp: user.isSignUp,
          gender,
          age,
        },
        wallet,
      });
    } catch (err) {
      console.error("Google login (extension) error:", err.message);
      res.status(500).json({ message: err.message });
    }
  }
);
module.exports = userRoutes;
