import { fail, ok } from "../../../utils/common";
import {
  albumMediaPrefix,
  ensureAlbumMediaIndex,
  getPhotoFolder,
  removeFileFromAlbum,
} from "../../../utils/photo-folders";
import { FileMetadata, FileItem } from "../../../utils/types";
import { getKVBinding } from "../../../utils/cloudflare-bindings";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export async function onRequestGet({ request, params, env }: any) {
  const folderId = String(params.id || "");
  const kv = getKVBinding(env);

  try {
    const folder = await getPhotoFolder(kv, folderId);
    if (!folder) return fail("Album not found", 404);

    // One-time migration of files assigned before the album index existed.
    await ensureAlbumMediaIndex(kv, folderId);

    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_LIMIT);
    const limit = Number.isInteger(requestedLimit)
      ? Math.max(1, Math.min(requestedLimit, MAX_LIMIT))
      : DEFAULT_LIMIT;
    const cursor = url.searchParams.get("cursor") || undefined;
    const page = await kv.list({
      prefix: albumMediaPrefix(folderId),
      limit,
      cursor,
    });

    const records = await Promise.all((page.keys ?? []).map(async (indexEntry: any) => {
      const fileKey = indexEntry.metadata?.fileKey as string | undefined;
      if (!fileKey) return null;

      const stored = await kv.getWithMetadata(fileKey);
      const metadata = stored?.metadata as FileMetadata | undefined;
      if (!metadata || metadata.folderId !== folderId) {
        await removeFileFromAlbum(kv, folderId, fileKey);
        return null;
      }
      return { name: fileKey, metadata } as FileItem;
    }));

    return ok({
      keys: records.filter((record): record is FileItem => Boolean(record)),
      list_complete: page.list_complete,
      cursor: page.list_complete ? null : page.cursor,
    });
  } catch (error: any) {
    console.error("List album media error:", error);
    return fail(`Failed to fetch album: ${error?.message || "unknown error"}`, 500);
  }
}
