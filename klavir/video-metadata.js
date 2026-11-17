// Public YouTube video metadata for the piano repertoire.
// Channel owner (author_name) is never assumed to be the composer.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const urlField = $('url');
  const titleField = $('title');
  const composerField = $('artist');
  const dialog = $('addDialog');
  const note = $('videoMetaStatus');
  const retry = $('videoMetaRetry');
  if (!urlField || !titleField || !composerField || !dialog || !note || !retry) return;

  const composers = [
    ['Ludwig van Beethoven', /\bbeethoven\b/i],
    ['Wolfgang Amadeus Mozart', /\bmozart\b/i],
    ['Johann Sebastian Bach', /\bbach\b/i],
    ['Frédéric Chopin', /\bchopin\b/i],
    ['Claude Debussy', /\bdebussy\b/i],
    ['Franz Liszt', /\bliszt\b/i],
    ['Erik Satie', /\bsatie\b/i],
    ['Sergei Rachmaninoff', /\brachmaninoff\b/i],
    ['Pyotr Ilyich Tchaikovsky', /\b(?:tchaikovsky|tschaikowsky)\b/i],
    ['Nino Rota', /\bnino rota\b/i],
    ['Henry Mancini', /\bhenry mancini\b/i],
    ['Yann Tiersen', /\byann tiersen\b/i],
    ['Ludovico Einaudi', /\bludovico einaudi\b/i],
    ['Hans Zimmer', /\bhans zimmer\b/i],
    ['Joe Hisaishi', /\bjoe hisaishi\b/i],
    ['John Williams', /\bjohn williams\b/i],
    ['Ennio Morricone', /\bennio morricone\b/i],
    ['Yiruma', /\byiruma\b/i]
  ];
  let lastVideoId = null;
  let requestRevision = 0;
  let timer = null;
  let controller = null;

  function videoIdFromUrl(value) {
    try {
      const url = new URL(String(value).trim());
      const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./,'');
      let id;
      if (host === 'youtu.be') id = url.pathname.split('/')[1];
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2];
      }
      return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : null;
    } catch { return null; }
  }
  function setMessage(value, state='info') {
    note.textContent = value;
    note.dataset.state = state;
  }
  function metadataFromTitle(videoTitle) {
    const raw = String(videoTitle || '').replace(/\s+/g,' ').trim().slice(0,150);
    let composer = composers.find(([,pattern]) => pattern.test(raw))?.[0] || '';
    if (!composer && /\bpink panther\b/i.test(raw)) composer = 'Henry Mancini';
    if (!composer && /\bmoonlight sonata\b/i.test(raw)) composer = 'Ludwig van Beethoven';
    if (!composer && /\b(?:the godfather|godfather love theme)\b/i.test(raw)) composer = 'Nino Rota';
    const title = raw
      .replace(/\s*[\[(]\s*(?:piano tutorial|easy piano|beginner piano|synthesia|piano cover|how to play|part\s*\d+)[^\])]*[\])]/gi, '')
      .replace(/\s*[\|–—-]\s*(?:piano tutorial|piano cover|easy piano|synthesia|how to play|piano lesson|slow tutorial)\b.*$/i,'')
      .replace(/\b(?:piano tutorials?|piano covers?|easy piano tutorial|how to play on piano|synthesia)\b/gi, '')
      .replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, '').replace(/\s+/g, ' ').trim();
    return { title: title || raw, composer };
  }
  function cancelPending() {
    requestRevision++;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (controller) controller.abort();
    controller = null;
  }
  async function fetchDetails(videoId, signal) {
    const url = 'https://www.youtube.com/watch?v=' + videoId;
    const endpoints = [
      'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url),
      'https://noembed.com/embed?url=' + encodeURIComponent(url)
    ];
    for (const endpoint of endpoints) {
      if (signal.aborted) throw Error('Zrušené');
      try {
        const response = await fetch(endpoint, { signal, mode: 'cors' });
        if (!response.ok) continue;
        const data = await response.json();
        if (typeof data.title === 'string' && data.title.trim()) {
          return { title: data.title, channel: typeof data.author_name === 'string' ? data.author_name : '' };
        }
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
    throw Error('Video nemá dostupné metadáta');
  }
  async function load(videoId, revision, overwrite=false) {
    const activeController = new AbortController();
    controller = activeController;
    const timeout = setTimeout(() => activeController.abort(), 9000);
    const startingTitle = titleField.value;
    const startingComposer = composerField.value;
    try {
      const data = await fetchDetails(videoId, activeController.signal);
      if (revision !== requestRevision || videoIdFromUrl(urlField.value) !== videoId || !dialog.open) return;
      const metadata = metadataFromTitle(data.title);
      const titleWasAutoFilled=overwrite || titleField.value === startingTitle;
      if (titleWasAutoFilled) titleField.value = metadata.title;
      if (overwrite || composerField.value === startingComposer) composerField.value = metadata.composer;
      // Use the original YouTube title for tagging, even if the displayed
      // title was simplified. Respect a title manually edited meanwhile.
      if (titleWasAutoFilled) document.dispatchEvent(new CustomEvent('klavir:video-metadata',{
        detail:{videoId,title:data.title,displayTitle:metadata.title}
      }));
      setMessage(metadata.composer
        ? 'Názov a skladateľ doplnené; môžeš ich upraviť.'
        : 'Názov doplnený. Skladateľ nie je potvrdený — doplň ho ručne. YouTube kanál: ' + (data.channel || 'neuvedený'),
        'success');
    } catch (error) {
      if (revision === requestRevision && dialog.open) {
        setMessage('Názov sa nepodarilo načítať. Skús znovu alebo vyplň údaje ručne.', 'error');
      }
    } finally {
      clearTimeout(timeout);
      if (controller === activeController) controller = null;
    }
  }
  function lookup(immediate=false, overwrite=false) {
    const id = videoIdFromUrl(urlField.value);
    // A blur/change event follows paste: restart immediately without clearing
    // the just-scheduled lookup; repeated input for the same video is ignored.
    if (id && id === lastVideoId && !overwrite && (!immediate || timer === null)) return;
    cancelPending();
    retry.disabled = !id;
    if (!id) {
      lastVideoId = null;
      setMessage(urlField.value.trim()
        ? 'Zadaj platný odkaz na konkrétne YouTube video.'
        : 'Vlož YouTube odkaz. Názov sa načíta automaticky.');
      return;
    }
    const changed = id !== lastVideoId;
    lastVideoId = id;
    if (changed) {
      titleField.value = '';
      composerField.value = '';
    }
    setMessage('Načítavam názov videa z YouTube…');
    const revision = requestRevision;
    timer = setTimeout(() => { timer = null; void load(id, revision, overwrite); }, immediate ? 0 : 450);
  }
  urlField.addEventListener('input', () => lookup());
  urlField.addEventListener('change', () => lookup(true));
  retry.addEventListener('click', () => lookup(true,true));
  document.addEventListener('klavir:editor-open', event => {
    cancelPending();
    lastVideoId = event.detail?.videoId || null;
    retry.disabled = !videoIdFromUrl(urlField.value);
    setMessage('Pri zmene YouTube odkazu sa názov a skladateľ načítajú znovu.');
  });
  $('songForm').addEventListener('reset', () => {
    cancelPending();
    lastVideoId = null;
    retry.disabled = true;
    setMessage('Vlož YouTube odkaz. Názov sa načíta automaticky.');
  });
  dialog.addEventListener('close', cancelPending);
  setMessage('Vlož YouTube odkaz. Názov sa načíta automaticky.');
  retry.disabled = true;
})();
