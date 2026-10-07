'use strict';
const validVersion=value=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value)&&value.split('.').every(n=>Number.isSafeInteger(Number(n)));
function compareVersions(a,b){if(!validVersion(a)||!validVersion(b))throw Error('版本号格式不正确');const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;return 0;}
module.exports={validVersion,compareVersions};
