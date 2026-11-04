export function paddleFixture({invalidTime=false}={}){
 const texts=[],boxes=[],scores=[];
 const add=(text,x,y,w=90,h=36)=>{texts.push(text);boxes.push([x-w/2,y-h/2,x+w/2,y+h/2]);scores.push(.95)};
 add('SITE: Test OC',180,75,240);add('DATE',55,245);add('Door No.',55,345);add('C.ID',455,345);add('FORM A',950,345);
 add('HMR (Hours)',115,465,150);add('200',345,465);add('206',640,465);add('KMR (Kilometer)',115,520,150);add('100',345,520);add('140',640,520);
 for(const dx of [0,700]){add('Loading Time',400+dx,590,130);add('Unloading Time',600+dx,590,150);add('M',130+dx,610,30);add('NO.',235+dx,610,60);}
 for(let i=0;i<24;i++){const half=i>=12?1:0,row=i%12,dx=half*700,y=675+row*65;add(String(i+1),55+dx,y,30);if(i>=18){add('..',400+dx,y,20);continue;}if(i===0||i===12||i===13){add(i===12?'S':'V',130+dx,y,45);add(i===12?'6':'19',235+dx,y,60);}const a=invalidTime&&i===3?'62:19':'01:12',b='01:19';if(i%2){add(a+b,500+dx,y,400)}else{add(a,400+dx,y,160);add(b,600+dx,y,160)}}
 add('MACHINE-WISE SUMMARY',220,1470,400);for(const dx of [0,700]){add('M',180+dx,1510,30);add('NO.',370+dx,1510,70);add('Trips',565+dx,1510,80)}
 add('V',180,1555,45);add('19',370,1555,70);add('17',565,1555,70);add('S',180,1600,45);add('6',370,1600,70);add('1',565,1600,70);
 return {provider:'paddleocr',model:'PP-OCRv5 mobile',imageSize:[1435,1800],confidence:95,text:'Date: 18-10-2026\nSite: Test OC',pages:[{rec_texts:texts,rec_boxes:boxes,rec_scores:scores}],regions:{bookDate:{text:'18/10/26'},door:{text:'S101'},employeeCode:{text:'CMPL-85001'},cardNo:{text:'1042'}}};
}
