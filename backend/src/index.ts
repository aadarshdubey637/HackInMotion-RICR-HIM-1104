import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { config, features, isDevelopment, isProduction } from './config';
import { logger } from './common/logger';
import { prisma } from './common/prisma';
import { closeMailer, verifyMailer } from './common/mailer';
import { errorHandler, notFoundHandler } from './common/error-handler';
import { apiRouter } from './routes';

const app = express();

// Behind Render/Vercel/NGINX the client IP arrives via X-Forwarded-For.
// Without this, rate limiting would bucket every user together.
app.set('trust proxy', 1);

app.use(
  helmet({
    // Uploaded crop photos are served to a different origin (the frontend).
    crossOriginResourcePolicy: { policy: 'cross-origin' },

    /**
     * This server returns JSON and image bytes — never HTML that a browser
     * will execute. So the policy can be close to "nothing is allowed": there
     * is no script, style or frame for it to permit.
     *
     * It was previously disabled outright. That is a different thing from
     * being unnecessary: without a policy, any HTML that does get served —
     * an error page from a dependency, a future admin view — inherits the
     * browser's permissive default. The frontend's own CSP is separate and
     * does not cover this origin.
     */
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        // Photos are streamed from this origin by the crop-health route.
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
  }),
);

// Allow the configured frontend plus local development origins.
const allowedOrigins = new Set(
  [config.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'].filter(Boolean),
);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin / curl / server-to-server requests have no Origin header.
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(cookieParser());

// Crop photos are NOT served statically from here. They are a farmer's private
// record, so they go through GET /api/crop-health/photo/:filename, which
// authenticates the request and checks farm ownership before streaming.

app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: isProduction ? 300 : 2000,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests. Please wait a moment.' },
    },
  }),
);

app.use((req, _res, next) => {
  logger.debug({ method: req.method, path: req.path }, 'request');
  next();
});

/** Liveness probe. Also reports whether the database is reachable. */
app.get('/api/health', async (_req, res) => {
  let database = 'unknown';
  try {
    // Cheap round-trip that works on MongoDB.
    await prisma.user.count();
    database = 'connected';
  } catch {
    database = 'unreachable';
  }

  res.status(database === 'connected' ? 200 : 503).json({
    success: database === 'connected',
    data: {
      status: database === 'connected' ? 'ok' : 'degraded',
      database,
      environment: config.NODE_ENV,
      timestamp: new Date().toISOString(),
    },
  });
});

app.use('/api', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  logger.info(`Smart Farm DSS API listening on port ${config.PORT} (${config.NODE_ENV})`);

  // Prove the Gmail App Password actually authenticates, rather than finding out
  // when the first farmer requests a code and silently never receives it. Not
  // awaited and never fatal: a dead mailbox costs email verification, not the
  // whole server.
  if (features.email) {
    void verifyMailer();
  } else if (isDevelopment) {
    // Distinguished from the production case below because the consequence is
    // different: verification still works here, it just arrives in this log
    // rather than an inbox. Saying "disabled" would send someone hunting for a
    // broken feature that is working as intended.
    logger.warn(
      'EMAIL_USER / EMAIL_APP_PASSWORD not set — verification codes will be printed to this log instead of emailed',
    );
  } else {
    logger.warn('EMAIL_USER / EMAIL_APP_PASSWORD not set — email verification is disabled');
  }
});

/** Close connections cleanly so in-flight requests are not cut off. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    // The pooled SMTP socket is a live handle; leaving it open makes this
    // shutdown wait out the force-exit timer below instead of ending cleanly.
    closeMailer();
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  });
  // Force exit if graceful close stalls.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

export default app;
