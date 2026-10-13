import { fail, ok } from "../../utils/common";
import { CF, FileMetadata } from "../../utils/types";
import { getPhotoFolder, photoFolderKey } from "../../utils/photo-folders";

// 更新文件元数据
// 支持更新 fileName、tags、folderId 等字段
export async function onRequestPatch(context: any) {
  const { request, params, env } = context;
  const kv = env[CF.KV_NAME];

  try {
    const body = await request.json();
    const { fileName, tags, folderId } = body ?? {};

    // 获取现有元数据
    const value = await kv.getWithMetadata(params.key);
    const metadata: FileMetadata | null = value?.metadata ?? null;

    if (!metadata) {
      return fail(`File metadata not found for key: ${params.key}`, 404);
    }

    if (fileName !== undefined) {
      if (typeof fileName !== "string" || !fileName.trim()) {
        return fail("File name must not be empty", 400);
      }
      metadata.fileName = fileName.trim();
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
        return fail("Tags must be an array of strings", 400);
      }
      metadata.tags = tags;
    }

    const previousFolderId = metadata.folderId;
    if (folderId !== undefined) {
      if (!params.key.startsWith("img:")) {
        return fail("Only image files can be assigned to photo folders", 400);
      }

      if (folderId === null || folderId === "") {
        delete metadata.folderId;
      } else if (typeof folderId === "string") {
        const folder = await getPhotoFolder(kv, folderId);
        if (!folder) return fail("Photo folder not found", 404);
        metadata.folderId = folderId;
      } else {
        return fail("Invalid photo folder", 400);
      }
    }

    // Save the file first, then clear the old folder's cover if this image moved away.
    await kv.put(params.key, "", { metadata });

    if (
      previousFolderId &&
      previousFolderId !== metadata.folderId
    ) {
      const previousFolder = await getPhotoFolder(kv, previousFolderId);
      if (previousFolder?.coverKey === params.key) {
        previousFolder.coverKey = null;
        previousFolder.updatedAt = Date.now();
        await kv.put(photoFolderKey(previousFolder.id), "", {
          metadata: previousFolder,
        });
      }
    }

    console.log("Updated metadata:", metadata);
    return ok({ metadata });
  } catch (error) {
    console.error("Error updating metadata:", error);
    return fail("Invalid request body", 400);
  }
}
