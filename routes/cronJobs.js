const cron = require("node-cron");
const Wallet = require("../models/Wallet");
const { creditCosts } = require("../Constant");

// Cron job: runs every day at 00:00 UTC  "0 0 * * *"
cron.schedule(
  "0 0 * * *",
  async () => {
    try {
      console.log("Running daily wallet update job...");

      const creditToAdd = 30;

      // Update all wallets in bulk
      await Wallet.updateMany(
        {},
        {
          $inc: {
            credits: creditToAdd,
            "generationsLeft.low": Math.floor(creditToAdd / creditCosts.low),
            "generationsLeft.medium": Math.floor(
              creditToAdd / creditCosts.medium
            ),
            "generationsLeft.high": Math.floor(creditToAdd / creditCosts.high),
          },
        }
      );

      console.log(
        `Successfully added ${creditToAdd} credits and generations to all users`
      );
    } catch (err) {
      console.error("Cron job error:", err);
    }
  },
  {
    scheduled: true,
    timezone: "UTC", // important!
  }
);
