// Manual, one-click Gemini analysis using Firebase AI Logic.
// Uses Firebase App Check; no secret Gemini API key in public GitHub Pages.
import { getApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

const ui=window.repertoireApp;
const $=id=>document.getElementById(id);
const button=$('theoryAnalyze');
const status=$('theoryAiStatus');
const draftBox=$('theoryAiDraft');
const draftInfo=$('theoryAiDraftInfo');
const save=$('theoryAiSave');
const discard=$('theoryAiDiscard');
let busy=false;
let draft=null;
const roots=new Set(['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B']);
const nameOf=root=>String(root||'').replace(/#/g,'♯').replace(/b/g,'♭');
function inform(message,level='info'){
  status.textContent=message;
  status.dataset.state=level;
}
function clearDraft(){
  draft=null;
  draftBox.hidden=true;
  draftInfo.replaceChildren();
}
function parseResponse(source){
  const obj=JSON.parse(String(source||'').trim());
  if(!obj||typeof obj!=='object')throw Error('Gemini nevrátil správny výsledok.');
  const rawRoot=typeof obj.keyRoot==='string'?obj.keyRoot.trim().replace(/♯/g,'#').replace(/♭/g,'b'):'';
  const rawMode=typeof obj.keyMode==='string'?obj.keyMode.trim().toLowerCase():'';
  // Tónina je nepovinná: Gemini môže rozpoznať akordy bez jednoznačnej tóniny.
  const keyKnown=roots.has(rawRoot)&&['major','minor'].includes(rawMode);
  const root=keyKnown?rawRoot:'';
  const mode=keyKnown?rawMode:'';
  const candidates=Array.isArray(obj.chords)?obj.chords:[];
  const normalized=[...new Set(candidates
    .filter(x=>typeof x==='string')
    .map(x=>x.trim().replace(/♯/g,'#').replace(/♭/g,'b'))
    .filter(x=>x.length>0&&x.length<=20&&/^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9+#b°ø()/a-zA-Z-]*$/.test(x))
  )].slice(0,24);
  // Neznáme akordy nie sú zlyhaním API – model môže z videa zistiť len časť informácií.
  // Taký výsledok sa smie zobraziť, ale bez akordov neponúkame uloženie.
  const explanation=typeof obj.comment==='string'?obj.comment.slice(0,220).trim():'';
  const confidence=['low','medium','high'].includes(obj.confidence)?obj.confidence:'low';
  return {keyRoot:root,keyMode:mode,analysisChords:normalized.join(', '),confidence,comment:explanation};
}
function showDraft(result,song){
  clearDraft();
  draft={...result,id:song.id,videoId:song.videoId};
  const title=document.createElement('strong');
  title.textContent=result.keyRoot
    ? 'Návrh tóniny: '+nameOf(result.keyRoot)+(result.keyMode==='minor'?' mol':' dur')
    : 'Tóninu sa nepodarilo spoľahlivo určiť';
  const list=document.createElement('p');
  list.textContent=result.analysisChords
    ? 'Rozpoznané akordy (AI odhad): '+result.analysisChords.replace(/#/g,'♯')
    : 'Akordy sa z tohto videa nepodarilo spoľahlivo rozpoznať.';
  const notice=document.createElement('p');
  const certainty={low:'nízka',medium:'stredná',high:'vyššia'}[result.confidence];
  notice.textContent='Odhad AI · istota: '+certainty+'. '+result.comment;
  const warning=document.createElement('p');
  warning.textContent='Toto nie je overený notový rozbor. AI môže akordy pomýliť; porovnaj ich s nahrávkou alebo notami.';
  warning.className='theory-warning';
  draftInfo.append(title,list,notice,warning);
  save.hidden=!result.analysisChords;
  draftBox.hidden=false;
}
button?.addEventListener('click',async()=>{
  if(busy)return;
  const song=ui?.getSelectedSong?.();
  if(!song){inform('Najprv vyber skladbu.','error');return;}
  if(!ui.isCloudReady()){inform('Na analýzu sa najprv prihlás cez Google a počkaj na cloud.','error');return;}
  if(song.analysisChords && !confirm('Skladba už má uložené akordy. Chceš vytvoriť nový návrh AI?'))return;
  busy=true;
  clearDraft();
  button.disabled=true;
  inform('Gemini analyzuje YouTube video. Toto môže trvať dlhšie a čerpá kvótu API…','info');
  try{
    const ai=getAI(getApp(),{backend:new GoogleAIBackend()});
    const prompt=[
      'You are a careful piano harmonic-analysis assistant.',
      'Analyze the MUSIC ACTUALLY AUDIBLE in the attached YouTube piano tutorial video, not just its title.',
      'Identify the most likely key and a UNIQUE list of chord symbols actually used in this specific arrangement.',
      'No timestamps. Do not guess unsupported information.',
      'If too ambiguous to identify chords, return an empty chord list and unknown key.',
      'Use standard chord symbols: C#m, A, G#7, D/F#, etc.',
      'For keyRoot choose only: C,C#,D,Eb,E,F,F#,G,Ab,A,Bb,B.',
      'For keyMode choose only major or minor. If unknown, use empty strings.',
      'Do not treat diatonic chords as proof that they occur in the video.',
      'Return STRICT JSON object only with fields keyRoot, keyMode, chords (distinct string array),',
      'confidence (low/medium/high), comment (one short Slovak sentence explaining uncertainties).',
      'Video title for context: '+song.title+'. Composer: '+(song.artist||'unknown')+'.'
    ].join(' ');
    const parts=[
      {fileData:{mimeType:'video/mp4',fileUri:'https://www.youtube.com/watch?v='+song.videoId}},
      prompt
    ];
    // Only retry a genuine temporary capacity error. Never auto-retry
    // quota, authentication, permission or invalid-request errors.
    const models=['gemini-3.8-flash','gemini-3.5-flash-lite'];
    let result,usedModel=models[0];
    for(let attempt=0;attempt<models.length;attempt++){
      usedModel=models[attempt];
      if(attempt>0)inform('Hlavný model je dočasne preťažený. Skúšam záložný Gemini Flash-Lite (najviac 2 požiadavky spolu)…','warn');
      const model=getGenerativeModel(ai,{
        model:usedModel,
        generationConfig:{maxOutputTokens:1400,responseMimeType:'application/json'}
      });
      try{
        result=await model.generateContent(parts);
        break;
      }catch(error){
        const message=String(error?.message||'');
        const transient=/\b(?:500|503)\b|high demand|temporar(?:ily|y)|overload|service unavailable/i.test(message);
        if(!transient||attempt===models.length-1)throw error;
      }
    }
    const proposed=parseResponse(result.response.text());
    if(usedModel!==models[0]){
      proposed.comment=('Záložný model Flash-Lite: '+(proposed.comment||'Výsledok treba starostlivo overiť.')).slice(0,220);
      proposed.confidence='low';
    }
    const current=ui.getSelectedSong();
    if(current?.id!==song.id||current?.videoId!==song.videoId){
      inform('Medzitým si zmenil skladbu. Spusti analýzu znova na aktuálnom videu.','error');
      return;
    }
    showDraft(proposed,song);
    if(!proposed.analysisChords){
      inform('Gemini odpovedalo, ale nerozpoznalo akordy. Nič sa neuložilo. Môžeš použiť notový zápis alebo iný videonávod.','warn');
    }else if(!proposed.keyRoot){
      inform('Akordy sú navrhnuté, ale tónina zostáva neurčená. Môžeš potvrdiť iba zoznam akordov.','warn');
    }else{
      inform('Návrh je pripravený. Skontroluj ho a až potom ho ulož.','saved');
    }
  }catch(error){
    console.warn('AI chord analysis failed:',error);
    const msg=String(error?.message||'Neznáma chyba pri spracovaní odpovede');
    const overloaded=/\b(?:500|503)\b|high demand|temporar(?:ily|y)|overload|service unavailable/i.test(msg);
    const quota=/\b429\b|resource.exhausted|quota exceeded|rate limit/i.test(msg);
    inform(overloaded
      ? 'Gemini je momentálne preťažený aj pri záložnom pokuse. Žiadne údaje sa neuložili; môžeš skúsiť analýzu neskôr.'
      :quota
      ? 'Gemini odmietol požiadavku pre limit kvóty. Neopakujeme ju automaticky. Žiadne údaje sa neuložili.'
      :'Technická chyba analýzy: '+msg+'. Žiadne údaje sa neuložili.','error');
  }finally{
    busy=false;
    button.disabled=false;
  }
});
save?.addEventListener('click',async()=>{
  if(!draft?.analysisChords||busy)return;
  if(!ui.isCloudReady()){inform('Cloud nie je pripravený.','error');return;}
  const current=ui.getSelectedSong();
  if(current?.id!==draft.id||current?.videoId!==draft.videoId){
    clearDraft();
    inform('Zmenil sa odkaz alebo skladba; starý návrh nemôžeme uložiť.','error');
    return;
  }
  busy=true;save.disabled=true;
  try{
    const keyWasKnown=Boolean(draft.keyRoot);
    await ui.saveAIAnalysis({
      id:draft.id,videoId:draft.videoId,
      keyRoot:draft.keyRoot,keyMode:draft.keyMode,
      analysisChords:draft.analysisChords,analysisSource:'ai'
    });
    clearDraft();
    inform('Zoznam akordov bol uložený do Firebase ako AI odhad.'+(keyWasKnown?'':' Tóninu si môžeš doplniť neskôr.'),'saved');
  }catch(error){
    inform('Uloženie sa nepodarilo: '+(error?.message||'Chyba cloudu'),'error');
  }finally{
    busy=false;save.disabled=false;
  }
});
discard?.addEventListener('click',()=>{
  clearDraft();
  inform('Návrh bol zahodený. Nič sa neuložilo.');
});
document.addEventListener('klavir:song-selected',()=>{
  clearDraft();
  inform('');
});
