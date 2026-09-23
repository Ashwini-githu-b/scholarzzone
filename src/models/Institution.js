const { mongoose } = require("../config/mongo");
const { Schema } = mongoose;

const institutionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    country: { type: String, required: true },
    type: { type: String, enum: ["University", "Research Lab", "Industry"], required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Institution", institutionSchema);
