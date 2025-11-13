// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Chess } = require('chess.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); // serve index.html, client.js, styles.css from /public

// Simple queue-based random matchmaking
let waitingPlayer = null;
const games = new Map(); // gameId -> { chess, players: {white, black}, lastMove, status }

function createGame(playerA, playerB) {
  const gameId = `g_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  // random colors
  const white = Math.random() < 0.5 ? playerA : playerB;
  const black = white === playerA ? playerB : playerA;

  const chess = new Chess();
  games.set(gameId, {
    chess,
    players: { white, black },
    lastMove: null,
    status: 'playing'
  });

  white.join(gameId);
  black.join(gameId);

  io.to(gameId).emit('game:start', {
    gameId,
    fen: chess.fen(),
    turn: chess.turn(), // 'w' or 'b'
    colors: {
      [white.id]: 'w',
      [black.id]: 'b'
    }
  });
}

io.on('connection', (socket) => {
  socket.emit('lobby:connected', { id: socket.id });

  // Enter matchmaking
  socket.on('lobby:findMatch', () => {
    if (waitingPlayer && waitingPlayer.id !== socket.id) {
      createGame(waitingPlayer, socket);
      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit('lobby:waiting');
    }
  });

  // Handle moves
  socket.on('game:move', ({ gameId, from, to, promotion }) => {
    const game = games.get(gameId);
    if (!game || game.status !== 'playing') return;

    const { chess, players } = game;
    const myColor = players.white.id === socket.id ? 'w' :
                    players.black.id === socket.id ? 'b' : null;
    if (!myColor) return;

    if (chess.turn() !== myColor) {
      socket.emit('game:error', { message: 'Not your turn.' });
      return;
    }

    const move = chess.move({ from, to, promotion: promotion || 'q' });
    if (!move) {
      socket.emit('game:error', { message: 'Illegal move.' });
      return;
    }

    game.lastMove = { from, to, san: move.san };

    // Queen capture sudden death rule
    const captured = move.captured;
    const capturedPieceIsQueen = captured === 'q';
    let winner = null;
    if (capturedPieceIsQueen) {
      // If black queen captured, black loses; if white queen captured, white loses
      winner = (move.color === 'w') ? 'w' : 'b'; // mover captured opponent's queen
      game.status = 'ended';
    }

    // Regular checkmate/stalemate also ends the game (for integrity)
    if (chess.isGameOver() && game.status !== 'ended') {
      game.status = 'ended';
      if (chess.isCheckmate()) {
        winner = chess.turn() === 'w' ? 'b' : 'w'; // side who just moved delivered mate
      } else {
        winner = 'draw';
      }
    }

    io.to(gameId).emit('game:update', {
      fen: chess.fen(),
      turn: chess.turn(),
      lastMove: game.lastMove,
      status: game.status,
      winner,
      suddenDeath: capturedPieceIsQueen
    });
  });

  socket.on('disconnect', () => {
    // Handle disconnection
    if (waitingPlayer && waitingPlayer.id === socket.id) {
      waitingPlayer = null;
    }
    // End games where a player disconnects
    for (const [gameId, game] of games.entries()) {
      if (game.status === 'playing' &&
          (game.players.white.id === socket.id || game.players.black.id === socket.id)) {
        game.status = 'ended';
        const winner = (game.players.white.id === socket.id) ? 'b' : 'w'; // the remaining player wins
        io.to(gameId).emit('game:update', {
          fen: game.chess.fen(),
          turn: game.chess.turn(),
          lastMove: game.lastMove,
          status: game.status,
          winner,
          suddenDeath: false,
          reason: 'opponent_disconnected'
        });
        io.socketsLeave(gameId); // clear room
        games.delete(gameId);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
