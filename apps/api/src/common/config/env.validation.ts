import Joi from 'joi';

/**
 * Joi schema for all required / recommended environment variables.
 *
 * `allowUnknown: true` — extra env vars (NODE_ENV, PATH, etc.) are permitted.
 * `abortEarly: false` — report ALL missing vars at once, not just the first.
 *
 * The app will throw and refuse to start if any required var is missing,
 * rather than crashing silently mid-request with a cryptic Prisma error.
 */
export const envValidationSchema = Joi.object({
  // -- Database --------------------------------------------------------------
  DATABASE_URL: Joi.string().uri().required()
    .description('PostgreSQL connection string (pooled). Required.'),

  DIRECT_URL: Joi.string().uri().required()
    .description('PostgreSQL direct connection string (for migrations). Required.'),

  // -- JWT ------------------------------------------------------------------
  JWT_ACCESS_SECRET: Joi.string().min(32).required()
    .description('Secret used to sign access tokens. Must be >= 32 characters.'),

  JWT_REFRESH_SECRET: Joi.string().min(32).required()
    .description('Secret used to sign refresh tokens. Must be >= 32 characters.'),

  JWT_EXPIRES_IN: Joi.string().default('15m')
    .description('Access token TTL (e.g. 15m, 1h). Defaults to 15m.'),

  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d')
    .description('Refresh token TTL (e.g. 7d). Defaults to 7d.'),

  // -- Server ---------------------------------------------------------------
  PORT: Joi.number().integer().min(1).max(65535).default(3001)
    .description('HTTP port the API listens on. Defaults to 3001.'),

  ALLOWED_ORIGINS: Joi.string().default('http://localhost:3000')
    .description('Comma-separated list of allowed CORS origins.'),

  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // -- Mail (Resend) --------------------------------------------------------
  // Loose string validation on all three: Railway may supply MAIL_FROM in
  // display-name format ("Name <addr@host>") or APP_URL behind a proxy path
  // that would fail strict .email() / .uri() checks and block startup.
  RESEND_API_KEY: Joi.string().optional()
    .description('Resend API key for transactional email. Optional - mail is silently skipped if absent.'),

  MAIL_FROM: Joi.string().default('noreply@clerque.app')
    .description('Sender address for all outbound emails. Defaults to noreply@clerque.app.'),

  APP_URL: Joi.string().default('http://localhost:3000')
    .description('Public URL of the frontend app - used in email links (reset password, payslips).'),
});
