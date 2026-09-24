const { mongoose } = require("../config/mongo");

const { Schema } = mongoose;

const citationSchema = new Schema(
  {
    fromPublication: {
      type: Schema.Types.ObjectId,
      ref: "Publication",
      required: true,
    },

    toPublication: {
      type: Schema.Types.ObjectId,
      ref: "Publication",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

citationSchema.index(
  { fromPublication: 1, toPublication: 1 },
  { unique: true }
);

module.exports = mongoose.model("Citation", citationSchema);