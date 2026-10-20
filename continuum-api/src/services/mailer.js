// src/services/mailer.js
//
// Email from Continuum to its own team (a new callback request). It sends
// only when SMTP_PASSWORD is set (a secret: for Gmail, an app password of
// the sending account); without it nothing is sent and nothing fails.
//
//   SMTP_PASSWORD        the secret (unset: no email)
//   SMTP_USER            the account that sends (default continuum.console@gmail.com)
//   SMTP_HOST/SMTP_PORT  default smtp.gmail.com, 465 (TLS)
//   TEAM_EMAIL           who receives it (default continuum.console@gmail.com)

import nodemailer from "nodemailer";

export const TEAM_EMAIL_DEFAULT = "continuum.console@gmail.com";

let transport = null;

/** Can Continuum send email here? */
export const mailConfigured = () => Boolean(process.env.SMTP_PASSWORD);

function transporter() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER || TEAM_EMAIL_DEFAULT, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transport;
}

/** An email to the team: { subject, text, replyTo? }. Resolves false when mail isn't set up. */
export async function mailTeam({ subject, text, replyTo }) {
  if (!mailConfigured()) return false;
  const from = process.env.SMTP_USER || TEAM_EMAIL_DEFAULT;
  await transporter().sendMail({ from: `Continuum <${from}>`, to: process.env.TEAM_EMAIL || TEAM_EMAIL_DEFAULT, subject, text, ...(replyTo ? { replyTo } : {}) });
  return true;
}
