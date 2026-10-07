// NSIS consumes uncompressed BMP; retain the generated PNG as the source artwork.
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
async function main() {
  const root = path.join(__dirname, '..', 'build');
  const {data,info} = await sharp(path.join(root,'installer-background.png')).flatten({background:'#f8f7f2'}).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const stride = (info.width*3+3)&~3;
  const bmp = Buffer.alloc(54+stride*info.height);
  bmp.write('BM');bmp.writeUInt32LE(bmp.length,2);bmp.writeUInt32LE(54,10);bmp.writeUInt32LE(40,14);
  bmp.writeInt32LE(info.width,18);bmp.writeInt32LE(info.height,22);bmp.writeUInt16LE(1,26);bmp.writeUInt16LE(24,28);bmp.writeUInt32LE(stride*info.height,34);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const s=(y*info.width+x)*3,d=54+(info.height-y-1)*stride+x*3;
    bmp[d]=data[s+2];bmp[d+1]=data[s+1];bmp[d+2]=data[s];
  }
  await fs.writeFile(path.join(root,'installer-background.bmp'),bmp);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
