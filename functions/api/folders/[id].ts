import { fail, ok } from "../../utils/common";
import { CF, FileMetadata, PhotoFolder } from "../../utils/types";
import {
  getPhotoFolder,
  listPhotoFolders,
  MAX_PHOTO_FOLDER_NAME_LENGTH,
  normalizePhotoFolderName,
  photoFolderKey,
} from "../../utils/photo-folders";

export async function onRequestPatch({ request, params, env }: any) {
  const kv = env[CF.KV_NAME];
  const folderId = params.id as string;

  try {
    const folder = await getPhotoFolder(kv, folderId);
    if (!folder) return fail("Photo folder not found", 404);

    const body = await request.json();
    const updated: PhotoFolder = { ...folder, updatedAt: Date.now() };

    if (body?.name !== undefined) {
      const name = normalizePhotoFolderName(body.name);
      if (!name) {
        return fail(
          `Folder name must be between 1 and ${MAX_PHOTO_FOLDER_NAME_LENGTH} characters`,
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
        return fail("A folder with this name already exists", 409);
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
          return fail("The poster image must belong to this folder", 400);
        }
        updated.coverKey = body.coverKey;
      } else {
        return fail("Invalid poster image", 400);
      }
    }

    await kv.put(photoFolderKey(folderId), "", { metadata: updated });
    return ok(updated, "Photo folder updated");
  } catch (error: any) {
    console.error("Update photo folder error:", error);
    return fail("Failed to update photo folder", 500);
  }
}

export async function onRequestDelete({ params, env }: any) {
  const kv = env[CF.KV_NAME];
  const folderId = params.id as string;

  try {
    const folder = await getPhotoFolder(kv, folderId);
    if (!folder) return fail("Photo folder not found", 404);

    // Keep the photos, but remove their album assignment before deleting the folder.
    const detachedKeys: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await kv.list({ prefix: "img:", limit: 1000, cursor });
      await Promise.all(
        (page.keys ?? []).map(async (item: any) => {
          const metadata = item.metadata as FileMetadata | undefined;
          if (!metadata || metadata.folderId !== folderId) return;

          const { folderId: _folderId, ...remainingMetadata } = metadata;
          await kv.put(item.name, "", { metadata: remainingMetadata });
          detachedKeys.push(item.name);
        }),
      );

      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);

    await kv.delete(photoFolderKey(folderId));
    return ok({ id: folderId, detachedKeys }, "Photo folder deleted");
  } catch (error: any) {
    console.error("Delete photo folder error:", error);
    return fail("Failed to delete photo folder", 500);
  }
}

export async function onRequest({ request }: any) {
  return fail("Method not allowed. Use PATCH or DELETE for a photo folder.", 405);
}
