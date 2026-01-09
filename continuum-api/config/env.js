// src/config/env.js

export const ENV = {
  PORT: process.env.PORT || 4000,

  MONGO_URI:
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017",

  DB_NAME:
    process.env.DB_NAME || "continuum",

  CLIENT_ORIGIN:
    process.env.CLIENT_ORIGIN || "http://localhost:5173",
};
