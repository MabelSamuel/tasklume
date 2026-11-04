// Properties our middleware attaches to every request
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; tier: string }; // set by authenticate
      correlationId?: string;              // set by requestLogger
      fingerprint?: string;                // set by attachFingerprint
      rawBody?: Buffer;                    // set by express.raw on /webhooks
    }
  }
}

export {};
