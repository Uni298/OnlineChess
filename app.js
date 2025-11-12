// ======== 設定 ========
const GAS_BASE_URL = 'https://script.google.com/macros/s/AKfycbzTk0qr0KXPigKMJ28opJj3QjxTtmJK3qPnM9yxZQoCW5H1-BuYs0UA6A3ogkUaF6NcBg/exec'; // ← 置き換え
const USE_PEERJS_HOST = true; // trueならPeerJSクラウドに接続
// =====================

const state = {
  peer: null,
  conn: null,
  selfId: null,
  opponentId: null,
  matchId: null,
  color: null, // 'white' or 'black'
  chess: new Chess(),
  selected: null,
  boardEl: null,
  isMyTurn: false,
};

const squares = [];
const files = ['a','b','c','d','e','f','g','h'];

document.addEventListener('DOMContentLoaded', () => {
  state.boardEl = document.getElementById('board');
  buildBoard();
  updateBoard();
  bindUI();
  updateTurnIndicator();
});

function bindUI() {
  document.getElementById('find-match').addEventListener('click', startRandomMatch);
  document.getElementById('resign').addEventListener('click', () => {
    if (!state.conn) return;
    sendMessage({ type: 'resign' });
    endGame('投了しました。あなたの負けです。');
  });
  document.getElementById('restart').addEventListener('click', () => {
    location.reload();
  });
}

function buildBoard() {
  state.boardEl.innerHTML = '';
  squares.length = 0;
  for (let r = 8; r >= 1; r--) {
    for (let c = 1; c <= 8; c++) {
      const sq = files[c-1] + r;
      const el = document.createElement('div');
      el.className = `square ${(r+c)%2===0 ? 'dark' : 'light'}`;
      el.dataset.square = sq;
      el.addEventListener('click', () => onSquareClick(sq));
      state.boardEl.appendChild(el);
      squares.push(el);
    }
  }
}

function renderPieces() {
  squares.forEach(el => el.innerHTML = '');
  const board = state.chess.board();
  // chess.js returns ranks from 8->1
  for (let r = 8; r >= 1; r--) {
    for (let c = 1; c <= 8; c++) {
      const sq = files[c-1] + r;
      const piece = state.chess.get(sq);
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece';
        span.textContent = toUnicode(piece);
        squares.find(s => s.dataset.square === sq).appendChild(span);
      }
    }
  }
}

function updateBoard() {
  renderPieces();
  updateGameStatus();
  updateTurnIndicator();
}

function toUnicode(p) {
  const map = {
    'p': '♟', 'r': '♜', 'n': '♞', 'b': '♝', 'q': '♛', 'k': '♚',
    'P': '♙', 'R': '♖', 'N': '♘', 'B': '♗', 'Q': '♕', 'K': '♔'
  };
  return map[p.type === p.type.toLowerCase() ? p.type : p.type.toUpperCase()];
}

function onSquareClick(sq) {
  if (!state.conn || !state.isMyTurn) return;

  if (!state.selected) {
    // select a piece if present and ours
    const piece = state.chess.get(sq);
    if (!piece) return;
    const turnColor = state.chess.turn() === 'w' ? 'white' : 'black';
    const pieceColor = piece.color === 'w' ? 'white' : 'black';
    if (turnColor !== state.color || pieceColor !== state.color) return;
    state.selected = sq;
    highlightMoves(sq);
  } else {
    const move = tryMove(state.selected, sq);
    clearHighlights();
    state.selected = null;
    if (move) {
      animateMove(move.from, move.to);
      logMove(move);
      sendMessage({ type: 'move', moveSAN: move.san, from: move.from, to: move.to });
      checkQueenCaptureEnd(move);
      updateBoard();
      state.isMyTurn = false;
      updateTurnIndicator();
    }
  }
}

function highlightMoves(from) {
  clearHighlights();
  const moves = state.chess.moves({ square: from, verbose: true });
  moves.forEach(m => {
    const el = squares.find(s => s.dataset.square === m.to);
    if (el) el.classList.add('highlight');
  });
  const fromEl = squares.find(s => s.dataset.square === from);
  if (fromEl) fromEl.classList.add('highlight');
}

function clearHighlights() {
  squares.forEach(s => s.classList.remove('highlight'));
}

function tryMove(from, to) {
  const move = state.chess.move({ from, to, promotion: 'q' });
  if (!move) return null;
  return move;
}

function animateMove(from, to) {
  const fromEl = squares.find(s => s.dataset.square === from);
  const toEl = squares.find(s => s.dataset.square === to);
  const pieceEl = fromEl?.querySelector('.piece');
  if (!fromEl || !toEl || !pieceEl) return;
  pieceEl.classList.add('moving');
  setTimeout(() => pieceEl.classList.remove('moving'), 250);
}

function logMove(move) {
  const li = document.createElement('li');
  li.textContent = `${state.isMyTurn ? 'あなた' : '相手'}: ${move.from} → ${move.to} (${move.san})`;
  document.getElementById('moves-log').prepend(li);
}

function updateGameStatus() {
  const statusEl = document.getElementById('game-status');
  if (!state.conn) {
    statusEl.textContent = 'P2P接続待機中…';
    return;
  }
  if (state.chess.in_checkmate()) {
    statusEl.textContent = 'チェックメイト！';
  } else if (state.chess.in_check()) {
    statusEl.textContent = 'チェック！';
  } else {
    statusEl.textContent = '進行中';
  }
}

function updateTurnIndicator() {
  const turnEl = document.getElementById('turn-indicator');
  const turnColor = state.chess.turn() === 'w' ? 'white' : 'black';
  const isMyTurnNow = (state.color === turnColor) && !!state.conn;
  state.isMyTurn = isMyTurnNow;
  turnEl.textContent = isMyTurnNow ? 'あなたの番' : '相手の番';
}

// Queen capture sudden-death
function checkQueenCaptureEnd(move) {
  if (move.captured && move.captured.toLowerCase() === 'q') {
    const winner = state.isMyTurn ? 'あなた' : '相手';
    endGame(`クイーンが取られました。${winner}の勝ちです。`);
  }
}

function endGame(message) {
  document.getElementById('game-status').textContent = message;
  state.isMyTurn = false;
}

// ======== P2P & Matchmaking ========

async function startRandomMatch() {
  document.getElementById('find-match').disabled = true;
  setStatus('ランダムマッチング中…');

  // 1) まずPeerを作成
  await createPeer();

  // 2) GASへ登録＆ペアリング要求
  const res = await callGAS('match', { playerId: state.selfId });
  if (!res || !res.ok) {
    setStatus('マッチングに失敗しました');
    return;
  }

  state.matchId = res.matchId;
  state.color = res.color; // 'white' or 'black'
  state.opponentId = res.opponentPeerId || null;

  document.getElementById('self-id').textContent = state.selfId;
  document.getElementById('match-id').textContent = state.matchId;

  // 3) 相手IDが既に分かっていれば接続、なければ待受
  if (state.opponentId) {
    connectToPeer(state.opponentId);
  } else {
    waitForOpponent();
  }

  // ボードの向き（白は8->1、黒は1->8視点）
  applyOrientation(state.color);
  setStatus(`接続待機中… あなたは${state.color === 'white' ? '白' : '黒'}`);
  updateTurnIndicator();
}

function applyOrientation(color) {
  if (color === 'black') {
    // 反転表示: CSSグリッドの順序を逆に構成し直す
    state.boardEl.innerHTML = '';
    squares.length = 0;
    for (let r = 1; r <= 8; r++) {
      for (let c = 8; c >= 1; c--) {
        const sq = files[c-1] + r;
        const el = document.createElement('div');
        el.className = `square ${(r+c)%2===0 ? 'dark' : 'light'}`;
        el.dataset.square = sq;
        el.addEventListener('click', () => onSquareClick(sq));
        state.boardEl.appendChild(el);
        squares.push(el);
      }
    }
    updateBoard();
  }
}

function setStatus(text) {
  document.getElementById('game-status').textContent = text;
}

function createPeer() {
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, USE_PEERJS_HOST ? {
      debug: 2
    } : {});
    state.peer = peer;
    peer.on('open', id => {
      state.selfId = id;
      resolve();
    });
    peer.on('error', err => {
      console.error(err);
      reject(err);
    });
  });
}

function waitForOpponent() {
  state.peer.on('connection', conn => {
    setupConnection(conn);
  });
}

function connectToPeer(opponentId) {
  const conn = state.peer.connect(opponentId, { reliable: true });
  setupConnection(conn);
}

function setupConnection(conn) {
  state.conn = conn;
  document.getElementById('opponent-id').textContent = conn.peer;
  conn.on('open', () => {
    setStatus('接続しました。ゲーム開始！');
    // 初期同期
    conn.send({ type: 'hello', matchId: state.matchId, color: state.color });
    updateTurnIndicator();
  });
  conn.on('data', msg => handleMessage(msg));
  conn.on('close', () => setStatus('接続が切断されました'));
}

function sendMessage(payload) {
  if (!state.conn || state.conn.open !== true) return;
  state.conn.send(payload);
}

function handleMessage(msg) {
  if (msg.type === 'hello') {
    // peer handshake
    // no-op
  } else if (msg.type === 'move') {
    const move = state.chess.move({ from: msg.from, to: msg.to, promotion: 'q' });
    if (move) {
      animateMove(msg.from, msg.to);
      logMove(move);
      checkQueenCaptureEnd(move);
      updateBoard();
      state.isMyTurn = true;
      updateTurnIndicator();
    }
  } else if (msg.type === 'resign') {
    endGame('相手が投了しました。あなたの勝ちです。');
  }
}

// ======== GAS呼び出し ========

async function callGAS(action, data) {
  const params = new URLSearchParams({ action, ...data });
  const url = `${GAS_BASE_URL}?${params.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  return res.ok ? res.json() : null;
}
