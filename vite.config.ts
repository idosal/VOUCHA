import { cloudflare } from "@cloudflare/vite-plugin";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const brandAssets = [
  "apple-touch-icon.png",
  "apple-touch-icon-dark.png",
  "clawptcha-logo-dark.svg",
  "clawptcha-logo-imagegen-v5.png",
  "clawptcha-logo.svg",
  "clawptcha-social-card.png",
  "favicon-32x32.png",
  "favicon-dark-32x32.png",
  "favicon-dark.svg",
  "favicon.svg",
];

function copyBrandAssets() {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const outDir = path.join(root, "dist", "client");
  fs.mkdirSync(outDir, { recursive: true });
  for (const asset of brandAssets) {
    fs.copyFileSync(path.join(root, "public", asset), path.join(outDir, asset));
  }
}

export default defineConfig({
  plugins: [
    {
      name: "clawptcha-brand-assets",
      configureServer: copyBrandAssets,
      closeBundle: copyBrandAssets,
    },
    cloudflare(),
  ]
});
