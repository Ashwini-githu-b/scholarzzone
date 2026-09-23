const { mongoose } = require("../config/mongo");
const { Schema } = mongoose;

const authorSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    institutionId: { type: Schema.Types.ObjectId, ref: "Institution", required: true },
    bio: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Author", authorSchema);
