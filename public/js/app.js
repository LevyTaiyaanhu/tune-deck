const fileInput = document.getElementById('file-input');
const addSongsBtn = document.getElementById('add-songs-btn');
const linkFolderBtn = document.getElementById('link-folder-btn');
const statusEl = document.getElementById('status');
const libraryList = document.getElementById('library-list');
const librarySearch = document.getElementById('library-search');
const audio = document.getElementById('audio');
const playBtn = document.getElementById('play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const shuffleBtn = document.getElementById('shuffle-btn');
const repeatBtn = document.getElementById('repeat-btn');
const seekBar = document.getElementById('seek-bar');
const volumeBar = document.getElementById('volume-bar');
const timeCurrent = document.getElementById('time-current');
const timeDuration = document.getElementById('time-duration');
const nowTitle = document.getElementById('now-title');
const nowSubtitle = document.getElementById('now-subtitle');
const deckGlyph = document.getElementById('deck-glyph');
const visualizerCanvas = document.getElementById('visualizer');
const installButton = document.getElementById('install-button');

const supportsFsAccess = 'showDirectoryPicker' in window;

let tracks = [];
let playOrder = [];
let currentIndex = -1;
let isPlaying = false;
let shuffleOn = false;
let repeatMode = 'off';
let audioCtx = null;
let analyser = null;
let sourceNode = null;
let rafId = null;

const DB_NAME = 'tune-deck-db';
const STORE = 'handles';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('status--error', isError);
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, '');
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

async function scanDirectory(dirHandle, prefix = '') {
  const found = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file') {
      if (/\.(mp3|wav|m4a|ogg|flac|aac|weba)$/i.test(name)) {
        found.push({ name: prefix + name, getFile: () => handle.getFile() });
      }
    } else if (handle.kind === 'directory') {
      const nested = await scanDirectory(handle, prefix + name + '/');
      found.push(...nested);
    }
  }
  return found;
}

function addTracks(newTracks) {
  const startLen = tracks.length;
  tracks = tracks.concat(
    newTracks.map((t) => ({ name: stripExtension(t.name.split('/').pop()), getFile: t.getFile }))
  );
  buildPlayOrder();
  renderLibrary(librarySearch.value);
  setStatus(`${tracks.length} song${tracks.length === 1 ? '' : 's'} in your library.`);
  if (startLen === 0 && tracks.length > 0) {
    playTrackAt(0);
  }
}

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files || []);
  if (!files.length) return;
  addTracks(files.map((f) => ({ name: f.name, getFile: async () => f })));
  fileInput.value = '';
});

addSongsBtn.addEventListener('click', () => fileInput.click());

if (supportsFsAccess) {
  linkFolderBtn.classList.remove('hidden');
}

linkFolderBtn.addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    await idbSet('musicFolder', dirHandle);
    setStatus('Scanning folder…');
    const found = await scanDirectory(dirHandle);
    addTracks(found);
  } catch (err) {
    if (err.name !== 'AbortError') {
      setStatus('Could not access that folder.', true);
    }
  }
});

async function tryRestoreFolder() {
  if (!supportsFsAccess) return;
  try {
    const handle = await idbGet('musicFolder');
    if (!handle) return;
    const granted = (await handle.queryPermission({ mode: 'read' })) === 'granted';
    if (!granted) {
      linkFolderBtn.textContent = 'Reconnect folder';
      linkFolderBtn.classList.remove('hidden');
      linkFolderBtn.onclick = async () => {
        const ok = (await handle.requestPermission({ mode: 'read' })) === 'granted';
        if (ok) {
          setStatus('Scanning folder…');
          const found = await scanDirectory(handle);
          addTracks(found);
          linkFolderBtn.textContent = 'Link a folder';
        }
      };
      return;
    }
    setStatus('Loading your linked folder…');
    const found = await scanDirectory(handle);
    addTracks(found);
  } catch (err) {
    /* no stored folder yet */
  }
}

function buildPlayOrder() {
  playOrder = tracks.map((_, i) => i);
  if (shuffleOn) {
    for (let i = playOrder.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playOrder[i], playOrder[j]] = [playOrder[j], playOrder[i]];
    }
  }
}

function renderLibrary(filter = '') {
  const query = filter.trim().toLowerCase();
  libraryList.innerHTML = '';

  if (!tracks.length) {
    const empty = document.createElement('li');
    empty.className = 'library__empty';
    empty.textContent = 'No songs yet. Tap "Add songs" to pick some from your device.';
    libraryList.appendChild(empty);
    return;
  }

  const filtered = tracks
    .map((t, i) => ({ ...t, index: i }))
    .filter((t) => t.name.toLowerCase().includes(query));

  if (!filtered.length) {
    const empty = document.createElement('li');
    empty.className = 'library__empty';
    empty.textContent = `No songs match "${filter}".`;
    libraryList.appendChild(empty);
    return;
  }

  filtered.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'track' + (t.index === currentIndex ? ' track--active' : '');
    li.innerHTML = `
      <span class="track__index">${t.index === currentIndex && isPlaying ? '♪' : t.index + 1}</span>
      <span class="track__name">${t.name}</span>
      <button class="track__remove" aria-label="Remove ${t.name}">✕</button>
    `;
    li.addEventListener('click', (e) => {
      if (e.target.closest('.track__remove')) return;
      playTrackAt(t.index);
    });
    li.querySelector('.track__remove').addEventListener('click', () => removeTrack(t.index));
    libraryList.appendChild(li);
  });
}

function removeTrack(index) {
  tracks.splice(index, 1);
  if (currentIndex === index) {
    audio.pause();
    currentIndex = -1;
    isPlaying = false;
    nowTitle.textContent = 'Nothing playing';
    nowSubtitle.textContent = tracks.length ? 'Pick a track to play' : 'Your queue is empty';
    updatePlayButton();
  } else if (currentIndex > index) {
    currentIndex -= 1;
  }
  buildPlayOrder();
  renderLibrary(librarySearch.value);
}

async function playTrackAt(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;

  try {
    const file = await tracks[index].getFile();
    const url = URL.createObjectURL(file);
    audio.src = url;
    await ensureAudioGraph();
    await audio.play();
    isPlaying = true;
  } catch (err) {
    setStatus('Could not play that file — it may have moved or been deleted.', true);
    isPlaying = false;
  }

  nowTitle.textContent = tracks[index].name;
  nowSubtitle.textContent = `Track ${index + 1} of ${tracks.length}`;
  deckGlyph.classList.toggle('hidden', isPlaying);
  updatePlayButton();
  renderLibrary(librarySearch.value);
  updateMediaSession();
}

function updatePlayButton() {
  playBtn.textContent = isPlaying ? '⏸' : '▶';
  playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

playBtn.addEventListener('click', async () => {
  if (currentIndex === -1 && tracks.length) {
    playTrackAt(playOrder[0]);
    return;
  }
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
  } else {
    await ensureAudioGraph();
    await audio.play();
    isPlaying = true;
  }
  updatePlayButton();
});

function stepTrack(direction) {
  if (!tracks.length) return;
  const posInOrder = playOrder.indexOf(currentIndex);
  let nextPos = posInOrder + direction;
  if (nextPos < 0) nextPos = playOrder.length - 1;
  if (nextPos >= playOrder.length) nextPos = 0;
  playTrackAt(playOrder[nextPos]);
}

prevBtn.addEventListener('click', () => stepTrack(-1));
nextBtn.addEventListener('click', () => stepTrack(1));

shuffleBtn.addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  shuffleBtn.setAttribute('aria-pressed', String(shuffleOn));
  buildPlayOrder();
  localStorage.setItem('tuneDeckShuffle', shuffleOn ? '1' : '0');
});

repeatBtn.addEventListener('click', () => {
  repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
  repeatBtn.textContent = repeatMode === 'one' ? '🔂' : '🔁';
  repeatBtn.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  localStorage.setItem('tuneDeckRepeat', repeatMode);
});

audio.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
    return;
  }
  const posInOrder = playOrder.indexOf(currentIndex);
  const isLast = posInOrder === playOrder.length - 1;
  if (isLast && repeatMode !== 'all') {
    isPlaying = false;
    updatePlayButton();
    return;
  }
  stepTrack(1);
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  seekBar.value = (audio.currentTime / audio.duration) * 100;
  timeCurrent.textContent = formatTime(audio.currentTime);
  timeDuration.textContent = formatTime(audio.duration);
});

seekBar.addEventListener('input', () => {
  if (!audio.duration) return;
  audio.currentTime = (seekBar.value / 100) * audio.duration;
});

volumeBar.addEventListener('input', () => {
  audio.volume = Number(volumeBar.value);
  localStorage.setItem('tuneDeckVolume', volumeBar.value);
});

librarySearch.addEventListener('input', () => renderLibrary(librarySearch.value));

async function ensureAudioGraph() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    return;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  sourceNode = audioCtx.createMediaElementSource(audio);
  sourceNode.connect(analyser);
  analyser.connect(audioCtx.destination);
  startVisualizer();
}

function startVisualizer() {
  const ctx = visualizerCanvas.getContext('2d');
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function resize() {
    visualizerCanvas.width = visualizerCanvas.clientWidth * devicePixelRatio;
    visualizerCanvas.height = visualizerCanvas.clientHeight * devicePixelRatio;
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    rafId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    const w = visualizerCanvas.width;
    const h = visualizerCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const barCount = bufferLength;
    const barWidth = w / barCount;
    for (let i = 0; i < barCount; i++) {
      const value = isPlaying ? dataArray[i] : 4;
      const barHeight = (value / 255) * h * 0.9;
      const hue = i / barCount;
      ctx.fillStyle = hue < 0.5 ? '#33e6ff' : '#ff3d81';
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * barWidth, h - barHeight, barWidth * 0.7, barHeight);
    }
  }
  draw();
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || currentIndex === -1) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: tracks[currentIndex].name,
    artist: 'Tune Deck',
  });
  navigator.mediaSession.setActionHandler('play', () => playBtn.click());
  navigator.mediaSession.setActionHandler('pause', () => playBtn.click());
  navigator.mediaSession.setActionHandler('previoustrack', () => stepTrack(-1));
  navigator.mediaSession.setActionHandler('nexttrack', () => stepTrack(1));
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installButton.classList.remove('hidden');
});

installButton.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  installButton.classList.add('hidden');
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});

window.addEventListener('appinstalled', () => {
  installButton.classList.add('hidden');
});

(function init() {
  const savedVolume = localStorage.getItem('tuneDeckVolume');
  if (savedVolume !== null) {
    audio.volume = Number(savedVolume);
    volumeBar.value = savedVolume;
  } else {
    audio.volume = 0.8;
  }

  const savedShuffle = localStorage.getItem('tuneDeckShuffle');
  if (savedShuffle === '1') {
    shuffleOn = true;
    shuffleBtn.setAttribute('aria-pressed', 'true');
  }

  const savedRepeat = localStorage.getItem('tuneDeckRepeat');
  if (savedRepeat) {
    repeatMode = savedRepeat;
    repeatBtn.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    repeatBtn.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  }

  renderLibrary();
  tryRestoreFolder();
})();
