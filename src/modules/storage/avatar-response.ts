import { InternalServerErrorException } from "@nestjs/common";
import { StorageService } from "./storage.service";

/** Never persist expiring URLs or expose the private storage key. */
export async function resolveAvatar(
  storage: Pick<StorageService, "presignGet">,
  user: {
    id: string;
    avatarUrl?: string | null;
    avatarStorageKey?: string | null;
  },
): Promise<{ avatarUrl: string | null; avatarUrlExpiresAt?: string }> {
  if (!user.avatarStorageKey) return { avatarUrl: user.avatarUrl ?? null };
  if (!StorageService.isAvatarImageKeyOwnedBy(user.avatarStorageKey, user.id)) {
    throw new InternalServerErrorException("Invalid stored avatar key");
  }
  const signed = await storage.presignGet(user.avatarStorageKey);
  return { avatarUrl: signed.url, avatarUrlExpiresAt: signed.expiresAt };
}
