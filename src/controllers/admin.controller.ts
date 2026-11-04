import { Request, Response } from "express";
import * as rbacService from "../services/rbac.service";
import { computeInsights } from "../services/insights.service";

export async function getInsights(req: Request, res: Response) {
  const insights = await computeInsights(undefined, Number(req.query.days));
  res.json({ success: true, data: insights });
}

export async function listRoles(req: Request, res: Response) {
  const roles = await rbacService.listRoles();
  res.json({ success: true, data: roles });
}

export async function assignRole(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const { roleName } = req.body;
  await rbacService.assignRole(userId, roleName, req.user!.id);
  res.json({
    success: true,
    data: { message: `Role '${roleName}' assigned to user` },
  });
}

export async function revokeRole(req: Request, res: Response) {
  const userId = req.params.userId as string;
  const roleName = req.params.roleName as string;
  await rbacService.revokeRole(userId, roleName, req.user!.id);
  res.json({
    success: true,
    data: { message: `Role '${roleName}' revoked` },
  });
}
