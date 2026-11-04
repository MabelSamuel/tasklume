import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function conditionalGet() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Store the original json method
    const originalJson = res.json.bind(res);

    // Override json to add ETag
    res.json = function (body: any) {
      const content = JSON.stringify(body);
      const etag = `"${crypto
        .createHash('md5')
        .update(content)
        .digest('hex')}"`;

      res.setHeader('ETag', etag);

      // Check if client sent If-None-Match
      const clientEtag = req.headers['if-none-match'];
      if (clientEtag === etag) {
        res.status(304).end();
        return res;
      }

      return originalJson(body);
    };

    next();
  };
}
