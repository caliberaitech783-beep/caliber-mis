// Pair order for the equipment mismatch box: categories in order, pairs in order, skips honoured.
export const nextMismatchPair=(data,skippedPairs=new Set(),skippedCategories=new Set())=>{
 for(const category of data?.categories||[]){
  if(skippedCategories.has(category.id))continue;
  const pair=category.right.find(p=>!skippedPairs.has(category.id+':'+p.key));
  if(pair)return {category,pair};
 }
 return null;
};
export const mismatchPairCount=(data,skippedPairs=new Set(),skippedCategories=new Set())=>(data?.categories||[]).reduce((n,c)=>skippedCategories.has(c.id)?n:n+c.right.filter(p=>!skippedPairs.has(c.id+':'+p.key)).length,0);

