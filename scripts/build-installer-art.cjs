// Generate the installer's vector artwork as 24-bit BMPs required by NSIS.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const output = path.join(__dirname, '..', 'build');
async function bitmap(name, width, height, svg) {
  const rgb = await sharp(Buffer.from(svg)).flatten({ background: '#234b40' }).removeAlpha().raw().toBuffer();
  const stride = (width * 3 + 3) & ~3;
  const bmp = Buffer.alloc(54 + stride * height);
  bmp.write('BM');
  bmp.writeUInt32LE(bmp.length, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = 54 + (height - y - 1) * stride + x * 3;
      bmp[dst] = rgb[src + 2]; bmp[dst + 1] = rgb[src + 1]; bmp[dst + 2] = rgb[src];
    }
  }
  await fs.writeFile(path.join(output, name), bmp);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const bamboo = `<g fill="none" stroke="#91af95" stroke-width="2" opacity=".35"><path d="M128 330L112 58M152 330L142 115"/><path d="M113 94h9m-6 45h9m-6 46h9m-5 47h9m-6 46h9m12-115h8m-6 48h8m-5 48h8"/></g><g fill="#91af95" opacity=".38"><path d="M117 146Q72 110 68 82Q98 99 117 146M117 146Q137 91 158 82Q151 116 117 146M124 236Q74 204 74 178Q109 195 124 236M147 205Q162 159 184 151Q175 183 147 205M134 284Q163 248 180 248Q165 270 134 284"/></g>`;
  await bitmap('installerSidebar.bmp', 164, 314, `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#183c32"/><stop offset="1" stop-color="#3d6957"/></linearGradient></defs><rect width="164" height="314" fill="url(#bg)"/><rect x="9" y="9" width="146" height="296" rx="3" fill="none" stroke="#cfb87e" opacity=".65"/>${bamboo}<g font-family="Microsoft YaHei" fill="#f3e8c9"><text x="23" y="57" font-size="24" font-weight="bold">青竹桌宠</text><text x="24" y="79" font-size="8" letter-spacing="2">QINGZHU PET</text><path d="M24 96H71" stroke="#cfb87e"/><text x="24" y="125" font-size="11">一隅青竹</text><text x="24" y="145" font-size="11">常伴桌边</text><text x="24" y="272" font-size="9" fill="#e2d3b0">轻触 · 相伴 · 随心</text><text x="24" y="288" font-size="8" fill="#b5c7b7">WINDOWS DESKTOP COMPANION</text></g></svg>`);
  await bitmap('installerHeader.bmp', 150, 57, `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57"><rect width="150" height="57" fill="#f6f0df"/><path d="M15 43V14m6 29V21" stroke="#315f4e" stroke-width="2"/><path d="M15 25Q2 17 4 10Q13 15 15 25M21 31Q27 13 36 15Q31 26 21 31" fill="#709578"/><text x="43" y="28" font-family="Microsoft YaHei" font-size="17" font-weight="bold" fill="#244c3e">青竹桌宠</text><text x="44" y="43" font-family="Arial" font-size="8" letter-spacing="1.8" fill="#8d7543">QINGZHU PET</text></svg>`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
