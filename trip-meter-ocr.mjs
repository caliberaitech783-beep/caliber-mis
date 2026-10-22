import {locateTripCard,cropHandwriting,HEADER_REGIONS} from './trip-card-template.mjs';
export async function readingCellImages(bytes,text='',{tight=true}={}){const paper=await locateTripCard(bytes,text);if(!paper)return {};const out={};for(const [key,...region]of HEADER_REGIONS){const crop=cropHandwriting(paper,region,{tight});if(crop)out[key]=crop;}return out;}

export async function recognizeReadingCells(worker,bytes,text){
 const cells=await readingCellImages(bytes,text),readings={};
 try{await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789.'});
  for(const [key,image] of Object.entries(cells)){if(!['employeeCode','openingKmr','closingKmr','openingHmr','closingHmr'].includes(key))continue;const {data}=await worker.recognize(image);const value=data.text.trim().replace(/\s/g,'');if(/^\d{3,8}(?:\.\d{1,3})?$/.test(value)&&!/^0/.test(value))readings[key]={value,confidence:data.confidence,source:'reading-table-cell',needsReview:true};}
 }finally{await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});}
 return readings;
}
