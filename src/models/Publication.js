const { mongoose } = require("../config/mongo");
const { Schema } = mongoose;

const publicationSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    abstract: { type: String, required: true },
    year: { type: Number, required: true, index: true },
    venue: { type: String, required: true, index: true },
    keywords: { type: [String], default: [] },
    // References to Author._id — the many-to-many Author<->Publication edge,
    // embedded here for fast content reads and mirrored as :AUTHORED edges in Neo4j.
    authorIds: [{ type: Schema.Types.ObjectId, ref: "Author", required: true }],
  },
  { timestamps: true }
);

// Compound index supports the "publications per venue per year" aggregation.
publicationSchema.index({ venue: 1, year: 1 });

module.exports = mongoose.model("Publication", publicationSchema);
