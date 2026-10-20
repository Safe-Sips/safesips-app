import nodemailer, { type Transporter } from "nodemailer";
import { config } from "./config.js";

/** Lazily-created SMTP transport (null when SMTP isn't configured). */
let transporter: Transporter | null = null;
let transporterInit = false;

export function getMailTransport(): Transporter | null {
  if (transporterInit) return transporter;
  transporterInit = true;
  if (!config.smtp) return null;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transporter;
}

/** True when the server can actually send email (SMTP_HOST is set). */
export function isEmailDeliveryConfigured(): boolean {
  return getMailTransport() !== null;
}

/** Replace the transport (tests use nodemailer's jsonTransport). */
export function setMailTransport(t: Transporter | null): void {
  transporter = t;
  transporterInit = true;
}
