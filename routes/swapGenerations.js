const express = require("express");
const SwapGeneration = require("../models/SwapGeneration");
const Wallet = require("../models/Wallet");
const { creditCosts } = require("../Constant");
const WalletTransaction = require("../models/WalletTransaction");
const auth = require("../middleware/auth");
const swapGenerationsRoute = express.Router();

// POST /api/swap-generations
swapGenerationsRoute.post("/", auth, async (req, res) => {
  try {
    const { outputFile, inputs, mode, url, quality } = req.body;

    // Taken from the signed token, never the body: a body-supplied id would let
    // any caller debit someone else's wallet and write generations as them.
    // Clients may still send `user` - it is ignored.
    const user = req.user.userId;

    // Define credit cost by quality
    const cost = creditCosts[quality];

    if (!cost) {
      return res.status(400).json({ message: "Invalid quality selected" });
    }

    // Fetch user's wallet
    const wallet = await Wallet.findOne({ user });

    if (!wallet) {
      return res.status(404).json({ message: "Wallet not found" });
    }

    // Check if user has enough credits
    if (wallet.credits < cost) {
      return res.status(400).json({ message: "Insufficient credits" });
    }

    // Deduct credits and update generationsLeft
    wallet.credits = wallet.credits - cost;
    // if (wallet.generationsLeft[quality] > 0) {
    //   wallet.generationsLeft[quality] = wallet.generationsLeft[quality] - 1;
    // }
    // todo only 1 generation left minus from total 1 credit === 1 generation
    if (wallet.generationsLeft[quality] > 0) {
      wallet.generationsLeft[quality] = wallet.generationsLeft[quality] - 1;
    }

    // wallet.generationsLeft = {
    //   low: Math.floor(wallet.credits / creditCosts.low),
    //   medium: Math.floor(wallet.credits / creditCosts.medium),
    //   high: Math.floor(wallet.credits / creditCosts.high),
    // };
    const walletSave = await wallet.save();

    // Save the swap generation
    const newSwap = new SwapGeneration({
      outputFile,
      inputs,
      user,
      mode,
      url,
      quality,
    });

    await newSwap.save();

    const transaction = await WalletTransaction.create({
      user: user,
      type: "debit",
      amount: cost,
      description: `Generated ${quality} quality swap`,
      balanceAfter: walletSave.credits,
      relatedSwap: newSwap._id,
      quality: quality,
    });
    res.status(201).json({
      message: "Swap generation saved and credits deducted",
      swap: newSwap,
      wallet: {
        credits: wallet.credits,
        generationsLeft: wallet.generationsLeft,
      },
      transaction,
    });
  } catch (err) {
    console.error("Error saving swap generation:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// GET /api/swap-generations/:userId
// The :userId param is kept for backwards compatibility with existing clients,
// but the history returned is always the caller's own.
swapGenerationsRoute.get("/:userId", auth, async (req, res) => {
  try {
    const swaps = await SwapGeneration.find({ user: req.user.userId }).sort({
      createdAt: -1,
    });

    res.json({ swaps });
  } catch (err) {
    console.error("Error fetching swaps:", err);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

module.exports = swapGenerationsRoute;
