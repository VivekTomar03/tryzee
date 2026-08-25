const express = require("express");
const Feedback = require("../models/Feedback");
const auth = require("../middleware/auth");
const feedbackRoutes = express.Router();

feedbackRoutes.post("/", auth, async (req, res) => {
  try {
    const { outputFile, feedback, inputs, feedbackType } = req.body;

    // From the signed token, not the body - otherwise anyone can file feedback
    // under another user's id. Clients may still send `userId`; it is ignored.
    const newFeedback = new Feedback({
      outputFile,
      feedback,
      inputs,
      user: req.user.userId,
      feedbackType,
    });

    const savedFeedback = await newFeedback.save();

    res.status(201).json({
      message: "Feedback submitted successfully",
      feedback: savedFeedback,
    });
  } catch (err) {
    console.error("Error saving feedback:", err);
    res.status(500).json({ message: "Failed to submit feedback" });
  }
});
// GET /feedback/user-feedback/:userId - the caller's own feedback.
// The :userId param is kept for backwards compatibility but is not used.
feedbackRoutes.get("/user-feedback/:userId", auth, async (req, res) => {
  try {
    const feedbacks = await Feedback.find({ user: req.user.userId }).sort({
      createdAt: -1,
    });

    if (!feedbacks || feedbacks.length === 0) {
      return res
        .status(404)
        .json({ message: "No feedback found for this user" });
    }

    res.json(feedbacks);
  } catch (err) {
    console.error("Error fetching feedback by user:", err);
    res.status(500).json({ message: "Failed to get feedbacks" });
  }
});

module.exports = feedbackRoutes;
