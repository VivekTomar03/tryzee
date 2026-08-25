const express = require("express");
const walletRoutes = express.Router();
const Wallet = require("../models/Wallet");
const auth = require("../middleware/auth");
const crypto = require("crypto");
const razorpay = require("../config/razorpay");
const WalletTransaction = require("../models/WalletTransaction");
const { creditCosts } = require("../Constant");
walletRoutes.get("/", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: No user ID found" });
    }

    const wallet = await Wallet.findOne({ user: userId });

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    res.json({
      message: "Wallet fetched successfully",
      wallet: {
        credits: wallet.credits,
        generationsLeft: wallet.generationsLeft,
      },
    });
  } catch (err) {
    console.error("Wallet fetch error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

/// RAZORPAY  add credit
walletRoutes.post("/create-order", async (req, res) => {
  const { amountInINR, userId } = req.body;
  const shortUserId = userId.toString().slice(-6);
  const receipt = `wallet-${shortUserId}-${Date.now()}`.slice(0, 40);
  const options = {
    amount: amountInINR * 100, // paise
    currency: "INR",
    receipt: receipt, //onl;y accept 40charter
  };

  try {
    const order = await razorpay.orders.create(options);
    return res.status(200).json({ order });
  } catch (err) {
    console.error("Order creation error:", err);
    return res.status(500).json({ message: "Could not create order" });
  }
});

//verify payments

walletRoutes.post("/verify-payment", async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    amountInINR,
    userId,
  } = req.body;
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return res.status(400).json({ message: "Invalid signature" });
  }
  try {
    const creditsToAdd = amountInINR;

    // Fetch wallet before update
    let wallet = await Wallet.findOne({ user: userId });

    if (!wallet) {
      // Create a wallet if not exists
      wallet = await Wallet.create({
        user: userId,
        credits: creditsToAdd,
        generationsLeft: {
          low: Math.floor(creditsToAdd / creditCosts.low),
          medium: Math.floor(creditsToAdd / creditCosts.medium),
          high: Math.floor(creditsToAdd / creditCosts.high),
        },
      });
    } else {
      // Add credits
      wallet.credits += creditsToAdd;

      // Recalculate generationsLeft based on total credits
      wallet.generationsLeft.low = Math.floor(wallet.credits / creditCosts.low);
      wallet.generationsLeft.medium = Math.floor(
        wallet.credits / creditCosts.medium
      );
      wallet.generationsLeft.high = Math.floor(
        wallet.credits / creditCosts.high
      );

      await wallet.save();
    }

    // Record the transaction
    await WalletTransaction.create({
      user: userId,
      type: "credit",
      amount: creditsToAdd,
      description: "Wallet recharge via Razorpay",
      balanceAfter: wallet.credits,
    });

    res.status(200).json({
      message: "Wallet updated based on total credits",
      wallet: {
        credits: wallet.credits,
        generationsLeft: wallet.generationsLeft,
      },
    });
  } catch (error) {
    console.error("Error updating wallet:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});
//wallet transactions
walletRoutes.get("/transactions", auth, async (req, res) => {
  try {
    const userId = req.user.userId;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: No user ID found" });
    }

    // Fetch transactions with pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const transactions = await WalletTransaction.find({ user: userId })
      .sort({ createdAt: -1 }) // Sort by newest first
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const totalTransactions = await WalletTransaction.countDocuments({
      user: userId,
    });

    res.json({
      message: "Transactions fetched successfully",
      transactions,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalTransactions / limit),
        totalTransactions,
        hasMore: skip + transactions.length < totalTransactions,
      },
    });
  } catch (err) {
    console.error("Fetch transactions error:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
module.exports = walletRoutes;
