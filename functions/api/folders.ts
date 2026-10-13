import { fail, ok } from "../utils/common";
import { CF, PhotoFolder } from "../utils/types";
import {
  listPhotoFolders,
  MAX_PHOTO_FOLDER_NAME_LENGTH,
  normalizePhotoFolderName,
  photoFolderKey,
} from "../utils/photo-folders";

export async function onRequestGet({ env }: any) {
  try {
    const folders = await listPhotoFolders(env[CF.KV_NAME]);
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

    const kv = env[CF.KV_NAME];
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

    await kv.put(photoFolderKey(folder.id), "", { metadata: folder });
    return ok(folder, "Photo folder created");
  } catch (error: any) {
    console.error("Create photo folder error:", error);
    return fail("Failed to create photo folder", 500);
  }
}
