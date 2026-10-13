import { PhotoFolder } from "./types";

export const PHOTO_FOLDER_PREFIX = "photo-folder:";
export const MAX_PHOTO_FOLDER_NAME_LENGTH = 80;

export function photoFolderKey(id: string): string {
  return `${PHOTO_FOLDER_PREFIX}${id}`;
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
