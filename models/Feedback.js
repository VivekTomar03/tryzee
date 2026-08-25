const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    outputFile: {
      type: String,
      required: true,
    },
    feedback: {
      type: String,
      // required: true,
    },
    inputs: {
      type: Object,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    feedbackType: {
      type: String,
      enum: ["like", "dislike", "neutral"],
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Feedback", feedbackSchema);
