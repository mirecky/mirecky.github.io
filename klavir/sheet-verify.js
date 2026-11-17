// AI-assisted analysis of legally available piano sheet music (PDF).
// PDF is processed only after explicit user action, never stored in Firestore.
// The model's notation reading is an estimate, not certified music transcription.
import { getApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

const $=id=>document.getElementById(id);
const ui=window.repertoireApp;
const openButton=$('theorySheetVerify');
const tools=$('theorySheetTools');
const fileInput=$('theorySheetFile');
const runButton=$('theorySheetRun');
const status=$('theorySheetStatus');
const source=$('theorySheetSource');
const sourceLink=$('theorySheetSourceLink');
const proposalBox=$('theorySheetProposal');
const proposalContent=$('theorySheetProposalInfo');
const saveButton=$('theorySheetSave');
const discardButton=$('theorySheetDiscard');
const MAX_PDF_BYTES=12*1024*1024;
const allowedRoots=new Set(['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']);
let working=false,proposal=null;
function say(message,state='info'){status.textContent=message;status.dataset.state=state;}
function cleanChords(raw){
  return [...new Set((Array.isArray(raw)?raw:[])
    .filter(x=>typeof x==='string')
    .map(x=>x.trim().replace(/♯/g,'#').replace(/♭/g,'b'))
    .filter(x=>x.length>0&&x.length<=22&&/^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9+#b°ø()/a-zA-Z-]*$/.test(x))
  )].slice(0,25);
}
function parseOutput(raw){
  const data=JSON.parse(String(raw||'').trim());
  if(!data || typeof data!=='object')throw Error('Model vrátil neplatný výsledok.');
  const candidateRoot=typeof data.keyRoot==='string'?data.keyRoot.replace(/♯/g,'#').replace(/♭/g,'b').trim():'';
  const candidateMode=typeof data.keyMode==='string'?data.keyMode.trim().toLowerCase():'';
  const keyKnown=allowedRoots.has(candidateRoot) && ['major','minor'].includes(candidateMode);
  return {
    keyRoot:keyKnown?candidateRoot:'',
    keyMode:keyKnown?candidateMode:'',
    chords:cleanChords(data.chords),
    confidence:['low','medium','high'].includes(data.confidence)?data.confidence:'low',
    comment:typeof data.comment==='string'?data.comment.slice(0,250):'',
    sameArrangement:typeof data.sameArrangement==='string'?data.sameArrangement.slice(0,130):''
  };
}
function splitChords(text){
  return cleanChords(String(text||'').split(','));
}
function compareChords(paper,video){
  const left=paper.map(x=>x.toLowerCase().replace(/\s/g,''));
  const right=video.map(x=>x.toLowerCase().replace(/\s/g,''));
  return {
    both:paper.filter((x,i)=>right.includes(left[i])),
    onlyPaper:paper.filter((x,i)=>!right.includes(left[i])),
    onlyVideo:video.filter((x,i)=>!left.includes(right[i]))
  };
}
function para(text,kind=''){
  const p=document.createElement('p');p.textContent=text;
  if(kind)p.className=kind;
  proposalContent.append(p);
}
function resetProposal(){
  proposal=null;
  proposalBox.hidden=true;
  proposalContent.replaceChildren();
}
function sameSong(song,initial){
  return !!song && song.id===initial.id && song.videoId===initial.videoId &&
    (song.scoreUrl||'')===initial.scoreUrl;
}
function showProposal(result,song,sourceType,sourceUrl,usedModel,failReason){
  resetProposal();
  proposal={...result,id:song.id,videoId:song.videoId,scoreUrl:song.scoreUrl||'',
    sourceType,sourceUrl,usedModel,failReason};
  const headline=result.keyRoot
    ? 'Tónina podľa nôt: '+result.keyRoot.replace(/#/g,'♯').replace(/b/g,'♭')+' '+(result.keyMode==='minor'?'mol':'dur')
    : 'Tónina podľa PDF sa nepodarila spoľahlivo určiť';
  const heading=document.createElement('strong');heading.textContent=headline;
  proposalContent.append(heading);
  para(result.chords.length
    ? 'Akordy prečítané z nôt (AI odhad): '+result.chords.join(', ').replace(/#/g,'♯')
    : 'V PDF sa nepodarilo spoľahlivo rozpoznať akordy.');
  const video=splitChords(song.analysisChords);
  if(video.length&&result.chords.length){
    const match=compareChords(result.chords,video);
    para('Zhoda s rozborom videa: '+(match.both.join(', ')||'žiadna jednoznačná')+'.');
    para('Len v PDF návrhu: '+(match.onlyPaper.join(', ')||'žiadne')+'.');
    para('Len v návrhu z videa: '+(match.onlyVideo.join(', ')||'žiadne')+'.');
    para('Rozdiely môžu znamenať iné aranžmá alebo chybu AI. Samotná zhoda ešte nepotvrdzuje správnosť.', 'theory-warning');
  }else{
    para('Predchádzajúci zoznam akordov z videa nie je uložený alebo PDF neobsahuje použiteľný výsledok. Teraz sa kontrolujú iba noty.');
  }
  para('Model: '+usedModel+(failReason?' (záložný model; hlavný: '+failReason+')':'')+'.');
  para('Istota AI: '+({low:'nízka',medium:'stredná',high:'vyššia'}[result.confidence])+'. '+result.comment);
  if(result.sameArrangement)para('Poznámka k aranžmánu: '+result.sameArrangement);
  para('Kontrola notového zápisu umelou inteligenciou môže obsahovať chyby v čítaní nôt a rozpoznávaní harmónie.', 'theory-warning');
  saveButton.hidden=!result.chords.length;
  proposalBox.hidden=false;
}
function pdfAddress(song){
  try{
    const u=new URL(song?.scoreUrl||'');
    return u.protocol==='https:'&&u.pathname.toLowerCase().endsWith('.pdf')?u.href:'';
  }catch{return '';}
}
function updateSource(song){
  const addr=pdfAddress(song);
  sourceLink.hidden=!addr;
  if(addr)sourceLink.href=addr;
  else sourceLink.removeAttribute('href');
  source.textContent=addr
    ? 'Pri skladbe máme priradené bezplatné PDF. Najprv sa ho pokúsime načítať priamo; ak ho zdroj blokuje, otvor odkaz a vyber stiahnutý súbor.'
    : 'Pri skladbe nie je priradený kompletný PDF notový zápis. Môžeš vybrať vlastný legálne získaný PDF súbor.';
}
async function validatePdf(file){
  if(!file || !file.size)throw Error('PDF súbor je prázdny.');
  if(file.size>MAX_PDF_BYTES)throw Error('Toto PDF je väčšie než 12 MB. Vyber menší alebo rozdeľ notový zápis.');
  const header=await file.slice(0,5).text();
  if(header!=='%PDF-')throw Error('Súbor nie je platný PDF dokument.');
  return file;
}
async function pdfToInline(file){
  await validatePdf(file);
  const data=await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
    reader.onerror=()=>reject(Error('Nepodarilo sa prečítať PDF.'));
    reader.readAsDataURL(file);
  });
  if(!data)throw Error('PDF sa nepodarilo skonvertovať na dátový vstup.');
  return {inlineData:{data,mimeType:'application/pdf'}};
}
async function getPdf(song){
  if(fileInput.files?.length){
    return {file:await validatePdf(fileInput.files[0]),type:'selected',url:''};
  }
  const address=pdfAddress(song);
  if(!address)throw Error('Najprv vyber súbor PDF notového zápisu. Ak máš len platený náhľad, kompletnú analýzu z neho nevykonáme.');
  const abort=new AbortController();
  const limit=setTimeout(()=>abort.abort(),15000);
  try{
    const response=await fetch(address,{signal:abort.signal,mode:'cors'});
    if(!response.ok)throw Error('HTTP '+response.status);
    const declared=Number(response.headers.get('content-length')||0);
    if(declared>MAX_PDF_BYTES)throw Error('PDF je väčšie než 12 MB.');
    const blob=await response.blob();
    await validatePdf(blob);
    return {file:blob,type:'linked',url:address};
  }catch(error){
    throw Error('PDF sa nedá automaticky načítať z tejto stránky (môže ísť o blokovanie CORS alebo dočasnú chybu). Klikni na „Otvoriť bezplatné PDF“, stiahni ho a vyber súbor ručne. '+String(error?.message||''));
  }finally{clearTimeout(limit);}
}
openButton?.addEventListener('click',()=>{
  const song=ui?.getSelectedSong?.();
  if(!song){say('Najprv vyber skladbu.','error');return;}
  tools.hidden=!tools.hidden;
  if(!tools.hidden){
    updateSource(song);
    say('Analýza PDF sa spustí až po kliknutí na „Analyzovať notový zápis“.');
  }
});
runButton?.addEventListener('click',async()=>{
  if(working)return;
  const song=ui?.getSelectedSong?.();
  if(!song){say('Najprv vyber skladbu.','error');return;}
  if(!ui.isCloudReady()){say('Na analýzu sa najprv prihlás cez Google.','error');return;}
  if(song.sheetAnalysis?.chords && !confirm('Skladba už má uložený rozbor nôt. Vytvoriť nový návrh?'))return;
  working=true;runButton.disabled=true;
  resetProposal();
  try{
    say('Pripravujem PDF notový zápis…');
    const input=await getPdf(song);
    const pdf=await pdfToInline(input.file);
    say('Gemini číta noty a pripravuje návrh akordov. Jedna analýza využíva kvótu API…');
    const ai=getAI(getApp(),{backend:new GoogleAIBackend()});
    const prompt=[
      'You are a conservative music notation analyst reading the ATTACHED PIANO SHEET MUSIC PDF.',
      'Determine the key signature and actual chord sonorities grounded in the WRITTEN NOTES of the score.',
      'Analyze the musical composition or movement matching the provided title, not unrelated works in the document.',
      'Use the written score as the evidence. Do NOT invent chords from just its title or key signature.',
      'If the score is illegible, incomplete or an unrelated movement, return an empty chord list and comment explaining why.',
      'Chord symbols must be UNIQUE and standard (for example Em, B7, C7, F#m7, D/F#); no timecodes.',
      'Music title for reference: '+song.title+'. Composer: '+(song.artist||'unspecified')+'.',
      'YouTube arrangement video for reference only: '+song.url+'. You do not receive this video in this request.',
      'Existing unverified AI video chords for comparison: '+(song.analysisChords||'none')+'.',
      'Return ONLY valid JSON object with keyRoot (C,C#,D,Eb,E,F,F#,G,Ab,A,Bb,B or empty),',
      'keyMode (major or minor or empty), chords (distinct string array), confidence (low/medium/high),',
      'sameArrangement (one short Slovak warning if equivalence to YouTube version is unknown),',
      'comment (one concise Slovak sentence explaining what can/cannot be concluded from the PDF).'
    ].join(' ');
    const models=['gemini-3.8-flash','gemini-3.5-flash-lite'];
    let response,modelUsed=models[0],fallbackReason='';
    for(let i=0;i<models.length;i++){
      modelUsed=models[i];
      if(i) say('Hlavný model bol preťažený ('+fallbackReason+'). Skúšam záložný Flash-Lite…','warn');
      const model=getGenerativeModel(ai,{model:modelUsed,
        generationConfig:{maxOutputTokens:1600,responseMimeType:'application/json'}});
      try{response=await model.generateContent([pdf,prompt]);break;}
      catch(error){
        const detail=String(error?.message||'');
        const temporary=/\b(?:500|503)\b|high demand|overload|temporar(?:ily|y)|service unavailable/i.test(detail);
        if(!temporary||i===models.length-1)throw error;
        fallbackReason=/\b(500|503)\b/.exec(detail)?.[1]||'dočasné preťaženie';
      }
    }
    const result=parseOutput(response.response.text());
    const current=ui.getSelectedSong();
    if(!sameSong(current,song)){
      say('Skladba alebo odkaz na noty sa medzitým zmenili; rozbor neukladáme.','error');
      return;
    }
    showProposal(result,song,input.type,input.url,modelUsed,fallbackReason);
    if(result.chords.length) say('Návrh podľa PDF je pripravený. Skontroluj rozdiely a až potom ho ulož.','saved');
    else say('Gemini PDF spracovalo, no akordy nedokázalo spoľahlivo prečítať. Návrh sa nedá uložiť.','warn');
  }catch(error){
    console.warn('Score analysis failed:',error);
    say('Overenie nôt sa nepodarilo: '+String(error?.message||'Neznáma chyba')+'. Nič sa neuložilo.','error');
  }finally{working=false;runButton.disabled=false;}
});
saveButton?.addEventListener('click',async()=>{
  if(working||!proposal?.chords.length)return;
  const current=ui.getSelectedSong();
  if(!sameSong(current,proposal)){
    say('Skladba alebo PDF sa medzitým zmenili. Návrh neukladáme.','error');
    resetProposal();return;
  }
  if(!ui.isCloudReady()){say('Cloud ešte nie je pripojený.','error');return;}
  working=true;saveButton.disabled=true;
  try{
    await ui.saveSheetAnalysis({
      id:proposal.id,videoId:proposal.videoId,scoreUrl:proposal.scoreUrl,
      analysis:{
        keyRoot:proposal.keyRoot,keyMode:proposal.keyMode,
        chords:proposal.chords.join(', '),
        sourceType:proposal.sourceType,sourceUrl:proposal.sourceUrl,
        comparedVideoId:proposal.videoId,
        confidence:proposal.confidence,model:proposal.usedModel,
        comment:proposal.comment,analyzedAt:Date.now()
      }
    });
    resetProposal();
    say('Rozbor notového zápisu bol uložený oddelene od rozboru videa.','saved');
  }catch(error){
    say('Uloženie do Firebase zlyhalo: '+String(error?.message||'Neznáma chyba'),'error');
  }finally{working=false;saveButton.disabled=false;}
});
discardButton?.addEventListener('click',()=>{resetProposal();say('Návrh bol zahodený. Nič sa neuložilo.');});
fileInput?.addEventListener('change',()=>{
  resetProposal();
  if(fileInput.files?.[0])say('Vybrané PDF: '+fileInput.files[0].name+'. Klikni na „Analyzovať notový zápis“.');
});
document.addEventListener('klavir:song-selected',()=>{
  tools.hidden=true;
  fileInput.value='';
  resetProposal();
  say('');
});
