import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { badRequest, DataError } from "./errors.js";

/**
 * Tokens for sources (spec 2.10), sealed with AES-256-GCM under
 * DATA_SECRET_KEY. Only the last four characters are ever shown back; the
 * clear value is opened only by the worker, for the step that needs it, and
 * is never stored on the run or written to a log.
 */
export const KINDS = {
  kaggle: {
    label: "Kaggle",
    // "username:key", as in kaggle.json; checked loosely so a pasted file also works
    parse(value) {
      let v = String(value ?? "").trim();
      if (v.startsWith("{")) {
        try {
          const j = JSON.parse(v);
          v = `${j.username}:${j.key}`;
        } catch {
          throw badRequest("That doesn't look like a kaggle.json file.", "BAD_CREDENTIAL");
        }
      }
      if (!/^[A-Za-z0-9_.-]{1,100}:[A-Za-z0-9]{16,64}$/.test(v)) throw badRequest("Paste your Kaggle username and key as username:key, or the whole kaggle.json file.", "BAD_CREDENTIAL");
      return v;
    },
  },
  huggingface: {
    label: "Hugging Face",
    parse(value) {
      const v = String(value ?? "").trim();
      if (!/^hf_[A-Za-z0-9]{20,100}$/.test(v)) throw badRequest("A Hugging Face token starts with hf_.", "BAD_CREDENTIAL");
      return v;
    },
  },
};

const keyOf = (secret) => createHash("sha256").update(`continuum-data/credentials\n${secret}`).digest();

export function seal(secret, value) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const body = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}.${c.getAuthTag().toString("base64url")}`;
}

export function open(secret, sealed) {
  const [v, iv, body, tag] = String(sealed).split(".");
  if (v !== "v1") throw new Error("unknown seal");
  const d = createDecipheriv("aes-256-gcm", keyOf(secret), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

export function credentialStore(db, secret) {
  const col = db.collection("credentials");
  const need = () => {
    if (!secret) throw new DataError(503, "NO_SECRET_KEY", "Saving tokens isn't switched on here (DATA_SECRET_KEY is not set).");
  };
  return {
    async put(userId, kind, value) {
      need();
      const spec = KINDS[kind];
      if (!spec) throw badRequest("Continuum doesn't keep that kind of token.", "BAD_KIND");
      const clear = spec.parse(value);
      const now = new Date();
      await col.updateOne({ userId, kind }, { $set: { sealed: seal(secret, clear), hint: clear.slice(-4), updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
      return { kind, label: spec.label, hint: clear.slice(-4), updatedAt: now };
    },
    remove: (userId, kind) => col.deleteOne({ userId, kind }),
    async list(userId) {
      const docs = await col.find({ userId }, { projection: { sealed: 0 } }).toArray();
      return Object.keys(KINDS).map((kind) => {
        const d = docs.find((x) => x.kind === kind);
        return { kind, label: KINDS[kind].label, saved: Boolean(d), hint: d?.hint ?? null, updatedAt: d?.updatedAt ?? null };
      });
    },
    /** The clear value, for the worker only. */
    async reveal(userId, kind) {
      need();
      const d = await col.findOne({ userId, kind });
      return d ? open(secret, d.sealed) : null;
    },
  };
}
