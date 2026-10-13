import { fail, ok } from "../utils/common";
import { PhotoFolder } from "../utils/types";
import { getKVBinding } from "../utils/cloudflare-bindings";
import {
  listPhotoFolders,
  MAX_PHOTO_FOLDER_NAME_LENGTH,
  normalizePhotoFolderName,
  photoFolderKey,
  albumIndexReadyKey,
} from "../utils/photo-folders";

export async function onRequestGet({ env }: any) {
  try {
    const kv = getKVBinding(env);
    const storedFolders = await listPhotoFolders(kv);
    const folders = await Promise.all(storedFolders.map(async (folder) => {
      if (!folder.coverKey) return folder;
      const cover = await kv.getWithMetadata(folder.coverKey);
      return {
        ...folder,
        coverTags: Array.isArray(cover?.metadata?.tags) ? cover.metadata.tags : [],
      };
    }));
    return ok({ folders });
  } catch (error: any) {
    console.error("List photo folders error:", error);
    return fail("Failed to fetch photo folders", 500);
  }
}

export async function onRequestPost({ request, env }: any) {
  try {
    const body = await request.json();
    const name = normalizePhotoFolderName(body?.name);

    if (!name) {
      return fail(
        `Folder name must be between 1 and ${MAX_PHOTO_FOLDER_NAME_LENGTH} characters`,
        400,
      );
    }

    const kv = getKVBinding(env);
    const folders = await listPhotoFolders(kv);
    if (folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) {
      return fail("A folder with this name already exists", 409);
    }

    const now = Date.now();
    const folder: PhotoFolder = {
      id: crypto.randomUUID(),
      name,
      coverKey: null,
      createdAt: now,
      updatedAt: now,
    };

    await Promise.all([
      kv.put(photoFolderKey(folder.id), "", { metadata: folder }),
      kv.put(albumIndexReadyKey(folder.id), "1"),
    ]);
    return ok(folder, "Album created");
  } catch (error: any) {
    console.error("Create photo folder error:", error);
    return fail("Failed to create photo folder", 500);
  }
}
