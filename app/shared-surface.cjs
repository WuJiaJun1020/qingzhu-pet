'use strict';
const clamp=(value,low,high)=>Math.max(low,Math.min(value,high));
function createSharedSurface({desktop,panel,view}) {
  let mode='desktop',region=null,size={width:160,height:200};
  let canvas={x:0,y:0,...size},center=null,previewVisible=true,lastPlacement='';
  view.setBackgroundColor('#00000000');desktop.contentView.addChildView(view);
  const position=()=>({x:center.x-canvas.width/2-canvas.x,y:center.y-canvas.height/2-canvas.y});
  function containCenter(){
    if(!center||!region)return;
    center={x:clamp(center.x,region.x,region.x+region.width),y:clamp(center.y,region.y,region.y+region.height)};
  }
  function layout(){
    const bounds=mode==='panel'?region:{x:0,y:0,...size};
    const previous=view.getBounds();
    if(Object.keys(bounds).some(key=>bounds[key]!==previous[key]))view.setBounds(bounds);
    if(mode==='panel'){
      const placement={x:center.x-canvas.width/2-region.x,y:center.y-canvas.height/2-region.y};
      const key=JSON.stringify(placement);
      if(key!==lastPlacement){lastPlacement=key;view.webContents.send('player-layout',placement);}
    }else lastPlacement='';
  }
  return {
    get mode(){return mode;},get region(){return region;},get hosted(){return mode==='panel';},
    setRegion(value){
      if(!value||!['x','y','width','height'].every(k=>Number.isFinite(value[k]))||value.width<1||value.height<1)return false;
      if(region&&Object.keys(value).every(k=>region[k]===value[k]))return false;
      region=value;containCenter();layout();return true;
    },
    setSize(value,canvasRect={x:0,y:0,...value}){size=value;canvas=canvasRect;layout();},
    attach(){
      if(mode==='panel'||!region)return false;
      mode='panel';
      if(!center)center={x:region.x+region.width/2,y:Math.max(region.y,region.y+region.height-canvas.height/2)};
      containCenter();lastPlacement='';
      // The viewport clips overflow. Animation frames never adjust placement.
      panel.contentView.addChildView(view);layout();
      view.setVisible(previewVisible);view.webContents.send('player-host',mode);desktop.hide();return true;
    },
    detach(){
      if(mode==='desktop')return false;
      mode='desktop';desktop.contentView.addChildView(view);layout();
      view.setVisible(true);view.webContents.send('player-host',mode);return true;
    },
    setPreviewVisible(value){previewVisible=value;view.setVisible(mode==='desktop'||value);},
    bounds(){
      if(mode==='desktop')return desktop.getBounds();
      const origin=panel.getContentBounds(),p=position();return {x:origin.x+p.x,y:origin.y+p.y,...size};
    },
    clamp(x,y){
      if(mode==='desktop')return {x:Math.round(x),y:Math.round(y)};
      const origin=panel.getContentBounds(),offset={x:canvas.x+canvas.width/2,y:canvas.y+canvas.height/2};
      // Retain a draggable portion while allowing the picture to cross every edge.
      return {x:clamp(x,origin.x+region.x-offset.x,origin.x+region.x+region.width-offset.x),y:clamp(y,origin.y+region.y-offset.y,origin.y+region.y+region.height-offset.y)};
    },
    move(x,y){
      const origin=panel.getContentBounds(),p=this.clamp(x,y);
      center={x:p.x-origin.x+canvas.x+canvas.width/2,y:p.y-origin.y+canvas.y+canvas.height/2};layout();
    }
  };
}
module.exports={createSharedSurface};
