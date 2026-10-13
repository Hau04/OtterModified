import { fail, ok } from "../../utils/common";
import { FileMetadata } from "../../utils/types";
import { getKVBinding } from "../../utils/cloudflare-bindings";

// 修改文件名
export async function onRequestPost(context: any) {
  const { params, env } = context;

  // 获取元数据
  const kv = getKVBinding(env);
  const stored = await kv.getWithMetadata(params.key);
  const metadata: FileMetadata = stored.metadata;

  // 如果记录不存在
  if (!metadata)
    return fail(`File metadata not found for key: ${params.key}`, 404);

  // 切换 liked 状态
  metadata.liked = !metadata.liked;
  await kv.put(params.key, stored.value ?? "", { metadata });

  console.log("Updated metadata:", metadata);

  return ok({ liked: metadata.liked });
}
