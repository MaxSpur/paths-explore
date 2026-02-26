import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_DEV_PORT = 5174;
const DEFAULT_PREVIEW_PORT = 4174;

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function isTrue(value: string | undefined): boolean {
  return value?.toLowerCase() === "true";
}

function resolveHttpsOptions(
  root: string,
  env: Record<string, string>
): false | { key: Buffer; cert: Buffer } {
  if (!isTrue(env.VITE_DEV_HTTPS)) {
    return false;
  }

  const keyPath = env.VITE_DEV_SSL_KEY;
  const certPath = env.VITE_DEV_SSL_CERT;

  if (!keyPath || !certPath) {
    console.warn(
      "[vite] HTTPS requested but VITE_DEV_SSL_KEY/VITE_DEV_SSL_CERT are not set. Falling back to HTTP."
    );
    return false;
  }

  const resolvedKey = path.resolve(root, keyPath);
  const resolvedCert = path.resolve(root, certPath);

  if (!fs.existsSync(resolvedKey) || !fs.existsSync(resolvedCert)) {
    console.warn(
      `[vite] HTTPS cert files not found (${resolvedKey}, ${resolvedCert}). Falling back to HTTP.`
    );
    return false;
  }

  return {
    key: fs.readFileSync(resolvedKey),
    cert: fs.readFileSync(resolvedCert)
  };
}

export default defineConfig(({ command, mode }) => {
  const root = process.cwd();
  const env = loadEnv(mode, root, "");

  const preferredPort = parsePort(
    env.VITE_PORT ?? env.PORT,
    DEFAULT_DEV_PORT
  );
  const previewPort = parsePort(env.VITE_PREVIEW_PORT, DEFAULT_PREVIEW_PORT);
  const strictPort = isTrue(env.VITE_STRICT_PORT);
  const https = resolveHttpsOptions(root, env);

  return {
    // Relative base keeps asset URLs valid for custom domains and renamed repo paths.
    base: command === "build" ? "./" : "/",
    server: {
      host: true,
      port: preferredPort,
      strictPort,
      https
    },
    preview: {
      host: true,
      port: previewPort,
      strictPort
    }
  };
});
