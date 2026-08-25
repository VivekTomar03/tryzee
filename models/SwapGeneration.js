const mongoose = require("mongoose");

const swapGenerationSchema = new mongoose.Schema(
  {
    outputFile: {
      type: String,
      required: true,
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
    mode: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    quality: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SwapGeneration", swapGenerationSchema);
