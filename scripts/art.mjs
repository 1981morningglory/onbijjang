import sharp from 'sharp'; import fs from 'node:fs'; import path from 'node:path'
const src='.art-src', out='public/art'; fs.mkdirSync(out,{recursive:true})
const files=fs.readdirSync(src).filter(f=>f.endsWith('.png'))
const tiles=[]
for(const f of files){ const id=path.basename(f,'.png')
  const img=sharp(path.join(src,f)).trim({threshold:8})
  const buf=await img.resize(512,512,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).webp({quality:88,alphaQuality:90}).toBuffer()
  fs.writeFileSync(path.join(out,id+'.webp'),buf)
  const meta=await sharp(path.join(src,f)).metadata()
  console.log(id, meta.width+'x'+meta.height, 'alpha:'+meta.hasAlpha, (buf.length/1024|0)+'KB')
  tiles.push({input:await sharp(buf).resize(200,200).png().toBuffer(), id})
}
const cols=6, rows=Math.ceil(tiles.length/cols)
await sharp({create:{width:cols*200,height:rows*200,channels:4,background:'#F7F4EC'}}).composite(tiles.map((t,i)=>({input:t.input,left:(i%cols)*200,top:Math.floor(i/cols)*200}))).png().toFile('.art-src/_sheet.png')
