const { mongoose } = require("../config/mongo");

const { Schema } = mongoose;

const researchProjectSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      default: "",
    },

    authorIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Author",
      },
    ],

    institutionId: {
      type: Schema.Types.ObjectId,
      ref: "Institution",
      required: true,
    },

    year: {
      type: Number,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

researchProjectSchema.index({ institutionId: 1, year: 1 });

module.exports = mongoose.model("ResearchProject", researchProjectSchema);