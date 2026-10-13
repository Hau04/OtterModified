import { fail, ok } from "../../utils/common";
import { DBAdapterFactory } from "../../utils/db-adapter";
import { getUniqueFileId, buildKeyId, getFileExt } from "../../utils/file";
import {
  FileMetadata,
  FileTag,
  FileType,
  MAX_CHUNK_NUM,
  MAX_CHUNK_SIZE,
  MAX_FILE_SIZE,
  chunkPrefix,
} from "../../utils/types";
import { getPhotoFolder } from "../../utils/photo-folders";
import { getKVBinding } from "../../utils/cloudflare-bindings";

const FILE_TYPES = new Set(Object.values(FileType));

// Initialize a chunked upload and persist its album assignment before chunks arrive.
export async function onRequestGet({ request, env }: any): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const fileType = params.get("fileType") as FileType | null;
    const fileName = (params.get("fileName") || "upload").trim().slice(0, 100);
    const fileSize = Number(params.get("fileSize"));
    const totalChunks = Number(params.get("totalChunks"));

    if (
      !fileType || !FILE_TYPES.has(fileType) || !fileName ||
      !Number.isSafeInteger(fileSize) || fileSize <= MAX_CHUNK_SIZE ||
      !Number.isInteger(totalChunks) || totalChunks < 2
    ) {
      return fail("Invalid chunk upload parameters", 400);
    }
    if (fileSize > MAX_FILE_SIZE || totalChunks > MAX_CHUNK_NUM) {
      return fail("File size exceeds the 1,000 MiB upload limit", 413);
    }
    if (totalChunks !== Math.ceil(fileSize / MAX_CHUNK_SIZE)) {
      return fail("Chunk count does not match the declared file size", 400);
    }

    const folderId = params.get("folderId") || "";
    if (folderId) {
      if (fileType !== FileType.Image && fileType !== FileType.Video) {
        return fail("Only photo and video files can be uploaded to an album", 400);
      }
      const folder = await getPhotoFolder(getKVBinding(env), folderId);
      if (!folder) return fail("Album not found", 404);
    }

    const metadata: FileMetadata = {
      fileName,
      fileSize,
      uploadedAt: Date.now(),
      liked: false,
      tags: params.get("nsfw") === "true" ? [FileTag.NSFW] : [],
      chunkInfo: {
        total: totalChunks,
        uploadedIndices: [],
      },
    };
    if (folderId) metadata.folderId = folderId;

    const key = buildKeyId(fileType, `${chunkPrefix}${getUniqueFileId()}`, getFileExt(fileName));
    await getKVBinding(env).put(key, "", { metadata });
    return ok(key);
  } catch (error: any) {
    console.error("Chunk upload initialization error:", error);
    return fail(`Failed to initialize upload: ${error?.message || "unknown error"}`, 500);
  }
}

// Upload one chunk to Telegram/R2 and await its persisted progress before responding.
export async function onRequestPost({ request, env }: any): Promise<Response> {
  try {
    const formData = await request.formData();
    const key = formData.get("key");
    const rawIndex = formData.get("chunkIndex");
    const chunk = formData.get("chunkFile");

    if (typeof key !== "string" || typeof rawIndex !== "string" || !chunk || typeof chunk === "string") {
      return fail("Missing chunk upload fields", 400);
    }
    if (!/^(img|audio|video|doc):chunk_[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$/i.test(key)) {
      return fail("Invalid chunk upload key", 400);
    }

    const chunkIndex = Number(rawIndex);
    if (!Number.isInteger(chunkIndex)) return fail("Invalid chunk index", 400);

    const kv = getKVBinding(env);
    const stored = await kv.getWithMetadata(key);
    const metadata = stored?.metadata as FileMetadata | undefined;
    if (!metadata?.chunkInfo) return fail("Chunk upload was not initialized", 404);
    if (chunkIndex < 0 || chunkIndex >= metadata.chunkInfo.total) {
      return fail("Chunk index is out of range", 400);
    }

    const expectedSize = Math.min(
      MAX_CHUNK_SIZE,
      metadata.fileSize - chunkIndex * MAX_CHUNK_SIZE,
    );
    if (chunk.size !== expectedSize) {
      return fail("Chunk size does not match the expected size", 400);
    }

    const dbAdapter = DBAdapterFactory.getAdapter(env);
    return await dbAdapter.uploadChunk(key, chunkIndex, chunk);
  } catch (error: any) {
    console.error("Chunk upload error:", error);
    return fail(`Failed to upload chunk: ${error?.message || "unknown error"}`, 500);
  }
}
