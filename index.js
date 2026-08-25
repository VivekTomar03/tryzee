const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const userRoutes = require("./routes/userRoutes");
const feedbackRoutes = require("./routes/feedback");
const swapGenerationsRoute = require("./routes/swapGenerations");
const scrapRoutes = require("./routes/scrape");
const walletRoutes = require("./routes/wallet");
const generateSwapRoute = require("./routes/generateSwap");
const auth = require("./middleware/auth");
const  dns =  require('node:dns');

dns.setServers([
  '1.1.1.1',                  // Cloudflare Public DNS
  '8.8.8.8',                  // Google Public DNS
  '[2001:4860:4860::8888]'    // Google IPv6 DNS
]);
require("./routes/cronJobs");

// Load env variables
dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use("/uploads", express.static("uploads"));
app.use(express.json());

// Use user routes
app.use("/users", userRoutes);
app.use("/feedback", feedbackRoutes);
app.use("/swap-generations", swapGenerationsRoute);
app.use("/scrape-images", scrapRoutes);
app.use("/wallet", walletRoutes);
// Authenticated: every call runs a paid image generation, and credits are only
// debited later by /swap-generations - so an open endpoint is billable by anyone.
app.use("/swap", auth, generateSwapRoute);

// Base route
app.get("/", (req, res) => {
  res.send("Try It Extension Backend is running 🚀");
});

// Connect to MongoDB
const dbReady = mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
  });

/**
 * Vercel runs this file as a serverless function and needs the app exported —
 * calling listen() there would hang the build. Everywhere else (local dev, the
 * existing long-running deployment) still starts a real server, and still waits
 * for Mongo first so requests never hit a disconnected DB.
 */
if (process.env.VERCEL) {
  module.exports = app;
} else {
  dbReady.then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server is running on http://localhost:${PORT}`);
    });
  });
}
