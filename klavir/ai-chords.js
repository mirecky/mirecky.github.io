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
  const root=typeof obj.keyRoot==='string'?obj.keyRoot.trim():'';
  const mode=typeof obj.keyMode==='string'?obj.keyMode.trim():'';
  if(!roots.has(root)||!['major','minor'].includes(mode))
    throw Error('Nepodarilo sa spoľahlivo určiť tóninu. Skús inú skladbu alebo doplň tóninu ručne.');
  const candidates=Array.isArray(obj.chords)?obj.chords:[];
  const normalized=[...new Set(candidates
    .filter(x=>typeof x==='string')
    .map(x=>x.trim().replace(/♯/g,'#').replace(/♭/g,'b'))
    .filter(x=>x.length>0&&x.length<=20&&/^[A-G][#b]?(?:m|maj|min|dim|aug|sus|add|M)?[0-9+#b°ø()/a-zA-Z-]*$/.test(x))
  )].slice(0,24);
  if(!normalized.length)throw Error('Model nedokázal určiť konkrétne akordy. Neuložili sme žiadny odhad.');
  const explanation=typeof obj.comment==='string'?obj.comment.slice(0,220).trim():'';
  const confidence=['low','medium','high'].includes(obj.confidence)?obj.confidence:'low';
  return {keyRoot:root,keyMode:mode,analysisChords:normalized.join(', '),confidence,comment:explanation};
}
function showDraft(result,song){
  clearDraft();
  draft={...result,id:song.id,videoId:song.videoId};
  const title=document.createElement('strong');
  title.textContent='Návrh: '+nameOf(result.keyRoot)+(result.keyMode==='minor'?' mol':' dur');
  const list=document.createElement('p');
  list.textContent='Akordy: '+result.analysisChords.replace(/#/g,'♯');
  const notice=document.createElement('p');
  const certainty={low:'nízka',medium:'stredná',high:'vyššia'}[result.confidence];
  notice.textContent='Odhad AI · istota: '+certainty+'. '+result.comment;
  const warning=document.createElement('p');
  warning.textContent='AI môže akordy pomýliť. Porovnaj ich s nahrávkou alebo notami pred uložením.';
  warning.className='theory-warning';
  draftInfo.append(title,list,notice,warning);
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
    const model=getGenerativeModel(ai,{
      model:'gemini-3.6-flash',
      generationConfig:{temperature:0.15,maxOutputTokens:1400,responseMimeType:'application/json'}
    });
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
    const result=await model.generateContent([
      {fileData:{mimeType:'video/mp4',fileUri:'https://www.youtube.com/watch?v='+song.videoId}},
      prompt
    ]);
    const proposed=parseResponse(result.response.text());
    const current=ui.getSelectedSong();
    if(current?.id!==song.id||current?.videoId!==song.videoId){
      inform('Medzitým si zmenil skladbu. Spusti analýzu znova na aktuálnom videu.','error');
      return;
    }
    showDraft(proposed,song);
    inform('Návrh je pripravený. Skontroluj ho a až potom ho ulož.','saved');
  }catch(error){
    console.warn('AI chord analysis failed:',error);
    inform('Analýza sa nepodarila: '+(error?.message||'Neznáma chyba AI Logic')+'. Môže ísť o nedostupný model, obmedzenie kvóty alebo ochranu App Check.','error');
  }finally{
    busy=false;
    button.disabled=false;
  }
});
save?.addEventListener('click',async()=>{
  if(!draft||busy)return;
  if(!ui.isCloudReady()){inform('Cloud nie je pripravený.','error');return;}
  const current=ui.getSelectedSong();
  if(current?.id!==draft.id||current?.videoId!==draft.videoId){
    clearDraft();
    inform('Zmenil sa odkaz alebo skladba; starý návrh nemôžeme uložiť.','error');
    return;
  }
  busy=true;save.disabled=true;
  try{
    await ui.saveAIAnalysis({
      id:draft.id,videoId:draft.videoId,
      keyRoot:draft.keyRoot,keyMode:draft.keyMode,
      analysisChords:draft.analysisChords,analysisSource:'ai'
    });
    clearDraft();
    inform('Návrh akordov je uložený do Firebase a označený ako AI odhad.','saved');
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
