// lib/api.ts
import { request } from "./utils";
import {
  FileType,
  ListFilesRequest,
  ListFilesResponse,
  FileItem,
  PhotoFolder,
} from "./types";

// 开发环境：.env.local
// 生产环境：当前域名
// 注意：使用typeof window !== 'undefined'检查，避免服务端渲染错误
export const API_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  (typeof window !== "undefined" ? window.location.origin : "");

export function uploadFile(
  file: File,
  nsfw?: boolean,
  folderId?: string,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  if (nsfw) {
    formData.append("nsfw", "true");
  }
  if (folderId) {
    formData.append("folderId", folderId);
  }

  return request<string>(`${API_URL}/api/upload`, {
    method: "POST",
    body: formData,
  });
}

export function uploadChunkInit(
  fileType: FileType,
  fileName: string,
  fileSize: number,
  totalChunks: number,
  folderId?: string,
  nsfw?: boolean,
): Promise<string> {
  const params = new URLSearchParams({
    fileType: fileType,
    fileName: fileName,
    fileSize: fileSize.toString(),
    totalChunks: totalChunks.toString(),
  });
  if (folderId) params.set("folderId", folderId);
  if (nsfw) params.set("nsfw", "true");
  const query = params.toString();
  return request<string>(`${API_URL}/api/upload/chunk?${query}`, {
    method: "GET",
  });
}
export function uploadChunk(
  key: string,
  chunkIndex: number,
  chunkFile: File | Blob,
): Promise<string> {
  const formData = new FormData();
  formData.append("key", key);
  formData.append("chunkIndex", chunkIndex.toString());
  formData.append("chunkFile", chunkFile);

  return request<string>(`${API_URL}/api/upload/chunk`, {
    method: "POST",
    body: formData,
  });
}

export function getFileList(
  params?: ListFilesRequest
): Promise<ListFilesResponse> {
  const query = new URLSearchParams(params).toString();
  return request<ListFilesResponse>(`${API_URL}/api/list?${query}`);
}

export function getPhotoFolders(): Promise<{ folders: PhotoFolder[] }> {
  return request<{ folders: PhotoFolder[] }>(`${API_URL}/api/folders`);
}

export function createPhotoFolder(name: string): Promise<PhotoFolder> {
  return request<PhotoFolder>(`${API_URL}/api/folders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export function updatePhotoFolder(
  id: string,
  updates: { name?: string; coverKey?: string | null },
): Promise<PhotoFolder> {
  return request<PhotoFolder>(`${API_URL}/api/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export function deletePhotoFolder(
  id: string,
): Promise<{ id: string; detachedKeys: string[] }> {
  return request<{ id: string; detachedKeys: string[] }>(
    `${API_URL}/api/folders/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

export function getFileUrl(key: string): string {
  return `${API_URL}/file/${key}`;
}

export function deleteFile(key: string): Promise<boolean> {
  return request<boolean>(`${API_URL}/api/delete/${key}`, {
    method: "POST",
  });
}

export function toggleLike(key: string): Promise<boolean> {
  return request<boolean>(`${API_URL}/api/toggleLike/${key}`, {
    method: "POST",
  });
}

export function editMetadata(
  key: string,
  updates: { fileName?: string; tags?: string[]; folderId?: string | null },
): Promise<{ metadata: any }> {
  return request<{ metadata: any }>(
    `${API_URL}/api/editFileMeta/${key}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
  );
}

export function logout(): Promise<boolean> {
  return request<boolean>(`${API_URL}/api/logout`, {
    method: "POST",
  });
}

/**
 * 检查是否有未完成的上传（用于断点续传）
 * 通过 filename + fileSize 匹配文件，检查 chunkInfo 是否完整
 */
export async function checkIncompleteUpload(
  file: File
): Promise<FileItem | null> {
  try {
    const fileList = await getFileList();
    const incompleteFile = fileList.keys.find(
      (item) =>
        item.metadata.fileName === file.name &&
        item.metadata.fileSize === file.size &&
        item.metadata.chunkInfo?.uploadedIndices.length !== item.metadata.chunkInfo?.total
    );
    return incompleteFile || null;
  } catch (error) {
    console.error("检查未完成上传失败:", error);
    return null;
  }
}
