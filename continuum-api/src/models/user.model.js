import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * User represents a SINGLE human execution context.
 * A user owns projects and has exactly one execution state.
 * This model intentionally stays minimal.
 */

const UserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    passwordHash: {
      type: String,
      required: true,
    },

    // --- Execution linkage ---
    // This does NOT store execution rules.
    // It only links the user to their execution state.
    executionStateId: {
      type: Schema.Types.ObjectId,
      ref: "ExecutionState",
      required: true,
    },

    // --- Metadata ---
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
    },

    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    versionKey: false,
  }
);

// Keep updatedAt honest
UserSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model("User", UserSchema);
