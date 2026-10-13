import { fail, ok } from "../../utils/common";
import { FileMetadata, PhotoFolder } from "../../utils/types";
import { getKVBinding } from "../../utils/cloudflare-bindings";
import {
  albumIndexReadyKey,
  albumMediaPrefix,
  getPhotoFolder,
  listPhotoFolders,
  MAX_PHOTO_FOLDER_NAME_LENGTH,
  normalizePhotoFolderName,
  photoFolderKey,
  ensureAlbumMediaIndex,
} from "../../utils/photo-folders";

export async function onRequestPatch({ request, params, env }: any) {
  const kv = getKVBinding(env);
  const folderId = params.id as string;

  try {
    const folder = await getPhotoFolder(kv, folderId);
    if (!folder) return fail("Album not found", 404);

    const body = await request.json();
    const updated: PhotoFolder = { ...folder, updatedAt: Date.now() };

    if (body?.name !== undefined) {
      const name = normalizePhotoFolderName(body.name);
      if (!name) {
        return fail(
          `Album name must be between 1 and ${MAX_PHOTO_FOLDER_NAME_LENGTH} characters`,
          400,
        );
      }

      const folders = await listPhotoFolders(kv);
      if (
        folders.some(
          (candidate) =>
            candidate.id !== folderId &&
            candidate.name.toLowerCase() === name.toLowerCase(),
        )
      ) {
        return fail("An album with this name already exists", 409);
      }
      updated.name = name;
    }

    if (body?.coverKey !== undefined) {
      if (body.coverKey === null) {
        updated.coverKey = null;
      } else if (typeof body.coverKey === "string" && body.coverKey.startsWith("img:")) {
        const file = await kv.getWithMetadata(body.coverKey);
        const metadata = file?.metadata as FileMetadata | undefined;
        if (!metadata || metadata.folderId !== folderId) {
          return fail("The poster image must belong to this album", 400);
        }
        updated.coverKey = body.coverKey;
      } else {
        return fail("Invalid album poster image", 400);
      }
    }

    await kv.put(photoFolderKey(folderId), "", { metadata: updated });
    return ok(updated, "Album updated");
  } catch (error: any) {
    console.error("Update album error:", error);
    return fail("Failed to update album", 500);
  }
}

export async function onRequestDelete({ params, env }: any) {
  const kv = getKVBinding(env);
  const folderId = params.id as string;

  try {
    const folder = await getPhotoFolder(kv, folderId);
    if (!folder) return fail("Album not found", 404);

    // Upgrade legacy folderId-only memberships once, then detach media by index.
    await ensureAlbumMediaIndex(kv, folderId);
    const detachedKeys: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await kv.list({
        prefix: albumMediaPrefix(folderId),
        limit: 1000,
        cursor,
      });
      const entries = page.keys ?? [];
      for (let offset = 0; offset < entries.length; offset += 50) {
        await Promise.all(entries.slice(offset, offset + 50).map(async (entry: any) => {
          const fileKey = entry.metadata?.fileKey as string | undefined;
          if (fileKey) {
            const stored = await kv.getWithMetadata(fileKey);
            const metadata = stored?.metadata as FileMetadata | undefined;
            if (metadata?.folderId === folderId) {
              const { folderId: _removed, ...remainingMetadata } = metadata;
              await kv.put(fileKey, stored?.value ?? "", { metadata: remainingMetadata });
              detachedKeys.push(fileKey);
            }
          }
          await kv.delete(entry.name);
        }));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    await Promise.all([
      kv.delete(photoFolderKey(folderId)),
      kv.delete(albumIndexReadyKey(folderId)),
    ]);
    return ok({ id: folderId, detachedKeys }, "Album deleted; its media was kept unfiled");
  } catch (error: any) {
    console.error("Delete album error:", error);
    return fail(`Failed to delete album: ${error?.message || "unknown error"}`, 500);
  }
}

export async function onRequest({ request }: any) {
  return fail("Method not allowed. Use PATCH or DELETE for an album.", 405);
}
