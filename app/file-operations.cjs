'use strict';
const fs=require('node:fs/promises');
// Windows scanners may briefly hold freshly written WebP/EXE files.
async function renameWithRetry(from,to){
 for(let attempt=0;;attempt++){
  try{return await fs.rename(from,to);}
  catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=20)throw error;await new Promise(resolve=>setTimeout(resolve,100));}
 }
}
module.exports={renameWithRetry};
