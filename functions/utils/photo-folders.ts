'use strict';

import { PhotoFolder } from "./types";

export const PHOTO_FOLDER_PREFIX = "photo-folder:";
export const ALBUM_MEDIA_PREFIX = "album-media:";
export const ALBUM_INDEX_READY_PREFIX = "album-media-index-ready:";
export const MAX_PHOTO_FOLDER_NAME_LENGTH = 80;

export function photoFolderKey(id: string): string {
  return `${PHOTO_FOLDER_PREFIX}${id}`;
}

export function albumMediaPrefix(folderId: string): string {
  return `${ALBUM_MEDIA_PREFIX}${folderId}:`;
}

export function albumMediaKey(folderId: string, fileKey: string): string {
  return `${albumMediaPrefix(folderId)}${encodeURIComponent(fileKey)}`;
}

export function albumIndexReadyKey(folderId: string): string {
  return `${ALBUM_INDEX_READY_PREFIX}${folderId}`;
}

export function normalizePhotoFolderName(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const name = value.trim();
  if (!name || name.length > MAX_PHOTO_FOLDER_NAME_LENGTH) return null;
  return name;
}

export async function getPhotoFolder(
  kv: any,
  id: string,
): Promise<PhotoFolder | null> {
  if (!id || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return null;

  const result = await kv.getWithMetadata(photoFolderKey(id));
  return (result?.metadata as PhotoFolder | undefined) ?? null;
}

export async function listPhotoFolders(kv: any): Promise<PhotoFolder[]> {
  const folders: PhotoFolder[] = [];
  let cursor: string | undefined;

  do {
    const result = await kv.list({
      prefix: PHOTO_FOLDER_PREFIX,
      limit: 1000,
      cursor,
    });

    for (const item of result.keys ?? []) {
      const folder = item.metadata as PhotoFolder | undefined;
      if (folder?.id && folder?.name) folders.push(folder);
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return folders.sort((a, b) =>
    b.createdAt - a.createdAt || a.name.localeCompare(b.name),
  );
}

/**
 * Old album membership lived only in each file's metadata. Build the per-album
 * index once when a legacy album is opened, so new albums can list their media
 * without scanning every image/video key on every visit.
 */
export async function ensureAlbumMediaIndex(kv: any, folderId: string): Promise<void> {
  const readyKey = albumIndexReadyKey(folderId);
  if ((await kv.get(readyKey)) === "1") return;

  for (const prefix of ["img:", "video:"]) {
    let cursor: string | undefined;
    do {
      const page = await kv.list({ prefix, limit: 1000, cursor });
      const writes: Promise<unknown>[] = [];
      for (const item of page.keys ?? []) {
        const metadata = item.metadata as { folderId?: string } | undefined;
        if (metadata?.folderId === folderId) {
          writes.push(kv.put(albumMediaKey(folderId, item.name), "", {
            metadata: { fileKey: item.name },
          }));
        }
      }
      await Promise.all(writes);
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }

  await kv.put(readyKey, "1");
}

export async function addFileToAlbum(
  kv: any,
  folderId: string,
  fileKey: string,
): Promise<void> {
  await ensureAlbumMediaIndex(kv, folderId);
  await kv.put(albumMediaKey(folderId, fileKey), "", {
    metadata: { fileKey },
  });
}

export async function removeFileFromAlbum(
  kv: any,
  folderId: string,
  fileKey: string,
): Promise<void> {
  await kv.delete(albumMediaKey(folderId, fileKey));
}
