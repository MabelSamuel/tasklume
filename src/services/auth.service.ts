import { appEvents } from "../lib/events";
import { AUTH_EVENTS } from "../events/auth.events";
import { prisma } from "../lib/prisma";
import { hashPassword, verifyPassword } from "../lib/password";
import { ConflictError, UnauthorizedError } from "../lib/errors";
import { userRepository } from "../repositories/user.repository";
import {
  generateAccessToken,
  generateRefreshToken,
  getTokenExpiry,
  hashToken,
  verifyRefreshToken,
} from "../lib/tokens";

interface ClientInfo {
  deviceInfo?: string | undefined;
  fingerprint?: string | undefined;
}

// Issue an access/refresh pair and persist the refresh token hash
async function issueTokens(user: { id: string; tier: string }) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: hashToken(refreshToken),
      expiresAt: getTokenExpiry(refreshToken),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(data: {
  name: string;
  email: string;
  password: string;
}) {
  const email = data.email.toLowerCase().trim();

  const existing = await userRepository.findByEmail(email);
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await hashPassword(data.password);

  // Create the user and their default role atomically
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: { name: data.name.trim(), email, passwordHash },
    });

    const defaultRole = await tx.role.findFirst({ where: { isDefault: true } });
    if (defaultRole) {
      await tx.userRole.create({
        data: { userId: created.id, roleId: defaultRole.id },
      });
    }

    return created;
  });

  // Emit and move on. Don't wait for listeners.
  appEvents.emit(AUTH_EVENTS.USER_REGISTERED, {
    id: user.id,
    email: user.email,
    tier: user.tier,
  });

  return { id: user.id, name: user.name, email: user.email, tier: user.tier };
}

export async function login(data: { email: string; password: string } & ClientInfo) {
  const user = await userRepository.findByEmail(data.email.toLowerCase().trim());

  const valid = user?.isActive
    ? await verifyPassword(data.password, user.passwordHash)
    : false;

  if (!user || !valid) {
    appEvents.emit(AUTH_EVENTS.LOGIN_FAILED, {
      email: data.email,
      deviceInfo: data.deviceInfo,
      fingerprint: data.fingerprint,
      reason: user ? "wrong_password" : "user_not_found",
    });
    // Same message either way so attackers can't enumerate emails
    throw new UnauthorizedError("Invalid credentials");
  }

  const tokens = await issueTokens(user);

  appEvents.emit(AUTH_EVENTS.USER_LOGGED_IN, {
    userId: user.id,
    deviceInfo: data.deviceInfo,
  });

  return {
    ...tokens,
    user: { id: user.id, name: user.name, email: user.email, tier: user.tier },
  };
}

export async function refresh(rawRefreshToken: string) {
  // Verify the JWT signature and expiration
  let payload;
  try {
    payload = verifyRefreshToken(rawRefreshToken);
  } catch {
    throw new UnauthorizedError("Invalid refresh token");
  }

  if (payload.type !== "refresh") {
    throw new UnauthorizedError("Invalid token type");
  }

  // Check the token exists in the database (not revoked / already rotated)
  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new UnauthorizedError("Refresh token expired or revoked");
  }

  const user = await userRepository.findById(payload.sub);
  if (!user || !user.isActive) {
    throw new UnauthorizedError("User not found or inactive");
  }

  // Rotate: delete the old token, issue a new pair
  await prisma.refreshToken.delete({ where: { token: tokenHash } });
  const tokens = await issueTokens(user);

  appEvents.emit(AUTH_EVENTS.TOKEN_REFRESHED, { userId: user.id });

  return tokens;
}

export async function logout(rawRefreshToken: string) {
  // Delete the token. If it doesn't exist, that's fine.
  await prisma.refreshToken.deleteMany({
    where: { token: hashToken(rawRefreshToken) },
  });
}
