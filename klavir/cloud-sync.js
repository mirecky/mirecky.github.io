// Klavirny repertoar: prihlasenie cez Google a synchronizacia Firestore.
// Firebase webova konfiguracia je verejna. Pristup k udajom riadia Firestore Rules.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc, writeBatch, runTransaction } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app-check.js';

const firebaseConfig = {
  apiKey: 'AIzaSyA_dnstUaHkzu87jkpjfhd2PE8gfytIbEs',
  authDomain: 'klavirny-repertoar.firebaseapp.com',
  projectId: 'klavirny-repertoar',
  storageBucket: 'klavirny-repertoar.firebasestorage.app',
  messagingSenderId: '233173106418',
  appId: '1:233173106418:web:8e16c167bc06b61112da6b'
};

const app = initializeApp(firebaseConfig);
// Verejny reCAPTCHA Enterprise SITE KEY (nie je tajny Gemini API kluc).
// App Check je registrovany pre mirecky.github.io; na Firestore nic nevynucujeme.
if (location.protocol === 'https:' && location.hostname === 'mirecky.github.io') {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider('6LdyviQuAAAAABu-SgM5rQmQvDuS73vo7uKz7ou-'),
      isTokenAutoRefreshEnabled: true
    });
  } catch (err) {
    console.warn('App Check sa nepodarilo inicializovat:', err);
  }
}
const auth = getAuth(app);
const db = getFirestore(app);
const ui = window.repertoireApp;
const $ = id => document.getElementById(id);
const loginButton = $('cloudLogin');
const logoutButton = $('cloudLogout');
const transferButton = $('cloudTransfer');
let user = null;
let ready = false;
let cancelListener = null;
let cloudSongs = [];
let missingLocalSongs = [];

function status(message, kind = 'info') {
  $('cloudStatus').textContent = message;
  $('cloudStatus').dataset.state = kind;
}
function readableError(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user': return 'Prihlasovanie bolo zatvorene.';
    case 'auth/popup-blocked': return 'Brave zablokoval prihlasovacie okno. Povol vyskakovacie okna pre tuto stranku.';
    case 'auth/unauthorized-domain': return 'Doména mirecky.github.io nie je povolena vo Firebase Authentication.';
    case 'permission-denied': return 'Firestore odmietol pristup. Skontroluj pravidla Firestore -> Rules.';
    case 'unavailable': return 'Firebase je momentalne nedostupny. Skontroluj internet.';
    default: return error?.message || 'Neznama chyba Firebase.';
  }
}
function assertCloud() {
  if (!user || !ready || auth.currentUser?.uid !== user.uid) {
    throw Error('Cloud nie je pripraveny. Najprv sa prihlas a pockaj na nacitanie.');
  }
}
function songsCollection() {
  assertCloud();
  return collection(db, 'users', user.uid, 'songs');
}
function songRef(id) {
  assertCloud();
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw Error('Neplatne ID skladby.');
  return doc(db, 'users', user.uid, 'songs', id);
}
async function commitOperations(ops) {
  assertCloud();
  for (let i = 0; i < ops.length; i += 350) {
    const batch = writeBatch(db);
    for (const op of ops.slice(i, i + 350)) {
      if (op.type === 'delete') batch.delete(songRef(op.id));
      else batch.set(songRef(op.song.id), op.song);
    }
    await batch.commit();
  }
}
function recomputeTransfer() {
  if (!ready || !user) {
    transferButton.hidden = true;
    return;
  }
  // An edit can change videoId, but not a song's stable document ID.
  // Never offer to migrate a stale local copy over an existing cloud song.
  const cloudIds = new Set(cloudSongs.map(x => x.id));
  const cloudVideos = new Set(cloudSongs.map(x => x.videoId));
  missingLocalSongs = ui.getLocalSongs().filter(
    s => !cloudIds.has(s.id) && !cloudVideos.has(s.videoId)
  );
  transferButton.hidden = missingLocalSongs.length === 0;
  if (missingLocalSongs.length) {
    transferButton.textContent = 'Preniest miestne skladby (' + missingLocalSongs.length + ')';
  }
}
function stopWatching() {
  if (cancelListener) {
    cancelListener();
    cancelListener = null;
  }
}
function startWatching(account) {
  stopWatching();
  user = account;
  ready = false;
  cloudSongs = [];
  ui.setCloudMode('loading');
  loginButton.hidden = true;
  logoutButton.hidden = false;
  transferButton.hidden = true;
  $('cloudAccount').textContent = account.email || account.displayName || 'Prihlaseny ucet';
  status('Prihlaseny. Nacitavam skladby z cloudu...');
  try {
    cancelListener = onSnapshot(
      collection(db, 'users', account.uid, 'songs'),
      { includeMetadataChanges: true },
      snapshot => {
        if (auth.currentUser?.uid !== account.uid) return;
        if (snapshot.metadata.fromCache) {
          status(ready ? 'Offline: zobrazene su naposledy nacitane udaje.' : 'Cakam na spojenie s cloudom...', 'warn');
          return;
        }
        cloudSongs = snapshot.docs.map(d => ({ ...d.data(), id: d.id }));
        ready = true;
        ui.setCloudMode('online');
        ui.replaceFromCloud(cloudSongs);
        status(snapshot.metadata.hasPendingWrites
          ? 'Zmeny cakaju na potvrdenie cloudu...'
          : 'Ulozene v cloude · ' + cloudSongs.length + ' skladieb', snapshot.metadata.hasPendingWrites ? 'warn' : 'saved');
        $('storageFooter').textContent = 'Prihlaseny rezim: skladby sa synchronizuju cez Google Firebase. Export JSON je dostupny ako zaloha.';
        recomputeTransfer();
      },
      error => {
        ready = false;
        ui.setCloudMode('error');
        transferButton.hidden = true;
        status('Chyba nacitania: ' + readableError(error), 'error');
      }
    );
  } catch (error) {
    ready = false;
    ui.setCloudMode('error');
    status('Chyba Firebase: ' + readableError(error), 'error');
  }
}
window.cloudSync = {
  async save(song) {
    assertCloud();
    status('Ukladam do cloudu...', 'warn');
    await setDoc(songRef(song.id), song);
  },
  async savePinnedOrder(orderedIds) {
    assertCloud();
    if (!Array.isArray(orderedIds) || orderedIds.length < 2 || orderedIds.length > 3 ||
        new Set(orderedIds).size !== orderedIds.length) {
      throw Error('Neplatný zoznam pripnutých skladieb.');
    }
    status('Ukladám poradie pripnutých skladieb...', 'warn');
    // One atomic write. Only the order fields change; all other song data stays intact.
    const batch=writeBatch(db);
    orderedIds.forEach((id,index)=>batch.update(songRef(id),{pinnedOrder:index}));
    await batch.commit();
  },
  async remove(id) {
    assertCloud();
    status('Odstranujem z cloudu...', 'warn');
    await deleteDoc(songRef(id));
  },
  async replaceAll(incoming, current) {
    assertCloud();
    const desired = new Set(incoming.map(x => x.id));
    const ops = current.filter(x => !desired.has(x.id)).map(x => ({ type: 'delete', id: x.id }));
    for (const song of incoming) ops.push({ type: 'set', song });
    status('Obnovujem skladby v cloude...', 'warn');
    await commitOperations(ops);
  }
};

loginButton.disabled = false;
status('Miestny rezim. Prihlas sa, aby sa skladby ukladali do cloudu.');
loginButton.addEventListener('click', () => {
  loginButton.disabled = true;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  // Popup je spolahlivejsi nez redirect pri blokovani cookies tretich stran.
  signInWithPopup(auth, provider)
    .catch(error => status('Prihlasenie: ' + readableError(error), 'error'))
    .finally(() => { loginButton.disabled = false; });
});
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await signOut(auth);
  } catch (error) {
    status('Odhlasenie: ' + readableError(error), 'error');
  } finally {
    logoutButton.disabled = false;
  }
});
transferButton.addEventListener('click', async () => {
  if (!ready || !user || !missingLocalSongs.length) return;
  const toTransfer = missingLocalSongs.slice();
  if (!confirm('Preniest ' + toTransfer.length + ' miestnych skladieb do cloudu? Existujuce cloudove skladby ostanu zachovane.')) return;
  transferButton.disabled = true;
  try {
    status('Prenasam miestne skladby...', 'warn');
    let added = 0;
    for (const song of toTransfer) {
      // Atomic create-only: if the same document now exists, leave it intact.
      const created = await runTransaction(db, async transaction => {
        const ref = songRef(song.id);
        const existing = await transaction.get(ref);
        if (existing.exists()) return false;
        transaction.set(ref, song);
        return true;
      });
      if (created) added++;
    }
    status('Prenos dokončený. Nové skladby: ' + added, 'saved');
    ui.showMessage('Prenesených nových skladieb: ' + added + '. Existujúce cloudové skladby zostali nezmenené.');
  } catch (error) {
    status('Prenos sa nepodaril: ' + readableError(error), 'error');
    ui.showMessage('Prenos sa nepodaril. Miestne skladby zostali zachovane.');
  } finally {
    transferButton.disabled = false;
    recomputeTransfer();
  }
});

onAuthStateChanged(auth, account => {
  if (account) {
    startWatching(account);
  } else {
    stopWatching();
    user = null;
    ready = false;
    cloudSongs = [];
    missingLocalSongs = [];
    loginButton.hidden = false;
    logoutButton.hidden = true;
    transferButton.hidden = true;
    $('cloudAccount').textContent = '';
    ui.setCloudMode('local');
    ui.replaceWithLocal();
    $('storageFooter').textContent = 'Miestny rezim: udaje su ulozene len v tomto prehliadaci. Po prihlaseni sa mozu preniest do cloudu.';
    status('Miestny rezim. Prihlas sa cez Google pre synchronizaciu.');
  }
}, error => {
  status('Chyba prihlasovania: ' + readableError(error), 'error');
});
