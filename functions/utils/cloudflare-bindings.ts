import { CF } from "./types";

/**
 * Support both KV names used by existing OtterHub deployments. If both are
 * bound, OTTERHUB_KV_BINDING can explicitly select the namespace to preserve.
 */
export function getKVBindingName(env: any): string {
  const requested = String(env?.OTTERHUB_KV_BINDING || "").trim();
  if (requested) return requested;
  if (env?.[CF.KV_NAME]) return CF.KV_NAME;
  if (env?.oh_file_url) return "oh_file_url";
  if (env?.oh_file_url_demo) return "oh_file_url_demo";
  return CF.KV_NAME;
}

export function getKVBinding(env: any): any {
  const name = getKVBindingName(env);
  const binding = env?.[name];
  if (!binding) {
    throw new Error(
      `Missing Cloudflare KV binding "${name}". Bind the existing OtterHub namespace or set OTTERHUB_KV_BINDING.`,
    );
  }
  return binding;
}
