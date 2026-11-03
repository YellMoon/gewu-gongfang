'use strict';
function importMetadata({id,filename,financialAccountId,createdAt,recordCount,fileHash}){
 return{id,filename,financialAccountId,createdAt,recordCount,fileHash};
}
module.exports={importMetadata};
