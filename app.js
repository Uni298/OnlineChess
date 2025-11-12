// app.js

// --------- GAS API ---------
const api = {
  async joinQueue(clientId) {
    const res = await fetch(GAS_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "joinQueue", clientId })
    });
    return res.json();
  },
  async leaveQueue(clientId) {
    const res = await fetch(GAS_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "leaveQueue", clientId })
    });
    return res.json();
  },
  async pollPair(clientId) {
    const url = new URL(GAS_BASE_URL);
    url.searchParams.set("action", "pollPair");
    url.searchParams.set("clientId", clientId);
    const res = await fetch(url);
    return res.json();
  },
  async sendSignal(roomId, payload) {
    const res = await fetch(GAS_BASE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendSignal", roomId, payload })
    });
    return res.json();
  },
  async pullSignals(roomId, since) {
    const url = new URL(GAS_BASE_URL);
    url.searchParams.set("action", "pullSignals");
    url.searchParams.set("roomId", roomId);
    url.searchParams.set("since", String(since || 0));
    const res = await fetch(url);
    return res.json();
  }
};

// --------- UI refs ---------
const boardEl = document.getElementById("board");
const moveLogEl = document.getElementById("moveLog");
const matchBtn = document.getElementById("matchBtn");
const leaveBtn = document.getElementById("leaveBtn");
const connStateEl = document.getElementById("connState");
const mySideEl = document.getElementById("mySide");
const opponentSideEl = document.getElementById("opponentSide");
const turnDisplayEl = document.getElementById("turnDisplay");
const lastOpponentMoveEl = document.getElementById("lastOpponentMove");

// --------- State ---------
const clientId = `c_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
let roomId = null;
let mySide = null; // "white" or "black"
let turn = "white";
let rtc = null;
let dc = null;
let pollTimer = null;
let signalTimer = null;
let signalClock = 0;

const FILES = {
  // Unicode-like labels for pieces
  // For simplicity using letters: K,Q,R,B,N,P with side-based styling
  // Coordinates: 0..7 x 0..7 (rows, cols), 'a1' at white's left-bottom
};

let game = {
  board: [], // 8x8 squares { piece: {type:'K','Q','R','B','N','P', side:'white'|'black'} | null }
  lastMove: null,
  finished: false,
};

// --------- Helpers ---------
function xyToSquare(r, c) { return `${String.fromCharCode(97 + c)}${8 - r}`; }
function squareToXY(sq) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - parseInt(sq[1], 10);
  return { r, c };
}
function addLog(text) {
  const li = document.createElement("li");
  li.textContent = text;
  moveLogEl.prepend(li);
}
function setConnState(text) { connStateEl.textContent = text; }
function setTurnDisplay() { turnDisplayEl.textContent = game.finished ? "終了" : (turn === mySide ? "あなた" : "相手"); }

// --------- Board init & render ---------
function initBoard() {
  game.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  // Place pieces
  const back = ["R","N","B","Q","K","B","N","R"];
  // White
  for (let c=0;c<8;c++) {
    game.board[6][c] = { type: "P", side: "white" }; // row 6 -> rank 2
    game.board[7][c] = { type: back[c], side: "white" };
  }
  // Black
  for (let c=0;c<8;c++) {
    game.board[1][c] = { type: "P", side: "black" }; // row 1 -> rank 7
    game.board[0][c] = { type: back[c], side: "black" };
  }
  game.lastMove = null;
  game.finished = false;
  turn = "white";
}

function renderBoard() {
  boardEl.innerHTML = "";
  for (let r=0;r<8;r++) {
    for (let c=0;c<8;c++) {
      const sq = document.createElement("div");
      const isDark = (r + c) % 2 === 1;
      sq.className = `square ${isDark ? "dark" : "light"}`;
      sq.dataset.r = r; sq.dataset.c = c; sq.dataset.square = xyToSquare(r,c);

      // last move highlight
      if (game.lastMove && (game.lastMove.from.r === r && game.lastMove.from.c === c || game.lastMove.to.r === r && game.lastMove.to.c === c)) {
        sq.classList.add("highlight-move");
      }

      const cell = game.board[r][c];
      if (cell) {
        const piece = document.createElement("div");
        piece.className = `piece ${cell.side}`;
        piece.textContent = cell.type;
        piece.dataset.type = cell.type;
        piece.dataset.side = cell.side;
        piece.dataset.r = r; piece.dataset.c = c;
        sq.appendChild(piece);
      }
      boardEl.appendChild(sq);
    }
  }
}

// --------- Move generation (simplified, no check rules, legal paths respected) ---------
function inBounds(r,c) { return r>=0 && r<8 && c>=0 && c<8; }
function pieceAt(r,c) { return inBounds(r,c) ? game.board[r][c] : null; }

function generateMoves(r, c) {
  const p = pieceAt(r,c);
  if (!p || p.side !== turn) return [];
  const moves = [];
  const pushMove = (nr,nc, capture=false) => {
    moves.push({ from:{r,c}, to:{r:nr,c:nc}, capture });
  };
  const ray = (dirs) => {
    for (const [dr,dc] of dirs) {
      let nr=r+dr, nc=c+dc;
      while (inBounds(nr,nc)) {
        const o = pieceAt(nr,nc);
        if (!o) { pushMove(nr,nc,false); }
        else {
          if (o.side !== p.side) pushMove(nr,nc,true);
          break;
        }
        nr+=dr; nc+=dc;
      }
    }
  };

  if (p.type === "P") {
    const dir = p.side === "white" ? -1 : 1;
    const startRow = p.side === "white" ? 6 : 1;
    const nr = r + dir;

    if (inBounds(nr,c) && !pieceAt(nr,c)) pushMove(nr,c,false);
    // double move
    if (r === startRow && !pieceAt(nr,c) && !pieceAt(r + 2*dir, c)) pushMove(r + 2*dir, c, false);
    // captures
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (inBounds(nr,nc)) {
        const o = pieceAt(nr,nc);
        if (o && o.side !== p.side) pushMove(nr,nc,true);
      }
    }
  } else if (p.type === "N") {
    const jumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr,dc] of jumps) {
      const nr=r+dr, nc=c+dc;
      if (!inBounds(nr,nc)) continue;
      const o = pieceAt(nr,nc);
      if (!o) pushMove(nr,nc,false);
      else if (o.side !== p.side) pushMove(nr,nc,true);
    }
  } else if (p.type === "B") {
    ray([[1,1],[1,-1],[-1,1],[-1,-1]]);
  } else if (p.type === "R") {
    ray([[1,0],[-1,0],[0,1],[0,-1]]);
  } else if (p.type === "Q") {
    ray([[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]]);
  } else if (p.type === "K") {
    const steps = [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];
    for (const [dr,dc] of steps) {
      const nr=r+dr, nc=c+dc;
      if (!inBounds(nr,nc)) continue;
      const o = pieceAt(nr,nc);
      if (!o) pushMove(nr,nc,false);
      else if (o.side !== p.side) pushMove(nr,nc,true);
    }
  }
  return moves;
}

// --------- Interaction ---------
let selected = null;
let legalMoves = [];

function clearHighlights() {
  for (const sq of boardEl.querySelectorAll(".square")) {
    sq.classList.remove("highlight-legal","highlight-capture");
  }
}

function highlightMoves(moves) {
  clearHighlights();
  for (const m of moves) {
    const sel = boardEl.querySelector(`.square[data-r="${m.to.r}"][data-c="${m.to.c}"]`);
    if (!sel) continue;
    sel.classList.add(m.capture ? "highlight-capture" : "highlight-legal");
  }
}

function onSquareClick(e) {
  if (game.finished) return;
  const sq = e.currentTarget;
  const r = Number(sq.dataset.r), c = Number(sq.dataset.c);
  const cell = pieceAt(r,c);

  // Your turn only
  if (turn !== mySide) return;

  if (!selected) {
    if (cell && cell.side === mySide) {
      selected = { r, c };
      legalMoves = generateMoves(r,c);
      highlightMoves(legalMoves);
    }
    return;
  } else {
    const target = { r, c };
    const chosen = legalMoves.find(m => m.to.r === target.r && m.to.c === target.c);
    if (chosen) {
      performMove(chosen, true); // local
      selected = null;
      legalMoves = [];
      clearHighlights();
    } else {
      // reselect if clicked own piece
      if (cell && cell.side === mySide) {
        selected = { r, c };
        legalMoves = generateMoves(r,c);
        highlightMoves(legalMoves);
      } else {
        selected = null;
        legalMoves = [];
        clearHighlights();
      }
    }
  }
}

function performMove(move, send) {
  const fromCell = game.board[move.from.r][move.from.c];
  const toCell = game.board[move.to.r][move.to.c];

  const captured = toCell ? toCell.type : null;
  const movingPiece = fromCell;

  // Animation: brief lift at source, then fade target if capture
  const fromEl = boardEl.querySelector(`.square[data-r="${move.from.r}"][data-c="${move.from.c}"] .piece`);
  const toSquareEl = boardEl.querySelector(`.square[data-r="${move.to.r}"][data-c="${move.to.c}"]`);
  if (fromEl) fromEl.classList.add("moving");
  if (toCell) toSquareEl.classList.add("highlight-capture");

  // Apply move
  game.board[move.to.r][move.to.c] = movingPiece;
  game.board[move.from.r][move.from.c] = null;

  // Pawn promotion to queen (auto) if reaches end
  if (movingPiece.type === "P") {
    if (movingPiece.side === "white" && move.to.r === 0) movingPiece.type = "Q";
    if (movingPiece.side === "black" && move.to.r === 7) movingPiece.type = "Q";
  }

  game.lastMove = move;
  renderBoard();

  // Log
  const fromSq = xyToSquare(move.from.r, move.from.c);
  const toSq = xyToSquare(move.to.r, move.to.c);
  addLog(`${turn} ${movingPiece.type} ${fromSq} -> ${toSq}${captured ? ` (x ${captured})` : ""}`);

  // End condition: queen captured
  if (captured === "Q") {
    game.finished = true;
    setTurnDisplay();
    addLog(`ゲーム終了: ${turn} により相手のクイーンを捕獲`);
    alert(`${turn === mySide ? "勝利！" : "敗北…"} クイーンが取られました`);
  } else {
    // Switch turn
    turn = turn === "white" ? "black" : "white";
    setTurnDisplay();
  }

  // Broadcast to peer
  if (send && dc && dc.readyState === "open") {
    dc.send(JSON.stringify({ type: "move", move }));
  }
}

// --------- P2P (WebRTC) ----------
async function createPeer(isInitiator) {
  rtc = new RTCPeerConnection({
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302"] }
    ]
  });

  // Data channel
  if (isInitiator) {
    dc = rtc.createDataChannel("game");
    setupDataChannel();
  } else {
    rtc.ondatachannel = (e) => {
      dc = e.channel;
      setupDataChannel();
    };
  }

  rtc.onicecandidate = async (e) => {
    if (e.candidate) {
      await api.sendSignal(roomId, { kind: "ice", candidate: e.candidate });
    }
  };

  rtc.onconnectionstatechange = () => {
    setConnState(rtc.connectionState);
  };

  if (isInitiator) {
    const offer = await rtc.createOffer();
    await rtc.setLocalDescription(offer);
    await api.sendSignal(roomId, { kind: "offer", sdp: offer });
  }
}

function setupDataChannel() {
  dc.onopen = () => { setConnState("接続"); };
  dc.onclose = () => { setConnState("切断"); };
  dc.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === "move") {
      // Opponent move
      lastOpponentMoveEl.textContent = `${xyToSquare(data.move.from.r, data.move.from.c)} -> ${xyToSquare(data.move.to.r, data.move.to.c)}`;
      performMove(data.move, false);
    }
  };
}

// Poll signals and apply
async function startSignalPolling() {
  signalTimer = setInterval(async () => {
    if (!roomId) return;
    const res = await api.pullSignals(roomId, signalClock);
    if (!res.ok) return;
    signalClock = res.now;

    for (const s of res.signals) {
      const payload = s.payload;
      if (payload.kind === "offer" && !rtc.currentRemoteDescription) {
        await rtc.setRemoteDescription(payload.sdp);
        const answer = await rtc.createAnswer();
        await rtc.setLocalDescription(answer);
        await api.sendSignal(roomId, { kind: "answer", sdp: answer });
      } else if (payload.kind === "answer" && !rtc.currentRemoteDescription) {
        await rtc.setRemoteDescription(payload.sdp);
      } else if (payload.kind === "ice") {
        try { await rtc.addIceCandidate(payload.candidate); } catch {}
      }
    }
  }, 500);
}

// --------- Matchmaking flow ----------
async function startRandomMatch() {
  setConnState("待機中…");
  await api.leaveQueue(clientId); // reset any stale
  const res = await api.joinQueue(clientId);

  if (res.ok && res.waiting) {
    mySide = null;
    mySideEl.textContent = "-";
    opponentSideEl.textContent = "-";
    // poll pair
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      const p = await api.pollPair(clientId);
      if (p.ok && p.roomId) {
        clearInterval(pollTimer);
        roomId = p.roomId;
        mySide = p.side;
        initBoard();
        renderBoard();
        wireBoardClicks();
        mySideEl.textContent = mySide;
        opponentSideEl.textContent = mySide === "white" ? "black" : "white";
        setTurnDisplay();

        const isInitiator = mySide === "white"; // white initiates offer
        await createPeer(isInitiator);
        startSignalPolling();
      }
    }, 600);
  } else if (res.ok && res.roomId) {
    // immediately paired
    roomId = res.roomId;
    mySide = res.side;
    initBoard(); renderBoard(); wireBoardClicks();
    mySideEl.textContent = mySide;
    opponentSideEl.textContent = mySide === "white" ? "black" : "white";
    setTurnDisplay();
    const isInitiator = mySide === "white";
    await createPeer(isInitiator);
    startSignalPolling();
  } else {
    setConnState("エラー");
    alert("マッチ開始に失敗しました");
  }
}

function wireBoardClicks() {
  for (const sq of boardEl.querySelectorAll(".square")) {
    sq.addEventListener("click", onSquareClick);
  }
}

// --------- Buttons ----------
matchBtn.addEventListener("click", startRandomMatch);
leaveBtn.addEventListener("click", async () => {
  await api.leaveQueue(clientId);
  if (pollTimer) clearInterval(pollTimer);
  if (signalTimer) clearInterval(signalTimer);
  setConnState("未接続");
  roomId = null; mySide = null;
  mySideEl.textContent = "-"; opponentSideEl.textContent = "-";
  turnDisplayEl.textContent = "-";
  moveLogEl.innerHTML = "";
  initBoard(); renderBoard();
});

// --------- Boot ---------
initBoard();
renderBoard();
setConnState("未接続");
setTurnDisplay();
