import { Request, Response } from "express";
import * as authService from "../services/auth.service";

// Controllers translate HTTP <-> service calls. No business logic here.
// Express 5 forwards rejected promises to the error handler automatically.

export async function register(req: Request, res: Response) {
  const user = await authService.register(req.body);
  res.status(201).json({ success: true, data: user });
}

export async function login(req: Request, res: Response) {
  const result = await authService.login({
    ...req.body,
    deviceInfo: req.headers["user-agent"],
    fingerprint: req.fingerprint,
  });
  res.json({ success: true, data: result });
}

export async function refresh(req: Request, res: Response) {
  const tokens = await authService.refresh(req.body.refreshToken);
  res.json({ success: true, data: tokens });
}

export async function logout(req: Request, res: Response) {
  await authService.logout(req.body.refreshToken);
  res.status(204).send();
}
