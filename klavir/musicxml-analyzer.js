// Local MusicXML analysis: no generative AI requests and no score uploaded to cloud.
// Harmonic labels are APPROXIMATIONS based on pitches grouped by score measure.
// Accepts plain .xml/.musicxml and ZIP-compressed .mxl (Chrome/Brave DecompressionStream).
const xmlUi={
  toggle:document.getElementById('theoryMusicXmlToggle'),
  content:document.getElementById('theoryMusicXmlTools'),
  input:document.getElementById('theoryMusicXmlFile'),
  run:document.getElementById('theoryMusicXmlRun'),
  status:document.getElementById('theoryMusicXmlStatus'),
  result:document.getElementById('theoryMusicXmlResult'),
  resultInfo:document.getElementById('theoryMusicXmlInfo'),
  save:document.getElementById('theoryMusicXmlSave'),
  discard:document.getElementById('theoryMusicXmlDiscard'),
  openSource:document.getElementById('theoryMusicXmlMoonlight'),
  search:document.getElementById('theoryMusicXmlSearch')
};
const app=window.repertoireApp;
const noteNames=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const majorKeys=['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const minorKeys=['Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#','G#','D#','A#'];
const basePitches={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const patterns=[
  {name:'',tones:[0,4,7]},
  {name:'m',tones:[0,3,7]},
  {name:'dim',tones:[0,3,6]},
  {name:'aug',tones:[0,4,8]},
  {name:'sus2',tones:[0,2,7]},
  {name:'sus4',tones:[0,5,7]},
  {name:'7',tones:[0,4,7,10]},
  {name:'maj7',tones:[0,4,7,11]},
  {name:'m7',tones:[0,3,7,10]},
  {name:'m7b5',tones:[0,3,6,10]},
  {name:'dim7',tones:[0,3,6,9]}
];
const MAX_BYTES=12*1024*1024;
const MOONLIGHT_XML='https://musetrainer.github.io/library/scores/Sonate_No._14_Moonlight_1st_Movement.mxl';
let pending=null,loading=false;
const child=(node,name)=>Array.from(node?.children||[]).find(x=>x.localName===name)||null;
const txt=(node,name)=>child(node,name)?.textContent?.trim()||'';
const mod=(x,n)=>(x%n+n)%n;
function status(text,level='info'){xmlUi.status.textContent=text;xmlUi.status.dataset.state=level;}
function isMoonlight(song){
 return !!song && (song.videoId==='wQuBfKikBq0'||(/moonlight|mesačn/i.test(song.title)&&/beethoven/i.test(song.artist||'')));
}
function sourceLinks(song){
 xmlUi.openSource.hidden=!isMoonlight(song);
 const query=((song?.title||'')+' '+(song?.artist||'')).trim();
 xmlUi.search.href='https://musescore.com/sheetmusic?text='+encodeURIComponent(query||'piano');
}
function reset(){
 pending=null;xmlUi.result.hidden=true;xmlUi.resultInfo.replaceChildren();
}
function cleanKey(fifths,mode){
 const f=Number(fifths);
 if(!Number.isInteger(f)||f< -7||f>7)return {root:'',mode:'',description:'Predznamenanie neurčené'};
 const pos=f+7;
 const major=majorKeys[pos],minor=minorKeys[pos];
 const description=f===0?'bez krížikov a béčok':Math.abs(f)+' '+(f>0?'krížikov':'béčok');
 const valid=mode==='major'||mode==='minor';
 return {root:valid?(mode==='minor'?minor:major):'',mode:valid?mode:'',
   description:description+' (možné tóniny: '+major+' dur / '+minor+' mol)'};
}
async function readZipMusicXml(buffer){
 const view=new DataView(buffer),bytes=new Uint8Array(buffer);
 let end=-1;
 for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){
   if(view.getUint32(p,true)===0x06054b50){end=p;break;}
 }
 if(end<0)throw Error('Neplatný komprimovaný MusicXML (.mxl).');
 const entries=view.getUint16(end+10,true),start=view.getUint32(end+16,true);
 if(entries>5000)throw Error('Súbor obsahuje príliš veľa položiek.');
 const files=new Map(),decoder=new TextDecoder();
 let p=start;
 for(let i=0;i<entries;i++){
   if(p+46>bytes.length||view.getUint32(p,true)!==0x02014b50)throw Error('Poškodená ZIP štruktúra.');
   const method=view.getUint16(p+10,true),compressed=view.getUint32(p+20,true);
   const expanded=view.getUint32(p+24,true),nameLength=view.getUint16(p+28,true);
   const extra=view.getUint16(p+30,true),comment=view.getUint16(p+32,true);
   const local=view.getUint32(p+42,true);
   if(p+46+nameLength+extra+comment>bytes.length)throw Error('Poškodený ZIP zoznam.');
   const name=decoder.decode(bytes.subarray(p+46,p+46+nameLength));
   files.set(name,{method,compressed,expanded,local});
   p+=46+nameLength+extra+comment;
 }
 async function unpack(name){
   const entry=files.get(name);
   if(!entry)throw Error('Súbor neobsahuje očakávaný notový zápis.');
   if(entry.expanded>MAX_BYTES)throw Error('Rozbalený zápis presahuje 12 MB.');
   if(entry.local+30>bytes.length||view.getUint32(entry.local,true)!==0x04034b50)
     throw Error('ZIP obsahuje chybnú položku.');
   const start=entry.local+30+view.getUint16(entry.local+26,true)+view.getUint16(entry.local+28,true);
   const end=start+entry.compressed;
   if(end>bytes.length)throw Error('Neúplný ZIP súbor.');
   const compressed=bytes.slice(start,end);
   if(entry.method===0)return decoder.decode(compressed);
   if(entry.method!==8)throw Error('Nepodporovaný formát kompresie MusicXML.');
   if(!globalThis.DecompressionStream)throw Error('Prehliadač nevie rozbaliť .mxl. Exportuj nekomprimovaný MusicXML.');
   const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   const raw=await new Response(stream).arrayBuffer();
   if(raw.byteLength>MAX_BYTES)throw Error('Rozbalený súbor presahuje 12 MB.');
   return decoder.decode(raw);
 }
 let content=Array.from(files.keys()).find(x=>/\.musicxml$/i.test(x));
 const container=files.has('META-INF/container.xml')?await unpack('META-INF/container.xml'):'';
 if(container){
   const doc=parseXml(container);
   const declared=Array.from(doc.getElementsByTagName('rootfile')).map(x=>x.getAttribute('full-path')).find(Boolean);
   if(declared&&files.has(declared))content=declared;
 }
 content=content||Array.from(files.keys()).find(x=>/\.xml$/i.test(x)&&!x.startsWith('META-INF/'));
 if(!content)throw Error('Archív neobsahuje MusicXML notový zápis.');
 return unpack(content);
}
function parseXml(source){
 if(/<!ENTITY\b/i.test(source))throw Error('XML s vlastnými entitami nie je povolené.');
 const doc=new DOMParser().parseFromString(source,'application/xml');
 if(doc.querySelector('parsererror'))throw Error('MusicXML súbor obsahuje neplatné XML.');
 return doc;
}
async function readMusicXml(file){
 if(!file||file.size===0)throw Error('Vyber MusicXML súbor.');
 if(file.size>MAX_BYTES)throw Error('Súbor je príliš veľký (maximálne 12 MB).');
 const zipped=/\.mxl$/i.test(file.name)||/application\/(zip|vnd\.recordare\.musicxml)/.test(file.type);
 return zipped?readZipMusicXml(await file.arrayBuffer()):file.text();
}
function extractMeasures(doc){
 const root=doc.documentElement;
 if(root?.localName!=='score-partwise')throw Error('Podporované sú noty MusicXML typu score-partwise.');
 const parts=Array.from(root.children).filter(x=>x.localName==='part');
 if(!parts.length)throw Error('Zápis neobsahuje žiadne notové hlasy.');
 if(parts.length>20)throw Error('Príliš veľa nástrojových partov.');
 const measures=[];
 let key=null,allNotes=0;
 for(const part of parts){
   let divisions=1;
   const partMeasures=Array.from(part.children).filter(x=>x.localName==='measure');
   if(partMeasures.length>500)throw Error('Zápis je príliš rozsiahly (viac ako 500 taktov).');
   for(let index=0;index<partMeasures.length;index++){
     const measure=partMeasures[index];
     if(!measures[index])measures[index]=[];
     let cursor=0,lastStart=0;
     for(const el of Array.from(measure.children)){
       const kind=el.localName;
       if(kind==='attributes'){
         const value=Number(txt(el,'divisions'));
         if(Number.isFinite(value)&&value>0&&value<1000000)divisions=value;
         if(key===null){
           const k=child(el,'key');
           if(k)key=cleanKey(txt(k,'fifths'),txt(k,'mode'));
         }
       }else if(kind==='backup'||kind==='forward'){
         const duration=Number(txt(el,'duration'))/divisions;
         if(Number.isFinite(duration))cursor=Math.max(0,cursor+(kind==='backup'?-duration:duration));
       }else if(kind==='note'){
         const chord=!!child(el,'chord'),grace=!!child(el,'grace');
         const duration=Number(txt(el,'duration'))/divisions;
         const start=chord?lastStart:cursor;
         if(!chord)lastStart=cursor;
         const pitch=child(el,'pitch');
         if(pitch&&!grace){
           const step=txt(pitch,'step'),octave=Number(txt(pitch,'octave'));
           const alter=Number(txt(pitch,'alter')||0);
           if(Object.hasOwn(basePitches,step)&&Number.isInteger(octave)&&octave>=0&&octave<=9&&Number.isFinite(alter)){
             const midi=12*(octave+1)+basePitches[step]+alter;
             measures[index].push({pc:mod(midi,12),midi,start,duration:Number.isFinite(duration)?duration:0});
             allNotes++;
             if(allNotes>100000)throw Error('Zápis obsahuje príliš veľa nôt.');
           }
         }
         if(!chord&&!grace&&Number.isFinite(duration))cursor+=Math.max(0,duration);
       }
     }
   }
 }
 if(allNotes<3)throw Error('Nenašli sa čitateľné výšky tónov.');
 return {measures,key:key||{root:'',mode:'',description:'Predznamenanie nebolo uvedené'},partCount:parts.length,allNotes};
}
function candidateChords(notes){
 const pcs=new Map();
 for(const note of notes){
   const current=pcs.get(note.pc)||0;
   // Presence of a note counts; repeated arpeggios receive diminishing returns.
   pcs.set(note.pc,Math.min(4,current+1));
 }
 if(pcs.size<3||pcs.size>8)return null;
 const pitches=new Set(pcs.keys());
 const bass=Math.min(...notes.map(x=>x.midi));
 let best=null;
 for(let root=0;root<12;root++){
   for(const chord of patterns){
     const expected=chord.tones.map(x=>mod(root+x,12));
     const matching=expected.filter(x=>pitches.has(x)).length;
     const missing=expected.length-matching,extras=Array.from(pitches).filter(x=>!expected.includes(x)).length;
     if(matching<3||missing>0)continue;
     // Prefer fully supported chords and avoid forcing an extended chord from unrelated passing notes.
     const score=matching*1.9-extras*.8+(pitches.has(root)?0.35:0)+
       (mod(bass,12)===root?.4:0)-(chord.tones.length===4?.2:0);
     if(!best||score>best.score)best={name:noteNames[root]+chord.name,score,extras};
   }
 }
 return best&&best.score>=3.0&&best.extras<=3?best:null;
}
function calculate(measures){
 const winners=[],counts=new Map();
 measures.forEach((notes,i)=>{
   const chord=candidateChords(notes);
   winners.push({measure:i+1,name:chord?.name||''});
   if(chord)counts.set(chord.name,(counts.get(chord.name)||0)+1);
 });
 const ranked=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 const unique=ranked.slice(0,24).map(x=>x[0]);
 return {winners,unique,identified:winners.filter(x=>x.name).length};
}
function compare(a,b){
 const norm=x=>x.toLowerCase().replace(/[\s♯♭]/g,ch=>ch==='♯'?'#':ch==='♭'?'b':'');
 const setB=new Set(b.map(norm));
 return {same:a.filter(x=>setB.has(norm(x))),different:a.filter(x=>!setB.has(norm(x)))};
}
function p(text,cls){
 const el=document.createElement('p');el.textContent=text;
 if(cls)el.className=cls;
 xmlUi.resultInfo.append(el);
}
function renderResult(result,song,fileName){
 reset();
 pending={...result,songId:song.id,videoId:song.videoId,fileName:fileName.slice(0,120)};
 const heading=document.createElement('strong');
 heading.textContent='Výsledok z MusicXML – lokálny výpočet';
 xmlUi.resultInfo.append(heading);
 p('Zdrojový súbor: '+fileName+' · '+result.measures.length+' taktov · '+result.allNotes+' nôt.');
 p('Predznamenanie: '+result.key.description+'.'+(result.key.root?' Zápis uvádza tóninu '+result.key.root+' '+(result.key.mode==='minor'?'mol':'dur')+'.':' Tóninu treba ešte určiť.'));
 p('Možné akordy zoskupené po taktoch: '+(result.harmony.unique.join(', ')||'nebolo možné určiť')+'.');
 p('Jednoznačná orientačná zhoda akordových vzorcov: '+result.harmony.identified+' z '+result.measures.length+' taktov.');
 const examples=result.harmony.winners.slice(0,16).map(x=>x.measure+'. '+(x.name||'neurčený'));
 p('Prvých 16 taktov: '+examples.join(' · ')+'.');
 const videoChords=String(song.analysisChords||'').split(',').map(x=>x.trim()).filter(Boolean);
 if(videoChords.length){
   const diffs=compare(result.harmony.unique,videoChords);
   p('Zhoda s odhadom z YouTube: '+(diffs.same.join(', ')||'bez jednoznačnej zhody')+'.');
   p('Akordy iba v odhade z MusicXML: '+(diffs.different.join(', ')||'žiadne')+'.');
   p('Akordy iba v odhade z YouTube: '+(compare(videoChords,result.harmony.unique).different.join(', ')||'žiadne')+'.');
 }else p('Na porovnanie ešte chýba uložený návrh akordov z YouTube.');
 p('POZOR: ide o jednoduchý algoritmický odhad podľa tónov v jednotlivých taktoch. Nerieši modulácie, akordové obraty, neakordické tóny ani hranice harmonických fráz. Nie je to overený harmonický rozbor.', 'theory-warning');
 if(result.partCount>1)p('Notový zápis má '+result.partCount+' nástrojových partov. Analýza ich zatiaľ zlučuje do jedného hlasu.','theory-warning');
 xmlUi.save.hidden=!result.harmony.unique.length;
 xmlUi.result.hidden=false;
}
xmlUi.toggle?.addEventListener('click',()=>{
 const song=app?.getSelectedSong?.();
 if(!song){status('Najprv vyber skladbu.','error');return;}
 xmlUi.content.hidden=!xmlUi.content.hidden;
 sourceLinks(song);
 if(!xmlUi.content.hidden)status('Vyber súbor .musicxml, .xml alebo .mxl a spusti miestny výpočet.');
});
xmlUi.run?.addEventListener('click',async()=>{
 if(loading)return;
 const song=app?.getSelectedSong?.(),file=xmlUi.input?.files?.[0];
 if(!song){status('Najprv vyber skladbu.','error');return;}
 if(!file){status('Najprv vyber súbor s notami vo formáte MusicXML.','error');return;}
 loading=true;xmlUi.run.disabled=true;reset();
 status('Čítam noty priamo v prehliadači. Neodosielam ich Gemini…');
 try{
   const source=await readMusicXml(file);
   const doc=parseXml(source);
   const extracted=extractMeasures(doc);
   const harmony=calculate(extracted.measures);
   const current=app.getSelectedSong();
   if(!current||song.id!==current.id||song.videoId!==current.videoId){
     status('Skladba sa počas analýzy zmenila. Výsledok nepriraďujeme.','warn');return;
   }
   renderResult({...extracted,harmony},song,file.name);
   status('MusicXML načítané. Výsledok je pripravený na kontrolu; žiadna kvóta Gemini sa nespotrebovala.','saved');
 }catch(error){
   console.warn('MusicXML import failed',error);
   status('Nedá sa spracovať MusicXML: '+String(error?.message||'Neznáma chyba'),'error');
 }finally{loading=false;xmlUi.run.disabled=false;}
});
xmlUi.save?.addEventListener('click',async()=>{
 if(loading||!pending?.harmony.unique.length)return;
 if(!app.isCloudReady()){status('Najprv sa prihlás do Firebase. Výpočet funguje aj bez prihlásenia, ukladanie nie.','error');return;}
 const song=app.getSelectedSong();
 if(song?.id!==pending.songId||song?.videoId!==pending.videoId){
   status('Skladba alebo video sa zmenili; starý návrh neuložíme.','error');reset();return;
 }
 loading=true;xmlUi.save.disabled=true;
 try{
   await app.saveMusicXmlAnalysis({id:pending.songId,videoId:pending.videoId,analysis:{
     chords:pending.harmony.unique.join(', '),
     keyRoot:pending.key.root,keyMode:pending.key.mode,keyDescription:pending.key.description,
     measures:pending.measures.length,identified:pending.harmony.identified,
     sourceName:pending.fileName,comparedVideoId:pending.videoId,
     method:'measure-pitchclass-heuristic-v1',analyzedAt:Date.now()
   }});
   reset();status('Odhad z MusicXML uložený samostatne do Firebase. Akordy z YouTube ani PDF sme neprepísali.','saved');
 }catch(error){status('Chyba pri ukladaní: '+String(error?.message||'Neznáma chyba'),'error');}
 finally{loading=false;xmlUi.save.disabled=false;}
});
xmlUi.discard?.addEventListener('click',()=>{reset();status('Návrh bol zahodený. Nič sa neuložilo.');});
xmlUi.input?.addEventListener('change',()=>{reset();const file=xmlUi.input.files?.[0];if(file)status('Vybraný súbor: '+file.name+'. Spusti „Vypočítať akordy z MusicXML“.');});
document.addEventListener('klavir:song-selected',()=>{
 xmlUi.content.hidden=true;xmlUi.input.value='';reset();status('');
});
