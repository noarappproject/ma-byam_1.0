import sharp from "sharp";
import { mkdirSync } from "node:fs";

mkdirSync("docs/icons", { recursive: true });

const BG = "#F1F4F0";
const ACCENT = "#DE5A3C";

const anyIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${BG}"/>
  <circle cx="256" cy="256" r="150" fill="${ACCENT}"/>
</svg>`;

const maskableSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <circle cx="256" cy="256" r="120" fill="${ACCENT}"/>
</svg>`;

await sharp(Buffer.from(anyIconSvg)).resize(192, 192).png().toFile("docs/icons/icon-192.png");
await sharp(Buffer.from(anyIconSvg)).resize(512, 512).png().toFile("docs/icons/icon-512.png");
await sharp(Buffer.from(maskableSvg)).resize(512, 512).png().toFile("docs/icons/icon-512-maskable.png");

console.log("Icons written to docs/icons/");
