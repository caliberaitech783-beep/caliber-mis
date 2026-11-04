// Prepare at most one page ahead; upload acknowledgements preserve page order.
export async function transferScannerPages(cards,{read,send,onProgress=()=>{}}){
 const prepare=async card=>{try{return {bytes:await read(card)}}catch(error){return {error}}};
 let pending=cards.length?prepare(cards[0]):null;
 for(let i=0;i<cards.length;i++){
  const result=await pending;if(result.error)throw result.error;
  pending=i+1<cards.length?prepare(cards[i+1]):null;
  onProgress(i+1,cards.length);
  await send(cards[i],result.bytes);
 }
}
