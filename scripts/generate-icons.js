/**
 * PWA Icon Generator Script
 *
 * This script generates all required PWA icons from a source image.
 *
 * Prerequisites:
 *   npm install sharp
 *
 * Usage:
 *   node scripts/generate-icons.js [source-image.png]
 *
 * If no source image is provided, it will create placeholder icons.
 */

const fs = require('fs');
const path = require('path');

// Icon sizes needed for PWA
const ICON_SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const SHORTCUT_SIZE = 96;
const SPLASH_SIZES = [
  { width: 640, height: 1136, name: 'splash-640x1136' },
  { width: 750, height: 1334, name: 'splash-750x1334' },
  { width: 1242, height: 2208, name: 'splash-1242x2208' },
  { width: 1125, height: 2436, name: 'splash-1125x2436' },
  { width: 1284, height: 2778, name: 'splash-1284x2778' },
];

const ICONS_DIR = path.join(__dirname, '../public/icons');
const SCREENSHOTS_DIR = path.join(__dirname, '../public/screenshots');

// Ensure directories exist
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Create SVG icon (running shoe with gradient)
function createSVGIcon(size) {
  const padding = Math.round(size * 0.1);
  const iconSize = size - (padding * 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3B82F6"/>
      <stop offset="100%" style="stop-color:#10B981"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.2)}" fill="url(#bg)"/>
  <g transform="translate(${padding}, ${padding})">
    <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
      <path d="M8 18l1-3 3-1 4 2"/>
    </svg>
  </g>
</svg>`;
}

// Create a simple running icon SVG
function createRunningIconSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#3B82F6"/>
      <stop offset="100%" style="stop-color:#10B981"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="url(#grad)"/>
  <g transform="translate(${size * 0.15}, ${size * 0.15}) scale(${(size * 0.7) / 24})">
    <path fill="white" d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>
  </g>
</svg>`;
}

// Try to use sharp if available, otherwise create SVG placeholders
async function generateIcons() {
  let sharp;
  try {
    sharp = require('sharp');
    console.log('Sharp found, generating PNG icons...');
  } catch {
    console.log('Sharp not found. Creating SVG placeholders...');
    console.log('To generate PNG icons, install sharp: npm install sharp');
    sharp = null;
  }

  const sourceArg = process.argv[2];

  if (sharp && sourceArg && fs.existsSync(sourceArg)) {
    // Generate from source image
    console.log(`Generating icons from: ${sourceArg}`);

    for (const size of ICON_SIZES) {
      const outputPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
      await sharp(sourceArg)
        .resize(size, size, { fit: 'cover' })
        .png()
        .toFile(outputPath);
      console.log(`Created: ${outputPath}`);
    }

    // Generate shortcut icons
    const shortcuts = ['log', 'plan', 'ask'];
    for (const shortcut of shortcuts) {
      const outputPath = path.join(ICONS_DIR, `shortcut-${shortcut}.png`);
      await sharp(sourceArg)
        .resize(SHORTCUT_SIZE, SHORTCUT_SIZE, { fit: 'cover' })
        .png()
        .toFile(outputPath);
      console.log(`Created: ${outputPath}`);
    }

    // Generate splash screens
    for (const splash of SPLASH_SIZES) {
      const outputPath = path.join(ICONS_DIR, `${splash.name}.png`);
      const canvas = sharp({
        create: {
          width: splash.width,
          height: splash.height,
          channels: 4,
          background: { r: 15, g: 23, b: 42, alpha: 1 } // Slate 900
        }
      });

      const iconSize = Math.min(splash.width, splash.height) * 0.3;
      const icon = await sharp(sourceArg)
        .resize(Math.round(iconSize), Math.round(iconSize))
        .toBuffer();

      await canvas
        .composite([{
          input: icon,
          left: Math.round((splash.width - iconSize) / 2),
          top: Math.round((splash.height - iconSize) / 2)
        }])
        .png()
        .toFile(outputPath);
      console.log(`Created: ${outputPath}`);
    }
  } else {
    // Generate from SVG
    for (const size of ICON_SIZES) {
      const svg = createRunningIconSVG(size);

      if (sharp) {
        const outputPath = path.join(ICONS_DIR, `icon-${size}x${size}.png`);
        await sharp(Buffer.from(svg))
          .png()
          .toFile(outputPath);
        console.log(`Created: ${outputPath}`);
      } else {
        const outputPath = path.join(ICONS_DIR, `icon-${size}x${size}.svg`);
        fs.writeFileSync(outputPath, svg);
        console.log(`Created: ${outputPath}`);
      }
    }

    // Generate shortcut icons
    const shortcuts = ['log', 'plan', 'ask'];
    for (const shortcut of shortcuts) {
      const svg = createRunningIconSVG(SHORTCUT_SIZE);

      if (sharp) {
        const outputPath = path.join(ICONS_DIR, `shortcut-${shortcut}.png`);
        await sharp(Buffer.from(svg))
          .png()
          .toFile(outputPath);
        console.log(`Created: ${outputPath}`);
      } else {
        const outputPath = path.join(ICONS_DIR, `shortcut-${shortcut}.svg`);
        fs.writeFileSync(outputPath, svg);
        console.log(`Created: ${outputPath}`);
      }
    }

    console.log('\nNote: SVG icons created. For best results:');
    console.log('1. Install sharp: npm install sharp');
    console.log('2. Create a 512x512 PNG icon');
    console.log('3. Run: node scripts/generate-icons.js your-icon.png');
  }

  console.log('\nIcon generation complete!');
}

generateIcons().catch(console.error);
