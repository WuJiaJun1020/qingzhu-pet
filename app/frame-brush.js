'use strict';
// Shared by the editor and small deterministic brush tests.
((target)=>{
 const count=mask=>mask.reduce((sum,value)=>sum+Number(value>0),0);
 const alpha=(original,erased)=>Math.round(original*(255-erased)/255);
 function footprint(width,height,x,y,size,soft,visit){
  size=Math.max(1,Math.min(64,Math.round(size)||1));
  const left=Math.floor(x-(size-1)/2),top=Math.floor(y-(size-1)/2),cx=left+size/2,cy=top+size/2;
  for(let yy=Math.max(0,top);yy<Math.min(height,top+size);yy++)for(let xx=Math.max(0,left);xx<Math.min(width,left+size);xx++){
   const distance=Math.hypot(xx+.5-cx,yy+.5-cy)/(size/2),t=Math.max(0,Math.min(1,1-distance));
   const coverage=soft?Math.round(255*t*t*(3-2*t)):255;
   if(coverage)visit(yy*width+xx,coverage);
  }
 }
 function feather(mask,width,height,radius=3){
  radius=Math.max(1,Math.min(3,Math.round(radius)||1));const result=mask.slice();
  for(let p=0;p<mask.length;p++)if(mask[p]===255){
   const x=p%width,y=Math.floor(p/width);
   for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
    const distance=Math.hypot(xx-x,yy-y);if(distance>radius+.5)continue;
    const value=Math.round(255*Math.max(0,1-distance/(radius+1))),index=yy*width+xx;
    result[index]=Math.max(result[index],value);
   }
  }
  return result;
 }
 function whiteRegion(rgba,mask,width,height,x,y,{radius=24,tolerance=24,white=215,edge=1}={}){
  radius=Math.max(1,Math.min(128,Math.round(radius)||24));tolerance=Math.max(0,Math.min(80,tolerance));white=Math.max(160,Math.min(250,white));
  const result=new Uint8Array(mask.length),selected=new Uint8Array(mask.length),seen=new Uint8Array(mask.length);
  if(x<0||y<0||x>=width||y>=height)return result;
  const seed=y*width+x,offset=seed*4,color=rgba.slice(offset,offset+3);
  const near=p=>{const i=p*4,r=rgba[i],g=rgba[i+1],b=rgba[i+2];return alpha(rgba[i+3],mask[p])>0&&Math.min(r,g,b)>=white&&Math.max(r,g,b)-Math.min(r,g,b)<=50&&Math.max(Math.abs(r-color[0]),Math.abs(g-color[1]),Math.abs(b-color[2]))<=tolerance;};
  if(!near(seed))return result;
  const queue=[seed];seen[seed]=1;
  for(let n=0;n<queue.length;n++){
   const p=queue[n],xx=p%width,yy=Math.floor(p/width);if(Math.hypot(xx-x,yy-y)>radius||!near(p))continue;
   selected[p]=1;result[p]=255;
   for(const [nx,ny] of [[xx-1,yy],[xx+1,yy],[xx,yy-1],[xx,yy+1]])if(nx>=0&&nx<width&&ny>=0&&ny<height){const next=ny*width+nx;if(!seen[next]){seen[next]=1;queue.push(next);}}
  }
  if(edge){const expanded=feather(result,width,height,Math.min(3,edge));
   for(let p=0;p<result.length;p++)if(!selected[p]&&expanded[p]){
    const xx=p%width,yy=Math.floor(p/width),i=p*4,min=Math.min(rgba[i],rgba[i+1],rgba[i+2]),max=Math.max(rgba[i],rgba[i+1],rgba[i+2]);
    if(Math.hypot(xx-x,yy-y)>radius||max-min>50||!alpha(rgba[i+3],mask[p]))continue;
    // Only light adjacent pixels can be softened; saturated/dark fabric is untouched.
    result[p]=Math.round(expanded[p]*Math.max(0,Math.min(1,(min-160)/Math.max(1,white-160))));
   }
  }
  return result;
 }
 const api={count,alpha,footprint,feather,whiteRegion};if(typeof module==='object'&&module.exports)module.exports=api;else target.FrameBrush=api;
})(typeof window==='object'?window:globalThis);
