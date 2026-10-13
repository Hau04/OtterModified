import { fail, ok } from "../../utils/common";
import { FileMetadata } from "../../utils/types";
import { getKVBinding } from "../../utils/cloudflare-bindings";
import {
  addFileToAlbum,
  ensureAlbumMediaIndex,
  getPhotoFolder,
  photoFolderKey,
  removeFileFromAlbum,
} from "../../utils/photo-folders";

// Update filename/tags and assign photo or video media to an album.
export async function onRequestPatch({ request, params, env }: any) {
  const kv = getKVBinding(env);

  try {
    const body = await request.json();
    const { fileName, tags, folderId } = body ?? {};
    const stored = await kv.getWithMetadata(params.key);
    const metadata: FileMetadata | null = stored?.metadata ?? null;

    if (!metadata) return fail(`File metadata not found for key: ${params.key}`, 404);

    if (fileName !== undefined) {
      if (typeof fileName !== "string" || !fileName.trim()) {
        return fail("File name must not be empty", 400);
      }
      metadata.fileName = fileName.trim().slice(0, 100);
    }

    if (tags !== undefined) {
      if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
        return fail("Tags must be an array of strings", 400);
      }
      metadata.tags = tags;
    }

    const previousFolderId = metadata.folderId;
    if (folderId !== undefined) {
      const isAlbumMedia = params.key.startsWith("img:") || params.key.startsWith("video:");
      if (!isAlbumMedia) {
        return fail("Only photo and video files can be assigned to an album", 400);
      }

      if (folderId === null || folderId === "") {
        delete metadata.folderId;
      } else if (typeof folderId === "string") {
        const folder = await getPhotoFolder(kv, folderId);
        if (!folder) return fail("Album not found", 404);
        metadata.folderId = folderId;
      } else {
        return fail("Invalid album", 400);
      }
    }

    // Chunked files keep their Telegram/R2 part descriptors in the KV value.
    await kv.put(params.key, stored?.value ?? "", { metadata });

    if (previousFolderId && previousFolderId !== metadata.folderId) {
      await ensureAlbumMediaIndex(kv, previousFolderId);
      await removeFileFromAlbum(kv, previousFolderId, params.key);
      const previousFolder = await getPhotoFolder(kv, previousFolderId);
      if (previousFolder?.coverKey === params.key) {
        previousFolder.coverKey = null;
        previousFolder.updatedAt = Date.now();
        await kv.put(photoFolderKey(previousFolder.id), "", {
          metadata: previousFolder,
        });
      }
    }

    // Re-put membership on explicit assignment too, so a retry repairs an
    // index write that may have failed after the metadata update.
    if (metadata.folderId && folderId !== undefined) {
      await addFileToAlbum(kv, metadata.folderId, params.key);
    }

    return ok({ metadata }, "Media metadata updated");
  } catch (error: any) {
    console.error("Error updating metadata:", error);
    return fail(`Failed to update metadata: ${error?.message || "unknown error"}`, 500);
  }
}
