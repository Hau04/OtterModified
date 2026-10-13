import { fail } from "../../utils/common";
import { DBAdapterFactory } from "../../utils/db-adapter";
import { FileMetadata, FileTag, MAX_CHUNK_SIZE } from "../../utils/types";
import { getPhotoFolder } from "../../utils/photo-folders";
import { getKVBinding } from "../../utils/cloudflare-bindings";

// Upload one file directly. Larger media is sent through the chunk endpoint.
export async function onRequestPost({ request, env }: any) {
  try {
    const formData = await request.formData();
    const uploaded = formData.get("file");
    if (!uploaded || typeof uploaded === "string") {
      return fail("No file uploaded", 400);
    }

    if (uploaded.size > MAX_CHUNK_SIZE) {
      return fail(`File size exceeds ${MAX_CHUNK_SIZE / (1024 * 1024)} MiB limit`, 413);
    }

    const fileName = uploaded.name.substring(0, 100);
    const metadata: FileMetadata = {
      fileName,
      fileSize: uploaded.size,
      uploadedAt: Date.now(),
      liked: false,
      tags: formData.get("nsfw") === "true" ? [FileTag.NSFW] : [],
    };

    const requestedFolderId = formData.get("folderId");
    if (typeof requestedFolderId === "string" && requestedFolderId) {
      const isAlbumMedia = uploaded.type.startsWith("image/") || uploaded.type.startsWith("video/");
      if (!isAlbumMedia) {
        return fail("Only photo and video files can be uploaded to an album", 400);
      }

      const folder = await getPhotoFolder(getKVBinding(env), requestedFolderId);
      if (!folder) return fail("Album not found", 404);
      metadata.folderId = requestedFolderId;
    }

    const dbAdapter = DBAdapterFactory.getAdapter(env);
    return await dbAdapter.uploadFile(uploaded, metadata);
  } catch (error: any) {
    console.error("Upload error:", error);
    return fail(`Failed to upload file: ${error?.message || "unknown error"}`, 500);
  }
}
